import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import transport from '../dist/nodes/ChartOmodo/transport.js';

// n8n-workflow's ESM build has extensionless imports Node can't resolve; load the CJS build.
const { NodeApiError } = createRequire(import.meta.url)('n8n-workflow');
const { apiMessage, apiCode, retryDelayMs, normalizeBaseUrl } = transport;

// Mirrors n8n-core httpRequestWithAuthentication: NodeApiError wrapping an AxiosError.
class AxiosError extends Error {}
function thrown(status, data, headers = {}) {
  const axios = Object.assign(new AxiosError(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, headers, data },
  });
  return new NodeApiError({ name: 'ChartOmodo', type: 'x', typeVersion: 1, parameters: {} }, axios);
}
const err = (status, code, headers) => thrown(status, { error: { code, message: `msg ${code}` } }, headers);

test('apiMessage/apiCode read the API envelope, not n8n status text', () => {
  const e = err(422, 'nested_value');
  assert.equal(apiMessage(e), 'msg nested_value');
  assert.equal(apiCode(e), 'nested_value');
  assert.equal(apiMessage(new Error('boom')), 'boom');
  assert.equal(apiCode(new Error('boom')), undefined);
});

test('retryDelayMs: 429 and transient 503 honour Retry-After, capped; others not retried', () => {
  assert.equal(retryDelayMs(err(429, 'rate_limited', { 'retry-after': '2' })), 2_000);
  assert.equal(retryDelayMs(err(503, 'idempotency_in_progress')), 5_000);
  assert.equal(retryDelayMs(err(503, 'busy', { 'retry-after': '600' })), 30_000);
  assert.equal(retryDelayMs(err(503, 'api_disabled')), undefined);
  assert.equal(retryDelayMs(err(422, 'invalid_rows')), undefined);
  assert.equal(retryDelayMs(new Error('ECONNRESET')), undefined);
});

test('normalizeBaseUrl strips trailing slashes and /api/v1', () => {
  for (const u of ['https://c.com', 'https://c.com/', 'https://c.com/api/v1', 'https://c.com/api/v1/']) {
    assert.equal(normalizeBaseUrl(u), 'https://c.com');
  }
});

test('apiRequest retries a transient error, then throws the API message without retrying a 422', async () => {
  const calls = [];
  const replies = [err(429, 'rate_limited', { 'retry-after': '0' }), { ok: true }];
  const ctx = {
    getNode: () => ({ name: 'ChartOmodo', type: 'x', typeVersion: 1, parameters: {} }),
    getCredentials: async () => ({ baseUrl: 'https://c.com/api/v1/' }),
    helpers: {
      httpRequestWithAuthentication: async (_cred, opts) => {
        calls.push(opts);
        const r = replies.shift();
        if (r instanceof Error) throw r;
        return r;
      },
    },
  };
  assert.deepEqual(await transport.apiRequest.call(ctx, 'GET', '/me'), { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://c.com/api/v1/me');

  replies.push(err(422, 'nested_value'), { ok: true });
  await assert.rejects(transport.apiRequest.call(ctx, 'GET', '/me'), (e) => {
    assert.equal(e.message, 'msg nested_value');
    assert.equal(apiCode(e), 'nested_value');
    assert.equal(e.httpCode, '422');
    return true;
  });
  assert.equal(calls.length, 3);
});

test('idempotencyKeyPrefix: execution:node:run, random when the execution id is missing or unusable', () => {
  const { idempotencyKeyPrefix } = transport;
  assert.equal(idempotencyKeyPrefix('42', 'node-uuid', 3), '42:node-uuid:3');
  const valid = /^[!-~]{1,240}$/;
  for (const k of [idempotencyKeyPrefix('', 'n', 0), idempotencyKeyPrefix('has space', 'n', 0), idempotencyKeyPrefix('x'.repeat(300), 'n', 0)]) {
    assert.match(k, valid);
    assert.match(k, /^[0-9a-f-]{36}$/);
  }
  assert.notEqual(idempotencyKeyPrefix('', 'n', 0), idempotencyKeyPrefix('', 'n', 0));
});
