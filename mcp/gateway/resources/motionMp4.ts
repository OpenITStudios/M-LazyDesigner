import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import {
  MOTION_MP4_RESOURCE_URI_TEMPLATE,
  parseMotionMp4ResourceUri,
} from "@/lib/animation/motionEvidence";
import type { BlockitRuntimeBackend } from "../runtime/backend";

/**
 * Exactly one unlisted binary resource proxy through the current four-tool
 * Gateway. This DOES NOT surface a new tool or expose a user video player.
 * Runtime owns media bytes; Gateway owns bound-project transport identity.
 * A resource read is not evidence that Sol interpreted temporal motion.
 */
export function registerMotionMp4GatewayResource(
  server: McpServer,
  backend: Pick<BlockitRuntimeBackend, "readMotionMp4Resource">
):void {
  server.registerResource(
    "motion_mp4_evidence",
    new ResourceTemplate(MOTION_MP4_RESOURCE_URI_TEMPLATE,{list:undefined}),
    {
      description:"AI-only revision-bound binary MP4 resource; availability and AI motion review are not implied.",
    },
    async uri=>{
      parseMotionMp4ResourceUri(uri.href);
      return backend.readMotionMp4Resource(uri.href);
    }
  );
}
