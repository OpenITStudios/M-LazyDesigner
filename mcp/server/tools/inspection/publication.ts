/// <reference types="blockbench-types" />
import { createTool, type ToolSpec } from "@/lib/factories";
import { STATUS_EXPERIMENTAL } from "@/lib/constants";
import { publicationRenderParameters } from "@/lib/publication/contracts";
import { renderPublication } from "@/server/publication/execute";

/** One native implementation shared by the AI capability and Plugin UI. */
export const publicationRenderToolDoc: ToolSpec = {
  name: "render_publication",
  description: "Produce a source-faithful Cycles PNG from current real Blockbench Cube geometry and bitmap pixels. Requires a user-authorized Blender 5.2 executable and absolute PNG destination. Returns a bounded DRAFT receipt; never visual QA PASS. Transparent/PBR/non-Cube semantics outside the supported bridge fail explicitly.",
  annotations: {
    title: "Render Publication PNG (Blender Cycles)",
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
  parameters: publicationRenderParameters,
  status: STATUS_EXPERIMENTAL,
};

export function registerPublicationRenderTool(): void {
  createTool(
    publicationRenderToolDoc.name,
    {
      ...publicationRenderToolDoc,
      async execute(args) {
        const receipt = await renderPublication(args);
        return {
          content: [{
            type: "text" as const,
            text: "Publication Cycles PNG created at " + receipt.output_path +
              ". Source revision was rechecked. This is a DRAFT, not visual QA or user approval.",
          }],
          structuredContent: receipt,
        };
      },
    },
    publicationRenderToolDoc.status,
  );
}
