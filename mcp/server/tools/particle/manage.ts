/// <reference types="blockbench-types" />
import { z } from "zod";
import { particleMutationReceipt } from "@/lib/receipts/particleMutation";
import { createTool, type ToolSpec } from "@/lib/factories";
import { STATUS_EXPERIMENTAL } from "@/lib/constants";
import { isAbsoluteFilesystemPath } from "@/lib/core/path";
import {
  BEDROCK_PARTICLE_PRESETS,
  applyParticleOperations,
  createParticleDocument,
  inspectParticleDocument,
  isBedrockParticleIdentifier,
  serializeParticleDocument,
  type JsonValue,
} from "@/lib/particle/document";
import {
  isCanonicalParticleTextureReference,
  particleTextureOutputMatchesReference,
} from "@/lib/particle/resourceLayout";
import {
  allowParticleReplaceForExplicitSource,
  particleSourceContentForOutput,
  writeParticleArtifactsAtomically,
  type PlannedParticleWrite,
} from "./fileTransaction";
import {
  assertGeneratedTextureReady,
  assertNativeParticlePreviewAvailable,
  boundedContent,
  compactParticleInspectResult,
  loadNativeParticlePreview,
  readParticleSource,
} from "./inspection";

const absoluteJsonPathSchema = z
  .string()
  .refine(isAbsoluteFilesystemPath, {
    message:
      "Path must be absolute: use a POSIX `/...` path, a Windows drive path such as `C:\\\\...`, or a UNC path.",
  });

const particlePathSchema = absoluteJsonPathSchema.refine(
  (value) => value.toLowerCase().endsWith(".particle.json"),
  { message: "Particle files must use the .particle.json suffix." }
);

const pngPathSchema = absoluteJsonPathSchema.refine(
  (value) => value.toLowerCase().endsWith(".png"),
  { message: "Generated particle texture output must use the .png suffix." }
);

const particleIdentifierSchema = z
  .string()
  .refine(isBedrockParticleIdentifier, {
    message: "Particle identifier must use lowercase namespace:path syntax.",
  });

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ])
);

export const PARTICLE_VALIDATION_SCOPE = {
  schema: "CURRENT_STABLE_COMPATIBILITY",
  target_version_verified: false,
  note:
    "Particle diagnostics validate the repository's current stable Bedrock compatibility catalog. They do not prove exact field/default availability for an arbitrary target Bedrock version unless separate target-version evidence is supplied.",
} as const;

function exactlyOneSourceSchema(pathSchema: z.ZodType<string>, label: string) {
  return z
    .object({
      path: pathSchema.optional(),
      content: z.string().min(2).optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
      if ((value.path === undefined) === (value.content === undefined)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Provide exactly one ${label}.path or ${label}.content.`,
        });
      }
    });
}

const particleSourceSchema = exactlyOneSourceSchema(particlePathSchema, "source");

const createParticleSchema = z
  .object({
    identifier: particleIdentifierSchema,
    preset: z
      .enum(BEDROCK_PARTICLE_PRESETS)
      .optional()
      .default("steady")
      .describe(
        "Bootstrap convenience only. Preset numeric values are editable starting points, not canonical visual or production defaults."
      ),
    material: z.string().min(1).optional(),
    texture: z.string().min(1).optional(),
  })
  .strict();

const setRenderOperationSchema = z
  .object({
    op: z.literal("set_render"),
    material: z.union([z.string().min(1), z.null()]).optional(),
    texture: z.union([z.string().min(1), z.null()]).optional(),
  })
  .strict();

const patchOperationSchema = z
  .object({
    op: z.literal("patch"),
    path: z
      .array(z.union([z.string().min(1), z.number().int().min(0)]))
      .min(1)
      .max(16)
      .describe("Path relative to particle_effect, for targeted lossless edits."),
    value: jsonValueSchema.optional(),
    remove: z.boolean().optional(),
  })
  .strict();

export const particleMutationOperationSchema = z
  .union([
    z
      .object({
        op: z.literal("set_identifier"),
        identifier: particleIdentifierSchema,
      })
      .strict(),
    setRenderOperationSchema,
    z
      .object({
        op: z.literal("set_component"),
        component: z.string().min(1),
        value: jsonValueSchema,
      })
      .strict(),
    z
      .object({
        op: z.literal("remove_component"),
        component: z.string().min(1),
      })
      .strict(),
    z
      .object({
        op: z.literal("set_curve"),
        name: z.string().min(1),
        value: jsonValueSchema,
      })
      .strict(),
    z
      .object({ op: z.literal("remove_curve"), name: z.string().min(1) })
      .strict(),
    z
      .object({
        op: z.literal("set_event"),
        name: z.string().min(1),
        value: jsonValueSchema,
      })
      .strict(),
    z
      .object({ op: z.literal("remove_event"), name: z.string().min(1) })
      .strict(),
    patchOperationSchema,
  ])
  .superRefine((operation, ctx) => {
    if (operation.op === "set_render") {
      if (
        operation.material === undefined &&
        operation.texture === undefined
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "set_render requires material and/or texture.",
        });
      }
      return;
    }
    if (operation.op === "patch") {
      if (operation.remove === true && operation.value !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["value"],
          message: "patch remove=true must omit value.",
        });
      } else if (
        operation.remove !== true &&
        operation.value === undefined
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["value"],
          message: "patch requires value unless remove=true.",
        });
      }
    }
  });

export const particleTextureDependencySchema = z.discriminatedUnion("source", [
  z
    .object({
      source: z.literal("existing"),
      texture: z
        .string()
        .min(1)
        .describe("Bedrock texture reference already available to the resource pack."),
    })
    .strict(),
  z
    .object({
      source: z.literal("vanilla"),
      texture: z
        .string()
        .min(1)
        .describe("Vanilla Bedrock texture reference reused without authoring a new bitmap."),
    })
    .strict(),
  z
    .object({
      source: z.literal("generated"),
      state: z.enum(["missing", "ready"]).optional().default("missing"),
      texture: z
        .string()
        .refine(isCanonicalParticleTextureReference, {
          message:
            "Generated particle texture references must stay under textures/particle/ and omit the .png suffix.",
        }),
      output_path: pngPathSchema.describe(
        "Absolute final PNG path. It must end with the same textures/particle/... path declared by texture."
      ),
      overwrite: z.boolean().optional().default(false),
      name: z
        .string()
        .min(1)
        .describe("Texture name passed to the existing create_texture capability."),
      width: z.number().int().min(16).max(4096).optional().default(16),
      height: z.number().int().min(16).max(4096).optional().default(16),
      transparent: z.literal(true).optional().default(true),
      description: z
        .string()
        .min(1)
        .describe("Compact visual brief for the existing Texturing paint pipeline."),
    })
    .strict(),
]);

function finalExplicitTextureReference(
  create: z.infer<typeof createParticleSchema> | undefined,
  operations: z.infer<typeof particleMutationOperationSchema>[]
): string | null {
  let texture = create?.texture ?? null;
  for (const operation of operations) {
    if (operation.op === "set_render" && operation.texture !== undefined) {
      texture = operation.texture;
    }
  }
  return texture;
}

export type ParticleTextureDependencyPlan =
  | {
      source: "existing" | "vanilla";
      texture: string;
      status: "SATISFIED";
    }
  | {
      source: "generated";
      texture: string;
      output_path: string;
      status: "SATISFIED";
    }
  | {
      source: "generated";
      texture: string;
      output_path: string;
      status: "REQUIRES_TEXTURING";
      authoring_domain: "TEXTURING";
      entry_capability: "create_texture";
      create_texture: {
        name: string;
        type: "blank";
        width: number;
        height: number;
      };
      paint_capabilities: readonly [
        "paint_fill_tool",
        "draw_shape_tool",
        "gradient_tool",
        "paint_with_brush",
        "eraser_tool",
        "paint_texture_transaction"
      ];
      finalize: {
        capability: "paint_texture_transaction";
        output: {
          path: string;
          overwrite: boolean;
        };
      };
      description: string;
      transparent: true;
      resume_capability: "manage_particle";
      resume_state: "ready";
    };

export function buildParticleTextureDependencyPlan(
  dependency: z.infer<typeof particleTextureDependencySchema> | undefined
): ParticleTextureDependencyPlan | null {
  if (!dependency) return null;
  if (dependency.source !== "generated") {
    return {
      source: dependency.source,
      texture: dependency.texture,
      status: "SATISFIED",
    };
  }
  if (dependency.state === "ready") {
    return {
      source: "generated",
      texture: dependency.texture,
      output_path: dependency.output_path,
      status: "SATISFIED",
    };
  }
  return {
    source: "generated",
    texture: dependency.texture,
    output_path: dependency.output_path,
    status: "REQUIRES_TEXTURING",
    authoring_domain: "TEXTURING",
    entry_capability: "create_texture",
    create_texture: {
      name: dependency.name,
      type: "blank",
      width: dependency.width,
      height: dependency.height,
    },
    paint_capabilities: [
      "paint_fill_tool",
      "draw_shape_tool",
      "gradient_tool",
      "paint_with_brush",
      "eraser_tool",
      "paint_texture_transaction",
    ],
    finalize: {
      capability: "paint_texture_transaction",
      output: {
        path: dependency.output_path,
        overwrite: dependency.overwrite,
      },
    },
    description: dependency.description,
    transparent: true,
    resume_capability: "manage_particle",
    resume_state: "ready",
  };
}

const outputPathSchema = <T extends z.ZodType<string>>(pathSchema: T) =>
  z
    .object({
      path: pathSchema,
      overwrite: z.boolean().optional().default(false),
    })
    .strict();

export const inspectParticleParameters = z
  .object({
    source: particleSourceSchema,
    mode: z
      .enum(["summary", "components", "full"])
      .optional()
      .default("summary"),
    max_content_length: z
      .number()
      .int()
      .min(0)
      .max(2_000_000)
      .optional()
      .default(100_000),
  })
  .strict();

export const manageParticleParameters = z
  .object({
    source: particleSourceSchema.optional(),
    create: createParticleSchema.optional(),
    operations: z
      .array(particleMutationOperationSchema)
      .max(64)
      .optional()
      .default([])
      .describe(
        "Ordered targeted particle mutations. Use patch for deep edits without replacing unknown sibling fields."
      ),
    texture_dependency: particleTextureDependencySchema
      .optional()
      .describe(
        "Optional texture provenance/handoff metadata. New particle creation still requires an explicit final texture reference in create.texture or set_render; generated state=missing routes the bitmap dependency to existing Texturing."
      ),
    output: outputPathSchema(particlePathSchema).optional(),
    preview: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Load the resulting document through Blockbench Animator.loadParticleEmitter using an existing source path or verified output path."
      ),
    max_content_length: z.number().int().min(0).max(2_000_000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.source === undefined) === (value.create === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide exactly one source or create input.",
      });
    }

    if (
      value.create !== undefined &&
      finalExplicitTextureReference(value.create, value.operations) === null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["create", "texture"],
        message:
          "New particle creation requires an explicit texture reference in create.texture or a set_render operation. The internal bootstrap texture fallback is not production authoring authority.",
      });
    }

    if (value.texture_dependency) {
      const explicitTexture = finalExplicitTextureReference(
        value.create,
        value.operations
      );
      if (explicitTexture === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["texture_dependency", "texture"],
          message:
            "texture_dependency requires the same explicit texture reference in create.texture or a set_render operation; dependency metadata does not mutate particle JSON implicitly.",
        });
      } else if (explicitTexture !== value.texture_dependency.texture) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["texture_dependency", "texture"],
          message:
            "texture_dependency.texture must match the final explicit particle texture reference.",
        });
      }
      if (
        value.texture_dependency.source === "generated" &&
        !particleTextureOutputMatchesReference(
          value.texture_dependency.texture,
          value.texture_dependency.output_path
        )
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["texture_dependency", "output_path"],
          message:
            "Generated particle texture output_path must end with the declared textures/particle/... reference plus .png.",
        });
      }
    }
  });

export const particleToolDocs: ToolSpec[] = [
  {
    name: "inspect_particle",
    description:
      "Inspects a Bedrock .particle.json document from an absolute path or inline content. Diagnostics use the repository current-stable compatibility catalog; they do not by themselves prove exact target-version field/default availability. Defaults to compact summary diagnostics; component and full modes are explicit to keep context usage bounded.",
    annotations: {
      title: "Inspect Bedrock Particle",
      readOnlyHint: true,
      openWorldHint: true,
    },
    parameters: inspectParticleParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "manage_particle",
    description:
      "Creates or losslessly patches a Bedrock .particle.json document, preserves unknown JSON fields, validates against the repository current-stable compatibility catalog, optionally performs a verified transactional file write, and can load the particle into Blockbench's native preview. New creation requires an explicit texture reference. Missing custom particle bitmaps route through existing create_texture + paint tools and finalize through paint_texture_transaction PNG output; manage_particle never duplicates texture authoring. Downstream runtime binding remains owned by existing animation/controller tools.",
    annotations: {
      title: "Manage Bedrock Particle",
      destructiveHint: true,
      openWorldHint: true,
    },
    parameters: manageParticleParameters,
    status: STATUS_EXPERIMENTAL,
  },
];

export function registerParticleTools(): void {
  createTool(
    particleToolDocs[0].name,
    {
      ...particleToolDocs[0],
      parameters: inspectParticleParameters,
      async execute({ source, mode, max_content_length }) {
        const { document, source_path } = readParticleSource(source);
        const result = compactParticleInspectResult(
          document,
          mode,
          max_content_length
        );
        const summary = result.summary;
        return {
          content: [
            {
              type: "text" as const,
              text: `Inspected particle ${summary.identifier ?? "<missing identifier>"}: ${summary.component_count} components, ${summary.diagnostics.length} diagnostics.`,
            },
          ],
          structuredContent: {
            source_path,
            mode,
            validation_scope: PARTICLE_VALIDATION_SCOPE,
            ...result,
          },
        };
      },
    },
    particleToolDocs[0].status
  );

  createTool(
    particleToolDocs[1].name,
    {
      ...particleToolDocs[1],
      parameters: manageParticleParameters,
      async execute({
        source,
        create,
        operations,
        texture_dependency,
        output,
        preview,
        max_content_length,
      }) {
        const base = source
          ? readParticleSource(source)
          : {
              document: createParticleDocument(create!),
              source_path: null,
              source_content: null,
            };
        const document = applyParticleOperations(base.document, operations);
        const summary = inspectParticleDocument(document);
        const valid = !summary.diagnostics.some(
          (entry) => entry.severity === "error"
        );
        const textureDependency = buildParticleTextureDependencyPlan(
          texture_dependency
        );
        const textureDependencyPending =
          textureDependency?.status === "REQUIRES_TEXTURING";
        if (valid && !textureDependencyPending) {
          assertGeneratedTextureReady(textureDependency);
        }
        const artifactReady = valid && !textureDependencyPending;
        const serialized = serializeParticleDocument(document);
        const byteLength = Buffer.byteLength(serialized, "utf8");

        const intendedPreviewPath = output?.path ?? base.source_path;
        // Native preview is optional; a predictably unsafe workload must not
        // downgrade the validity or atomic persistence of authored JSON.
        const previewBudgetBlocked = preview && artifactReady &&
          summary.preview_workload.state === "blocked";
        if (preview && artifactReady) {
          if (!intendedPreviewPath) {
            throw new Error(
              "Native particle preview requires an existing source.path or output.path; inline-only documents have no stable Blockbench file identity."
            );
          }
          if (!previewBudgetBlocked) assertNativeParticlePreviewAvailable();
        }

        const writePlans: PlannedParticleWrite[] = [];
        if (output && artifactReady) {
          writePlans.push({
            kind: "particle",
            path: output.path,
            content: serialized,
            allow_replace: allowParticleReplaceForExplicitSource(
              base.source_path,
              output.path,
              output.overwrite === true
            ),
            expected_existing_content: particleSourceContentForOutput(
              base.source_path,
              base.source_content,
              output.path
            ),
          });
        }
        const writes = artifactReady ? writeParticleArtifactsAtomically(writePlans) : [];
        const particleWrite = writes.find((entry) => entry.kind === "particle");

        let previewPath: string | null = null;
        let previewError: string | null = previewBudgetBlocked
          ? "Native preview blocked by authoring budget: " + summary.preview_workload.reason
          : null;
        if (preview && artifactReady && intendedPreviewPath && !previewBudgetBlocked) {
          previewPath = intendedPreviewPath;
          try {
            loadNativeParticlePreview(previewPath, serialized);
          } catch (error) {
            previewError =
              error instanceof Error ? error.message : String(error);
          }
        }

        const effectiveMaxContentLength =
          max_content_length ?? (particleWrite ? 0 : 100_000);
        const particleContent = boundedContent(
          serialized,
          effectiveMaxContentLength
        );

        return {
          content: [
            {
              type: "text" as const,
              text: !valid
                ? `Particle ${summary.identifier ?? "<missing identifier>"} has validation errors; no file write or preview was performed.`
                : textureDependencyPending
                  ? `Particle ${summary.identifier} requires generated texture ${textureDependency.texture}; author it through existing Texturing tools, finalize the PNG with paint_texture_transaction, then resume manage_particle with texture_dependency.state=ready. No particle write or preview was performed yet.`
                  : `Prepared particle ${summary.identifier}: ${summary.component_count} components${particleWrite ? "; particle write verified" : ""}${previewPath && !previewError ? "; native preview load invoked" : ""}${previewBudgetBlocked ? "; native preview deliberately skipped by authoring budget" : previewError ? "; native preview failed after artifact preparation" : ""}.`,
            },
          ],
          structuredContent: particleMutationReceipt({
            valid,
            artifact_ready: artifactReady,
            validation_scope: PARTICLE_VALIDATION_SCOPE,
            source_path: base.source_path,
            wrote_to_path: particleWrite?.path ?? null,
            preview_path: previewPath,
            preview_error: previewError,
            preview_load_call:
              !preview ? "NOT_REQUESTED"
                : !artifactReady || previewBudgetBlocked ? "BLOCKED"
                  : previewError ? "ERROR" : "INVOKED",
            // Calling loadParticleEmitter cannot establish trigger, active
            // emitter, PNG decode, or viewport visibility.
            emitter_trigger: "UNVERIFIED",
            render_visibility: "UNVERIFIED",
            byte_length: byteLength,
            operation_count: operations.length,
            texture_dependency: textureDependency,
            animation_binding: artifactReady && summary.identifier
              ? {
                  capability: "manage_animation_effects",
                  channel: "particle",
                  effect: summary.identifier,
                  requires_explicit_time: true,
                  locator: "caller-owned explicit locator when attachment is required",
                }
              : null,
            summary,
            writes,
            ...particleContent,
          }),
        };
      },
    },
    particleToolDocs[1].status
  );
}
