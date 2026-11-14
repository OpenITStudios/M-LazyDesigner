import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fileMetadataSignature } from "./fileSignature";
export { fileMetadataSignature as contextFileSignature } from "./fileSignature";
import type { ControlAuthoringDomain, ControlContextHandle } from "./types";
import {
  semanticDependenciesForOwner,
  semanticRevisionForDependencies,
  type SemanticDependencyOwner,
} from "../development/semanticDependencies";
import type { ControlProfile } from "./referencePackage";
import {
  ANIMATION_PATH,
  MODELLING_PATH,
  TEXTURING_PATH,
} from "../context/authoring";
export {
  ANIMATION_PATH,
  MODELLING_PATH,
  TEXTURING_PATH,
} from "../context/authoring";

export const PROFILE_PATHS: Record<ControlProfile, string> = {
  PROP_FURNITURE: "docs/03-authoring/modelling/profiles/prop-furniture.md",
  VEHICLE: "docs/03-authoring/modelling/profiles/vehicle.md",
  HUMANOID: "docs/03-authoring/modelling/profiles/humanoid.md",
  CREATURE: "docs/03-authoring/modelling/profiles/creature.md",
  MECHANICAL: "docs/03-authoring/modelling/profiles/mechanical.md",
  PLANT_FOLIAGE: "docs/03-authoring/modelling/profiles/plant-foliage.md",
  GENERIC: "docs/03-authoring/modelling/profiles/generic.md",
};

type CachedHandle = {
  signature: string;
  handle: ControlContextHandle;
};

export type ContextResolutionIssue = {
  path: string;
  code: "CONTEXT_FILE_MISSING" | "CONTEXT_FILE_UNREADABLE";
};

const contextHandleCache = new Map<string, CachedHandle>();

function semanticOwnerForPath(path: string): SemanticDependencyOwner {
  if (
    path === MODELLING_PATH ||
    path === TEXTURING_PATH ||
    path === ANIMATION_PATH
  ) {
    return "AUTHORING_SPECIALIST";
  }
  if (Object.values(PROFILE_PATHS).includes(path)) {
    return "MODELLING_PROFILE";
  }
  return "GENERIC_CONTEXT";
}

function contextLabel(path: string): string {
  if (path === MODELLING_PATH) return "skill/modelling";
  if (path === TEXTURING_PATH) return "skill/texturing";
  if (path === ANIMATION_PATH) return "skill/animation";
  const profile = Object.entries(PROFILE_PATHS).find(([, candidate]) => candidate === path)?.[0];
  return profile ? `profile/${profile.toLowerCase().replaceAll("_", "-")}` : "doc/context";
}

function repoFile(path: string): URL {
  // Bun compile stores modules in a virtual root; packaged contexts live beside
  // the immutable managed executable, independently of the caller's cwd.
  if (/(?:^|[\\/])(?:~BUN|\$bunfs)[\\/]/.test(fileURLToPath(import.meta.url))) {
    return pathToFileURL(join(dirname(process.execPath), path));
  }
  return new URL(`../../../${path}`, import.meta.url);
}

// Only the canonical packaged authoring specialist and selected profile can
// enter the client-facing status content. Never read a caller-provided path.
const DELIVERABLE_AUTHORING_CONTEXT_PATHS = new Set([
  MODELLING_PATH, TEXTURING_PATH, ANIMATION_PATH, ...Object.values(PROFILE_PATHS),
]);
const MAX_AUTHORING_CONTEXT_FILE_BYTES = 48_000;

/**
 * Deliver the actual selected source bytes, not only their path/handle.
 * Read the same file location as contentHandle and require exact SHA parity
 * before placing it into an MCP response. This attests source delivery, not
 * model attention, instruction compliance or permission to mutate.
 */
export async function readRequiredAuthoringContext(
  handle: ControlContextHandle,
  file: URL = repoFile(handle.path)
): Promise<string> {
  if (!DELIVERABLE_AUTHORING_CONTEXT_PATHS.has(handle.path)) {
    throw new Error("CONTEXT_DELIVERY_PATH_NOT_ALLOWED");
  }
  if (!/^[a-f0-9]{64}$/.test(handle.sha256) ||
      !handle.id.includes(`@${handle.sha256.slice(0, 12)}.`)) {
    throw new Error("CONTEXT_DELIVERY_HANDLE_INVALID");
  }
  const bytes = await readFile(file);
  if (bytes.byteLength > MAX_AUTHORING_CONTEXT_FILE_BYTES) {
    throw new Error("CONTEXT_DELIVERY_SOURCE_TOO_LARGE");
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== handle.sha256) {
    throw new Error("CONTEXT_DELIVERY_SOURCE_CHANGED");
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function contentHandle(
  path: string,
  // Internal regression seam: normal Control callers use only repoFile(path).
  file: URL = repoFile(path)
): Promise<ControlContextHandle> {
  const info = await stat(file);
  const signature = fileMetadataSignature(info);
  const cached = contextHandleCache.get(path);
  if (cached?.signature === signature) return cached.handle;
  const bytes = await readFile(file);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const semanticDependencies = semanticDependenciesForOwner(
    semanticOwnerForPath(path)
  );
  const semanticRevision = semanticRevisionForDependencies(
    semanticDependencies
  );
  const handle: ControlContextHandle = {
    id: `ctx:${contextLabel(path)}@${sha256.slice(0, 12)}.${semanticRevision.slice(0, 12)}`,
    path,
    sha256,
    semantic_dependencies: semanticDependencies,
    semantic_revision: semanticRevision,
  };
  contextHandleCache.set(path, { signature, handle });
  return handle;
}

export async function contextForAuthoringDomain(
  domain: ControlAuthoringDomain | null,
  selectedProfile: ControlProfile | null = null,
  resolveHandle: (path: string) => Promise<ControlContextHandle> = contentHandle
): Promise<{
  required: ControlContextHandle[];
  optional: ControlContextHandle[];
  unavailable: ContextResolutionIssue[];
}> {
  const required: ControlContextHandle[] = [];
  const unavailable: ContextResolutionIssue[] = [];

  async function addRequired(path: string): Promise<void> {
    try {
      required.push(await resolveHandle(path));
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? (error as { code?: unknown }).code
        : null;
      if (code === "ENOENT" || code === "ENOTDIR") {
        unavailable.push({ path, code: "CONTEXT_FILE_MISSING" });
      } else if (code === "EACCES" || code === "EPERM" || code === "EISDIR") {
        unavailable.push({ path, code: "CONTEXT_FILE_UNREADABLE" });
      } else {
        // Do not disguise programming/integrity failures as missing guidance.
        throw error;
      }
    }
  }

  if (domain === "GEOMETRY") {
    await addRequired(MODELLING_PATH);
    if (selectedProfile) await addRequired(PROFILE_PATHS[selectedProfile]);
  } else if (domain === "TEXTURING") {
    await addRequired(TEXTURING_PATH);
  } else if (domain === "ANIMATION") {
    await addRequired(ANIMATION_PATH);
  }
  return { required, optional: [], unavailable };
}
