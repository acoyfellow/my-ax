import { readLastUsedSession, readTabSession, writeTabSession } from "./tab-session";

export type SessionBinding = {
  readonly followsTab: boolean;
  read(): string | null;
  lastUsed(): string | null;
  write(id: string | null): void;
};

export function tabSessionBinding(): SessionBinding {
  return {
    followsTab: true,
    read: () => readTabSession(),
    lastUsed: () => readLastUsedSession(),
    write: (id) => writeTabSession(id),
  };
}

export function fixedSessionBinding(id: string): SessionBinding {
  return {
    followsTab: false,
    read: () => id,
    lastUsed: () => id,
    write: () => {},
  };
}
