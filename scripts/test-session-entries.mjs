import assert from 'node:assert/strict';
import { clampEntriesLimit, pageConversationEntries, parseEntriesCursor } from '../src/session-entries.ts';

assert.equal(parseEntriesCursor(undefined), 0);
assert.equal(parseEntriesCursor('42'), 42);
assert.equal(parseEntriesCursor('-1'), null);
assert.equal(parseEntriesCursor('abc'), null);
assert.equal(clampEntriesLimit(undefined), 50);
assert.equal(clampEntriesLimit('0'), 1);
assert.equal(clampEntriesLimit('999'), 200);
const rows = [
  { id: 11, ts: 't1', role: 'user', tool: null, is_error: 0, content: 'a', meta_json: null },
  { id: 12, ts: 't2', role: 'assistant', tool: null, is_error: 0, content: 'b', meta_json: '{"x":1}' },
  { id: 13, ts: 't3', role: 'tool', tool: 'x', is_error: 1, content: null, meta_json: 'not-json' },
];
const page = pageConversationEntries(rows, 2, 10);
assert.deepEqual(page, {
  entries: [
    { id: '11', role: 'user', content: 'a', createdAt: 't1', tool: null, isError: false, meta: null },
    { id: '12', role: 'assistant', content: 'b', createdAt: 't2', tool: null, isError: false, meta: { x: 1 } },
  ],
  nextCursor: '12',
  hasMore: true,
});
console.log('session entries helpers: ok');
