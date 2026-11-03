#!/usr/bin/env node
// Verify a visual challenge result AFTER the AI has returned its 12 color letters.
// This reads no files or MCP secrets, costs no external API call and does not
// assert any general visual QA or temporal motion correctness.
import { createHash } from "node:crypto";

const [nonce,sha256,rawAnswer] = process.argv.slice(2);
const answer = typeof rawAnswer === "string"
  ? rawAnswer.trim().toUpperCase().replace(/\s+/g,"") : "";
const wellFormed =
  typeof nonce==="string" && /^[0-9a-f]{32}$/.test(nonce) &&
  typeof sha256==="string" && /^[0-9a-f]{64}$/.test(sha256) &&
  /^[RGBYCM]{12}$/.test(answer);
if(!wellFormed){
  process.stderr.write("Usage: node mcp/scripts/qa/verify-mcp-image-probe.mjs <nonce> <expected_sha256> <12_RGBYCM_letters>\n");
  process.exitCode=2;
}else{
  const digest=createHash("sha256")
    .update(["LAZYDESIGNER_MCP_IMAGE_PROBE_V1",nonce,answer].join("\n"))
    .digest("hex");
  const pass=digest===sha256;
  process.stdout.write(JSON.stringify({
    check:"AI_PIXEL_INGESTION_CHALLENGE",
    result:pass?"MATCH":"MISMATCH",
    inference:pass?"MODEL_ANSWER_MATCHES_PIXELS_CHALLENGE":"AI_PIXEL_INGESTION_UNVERIFIED",
    note:"A match does not certify asset fidelity, animation motion, or other AI clients.",
  })+"\n");
  if(!pass)process.exitCode=1;
}
