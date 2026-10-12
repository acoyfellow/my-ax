export const WORKSPACE_METHODS = [
  { name: "read", description: "Read a persistent file in the My AX Workspace." },
  { name: "write", description: "Write a persistent file in the My AX Workspace." },
  { name: "list", description: "List files in the My AX Workspace." },
  { name: "search", description: "Search workspace files with ripgrep." },
  { name: "exec", description: "Execute one bounded command in the My AX Workspace." },
  { name: "process_start", description: "Start a long-running workspace process." },
  { name: "process_status", description: "Inspect a workspace process." },
  { name: "process_logs", description: "Read workspace process logs." },
  { name: "process_cancel", description: "Cancel a workspace process." },
  { name: "run_code", description: "Run bounded JavaScript or TypeScript in the workspace interpreter." },
  { name: "preview_open", description: "Expose a workspace HTTP service through a temporary preview." },
  { name: "preview_list", description: "List active workspace previews." },
  { name: "preview_close", description: "Close a workspace preview." },
  { name: "observe", description: "See what My AX actually did in a conversation: per turn, every tool call with duration and error, the turn's final finish reason and token usage, and its status. Input: {sessionId?, turns?} for turns; {recent: true, kind?: 'step'|'workspace', sinceMinutes?} for raw events (every model step with its duration, and workspace container/restore/init/snapshot events with timings and errors). Defaults to this conversation and the last 3 turns. Check this before explaining why a turn stopped or a tool failed." },
] as const;

export const PAGE_WORK_METHODS = [
  { name: "listSessions", description: "List the owner's recent conversations: [{id,title,status,updatedAt}]. Optional {limit}." },
  { name: "listNotifications", description: "Read up to 20 owner-scoped notification items and unread summaries. Optional {limit,kind,sessionId}. Read-only." },
  { name: "readHealth", description: "Read workspace container health for the live session: {diskPct,files,version,region,...}. Prefer page.readVersion for deploy freshness." },
  { name: "readVersion", description: "Read live client vs Worker deploy: {clientId,deployedId,fresh,stale}. Fast; no sandbox." },
  { name: "readTranscriptTail", description: "Read the last N entries of the active conversation as rendered: [{role,text,ts}]. Optional {n}." },
  { name: "readViewport", description: "Read the live top-document viewport + .app-viewport frame gap: {innerWidth,innerHeight,visualHeight,visualScale,dvh,safeAreaTop,safeAreaBottom,appViewportRect,gapBelow,devicePixelRatio,userAgent,platform,uaMobile,maxTouchPoints,standalone}. Read-only." },
  { name: "setViewportDebug", description: "Toggle the on-screen viewport debug overlay in the owner's live UI (works in the installed iOS PWA where a URL query cannot). Input: {on}. Returns current viewport metrics {innerHeight,visualHeight,dvh,safeAreaBottom,appViewportBottom,gapBelow,standalone}." },
  { name: "switchSession", description: "Switch the active conversation in the owner's UI to {id}. Resolves on the client switch ack." },
  { name: "openSettings", description: "Open the settings dialog in the owner's UI, optionally to {section}." },
  { name: "openAttention", description: "Open the notifications/attention panel in the owner's UI." },
  { name: "openSessions", description: "Open the conversations sidebar in the owner's UI." },
  { name: "openTerminal", description: "Show the existing on-demand terminal card in this conversation." },
  { name: "notify", description: "Show a transient in-app toast to the owner in the live UI. Input: {text, kind?}." },
  { name: "reload", description: "Hard-reload the owner's live UI including iOS PWA (skipWaiting + cache-bust)." },
  { name: "navigate", description: "Navigate the owner's UI to an in-app deep link (/?session=<id>, /?action=attention|settings, /runs/<id>). Input: {target}." },
  { name: "listArtifactTools", description: "List tools that live artifact widgets have self-registered: [{artifactId,name,description}]. Discover them here, then call invokeArtifactTool." },
  { name: "invokeArtifactTool", description: "Invoke a tool a live artifact widget self-registered (agent-drivable UI). Input: {artifactId, name, args?}. Parent-mediated + arg-validated." },
  { name: "openDesk", description: "Open the owner's desk control board." },
  { name: "applyDeskBoard", description: "Replace the live desk panel with one owner board payload. Legacy card path; prefer deskWrite." },
  { name: "deskRead", description: "Read the owner's desk: {artifactId,state,updatedAt,updatedBy}. The desk is an app any agent can read and write." },
  { name: "deskWrite", description: "Write the owner's desk. Input: {state} as a JSON string for free-form board state, and/or {artifactId} to host an agent-authored app. Concurrent writers are merged; oversized state is refused." },
  { name: "sendToSession", description: "Send a message to one of the owner's conversations without switching to it. Input: {sessionId, content}." },
] as const;

export const CODEMODE_METHODS = [
  { name: "search", description: "List or filter codemode tools across My AX Workspace and reusable tools." },
  { name: "describe", description: "Return the description and input schema for one codemode tool by qualified name." },
  { name: "run", description: "Invoke one codemode tool or owner-approved reusable tool by name with a structured input." },
] as const;

export const FACTORY_PAGE_METHODS = PAGE_WORK_METHODS.filter((method) =>
  method.name === "listSessions" || method.name === "sendToSession" || method.name === "deskRead" || method.name === "deskWrite",
);

export const WORK_CODE_DESCRIPTION = "Execute one bounded JavaScript async function across the right place for the job. Code must be an async arrow function. The function receives ctx with {workspace,machine,page,codemode}; the same namespaces are also globals. My AX Workspace is the canonical persistent Sandbox path for files, shell commands, processes, code, and previews. My Machine methods come from work_search with their inputSchema. My AX Page methods drive the owner's live browser UI for this conversation while a tab is open. A codemode-shaped namespace is also reachable as codemode.search(query), codemode.describe(name), and codemode.run(name, input) to discover and invoke tools or owner-approved reusable tools. For multi-step, recurring, stateful, or easy-to-half-complete operational work, search codemode first and run a strong reusable-tool match by default instead of rebuilding the procedure; do not force weak matches for trivial work. Reusable-tool runs are bounded to the caller's capabilities, create receipts that carry the codemode execution id, and appear in Check-in. Reusable-tool candidates: if — and only if — the code is broadly reusable across future tasks, add exactly one leading comment `// reusable-tool: <short meaningful name>` on the first line. The owner chooses in Settings → Reusable tools whether qualifying tools wait for review or are enabled automatically. Never add the marker to one-off commands or ad-hoc scripts. No raw network, credentials, or environment is exposed. Owner-authenticated gh in My AX Workspace may file or comment only when the owner asked in this turn.";

export const WORK_SEARCH_DESCRIPTION = "Discover where My AX can do work. My AX Workspace is the canonical persistent Sandbox path for files, shell commands, processes, and previews. My Machine is the connected physical computer with local authenticated state. Search before choosing when the destination is not obvious.";
