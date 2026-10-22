import { z } from "zod";
import {
  requiredHexColorSchema,
  textureIdOptionalSchema,
} from "@/lib/zodObjects";
import { textureRevisionSchema } from "@/lib/texture/evidence";
import { isAbsoluteFilesystemPath } from "@/lib/util";
import { textureComputeOperationNames } from "@/lib/texture/computeRequest";

export const paintTransactionCoordinateSchema = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
  })
  .strict();

export const paintTransactionRectSchema = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

const setPixelsOperationSchema = z
  .object({
    operation: z.literal("set_pixels"),
    color: requiredHexColorSchema,
    coordinates: z.array(paintTransactionCoordinateSchema).min(1),
  })
  .strict();

const fillRectOperationSchema = z
  .object({
    operation: z.literal("fill_rect"),
    color: requiredHexColorSchema,
    rect: paintTransactionRectSchema,
  })
  .strict();

const erasePixelsOperationSchema = z
  .object({
    operation: z.literal("erase_pixels"),
    coordinates: z.array(paintTransactionCoordinateSchema).min(1),
  })
  .strict();

export const paintTransactionOperationSchema = z.union([
  setPixelsOperationSchema,
  fillRectOperationSchema,
  erasePixelsOperationSchema,
  z.object({
    operation: z.literal("copy_region"),
    source: paintTransactionRectSchema,
    target: paintTransactionCoordinateSchema,
    flip_x: z.boolean().optional(),
    flip_y: z.boolean().optional(),
  }).strict(),
  z.object({
    operation: z.literal("noise"),
    rect: paintTransactionRectSchema,
    seed: z.number().int().min(0).max(0xffffffff),
    amplitude: z.number().int().min(1).max(255),
    channels: z.array(z.enum(["r", "g", "b", "a"])).min(1).max(4).refine(channels => new Set(channels).size === channels.length, "Duplicate noise channels."),
    mask: z.array(paintTransactionCoordinateSchema).min(1).optional(),
    preserve_transparent: z.boolean().optional(),
  }).strict(),
]);

// Shared immutable Zod shape: parameter registration and the deterministic
// transaction planner must enforce the same 1–64 operation bound without
// rebuilding the array schema for every planned texture edit.
const paintTransactionOperationsSchema = z
  .array(paintTransactionOperationSchema)
  .min(1)
  .max(64);

export const paintTransactionComputeStepSchema = z
  .object({
    operation: z.enum(textureComputeOperationNames),
    args: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const paintTransactionOutputSchema = z
  .object({
    path: z
      .string()
      .refine(isAbsoluteFilesystemPath, "PNG output path must be absolute.")
      .refine((value) => value.toLowerCase().endsWith(".png"), "Texture output must use the .png suffix."),
    overwrite: z.boolean().optional().default(false),
  })
  .strict();

/**
 * Public contract for one bounded exact-pixel transaction. Runtime registration
 * is owned by server/tools/prelocal-wiring.ts so policy/planning remains pure
 * and independently testable.
 */
export const paintTransactionParameters = z
  .object({
    texture_id: textureIdOptionalSchema,
    expected_revision: textureRevisionSchema,
    operations: paintTransactionOperationsSchema.optional(),
    compute: z.array(paintTransactionComputeStepSchema).min(1).max(12).optional(),
    ambient_occlusion: z.object({
      cube_ids:z.array(z.string().min(1)).min(1).max(64),
      radius:z.number().finite().positive(),
      samples:z.number().int().min(1).max(256).default(32),
      bias:z.number().finite().positive().default(.001),
      strength:z.number().finite().positive().max(1).default(.5),
    }).strict().refine(v=>v.bias<v.radius,"AO bias must be smaller than radius.").optional(),
    output: paintTransactionOutputSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      [
        value.operations !== undefined,
        value.compute !== undefined,
        value.ambient_occlusion !== undefined,
      ].filter(Boolean).length === 1,
    "Provide exactly one of operations, compute, or ambient_occlusion."
  );

export type PaintTransactionOperation = z.infer<
  typeof paintTransactionOperationSchema
>;

export type PaintTransactionRequest = z.infer<typeof paintTransactionParameters>;

type Rgba = [number, number, number, number];
type AffectedRect = [number, number, number, number];

function parseHexRgba(value: string): Rgba {
  const normalized = requiredHexColorSchema.parse(value).slice(1);
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
    normalized.length === 8
      ? Number.parseInt(normalized.slice(6, 8), 16)
      : 255,
  ];
}

function requireBitmapDimensions(width: number, height: number): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error("Paint transaction bitmap dimensions must be positive safe integers.");
  }
}

function requirePoint(
  point: { x: number; y: number },
  width: number,
  height: number,
  context: string
): void {
  if (
    !Number.isSafeInteger(point.x) ||
    !Number.isSafeInteger(point.y) ||
    point.x < 0 ||
    point.y < 0 ||
    point.x >= width ||
    point.y >= height
  ) {
    throw new Error(
      `${context} (${point.x}, ${point.y}) is outside bitmap bounds ${width}x${height}.`
    );
  }
}

function requireRect(
  rect: { x: number; y: number; width: number; height: number },
  width: number,
  height: number,
  context: string
): void {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  if (
    !Number.isSafeInteger(right) ||
    !Number.isSafeInteger(bottom) ||
    rect.x < 0 ||
    rect.y < 0 ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    right > width ||
    bottom > height
  ) {
    throw new Error(
      `${context} [${rect.x},${rect.y},${rect.width},${rect.height}] is outside bitmap bounds ${width}x${height}.`
    );
  }
}

function includePixel(
  current: AffectedRect | null,
  x: number,
  y: number
): AffectedRect {
  if (!current) return [x, y, x + 1, y + 1];
  return [
    Math.min(current[0], x),
    Math.min(current[1], y),
    Math.max(current[2], x + 1),
    Math.max(current[3], y + 1),
  ];
}

function includeRect(
  current: AffectedRect | null,
  rect: { x: number; y: number; width: number; height: number }
): AffectedRect {
  const candidate: AffectedRect = [
    rect.x,
    rect.y,
    rect.x + rect.width,
    rect.y + rect.height,
  ];
  if (!current) return candidate;
  return [
    Math.min(current[0], candidate[0]),
    Math.min(current[1], candidate[1]),
    Math.max(current[2], candidate[2]),
    Math.max(current[3], candidate[3]),
  ];
}

export function planPaintTransaction(
  operations: readonly PaintTransactionOperation[],
  width: number,
  height: number
) {
  requireBitmapDimensions(width, height);
  const parsed = paintTransactionOperationsSchema.parse(operations);

  let affectedRect: AffectedRect | null = null;
  let pixelWrites = 0;

  for (const [index, operation] of parsed.entries()) {
    if (operation.operation === "copy_region") {
      requireRect(operation.source, width, height, "copy source");
      const target = {...operation.source, ...operation.target};
      requireRect(target, width, height, "copy target");
      affectedRect = includeRect(affectedRect, target);
      pixelWrites += target.width * target.height;
      continue;
    }
    if (operation.operation === "fill_rect" || operation.operation === "noise") {
      requireRect(operation.rect, width, height, `operations[${index}].rect`);
      // paintTransactionOperationsSchema has already validated the hex color
      // for fill_rect. Only noise needs per-coordinate mask checks here.
      if (operation.operation === "noise") for (const point of operation.mask ?? []) {
        requirePoint(point, width, height, "noise mask");
        if (point.x < operation.rect.x || point.y < operation.rect.y || point.x >= operation.rect.x + operation.rect.width || point.y >= operation.rect.y + operation.rect.height) throw new Error("Noise mask lies outside its rect.");
      }
      affectedRect = includeRect(affectedRect, operation.rect);
      pixelWrites += operation.operation === "noise" && operation.mask ? new Set(operation.mask.map(point => `${point.x},${point.y}`)).size : operation.rect.width * operation.rect.height;
      continue;
    }

    // set_pixels.color was validated during the same Zod operation parse.
    for (const [coordinateIndex, coordinate] of operation.coordinates.entries()) {
      requirePoint(
        coordinate,
        width,
        height,
        `operations[${index}].coordinates[${coordinateIndex}]`
      );
      affectedRect = includePixel(affectedRect, coordinate.x, coordinate.y);
      pixelWrites += 1;
    }
  }

  if (!affectedRect) {
    throw new Error("Paint transaction produced no bounded affected region.");
  }

  return {
    operation_count: parsed.length,
    pixel_writes: pixelWrites,
    affected_rect: affectedRect,
    affected_size: [
      affectedRect[2] - affectedRect[0],
      affectedRect[3] - affectedRect[1],
    ] as [number, number],
    operations: parsed,
  };
}

function writePixel(
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  rgba: Rgba
): void {
  const offset = (y * width + x) * 4;
  pixels[offset] = rgba[0];
  pixels[offset + 1] = rgba[1];
  pixels[offset + 2] = rgba[2];
  pixels[offset + 3] = rgba[3];
}

/**
 * Applies a transaction to a copy only after the complete plan validates.
 * This gives the Runtime wiring a deterministic preflight/rollback oracle before
 * it opens one native Blockbench Undo unit.
 */
export function applyPaintTransactionRgba(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  operations: readonly PaintTransactionOperation[]
) {
  const expectedLength = width * height * 4;
  if (!Number.isSafeInteger(expectedLength) || source.byteLength !== expectedLength) {
    throw new Error(
      `Paint transaction RGBA length mismatch: expected ${expectedLength}, received ${source.byteLength}.`
    );
  }

  const plan = planPaintTransaction(operations, width, height);
  const result = new Uint8ClampedArray(source);

  for (const operation of plan.operations) {
    if (operation.operation === "copy_region") {
      const snapshot = new Uint8ClampedArray(operation.source.width * operation.source.height * 4);
      for (let y=0;y<operation.source.height;y++) {
        const start=((operation.source.y+y)*width+operation.source.x)*4;
        snapshot.set(result.subarray(start,start+operation.source.width*4),y*operation.source.width*4);
      }
      for (let y=0;y<operation.source.height;y++) for (let x=0;x<operation.source.width;x++) {
        const sx=operation.flip_x?operation.source.width-1-x:x;
        const sy=operation.flip_y?operation.source.height-1-y:y;
        const offset=(sy*operation.source.width+sx)*4;
        writePixel(result,width,operation.target.x+x,operation.target.y+y,[snapshot[offset],snapshot[offset+1],snapshot[offset+2],snapshot[offset+3]]);
      }
      continue;
    }
    if (operation.operation === "noise") {
      const mask = operation.mask ? new Set(operation.mask.map(point => `${point.x},${point.y}`)) : null;
      for (let y = operation.rect.y; y < operation.rect.y + operation.rect.height; y++) {
        for (let x = operation.rect.x; x < operation.rect.x + operation.rect.width; x++) {
          if (mask && !mask.has(`${x},${y}`)) continue;
          const offset = (y * width + x) * 4;
          if (operation.preserve_transparent !== false && result[offset + 3] === 0) continue;
          let hash = (operation.seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b)) >>> 0;
          hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
          hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
          hash = (hash ^ (hash >>> 16)) >>> 0;
          const delta = Math.round((hash / 0xffffffff * 2 - 1) * operation.amplitude);
          for (const channel of operation.channels) result[offset + "rgba".indexOf(channel)] += delta;
        }
      }
      continue;
    }
    if (operation.operation === "fill_rect") {
      const rgba = parseHexRgba(operation.color);
      for (let y = operation.rect.y; y < operation.rect.y + operation.rect.height; y += 1) {
        for (let x = operation.rect.x; x < operation.rect.x + operation.rect.width; x += 1) {
          writePixel(result, width, x, y, rgba);
        }
      }
      continue;
    }

    if (operation.operation === "set_pixels") {
      const rgba = parseHexRgba(operation.color);
      for (const coordinate of operation.coordinates) {
        writePixel(result, width, coordinate.x, coordinate.y, rgba);
      }
      continue;
    }

    for (const coordinate of operation.coordinates) {
      writePixel(result, width, coordinate.x, coordinate.y, [0, 0, 0, 0]);
    }
  }

  return { pixels: result, ...plan };
}

export function buildPaintTransactionReceipt(input: {
  texture_uuid: string;
  texture_name: string;
  before_revision: string;
  after_revision: string;
  operation_count: number;
  pixel_writes: number;
  affected_rect: AffectedRect;
}) {
  const beforeRevision = textureRevisionSchema.parse(input.before_revision);
  const afterRevision = textureRevisionSchema.parse(input.after_revision);
  if (!input.texture_uuid.trim() || !input.texture_name.trim()) {
    throw new Error("Paint transaction receipt requires explicit texture identity.");
  }
  if (!Number.isSafeInteger(input.operation_count) || input.operation_count <= 0) {
    throw new Error("Paint transaction receipt operation_count must be positive.");
  }
  if (!Number.isSafeInteger(input.pixel_writes) || input.pixel_writes <= 0) {
    throw new Error("Paint transaction receipt pixel_writes must be positive.");
  }
  const [left, top, right, bottom] = input.affected_rect;
  if (
    ![left, top, right, bottom].every(Number.isSafeInteger) ||
    left < 0 ||
    top < 0 ||
    right <= left ||
    bottom <= top
  ) {
    throw new Error("Paint transaction receipt requires a finite non-empty affected_rect.");
  }
  if (beforeRevision === afterRevision) {
    throw new Error(
      "Paint transaction postcondition revision did not change; do not report an applied mutation receipt."
    );
  }

  return {
    execution: "applied" as const,
    texture: {
      uuid: input.texture_uuid,
      name: input.texture_name,
    },
    revision: {
      before: beforeRevision,
      after: afterRevision,
    },
    operation_count: input.operation_count,
    pixel_writes: input.pixel_writes,
    affected_rect: input.affected_rect,
    affected_size: [right - left, bottom - top] as [number, number],
  };
}
