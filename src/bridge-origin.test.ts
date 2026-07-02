import { test } from 'node:test';
import assert from 'node:assert';
import { resolveBridgeOrigin } from './bridge-origin';

test('blank/invalid returns null (lenient path yields "" origin, no throw)', () => {
  assert.equal(resolveBridgeOrigin(''), null);
  assert.equal(resolveBridgeOrigin('   '), null);
  assert.equal(resolveBridgeOrigin(undefined), null);
});
test('absolute URL resolves to origin', () => {
  assert.equal(resolveBridgeOrigin('https://example.com'), 'https://example.com');
  assert.equal(resolveBridgeOrigin('https://example.com/foo'), 'https://example.com');
});
test('bare host gets https:// and resolves', () => {
  assert.equal(resolveBridgeOrigin('example.com'), 'https://example.com');
});
