'use strict';

/**
 * rdkit_cli daemon – persistent JSON-line server.
 *
 * Keeps the RDKit WASM module loaded in memory so every subsequent command
 * skips the WASM initialisation cost entirely.
 *
 * Protocol (one JSON object per newline on stdin/stdout):
 *
 *   Request:  {"id": <any>, "command": "<name>", "args": {<flag>: <value>, ...}}
 *   Response: {"id": <any>, "type": "result",  "result": {...}}
 *             {"id": <any>, "type": "error",   "error": "<msg>", "code": "<code>"}
 *   Signal:   {"type": "ready"}   – emitted once WASM is loaded
 *             {"type": "exit"}    – emitted on stdin close
 */

const { commands } = require('./cli');
const { getRDKit } = require('./wasm');

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

// Start warming up WASM immediately – this is the whole point of the daemon.
getRDKit()
  .then(() => send({ type: 'ready' }))
  .catch(err => send({ type: 'error', error: err.message, code: err.code }));

let buffer = '';
let pendingRequests = 0;
let stdinEnded = false;

function maybeExit() {
  if (stdinEnded && pendingRequests === 0) {
    send({ type: 'exit' });
    process.exit(0);
  }
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop(); // keep incomplete trailing line
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) handleRequest(trimmed);
  }
});

process.stdin.on('end', () => {
  stdinEnded = true;
  maybeExit();
});

async function handleRequest(line) {
  pendingRequests++;
  let req;
  try {
    req = JSON.parse(line);
  } catch (e) {
    send({ id: null, type: 'error', error: 'Invalid JSON: ' + e.message });
    pendingRequests--;
    maybeExit();
    return;
  }

  const { id, command, args = {} } = req;

  if (!command) {
    send({ id, type: 'error', error: 'Missing "command" field' });
    pendingRequests--;
    maybeExit();
    return;
  }

  const commandLoader = commands[command];
  if (!commandLoader) {
    send({ id, type: 'error', error: `Unknown command: '${command}'` });
    pendingRequests--;
    maybeExit();
    return;
  }

  try {
    const commandFn = commandLoader();
    const result = await commandFn(args);
    send({ id, type: 'result', result });
  } catch (e) {
    send({ id, type: 'error', error: e.message, code: e.code || null });
  } finally {
    pendingRequests--;
    maybeExit();
  }
}
