// Fixed model-space camera axes for source-bound Rust viewport evidence.
// Camera direction is where the viewer stands relative to model center.
// This is a Three.js preview convention, NOT Bedrock/native camera proof.
export const REVIEW_VIEW_IDS = ['front','back','left','right','top','bottom'] as const;
export type ReviewViewId = (typeof REVIEW_VIEW_IDS)[number];
export type ReviewCameraAxes = {
  direction: readonly [number,number,number];
  up: readonly [number,number,number];
};
const CAMERA_AXES: Record<ReviewViewId,ReviewCameraAxes> = {
  front:{direction:[0,0,1],up:[0,1,0]},
  back:{direction:[0,0,-1],up:[0,1,0]},
  left:{direction:[-1,0,0],up:[0,1,0]},
  right:{direction:[1,0,0],up:[0,1,0]},
  top:{direction:[0,1,0],up:[0,0,-1]},
  bottom:{direction:[0,-1,0],up:[0,0,1]},
};
export function reviewCameraAxes(viewId: ReviewViewId): ReviewCameraAxes | null {
  return Object.hasOwn(CAMERA_AXES,viewId) ? CAMERA_AXES[viewId] : null;
}
