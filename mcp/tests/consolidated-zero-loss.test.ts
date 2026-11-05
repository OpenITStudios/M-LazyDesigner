import { describe, expect, test } from "bun:test";
import "@/server/tools";
import { getAllToolDefinitions, tools } from "@/lib/factories";
import {
  CONSOLIDATED_EXECUTOR_ROUTES,
  getConsolidatedExecutor,
  getConsolidatedExecutors,
  getConsolidatedFamily,
} from "@/server/runtime/consolidatedRoutes";

describe("Consolidated capability zero-loss contract", () => {
  test("retains every original executor definition", () => {
    const definitions = getAllToolDefinitions();

    for (const [capability, route] of Object.entries(
      CONSOLIDATED_EXECUTOR_ROUTES
    )) {
      expect(definitions[capability]).toBeDefined();
      const executors = Object.values(route.routes);
      expect(getConsolidatedExecutors(capability as keyof typeof CONSOLIDATED_EXECUTOR_ROUTES))
        .toEqual(executors);

      for (const executor of executors) {
        expect(definitions[executor]).toBeDefined();
        expect(tools[executor]).toBeDefined();
      }
    }
  });

  test("maps every declared branch to the exact retained executor", () => {
    for (const [capability, route] of Object.entries(
      CONSOLIDATED_EXECUTOR_ROUTES
    )) {
      for (const [branch, executor] of Object.entries(route.routes)) {
        expect(
          getConsolidatedExecutor(
            capability as keyof typeof CONSOLIDATED_EXECUTOR_ROUTES,
            branch
          )
        ).toBe(executor);
      }
    }
  });

  test("rejects unknown branches instead of silently choosing a weaker fallback", () => {
    expect(() =>
      getConsolidatedExecutor("manage_animation_timeline", "unknown")
    ).toThrow();
  });

  test("rejects undeclared capability identities in every consolidated accessor", () => {
    for (const invalid of [
      "__proto__", "constructor", "toString", "valueOf", "hasOwnProperty", "not_a_capability",
    ]) {
      // A TypeScript type is not runtime validation for a string from a caller.
      const candidate = invalid as keyof typeof CONSOLIDATED_EXECUTOR_ROUTES;
      expect(() => getConsolidatedExecutor(candidate, "list"))
        .toThrow("Unknown consolidated capability:");
      expect(() => getConsolidatedExecutors(candidate))
        .toThrow("Unknown consolidated capability:");
      expect(() => getConsolidatedFamily(candidate))
        .toThrow("Unknown consolidated capability:");
    }
  });

  test("rejects inherited Object.prototype names as executor branches", () => {
    for (const capability of Object.keys(CONSOLIDATED_EXECUTOR_ROUTES)) {
      for (const unregistered of [
        "__proto__", "constructor", "toString", "valueOf", "hasOwnProperty",
      ]) {
        expect(() => getConsolidatedExecutor(
          capability as keyof typeof CONSOLIDATED_EXECUTOR_ROUTES,
          unregistered
        )).toThrow("has no executor for");
      }
    }
  });
});
