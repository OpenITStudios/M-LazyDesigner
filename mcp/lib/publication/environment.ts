import { z } from "zod";
import { extname } from "node:path";
import { isAbsoluteFilesystemPath } from "@/lib/core/path";

export const publicationEnvironmentSchema = z.object({
  mode: z.enum(["studio", "hdri"]).default("studio"),
  hdri_path: z.string().min(5).max(2048).refine(
    value => isAbsoluteFilesystemPath(value) &&
      /\.(?:hdr|exr)$/i.test(value) &&
      !/[\x00-\x1f]/.test(value) &&
      !/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(value),
    "Choose an absolute, explicitly authorized .hdr or .exr file.",
  ).optional(),
}).strict().superRefine((data, ctx) => {
  if (data.mode === "hdri" && !data.hdri_path) {
    ctx.addIssue({ code: "custom", message: "HDRI mode needs a selected local file." });
  }
  if (data.mode === "studio" && data.hdri_path) {
    ctx.addIssue({ code: "custom", message: "Studio mode must not load an undeclared HDRI." });
  }
});

export type PublicationEnvironmentRequest = z.infer<typeof publicationEnvironmentSchema>;
export type PublicationEnvironmentJob = Readonly<{
  mode: "studio" | "hdri";
  hdri_path: string | null;
  hdri_sha256: string | null;
}>;

export function validateHdriBytes(path: string, bytes: Buffer): void {
  if (!Buffer.isBuffer(bytes) || bytes.length < 16 ||
      bytes.length > 64 * 1024 * 1024) {
    throw new Error("PUBLICATION_HDRI_EMPTY_OR_TOO_LARGE");
  }
  const extension = extname(path).toLowerCase();
  if (extension === ".exr") {
    if (bytes.toString("hex", 0, 4) !== "762f3101") {
      throw new Error("PUBLICATION_HDRI_EXR_SIGNATURE_INVALID");
    }
  } else if (extension === ".hdr") {
    if (!bytes.subarray(0, 32).toString("ascii").startsWith("#?RADIANCE") &&
        !bytes.subarray(0, 32).toString("ascii").startsWith("#?RGBE")) {
      throw new Error("PUBLICATION_HDRI_RADIANCE_SIGNATURE_INVALID");
    }
  } else {
    throw new Error("PUBLICATION_HDRI_EXTENSION_NOT_SUPPORTED");
  }
}
