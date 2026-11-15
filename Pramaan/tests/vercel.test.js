'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');

process.env.VERCEL = '1';
const tempDataFile = '/tmp/pramaan-data.json';
try { fs.rmSync(tempDataFile, { force: true }); } catch {}
const handler = require('../server');

function invoke(url, method = 'GET', body = '') {
  return new Promise((resolve, reject) => {
    const request = new EventEmitter();
    request.url = url;
    request.method = method;
    request.headers = { host: 'pramaan.vercel.app' };
    request[Symbol.asyncIterator] = async function* () {
      if (body) yield Buffer.from(body);
    };

    const chunks = [];
    const response = {
      headersSent: false,
      writeHead(statusCode, headers) {
        this.statusCode = statusCode;
        this.headers = headers;
        this.headersSent = true;
      },
      end(chunk) {
        if (chunk) chunks.push(Buffer.from(chunk));
        resolve({ statusCode: this.statusCode, body: Buffer.concat(chunks).toString() });
      }
    };

    handler(request, response).catch(reject);
  });
}

test('Vercel rewrite serves the frontend through the function', async () => {
  const result = await invoke('/api/index.html');
  assert.equal(result.statusCode, 200);
  assert.match(result.body, /Prove one fact/);
});

test('Vercel rewrite forwards API requests to the API handler', async () => {
  const result = await invoke('/api/api/login', 'POST', JSON.stringify({
    role: 'user',
    phone: '9876543210',
    otp: '123456'
  }));
  assert.equal(result.statusCode, 200);
  assert.ok(JSON.parse(result.body).token);
  assert.ok(fs.existsSync(tempDataFile), 'Vercel data writes should go to /tmp');
});
