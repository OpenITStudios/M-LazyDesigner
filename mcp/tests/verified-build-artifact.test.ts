import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  VERIFIED_BUNDLE_FILENAME,
  VERIFIED_COMMAND,
  VERIFIED_PROVENANCE_FILENAME,
  VERIFIED_PACKAGE_ARTIFACT_DIR,
  VERIFIED_REPOSITORY,
  fileSha256,
  verifyVerifiedBuildArtifact,
  writeVerifiedBuildProvenance,
} from "@/scripts/operations/verified-build-artifact";

describe("verified GitHub build artifact", () => {
  test("CI provenance path is the package dist directory, not scripts/dist", () => {
    expect(VERIFIED_PACKAGE_ARTIFACT_DIR).toBe(resolve(import.meta.dir, "../dist"));
    expect(VERIFIED_PACKAGE_ARTIFACT_DIR).not.toBe(resolve(import.meta.dir, "../scripts/dist"));
  });

  test("pins exact source SHA, bundle hash, embedded build identity, verifier and toolchain", async () => {
    const root = mkdtempSync(join(tmpdir(), "lazydesigner-verified-artifact-"));
    try {
      const identity = `sha256:${"a".repeat(64)}`;
      const gitSha = "b".repeat(40);
      const bundlePath = join(root, VERIFIED_BUNDLE_FILENAME);
      await Bun.write(
        bundlePath,
        `globalThis.__LAZYDESIGNER_BUILD_ID__ = ${JSON.stringify(identity)};\nconsole.log("verified fixture");\n`
      );

      const written = await writeVerifiedBuildProvenance({
        artifact_dir: root,
        repository: VERIFIED_REPOSITORY,
        ref: "Local",
        git_sha: gitSha,
        bun_version: "1.3.14",
      });
      expect(written.path).toBe(join(root, VERIFIED_PROVENANCE_FILENAME));
      expect(written.provenance).toEqual({
        schema_version: 1,
        repository: VERIFIED_REPOSITORY,
        ref: "Local",
        git_sha: gitSha,
        verifier: VERIFIED_COMMAND,
        bun_version: "1.3.14",
        bundle_filename: VERIFIED_BUNDLE_FILENAME,
        bundle_sha256: await fileSha256(bundlePath),
        build_identity: identity,
      });

      const verified = await verifyVerifiedBuildArtifact({
        artifact_dir: root,
        expected_repository: VERIFIED_REPOSITORY,
        expected_git_sha: gitSha,
      });
      expect(verified.bundle_path).toBe(bundlePath);
      expect(verified.provenance.build_identity).toBe(identity);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("canonical CI repository is exact and pre-rename provenance is rejected", async () => {
    expect(VERIFIED_REPOSITORY).toBe("OpenITStudios/M-LazyDesigner");
    const root = mkdtempSync(join(tmpdir(), "lazydesigner-verified-repository-"));
    try {
      const identity = `sha256:${"c".repeat(64)}`;
      const sha = "d".repeat(40);
      await Bun.write(
        join(root, VERIFIED_BUNDLE_FILENAME),
        `globalThis.__LAZYDESIGNER_BUILD_ID__ = ${JSON.stringify(identity)};\n`
      );
      await writeVerifiedBuildProvenance({
        artifact_dir: root,
        repository: "MIVUBI-STD/M-LazyDesigner",
        ref: "Local",
        git_sha: sha,
        bun_version: "1.4.3",
      });
      await expect(
        verifyVerifiedBuildArtifact({
          artifact_dir: root,
          expected_repository: VERIFIED_REPOSITORY,
          expected_git_sha: sha,
        })
      ).rejects.toThrow(/repository mismatch/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects stale checkout provenance and tampered bundle bytes", async () => {
    const root = mkdtempSync(join(tmpdir(), "lazydesigner-verified-artifact-tamper-"));
    try {
      const identity = `sha256:${"c".repeat(64)}`;
      const gitSha = "d".repeat(40);
      const bundlePath = join(root, VERIFIED_BUNDLE_FILENAME);
      await Bun.write(
        bundlePath,
        `globalThis.__LAZYDESIGNER_BUILD_ID__ = ${JSON.stringify(identity)};\n`
      );
      await writeVerifiedBuildProvenance({
        artifact_dir: root,
        repository: VERIFIED_REPOSITORY,
        ref: "Local",
        git_sha: gitSha,
        bun_version: "1.3.14",
      });

      await expect(
        verifyVerifiedBuildArtifact({
          artifact_dir: root,
          expected_repository: VERIFIED_REPOSITORY,
          expected_git_sha: "e".repeat(40),
        })
      ).rejects.toThrow(/SHA mismatch/);

      await Bun.write(
        bundlePath,
        `globalThis.__LAZYDESIGNER_BUILD_ID__ = ${JSON.stringify(identity)};\nconsole.log("tampered");\n`
      );
      await expect(
        verifyVerifiedBuildArtifact({
          artifact_dir: root,
          expected_repository: VERIFIED_REPOSITORY,
          expected_git_sha: gitSha,
        })
      ).rejects.toThrow(/bundle hash mismatch/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});