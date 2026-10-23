import type {
  UvPackingCandidate,
  UvPackingItem,
  UvPackingPlacement,
  UvPackingRect,
} from "@/lib/uv/packing/types";

function requirePositiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number.`);
  }
  return value;
}

function requireNonNegativeFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number.`);
  }
  return value;
}

function intersects(a: UvPackingRect, b: UvPackingRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function contains(a: UvPackingRect, b: UvPackingRect): boolean {
  return (
    b.x >= a.x &&
    b.y >= a.y &&
    b.x + b.width <= a.x + a.width &&
    b.y + b.height <= a.y + a.height
  );
}

function splitFreeRectangle(
  free: UvPackingRect,
  used: UvPackingRect
): UvPackingRect[] {
  if (!intersects(free, used)) return [free];
  const result: UvPackingRect[] = [];

  if (used.x > free.x) {
    result.push({
      x: free.x,
      y: free.y,
      width: used.x - free.x,
      height: free.height,
    });
  }
  if (used.x + used.width < free.x + free.width) {
    result.push({
      x: used.x + used.width,
      y: free.y,
      width: free.x + free.width - (used.x + used.width),
      height: free.height,
    });
  }
  if (used.y > free.y) {
    result.push({
      x: free.x,
      y: free.y,
      width: free.width,
      height: used.y - free.y,
    });
  }
  if (used.y + used.height < free.y + free.height) {
    result.push({
      x: free.x,
      y: used.y + used.height,
      width: free.width,
      height: free.y + free.height - (used.y + used.height),
    });
  }

  return result.filter(
    (rect) => rect.width > 1e-9 && rect.height > 1e-9
  );
}

function pruneFreeRectangles(
  rectangles: readonly UvPackingRect[]
): UvPackingRect[] {
  return rectangles.filter(
    (rect, index) =>
      !rectangles.some(
        (other, otherIndex) =>
          index !== otherIndex && contains(other, rect)
      )
  );
}

function subtractUsed(
  freeRectangles: readonly UvPackingRect[],
  used: UvPackingRect
): UvPackingRect[] {
  return pruneFreeRectangles(
    freeRectangles.flatMap((free) =>
      splitFreeRectangle(free, used)
    )
  );
}

function requireInsideCanvas(
  rect: UvPackingRect,
  width: number,
  height: number,
  label: string
): void {
  if (
    rect.x < 0 ||
    rect.y < 0 ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.x + rect.width > width ||
    rect.y + rect.height > height
  ) {
    throw new Error(`${label} is outside the UV packing canvas.`);
  }
}

type CandidatePlacement = {
  free_index: number;
  x: number;
  y: number;
  packed_width: number;
  packed_height: number;
  content_width: number;
  content_height: number;
  rotated_90: boolean;
  short_side_fit: number;
  long_side_fit: number;
};

function choosePlacement(
  item: UvPackingItem,
  freeRectangles: readonly UvPackingRect[]
): CandidatePlacement | null {
  const orientations = [
    {
      content_width: item.width,
      content_height: item.height,
      rotated_90: false,
    },
    ...(item.allow_rotate_90 && item.width !== item.height
      ? [{
          content_width: item.height,
          content_height: item.width,
          rotated_90: true,
        }]
      : []),
  ];

  let best: CandidatePlacement | null = null;
  for (let freeIndex = 0; freeIndex < freeRectangles.length; freeIndex += 1) {
    const free = freeRectangles[freeIndex];
    for (const orientation of orientations) {
      const packedWidth =
        orientation.content_width + item.padding_x * 2;
      const packedHeight =
        orientation.content_height + item.padding_y * 2;
      if (
        packedWidth > free.width + 1e-9 ||
        packedHeight > free.height + 1e-9
      ) {
        continue;
      }
      const leftoverHorizontal = free.width - packedWidth;
      const leftoverVertical = free.height - packedHeight;
      const candidate: CandidatePlacement = {
        free_index: freeIndex,
        x: free.x,
        y: free.y,
        packed_width: packedWidth,
        packed_height: packedHeight,
        content_width: orientation.content_width,
        content_height: orientation.content_height,
        rotated_90: orientation.rotated_90,
        short_side_fit: Math.min(
          leftoverHorizontal,
          leftoverVertical
        ),
        long_side_fit: Math.max(
          leftoverHorizontal,
          leftoverVertical
        ),
      };

      if (
        !best ||
        candidate.short_side_fit < best.short_side_fit - 1e-9 ||
        (
          Math.abs(candidate.short_side_fit - best.short_side_fit) <= 1e-9 &&
          (
            candidate.long_side_fit < best.long_side_fit - 1e-9 ||
            (
              Math.abs(candidate.long_side_fit - best.long_side_fit) <= 1e-9 &&
              (
                candidate.y < best.y - 1e-9 ||
                (
                  Math.abs(candidate.y - best.y) <= 1e-9 &&
                  candidate.x < best.x - 1e-9
                )
              )
            )
          )
        )
      ) {
        best = candidate;
      }
    }
  }
  return best;
}

export function packMaxRects(
  items: readonly UvPackingItem[],
  width: number,
  height: number,
  occupied: readonly UvPackingRect[] = [],
  options: { ordering?: "area" | "semantic" } = {}
): UvPackingCandidate {
  const canvasWidth = requirePositiveFinite(width, "UV canvas width");
  const canvasHeight = requirePositiveFinite(height, "UV canvas height");

  let freeRectangles: UvPackingRect[] = [{
    x: 0,
    y: 0,
    width: canvasWidth,
    height: canvasHeight,
  }];

  for (const [index, rect] of occupied.entries()) {
    requireInsideCanvas(
      rect,
      canvasWidth,
      canvasHeight,
      `Occupied UV rect[${index}]`
    );
    for (let previous = 0; previous < index; previous += 1) {
      if (intersects(rect, occupied[previous])) {
        throw new Error(
          `Occupied UV rect[${index}] overlaps occupied UV rect[${previous}].`
        );
      }
    }
    freeRectangles = subtractUsed(freeRectangles, rect);
  }

  const ids = items.map((item) => item.id);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new Error(
      "MaxRects UV packing requires unique non-empty item IDs."
    );
  }

  const ordered = items
    .map((item) => {
      requirePositiveFinite(item.width, `UV item ${item.id} width`);
      requirePositiveFinite(item.height, `UV item ${item.id} height`);
      requireNonNegativeFinite(
        item.padding_x,
        `UV item ${item.id} padding_x`
      );
      requireNonNegativeFinite(
        item.padding_y,
        `UV item ${item.id} padding_y`
      );
      if (!Number.isFinite(item.priority)) {
        throw new Error(
          `UV item ${item.id} priority must be finite.`
        );
      }
      return item;
    })
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        // The optional semantic pass packs actual named cohorts together.
        // Preserve default area-first ordering when no locality pass runs.
        (options.ordering === "semantic" &&
        (a.semantic_group ?? "") !== (b.semantic_group ?? "")
          ? (a.semantic_group ?? "") < (b.semantic_group ?? "") ? -1 : 1
          : 0) ||
        (b.width + 2 * b.padding_x) *
            (b.height + 2 * b.padding_y) -
          (a.width + 2 * a.padding_x) *
            (a.height + 2 * a.padding_y) ||
        b.height - a.height ||
        b.width - a.width ||
        a.id.localeCompare(b.id)
    );

  const placements: UvPackingPlacement[] = [];
  for (const item of ordered) {
    const candidate = choosePlacement(item, freeRectangles);
    if (!candidate) {
      throw new Error(
        `MaxRects could not fit UV island ${item.id} into ${canvasWidth}x${canvasHeight} with the requested padding/rotation constraints.`
      );
    }

    const footprint: UvPackingRect = {
      x: candidate.x,
      y: candidate.y,
      width: candidate.packed_width,
      height: candidate.packed_height,
    };
    const rect: UvPackingRect = {
      x: candidate.x + item.padding_x,
      y: candidate.y + item.padding_y,
      width: candidate.content_width,
      height: candidate.content_height,
    };
    placements.push({
      id: item.id,
      rect,
      footprint,
      rotated_90: candidate.rotated_90,
    });
    freeRectangles = subtractUsed(freeRectangles, footprint);
  }

  placements.sort((a, b) => a.id.localeCompare(b.id));
  return {
    backend: "maxrects_v1",
    canvas: {
      width: canvasWidth,
      height: canvasHeight,
    },
    placements,
    free_rectangles: freeRectangles,
  };
}
