import { describe, expect, test } from "bun:test";
import {
  acquirePublicationRenderDirectoryLease,
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

  test("cannot break an occupied or stale lease automatically", () => {
    const fs = {
      mkdirSync: () => { throw Object.assign(new Error("EEXIST"), { code: "EEXIST" }); },
      rmdirSync: () => { throw new Error("MUST_NOT_REMOVE_OTHER_OWNER"); },
    };
    expect(() => acquirePublicationRenderDirectoryLease(fs, "/renders"))
      .toThrow("PUBLICATION_RENDER_OUTPUT_DIRECTORY_BUSY");
  });
});
