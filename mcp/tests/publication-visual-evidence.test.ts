import { describe, expect, test } from "bun:test";
import { publicationControlParameters } from "@/server/tools/inspection/publication";
import { manifestEntriesForCapability } from "@/gateway/capabilities/manifest";

const job = "render_" + "a".repeat(24);

describe("Explicit real Cycles visual evidence on the existing MCP capability", () => {
  test("the preview operation requires an existing opaque render job ID only", () => {
    const ok = publicationControlParameters.parse({
      operation: "preview", job_id: job,
    });
    expect(ok).toEqual({ operation: "preview", job_id: job });
    for (const invalid of [
      { operation: "preview", job_id: "not-a-job" },
      { operation: "preview", job_id: job, output_path: "/tmp/other.png" },
      { operation: "preview", job_id: job, code: "import os" },
      { operation: "preview", image_url: "https://example.com/example.png" },
      { operation: "status", job_id: job, include_png: true },
    ]) {
      expect(publicationControlParameters.safeParse(invalid).success).toBe(false);
    }
  });

  test("preview is a fourth branch, not a new Gateway tool or an aesthetic verdict", () => {
    const branches = manifestEntriesForCapability("render_publication");
    expect(branches.map(x => x.branch?.value)).toEqual([
      "start", "status", "preview", "cancel",
    ]);
    const preview = branches.find(x => x.branch?.value === "preview");
    expect(preview).toMatchObject({
      operationClass: "QUERY",
      executionClass: "fast",
      verificationClass: "receipt_only",
    });
  });

  test("source only retrieves bounded genuine Blender image from a completed job", async () => {
    const [worker, executor, tool, jobs] = await Promise.all([
      Bun.file(new URL("../server/publication/worker/quality_report.py", import.meta.url)).text(),
      Bun.file(new URL("../server/publication/execute.ts", import.meta.url)).text(),
      Bun.file(new URL("../server/tools/inspection/publication.ts", import.meta.url)).text(),
      Bun.file(new URL("../server/publication/jobs.ts", import.meta.url)).text(),
    ]);
    expect(worker).toContain("EVIDENCE_MAX_SIDE = 384");
    expect(worker).toContain("make_visual_evidence_png(job)");
    expect(worker).toContain("DOWNSAMPLED_FINAL_CYCLES_PNG");
    expect(executor).toContain("inspectPublicationPng(");
    expect(executor).toContain("evidenceBytes");
    expect(executor).toContain("validatedEvidence.set(completed, evidenceBytes)");
    expect(jobs).toContain('job.state !== "RENDERED_DRAFT"');
    expect(tool).toContain('type: "image" as const');
    expect(tool).toContain('mimeType: "image/png"');
    expect(tool).toContain('data: evidence.png.toString("base64")');
  });
});
