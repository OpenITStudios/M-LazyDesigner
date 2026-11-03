import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { runBlender } from "@/server/publication/execute";

type FakeOutcome =
  | "success"
  | "nonzero"
  | "timeout_closed"
  | "timeout_unconfirmed"
  | "spawn_failure";

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killCalls = 0;
  constructor(private readonly outcome: FakeOutcome) { super(); }
  kill(): boolean {
    this.killCalls += 1;
    if (this.outcome === "timeout_closed") {
      queueMicrotask(() => this.emit("close", null, "SIGTERM"));
    }
    return true;
  }
}

function stubProcess(outcome: FakeOutcome): {
  process: typeof import("node:child_process");
  getChild(): FakeChild | null;
  getArgs(): string[] | null;
} {
  let child: FakeChild | null = null;
  let args: string[] | null = null;
  const process = {
    spawn(executable: string, argv: readonly string[], options: Record<string, unknown>): ChildProcess {
      if (outcome === "spawn_failure") throw new Error("executable missing");
      expect(executable).toBe("/trusted/blender");
      expect(options.shell).toBe(false);
      expect(options.cwd).toBe("/isolated/render-job");
      args = [...argv];
      child = new FakeChild(outcome);
      if (outcome === "success" || outcome === "nonzero") {
        queueMicrotask(() => {
          if (!child) return;
          child.stdout.emit("data", "LAZYDESIGNER_RENDER_OUTPUT=/isolated/render-job/output.png\n");
          child.emit("close", outcome === "success" ? 0 : 1, null);
        });
      }
      return child as unknown as ChildProcess;
    },
  } as unknown as typeof import("node:child_process");
  return { process, getChild: () => child, getArgs: () => args };
}

function run(outcome: FakeOutcome, ms = 100) {
  const fake = stubProcess(outcome);
  return {
    ...fake,
    promise: runBlender(
      fake.process, "/trusted/blender", "/isolated/render.py",
      "/isolated/job.json", "/isolated/render-job", ms, 10,
    ),
  };
}

describe("Blender worker process lifecycle", () => {
  test("success requires a close event and bounded stdout render receipt", async () => {
    const job = run("success");
    await expect(job.promise).resolves.toBeUndefined();
    expect(job.getChild()).not.toBeNull();
    expect(job.getArgs()).toEqual([
      "--background", "--factory-startup", "--disable-autoexec",
      "--python", "/isolated/render.py", "--", "/isolated/job.json",
    ]);
  });

  test("rejects launch failures and nonzero exit without claiming render", async () => {
    await expect(run("spawn_failure").promise).rejects.toThrow("PUBLICATION_BLENDER_LAUNCH_FAILED");
    await expect(run("nonzero").promise).rejects.toThrow("PUBLICATION_BLENDER_RENDER_FAILED");
  });

  test("timeout waits for confirmed process close before reporting failure", async () => {
    const job = run("timeout_closed", 12);
    await expect(job.promise).rejects.toThrow("PUBLICATION_BLENDER_TIMEOUT");
    expect(job.getChild()?.killCalls).toBe(1);
  });

  test("timeout with no close marks exit uncertain; file cleanup must not race worker", async () => {
    const job = run("timeout_unconfirmed", 12);
    await expect(job.promise).rejects.toThrow("PUBLICATION_BLENDER_EXIT_UNCONFIRMED");
    expect(job.getChild()?.killCalls).toBe(1);
    const executor = await Bun.file(new URL("../server/publication/execute.ts", import.meta.url)).text();
    expect(executor).toContain("preserveTemporaryJob = true;");
    expect(executor).toContain("if (preserveTemporaryJob)");
    expect(executor).not.toContain("fs.rmSync(workdir");
  });

  test("already aborted publication never spawns Blender or writes a PNG", async () => {
    const job = stubProcess("success");
    const controller = new AbortController();
    controller.abort();
    await expect(runBlender(
      job.process, "/trusted/blender", "/isolated/render.py",
      "/isolated/job.json", "/isolated/render-job", 1000, 10,
      controller.signal,
    )).rejects.toThrow("PUBLICATION_BLENDER_CANCELLED");
    expect(job.getChild()).toBeNull();
  });

  test("cancellation waits for confirmed child close before reporting CANCELLED", async () => {
    const job = stubProcess("timeout_closed");
    const controller = new AbortController();
    const pending = runBlender(
      job.process, "/trusted/blender", "/isolated/render.py",
      "/isolated/job.json", "/isolated/render-job", 1000, 10,
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toThrow("PUBLICATION_BLENDER_CANCELLED");
    expect(job.getChild()?.killCalls).toBe(1);
  });

  test("UI high-resolution preset remains below its strict 12MP area limit", async () => {
    const ui = await Bun.file(new URL("../ui/publicationRenderDialog.ts", import.meta.url)).text();
    expect(ui).toContain('quality === "high" ? 3200 : 2048');
    expect(3200 * 3200).toBeLessThan(12_000_000);
  });
});
