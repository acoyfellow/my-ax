import { test } from 'node:test';
import assert from 'node:assert';
import { resolveBridgeOrigin } from './bridge-origin.ts';

test('blank/invalid returns null (lenient path yields "" origin, no throw)', () => {
  assert.equal(resolveBridgeOrigin(''), null);
  assert.equal(resolveBridgeOrigin('   '), null);
  assert.equal(resolveBridgeOrigin(undefined), null);
});
test('absolute URL resolves to origin', () => {
  assert.equal(resolveBridgeOrigin('https://<deployment-host>'), 'https://<deployment-host>');
  assert.equal(resolveBridgeOrigin('https://<deployment-host>/foo'), 'https://<deployment-host>');
});
test('bare host gets https:// and resolves', () => {
  assert.equal(resolveBridgeOrigin('<deployment-host>'), 'https://<deployment-host>');
});
