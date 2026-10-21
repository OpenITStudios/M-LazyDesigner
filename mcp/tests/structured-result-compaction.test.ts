import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createTool, registerToolsOnServer } from "@/lib/factories";

type CapturedToolCallback = (
  args: unknown,
  extra: unknown
) => Promise<unknown>;

function createCaptureServer() {
  const callbacks = new Map<string, CapturedToolCallback>();

  return {
    callbacks,
    server: {
      registerTool(
        name: string,
        _definition: unknown,
        callback: CapturedToolCallback
      ) {
        callbacks.set(name, callback);
      },
    },
  };
}

describe("structured MCP result compaction", () => {
  test("replaces an exact JSON mirror with a compact text summary", async () => {
    const capture = createCaptureServer();
    const payload = {
      item: { uuid: "fixture-uuid", name: "fixture" },
      content: "x".repeat(2048),
    };

    createTool(
      "structured_result_compaction_fixture",
      {
        description: "Structured result compaction fixture",
        parameters: z.object({}),
        async execute() {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(payload),
              },
            ],
            structuredContent: payload,
          };
        },
      },
      "experimental"
    );

    registerToolsOnServer(capture.server);
    const callback = capture.callbacks.get("structured_result_compaction_fixture");
    expect(callback).toBeDefined();
    if (!callback) throw new Error("Structured result fixture was not registered.");

    const result = await callback({}, {});
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "structured_result_compaction_fixture returned structured data.",
        },
      ],
      structuredContent: payload,
    });
  });

  test("compacts pretty-printed JSON mirrors without losing nested safety evidence", async () => {
    const capture = createCaptureServer();
    const payload = {
      state: "UNVERIFIED",
      warning: "UV remains incomplete; inspect before acceptance.",
      locator: "https://example.test/reference",
      details: { cubes: [1, 2, 3], count: 3 },
    };
    const mirror = JSON.stringify({
      details: payload.details,
      locator: payload.locator,
      warning: payload.warning,
      state: payload.state,
    }, null, 2);
    createTool("structured_result_pretty_mirror_fixture", {
      description: "Pretty JSON mirror fixture",
      parameters: z.object({}),
      async execute() {
        return {
          content: [{ type: "text" as const, text: mirror }],
          structuredContent: payload,
        };
      },
    }, "experimental");
    registerToolsOnServer(capture.server);
    const callback = capture.callbacks.get("structured_result_pretty_mirror_fixture");
    if (!callback) throw new Error("Pretty mirror fixture not registered");
    expect(await callback({}, {})).toEqual({
      content: [{
        type: "text",
        text: "structured_result_pretty_mirror_fixture returned structured data.",
      }],
      structuredContent: payload,
    });
  });

  test("does not serialize large structured receipts for ordinary human summaries", async () => {
    const capture = createCaptureServer();
    let serialized = 0;
    const payload = {
      revision: "accepted-by-validator-not-human",
      preview: "x".repeat(8192),
      toJSON() {
        serialized++;
        throw new Error("Redundant serialization is forbidden");
      },
    };
    createTool("structured_result_summary_no_stringify_fixture", {
      description: "Plain summary without JSON serialization",
      parameters: z.object({}),
      async execute() {
        return {
          content: [{ type: "text" as const, text: "Saved model; visual review still required." }],
          structuredContent: payload,
        };
      },
    }, "experimental");
    registerToolsOnServer(capture.server);
    const callback = capture.callbacks.get("structured_result_summary_no_stringify_fixture");
    if (!callback) throw new Error("Summary fixture not registered");
    const result = await callback({}, {}) as {
      content: unknown[];
      structuredContent?: unknown;
    };
    expect(result.content).toEqual([{
      type: "text",
      text: "Saved model; visual review still required.",
    }]);
    expect(result.structuredContent).toBe(payload);
    expect(serialized).toBe(0);
  });

  test("preserves valid but different JSON explanations and mixed media", async () => {
    const capture = createCaptureServer();
    const payload = { revision: 2, warnings: ["check seam"] };
    const explanation = JSON.stringify({
      revision: 2,
      warnings: ["check seam"],
      manual_review: "required",
    });
    const media = { type: "image" as const, data: "fixture-image", mimeType: "image/png" };
    createTool("structured_result_distinct_json_fixture", {
      description: "Distinct JSON and evidence fixture",
      parameters: z.object({}),
      async execute() {
        return {
          content: [{ type: "text" as const, text: explanation }],
          structuredContent: payload,
        };
      },
    }, "experimental");
    createTool("structured_result_multi_media_fixture", {
      description: "Mixed content evidence fixture",
      parameters: z.object({}),
      async execute() {
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(payload) },
            media,
          ],
          structuredContent: payload,
        };
      },
    }, "experimental");
    registerToolsOnServer(capture.server);
    const distinct = capture.callbacks.get("structured_result_distinct_json_fixture");
    const mixed = capture.callbacks.get("structured_result_multi_media_fixture");
    if (!distinct || !mixed) throw new Error("Result fixtures not registered");
    expect(await distinct({}, {})).toEqual({
      content: [{ type: "text", text: explanation }],
      structuredContent: payload,
    });
    expect(await mixed({}, {})).toEqual({
      content: [{ type: "text", text: JSON.stringify(payload) }, media],
      structuredContent: payload,
    });
  });

  test("preserves concise text that adds information beyond structured data", async () => {
    const capture = createCaptureServer();
    const payload = { uuid: "summary-fixture-uuid", changed: true };

    createTool(
      "structured_result_summary_fixture",
      {
        description: "Structured result summary fixture",
        parameters: z.object({}),
        async execute() {
          return {
            content: [
              {
                type: "text" as const,
                text: "Updated the requested fixture.",
              },
            ],
            structuredContent: payload,
          };
        },
      },
      "experimental"
    );

    registerToolsOnServer(capture.server);
    const callback = capture.callbacks.get("structured_result_summary_fixture");
    expect(callback).toBeDefined();
    if (!callback) throw new Error("Structured summary fixture was not registered.");

    const result = await callback({}, {});
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "Updated the requested fixture.",
        },
      ],
      structuredContent: payload,
    });
  });
});
