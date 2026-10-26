import { describe, expect, test } from "bun:test";
import {
  resolveUniqueUuid,
  resolveUuidOrUniqueName,
} from "@/lib/core/identity";
import { resolveUniqueDestructiveElement } from "@/server/tools/element/shared";
import {
  addGroupParameters,
  hasCaseInsensitiveGroupNameCollision,
  requireFiniteTranslatedElementVector3,
} from "@/server/tools/element";

describe("Geometry identity and duplication hardening", () => {
  test("empty Group batches are rejected before a mutation can start", () => {
    expect(addGroupParameters.safeParse({ groups: [] }).success).toBe(false);
    expect(addGroupParameters.safeParse({ groups: [{ name: "root" }] }).success).toBe(true);
    expect(addGroupParameters.safeParse({ name: "root" }).success).toBe(true);
  });
  test("Group/bone collision guard is case-insensitive and supports exclusion", () => {
    const groups = [
      { uuid: "a", name: "Arm_Left" },
      { uuid: "b", name: "body" },
    ];
    expect(hasCaseInsensitiveGroupNameCollision(groups, "arm_left")).toBe(true);
    expect(hasCaseInsensitiveGroupNameCollision(groups, "ARM_LEFT", "a")).toBe(false);
    expect(hasCaseInsensitiveGroupNameCollision(groups, "head")).toBe(false);
  });

  test("UUID targeting fails closed for distinct colliding objects", () => {
    const first = { uuid: "same", name: "head" };
    const second = { uuid: "same", name: "arm" };
    const valid = { uuid: "other", name: "body" };
    const options = { kind: "Element", notFoundHint: "Inspect UUIDs." };

    expect(() => resolveUniqueUuid([first, second], "same", options))
      .toThrow('Element UUID "same" is ambiguous');
    expect(() => resolveUuidOrUniqueName([first, second], "same", options))
      .toThrow('Element UUID "same" is ambiguous');
    // A unique name is not sufficient when downstream native state uses
    // the duplicate UUID as identity.
    expect(() => resolveUuidOrUniqueName([first, second], "head", options))
      .toThrow('Element UUID "same" is ambiguous');
    expect(resolveUniqueUuid([first, valid], "other", options)).toBe(valid);
    expect(resolveUuidOrUniqueName([first, valid], "body", options)).toBe(valid);
    expect(() => resolveUniqueUuid([first], "missing", options)).toThrow("not found");
  });

  test("same object repeated across registries remains a unique target", () => {
    const item = { uuid: "shared", name: "body" };
    const other = { uuid: "other", name: "body" };
    const options = { kind: "Element", notFoundHint: "Inspect UUIDs." };
    expect(resolveUniqueUuid([item, item], "shared", options)).toBe(item);
    expect(resolveUuidOrUniqueName([item, item], "body", options)).toBe(item);
    expect(() => resolveUuidOrUniqueName([item, item, other], "body", options))
      .toThrow('Element name "body" is ambiguous');
  });

  test("destructive element routes reject UUID collisions without selection fallback", () => {
    const g = globalThis as Record<string, any>;
    const old = { Cube: g.Cube, Group: g.Group, Outliner: g.Outliner };
    class TestCube {
      constructor(public uuid: string, public name: string) {}
    }
    class TestGroup {
      static all: TestGroup[] = [];
      constructor(public uuid: string, public name: string) {}
    }
    const first = new TestCube("duplicate", "Head");
    const second = new TestCube("duplicate", "Arm");

    try {
      g.Cube = TestCube;
      g.Group = TestGroup;
      g.Outliner = { elements: [first, second] };

      expect(() => resolveUniqueDestructiveElement("duplicate"))
        .toThrow('Element UUID "duplicate" is ambiguous');
      expect(() => resolveUniqueDestructiveElement("Head"))
        .toThrow('Element UUID "duplicate" is ambiguous');

      const shared = new TestGroup("group-unique", "Body");
      TestGroup.all = [shared];
      g.Outliner = { elements: [shared] };
      expect(resolveUniqueDestructiveElement("group-unique") === (shared as unknown)).toBe(true);
      expect(resolveUniqueDestructiveElement("Body") === (shared as unknown)).toBe(true);
    } finally {
      for (const key of ["Cube", "Group", "Outliner"]) {
        if (old[key as keyof typeof old] === undefined) delete g[key];
        else g[key] = old[key as keyof typeof old];
      }
    }
  });

  test("duplicate translation guard rejects non-finite authored results", () => {
    expect(
      requireFiniteTranslatedElementVector3([1, 2, 3], [4, 5, 6], "fixture")
    ).toEqual([5, 7, 9]);
    expect(() =>
      requireFiniteTranslatedElementVector3(
        [Number.MAX_VALUE, 0, 0],
        [Number.MAX_VALUE, 0, 0],
        "fixture"
      )
    ).toThrow("non-finite authored coordinate");
  });

  test("duplicate_element delegates property fidelity to native duplication and supports anchors", async () => {
    const [source, shared] = await Promise.all([
      Bun.file("server/tools/element/mutation.ts").text(),
      Bun.file("server/tools/element/shared.ts").text(),
    ]);
    const start = source.indexOf("createTool(elementMutationToolDocs[1].name");
    const end = source.indexOf("createTool(elementMutationToolDocs[2].name", start);
    const block = source.slice(start, end);

    expect(shared).toContain("const duplicated = element.duplicate();");
    expect(shared).toContain("child instanceof Locator");
    expect(shared).toContain("child instanceof NullObject");
    expect(shared).toContain("translateDuplicatedSubtree");
    expect(shared).toContain("applyDuplicateNames");
    expect(block).toContain("duplicateFaithfully(element, offset, newName)");
    expect(block).not.toContain("function cloneCube");
    expect(block).not.toContain("function cloneGroup");
  });

  test("Group creation preflights names and anchor rename retains its guard", async () => {
    const [hierarchy, mutation] = await Promise.all([
      Bun.file("server/tools/element/hierarchy.ts").text(),
      Bun.file("server/tools/element/mutation.ts").text(),
    ]);

    const addStart = hierarchy.indexOf("createTool(elementHierarchyToolDocs[0].name");
    const addEnd = hierarchy.indexOf("createTool(elementHierarchyToolDocs[1].name", addStart);
    const addBlock = hierarchy.slice(addStart, addEnd);
    expect(addBlock.indexOf("assertBatchGroupNamesAvailable(batch)")).toBeGreaterThan(-1);
    expect(addBlock.indexOf("assertBatchGroupNamesAvailable(batch)")).toBeLessThan(
      addBlock.indexOf("Undo.initEdit")
    );

    const renameStart = mutation.indexOf("createTool(elementMutationToolDocs[2].name");
    const renameBlock = mutation.slice(renameStart);
    expect(renameBlock).toContain("assertAnchorRenameAvailable(element, new_name)");
    // Group rename preflight is exercised through the executor in batch-group-rename.test.ts.
  });

  test("public duplicate schema remains unchanged while runtime fidelity is hardened", async () => {
    const source = await Bun.file("server/tools/element/mutation.ts").text();
    const schemaStart = source.indexOf("export const duplicateElementParameters");
    const schemaEnd = source.indexOf("export const renameElementParameters", schemaStart);
    const schema = source.slice(schemaStart, schemaEnd);
    expect(schema).toContain("id: elementIdSchema");
    expect(schema).toContain("offset: finiteElementVector3Schema.optional().default([0, 0, 0])");
    expect(schema).toContain("newName:");
    expect(schema).not.toContain("mirror:");
  });
});
