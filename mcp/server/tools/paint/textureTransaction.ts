/// <reference types="blockbench-types" />

import { createTool, type ToolSpec } from "@/lib/factories";
import { recordCurrentCapabilitySemanticHistoryEffect } from "@/lib/authoring/semanticHistory";
import { bakeNativeCubeAo } from "@/lib/geometry/cubeAoRuntime";
import { imageContent } from "@/lib/protocol/imageContent";
import { resolvePaintTexture } from "@/lib/texture/selection";
import {
  applyPaintTransactionRgba,
  buildPaintTransactionReceipt,
  paintTransactionParameters,
} from "@/lib/texture/paintTransaction";
import {
  PAINT_TEXTURE_TRANSACTION_TOOL_NAME,
  requirePaintTransactionV1Target,
} from "@/lib/texture/paintTransactionPolicy";
import { computeTextureRevision } from "@/lib/texture/revision";
import { applyTextureComputePipeline } from "@/lib/texture/computePipeline";
import { parseTextureComputeRequest } from "@/lib/texture/computeRequest";
import {
  cropRgbaRect,
  fullTextureRgba,
  requireUnchangedTextureBitmap,
  rgbaToPngDataUrl,
} from "@/lib/texture/bitmapRuntime";

export const paintTextureTransactionToolDocs: ToolSpec = {
  name: PAINT_TEXTURE_TRANSACTION_TOOL_NAME,
  description:
    "Applies bounded pixel operations, texture compute, or Cube AO with revision protection and one Undo.",
  annotations: {
    title: "Paint Texture Transaction",
    destructiveHint: true,
  },
  parameters: paintTransactionParameters,
  status: "stable",
};

type TexturePngFilesystem = {
  existsSync(path: string): boolean;
  writeFileSync(path: string, data: Uint8Array): void;
  statSync(path: string): { isFile(): boolean; size: number };
  renameSync(oldPath: string, newPath: string): void;
  unlinkSync(path: string): void;
};

type PreparedTexturePngWrite = {
  path: string;
  overwrite: boolean;
  existed: boolean;
  temp_path: string;
  backup_path: string | null;
  committed: boolean;
  backup_moved: boolean;
  byte_length: number;
};

function requireTexturePngFilesystem(path: string): TexturePngFilesystem {
  // @ts-ignore - Blockbench desktop provides fs through requireNativeModule.
  const fs = requireNativeModule("fs", {
    message: `LazyDesigner requested write access to save texture PNG ${path}`,
  }) as TexturePngFilesystem | undefined;
  if (!fs) throw new Error("File system access was denied for texture PNG output.");
  return fs;
}

function texturePngBytes(dataUrl: string): Buffer {
  const marker = "data:image/png;base64,";
  if (!dataUrl.startsWith(marker)) {
    throw new Error("Texture PNG encoder did not return a base64 PNG data URL.");
  }
  const bytes = Buffer.from(dataUrl.slice(marker.length), "base64");
  if (bytes.byteLength === 0) throw new Error("Texture PNG encoder returned an empty PNG.");
  return bytes;
}

function uniqueTextureSiblingPath(
  fs: TexturePngFilesystem,
  targetPath: string,
  label: "tmp" | "bak"
): string {
  for (let index = 0; index < 128; index += 1) {
    const candidate = `${targetPath}.blockit-${label}-${process.pid}-${index}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Could not allocate a bounded texture ${label} path beside ${targetPath}.`);
}

function prepareTexturePngWrite(
  path: string,
  overwrite: boolean,
  byteLength: number
): { fs: TexturePngFilesystem; state: PreparedTexturePngWrite } {
  const fs = requireTexturePngFilesystem(path);
  const existed = fs.existsSync(path);
  if (existed && !overwrite) {
    throw new Error(`Refusing to replace existing texture PNG ${path} without overwrite=true.`);
  }
  return {
    fs,
    state: {
      path,
      overwrite,
      existed,
      temp_path: uniqueTextureSiblingPath(fs, path, "tmp"),
      backup_path: existed ? uniqueTextureSiblingPath(fs, path, "bak") : null,
      committed: false,
      backup_moved: false,
      byte_length: byteLength,
    },
  };
}

function commitTexturePngWrite(
  fs: TexturePngFilesystem,
  state: PreparedTexturePngWrite,
  bytes: Uint8Array
): void {
  fs.writeFileSync(state.temp_path, bytes);
  const tempStat = fs.statSync(state.temp_path);
  if (!tempStat.isFile() || tempStat.size !== state.byte_length) {
    throw new Error(
      `Temporary texture PNG verification failed for ${state.path}: expected ${state.byte_length} bytes, got ${tempStat.isFile() ? tempStat.size : "a non-file target"}.`
    );
  }
  if (state.existed && state.backup_path) {
    fs.renameSync(state.path, state.backup_path);
    state.backup_moved = true;
  }
  fs.renameSync(state.temp_path, state.path);
  state.committed = true;
  const finalStat = fs.statSync(state.path);
  if (!finalStat.isFile() || finalStat.size !== state.byte_length) {
    throw new Error(
      `Committed texture PNG verification failed for ${state.path}: expected ${state.byte_length} bytes, got ${finalStat.isFile() ? finalStat.size : "a non-file target"}.`
    );
  }
}

export function rollbackTexturePngWrite(
  fs: TexturePngFilesystem,
  state: PreparedTexturePngWrite
): void {
  // Restore the user's original file before optional temporary cleanup.
  // A locked leftover temp must not prevent backup restoration on Windows.
  if (state.committed && fs.existsSync(state.path)) fs.unlinkSync(state.path);
  if (state.backup_moved && state.backup_path && fs.existsSync(state.backup_path)) {
    fs.renameSync(state.backup_path, state.path);
    state.backup_moved = false;
  }
  if (fs.existsSync(state.temp_path)) fs.unlinkSync(state.temp_path);
}

function finalizeTexturePngWrite(
  fs: TexturePngFilesystem,
  state: PreparedTexturePngWrite
): void {
  if (!state.backup_path || !fs.existsSync(state.backup_path)) return;
  try {
    fs.unlinkSync(state.backup_path);
  } catch {
    // The authored PNG and Undo unit are already committed. A stale backup is
    // safer than turning successful authoring into a second rollback attempt.
  }
}

export function registerPaintTextureTransactionTool(): void {
  createTool(
    paintTextureTransactionToolDocs.name,
    {
      ...paintTextureTransactionToolDocs,
      parameters: paintTransactionParameters,
      async execute({ texture_id, expected_revision, operations, compute, ambient_occlusion, output }) {
        const texture = resolvePaintTexture(texture_id);
        requirePaintTransactionV1Target({
          texture_uuid: texture.uuid,
          texture_name: texture.name,
          layers_enabled: texture.layers_enabled,
        });

        const before = fullTextureRgba(texture);
        const beforeRevision = await computeTextureRevision(
          before.pixels,
          before.width,
          before.height
        );
        if (beforeRevision !== expected_revision) {
          throw new Error(
            `Texture "${texture.name}" changed since the caller observed it. Expected revision ${expected_revision}, actual ${beforeRevision}. Refresh texture state before retrying the mutation.`
          );
        }

        const computeRequest = compute
          ? parseTextureComputeRequest(compute)
          : null;
        const computeResult = computeRequest
          ? applyTextureComputePipeline(
              before.pixels,
              before.width,
              before.height,
              computeRequest.steps,
              computeRequest.target_rect ?? undefined
            )
          : null;
        const applied = computeResult
          ? {
              pixels: computeResult.pixels,
              operation_count: computeResult.receipt.operation_count,
              pixel_writes: computeResult.receipt.changed_pixels,
              affected_rect: computeResult.receipt.changed_rect!,
            }
          : ambient_occlusion
            ? bakeNativeCubeAo(
                texture,
                before.pixels,
                before.width,
                before.height,
                ambient_occlusion
              )
            : applyPaintTransactionRgba(
                before.pixels,
                before.width,
                before.height,
                operations!
              );
        const plannedAfterRevision = await computeTextureRevision(
          applied.pixels,
          before.width,
          before.height
        );
        const plannedReceipt = buildPaintTransactionReceipt({
          texture_uuid: texture.uuid,
          texture_name: texture.name,
          before_revision: beforeRevision,
          after_revision: plannedAfterRevision,
          operation_count: applied.operation_count,
          pixel_writes: applied.pixel_writes,
          affected_rect: applied.affected_rect,
        });
        const dirtyRegion = cropRgbaRect(
          applied.pixels,
          before.width,
          before.height,
          plannedReceipt.affected_rect
        );
        const outputBytes = output
          ? texturePngBytes(rgbaToPngDataUrl(applied.pixels, before.width, before.height))
          : null;
        const preparedOutput = output && outputBytes
          ? prepareTexturePngWrite(output.path, output.overwrite === true, outputBytes.byteLength)
          : null;

        // Planning includes asynchronous revision hashing. Native edits may
        // occur between the caller's initial revision check and this point.
        // Recheck the entire RGBA source synchronously before opening Undo or
        // overwriting the dirty region with a stale planned candidate.
        requireUnchangedTextureBitmap(before, fullTextureRgba(texture));

        const undoAspects: UndoAspects = {
          bitmap: true,
          textures: [texture],
        };
        Undo.initEdit(undoAspects);
        try {
          texture.edit(
            (
              canvas: HTMLCanvasElement,
              env: BlockbenchRuntimeTextureEditEnvironment
            ) => {
              const activeOffset =
                Array.isArray(env.offset) && env.offset.length === 2
                  ? env.offset
                  : [0, 0];
              const localX = dirtyRegion.left - activeOffset[0];
              const localY = dirtyRegion.top - activeOffset[1];
              const canvasWidth =
                canvas && Number.isFinite(canvas.width)
                  ? canvas.width
                  : before.width;
              const canvasHeight =
                canvas && Number.isFinite(canvas.height)
                  ? canvas.height
                  : before.height;
              if (
                localX < 0 ||
                localY < 0 ||
                localX + dirtyRegion.width > canvasWidth ||
                localY + dirtyRegion.height > canvasHeight
              ) {
                throw new Error(
                  "Paint transaction dirty region falls outside the active texture canvas."
                );
              }
              const imageData = env.ctx.createImageData(
                dirtyRegion.width,
                dirtyRegion.height
              );
              imageData.data.set(dirtyRegion.pixels);
              env.ctx.putImageData(imageData, localX, localY);
            },
            { no_undo: true }
          );

          const actualAfter = fullTextureRgba(texture);
          const actualAfterRevision = await computeTextureRevision(
            actualAfter.pixels,
            actualAfter.width,
            actualAfter.height
          );
          if (actualAfterRevision !== plannedAfterRevision) {
            throw new Error(
              `Paint transaction postcondition mismatch: planned revision ${plannedAfterRevision}, actual ${actualAfterRevision}.`
            );
          }

          if (preparedOutput && outputBytes) {
            commitTexturePngWrite(preparedOutput.fs, preparedOutput.state, outputBytes);
          }
          Undo.finishEdit("Paint texture transaction");
          recordCurrentCapabilitySemanticHistoryEffect("paint_texture_transaction");
          if (preparedOutput) {
            finalizeTexturePngWrite(preparedOutput.fs, preparedOutput.state);
          }
        } catch (error) {
          if (preparedOutput) {
            try {
              rollbackTexturePngWrite(preparedOutput.fs, preparedOutput.state);
            } catch (rollbackError) {
              const reason = error instanceof Error ? error.message : String(error);
              const rollbackReason = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
              Undo.cancelEdit(true);
              Canvas.updateAll();
              throw new Error(`${reason} Texture PNG rollback also reported: ${rollbackReason}`);
            }
          }
          Undo.cancelEdit(true);
          Canvas.updateAll();
          throw error;
        }

        Canvas.updateAll();
        let affectedRegionImage: ReturnType<typeof imageContent>["content"][number] | null = null;
        try {
          // The full postcondition read above already proved that the authored
          // bitmap matches applied.pixels. Reuse the verified candidate rather
          // than reading the entire atlas a third time just to crop evidence.
          affectedRegionImage = imageContent(
            rgbaToPngDataUrl(
              dirtyRegion.pixels,
              dirtyRegion.width,
              dirtyRegion.height
            )
          ).content[0];
        } catch {
          // Visual evidence is optional optimization. DOM/image encoding may be
          // unavailable in headless Runtime verification; authored mutation and
          // revision proof remain valid and Control will request follow-up read.
        }
        const outputReceipt = preparedOutput
          ? {
              path: preparedOutput.state.path,
              byte_length: preparedOutput.state.byte_length,
              replaced_existing: preparedOutput.state.existed,
              verified: true as const,
            }
          : null;
        return {
          content: [
            {
              type: "text" as const,
              text: `Applied ${plannedReceipt.operation_count} texture operation(s) as one Undo transaction on "${texture.name}"${outputReceipt ? `; verified PNG saved to ${outputReceipt.path}` : ""}.${affectedRegionImage ? " The attached PNG is the exact affected atlas region after mutation." : ""}`,
            },
            ...(affectedRegionImage ? [affectedRegionImage] : []),
          ],
          structuredContent: {
            ...plannedReceipt,
            compute: computeResult
              ? {
                  operation_count:
                    computeResult.receipt.operation_count,
                  operations: computeResult.receipt.operations,
                  changed_pixels:
                    computeResult.receipt.changed_pixels,
                  execution: computeResult.receipt.execution,
                }
              : null,
            visual_evidence: affectedRegionImage
              ? {
                  kind: "affected_region_png",
                  affected_rect: plannedReceipt.affected_rect,
                  revision: plannedReceipt.revision.after,
                  width: plannedReceipt.affected_size[0],
                  height: plannedReceipt.affected_size[1],
                }
              : null,
            output: outputReceipt,
          },
        };
      },
    },
    paintTextureTransactionToolDocs.status
  );
}
