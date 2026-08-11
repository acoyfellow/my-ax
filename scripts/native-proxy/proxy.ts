import { execFileSync } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

type JsonRpcId = string | number | null;

type JsonRpcMessage = {
  id?: JsonRpcId;
};

type RequestHeaders = {
  'content-type': string;
  accept: string;
  'cf-access-token': string;
  'mcp-session-id'?: string;
};

const app = process.env.MY_AX_ORIGIN;

if (app === undefined || app === '') {
  console.error('MY_AX_ORIGIN env var required (e.g. https://ax.example.com)');
  process.exit(2);
}

const mcp = `${app.replace(/\/$/, '')}/api/mcp`;
let sessionId: string | null = null;
let buffer = '';
const inputDecoder = new StringDecoder('utf8');

function accessToken(): string {
  try {
    const token = execFileSync('cloudflared', ['access', 'token', `--app=${app}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15_000,
    }).trim();

    if (token === '') {
      throw new Error('empty token');
    }

    return token;
  } catch {
    throw new Error('my-ax Access login required. Run: cf-local recover my-ax --run');
  }
}

function writeJson(value: string): void {
  process.stdout.write(`${value}\n`);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function jsonText(value: string): string {
  JSON.parse(value);
  return value;
}

async function forward(requestBody: string): Promise<string | null> {
  const headers: RequestHeaders = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'cf-access-token': accessToken(),
  };

  if (sessionId !== null) {
    headers['mcp-session-id'] = sessionId;
  }

  const response = await fetch(mcp, {
    method: 'POST',
    headers,
    body: requestBody,
  });
  const nextSession = response.headers.get('mcp-session-id');

  if (nextSession !== null && nextSession !== '') {
    sessionId = nextSession;
  }

  const body = await response.text();

  if (!response.ok) {
    throw new Error(`my-ax MCP HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  if (body.trim() === '') {
    return null;
  }

  const contentType = response.headers.get('content-type');

  if (contentType !== null && contentType.includes('text/event-stream')) {
    const dataLine = body.split(/\r?\n/).find((line: string) => line.startsWith('data:'));

    if (dataLine === undefined) {
      return null;
    }

    const data = dataLine.slice(5).trim();
    return data === '' ? null : jsonText(data);
  }

  return jsonText(body);
}

function parseError(message: string): void {
  writeJson(
    JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message },
    }),
  );
}

function forwardingError(id: JsonRpcId, message: string): void {
  writeJson(
    JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message },
    }),
  );
}

async function handle(line: string): Promise<void> {
  if (line.trim() === '') {
    return;
  }

  let message: JsonRpcMessage;

  try {
    message = JSON.parse(line) as JsonRpcMessage;
  } catch (error) {
    parseError(errorMessage(error));
    return;
  }

  const notification = message.id === undefined || message.id === null;
  const requestId: JsonRpcId =
    message.id === undefined || message.id === null ? null : message.id;

  try {
    const response = await forward(line);

    if (!notification && response !== null) {
      writeJson(response);
    }
  } catch (error) {
    if (!notification) {
      forwardingError(requestId, errorMessage(error));
    }
  }
}

for await (const chunk of process.stdin) {
  buffer += inputDecoder.write(chunk);

  while (true) {
    const newline = buffer.indexOf('\n');

    if (newline < 0) {
      break;
    }

    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    await handle(line);
  }
}

buffer += inputDecoder.end();

if (buffer.trim() !== '') {
  await handle(buffer);
}
