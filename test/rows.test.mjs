import { test } from 'node:test';
import assert from 'node:assert/strict';
import rows from '../dist/nodes/ChartOmodo/rows.js';

const { pickFields, chunkRows, jsonBytes } = rows;

test('pickFields: all fields when the list is empty, else only the listed ones', () => {
  assert.deepEqual(pickFields({ a: 1, b: 2 }, ''), { a: 1, b: 2 });
  assert.deepEqual(pickFields({ a: 1, b: 2, c: 3 }, 'a, c'), { a: 1, c: 3 });
  assert.deepEqual(pickFields({ a: 1 }, 'a, missing'), { a: 1, missing: null });
});

test('chunkRows keeps order and every chunk under the byte budget', () => {
  const data = Array.from({ length: 100 }, (_, i) => ({ i, pad: 'x'.repeat(50) }));
  const chunks = chunkRows(data, 1_000);
  assert.deepEqual(chunks.flat(), data);
  for (const c of chunks) assert.ok(jsonBytes({ rows: c }) <= 1_000);
});

test('chunkRows puts one oversized row in its own chunk instead of looping', () => {
  const big = { s: 'y'.repeat(2_000) };
  const chunks = chunkRows([{ a: 1 }, big, { a: 2 }], 1_000);
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks[1], [big]);
});

test('jsonBytes counts UTF-8 bytes, not characters', () => {
  assert.equal(jsonBytes('é'), 4); // "\"é\"" = 1 + 2 + 1
});
