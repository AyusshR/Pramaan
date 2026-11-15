/**
 * Pramaan demo server
 * ---------------------
 * Built with Node's built-in modules, so no npm packages are required.
 * All agency records, OTPs, biometric checks and AI-style answers are simulated.
 * This is a learning/demo project, NOT a production identity-verification service.
 */

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
// Vercel's deployed code directory is read-only. Use /tmp there so the
// demo can start; local development continues to use ./data.json.
// Note: /tmp is ephemeral and is NOT a production database.
const DATA_FILE = process.env.VERCEL
  ? path.join('/tmp', 'pramaan-data.json')
  : path.join(__dirname, 'data.json');
const DEMO_OTP = '123456';
const MAX_BODY_BYTES = 1_000_000;

// PRAMAAN CARD IDS: new cards use PR-. Legacy CT- IDs remain valid.
const normalizeCardId = value => String(value || '').trim().toUpperCase().replace(/^CT-/, 'PR-');
const createUniqueCardId = () => {
  let id;
  do { id = `PR-${randomHex(5)}`; } while (Object.values(database.users).some(user => normalizeCardId(user.card?.id) === id));
  return id;
};

// -----------------------------------------------------------------------------
// 1. Persistent demo data and in-memory sessions
// -----------------------------------------------------------------------------

const emptyDatabase = () => ({ users: {}, verifiers: {}, requests: [], logs: [], notifications: [], supportTickets: [] });
let database = emptyDatabase();

try {
  if (fs.existsSync(DATA_FILE)) {
    const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    database = { ...emptyDatabase(), ...saved };
  }
} catch (error) {
  console.warn('Could not read data.json. Starting with a fresh demo database.', error.message);
  database = emptyDatabase();
}

// Upgrade saved demo card IDs without changing the unique suffix.
for (const user of Object.values(database.users)) {
  if (user.card?.id) user.card.id = normalizeCardId(user.card.id);
}

// Fake agency records exist only in server memory. They are not written to data.json.
const agencyRecords = new Map();
const sessions = new Map();
const requestTimestamps = new Map();

const randomHex = (bytes = 3) => crypto.randomBytes(bytes).toString('hex').toUpperCase();
const createToken = () => crypto.randomBytes(32).toString('hex');
const now = () => Date.now();

function saveDatabase() {
  const temporaryFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(database, null, 2));
  fs.renameSync(temporaryFile, DATA_FILE);
}

function createAgencyRecords() {
  return {
    identity: { label: 'Identity record (demo)', fields: { dateOfBirth: '2002-05-14' }, revoked: false, readable: true },
    marksheet: { label: 'Marksheet (demo)', fields: { cgpa: 8.6, degree: 'B.Tech' }, revoked: false, readable: true },
    income: { label: 'Income certificate (demo)', fields: { annualIncome: 240000 }, revoked: false, readable: false },
    student: { label: 'Student record (demo)', fields: { enrolled: true }, revoked: false, readable: true },
    address: { label: 'Address record (demo)', fields: { city: 'Delhi' }, revoked: false, readable: true }
  };
}

function getAgencyRecords(phone) {
  if (!agencyRecords.has(phone)) agencyRecords.set(phone, createAgencyRecords());
  return agencyRecords.get(phone);
}

// Migrate old prototype data: remove mock documents from persistent user records.
for (const user of Object.values(database.users)) {
  delete user.docs;
  getAgencyRecords(user.phone);
  user.blocked ||= [];
  user.alerts = { sms: true, email: true, app: true, ...(user.alerts || {}) };
}
for (const verifier of Object.values(database.verifiers)) {
  verifier.alerts = { sms: true, email: true, app: true, ...(verifier.alerts || {}) };
  verifier.trustBadge ||= 'demo-registry-listed';
}

const QUESTIONS = {
  over18: { text: 'Is the holder over 18?', source: 'identity', check: fields => calculateAge(fields.dateOfBirth) >= 18 },
  identityVerified: { text: 'Is the identity record available?', source: 'identity', check: () => true },
  enrolled: { text: 'Is the holder an enrolled student?', source: 'student', check: fields => fields.enrolled === true },
  cgpaAbove8: { text: 'Is the CGPA above 8?', source: 'marksheet', check: fields => fields.cgpa > 8 },
  degreeCompleted: { text: 'Is a degree listed?', source: 'marksheet', check: fields => Boolean(fields.degree) },
  incomeBelow300k: { text: 'Is annual income below Rs 3,00,000?', source: 'income', check: fields => fields.annualIncome < 300000 },
  addressAvailable: { text: 'Is an address record available?', source: 'address', check: fields => Boolean(fields.city) },
  passportValid: { text: 'Is a valid passport record available?', source: 'passport', check: fields => fields.valid === true },
  drivingLicenceAvailable: { text: 'Is a driving licence record available?', source: 'drivingLicence', check: fields => fields.present === true },
  professionalCertAvailable: { text: 'Is a professional certificate listed?', source: 'professional', check: fields => fields.listed === true }
};

const VERIFIER_QUESTIONS = {
  College: ['enrolled', 'cgpaAbove8', 'degreeCompleted'],
  Hostel: ['enrolled', 'over18', 'addressAvailable'],
  Employer: ['degreeCompleted', 'identityVerified', 'over18', 'professionalCertAvailable', 'drivingLicenceAvailable'],
  Hotel: ['over18', 'identityVerified', 'passportValid'],
  'Scholarship portal': ['incomeBelow300k', 'enrolled', 'cgpaAbove8']
};

function calculateAge(dateOfBirth) {
  const birthDate = new Date(`${dateOfBirth}T00:00:00`);
  if (Number.isNaN(birthDate.getTime())) return -1;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const birthdayHasPassed = today.getMonth() > birthDate.getMonth()
    || (today.getMonth() === birthDate.getMonth() && today.getDate() >= birthDate.getDate());
  if (!birthdayHasPassed) age -= 1;
  return age;
}

function createUser(phone, name) {
  getAgencyRecords(phone);
  return { phone, name, card: null, blocked: [], alerts: { sms: true, email: true, app: true } };
}

function createVerifier(phone, name, type, email = '') {
  return { phone, email: String(email || '').trim().toLowerCase(), name, type, trustBadge: 'demo-registry-listed', apiKey: `pr_demo_${randomHex(16).toLowerCase()}`, alerts: { sms: true, email: true, app: true } };
}

// Predictable demo accounts make it easy to test both sides of the workflow.
database.users['9876543210'] ||= createUser('9876543210', 'Riya Sharma');
database.verifiers['9000000001'] ||= createVerifier('9000000001', 'TechNova HR', 'Employer');
database.verifiers['9000000002'] ||= createVerifier('9000000002', 'Sample University', 'College');
saveDatabase();

// -----------------------------------------------------------------------------
// 2. Shared helpers: responses, validation, logs, notifications and access
// -----------------------------------------------------------------------------

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, statusCode, message) {
  sendJson(response, statusCode, { error: message });
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw Object.assign(new Error('Request body is too large'), { statusCode: 413 });
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON'), { statusCode: 400 });
  }
}

function getSession(request, requiredRole) {
  const token = (request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = sessions.get(token);
  if (!session || (requiredRole && session.role !== requiredRole)) return null;
  return { ...session, token };
}

function getVerifierFromApiKey(request) {
  const apiKey = request.headers['x-api-key'];
  return Object.values(database.verifiers).find(verifier => verifier.apiKey === apiKey) || null;
}

function addLog(userPhone, verifierPhone, message) {
  database.logs.unshift({ time: now(), userPhone, verifierPhone, message });
  database.logs = database.logs.slice(0, 500);
}

function addNotification(recipient, message) {
  const isUser = recipient.startsWith('user:');
  const phone = recipient.slice(recipient.indexOf(':') + 1);
  const account = isUser ? database.users[phone] : database.verifiers[phone];
  if (!account) return;

  const appEnabled = account.alerts?.app !== false;
  if (appEnabled) {
    database.notifications.unshift({ recipient, message, time: now() });
    database.notifications = database.notifications.slice(0, 300);
  }

  // SMS/email are console-only placeholders in this demo.
  if (account.alerts?.sms || account.alerts?.email) {
    const channels = [account.alerts.sms && 'SMS', account.alerts.email && 'email'].filter(Boolean).join('/');
    console.log(`[simulated ${channels} -> ${phone}] ${message}`);
  }
}

function findUser(identifier) {
  const value = String(identifier || '').trim().toUpperCase();
  if (!value) return null;
  return Object.values(database.users).find(user =>
    user.phone === value || (user.card && normalizeCardId(user.card.id) === normalizeCardId(value))
  ) || null;
}

function processApprovedQuestion(phone, questionId) {
  const question = QUESTIONS[questionId];
  const steps = [
    { name: 'Fetch', detail: 'Mock agency source selected in memory' },
    { name: 'Read', detail: 'Demo fields read; no OCR or vision model is connected' },
    { name: 'Locate', detail: 'Only the field needed for this question is evaluated' },
    { name: 'Answer', detail: 'A rule-based demo result is produced' },
    { name: 'Delete', detail: 'No document file exists in this prototype; temporary lookup references are released' }
  ];
  if (!question) return { answer: 'unsure', steps };
  const record = getAgencyRecords(phone)[question.source];
  if (!record || record.revoked) return { answer: 'revoked', steps };
  if (!record.readable) return { answer: 'unsure', steps };
  return { answer: question.check(record.fields) ? 'yes' : 'no', steps };
}

function shapeRequest(request) {
  const isLive = request.status === 'answered' && now() < request.expiresAt;
  const status = request.status === 'answered' && !isLive ? 'expired' : request.status;

  return {
    id: request.id,
    subject: request.subject,
    purpose: request.purpose,
    overAsk: Boolean(request.overAsk || request.questionIds.length >= 3),
    questionCount: request.questionIds.length,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt || null,
    status,
    verifier: {
      id: request.verifierPhone,
      name: request.verifierName,
      type: request.verifierType,
      trustBadge: 'demo-registry-listed'
    },
    processingSteps: request.processingSteps || [],
    questions: request.questionIds.map(id => ({
      id,
      text: QUESTIONS[id].text,
      approved: request.approvedQuestionIds.includes(id),
      answer: isLive && request.approvedQuestionIds.includes(id) ? request.answers[id] : null
    }))
  };
}

function createVerificationRequest(verifier, body) {
  const user = findUser(body.identifier);
  if (!user) return { statusCode: 404, error: 'No person found for that card ID or registered phone number.' };

  const identifier = String(body.identifier || '').trim().toUpperCase();
  const usedCard = Boolean(user.card && user.card.id === identifier);
  if (usedCard && user.card.status !== 'active') {
    return { statusCode: 403, error: 'This card is disabled. Ask the person to issue a new card.' };
  }
  if ((user.blocked || []).includes(verifier.phone)) {
    return { statusCode: 403, error: 'This person is not accepting requests from your organisation.' };
  }

  const purpose = String(body.purpose || '').trim().slice(0, 200);
  if (!purpose) return { statusCode: 400, error: 'Please state the purpose of this check.' };
  if (!Array.isArray(body.questions)) return { statusCode: 400, error: 'Choose at least one allowed question.' };

  const allowedQuestions = VERIFIER_QUESTIONS[verifier.type] || [];
  const questionIds = [...new Set(body.questions)].filter(id => allowedQuestions.includes(id));
  if (questionIds.length === 0) {
    return { statusCode: 400, error: 'Choose at least one question from your organisation’s allowed list.' };
  }

  const timestamps = (requestTimestamps.get(verifier.phone) || []).filter(time => now() - time < 60_000);
  if (timestamps.length >= 20) return { statusCode: 429, error: 'Too many requests. Please try again in one minute.' };
  timestamps.push(now());
  requestTimestamps.set(verifier.phone, timestamps);

  const overAsk = questionIds.length >= 3;
  const request = {
    id: `RQ-${randomHex(3)}`,
    overAsk,
    userPhone: user.phone,
    verifierPhone: verifier.phone,
    verifierName: verifier.name,
    verifierType: verifier.type,
    subject: usedCard ? `Card ${user.card.id}` : `Phone ending ${user.phone.slice(-4)}`,
    purpose,
    questionIds,
    status: 'sent',
    createdAt: now(),
    approvedQuestionIds: [],
    answers: {}
  };

  database.requests.unshift(request);
  addNotification(`user:${user.phone}`, `${overAsk ? '⚠ OVER-ASK WARNING: ' : ''}${verifier.name} sent a request with ${questionIds.length} question(s). Review each item before sharing anything.`);
  addLog(user.phone, verifier.phone, `Request from ${verifier.name}: ${questionIds.map(id => QUESTIONS[id].text).join(' | ')}`);
  saveDatabase();
  return { requestId: request.id };
}

// -----------------------------------------------------------------------------
// 3. API route handlers
// -----------------------------------------------------------------------------

async function handleApi(request, response, url) {
  const method = request.method;
  const pathname = url.pathname;
  const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await readJson(request) : {};

  if (method === 'POST' && pathname === '/api/login') {
    const { role, phone, identifier, identifierType, otp, name, type, email } = body;
    if (otp !== DEMO_OTP) return sendError(response, 401, `Incorrect demo OTP. Use ${DEMO_OTP}.`);
    let accountPhone = String(phone || '').trim();

    if (role === 'user') {
      if (identifierType === 'card') {
        const cardId = String(identifier || '').trim().toUpperCase();
        const account = Object.values(database.users).find(user => normalizeCardId(user.card?.id) === normalizeCardId(cardId));
        if (!account) return sendError(response, 404, 'No account found for that Pramaan card ID.');
        accountPhone = account.phone;
      } else {
        accountPhone = String(identifier || phone || '').trim();
      }
      if (!/^\d{10}$/.test(accountPhone)) return sendError(response, 400, 'Enter a valid 10-digit registered phone number.');
      if (!database.users[accountPhone]) database.users[accountPhone] = createUser(accountPhone, String(name || 'New User').trim().slice(0, 40));
    } else if (role === 'verifier') {
      const loginValue = String(identifier || phone || '').trim();
      let existing = /^\d{10}$/.test(loginValue)
        ? database.verifiers[loginValue]
        : Object.values(database.verifiers).find(item => item.email && item.email === loginValue.toLowerCase());
      if (existing) accountPhone = existing.phone;
      else {
        if (!/^\d{10}$/.test(accountPhone)) accountPhone = String(phone || '').trim();
        if (!/^\d{10}$/.test(accountPhone) || !String(name || '').trim() || !VERIFIER_QUESTIONS[type]) {
          return sendError(response, 400, 'For a new verifier, enter a registered 10-digit phone, organisation name and organisation type.');
        }
        if (loginValue.includes('@') && !/^\S+@\S+\.\S+$/.test(loginValue)) return sendError(response, 400, 'Enter a valid email address.');
        database.verifiers[accountPhone] ||= createVerifier(accountPhone, String(name).trim().slice(0, 60), type, email || (loginValue.includes('@') ? loginValue : ''));
        existing = database.verifiers[accountPhone];
      }
    } else {
      return sendError(response, 400, 'Choose Person or Verifier.');
    }

    const token = createToken();
    sessions.set(token, { role, phone: accountPhone });
    saveDatabase();
    return sendJson(response, 200, { token });
  }

  if (method === 'POST' && pathname === '/api/logout') {
    const session = getSession(request);
    if (session) sessions.delete(session.token);
    return sendJson(response, 200, { success: true });
  }

  // API-key endpoints are used by a verifier's external portal.
  if (pathname.startsWith('/api/v1/')) {
    const verifier = getVerifierFromApiKey(request);
    if (!verifier) return sendError(response, 401, 'Missing or invalid API key.');

    if (method === 'POST' && pathname === '/api/v1/verify') {
      const result = createVerificationRequest(verifier, body);
      return result.error
        ? sendError(response, result.statusCode, result.error)
        : sendJson(response, 200, result);
    }

    const apiRequestMatch = pathname.match(/^\/api\/v1\/requests\/([^/]+)$/);
    if (method === 'GET' && apiRequestMatch) {
      const record = database.requests.find(item => item.id === decodeURIComponent(apiRequestMatch[1]) && item.verifierPhone === verifier.phone);
      return record ? sendJson(response, 200, shapeRequest(record)) : sendError(response, 404, 'Request not found.');
    }
    return sendError(response, 404, 'API endpoint not found.');
  }

  const session = getSession(request);
  if (!session) return sendError(response, 401, 'Please log in again.');
  const { role, phone } = session;

  if (method === 'GET' && pathname === '/api/me') {
    if (role === 'user') {
      const user = database.users[phone];
      return sendJson(response, 200, { role, phone, name: user.name, card: user.card, alerts: user.alerts });
    }
    const verifier = database.verifiers[phone];
    return sendJson(response, 200, {
      role,
      phone,
      name: verifier.name,
      type: verifier.type,
      trustBadge: verifier.trustBadge || 'demo-registry-listed',
      apiKey: verifier.apiKey,
      alerts: verifier.alerts || { app: true, sms: true, email: true },
      questions: VERIFIER_QUESTIONS[verifier.type].map(id => ({ id, text: QUESTIONS[id].text }))
    });
  }

  if (method === 'POST' && pathname === '/api/card/apply' && role === 'user') {
    const user = database.users[phone];
    if (user.card?.status === 'active') return sendError(response, 400, 'You already have an active card.');
    const cardType = body.type === 'Physical' ? 'Physical' : 'Digital';
    user.card = { id: (user.card?.id ? normalizeCardId(user.card.id) : createUniqueCardId()), type: cardType, status: 'active', issuedAt: user.card?.issuedAt || now() };
    addLog(phone, null, `Card issued (${cardType}) after simulated identity check.`);
    saveDatabase();
    return sendJson(response, 200, user.card);
  }

  if (method === 'POST' && pathname === '/api/card/disable' && role === 'user') {
    const user = database.users[phone];
    if (!user.card) return sendError(response, 400, 'You do not have a card to disable.');
    user.card.status = 'disabled';
    addLog(phone, null, 'Card disabled by the account holder.');
    saveDatabase();
    return sendJson(response, 200, { success: true });
  }

  if (method === 'GET' && pathname === '/api/wallet' && role === 'user') {
    const records = getAgencyRecords(phone);
    return sendJson(response, 200, Object.entries(records).map(([id, record]) => ({
      id,
      label: record.label,
      revoked: record.revoked,
      readable: record.readable
    })));
  }

  if (method === 'POST' && pathname === '/api/wallet/connect' && role === 'user') {
    const catalog = {
      passport: 'Passport record (demo)',
      drivingLicence: 'Driving licence record (demo)',
      professional: 'Professional certificate (demo)'
    };
    const documentId = String(body.documentId || '');
    if (!catalog[documentId]) return sendError(response, 400, 'Choose a credential from the available demo sources.');
    const records = getAgencyRecords(phone);
    if (records[documentId]) return sendError(response, 409, 'This demo credential is already in your wallet.');
    records[documentId] = { label: catalog[documentId], fields: documentId === 'passport' ? { valid: true } : documentId === 'drivingLicence' ? { present: true } : { listed: true }, revoked: false, readable: true };
    addLog(phone, null, `${catalog[documentId]} connected as a demo source.`);
    saveDatabase();
    return sendJson(response, 200, { success: true, documentId, label: catalog[documentId] });
  }

  if (method === 'POST' && pathname === '/api/wallet/revoke' && role === 'user') {
    const record = getAgencyRecords(phone)[body.documentId];
    if (!record) return sendError(response, 400, 'Unknown source record.');
    record.revoked = !record.revoked;
    addLog(phone, null, `Demo source record ${record.label} ${record.revoked ? 'revoked' : 'restored'}.`);
    saveDatabase();
    return sendJson(response, 200, { success: true, revoked: record.revoked });
  }

  if (method === 'POST' && pathname === '/api/requests' && role === 'verifier') {
    const result = createVerificationRequest(database.verifiers[phone], body);
    return result.error
      ? sendError(response, result.statusCode, result.error)
      : sendJson(response, 200, result);
  }

  if (method === 'GET' && pathname === '/api/requests') {
    const requests = database.requests
      .filter(item => role === 'user' ? item.userPhone === phone : item.verifierPhone === phone)
      .slice(0, 50)
      .map(shapeRequest);
    return sendJson(response, 200, requests);
  }

  const respondMatch = pathname.match(/^\/api\/requests\/([^/]+)\/respond$/);
  if (method === 'POST' && respondMatch && role === 'user') {
    const record = database.requests.find(item => item.id === decodeURIComponent(respondMatch[1]) && item.userPhone === phone);
    if (!record || record.status !== 'sent') return sendError(response, 404, 'Request not found or already handled.');

    const selected = Array.isArray(body.approve) ? body.approve : [];
    const approved = [...new Set(selected)].filter(id => record.questionIds.includes(id));
    if (approved.length === 0) {
      record.status = 'denied';
      addNotification(`verifier:${record.verifierPhone}`, `Request ${record.id} was denied by the person.`);
      addLog(phone, record.verifierPhone, `Request from ${record.verifierName} denied.`);
    } else {
      const allowedHours = [1, 24, 168];
      const hours = allowedHours.includes(Number(body.hours)) ? Number(body.hours) : 24;
      record.approvedQuestionIds = approved;
      const processed = Object.fromEntries(approved.map(id => [id, processApprovedQuestion(phone, id)]));
      record.answers = Object.fromEntries(Object.entries(processed).map(([id, result]) => [id, result.answer]));
      record.processingSteps = processed[approved[0]]?.steps || [];
      record.status = 'answered';
      record.expiresAt = now() + hours * 60 * 60 * 1000;
      addNotification(`verifier:${record.verifierPhone}`, `Results are ready for request ${record.id}.`);
      for (const id of approved) {
        addLog(phone, record.verifierPhone, `Answer to “${QUESTIONS[id].text}” for ${record.verifierName}: ${record.answers[id]}.`);
      }
    }
    saveDatabase();
    return sendJson(response, 200, { success: true });
  }

  const revokeMatch = pathname.match(/^\/api\/requests\/([^/]+)\/revoke$/);
  if (method === 'POST' && revokeMatch && role === 'user') {
    const record = database.requests.find(item => item.id === decodeURIComponent(revokeMatch[1]) && item.userPhone === phone);
    if (!record || record.status !== 'answered' || now() >= record.expiresAt) {
      return sendError(response, 404, 'An active answered request was not found.');
    }
    record.status = 'revoked';
    addLog(phone, record.verifierPhone, `Access revoked for ${record.verifierName}.`);
    saveDatabase();
    return sendJson(response, 200, { success: true });
  }

  if (method === 'GET' && pathname === '/api/log') {
    const entries = database.logs
      .filter(item => role === 'user' ? item.userPhone === phone : item.verifierPhone === phone)
      .slice(0, 100)
      .map(item => ({ time: item.time, message: item.message, category: /request|question/i.test(item.message) ? 'request' : /card/i.test(item.message) ? 'card' : /approved|answer/i.test(item.message) ? 'approved' : /denied/i.test(item.message) ? 'rejected' : /revok/i.test(item.message) ? 'revoked' : /expir/i.test(item.message) ? 'expired' : 'other' }));
    return sendJson(response, 200, entries);
  }

  if (method === 'GET' && pathname === '/api/notifications') {
    return sendJson(response, 200, database.notifications.filter(item => item.recipient === `${role}:${phone}`).slice(0, 30));
  }

  if (method === 'POST' && pathname === '/api/block' && role === 'user') {
    const user = database.users[phone];
    const verifierId = String(body.verifierId || '');
    if (!database.verifiers[verifierId]) return sendError(response, 404, 'Verifier not found.');
    if (!user.blocked.includes(verifierId)) user.blocked.push(verifierId);
    addLog(phone, verifierId, `${body.report ? 'Verifier reported and blocked' : 'Verifier blocked'}.`);
    saveDatabase();
    return sendJson(response, 200, { success: true });
  }

  if (method === 'POST' && pathname === '/api/alerts') {
    const account = role === 'user' ? database.users[phone] : database.verifiers[phone];
    account.alerts ||= { app: true, sms: true, email: true };
    const alerts = account.alerts;
    for (const key of ['sms', 'email', 'app']) {
      if (typeof body[key] === 'boolean') alerts[key] = body[key];
    }
    saveDatabase();
    return sendJson(response, 200, alerts);
  }

  if (method === 'POST' && pathname === '/api/support') {
    const subject = String(body.subject || '').trim().slice(0, 100);
    const message = String(body.message || '').trim().slice(0, 2000);
    if (!subject || message.length < 10) return sendError(response, 400, 'Enter a subject and a message of at least 10 characters.');
    const ticket = { id: `CTH-${randomHex(4)}`, role, phone, subject, message, createdAt: now(), status: 'received-demo' };
    database.supportTickets.unshift(ticket);
    database.supportTickets = database.supportTickets.slice(0, 200);
    addLog(role === 'user' ? phone : null, role === 'verifier' ? phone : null, `Support request ${ticket.id} submitted.`);
    saveDatabase();
    return sendJson(response, 201, { success: true, ticketId: ticket.id, status: ticket.status });
  }

  if (method === 'DELETE' && pathname === '/api/account') {
    if (role === 'user') {
      delete database.users[phone];
      agencyRecords.delete(phone);
      database.requests = database.requests.filter(item => item.userPhone !== phone);
      database.logs = database.logs.filter(item => item.userPhone !== phone);
      database.notifications = database.notifications.filter(item => item.recipient !== `user:${phone}`);
      database.supportTickets = database.supportTickets.filter(item => !(item.role === 'user' && item.phone === phone));
    } else {
      delete database.verifiers[phone];
      database.requests = database.requests.filter(item => item.verifierPhone !== phone);
      database.logs = database.logs.filter(item => item.verifierPhone !== phone);
      database.notifications = database.notifications.filter(item => item.recipient !== `verifier:${phone}`);
      database.supportTickets = database.supportTickets.filter(item => !(item.role === 'verifier' && item.phone === phone));
    }
    for (const [token, activeSession] of sessions) {
      if (activeSession.phone === phone && activeSession.role === role) sessions.delete(token);
    }
    saveDatabase();
    return sendJson(response, 200, { success: true });
  }

  return sendError(response, 404, 'API endpoint not found or not available for this account type.');
}

// -----------------------------------------------------------------------------
// 4. Static files and HTTP server
// -----------------------------------------------------------------------------

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function serveStatic(response, pathname) {
  const requestedPath = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const filePath = path.resolve(PUBLIC_DIR, `.${requestedPath}`);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`) && filePath !== path.join(PUBLIC_DIR, 'index.html')) {
    return sendError(response, 403, 'Forbidden.');
  }

  fs.readFile(filePath, (error, contents) => {
    if (error) return sendError(response, 404, 'Page not found.');
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    });
    response.end(contents);
  });
}

// Shared request handler: used by both the local HTTP server and Vercel.
async function handler(request, response) {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

    // vercel.json rewrites public paths through /api/[...path]. Remove that
    // internal prefix to recover the original app route.
    if (process.env.VERCEL && url.pathname.startsWith('/api/')) {
      url.pathname = url.pathname.slice(4) || '/';
      if (!url.pathname.startsWith('/')) url.pathname = `/${url.pathname}`;
    }

    if (url.pathname.startsWith('/api/')) {
      await handleApi(request, response, url);
    } else if (request.method === 'GET' || request.method === 'HEAD') {
      serveStatic(response, url.pathname);
    } else {
      sendError(response, 405, 'Method not allowed.');
    }
  } catch (error) {
    console.error('Request failed:', error);
    if (!response.headersSent) sendError(response, error.statusCode || 500, error.message || 'Internal server error.');
  }
}

module.exports = handler;

// Keep the original local development workflow: npm start
if (require.main === module) {
  const server = http.createServer(handler);
  server.listen(PORT, () => {
    console.log(`Pramaan demo is running at http://localhost:${PORT}`);
    console.log(`Demo OTP: ${DEMO_OTP}`);
    console.log('Reminder: agency records and verification results are simulated.');
  });
}
