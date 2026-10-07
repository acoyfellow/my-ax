export const TAB_SESSION_KEY = "my-ax-session-id";
const LAST_USED_KEY = "my-ax-session-id";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type TabSessionEnvironment = {
  tab: StorageLike;
  shared: StorageLike;
  url: () => URL;
  replaceUrl: (href: string) => void;
};

function browserEnvironment(): TabSessionEnvironment | null {
  if (typeof window === "undefined" || typeof sessionStorage === "undefined" || typeof localStorage === "undefined") return null;
  return {
    tab: sessionStorage,
    shared: localStorage,
    url: () => new URL(window.location.href),
    replaceUrl: (href) => window.history.replaceState(window.history.state, "", href),
  };
}

function urlSession(env: TabSessionEnvironment): string | null {
  const id = env.url().searchParams.get("session");
  return id && id.trim() ? id.trim() : null;
}

function writeUrl(env: TabSessionEnvironment, id: string | null): void {
  const url = env.url();
  if (id) url.searchParams.set("session", id);
  else url.searchParams.delete("session");
  const next = url.pathname + url.search + url.hash;
  if (next !== env.url().pathname + env.url().search + env.url().hash) env.replaceUrl(next);
}

export function readTabSession(env: TabSessionEnvironment | null = browserEnvironment()): string | null {
  if (!env) return null;
  return urlSession(env) ?? env.tab.getItem(TAB_SESSION_KEY);
}

export function readLastUsedSession(env: TabSessionEnvironment | null = browserEnvironment()): string | null {
  if (!env) return null;
  return env.shared.getItem(LAST_USED_KEY);
}

export function writeTabSession(id: string | null, env: TabSessionEnvironment | null = browserEnvironment()): void {
  if (!env) return;
  if (id) {
    env.tab.setItem(TAB_SESSION_KEY, id);
    env.shared.setItem(LAST_USED_KEY, id);
  } else {
    env.tab.removeItem(TAB_SESSION_KEY);
  }
  writeUrl(env, id);
}

export function forgetLastUsedSession(id: string, env: TabSessionEnvironment | null = browserEnvironment()): void {
  if (!env) return;
  if (env.shared.getItem(LAST_USED_KEY) === id) env.shared.removeItem(LAST_USED_KEY);
}
