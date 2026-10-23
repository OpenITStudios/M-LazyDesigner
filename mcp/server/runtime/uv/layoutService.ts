/// <reference types="blockbench-types" />

import { createUvLayoutService } from "@/lib/uv/service";
import { createTool, tools, type ToolSpec } from "@/lib/factories";
import {
  manageUvLayoutParameters,
  uvLayoutPlanRequestSchema,
  uvLayoutApplyRequestSchema,
} from "@/lib/uv/toolContract";
import {
  createBlockbenchUvApplyAdapter,
  readBlockbenchUvNativeSource,
} from "./layoutRuntime";
import { textureProductionRole } from "../../tools/texture/atlas";

/**
 * Declarative UV capability contract. Not registered until the canonical
 * documentation generator and exact-source verification can run together.
 * Module-scope imports must remain safe outside a Blockbench process.
 */
export const uvLayoutToolDocs = {
  name: "manage_uv_layout",
  description: "Plan deterministic Bedrock UV layouts or apply a previously validated plan. Planning is read-only; apply uses one native Undo transaction, rejects stale/project-mismatched plans and returns scoped invalidation evidence. A receipt is not visual approval.",
  annotations: { title: "Manage UV Layout", destructiveHint: true },
  parameters: manageUvLayoutParameters,
  branches: {
    discriminator: "operation",
    schemas: {
      plan: uvLayoutPlanRequestSchema,
      apply: uvLayoutApplyRequestSchema,
    },
  },
  status: "stable" as const,
} satisfies ToolSpec;

/**
 * Future generator-coupled registration owner; intentionally NOT called by
 * registerMcpProfile until documentation and runtime gates can be verified.
 * One service instance must survive plan -> apply; never construct per call.
 */
export function registerUvLayoutTool(): void {
  if (tools.manage_uv_layout) return;
  const service = createBlockbenchUvLayoutService();
  createTool(
    uvLayoutToolDocs.name,
    {
      ...uvLayoutToolDocs,
      async execute(args) {
        if (args.operation === "plan") {
          const { operation: _operation, ...plan } = args;
          const result = await service.plan(plan);
          return {
            content: [{ type: "text" as const, text: "UV plan prepared; no native mutation." }],
            structuredContent: result,
          };
        }
        if (args.operation === "apply") {
          const result = await service.apply({
            plan_id: args.plan_id,
            expected_source_fingerprint: args.expected_source_fingerprint,
          });
          return {
            content: [{ type: "text" as const, text: "UV plan applied; inspect and verify the mapped texture." }],
            structuredContent: result,
          };
        }
        throw new Error("Unsupported UV layout operation.");
      },
    },
    uvLayoutToolDocs.status
  );
}

export function createBlockbenchUvLayoutService() {
  return createUvLayoutService({
    readSource: readBlockbenchUvNativeSource,
    readBitmapDimensions: () => {
      const textures = Project?.textures ?? Texture.all;
      const base = textures.filter(
        (texture) =>
          textureProductionRole(texture) ===
          "base_color_candidate"
      );
      if (base.length === 0) return null;
      if (base.length !== 1) {
        throw new Error(
          "UV_AUTO_BITMAP_AMBIGUOUS: expected one base-color atlas before automatic texel-density planning."
        );
      }
      return {
        width: base[0].width,
        height: base[0].display_height,
        ...(typeof base[0].uuid === "string" && base[0].uuid.trim()
          ? { atlas_uuid: base[0].uuid }
          : {}),
      };
    },
    createApplyAdapter: createBlockbenchUvApplyAdapter,
  });
}
