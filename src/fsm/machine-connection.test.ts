import assert from "node:assert/strict";
import { test } from "node:test";
import { laptopAnnounced, laptopConnected, laptopDisconnected, readMachineConnection, type ConnectionStorage } from "./machine-connection";

function memoryStorage(): ConnectionStorage {
  const data = new Map<string, unknown>();
  return {
    async get<T>(key: string) { return data.get(key) as T | undefined; },
    async put(entries) { for (const [key, value] of Object.entries(entries)) data.set(key, value); },
    async delete(keys) { for (const key of keys) data.delete(key); },
  };
}

test("a reconnecting laptop does not advertise the previous laptop's tools before it says hello", async () => {
  const storage = memoryStorage();
  await laptopConnected(storage, "gen-1", "alice");
  await laptopAnnounced(storage, "gen-1", "old-mac", [{ name: "shell" }]);
  await laptopConnected(storage, "gen-2", "bob");
  assert.deepEqual(await readMachineConnection(storage), { kind: "connected", generation: "gen-2", user: "bob" });
});

test("a hello from a replaced socket is ignored", async () => {
  const storage = memoryStorage();
  await laptopConnected(storage, "gen-1", "alice");
  await laptopConnected(storage, "gen-2", "alice");
  assert.equal(await laptopAnnounced(storage, "gen-1", "stale", [{ name: "stale" }]), false);
  assert.equal((await readMachineConnection(storage)).kind, "connected");
});

test("a late close from a replaced socket keeps the newer connection", async () => {
  const storage = memoryStorage();
  await laptopConnected(storage, "gen-1", "alice");
  await laptopConnected(storage, "gen-2", "alice");
  await laptopAnnounced(storage, "gen-2", "mac", []);
  assert.equal(await laptopDisconnected(storage, "gen-1"), false);
  assert.equal((await readMachineConnection(storage)).kind, "ready");
  assert.equal(await laptopDisconnected(storage, "gen-2"), true);
  assert.deepEqual(await readMachineConnection(storage), { kind: "disconnected" });
});
