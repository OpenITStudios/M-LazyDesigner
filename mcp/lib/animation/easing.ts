import { z } from "zod";

export const animationEasingSchema = z.object({
  curve: z.enum(["sine", "quad", "cubic"]),
  direction: z.enum(["in", "out", "in_out"]),
  replace_existing: z.boolean().default(false),
}).strict().describe(
  "Minecraft Bedrock Entity (bedrock) only. Whole-clip Molang time remapping. Reapply after changing clip length or loop mode. Existing Molang requires replace_existing=true."
);

type AnimationEasingOptions = z.infer<typeof animationEasingSchema>;
type Curve = AnimationEasingOptions["curve"];
type Direction = AnimationEasingOptions["direction"];
type Loop = "once" | "hold" | "loop";
type EasingNamespace = "lazydesigner" | "blockit";

const CURVES: readonly Curve[] = ["sine", "quad", "cubic"];
const DIRECTIONS: readonly Direction[] = ["in", "out", "in_out"];
const LOOP_MODES: readonly Loop[] = ["once", "hold", "loop"];

function easingClock(id: string, namespace: EasingNamespace): string {
  return "v." + namespace + "_ease_" +
    Array.from(id, (character) => character.codePointAt(0)!.toString(16)).join("_");
}

function easingTimeline(id: string, namespace: EasingNamespace): string {
  return "t." + namespace + "_ease_t";
}

/** Keep the original mathematical curve contract; change only the generated namespace. */
function buildWithNamespace(
  id: string,
  duration: number,
  loop: string,
  options: AnimationEasingOptions,
  namespace: EasingNamespace
): string {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Easing requires a positive finite animation length.");
  }
  if (!LOOP_MODES.includes(loop as Loop)) {
    throw new Error("Unsupported animation loop mode.");
  }
  if (!id || id.length > 128) {
    throw new Error("Easing requires an exact bounded animation identity.");
  }
  const clock = easingClock(id, namespace);
  const t = easingTimeline(id, namespace);
  const power = options.curve === "quad" ? 2 : 3;
  let expression: string;
  if (options.curve === "sine") {
    expression = options.direction === "in"
      ? "1-math.cos(" + t + "*90)"
      : options.direction === "out"
        ? "math.sin(" + t + "*90)"
        : "(1-math.cos(" + t + "*180))/2";
  } else {
    const pow = (value: string) => "math.pow(" + value + "," + power + ")";
    expression = options.direction === "in"
      ? pow(t)
      : options.direction === "out"
        ? "1-" + pow("1-" + t)
        : t + "<0.5?" + pow("2*" + t) + "/2:1-" + pow("2-2*" + t) + "/2";
  }
  const advance = clock + "=(" + clock + "??0)+q.delta_time;";
  const bound = loop === "loop"
    ? clock + "=math.mod(" + clock + "," + duration + ");"
    : loop === "once"
      ? clock + ">" + duration + "?{return " + (duration + 0.1) + ";};"
      : "";
  return "q.anim_time==0?{" + clock + "=0;};" +
    advance + bound + t + "=math.clamp(" + clock + "/" + duration + ",0,1);" +
    "return (" + expression + ")*" + duration + ";";
}

/** Generates new scripts with the canonical LazyDesigner runtime variable namespace. */
export function buildAnimationEasing(
  id: string,
  duration: number,
  loop: string,
  options: AnimationEasingOptions
): string {
  return buildWithNamespace(id, duration, loop, options, "lazydesigner");
}

export type AuthoredAnimationEasingInspection =
  | { state: "external" }
  | { state: "modified_generated" }
  | {
      state: "owned";
      curve: Curve;
      direction: Direction;
      duration: number;
      loop: Loop;
      source_namespace: "canonical" | "legacy";
    };

/**
 * Exact-match source ownership: never infer an easing from a partial Molang
 * snippet or overwrite arbitrary user script. Old BlockIT-owned data is read
 * ONLY to detect a safe one-way rewrite into canonical LazyDesigner output.
 */
export function inspectAuthoredAnimationEasing(
  animationId: string,
  value: string
): AuthoredAnimationEasingInspection {
  if (!value) return { state: "external" };
  for (const namespace of ["lazydesigner", "blockit"] as const) {
    const clock = easingClock(animationId, namespace);
    const startMarker = easingTimeline(animationId, namespace) +
      "=math.clamp(" + clock + "/";
    const index = value.indexOf(startMarker);
    if (index < 0) continue;
    const start = index + startMarker.length;
    const end = value.indexOf(",0,1);return ", start);
    if (end < start) return { state: "modified_generated" };
    const duration = Number(value.slice(start, end));
    if (!Number.isFinite(duration) || duration <= 0) {
      return { state: "modified_generated" };
    }
    for (const loop of LOOP_MODES) {
      for (const curve of CURVES) {
        for (const direction of DIRECTIONS) {
          if (value === buildWithNamespace(
            animationId, duration, loop,
            { curve, direction, replace_existing: false },
            namespace
          )) {
            return {
              state: "owned",
              curve,
              direction,
              duration,
              loop,
              source_namespace: namespace === "lazydesigner" ? "canonical" : "legacy",
            };
          }
        }
      }
    }
    return { state: "modified_generated" };
  }
  if (value.includes("v.lazydesigner_ease_") ||
      value.includes("v.blockit_ease_") ||
      value.includes("t.lazydesigner_ease_t") ||
      value.includes("t.blockit_ease_t")) {
    return { state: "modified_generated" };
  }
  return { state: "external" };
}
