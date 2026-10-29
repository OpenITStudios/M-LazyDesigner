import type { RuntimeProjectHealth } from "@/lib/runtime/affinity";

export class RuntimeProjectContextError extends Error {
  constructor (
    message: string,
    readonly outcomeUnknown: boolean = false
  ) {
    super(message);
    this.name = "RuntimeProjectContextError";
  }
}

function runtimeProjects (): ModelProject[] {
  return typeof ModelProject !== "undefined" && Array.isArray(ModelProject.all)
    ? ModelProject.all
    : [];
}

function currentRuntimeProject (): ModelProject | null {
  return typeof Project !== "undefined" && Project ? Project : null;
}

let runtimeProjectAffinityLease: {
  previousProject: ModelProject | null;
} | null = null;

export function getRuntimeProjectHealth (
  requestedProjectUuid: string | null
): RuntimeProjectHealth {
  const projects = runtimeProjects();
  const currentProject = currentRuntimeProject();
  const leasedPreviousProject =
    runtimeProjectAffinityLease?.previousProject ?? null;
  const activeProject = runtimeProjectAffinityLease
    ? leasedPreviousProject && projects.includes(leasedPreviousProject)
      ? leasedPreviousProject
      : null
    : currentProject;
  const requestedMatches = requestedProjectUuid
    ? projects.filter((project) => project.uuid === requestedProjectUuid)
    : [];
  const boundProject = requestedMatches.length === 1 ? requestedMatches[0] : null;
  const hasSavedSource = boundProject !== null &&
    (typeof boundProject.save_path === "string" ||
     typeof boundProject.saved === "boolean");

  return {
    active_project_uuid: activeProject?.uuid ?? null,
    requested_project_uuid: requestedProjectUuid,
    // true = exactly one; false = missing; null = absent header or ambiguous.
    // An ambiguous UUID must not be treated as missing: project creation may
    // discard a binding only when the requested UUID is proven absent.
    requested_project_available: requestedProjectUuid
      ? requestedMatches.length === 1
        ? true
        : requestedMatches.length === 0 ? false : null
      : null,
    open_project_count: projects.length,
    ...(hasSavedSource && boundProject ? { requested_project: {
      uuid: boundProject.uuid,
      save_path: typeof boundProject.save_path === "string"
        ? boundProject.save_path : null,
      saved: typeof boundProject.saved === "boolean"
        ? boundProject.saved : null,
    } } : {}),
  };
}

export async function runWithRuntimeProjectAffinity<T> (
  requestedProjectUuid: string | null,
  allowProjectTransition: boolean,
  operation: () => Promise<T>
): Promise<T> {
  if (!requestedProjectUuid) return await operation();

  const projects = runtimeProjects();
  const matches = projects.filter(
    (project) => project.uuid === requestedProjectUuid
  );
  if (matches.length !== 1) {
    throw new RuntimeProjectContextError(
      matches.length === 0
        ? `Gateway-bound Blockbench project ${requestedProjectUuid} is no longer open.`
        : `Gateway-bound Blockbench project UUID ${requestedProjectUuid} matches multiple open tabs; select a unique project before continuing.`
    );
  }
  const target = matches[0]!;

  const previousProject = currentRuntimeProject();
  let switched = false;

  if (previousProject !== target) {
    if (previousProject?.locked || target.locked) {
      throw new RuntimeProjectContextError(
        `Blockbench cannot activate Gateway-bound project ${requestedProjectUuid} because the current or target project tab is locked.`
      );
    }
    let selected = false;
    try {
      selected = target.select() === true;
    } catch {
      // No authoring operation has started. Restore a partial native tab
      // selection before refusing the request.
    }
    if (!selected || currentRuntimeProject() !== target) {
      // A failing native select() can partially move to the target OR a
      // different tab. Restore any changed context, not only the target.
      // If restoration fails, subsequent operations must not assume that the
      // original editor selection survived the rejected request.
      let restored = currentRuntimeProject() === previousProject;
      if (!restored && previousProject && runtimeProjects().includes(previousProject)) {
        try {
          restored = previousProject.select() === true &&
            currentRuntimeProject() === previousProject;
        } catch { /* uncertain native selection state */ }
      }
      throw new RuntimeProjectContextError(
        restored
          ? `Blockbench could not activate Gateway-bound project ${requestedProjectUuid}.`
          : `Blockbench project selection changed during failed preflight for ${requestedProjectUuid}; inspect the active tab before retrying.`,
        !restored
      );
    }
    switched = true;
  }

  const originalTargetLocked = target.locked === true;
  const lease = { previousProject };
  runtimeProjectAffinityLease = lease;
  if (!allowProjectTransition) target.locked = true;

  try {
    let result: T;
    try {
      result = await operation();
    } catch (cause) {
      // A failed tool can already have mutated a model. If the active tab
      // drifted as well, do not let its ordinary error imply a safe retry.
      if (!allowProjectTransition && currentRuntimeProject() !== target) {
        throw new RuntimeProjectContextError(
          `Blockbench project context changed after a failed operation on Gateway-bound project ${requestedProjectUuid}; mutation outcome is unknown.`,
          true
        );
      }
      throw cause;
    }
    if (!allowProjectTransition && currentRuntimeProject() !== target) {
      throw new RuntimeProjectContextError(
        `Blockbench project context changed while Gateway-bound project ${requestedProjectUuid} was executing.`,
        true
      );
    }
    return result;
  } finally {
    const stillOpen = runtimeProjects().includes(target);
    if (!allowProjectTransition && stillOpen) {
      target.locked = originalTargetLocked;
    }

    if (runtimeProjectAffinityLease === lease) {
      runtimeProjectAffinityLease = null;
    }

    if (
      !allowProjectTransition &&
      switched &&
      previousProject &&
      runtimeProjects().includes(previousProject) &&
      currentRuntimeProject() !== previousProject
    ) {
      // Failure to restore the user's prior tab must never accompany a
      // successful result. The native operation may already have completed.
      let restored = false;
      try {
        restored = previousProject.select() === true &&
          currentRuntimeProject() === previousProject;
      } catch {
        // Convert a native editor selection failure to an explicit
        // outcome-unknown error; do not retry a possibly completed mutation.
      }
      if (!restored) {
        throw new RuntimeProjectContextError(
          `Blockbench could not restore the previous project tab after Gateway-bound project ${requestedProjectUuid}; operation outcome requires inspection.`,
          true
        );
      }
    }
  }
}