import { describe, expect, test } from "bun:test";
import { registerMotionMp4GatewayResource } from "@/gateway/resources/motionMp4";
import { parseMotionMp4ResourceUri } from "@/lib/animation/motionEvidence";

const uri =
  "motion-evidence://" + "a".repeat(32) + "/" +
  "b".repeat(64) + "/" + "c".repeat(64);

describe("existing Gateway carries one AI-only MP4 resource", () => {
  test("registers an unlisted fixed URI template without a fifth tool", async () => {
    let resourceName = "";
    let source = "";
    let listing: unknown = null;
    let reader: ((uri: URL) => Promise<unknown>) | null = null;
    const calls: string[] = [];
    const fakeServer = {
      registerResource(name: string, template: {uriTemplate:string; _uriTemplate?:string},
                       _metadata:unknown, callback:(uri:URL)=>Promise<unknown>) {
        resourceName = name;
        source = String(template.uriTemplate ?? template._uriTemplate ?? "");
        listing = template;
        reader = callback;
      },
    };
    const fakeBackend = {
      async readMotionMp4Resource(target:string) {
        calls.push(target);
        return {contents:[{uri:target,blob:"TEST_ONLY",mimeType:"video/mp4" as const}]};
      },
    };
    registerMotionMp4GatewayResource(
      fakeServer as unknown as Parameters<typeof registerMotionMp4GatewayResource>[0],
      fakeBackend
    );
    expect(resourceName).toBe("motion_mp4_evidence");
    expect(listing).not.toBeNull();
    expect(source).not.toContain("file://");
    const fn = reader as unknown as (url: URL)=>Promise<unknown>;
    expect(await fn(new URL(uri))).toMatchObject({
      contents:[{uri,mimeType:"video/mp4"}],
    });
    expect(calls).toEqual([uri]);
    expect(()=>parseMotionMp4ResourceUri("https://remote-untrusted/video.mp4")).toThrow();
    await expect(fn(new URL("file:///tmp/fake.mp4"))).rejects.toThrow(
      "MOTION_MP4_RESOURCE_URI_INVALID"
    );
    expect(calls).toHaveLength(1);
  });

  test("Gateway backend remains serialized and refuses non-Animation authority", async () => {
    const backend = await Bun.file("gateway/runtime/backend.ts").text();
    const gateway = await Bun.file("gateway/index.ts").text();
    expect(backend).toContain("async readMotionMp4Resource(uri: string)");
    expect(backend).toContain("return this.runExclusive(async () => {");
    expect(backend).toContain('this.authoringPhase!=="animation"');
    expect(backend).toContain("validateMotionMp4ResourceRead(uri,data)");
    expect(backend).toContain("this.client.readResource(");
    expect(gateway).toContain("registerMotionMp4GatewayResource(server,backend)");
    expect(gateway).toContain("registerCoreGatewayTools(");
    expect(gateway).not.toContain("registerCoreGatewayToolsWithVideo(");
  });
});
