import { describe, expect, test } from "bun:test";
import { createServer as createHttpServer } from "node:http";
import createNetServer from "@/server/net";
import { runRuntimeOperationExclusive } from "@/lib/runtime/lifecycle";

describe("BlockIT pending listener shutdown", () => {
  test("closeAndWait preserves the old listener barrier until an active native operation drains", async () => {
    const server = createNetServer(
      { createServer: (options, callback) => createHttpServer(options, callback) },
      { port: 0, endpoint: "/bb-mcp", host: "127.0.0.1" }
    );
    let release!: () => void;
    let started!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    try {
      await new Promise<void>((resolve, reject) => {
        if (server.listening) return resolve();
        server.once("listening", resolve);
        server.once("error", reject);
      });
      const native = runRuntimeOperationExclusive(null, async () => {
        started();
        await blocked;
        return "completed";
      });
      await entered;
      const closing = server.closeAndWait();
      expect(server.closeAndWait()).toBe(closing);
      let closed = false;
      void closing.then(() => { closed = true; });
      await Promise.resolve();
      expect(closed).toBe(false);
      // HTTP close can finish while a native request remains in progress.
      await Promise.resolve();
      expect(closed).toBe(false);
      release();
      expect(await native).toBe("completed");
      await closing;
      expect(server.listening).toBe(false);
      expect(server.address()).toBeNull();
    } finally {
      release?.();
      await server.closeAndWait();
    }
  });


  test("closeAndWait cancels a listener even before the listening event", async () => {
    const server = createNetServer(
      { createServer: (options, callback) => createHttpServer(options, callback) },
      { port: 0, endpoint: "/bb-mcp", host: "127.0.0.1" }
    );

    await server.closeAndWait();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(server.listening).toBe(false);
    expect(server.address()).toBeNull();
  });
});