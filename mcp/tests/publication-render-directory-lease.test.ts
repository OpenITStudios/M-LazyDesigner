import { describe, expect, test } from "bun:test";
import {
  acquirePublicationRenderDirectoryLease,
  acquirePublicationHandoffUseLease,
  PUBLICATION_HANDOFF_USE_LEASE_NAME,
  PUBLICATION_RENDER_LEASE_NAME,
} from "@/lib/publication/renderDirectoryLease";

describe("Cooperative directory-scoped Cycles admission", () => {
  test("two independent render owners share one atomic lease in the same output directory", () => {
    const directories = new Set<string>();
    const fs = {
      mkdirSync(path: string) {
        if (directories.has(path)) throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
        directories.add(path);
      },
      rmdirSync(path: string) {
        if (!directories.delete(path)) throw new Error("ENOENT");
      },
    };
    const releaseBlockbench = acquirePublicationRenderDirectoryLease(fs, "/renders");
    expect([...directories][0]).toContain(PUBLICATION_RENDER_LEASE_NAME);
    expect(() => acquirePublicationRenderDirectoryLease(fs, "/renders"))
      .toThrow("PUBLICATION_RENDER_OUTPUT_DIRECTORY_BUSY");
    // Separate directories have no host-wide GPU scheduling claim.
    const releaseAnotherDirectory = acquirePublicationRenderDirectoryLease(fs, "/other");
    releaseAnotherDirectory();
    releaseBlockbench();
    releaseBlockbench(); // idempotent owner release
    const releaseGateway = acquirePublicationRenderDirectoryLease(fs, "/renders");
    releaseGateway();
    expect(directories.size).toBe(0);
  });

  test("permission errors remain distinct from a busy render lease", () => {
    const fs = {
      mkdirSync: () => {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      },
      rmdirSync: () => { throw new Error("NEVER"); },
    };
    expect(() => acquirePublicationRenderDirectoryLease(fs, "/private"))
      .toThrow("EACCES");
  });


  test("handoff deletion cannot race another Gateway verifying its GLB", () => {
    const directories = new Set<string>();
    const fs = {
      mkdirSync(path: string) {
        if (directories.has(path)) {
          throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
        }
        directories.add(path);
      },
      rmdirSync(path: string) {
        if (!directories.delete(path)) throw new Error("ENOENT");
      },
    };
    const directory = "/renders/.lazydesigner-blender-handoff-" + "a".repeat(24);
    const endRead = acquirePublicationHandoffUseLease(fs, directory);
    expect([...directories][0]).toContain(PUBLICATION_HANDOFF_USE_LEASE_NAME);
    expect(() => acquirePublicationHandoffUseLease(fs, directory))
      .toThrow("PUBLICATION_BLENDER_HANDOFF_IN_USE");
    endRead();
    const endDelete = acquirePublicationHandoffUseLease(fs, directory);
    endDelete();
    expect(directories.size).toBe(0);
  });

  test("separate handoff directories remain independent; permission errors remain explicit", () => {
    const active = new Set<string>();
    const fs = {
      mkdirSync(path: string) {
        if (active.has(path)) throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
        active.add(path);
      },
      rmdirSync(path: string) { active.delete(path); },
    };
    const first = acquirePublicationHandoffUseLease(fs, "/handoff-one");
    const second = acquirePublicationHandoffUseLease(fs, "/handoff-two");
    expect(active.size).toBe(2);
    first();
    second();
    const denied = {
      ...fs,
      mkdirSync() { throw Object.assign(new Error("EACCES"), { code: "EACCES" }); },
    };
    expect(() => acquirePublicationHandoffUseLease(denied, "/private"))
      .toThrow("EACCES");
  });

  test("cannot break an occupied or stale lease automatically", () => {
    const fs = {
      mkdirSync: () => { throw Object.assign(new Error("EEXIST"), { code: "EEXIST" }); },
      rmdirSync: () => { throw new Error("MUST_NOT_REMOVE_OTHER_OWNER"); },
    };
    expect(() => acquirePublicationRenderDirectoryLease(fs, "/renders"))
      .toThrow("PUBLICATION_RENDER_OUTPUT_DIRECTORY_BUSY");
  });
});
