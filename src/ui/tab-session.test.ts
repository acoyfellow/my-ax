import assert from "node:assert/strict";
import test from "node:test";
import { forgetLastUsedSession, readLastUsedSession, readTabSession, writeTabSession, type TabSessionEnvironment } from "./tab-session";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    clear: () => data.clear(),
    key: () => null,
    get length() { return data.size; },
  };
}

function tab(shared: Storage, href = "https://my.ax/"): TabSessionEnvironment & { href: () => string } {
  let current = href;
  const storage = memoryStorage();
  return {
    tab: storage,
    shared,
    url: () => new URL(current),
    replaceUrl: (next) => { current = new URL(next, current).href; },
    href: () => current,
  };
}

test("a tab reads its session from the URL first", () => {
  const env = tab(memoryStorage(), "https://my.ax/?session=abc");
  assert.equal(readTabSession(env), "abc");
});

test("writing a session puts it in the URL and the tab", () => {
  const env = tab(memoryStorage());
  writeTabSession("abc", env);
  assert.equal(env.href(), "https://my.ax/?session=abc");
  assert.equal(readTabSession(env), "abc");
});

test("two tabs keep their own session even though they share last-used", () => {
  const shared = memoryStorage();
  const first = tab(shared);
  const second = tab(shared);
  writeTabSession("first", first);
  writeTabSession("second", second);
  assert.equal(readTabSession(first), "first");
  assert.equal(readTabSession(second), "second");
  assert.equal(readLastUsedSession(first), "second");
});

test("clearing a tab session removes it from the URL but keeps last-used for new tabs", () => {
  const shared = memoryStorage();
  const env = tab(shared, "https://my.ax/?session=abc");
  writeTabSession("abc", env);
  writeTabSession(null, env);
  assert.equal(readTabSession(env), null);
  assert.equal(env.href(), "https://my.ax/");
  assert.equal(readLastUsedSession(env), "abc");
});

test("forgetting last-used only clears a matching id", () => {
  const shared = memoryStorage();
  const env = tab(shared);
  writeTabSession("abc", env);
  forgetLastUsedSession("other", env);
  assert.equal(readLastUsedSession(env), "abc");
  forgetLastUsedSession("abc", env);
  assert.equal(readLastUsedSession(env), null);
});
