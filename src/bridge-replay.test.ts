import test from 'node:test';
import assert from 'node:assert/strict';
import { handleBridgeRequest, mintBridgeTicket } from './bridge';

const identity = { email: 'owner@example.com', sub: 'owner-sub' } as any;
const connector = { id:'owned', upstream:'https://upstream.invalid/mcp', description:'test', shape:'mcp', auth:{kind:'oauth-bearer', authorizationEndpoint:'https://auth.invalid/a', tokenEndpoint:'https://auth.invalid/t', resource:'https://upstream.invalid', clientId:'x'} };

test('a bridge ticket is single-use and rejects replay before a second upstream call', async () => {
  const used = new Set<string>();
  const env:any = {
    BRIDGE_JWT_SECRET: btoa('01234567890123456789012345678901'),
    BUILTIN_CONNECTORS_JSON: JSON.stringify({owned: connector}),
    DB: {
      prepare: (sql:string) => ({ bind: (...values:unknown[]) => ({ sql, values }) }),
      batch: async (statements:Array<{sql:string; values:unknown[]}>) => {
        const insert = statements.find((statement) => statement.sql.startsWith('INSERT'))!;
        const jti = insert.values[0] as string;
        if (used.has(jti)) throw new Error('UNIQUE constraint failed: bridge_ticket_uses.jti');
        used.add(jti);
      },
    },
  };
  const oauth:any = { listUserMcps: async()=>[], getValidAccessToken: async()=> 'token' };
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async () => { upstreamCalls++; return new Response('{}', {status:200}); };
  try {
    const ticket = await mintBridgeTicket(env, { identity, sessionId:'session-1', connectorId:'owned' });
    const request = () => new Request('https://app.invalid/bridge/owned', {method:'POST', headers:{authorization:`Bearer ${ticket}`}, body:'{}'});
    assert.equal((await handleBridgeRequest(request(), env, identity, 'owned', '', oauth)).status, 200);
    assert.equal((await handleBridgeRequest(request(), env, identity, 'owned', '', oauth)).status, 401);
    assert.equal(upstreamCalls, 1);
  } finally { globalThis.fetch = originalFetch; }
});
