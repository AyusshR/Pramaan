const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
let serverProcess;
let baseUrl;
let userToken;
let verifierToken;
let cardId;

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/`);
      if (response.ok) return;
    } catch { /* Wait for the local server to start. */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Test server did not start in time.');
}

async function request(endpoint, { method = 'GET', token, body, apiKey } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (apiKey) headers['x-api-key'] = apiKey;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json();
  return { status: response.status, data };
}

test.before(async () => {
  const dataFile = path.join(projectRoot, 'data.json');
  if (fs.existsSync(dataFile)) fs.unlinkSync(dataFile);
  const port = await findFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore'
  });
  await waitForServer();
});

test.after(() => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill('SIGTERM');
  const dataFile = path.join(projectRoot, 'data.json');
  if (fs.existsSync(dataFile)) fs.unlinkSync(dataFile);
});

test('serves the Pramaan web page', async () => {
  const response = await fetch(`${baseUrl}/`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Prove one fact/);
  assert.match(html, /Consent first/);
  assert.match(html, /printDigitalCard/);
  assert.match(html, /Download printable card PDF/);
  const artwork = await fetch(`${baseUrl}/card-artwork/front.png`);
  assert.equal(artwork.status, 200);
  assert.match(artwork.headers.get('content-type'), /image\/png/);
  assert.match(html, /uploadCredential/);
  assert.match(html, /overAskWarning/);
  assert.match(html, /Card ID or registered phone number/);
});

test('logs in both roles and issues a demo card', async () => {
  const userLogin = await request('/api/login', {
    method: 'POST', body: { role: 'user', phone: '9876543210', otp: '123456' }
  });
  assert.equal(userLogin.status, 200);
  userToken = userLogin.data.token;

  const verifierLogin = await request('/api/login', {
    method: 'POST', body: { role: 'verifier', phone: '9000000001', otp: '123456' }
  });
  assert.equal(verifierLogin.status, 200);
  verifierToken = verifierLogin.data.token;

  const me = await request('/api/me', { token: userToken });
  assert.equal(me.data.name, 'Riya Sharma');

  const issued = await request('/api/card/apply', {
    method: 'POST', token: userToken, body: { type: 'Digital' }
  });
  assert.equal(issued.status, 200);
  assert.equal(issued.data.status, 'active');
  assert.match(issued.data.id, /^PR-[A-F0-9]{10}$/);
  cardId = issued.data.id;
});

test('creates a consent request and returns an approved answer', async () => {
  const created = await request('/api/requests', {
    method: 'POST', token: verifierToken,
    body: { identifier: cardId, purpose: 'Employment screening', questions: ['over18', 'degreeCompleted'] }
  });
  assert.equal(created.status, 200);
  const requestId = created.data.requestId;

  const inbox = await request('/api/requests', { token: userToken });
  assert.equal(inbox.status, 200);
  assert.equal(inbox.data[0].id, requestId);
  assert.equal(inbox.data[0].status, 'sent');
  const notifications = await request('/api/notifications', { token: userToken });
  assert.ok(notifications.data.some(item => item.message.includes('sent a request')));

  const response = await request(`/api/requests/${requestId}/respond`, {
    method: 'POST', token: userToken,
    body: { approve: ['over18'], hours: 24 }
  });
  assert.equal(response.status, 200);

  const verifierRequests = await request('/api/requests', { token: verifierToken });
  assert.equal(verifierRequests.data[0].status, 'answered');
  assert.equal(verifierRequests.data[0].questions.find(item => item.id === 'over18').answer, 'yes');
  assert.equal(verifierRequests.data[0].questions.find(item => item.id === 'degreeCompleted').answer, null);
  assert.deepEqual(verifierRequests.data[0].processingSteps.map(step => step.name), ['Fetch', 'Read', 'Locate', 'Answer', 'Delete']);
});

test('revokes answer access and prevents further requests after blocking', async () => {
  const verifierRequests = await request('/api/requests', { token: verifierToken });
  const requestId = verifierRequests.data[0].id;
  const revoked = await request(`/api/requests/${requestId}/revoke`, { method: 'POST', token: userToken });
  assert.equal(revoked.status, 200);

  const blocked = await request('/api/block', {
    method: 'POST', token: userToken,
    body: { verifierId: '9000000001', report: true }
  });
  assert.equal(blocked.status, 200);

  const denied = await request('/api/requests', {
    method: 'POST', token: verifierToken,
    body: { identifier: cardId, purpose: 'Second check', questions: ['over18'] }
  });
  assert.equal(denied.status, 403);
});

test('wallet source state and API-key integration work', async () => {
  const wallet = await request('/api/wallet', { token: userToken });
  assert.equal(wallet.status, 200);
  assert.ok(wallet.data.some(record => record.id === 'income'));
  const connected = await request('/api/wallet/connect', { method: 'POST', token: userToken, body: { documentId: 'passport' } });
  assert.equal(connected.status, 200);
  const duplicateCredential = await request('/api/wallet/connect', { method: 'POST', token: userToken, body: { documentId: 'passport' } });
  assert.equal(duplicateCredential.status, 409);

  const revokedSource = await request('/api/wallet/revoke', {
    method: 'POST', token: userToken, body: { documentId: 'income' }
  });
  assert.equal(revokedSource.status, 200);
  assert.equal(revokedSource.data.revoked, true);

  // Use a second verifier to test the API success path (the first verifier is blocked later).
  const universityLogin = await request('/api/login', {
    method: 'POST', body: { role: 'verifier', phone: '9000000002', otp: '123456' }
  });
  assert.equal(universityLogin.status, 200);
  const universityToken = universityLogin.data.token;
  const apiVerifier = await request('/api/me', { token: universityToken });
  assert.ok(apiVerifier.data.apiKey);
  assert.equal(apiVerifier.data.trustBadge, 'demo-registry-listed');
  const verifierAlerts = await request('/api/alerts', { method: 'POST', token: universityToken, body: { email: false, app: true } });
  assert.equal(verifierAlerts.status, 200);
  assert.equal(verifierAlerts.data.email, false);
  const apiRequest = await request('/api/v1/verify', {
    method: 'POST', apiKey: apiVerifier.data.apiKey,
    body: { identifier: '9876543210', purpose: 'University admission', questions: ['enrolled'] }
  });
  assert.equal(apiRequest.status, 200);
  assert.ok(apiRequest.data.requestId);

  const phoneLookupRequest = await request('/api/requests', {
    method: 'POST', token: universityToken,
    body: { identifier: '9876543210', purpose: 'Phone number lookup test', questions: ['enrolled'] }
  });
  assert.equal(phoneLookupRequest.status, 200, 'Verifier can identify a person using their registered phone number without a card.');

  const apiResult = await request(`/api/v1/requests/${apiRequest.data.requestId}`, {
    apiKey: apiVerifier.data.apiKey
  });
  assert.equal(apiResult.status, 200);
  assert.equal(apiResult.data.status, 'sent');

  const invalidApiKey = await request('/api/v1/verify', {
    method: 'POST', apiKey: 'not-a-real-key',
    body: { identifier: '9876543210', purpose: 'API demo', questions: ['enrolled'] }
  });
  assert.equal(invalidApiKey.status, 401);
});


test('supports user card-ID login and keeps the same card code after reissue', async () => {
  const cardLogin = await request('/api/login', {
    method: 'POST', body: { role: 'user', identifierType: 'card', identifier: cardId, otp: '123456' }
  });
  assert.equal(cardLogin.status, 200);
  const disabled = await request('/api/card/disable', { method: 'POST', token: cardLogin.data.token });
  assert.equal(disabled.status, 200);
  const reissued = await request('/api/card/apply', { method: 'POST', token: cardLogin.data.token, body: { type: 'Digital' } });
  assert.equal(reissued.status, 200);
  assert.equal(reissued.data.id, cardId, 'the same person keeps the original card code');
});

test('supports verifier email login and sends over-ask warning to the person', async () => {
  const registration = await request('/api/login', {
    method: 'POST', body: { role: 'verifier', identifier: 'admissions@example.test', phone: '9000000099', email: 'admissions@example.test', name: 'Admissions Office', type: 'Employer', otp: '123456' }
  });
  assert.equal(registration.status, 200);
  const emailLogin = await request('/api/login', {
    method: 'POST', body: { role: 'verifier', identifier: 'admissions@example.test', otp: '123456' }
  });
  assert.equal(emailLogin.status, 200);
  const overAsk = await request('/api/requests', {
    method: 'POST', token: emailLogin.data.token,
    body: { identifier: cardId, purpose: 'Broad employment screening', questions: ['degreeCompleted', 'identityVerified', 'over18'] }
  });
  assert.equal(overAsk.status, 200);
  const inbox = await request('/api/requests', { token: userToken });
  assert.equal(inbox.data[0].overAsk, true);
  const notifications = await request('/api/notifications', { token: userToken });
  assert.ok(notifications.data.some(item => item.message.includes('OVER-ASK WARNING')));
});

test('rejects invalid OTP and disables the card', async () => {
  const invalidLogin = await request('/api/login', {
    method: 'POST', body: { role: 'user', phone: '9999999999', otp: '000000' }
  });
  assert.equal(invalidLogin.status, 401);

  const disabled = await request('/api/card/disable', { method: 'POST', token: userToken });
  assert.equal(disabled.status, 200);
  const requestAfterDisable = await request('/api/requests', {
    method: 'POST', token: verifierToken,
    body: { identifier: cardId, purpose: 'Card disabled test', questions: ['over18'] }
  });
  assert.equal(requestAfterDisable.status, 403);
});


test('supports new account registration and account deletion', async () => {
  const registration = await request('/api/login', {
    method: 'POST',
    body: { role: 'user', phone: '1112223333', name: 'Test Person', otp: '123456' }
  });
  assert.equal(registration.status, 200);

  const profile = await request('/api/me', { token: registration.data.token });
  assert.equal(profile.data.name, 'Test Person');
  const support = await request('/api/support', { method: 'POST', token: registration.data.token, body: { subject: 'Test support', message: 'Please help me test the contact form.' } });
  assert.equal(support.status, 201);
  assert.match(support.data.ticketId, /^CTH-/);

  const deletion = await request('/api/account', {
    method: 'DELETE', token: registration.data.token
  });
  assert.equal(deletion.status, 200);

  const deletedProfile = await request('/api/me', { token: registration.data.token });
  assert.equal(deletedProfile.status, 401);
});
