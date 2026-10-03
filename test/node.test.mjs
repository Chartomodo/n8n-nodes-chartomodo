import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import mod from '../dist/nodes/ChartOmodo/ChartOmodo.node.js';

const { NodeApiError } = createRequire(import.meta.url)('n8n-workflow');
const node = { id: 'node-1', name: 'ChartOmodo', type: 'x', typeVersion: 1, parameters: {} };

// Just enough of IExecuteFunctions for execute(); `replies` are returned (or thrown) in order.
function ctx(params, items, replies, { continueOnFail = false } = {}) {
  const calls = [];
  return {
    calls,
    getInputData: () => items,
    getNodeParameter: (name, _i, fallback) => params[name] ?? fallback,
    getExecutionId: () => '77',
    getNode: () => node,
    getWorkflowDataProxy: () => ({ $thisRunIndex: 2 }),
    continueOnFail: () => continueOnFail,
    getCredentials: async () => ({ baseUrl: 'https://c.com' }),
    helpers: {
      httpRequestWithAuthentication: async (_c, opts) => {
        calls.push(opts);
        const r = replies.shift();
        if (r instanceof Error) throw r;
        return r;
      },
    },
  };
}
const run = (c) => new mod.ChartOmodo().execute.call(c);
const items = [{ json: { a: 1, b: 'x' } }, { json: { a: 2, b: 'y' } }];

test('replace: all items in one PUT, run-scoped key, one output paired to every input', async () => {
  const c = ctx({ resource: 'dataset', operation: 'replace', datasetId: 'd/1', fields: 'a' }, items, [
    { id: 'd/1', rowCount: 2, columns: ['a'], addedColumns: [], droppedColumns: ['b'] },
  ]);
  const [out] = await run(c);
  assert.equal(c.calls.length, 1);
  assert.equal(c.calls[0].method, 'PUT');
  assert.equal(c.calls[0].url, 'https://c.com/api/v1/datasets/d%2F1/rows');
  assert.deepEqual(c.calls[0].body, { rows: [{ a: 1 }, { a: 2 }] });
  assert.equal(c.calls[0].headers['Idempotency-Key'], '77:node-1:2:0');
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].pairedItem, [{ item: 0 }, { item: 1 }]);
  assert.equal(out[0].json.rowCount, 2);
  assert.equal(out[0].json.requests, 1);
});

test('create sends no Idempotency-Key; continueOnFail reports the API message and code', async () => {
  const axios = Object.assign(new Error('Request failed with status code 422'), {
    isAxiosError: true,
    response: { status: 422, headers: {}, data: { error: { code: 'nested_value', message: 'flatten it' } } },
  });
  const c = ctx({ resource: 'dataset', operation: 'create', name: 'n' }, items, [new NodeApiError(node, axios)], {
    continueOnFail: true,
  });
  const [out] = await run(c);
  assert.equal(c.calls[0].headers, undefined);
  assert.deepEqual(out[0].json, { error: 'flatten it', code: 'nested_value' });
  assert.deepEqual(out[0].pairedItem, [{ item: 0 }, { item: 1 }]);
});

test('getAll runs once regardless of input count', async () => {
  const c = ctx({ resource: 'chart', operation: 'getAll' }, items, [{ data: [{ id: 'c1' }, { id: 'c2' }] }]);
  const [out] = await run(c);
  assert.equal(c.calls.length, 1);
  assert.deepEqual(out.map((o) => o.json.id), ['c1', 'c2']);
});

test('chart get runs per item; a failure carries its itemIndex', async () => {
  const axios = Object.assign(new Error('Request failed with status code 404'), {
    isAxiosError: true,
    response: { status: 404, headers: {}, data: { error: { code: 'not_found', message: 'Chart not found' } } },
  });
  const c = ctx({ resource: 'chart', operation: 'get', chartId: 'c1' }, items, [{ id: 'c1' }, new NodeApiError(node, axios)]);
  await assert.rejects(run(c), (e) => {
    assert.equal(e.message, 'Chart not found');
    assert.equal(e.context.itemIndex, 1);
    return true;
  });
  assert.equal(c.calls.length, 2);
});

test('replace over 5 MB: NodeOperationError, or an error item under continueOnFail', async () => {
  const big = [{ json: { s: 'x'.repeat(5_000_000) } }];
  const params = { resource: 'dataset', operation: 'replace', datasetId: 'd1' };
  await assert.rejects(run(ctx(params, big, [])), /larger than the 5 MB/);
  const [out] = await run(ctx(params, big, [], { continueOnFail: true }));
  assert.match(out[0].json.error, /larger than the 5 MB/);
});

test('append: one request per byte-budget chunk, keys :0 and :1, dedup flagged', async () => {
  const half = [{ json: { s: 'x'.repeat(2_100_000) } }, { json: { s: 'y'.repeat(2_100_000) } }];
  const c = ctx({ resource: 'dataset', operation: 'append', datasetId: 'd1' }, half, [
    { duplicate: true },
    { id: 'd1', rowCount: 9, columns: ['s'], addedColumns: [], droppedColumns: [] },
  ]);
  const [out] = await run(c);
  assert.deepEqual(c.calls.map((o) => [o.method, o.headers['Idempotency-Key'], o.body.rows.length]), [
    ['POST', '77:node-1:2:0', 1],
    ['POST', '77:node-1:2:1', 1],
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].json, {
    id: 'd1', rowCount: 9, columns: ['s'], addedColumns: [], droppedColumns: [], requests: 2, duplicate: true,
  });
});
