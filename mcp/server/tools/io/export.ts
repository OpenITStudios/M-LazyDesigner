/// <reference types="three" />
/// <reference types="blockbench-types" />
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  assertBedrockAnimationExportMatchesSource,
  assertCompiledBedrockGeometryIdentity,
} from "@/lib/bedrock/export/integrity";
import { createTool, type ToolSpec } from "@/lib/factories";
import { STATUS_EXPERIMENTAL, STATUS_STABLE } from "@/lib/constants";
import { isAbsoluteFilesystemPath } from "@/lib/core/path";

export const BLOCKIT_MODEL_CODEC_IDS = ["bedrock", "project"] as const;
const blockitModelCodecEnum = z.enum([...BLOCKIT_MODEL_CODEC_IDS, "bedrock_animation"]);

export const listExportFormatsParameters = z.object({});


export const exportModelParameters = z.object({
  codec_id: blockitModelCodecEnum
    .optional()
    .default("bedrock")
    .describe(
      "LazyDesigner output: `bedrock` = geometry JSON, `project` = editable `.bbmodel`, `bedrock_animation` = native AnimationCodec JSON returned as content only (no path/options)."
    ),
  options: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Optional compile options for the selected Bedrock/project codec."
    ),
  path: z
    .string()
    .refine(isAbsoluteFilesystemPath, {
      message:
        "Export path must be absolute: use a POSIX `/...` path, a Windows drive path such as `C:\\...`, or a UNC path such as `\\\\server\\share\\...`.",
    })
    .optional()
    .describe(
      "Optional absolute output path; requires Blockbench filesystem permission."
    ),
  overwrite: z
    .boolean()
    .optional()
    .describe(
      "Allow replacing an existing `.bbmodel` at `path`; Bedrock exports always refuse existing files."
    ),
  max_content_length: z
    .number()
    .int()
    .min(0)
    .max(2_000_000)
    .optional()
    .describe(
      "Max characters returned in `content`; default 0 with `path`, else 100000."
    ),
});

export const exportToolDocs: ToolSpec[] = [
  {
    name: "list_export_formats",
    description:
      "Lists native Bedrock geometry and editable project codecs plus content-only Bedrock animation compilation through AnimationCodec. Does not enumerate arbitrary registered codecs or export animation controllers.",
    annotations: {
      title: "List LazyDesigner Model Outputs",
      readOnlyHint: true,
    },
    parameters: listExportFormatsParameters,
    status: STATUS_STABLE,
  },
  {
    name: "export_model",
    description:
      "Compiles Bedrock geometry JSON or editable `.bbmodel` with verified filesystem writes. `bedrock_animation` uses native AnimationCodec for all authored clips and returns JSON content only; omit path/options and persist the returned content separately. Project overwrite requires consent; existing geometry files are refused.",
    annotations: {
      title: "Export Bedrock Model",
      destructiveHint: true,
      openWorldHint: true,
    },
    parameters: exportModelParameters,
    status: STATUS_EXPERIMENTAL,
  },
];

type BlockITCodec = {
  id?: string;
  name?: string;
  extension?: string;
  compile?: (opts?: unknown) => unknown;
  getExportOptions?: () => Record<string, unknown>;
  fileName?: () => string;
  afterSave?: (path: string) => void;
  support_partial_export?: boolean;
};

type ExportFilesystem = {
  existsSync: (path: string) => boolean;
  readdirSync: (path: string, options: { withFileTypes: true }) => Array<{
    name: string;
    isFile: () => boolean;
    isSymbolicLink: () => boolean;
  }>;
  writeFileSync: (
    path: string,
    data: string | Buffer,
    options?: { flag?: "w" | "wx" }
  ) => void;
  statSync: (path: string) => {
    isFile: () => boolean;
    size: number;
  };
  /** Optional native readback: unsupported permission must not erase a valid save. */
  readFileSync?: (path: string) => Buffer | string;
};

function requireBedrockEntityProject(): void {
  if (!Project) {
    throw new Error(
      "No project is open. Use `create_project` or open a Minecraft Bedrock Entity project first."
    );
  }

  const formatId = (Format as { id?: string } | undefined)?.id;
  if (formatId !== "bedrock") {
    throw new Error(
      `LazyDesigner model export requires the Minecraft Bedrock Entity format (bedrock); current format is ${formatId ?? "unknown"}.`
    );
  }
}


function currentExportProjectLifecycle() {
  return {
    name: Project!.name,
    uuid: Project!.uuid,
    save_path: Project!.save_path ?? null,
    export_path: Project!.export_path ?? null,
    export_codec: Project!.export_codec ?? null,
    saved: Project!.saved === true,
  };
}

function codecRegistry(): Record<string, BlockITCodec> {
  // @ts-ignore - Codecs is a Blockbench global registry.
  return Codecs as Record<string, BlockITCodec>;
}

function nativeBedrockAnimationCodec(
  onCompiled?: (evidence: ReturnType<typeof assertBedrockAnimationExportMatchesSource>) => void
): BlockITCodec | undefined {
  const native = (globalThis as unknown as {
    AnimationCodec?: { codecs?: { bedrock?: { compileFile?: (clips: unknown[]) => unknown } } };
  }).AnimationCodec?.codecs?.bedrock;
  if (typeof native?.compileFile !== "function") return undefined;
  return {
    name: "Bedrock Animations (native AnimationCodec)",
    extension: "json",
    compile() {
      const clips = (globalThis as unknown as { Animation?: { all?: unknown[] } }).Animation?.all;
      if (!Array.isArray(clips)) throw new Error("Native Animation.all is unavailable.");
      const sourceClips = clips.slice();
      const compiled = native.compileFile!(sourceClips);
      const identityEvidence = assertBedrockAnimationExportMatchesSource(sourceClips, compiled);
      onCompiled?.(identityEvidence);
      return compiled;
    },
  };
}


function filesystemFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function filesystemStem(path: string): string {
  return filesystemFileName(path).replace(/\.[^.]+$/, "");
}

function toTextContent(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw;
  if (raw instanceof ArrayBuffer) return `[binary: ${raw.byteLength} bytes]`;
  if (typeof raw === "object") {
    try {
      return JSON.stringify(raw, null, 2);
    } catch {
      return String(raw);
    }
  }
  return String(raw);
}

function sliceWithoutSplittingSurrogatePair(
  value: string,
  maxChars: number
): string {
  let end = maxChars;
  const lastCodeUnit = value.charCodeAt(end - 1);
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) {
    end -= 1;
  }
  return value.slice(0, end);
}

export function registerExportTools() {
  createTool(
    exportToolDocs[0].name,
    {
      ...exportToolDocs[0],
      async execute() {
        requireBedrockEntityProject();
        const registry = codecRegistry();
        const codecs = BLOCKIT_MODEL_CODEC_IDS.map((id) => {
          const codec = registry[id];
          return {
            id,
            name: codec?.name ?? id,
            extension: codec?.extension ?? (id === "project" ? "bbmodel" : "json"),
            available: !!codec,
            has_compile: typeof codec?.compile === "function",
            supports_partial_export: Boolean(codec?.support_partial_export),
            purpose: id === "bedrock" ? "bedrock_geometry" : "editable_blockbench_project",
          };
        });
        const animationCodec = nativeBedrockAnimationCodec();

        return JSON.stringify({
          current_format: "bedrock",
          count: codecs.length + 1,
          codecs: [...codecs, {
            id: "bedrock_animation", name: animationCodec?.name,
            extension: "json", available: !!animationCodec,
            has_compile: !!animationCodec, supports_partial_export: false,
            purpose: "bedrock_animations", content_only: true,
          }],
          note:
            "Bedrock animations compile through native AnimationCodec without changing clip paths or saved state. Controller export is not included.",
        });
      },
    },
    exportToolDocs[0].status,
    false
  );

  createTool(
    exportToolDocs[1].name,
    {
      ...exportToolDocs[1],
      async execute({ codec_id, options, path, overwrite, max_content_length }) {
        requireBedrockEntityProject();
        if (codec_id === "bedrock_animation" && max_content_length === 0) {
          throw new Error("bedrock_animation is content-only: max_content_length=0 would discard the requested deliverable.");
        }
        if (codec_id === "bedrock_animation" &&
            (path !== undefined || (options && Object.keys(options).length > 0))) {
          throw new Error("bedrock_animation is content-only: omit path/options; persist the returned native JSON separately.");
        }
        const registry = codecRegistry();
        let animationExportEvidence: ReturnType<typeof assertBedrockAnimationExportMatchesSource> | null = null;
        let geometryExportEvidence: ReturnType<typeof assertCompiledBedrockGeometryIdentity> | null = null;
        const codec = codec_id === "bedrock_animation"
          ? nativeBedrockAnimationCodec((evidence) => { animationExportEvidence = evidence; })
          : registry[codec_id];

        if (!codec) {
          throw new Error(
            `Required Blockbench codec "${codec_id}" is not registered in this Blockbench build.`
          );
        }
        if (typeof codec.compile !== "function") {
          throw new Error(
            `Blockbench codec "${codec_id}" does not support programmatic compile().`
          );
        }

        let exportFs: ExportFilesystem | null = null;
        let destinationExisted = false;
        if (path) {
          const expectedExtension = (
            codec.extension ?? (codec_id === "project" ? "bbmodel" : "json")
          ).toLowerCase();
          if (!path.toLowerCase().endsWith(`.${expectedExtension}`)) {
            throw new Error(
              `Export path for ${codec_id} must end in .${expectedExtension}; received ${path}.`
            );
          }

          // @ts-ignore - requireNativeModule is a Blockbench desktop global.
          exportFs = requireNativeModule("fs", {
            message: `LazyDesigner export_model requested write access to save ${codec_id} output to ${path}`,
          }) as ExportFilesystem | null;
          if (!exportFs) {
            throw new Error(
              "File system access was denied. Omit `path` to receive the compiled content in the MCP response."
            );
          }
          destinationExisted = exportFs.existsSync(path);
          if (destinationExisted) {
            // Blockbench's permission-scoped fs exposes Dirents, not lstatSync.
            // Dirents inspect the entry itself, so symlinks are not followed.
            const directory = path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
            const filename = filesystemFileName(path);
            const entries = exportFs.readdirSync(directory, { withFileTypes: true });
            const matches = entries.filter(entry => entry.name === filename ||
              (process.platform === "win32" && entry.name.toLowerCase() === filename.toLowerCase()));
            if (matches.length !== 1) {
              throw new Error(`Cannot identify a unique export destination entry ${path}; no file was written.`);
            }
            const destination = matches[0];
            if (destination.isSymbolicLink()) {
              throw new Error(
                `Refusing to write export through symbolic link ${path}. Choose the real destination path explicitly.`
              );
            }
            if (!destination.isFile()) {
              throw new Error(
                `Refusing to replace non-file export destination ${path}.`
              );
            }
          }
          if (codec_id === "bedrock" && destinationExisted) {
            throw new Error(
              `Refusing to overwrite existing Bedrock geometry file ${path}. Native Blockbench uses codec overwrite/merge semantics for existing multi-model geometry files; export_model will not bypass that behavior. Choose a new path or use native Blockbench export/save for the existing file.`
            );
          }
          if (
            codec_id === "project" &&
            overwrite !== true &&
            destinationExisted
          ) {
            throw new Error(
              `Refusing to replace the existing .bbmodel file ${path} without explicit consent. Pass overwrite: true, choose a new path, or save from the Blockbench editor directly.`
            );
          }
        }

        // A path-backed project export is a native Save As, not a side-effect-free copy.
        // Keep the exact editor identity before compile and native afterSave.
        const projectBefore = currentExportProjectLifecycle();
        const effectiveOptions =
          options ??
          (typeof codec.getExportOptions === "function"
            ? codec.getExportOptions()
            : undefined);

        let rawResult: unknown;
        if (codec_id === "project" && path) {
          const previousSavePath = Project!.save_path;
          const previousName = Project!.name;
          try {
            // Native bbmodel export compiles relative assets and project identity against the target file.
            Project!.save_path = path;
            Project!.name = filesystemStem(path);
            rawResult = codec.compile(effectiveOptions);
          } finally {
            Project!.save_path = previousSavePath;
            Project!.name = previousName;
          }
        } else {
          rawResult = codec.compile(effectiveOptions);
        }

        const isArrayBuffer = rawResult instanceof ArrayBuffer;
        const isBinaryView =
          ArrayBuffer.isView(rawResult) && !(rawResult instanceof DataView);
        const binaryBuffer = isArrayBuffer
          ? Buffer.from(rawResult as ArrayBuffer)
          : isBinaryView
            ? Buffer.from(
                (rawResult as ArrayBufferView).buffer,
                (rawResult as ArrayBufferView).byteOffset,
                (rawResult as ArrayBufferView).byteLength
              )
            : null;

        const text = binaryBuffer ? null : toTextContent(rawResult);
        const byteLength = binaryBuffer
          ? binaryBuffer.byteLength
          : Buffer.byteLength(text ?? "", "utf8");
        const encoding: "utf-8" | "base64" = binaryBuffer ? "base64" : "utf-8";
        if (byteLength === 0) {
          throw new Error(
            `Blockbench codec "${codec_id}" compiled an empty artifact; no file was written.`
          );
        }
        // Native bedrock geometry is JSON; validate exact codec output
        // before touching a destination. Do not use prior Workspace labels
        // or a nonempty byte count as proof of geometry identity.
        if (codec_id === "bedrock") {
          geometryExportEvidence = assertCompiledBedrockGeometryIdentity(
            binaryBuffer ? null : rawResult
          );
        }
        // Hash the exact codec output, not a guessed native model revision or
        // independently attested file readback. A source edit after this call
        // requires a new compile; it cannot inherit the old artifact identity.
        const compiledHash = createHash("sha256");
        if (binaryBuffer) compiledHash.update(binaryBuffer);
        else compiledHash.update(text ?? "", "utf8");
        const compiledPayloadSha256 = `sha256:${compiledHash.digest("hex")}`;

        let wrote_to_path: string | null = null;
        let fileIntegrityState: "NOT_WRITTEN" | "SIZE_ONLY" | "READBACK_MATCHED" = "NOT_WRITTEN";
        let writtenFileSha256: string | null = null;
        if (path && exportFs) {
          // Verify the lifecycle owner exists BEFORE touching the filesystem so
          // a failed verification never leaves a half-claimed artifact behind.
          if (typeof codec.afterSave !== "function") {
            throw new Error(
              `Codec "${codec_id}" does not implement the native afterSave() lifecycle owner required for verified filesystem writes. Omit \`path\` to receive the compiled content in the MCP response instead.`
            );
          }
          // A native filesystem write is not transactional. If it fails, the
          // target may already have been created or partly overwritten.
          // Never delete, retry or claim rollback from this failure path.
          try {
            exportFs.writeFileSync(
              path,
              binaryBuffer ?? (text ?? ""),
              { flag: destinationExisted ? "w" : "wx" }
            );
          } catch {
            throw new Error(
              `EXPORT_WRITE_OUTCOME_UNKNOWN: Write to ${path} did not complete reliably. The destination may exist or be partially overwritten. Inspect file contents and current Blockbench project before any retry; do not automatically repeat export_model.`
            );
          }
          let writtenStat: ReturnType<ExportFilesystem["statSync"]>;
          try {
            writtenStat = exportFs.statSync(path);
          } catch {
            throw new Error(
              `EXPORT_WRITE_OUTCOME_UNKNOWN: A write to ${path} returned, but the destination could not be verified. Inspect the file and Blockbench state before retry; no rollback or automatic retry was performed.`
            );
          }
          if (!writtenStat.isFile() || writtenStat.size !== byteLength) {
            throw new Error(
              `EXPORT_WRITE_OUTCOME_UNKNOWN: Export write verification failed for ${path}: expected a regular file of ${byteLength} bytes, got ${writtenStat.isFile() ? `${writtenStat.size} bytes` : "a non-file target"}. The destination may exist or be incomplete. Inspect it before retry; no automatic retry or rollback was performed.`
            );
          }
          try {
            codec.afterSave(path);
          } catch {
            throw new Error(
              `EXPORT_LIFECYCLE_UNVERIFIED: Artifact size was verified at ${path}, but native afterSave failed. The file may exist while the active project's name/save path/saved state is uncertain. Inspect both file and editor state before any retry; no automatic retry or rollback was performed.`
            );
          }
          const lifecycle = currentExportProjectLifecycle();
          const lifecycleMatches =
            codec_id === "project"
              ? lifecycle.save_path === path && lifecycle.saved
              : lifecycle.export_path === path &&
                lifecycle.export_codec === codec_id &&
                lifecycle.saved;
          if (!lifecycleMatches) {
            throw new Error(
              `EXPORT_LIFECYCLE_UNVERIFIED: Export artifact was written to ${path}, but native codec lifecycle state did not synchronize to that path. Inspect the destination and active project before retry; no automatic retry or rollback was performed.`
            );
          }

          fileIntegrityState = "SIZE_ONLY";
          // Permission-scoped native fs may not offer file readback. Treat
          // unavailable/denied read access as weaker evidence, NOT proof that
          // a successful prior write has failed or was rolled back.
          if (typeof exportFs.readFileSync === "function") {
            let bytes: Buffer | string | null = null;
            try {
              bytes = exportFs.readFileSync(path);
            } catch {
              // Save and native lifecycle were already verified by size/path.
              // The response explicitly keeps a SIZE_ONLY integrity state.
            }
            if (typeof bytes === "string" || Buffer.isBuffer(bytes)) {
              const readbackHash = "sha256:" +
                createHash("sha256").update(bytes).digest("hex");
              if (readbackHash !== compiledPayloadSha256) {
                throw new Error(
                  `EXPORT_WRITE_OUTCOME_UNKNOWN: File readback differs from compiled codec bytes at ${path}. The destination may have changed or be incomplete; inspect file and native project before any retry. No automatic retry or rollback was performed.`
                );
              }
              writtenFileSha256 = readbackHash;
              fileIntegrityState = "READBACK_MATCHED";
            }
          }
          wrote_to_path = path;
        }

        const fullContent = binaryBuffer
          ? binaryBuffer.toString("base64")
          : (text ?? "");
        // A successful filesystem write already delivers the artifact. Avoid
        // echoing large compiled content into model context unless requested.
        const effectiveMaxContentLength =
          max_content_length ?? (path ? 0 : 100_000);
        const truncated =
          effectiveMaxContentLength > 0 &&
          fullContent.length > effectiveMaxContentLength;
        const returnedContent =
          effectiveMaxContentLength === 0
            ? null
            : truncated
              ? sliceWithoutSplittingSurrogatePair(
                  fullContent,
                  effectiveMaxContentLength
                )
              : fullContent;

        const projectAfter = currentExportProjectLifecycle();
        const metadataKeys = ["name", "uuid", "save_path", "export_path", "export_codec", "saved"] as const;
        const projectLifecycleChanges = metadataKeys.filter(
          key => projectBefore[key] !== projectAfter[key]
        );
        const saveBehavior = !wrote_to_path
          ? "COMPILE_ONLY"
          : codec_id === "project"
            ? projectBefore.save_path === wrote_to_path
              ? "NATIVE_PROJECT_SAVE"
              : "NATIVE_PROJECT_SAVE_AS"
            : "NATIVE_BEDROCK_EXPORT";

        const result = {
          project_format: "bedrock" as const,
          save_behavior: saveBehavior,
          project_before: projectBefore,
          project_lifecycle_changes: projectLifecycleChanges,
          codec: {
            id: codec_id,
            name: codec.name ?? codec_id,
            extension: codec.extension ?? null,
          },
          file_name:
            path !== undefined
              ? filesystemFileName(path)
              : typeof codec.fileName === "function"
                ? codec.fileName()
                : Project!.name,
          byte_length: byteLength,
          compiled_payload_sha256: compiledPayloadSha256,
          compiled_payload_sha256_scope: "NATIVE_CODEC_OUTPUT_BYTES" as const,
          file_integrity_state: fileIntegrityState,
          written_file_sha256: writtenFileSha256,
          ...(animationExportEvidence !== null
            ? { animation_export_identity: animationExportEvidence }
            : {}),
          ...(geometryExportEvidence !== null
            ? { geometry_export_identity: geometryExportEvidence }
            : {}),
          encoding,
          wrote_to_path,
          project: projectAfter,
          truncated,
          content: returnedContent,
        };

        return {
          content: [
            {
              type: "text" as const,
              text: wrote_to_path
                ? codec_id === "project"
                  ? `Saved editable project ${result.file_name} (${byteLength} bytes) using native Blockbench ${saveBehavior === "NATIVE_PROJECT_SAVE" ? "Save" : "Save As"}; active project save path is now ${projectAfter.save_path}. This is not an independent diagnostic copy.`
                  : `Exported ${codec_id} artifact ${result.file_name} (${byteLength} bytes) using native Blockbench export lifecycle; metadata effects: ${projectLifecycleChanges.join(", ") || "none"}.`
                : `Compiled ${codec_id} artifact ${result.file_name} (${byteLength} bytes); no file path was provided.${truncated ? " WARNING: response content was truncated; this is not a complete deliverable." : ""}`,
            },
          ],
          structuredContent: result,
        };
      },
    },
    exportToolDocs[1].status
  );
}
