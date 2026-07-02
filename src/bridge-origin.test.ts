import { test } from 'node:test';
import assert from 'node:assert';
import { resolveBridgeOrigin } from './bridge-origin.ts';

test('blank/invalid returns null (lenient path yields "" origin, no throw)', () => {
  assert.equal(resolveBridgeOrigin(''), null);
  assert.equal(resolveBridgeOrigin('   '), null);
  assert.equal(resolveBridgeOrigin(undefined), null);
});
test('absolute URL resolves to origin', () => {
  assert.equal(resolveBridgeOrigin('https://my.ax.cloudflare.dev'), 'https://my.ax.cloudflare.dev');
  assert.equal(resolveBridgeOrigin('https://my.ax.cloudflare.dev/foo'), 'https://my.ax.cloudflare.dev');
});
test('bare host gets https:// and resolves', () => {
  assert.equal(resolveBridgeOrigin('my.ax.cloudflare.dev'), 'https://my.ax.cloudflare.dev');
});
