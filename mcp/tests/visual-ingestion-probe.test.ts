import { describe,expect,test } from "bun:test";
import { createHash } from "node:crypto";
import {
  prepareVisualIngestionProbe,verifyVisualIngestionProbeResponse,VISUAL_PROBE_DOMAIN,
} from "@/lib/protocol/visualIngestionProbe";
import { captureModelViewsParameters } from "@/server/tools/inspection/camera";
import { animationAwareCaptureModelViewsParameters } from "@/server/runtime/animationRuntimeContracts";

describe("explicit MCP image ingestion challenge",()=>{
  test("independent answer proof and wrong answer rejection",()=>{
    const p=prepareVisualIngestionProbe(Uint8Array.from(
      Array.from({length:28},(_,i)=>i)));
    expect(p.answer).toHaveLength(12);
    expect(p.expected_answer_sha256).toBe(createHash("sha256").update(
      [VISUAL_PROBE_DOMAIN,p.nonce,p.answer].join("\n")).digest("hex"));
    expect(verifyVisualIngestionProbeResponse(
      p.nonce,p.expected_answer_sha256,p.answer)).toBe(true);
    expect(verifyVisualIngestionProbeResponse(
      p.nonce,p.expected_answer_sha256,"RRRRRRRRRRRR")).toBe(false);
  });
  test("probe opt-in, never part of animation pose media count",()=>{
    const base={views:["front"] as ["front"],front_direction:"+z" as const};
    expect(captureModelViewsParameters.safeParse(base).success).toBe(true);
    expect(captureModelViewsParameters.safeParse({
      ...base,ai_ingestion_probe:true}).success).toBe(true);
    expect(animationAwareCaptureModelViewsParameters.safeParse({
      ...base,ai_ingestion_probe:true,
      animation_preview:{animation_id:"test",times:[0,0.25]},
    }).success).toBe(false);
  });
  test("challenge has real image bytes but no model consumption claim",async()=>{
    const s=await Bun.file("lib/protocol/visualIngestionProbe.ts").text();
    expect(s).toContain('canvas.toDataURL("image/png")');
    expect(s).toContain("ai_pixel_perception_attested:false");
    expect(s).toContain("visual_pass_authorized:false");
    const camera=await Bun.file("server/tools/inspection/camera.ts").text();
    expect(camera).toContain("content.push(ingestionProbe.image)");
  });
});
