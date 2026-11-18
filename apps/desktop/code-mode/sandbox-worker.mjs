/**
 * Code Mode guest, launched exclusively by the trusted Node host with
 * Deno run --no-prompt and NO I/O permissions. Model code executes here,
 * never in the Node host, Rust CLI or Tauri/WebView process.
 *
 * The only intended capability is codemode.* via line-delimited stdio RPC.
 * The Deno permission boundary must be preserved by the operator; this file
 * does not magically make unrestricted Node or a modified Deno invocation safe.
 */
const METHODS = Object.freeze([
  "projectInfo", "inspect", "catalog", "semanticMap", "preflight", "liveSessionInfo", "liveSemanticMap", "inspectBatch", "inspectApprovedMaterial", "inspectSelectedVisualPair", "inspectCubeSurfaces",
  "inspectCubeFaceAlpha", "texturingReadiness", "inspectTexture", "inspectTextureAlpha",
  "inspectAnimation", "inspectAnimationTrack", "inspectAnimationTransformTrack", "audit",
  "newModel", "apply", "importPng", "exportPng", "exportGeometry", "exportAnimations",
]);
const MAX_LINE = 128 * 1024;
const MAX_RETURN = 32 * 1024;
const MAX_LOG = 4096;
const decoder = new TextDecoder();
const encoder = new TextEncoder();
const reader = Deno.stdin.readable.getReader();
const writer = Deno.stdout.writable.getWriter();
let buffer = "";

async function receiveLine() {
  for (;;) {
    const split = buffer.indexOf("\n");
    if (split !== -1) {
      const line = buffer.slice(0, split);
      buffer = buffer.slice(split + 1);
      return line;
    }
    if (encoder.encode(buffer).length > MAX_LINE) {
      throw new Error("CODE_MODE_GUEST_INPUT_TOO_LARGE");
    }
    const next = await reader.read();
    if (next.done) return null;
    buffer += decoder.decode(next.value, { stream: true });
  }
}
async function receiveObject() {
  const line = await receiveLine();
  if (line === null) throw new Error("CODE_MODE_GUEST_INPUT_CLOSED");
  if (encoder.encode(line).length > MAX_LINE) {
    throw new Error("CODE_MODE_GUEST_INPUT_TOO_LARGE");
  }
  const value = JSON.parse(line);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("CODE_MODE_GUEST_INPUT_INVALID");
  }
  return value;
}
async function send(value) {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string" ||
      encoder.encode(serialized).length > MAX_LINE) {
    throw new Error("CODE_MODE_GUEST_OUTPUT_TOO_LARGE");
  }
  await writer.write(encoder.encode(serialized + "\n"));
}
const waiters = new Map();
let rpcId = 0;
async function readResponses() {
  try {
    for (;;) {
      const message = await receiveObject();
      if (message.type !== "rpc_result" ||
          !Number.isSafeInteger(message.id)) {
        throw new Error("CODE_MODE_RPC_RESPONSE_INVALID");
      }
      const waiter = waiters.get(message.id);
      if (!waiter) throw new Error("CODE_MODE_RPC_RESPONSE_UNKNOWN");
      waiters.delete(message.id);
      if (message.ok === true) waiter.resolve(message.result);
      else waiter.reject(new Error(
        typeof message.code === "string"
          ? message.code.slice(0, 128) : "CODE_MODE_RPC_REJECTED",
      ));
    }
  } catch (error) {
    for (const waiter of waiters.values()) waiter.reject(error);
    waiters.clear();
  }
}

const logs = [];
let logBytes = 0;
function safeLog(...parts) {
  const line = parts.map((part) => {
    if (typeof part === "string") return part;
    try { return JSON.stringify(part); }
    catch { return "[unserializable]"; }
  }).join(" ");
  const clipped = line.slice(0, 1024);
  const count = encoder.encode(clipped).length;
  if (logs.length < 12 && logBytes + count <= MAX_LOG) {
    logs.push(clipped);
    logBytes += count;
  }
}
const capturedConsole = Object.freeze({
  log: safeLog, info: safeLog, warn: safeLog, error: safeLog,
});
function rpc(method, args) {
  const id = ++rpcId;
  if (id > 64) return Promise.reject(new Error("CODE_MODE_RPC_BUDGET_EXCEEDED"));
  return new Promise((resolve, reject) => {
    waiters.set(id, { resolve, reject });
    void send({ type: "rpc", id, method, args }).catch((error) => {
      waiters.delete(id);
      reject(error);
    });
  });
}

async function main() {
  const start = await receiveObject();
  if (start.type !== "start" || typeof start.code !== "string" ||
      encoder.encode(start.code).length > 32 * 1024) {
    throw new Error("CODE_MODE_GUEST_START_INVALID");
  }
  // Only these declared methods are bridged. No arbitrary Rust commands,
  // host file-system access or imported modules are exposed through RPC.
  const bridge = Object.create(null);
  for (const method of METHODS) {
    bridge[method] = (...args) => rpc(method, args);
  }
  bridge.initial = Object.freeze(start.initial ?? {});
  const codemode = Object.freeze(bridge);
  // Node never evals untrusted code. This compilation happens in the
  // separate Deno permission-denied process, not the host or Tauri.
  const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
  const task = new AsyncFunction("codemode", "console",
    '"use strict";\n' + start.code);
  void readResponses();
  const result = await task(codemode, capturedConsole);
  const value = result === undefined ? null : result;
  let serialized;
  try { serialized = JSON.stringify(value); }
  catch { throw new Error("CODE_MODE_RETURN_NOT_SERIALIZABLE"); }
  if (typeof serialized !== "string" ||
      encoder.encode(serialized).length > MAX_RETURN) {
    throw new Error("CODE_MODE_RETURN_TOO_LARGE");
  }
  await send({ type: "done", value: JSON.parse(serialized), logs });
}

try {
  await main();
  Deno.exit(0);
} catch (error) {
  try {
    await send({ type: "done", error: String(error?.message ?? error).slice(0, 256),
      logs });
  } catch {}
  Deno.exit(1);
}
