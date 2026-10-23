export type UvPackingRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type UvPackingItem = {
  id: string;
  width: number;
  height: number;
  padding_x: number;
  padding_y: number;
  allow_rotate_90: boolean;
  priority: number;
  /** Optional authored grouping; equal dimensions alone never imply sharing. */
  semantic_group?: string;
  original_rect?: UvPackingRect;
};

export type UvPackingPlacement = {
  id: string;
  rect: UvPackingRect;
  footprint: UvPackingRect;
  rotated_90: boolean;
};

export type UvPackingCandidate = {
  backend: "maxrects_v1";
  canvas: {
    width: number;
    height: number;
  };
  placements: UvPackingPlacement[];
  free_rectangles: UvPackingRect[];
};
