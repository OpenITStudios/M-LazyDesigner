import { assessInlinePaintImageEvidence } from "../../lib/texture/inlinePaintImageEvidence";

/**
 * During an explicit, still-open authoring cohort, suppress only the
 * independently validated inline PNG from a successful paint transaction.
 * Its native edit, revision receipt, Control visual debt and final review
 * remain unchanged. Default/single-call and COMPLETE paths retain the PNG.
 *
 * This saves an AI-visible image block, NOT native PNG encoding time and
 * NEVER certifies perceptual inspection or artistic quality.
 */
export function maybeDeferPaintCohortImage(input: {
  capability: string;
  succeeded: boolean;
  cohortBoundary?: "CONTINUE" | "COMPLETE";
  taskContextId?: string | null;
  /** Verified native/project affinity, never an arbitrary caller UUID. */
  projectUuid?: string | null;
  structuredContent?: unknown;
  content: unknown;
}): unknown {
  if(input.capability!=="paint_texture_transaction" ||
     !input.succeeded || input.cohortBoundary!=="CONTINUE" ||
     typeof input.taskContextId!=="string" ||
     !input.taskContextId.trim() ||
     typeof input.projectUuid!=="string" || !input.projectUuid.trim() ||
     !Array.isArray(input.content)) {
    return input.content;
  }
  if(assessInlinePaintImageEvidence(
    input.structuredContent,input.content
  ).state!=="MATCHED") return input.content;

  // Fail closed if the producer changes its text/shape. Do not silently
  // remove warnings, paths or any image other than the exact paint preview.
  const signal="The attached PNG is the exact affected atlas region after mutation.";
  const notices=input.content.filter(x=>x && typeof x==="object" &&
    !Array.isArray(x) && (x as {type?:unknown}).type==="text" &&
    typeof (x as {text?:unknown}).text==="string" &&
    (x as {text:string}).text.includes(signal));
  if(notices.length!==1) return input.content;

  return input.content
    .filter(x=>!x || typeof x!=="object" || Array.isArray(x) ||
      (x as {type?:unknown}).type!=="image")
    .map(x=>x && typeof x==="object" && !Array.isArray(x) &&
      (x as {type?:unknown}).type==="text" &&
      typeof (x as {text?:unknown}).text==="string"
        ? {...x,text:(x as {text:string}).text.replace(signal,
          "The affected-region PNG was withheld during this explicitly deferred cohort; visual review remains required at COMPLETE.")}
        : x);
}
