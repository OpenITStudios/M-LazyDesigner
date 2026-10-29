import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { getAllToolDefinitions } from "../lib/factories";
import "../server/tools";
import { exportModelParameters } from "../server/tools/export";

test("Bedrock animation export delegates every clip to native AnimationCodec without changing lifecycle", async () => {
  const clips = [{ name: "animation.citadel.test.idle" }, { name: "animation.citadel.test.death" }];
  const project = { name: "test", uuid: "test", save_path: "test.bbmodel", saved: true };
  const payload = { format_version: "1.8.0", animations: {
    [clips[0].name]: { loop: true }, [clips[1].name]: { loop: "hold_on_last_frame", animation_length: 6 },
  } };
  let calls = 0;
  const native: { compileFile: (items: unknown[]) => unknown } = { compileFile(items: unknown[]) {
    calls++; expect(this).toBe(native); expect(items).toEqual(clips);
    expect(items).not.toBe(clips); return payload;
  } };
  const globals = { Project: project, Format: { id: "bedrock" }, Codecs: {},
    Animation: { all: clips }, AnimationCodec: { codecs: { bedrock: native } } };
  const saved = Object.keys(globals).map(k => [k, Object.getOwnPropertyDescriptor(globalThis,k)] as const);
  const run = (args: Record<string, unknown> = {}) => getAllToolDefinitions().export_model.execute(
    exportModelParameters.parse({ codec_id: "bedrock_animation", max_content_length: 10000, ...args }));
  try {
    for (const [k,v] of Object.entries(globals)) Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});
    const result = await run() as { structuredContent: {
      content: string; wrote_to_path: null; truncated: boolean;
      compiled_payload_sha256: string;
      compiled_payload_sha256_scope: string;
      animation_export_identity: {
        state: string; source_clip_count: number; compiled_clip_count: number;
        clip_name_examples: string[]; visual_verdict: string;
        native_playback_attested: boolean; saved_file_attested: boolean;
      };
    } };
    expect(JSON.parse(result.structuredContent.content)).toEqual(payload);
    expect(result.structuredContent.compiled_payload_sha256).toBe(
      "sha256:" + createHash("sha256").update(result.structuredContent.content).digest("hex")
    );
    expect(result.structuredContent.compiled_payload_sha256_scope).toBe("NATIVE_CODEC_OUTPUT_BYTES");
    expect(result.structuredContent.animation_export_identity).toMatchObject({
      state: "SOURCE_CLIP_IDENTITIES_MATCHED",
      source_clip_count: 2, compiled_clip_count: 2,
      clip_name_examples: clips.map((clip) => clip.name),
      visual_verdict: "not_evaluated",
      native_playback_attested: false, saved_file_attested: false,
    });
    expect(result.structuredContent.truncated).toBe(false);
    expect(result.structuredContent.wrote_to_path).toBeNull();
    expect(project).toEqual({ name: "test", uuid: "test", save_path: "test.bbmodel", saved: true });
    const formats = JSON.parse(await getAllToolDefinitions().list_export_formats.execute({}) as string);
    expect(formats.codecs.find((c: { id: string }) => c.id === "bedrock_animation")).toMatchObject({ available: true, content_only: true });
    await expect(run({ path: "/tmp/test.animation.json" })).rejects.toThrow("content-only");
    await expect(run({ options: { selected_only: true } })).rejects.toThrow("content-only");
    await expect(run({ max_content_length: 0 })).rejects.toThrow("discard the requested deliverable");
    expect(calls).toBe(1);

    const truncated = await run({ max_content_length: 15 }) as {
      structuredContent: { truncated: boolean; content: string;
        animation_export_identity: { compiled_clip_count: number } };
      content: Array<{text: string}>;
    };
    expect(truncated.structuredContent.truncated).toBe(true);
    expect(truncated.structuredContent.animation_export_identity.compiled_clip_count).toBe(2);
    expect(truncated.content[0].text).toContain("not a complete deliverable");

    const originalCompile = native.compileFile;
    native.compileFile = () => ({
      format_version: "1.8.0", animations: { [clips[0].name]: { loop: true } }
    });
    await expect(run()).rejects.toThrow("BEDROCK_ANIMATION_EXPORT_IDENTITY_MISMATCH");
    native.compileFile = () => ({
      format_version: "1.8.0",
      animations: { ...payload.animations, "animation.citadel.unrequested": { loop: false } },
    });
    await expect(run()).rejects.toThrow("BEDROCK_ANIMATION_EXPORT_IDENTITY_MISMATCH");
    native.compileFile = () => JSON.stringify(payload);
    expect((await run() as { structuredContent: { animation_export_identity: { source_clip_count: number } } })
      .structuredContent.animation_export_identity.source_clip_count).toBe(2);
    native.compileFile = () => "{invalid-json";
    await expect(run()).rejects.toThrow("BEDROCK_ANIMATION_EXPORT_CONTENT_INVALID");
    native.compileFile = originalCompile;
    const animationGlobal = globals.Animation as { all?: unknown[] };
    animationGlobal.all = undefined;
    await expect(run()).rejects.toThrow("Animation.all");
    animationGlobal.all = [];
    native.compileFile = () => ({ format_version: "1.8.0", animations: {} });
    await expect(run()).rejects.toThrow("BEDROCK_ANIMATION_EXPORT_NO_CLIPS");
    animationGlobal.all = [clips[0], clips[0]];
    native.compileFile = () => ({ format_version: "1.8.0",
      animations: { [clips[0].name]: { loop: true } } });
    await expect(run()).rejects.toThrow("BEDROCK_ANIMATION_EXPORT_SOURCE_IDENTITY_INVALID");
    animationGlobal.all = clips;
    native.compileFile = originalCompile;
    expect(calls).toBe(2);
    native.compileFile = () => { throw new Error("native compile failure"); };
    await expect(run()).rejects.toThrow("native compile failure");
    expect(project.saved).toBe(true);
    Reflect.deleteProperty(globalThis,"AnimationCodec");
    await expect(run()).rejects.toThrow("not registered");
  } finally {
    for (const [k,v] of saved) { if (v) Object.defineProperty(globalThis,k,v); else Reflect.deleteProperty(globalThis,k); }
  }
});
