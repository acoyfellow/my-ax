import { test } from 'node:test';
import assert from 'node:assert';
import { suggestRecipeName, suggestRecipeDescription, isPortable } from './suggest-recipe-name';

test('derives a meaningful name from a leading comment', () => {
  assert.equal(suggestRecipeName('// disk health check\nreturn { ok: true };'), 'disk_health_check');
});
test('derives verb_noun from host call + returned object', () => {
  const code = 'const o = await machine.shell({command:"df"}); return { usePct: 1 };';
  assert.equal(suggestRecipeName(code), 'shell_usepct');
});
test('derives compute_<key> from a pure returned object', () => {
  assert.equal(suggestRecipeName('return { slug: "x" };'), 'compute_slug');
});
test('NEVER a bare timestamp; deterministic hash fallback', () => {
  const n = suggestRecipeName('const x=1;');
  assert.match(n, /^snippet_[a-z0-9]{1,6}$/);
  assert.doesNotMatch(n, /^WorkCodeRecipe_\d+$/);
  assert.equal(suggestRecipeName('const x=1;'), n);
});
test('portability: pure caps portable, host caps not', () => {
  assert.equal(isPortable(['workspace.none']), true);
  assert.equal(isPortable(['tweet.format']), true);
  assert.equal(isPortable(['machine.shell']), false);
  assert.equal(isPortable(['workspace.read']), false);
});
test('description mentions host cap or portability', () => {
  assert.match(suggestRecipeDescription('return { usePct: 1 };', ['machine.shell']), /via machine\.shell/);
  assert.match(suggestRecipeDescription('return { slug: 1 };', ['x.none']), /Portable/);
});
