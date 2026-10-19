import { isAbsolute, resolve } from "node:path";
import {
  deployArtifact,
  resolveDeployTarget,
} from "./deploy-local";
import {
  extractPluginBuildIdentity,
  MCP_BUNDLE_FILENAME,
} from "../../compatibility/build-artifact";

export const VERIFIED_BUNDLE_FILENAME = MCP_BUNDLE_FILENAME;
export const VERIFIED_PROVENANCE_FILENAME = "lazydesigner-build-provenance.json";
export const VERIFIED_REPOSITORY = "OpenITStudios/M-LazyDesigner";
// This script lives under mcp/scripts/operations. CI uploads mcp/dist/.
export const VERIFIED_PACKAGE_ARTIFACT_DIR = resolve(import.meta.dir, "../../dist");
export const VERIFIED_COMMAND = "bun run verify:mcp";

export type VerifiedBuildProvenance = {
  schema_version: 1;
  repository: string;
  ref: string;
  git_sha: string;
  verifier: string;
  bun_version: string;
  bundle_filename: string;
  bundle_sha256: string;
  build_identity: string;
};

function expectValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isGitSha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export async function fileSha256(path: string): Promise<string> {
  const file = Bun.file(path);
  expectValue(await file.exists(), `Missing verified build file: ${path}`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

export function parseVerifiedBuildProvenance(
  value: unknown
): VerifiedBuildProvenance {
  expectValue(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "Verified build provenance must be a JSON object."
  );
  const data = value as Record<string, unknown>;
  expectValue(data.schema_version === 1, "Unsupported verified build provenance schema.");
  expectValue(
    typeof data.repository === "string" && data.repository.length > 0,
    "Verified build provenance is missing repository."
  );
  expectValue(
    typeof data.ref === "string" && data.ref.length > 0,
    "Verified build provenance is missing ref."
  );
  expectValue(isGitSha(data.git_sha), "Verified build provenance has an invalid git_sha.");
  expectValue(
    data.verifier === VERIFIED_COMMAND,
    `Verified build provenance must come from ${VERIFIED_COMMAND}.`
  );
  expectValue(
    typeof data.bun_version === "string" && /^\d+\.\d+\.\d+/.test(data.bun_version),
    "Verified build provenance has an invalid Bun version."
  );
  expectValue(
    data.bundle_filename === VERIFIED_BUNDLE_FILENAME,
    `Verified build provenance must name ${VERIFIED_BUNDLE_FILENAME}.`
  );
  expectValue(
    isSha256(data.bundle_sha256),
    "Verified build provenance has an invalid bundle_sha256."
  );
  expectValue(
    typeof data.build_identity === "string" &&
      /^sha256:[0-9a-f]{64}$/.test(data.build_identity),
    "Verified build provenance has an invalid build_identity."
  );
  return data as VerifiedBuildProvenance;
}

export async function writeVerifiedBuildProvenance(options: {
  artifact_dir: string;
  repository: string;
  ref: string;
  git_sha: string;
  bun_version: string;
}): Promise<{ path: string; provenance: VerifiedBuildProvenance }> {
  expectValue(isGitSha(options.git_sha), "Cannot write provenance for an invalid git SHA.");
  expectValue(options.repository.length > 0, "Cannot write provenance without repository identity.");
  expectValue(options.ref.length > 0, "Cannot write provenance without ref identity.");

  const artifactDir = resolve(options.artifact_dir);
  const bundlePath = resolve(artifactDir, VERIFIED_BUNDLE_FILENAME);
  const bundle = Bun.file(bundlePath);
  expectValue(await bundle.exists(), `Verified bundle does not exist: ${bundlePath}`);
  const bundleText = await bundle.text();
  const provenance: VerifiedBuildProvenance = {
    schema_version: 1,
    repository: options.repository,
    ref: options.ref,
    git_sha: options.git_sha,
    verifier: VERIFIED_COMMAND,
    bun_version: options.bun_version,
    bundle_filename: VERIFIED_BUNDLE_FILENAME,
    bundle_sha256: await fileSha256(bundlePath),
    build_identity: extractPluginBuildIdentity(bundleText),
  };
  const provenancePath = resolve(artifactDir, VERIFIED_PROVENANCE_FILENAME);
  await Bun.write(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);
  return { path: provenancePath, provenance };
}

export async function verifyVerifiedBuildArtifact(options: {
  artifact_dir: string;
  expected_repository: string;
  expected_git_sha: string;
}): Promise<{
  bundle_path: string;
  provenance_path: string;
  provenance: VerifiedBuildProvenance;
}> {
  expectValue(
    isGitSha(options.expected_git_sha),
    "Expected checkout SHA must be a full lowercase 40-character Git SHA."
  );
  const artifactDir = resolve(options.artifact_dir);
  const bundlePath = resolve(artifactDir, VERIFIED_BUNDLE_FILENAME);
  const provenancePath = resolve(artifactDir, VERIFIED_PROVENANCE_FILENAME);
  const provenanceFile = Bun.file(provenancePath);
  expectValue(
    await provenanceFile.exists(),
    `Missing verified provenance file: ${provenancePath}`
  );
  const provenance = parseVerifiedBuildProvenance(await provenanceFile.json());

  expectValue(
    provenance.repository === options.expected_repository,
    `Verified artifact repository mismatch: artifact=${provenance.repository}; expected=${options.expected_repository}.`
  );
  expectValue(
    provenance.ref === "Local",
    `Verified artifact ref must be Local; artifact=${provenance.ref}.`
  );
  expectValue(
    provenance.git_sha === options.expected_git_sha,
    `Verified artifact SHA mismatch: artifact=${provenance.git_sha}; checkout=${options.expected_git_sha}.`
  );
  const actualHash = await fileSha256(bundlePath);
  expectValue(
    actualHash === provenance.bundle_sha256,
    `Verified artifact bundle hash mismatch: artifact=${provenance.bundle_sha256}; actual=${actualHash}.`
  );
  const actualIdentity = extractPluginBuildIdentity(await Bun.file(bundlePath).text());
  expectValue(
    actualIdentity === provenance.build_identity,
    `Verified artifact build identity mismatch: provenance=${provenance.build_identity}; bundle=${actualIdentity}.`
  );

  return {
    bundle_path: bundlePath,
    provenance_path: provenancePath,
    provenance,
  };
}

export async function gitHead(repoRoot: string): Promise<string> {
  const processHandle = Bun.spawn(["git", "rev-parse", "HEAD"], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
    processHandle.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`Could not resolve current Git HEAD: ${stderr.trim()}`);
  }
  const sha = stdout.trim();
  expectValue(isGitSha(sha), `Current Git HEAD is not a full SHA: ${sha}`);
  return sha;
}

async function writeCi(): Promise<void> {
  const repository = process.env.GITHUB_REPOSITORY;
  const ref = process.env.GITHUB_REF_NAME;
  const gitSha = process.env.GITHUB_SHA;
  expectValue(repository === VERIFIED_REPOSITORY, `Unexpected CI repository: ${String(repository)}.`);
  expectValue(ref === "Local", `Verified Local artifact requires GITHUB_REF_NAME=Local; got ${String(ref)}.`);
  expectValue(isGitSha(gitSha), `Invalid GITHUB_SHA: ${String(gitSha)}.`);

  const repoRoot = resolve(import.meta.dir, "../..");
  const checkoutSha = await gitHead(repoRoot);
  expectValue(
    checkoutSha === gitSha,
    `CI checkout SHA mismatch: checkout=${checkoutSha}; event=${gitSha}.`
  );
  const result = await writeVerifiedBuildProvenance({
    artifact_dir: VERIFIED_PACKAGE_ARTIFACT_DIR,
    repository,
    ref,
    git_sha: gitSha,
    bun_version: Bun.version,
  });
  console.log(`Verified build provenance: ${result.path}`);
  console.log(`git_sha: ${result.provenance.git_sha}`);
  console.log(`bundle_sha256: ${result.provenance.bundle_sha256}`);
  console.log(`build_identity: ${result.provenance.build_identity}`);
}

async function deployVerified(args: string[]): Promise<void> {
  const rawArtifactDir = args[0] ?? process.env.LAZYDESIGNER_VERIFIED_ARTIFACT_DIR;
  expectValue(
    rawArtifactDir,
    "Missing verified artifact directory. Pass it as the first argument or set LAZYDESIGNER_VERIFIED_ARTIFACT_DIR."
  );
  expectValue(
    isAbsolute(rawArtifactDir),
    "Verified artifact directory must be an absolute filesystem path."
  );
  const target = resolveDeployTarget(args[1] ? [args[1]] : [], process.env);
  const repoRoot = resolve(import.meta.dir, "../..");
  const checkoutSha = await gitHead(repoRoot);
  const verified = await verifyVerifiedBuildArtifact({
    artifact_dir: rawArtifactDir,
    expected_repository: VERIFIED_REPOSITORY,
    expected_git_sha: checkoutSha,
  });
  const receipt = await deployArtifact(verified.bundle_path, target);

  console.log("Verified LazyDesigner CI artifact deployed.");
  console.log(`source_sha: ${verified.provenance.git_sha}`);
  console.log(`bundle_sha256: ${verified.provenance.bundle_sha256}`);
  console.log(`target: ${receipt.target}`);
  console.log(`build_identity: ${receipt.build_identity}`);
  console.log(
    "Reload Blockbench/LazyDesigner, reconnect, then run the relevant live verifier. Its shared preflight owns freshness/runtime checks; use verify:stateless-local only for diagnosis when that preflight fails."
  );
}

async function main(): Promise<void> {
  const [command, ...args] = Bun.argv.slice(2);
  if (command === "write-ci") {
    await writeCi();
    return;
  }
  if (command === "deploy") {
    await deployVerified(args);
    return;
  }
  throw new Error("Usage: verified-build-artifact.ts <write-ci | deploy> [args]");
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(
      `Verified build artifact operation failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  });
}