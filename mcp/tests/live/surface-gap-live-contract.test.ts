import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRODUCT_ID } from "@/lib/productIdentity";
import { readRenderedModelBounds } from "@/lib/renderedModelBounds";
import { buildMcpServerInstructions } from "@/server/server";
import { getMcpSurfaceToolNames } from "@/server/tools";
import { cubeToolDocs } from "@/server/tools/cubes";
import { PROTOCOL_VERSION, type JsonObject } from "../../scripts/verify/live-e2e-common";

type Vec3 = [number, number, number];

// A scene double for import-safe contract proof, NOT a Blockbench renderer.
function fixtureCube(input: JsonObject) {
  return {
    uuid: crypto.randomUUID(),
    name: String(input.name),
    from: [...(input.from as Vec3)] as Vec3,
    to: [...(input.to as Vec3)] as Vec3,
    origin: [0, 0, 0] as Vec3,
    inflate: 0,
    visibility: true,
    mesh: {
      visible: true,
      parent: null,
      updateWorldMatrix() {},
      updateMatrixWorld() {},
      matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    },
    getGlobalVertexPositions() {
      const vertices: Vec3[] = [];
      for (const x of [this.from[0], this.to[0]]) {
        for (const y of [this.from[1], this.to[1]]) {
          for (const z of [this.from[2], this.to[2]]) vertices.push([x, y, z]);
        }
      }
      return vertices;
    },
  };
}

function installScene(cubes: ReturnType<typeof fixtureCube>[]) {
  const state = globalThis as unknown as Record<string, unknown>;
  const saved = new Map(["Cube", "Mesh", "Project"].map((key) =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const
  ));
  Object.assign(state, { Cube: { all: cubes }, Mesh: { all: [] }, Project: {} });
  return () => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete state[key];
    }
  };
}

describe("surface-gap live verifier contract (mock transport, not live proof)", () => {
  test("the actual CLI uses current initialize/tool contracts and observes covered/hidden seams", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blockit-gap-contract-"));
    const bundlePath = join(directory, "fixture.js");
    const identity = `sha256:${"1".repeat(64)}`;
    const instanceId = "fixture-instance";
    const startupTime = "2026-09-06T00:00:00.000Z";
    await Bun.write(bundlePath, `globalThis.__LAZYDESIGNER_BUILD_ID__ = "${identity}";`);
    const names = getMcpSurfaceToolNames("bedrock_entity", "geometry");
    const instructions = buildMcpServerInstructions("geometry");
    const cubes: ReturnType<typeof fixtureCube>[] = [];
    const restore = installScene(cubes);
    const calls: Array<{ name: string; args: JsonObject }> = [];
    const errors: string[] = [];
    const groupUuid = crypto.randomUUID();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        if (new URL(request.url).pathname.endsWith("/health")) {
          return Response.json({
            product: { id: PRODUCT_ID, profile: "bedrock_entity", authoring_phase: "geometry" },
            build_identity: identity,
            instance_id: instanceId,
            startup_time: startupTime,
            exposed_tool_count: names.length,
            transport: { mode: "stateless", response_mode: "auto" },
          });
        }
        const rpc = await request.json() as { id: number; method: string; params?: JsonObject };
        const reply = (result: unknown) => Response.json({ jsonrpc: "2.0", id: rpc.id, result });
        const toolReply = (result: unknown) => reply({ content: [], structuredContent: result });
        try {
          if (rpc.method === "initialize") return reply({ protocolVersion: PROTOCOL_VERSION, instructions });
          if (rpc.method === "tools/list") return reply({ tools: names.map((name) => ({ name })) });
          if (rpc.method !== "tools/call") throw new Error(`Unexpected method ${rpc.method}`);
          const name = String(rpc.params?.name);
          const args = rpc.params?.arguments as JsonObject;
          if (!names.includes(name)) throw new Error(`Unexposed tool ${name}`);
          calls.push({ name, args });
          if (name === "create_project") {
            cubes.length = 0;
            return toolReply({});
          }
          if (name === "add_group") return toolReply({ group: { uuid: groupUuid } });
          if (name === "inspect_model_bounds") return toolReply(readRenderedModelBounds());
          if (name !== "manage_cubes") throw new Error(`Unexpected tool ${name}`);
          // Validate the CLI payload with the real production schema, not a test copy.
          const parsed = cubeToolDocs[0].parameters.parse(args) as JsonObject;
          if (parsed.operation === "create") {
            const added = (parsed.elements as JsonObject[]).map(fixtureCube);
            cubes.push(...added);
            return toolReply({ cubes: added.map(({ uuid, name }) => ({ uuid, name })) });
          }
          if (parsed.operation !== "update") throw new Error("Unexpected Cube operation");
          const cube = cubes.find((item) => item.uuid === parsed.id);
          if (!cube) throw new Error("Unknown Cube UUID");
          if (parsed.from) cube.from = [...(parsed.from as Vec3)] as Vec3;
          if (parsed.to) cube.to = [...(parsed.to as Vec3)] as Vec3;
          if (typeof parsed.visibility === "boolean") cube.visibility = parsed.visibility;
          return toolReply({ execution: "applied" });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(message);
          return reply({ isError: true, content: [{ type: "text", text: message }] });
        }
      },
    });
    const run = async (consent: boolean) => {
      const child = Bun.spawn([
        process.execPath, "run", "scripts/verify/verify-surface-gap-live.ts",
        ...(consent ? ["--confirm-disposable"] : []),
      ], {
        cwd: process.cwd(),
        env: { ...process.env, LAZYDESIGNER_MCP_URL: `http://127.0.0.1:${server.port}/bb-mcp`, LAZYDESIGNER_MCP_BUNDLE: bundlePath },
        stdout: "pipe",
        stderr: "pipe",
      });
      const timeout = setTimeout(() => child.kill(), 8_000);
      try {
        const [code, stdout, stderr] = await Promise.all([
          child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
        ]);
        return { code, stdout, stderr };
      } finally {
        clearTimeout(timeout);
      }
    };
    try {
      const denied = await run(false);
      expect(denied.code).not.toBe(0);
      expect(denied.stderr).toContain("--confirm-disposable");
      expect(calls).toHaveLength(0);

      const result = await run(true);
      expect(errors).toEqual([]);
      expect(result.code, result.stderr).toBe(0);
      const receipt = JSON.parse(result.stdout);
      expect(receipt).toMatchObject({
        ok: true,
        build_identity: identity,
        warning_cleared_after_contact: true,
        warning_cleared_after_cover: true,
        warning_restored_when_cover_hidden: true,
        visual_quality: "not_evaluated",
      });
      expect(cubes).toHaveLength(3);
      expect(calls.filter(({ name }) => name === "manage_cubes")).toHaveLength(6);
      expect(cubes.every((cube) => cube.visibility)).toBe(true);
    } finally {
      await server.stop(true);
      restore();
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);

  test("scan-budget exhaustion remains visible even after the warning cap", () => {
    const cubes = Array.from({ length: 201 }, (_, index) => fixtureCube({
      name: `overlapping_${index}`, from: [-1, -1, -1], to: [1, 1, 1],
    }));
    const restore = installScene(cubes);
    try {
      const observation = readRenderedModelBounds();
      expect(observation.warnings.some((warning) => warning.includes("diagnostics stopped after 20000"))).toBe(true);
      expect(observation.warnings.some((warning) => warning.includes("warning(s) were omitted"))).toBe(true);
    } finally {
      restore();
    }
  });
});