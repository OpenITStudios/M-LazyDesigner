import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Agent as HttpAgent, createServer as createHttpServer, request as httpRequest } from "node:http";
import { createConnection, type AddressInfo } from "node:net";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createTool } from "@/lib/factories";
import createNetServer, { type NetServer } from "@/server/net"; 
import { RUNTIME_AUTH_HEADER } from "@/lib/runtime/authorization";
import { MCP_SERVER_INSTRUCTIONS } from "@/server/server";
import { readRequestEnvelope, validateMcpRoutingHeaders } from "@/server/requestProtocol";

const HOST = "127.0.0.1";
const ENDPOINT = "/bb-mcp";
// Match the current Codex legacy Streamable HTTP initialization revision.
const PROTOCOL_VERSION = "2025-06-18";
const FIXTURE_TOOL = "p1_raw_net_echo_fixture";

let server: NetServer;
let baseUrl = "";

// This transport test keeps one tiny fixture so protocol assertions stay focused.
// The full default registry is independently import-tested outside Blockbench;
// runtime-only globals such as Painter are resolved only during tool execution.
createTool(
  FIXTURE_TOOL,
  {
    description: "P1.4 raw-net protocol fixture",
    parameters: z.object({ value: z.string() }),
    async execute({ value }) {
      return value;
    },
  },
  "experimental"
);

function closedHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({
    connection: "close",
    ...extra,
  });
}

async function postMcp(
  body: unknown,
  options: {
    protocolVersion?: boolean;
    origin?: string;
  } = {}
): Promise<Response> {
  const headers = closedHeaders({
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  });
  if (options.protocolVersion) {
    headers.set("mcp-protocol-version", PROTOCOL_VERSION);
  }
  if (options.origin) {
    headers.set("origin", options.origin);
  }

  return fetch(`${baseUrl}${ENDPOINT}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function bodyJson(response: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await response.text()) as Record<string, unknown>;
}

async function rawHttpRequest(request: string): Promise<string> {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected active TCP listener.");
  }

  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const socket = createConnection({ host: HOST, port: address.port });
    const deadline = setTimeout(() => {
      socket.destroy();
      reject(new Error("Raw HTTP request did not complete."));
    }, 2500);

    const finish = (error?: Error) => {
      clearTimeout(deadline);
      if (error) reject(error);
      else resolve(Buffer.concat(chunks).toString("utf8"));
    };

    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.once("error", finish);
    socket.once("end", () => finish());
    socket.once("connect", () => socket.write(request));
  });
}

function rawHttpStatus(response: string): number {
  const match = /^HTTP\/1\.\d\s+(\d{3})\b/.exec(response);
  if (!match) {
    throw new Error(`Expected an HTTP response status line, got: ${JSON.stringify(response.slice(0, 160))}`);
  }
  return Number(match[1]);
}

function expectRawHttpFailClosed(response: string): void {
  // Node may reject malformed HTTP/1.1 framing before LazyDesigner's request
  // callback runs. An immediate close with no response bytes is still
  // fail-closed; if the request reaches our handler it must return HTTP 400.
  if (response.length === 0) return;
  expect(rawHttpStatus(response)).toBe(400);
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index] ?? 0;
}

async function measureRequestSequence(
  startId: number,
  count: number
): Promise<number[]> {
  const samples: number[] = [];

  for (let i = 0; i < count; i++) {
    const baseId = startId + i * 3;
    const started = performance.now();

    const initializeResponse = await postMcp({
      jsonrpc: "2.0",
      id: baseId,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: `p1-benchmark-${i}`, version: "1.0.0" },
      },
    });
    expect(initializeResponse.status).toBe(200);

    const listResponse = await postMcp(
      {
        jsonrpc: "2.0",
        id: baseId + 1,
        method: "tools/list",
        params: {},
      },
      { protocolVersion: true }
    );
    expect(listResponse.status).toBe(200);

    const callResponse = await postMcp(
      {
        jsonrpc: "2.0",
        id: baseId + 2,
        method: "tools/call",
        params: {
          name: FIXTURE_TOOL,
          arguments: { value: `raw-benchmark-${i}` },
        },
      },
      { protocolVersion: true }
    );
    expect(callResponse.status).toBe(200);

    samples.push(performance.now() - started);
  }

  return samples;
}

async function postMcpWithAgent(
  agent: HttpAgent,
  id: number,
  method: "initialize" | "tools/list",
  forceClose = false
): Promise<{ status: number; connection: string | undefined; result: Record<string, unknown> }> {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id,
    method,
    params: method === "initialize"
      ? { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "p1-agent-reuse", version: "1.0.0" } }
      : {},
  });

  return await new Promise((resolve, reject) => {
    const request = httpRequest(`${baseUrl}${ENDPOINT}`, {
      method: "POST",
      agent,
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "content-length": Buffer.byteLength(body),
        "mcp-protocol-version": PROTOCOL_VERSION,
        ...(forceClose ? { connection: "close" } : {}),
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.once("error", reject);
      response.once("end", () => {
        try {
          resolve({
            status: response.statusCode ?? 0,
            connection: response.headers.connection,
            result: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.once("error", reject);
    request.end(body);
  });
}

beforeAll(async () => {
  server = createNetServer(
    {
      createServer: (options, callback) => createHttpServer(options, callback),
    },
    {
      port: 0,
      endpoint: ENDPOINT,
      host: HOST,
    }
  );

  if (!server.listening) {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
  }

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected an IPv4 TCP listener for the P1.4 integration fixture.");
  }

  const tcpAddress = address as AddressInfo;
  expect(tcpAddress.address).toBe(HOST);
  baseUrl = `http://${HOST}:${tcpAddress.port}`;
});

afterAll(async () => {
  await server?.closeAndWait();
});

describe("P1.4 raw-net stateless integration", () => {
  test("listener binds to loopback and health exposes stateless auto response mode", async () => {
    const address = server.address();
    expect(address).not.toBeNull();
    expect(typeof address).not.toBe("string");
    if (!address || typeof address === "string") return;

    expect(address.address).toBe(HOST);

    const response = await fetch(`${baseUrl}${ENDPOINT}/health`, {
      headers: closedHeaders(),
    });
    expect(response.status).toBe(200);

    const body = await bodyJson(response);
    expect(body.transport).toEqual({
      mode: "stateless",
      response_mode: "auto",
    });
    expect(body).not.toHaveProperty("sessions");
  });

  test("protected Runtime rejects uncredentialed local requests before health or MCP dispatch", async () => {
    const token = "a".repeat(64);
    const guarded = createNetServer(
      { createServer: (options, callback) => createHttpServer(options, callback) },
      { port: 0, endpoint: ENDPOINT, host: HOST, authorizationToken: token }
    );
    try {
      if (!guarded.listening) {
        await new Promise<void>((resolve, reject) => {
          guarded.once("listening", resolve);
          guarded.once("error", reject);
        });
      }
      const address = guarded.address() as AddressInfo;
      const health = `http://${HOST}:${address.port}${ENDPOINT}/health`;
      const unauth = await fetch(health);
      expect(unauth.status).toBe(401);
      const wrong = await fetch(health, {
        headers: { [RUNTIME_AUTH_HEADER]: "b".repeat(64) },
      });
      expect(wrong.status).toBe(401);
      const authorized = await fetch(health, {
        headers: { [RUNTIME_AUTH_HEADER]: token },
      });
      expect(authorized.status).toBe(200);
      const mcp = await fetch(`http://${HOST}:${address.port}${ENDPOINT}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(mcp.status).toBe(401);
    } finally {
      await guarded.closeAndWait();
    }
  });

  test("outer HTTP owner rejects standalone GET and DELETE", async () => {
    const getResponse = await fetch(`${baseUrl}${ENDPOINT}`, {
      method: "GET",
      headers: closedHeaders({ accept: "text/event-stream" }),
    });
    expect(getResponse.status).toBe(405);

    const deleteResponse = await fetch(`${baseUrl}${ENDPOINT}`, {
      method: "DELETE",
      headers: closedHeaders(),
    });
    expect(deleteResponse.status).toBe(405);
  });

  test("invalid present Origin is a real HTTP 403 before MCP dispatch", async () => {
    const response = await postMcp(
      {
        jsonrpc: "2.0",
        id: 90,
        method: "initialize",
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "p1-net-fixture", version: "1.0.0" },
        },
      },
      { origin: "https://example.invalid" }
    );

    expect(response.status).toBe(403);
    const body = await bodyJson(response);
    expect((body.error as { message?: string }).message).toContain("invalid Origin");
  });

  test("HTTP/1.1 requests fail closed on missing or duplicate routing headers", async () => {
    const missingHost = await rawHttpRequest(
      `GET ${ENDPOINT}/health HTTP/1.1\r\nConnection: close\r\n\r\n`
    );
    expectRawHttpFailClosed(missingHost);

    const duplicateHost = await rawHttpRequest(
      `GET ${ENDPOINT}/health HTTP/1.1\r\nHost: ${HOST}\r\nHost: localhost\r\nConnection: close\r\n\r\n`
    );
    expectRawHttpFailClosed(duplicateHost);

    const duplicateOrigin = await rawHttpRequest(
      `GET ${ENDPOINT}/health HTTP/1.1\r\nHost: ${HOST}\r\nOrigin: http://localhost\r\nOrigin: http://127.0.0.1\r\nConnection: close\r\n\r\n`
    );
    expectRawHttpFailClosed(duplicateOrigin);
  });

  test("malformed header lines fail before MCP or health dispatch", async () => {
    const response = await rawHttpRequest(
      `GET ${ENDPOINT}/health HTTP/1.1\r\nHost: ${HOST}\r\nMalformedHeader\r\nConnection: close\r\n\r\n`
    );
    expectRawHttpFailClosed(response);
  });

  test("modern MCP routing headers fail closed when they disagree with the body", async () => {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 88,
      method: "tools/list",
      params: {},
    });
    const response = await rawHttpRequest(
      `POST ${ENDPOINT} HTTP/1.1\r\nHost: ${HOST}\r\n` +
      "Content-Type: application/json\r\n" +
      "Accept: application/json, text/event-stream\r\n" +
      "MCP-Protocol-Version: 2026-07-28\r\n" +
      "Mcp-Method: tools/call\r\n" +
      "Mcp-Name: p1_raw_net_echo_fixture\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n` +
      body
    );

    expect(rawHttpStatus(response)).toBe(400);
    expect(response).toContain('"code":-32020');
    expect(response).toContain('"id":88');
  });

  test("2026 missing routing headers fail closed while legacy clients remain accepted", async () => {
    const body = JSON.stringify({
      jsonrpc: "2.0", id: 602, method: "tools/call",
      params: {
        name: FIXTURE_TOOL, arguments: { value: "not-run" },
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    });
    for (const omitted of ["mcp-method", "mcp-name", "mcp-protocol-version"]) {
      const headers = closedHeaders({
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/call",
        "mcp-name": FIXTURE_TOOL,
      });
      headers.delete(omitted);
      const response = await fetch(`${baseUrl}${ENDPOINT}`, { method: "POST", headers, body });
      expect(response.status).toBe(400);
      const result = await bodyJson(response);
      expect((result.error as { code?: number }).code).toBe(-32020);
      expect(result.id).toBe(602);
    }
    const legacy = await postMcp({
      jsonrpc: "2.0", id: 603, method: "tools/list", params: {},
    }, { protocolVersion: true });
    expect(legacy.status).toBe(200);
  });

  test("2026 malformed _meta uses Invalid params without bypassing routing mismatch protection", () => {
    const headers = { protocolVersion: "2026-07-28", method: "tools/list", name: null };
    for (const params of [
      {},
      { _meta: {} },
      { _meta: { "io.modelcontextprotocol/protocolVersion": 17 } },
    ]) {
      const envelope = readRequestEnvelope(JSON.stringify({
        jsonrpc: "2.0", id: 710, method: "tools/list", params,
      }));
      const result = validateMcpRoutingHeaders(envelope, headers);
      expect(result).toMatchObject({ code: -32602 });
      expect(result?.message).toContain("request _meta");
    }

    const mismatch = readRequestEnvelope(JSON.stringify({
      jsonrpc: "2.0", id: 711, method: "tools/list", params: {},
    }));
    expect(validateMcpRoutingHeaders(mismatch, {
      ...headers, method: "tools/call",
    })).toMatchObject({ code: -32020 });
    const wrongVersion = readRequestEnvelope(JSON.stringify({
      jsonrpc: "2.0", id: 712, method: "tools/list",
      params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2025-11-25" } },
    }));
    expect(validateMcpRoutingHeaders(wrongVersion, headers)).toMatchObject({ code: -32020 });
  });

  test("2026 routing guard decodes Mcp-Name but refuses malformed/mismatched base64", () => {
    const envelope = readRequestEnvelope(JSON.stringify({
      jsonrpc: "2.0", id: 604, method: "tools/call",
      params: {
        name: FIXTURE_TOOL, arguments: { value: "base64" },
        _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" },
      },
    }));
    const headers = { protocolVersion: "2026-07-28", method: "tools/call" };
    expect(validateMcpRoutingHeaders(envelope, {
      ...headers, name: `=?base64?${Buffer.from(FIXTURE_TOOL).toString("base64")}?=`,
    })).toBeNull();
    expect(validateMcpRoutingHeaders(envelope, {
      ...headers, name: "=?base64?!!?=",
    })).toMatchObject({ code: -32020 });
    expect(validateMcpRoutingHeaders(envelope, {
      ...headers, name: `=?base64?${Buffer.from("another_tool").toString("base64")}?=`,
    })).toMatchObject({ code: -32020 });
  });

  test("modern 2026 POST accepts JSON or SSE representation without outer rejection", async () => {
    const response = await fetch(`${baseUrl}${ENDPOINT}`, {
      method: "POST",
      headers: {
        accept: "text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/list",
        connection: "close",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 601,
        method: "tools/list",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    });

    expect(response.status).toBe(200);
    const contentType = response.headers.get("content-type") ?? "";
    expect(
      contentType.includes("application/json") ||
        contentType.includes("text/event-stream")
    ).toBe(true);
    const body = await response.text();
    expect(body).toContain('"jsonrpc":"2.0"');
    expect(body).toContain('"id":601');
    expect(body).toContain('"tools"');
  });

  test("modern 2026 client negotiates and calls tools on the same Runtime endpoint", async () => {
    const client = new Client(
      { name: "p1-modern-net-fixture", version: "1.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } }
    );
    const transport = new StreamableHTTPClientTransport(
      new URL(`${baseUrl}${ENDPOINT}`)
    );

    try {
      await client.connect(transport);
      expect(client.getProtocolEra()).toBe("modern");

      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain(FIXTURE_TOOL);

      const result = await client.callTool({
        name: FIXTURE_TOOL,
        arguments: { value: "modern-2026-ok" },
      });
      expect(result.content).toEqual([
        { type: "text", text: "modern-2026-ok" },
      ]);
    } finally {
      await client.close();
    }
  });

  test("initialize exposes compact capability-oriented namespace instructions", async () => {
    const initializeResponse = await postMcp({
      jsonrpc: "2.0",
      id: 100,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "p1-instructions-fixture", version: "1.0.0" },
      },
    });

    expect(initializeResponse.status).toBe(200);
    const initializeBody = await bodyJson(initializeResponse);
    const result = initializeBody.result as {
      protocolVersion?: string;
      instructions?: string;
    };
    expect(result.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(result.instructions).toBe(MCP_SERVER_INSTRUCTIONS);
    expect(MCP_SERVER_INSTRUCTIONS.length).toBeLessThan(700);

    const instructions = MCP_SERVER_INSTRUCTIONS.toLowerCase();
    for (const term of [
      "bedrock",
      "cube",
      "texture",
      "pbr",
      "animation",
      "keyframe",
      "locator",
      "history",
      "export",
    ]) {
      expect(instructions).toContain(term);
    }
  });

  test("initialize, tools/list and tools/call pass through the real raw HTTP parser without sessions", async () => {
    const initializeResponse = await postMcp({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "p1-net-fixture", version: "1.0.0" },
      },
    });

    expect(initializeResponse.status).toBe(200);
    expect(initializeResponse.headers.get("mcp-session-id")).toBeNull();
    const initializeBody = await bodyJson(initializeResponse);
    expect(
      (initializeBody.result as { protocolVersion?: string }).protocolVersion
    ).toBe(PROTOCOL_VERSION);

    const listTools = async (id: number) => {
      const response = await postMcp(
        {
          jsonrpc: "2.0",
          id,
          method: "tools/list",
          params: {},
        },
        { protocolVersion: true }
      );
      const body = await bodyJson(response);
      const tools = (body.result as { tools?: Array<{ name?: string }> }).tools ?? [];
      return { response, names: tools.map((tool) => tool.name) };
    };

    const first = await listTools(2);
    const second = await listTools(3);

    expect(first.response.status).toBe(200);
    expect(second.response.status).toBe(200);
    expect(first.response.headers.get("mcp-session-id")).toBeNull();
    expect(second.response.headers.get("mcp-session-id")).toBeNull();
    expect(first.names).toContain(FIXTURE_TOOL);
    expect(second.names).toEqual(first.names);

    const callResponse = await postMcp(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: FIXTURE_TOOL,
          arguments: { value: "raw-net-ok" },
        },
      },
      { protocolVersion: true }
    );
    expect(callResponse.status).toBe(200);
    expect(callResponse.headers.get("mcp-session-id")).toBeNull();
    const callBody = await bodyJson(callResponse);
    expect(
      (callBody.result as { content?: Array<{ type?: string; text?: string }> })
        .content
    ).toEqual([{ type: "text", text: "raw-net-ok" }]);
  });

  test("fragmented headers and UTF-8 bodies are reassembled by the native HTTP owner", async () => {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected active HTTP listener.");
    }

    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 75,
      method: "tools/call",
      params: { name: FIXTURE_TOOL, arguments: { value: "fragmented ✓" } },
    });
    const header =
      `POST ${ENDPOINT} HTTP/1.1\r\nHost: ${HOST}\r\n` +
      "Content-Type: application/json\r\nAccept: application/json, text/event-stream\r\n" +
      `MCP-Protocol-Version: ${PROTOCOL_VERSION}\r\n` +
      `Content-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n`;
    const request = Buffer.from(header + body);
    const utf8Split = request.indexOf(Buffer.from("✓")) + 1;
    expect(utf8Split).toBeGreaterThan(Buffer.byteLength(header));

    const fragments = [
      request.subarray(0, 8),
      request.subarray(8, utf8Split),
      request.subarray(utf8Split),
    ];

    const response = await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const socket = createConnection({ host: HOST, port: address.port });
      let fragmentIndex = 0;
      const timers: Array<ReturnType<typeof setTimeout>> = [];
      const deadline = setTimeout(() => {
        socket.destroy();
        reject(new Error("Fragmented MCP request did not complete."));
      }, 2500);

      const cleanup = () => {
        clearTimeout(deadline);
        for (const timer of timers) clearTimeout(timer);
      };

      socket.on("data", (chunk: Buffer) => chunks.push(chunk));
      socket.once("error", (error) => {
        cleanup();
        reject(error);
      });
      socket.once("end", () => {
        cleanup();
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
      socket.once("connect", () => {
        const writeNext = () => {
          if (socket.destroyed || fragmentIndex >= fragments.length) return;
          socket.write(fragments[fragmentIndex++]);
          if (fragmentIndex < fragments.length) {
            timers.push(setTimeout(writeNext, 5));
          }
        };
        writeNext();
      });
    });

    expect(rawHttpStatus(response)).toBe(200);
    expect(response.match(/HTTP\/1\.\d /g)).toHaveLength(1);
    const payload = JSON.parse(response.slice(response.indexOf("\r\n\r\n") + 4));
    expect(payload.id).toBe(75);
    expect(payload.result.content).toEqual([{ type: "text", text: "fragmented ✓" }]);
  });

  test("active keep-alive sockets can be closed deterministically", async () => {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected active TCP listener.");
    }

    const socket = createConnection({ host: HOST, port: address.port });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });

    const responseReceived = new Promise<void>((resolve, reject) => {
      socket.once("data", () => resolve());
      socket.once("error", reject);
    });
    socket.write(
      `GET ${ENDPOINT}/health HTTP/1.1\r\nHost: ${HOST}\r\nConnection: keep-alive\r\n\r\n`
    );
    await responseReceived;
    expect(socket.destroyed).toBe(false);

    const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
    server.closeActiveSockets();
    await closed;
    expect(socket.destroyed).toBe(true);
  });

  test("finite MCP requests reuse a bounded socket and explicit close still closes", async () => {
    const agent = new HttpAgent({ keepAlive: true, maxSockets: 1 });
    const coldAgent = new HttpAgent({ keepAlive: false, maxSockets: 1 });
    let connections = 0;
    const onConnection = () => { connections += 1; };
    server.on("connection", onConnection);
    try {
      const warmDurations: number[] = [];
      for (let i = 0; i < 5; i++) {
        const started = performance.now();
        const response = await postMcpWithAgent(agent, 5000 + i, i === 0 ? "initialize" : "tools/list");
        warmDurations.push(performance.now() - started);
        expect(response.status).toBe(200);
        expect(response.result).toHaveProperty("result");
        expect(connections).toBe(1);
        expect(response.connection).not.toBe("close");
      }
      expect(connections).toBe(1);

      // Fresh sockets provide a comparable baseline without changing the
      // server protocol or adding a benchmark-only production switch.
      const coldDurations: number[] = [];
      for (let i = 0; i < 5; i++) {
        const started = performance.now();
        const response = await postMcpWithAgent(coldAgent, 5100 + i, "tools/list", true);
        coldDurations.push(performance.now() - started);
        expect(response.status).toBe(200);
        expect(connections).toBe(i + 2);
        expect(response.connection).toBe("close");
      }
      expect(connections).toBe(6);
      console.log(
        `[mcp-connection-bench] warm_p95=${percentile(warmDurations, 0.95).toFixed(2)}ms cold_p95=${percentile(coldDurations, 0.95).toFixed(2)}ms warm_sockets=1 cold_sockets=5`
      );
      // Latency differences are observations, not CI pass/fail thresholds.
    } finally {
      server.off("connection", onConnection);
      agent.destroy();
      coldAgent.destroy();
    }
  });

  test("p95 request-sequence latency remains within the transport budget", async () => {
    const samples = await measureRequestSequence(2000, 24);
    const p95 = percentile(samples, 0.95);

    console.log(`[mcp-bench] request-sequence p95=${p95.toFixed(2)}ms`);

    expect(samples).toHaveLength(24);
    expect(p95).toBeLessThanOrEqual(300);
  });
});
