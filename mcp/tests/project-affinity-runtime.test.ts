import { afterEach, describe, expect, test } from "bun:test";
import {
  RuntimeProjectContextError,
  getRuntimeProjectHealth,
  runWithRuntimeProjectAffinity,
} from "@/server/projectAffinity";

const originalProject = (globalThis as any).Project;
const originalModelProject = (globalThis as any).ModelProject;

function installProjects(activeUuid: string | null) {
  const projects: any[] = [];

  const makeProject = (uuid: string) => {
    const project: any = {
      uuid,
      name: uuid,
      selected: false,
      locked: false,
      select() {
        const current = (globalThis as any).Project;
        if (this.locked || current?.locked) return false;
        for (const candidate of projects) candidate.selected = false;
        this.selected = true;
        (globalThis as any).Project = this;
        return true;
      },
    };
    projects.push(project);
    return project;
  };

  const a = makeProject("project-a");
  const b = makeProject("project-b");
  (globalThis as any).ModelProject = { all: projects };
  (globalThis as any).Project =
    activeUuid === "project-a" ? a : activeUuid === "project-b" ? b : 0;
  if ((globalThis as any).Project) (globalThis as any).Project.selected = true;

  return { projects, a, b, makeProject };
}

afterEach(() => {
  if (originalProject === undefined) delete (globalThis as any).Project;
  else (globalThis as any).Project = originalProject;

  if (originalModelProject === undefined) delete (globalThis as any).ModelProject;
  else (globalThis as any).ModelProject = originalModelProject;
});

describe("Blockbench project affinity runtime", () => {
  test("health exposes compact active/requested project state", () => {
    installProjects("project-b");

    expect(getRuntimeProjectHealth("project-a")).toEqual({
      active_project_uuid: "project-b",
      requested_project_uuid: "project-a",
      requested_project_available: true,
      open_project_count: 2,
    });
    expect(getRuntimeProjectHealth("missing")).toEqual({
      active_project_uuid: "project-b",
      requested_project_uuid: "missing",
      requested_project_available: false,
      open_project_count: 2,
    });
  });

  test("inactive bound project is selected, locked during execution, and prior tab is restored", async () => {
    const { a, b } = installProjects("project-b");

    const result = await runWithRuntimeProjectAffinity(
      "project-a",
      false,
      async () => {
        expect((globalThis as any).Project).toBe(a);
        expect(a.locked).toBe(true);
        expect(b.select()).toBe(false);
        expect((globalThis as any).Project).toBe(a);
        expect(getRuntimeProjectHealth(null).active_project_uuid).toBe("project-b");
        return "ok";
      }
    );

    expect(result).toBe("ok");
    expect(a.locked).toBe(false);
    expect((globalThis as any).Project).toBe(b);
    expect(b.selected).toBe(true);
  });


  test("duplicated project UUID is ambiguous rather than missing and cannot select the first tab", async () => {
    const { a, b, makeProject } = installProjects("project-b");
    const duplicate = makeProject("project-a");
    expect(duplicate).not.toBe(a);
    expect(getRuntimeProjectHealth("project-a")).toEqual({
      active_project_uuid: "project-b",
      requested_project_uuid: "project-a",
      requested_project_available: null,
      open_project_count: 3,
    });
    for (const allowProjectTransition of [false, true]) {
      let executed = false;
      let error: unknown;
      try {
        await runWithRuntimeProjectAffinity("project-a", allowProjectTransition, async () => {
          executed = true;
        });
      } catch (caught) {
        error = caught;
      }
      expect(executed).toBe(false);
      expect(error).toBeInstanceOf(RuntimeProjectContextError);
      expect((error as RuntimeProjectContextError).outcomeUnknown).toBe(false);
      expect((error as Error).message).toContain("matches multiple open tabs");
      expect((globalThis as any).Project).toBe(b);
      expect(a.locked).toBe(false);
    }
  });

  test("missing bound project fails before executing the tool", async () => {
    installProjects("project-b");
    let executed = false;

    let error: unknown;
    try {
      await runWithRuntimeProjectAffinity("missing", false, async () => {
        executed = true;
      });
    } catch (caught) {
      error = caught;
    }

    expect(executed).toBe(false);
    expect(error).toBeInstanceOf(RuntimeProjectContextError);
    expect((error as Error).message).toContain("no longer open");
  });

  test("post-dispatch project drift is marked outcome-unknown instead of a safe preflight rejection", async () => {
    const { a, b } = installProjects("project-b");

    let error: unknown;
    try {
      await runWithRuntimeProjectAffinity("project-a", false, async () => {
        expect((globalThis as any).Project).toBe(a);
        (globalThis as any).Project = b;
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(RuntimeProjectContextError);
    expect((error as RuntimeProjectContextError).outcomeUnknown).toBe(true);
    expect(a.locked).toBe(false);
    expect((globalThis as any).Project).toBe(b);
  });

  test("failed project-bound operation still restores the prior tab and lock state", async () => {
    const { a, b } = installProjects("project-b");

    let error: unknown;
    try {
      await runWithRuntimeProjectAffinity("project-a", false, async () => {
        expect((globalThis as any).Project).toBe(a);
        expect(a.locked).toBe(true);
        throw new Error("fixture failure");
      });
    } catch (caught) {
      error = caught;
    }

    expect((error as Error).message).toBe("fixture failure");
    expect(a.locked).toBe(false);
    expect((globalThis as any).Project).toBe(b);
  });


  test("failed native operation plus project drift remains outcome-unknown and never looks retry-safe", async () => {
    const { a, b, makeProject } = installProjects("project-b");
    const foreign = makeProject("project-c");
    let error: unknown;
    try {
      await runWithRuntimeProjectAffinity("project-a", false, async () => {
        expect((globalThis as any).Project).toBe(a);
        (globalThis as any).Project = foreign;
        throw new Error("tool validation failure after a possible mutation");
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(RuntimeProjectContextError);
    expect((error as RuntimeProjectContextError).outcomeUnknown).toBe(true);
    expect((error as Error).message).toContain("outcome is unknown");
    expect(a.locked).toBe(false);
    expect((globalThis as any).Project).toBe(b);
  });

  test("restoration failure cannot return success after model operation completed", async () => {
    const { a, b } = installProjects("project-b");
    b.select = () => false;
    let executed = false;
    let error: unknown;
    try {
      await runWithRuntimeProjectAffinity("project-a", false, async () => {
        executed = true;
        return "operation succeeded";
      });
    } catch (caught) {
      error = caught;
    }
    expect(executed).toBe(true);
    expect(error).toBeInstanceOf(RuntimeProjectContextError);
    expect((error as RuntimeProjectContextError).outcomeUnknown).toBe(true);
    expect((globalThis as any).Project).toBe(a);
    expect(a.locked).toBe(false);
    // No stale affinity lease may disguise the actual active tab after failure.
    expect(getRuntimeProjectHealth(null).active_project_uuid).toBe("project-a");
  });

  test("failed project select with a partial tab change restores prior tab before any tool runs", async () => {
    const { a, b } = installProjects("project-b");
    const originalSelect = a.select;
    a.select = () => {
      originalSelect.call(a);
      return false;
    };
    let executed = false;
    let error: unknown;
    try {
      await runWithRuntimeProjectAffinity("project-a", false, async () => {
        executed = true;
      });
    } catch (caught) {
      error = caught;
    }
    expect(executed).toBe(false);
    expect(error).toBeInstanceOf(RuntimeProjectContextError);
    expect((error as RuntimeProjectContextError).outcomeUnknown).toBe(false);
    expect((globalThis as any).Project).toBe(b);
    expect(b.selected).toBe(true);
  });

  test("project creation may intentionally transition affinity without restoring the old tab", async () => {
    const { projects, a, makeProject } = installProjects("project-b");

    const created = await runWithRuntimeProjectAffinity(
      "project-a",
      true,
      async () => {
        expect((globalThis as any).Project).toBe(a);
        const next = makeProject("project-c");
        for (const candidate of projects) candidate.selected = false;
        next.selected = true;
        (globalThis as any).Project = next;
        return next;
      }
    );

    expect(created.uuid).toBe("project-c");
    expect((globalThis as any).Project).toBe(created);
    expect(a.locked).toBe(false);
  });
});
