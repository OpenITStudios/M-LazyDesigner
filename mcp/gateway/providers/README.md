# Gateway Providers

This folder owns Gateway-local capabilities that do not come from the Blockbench Runtime catalog.

- `registry.ts` — local provider registry and merge order with Runtime search results.
- `vanillaEntityReference.ts` — optional read-only vanilla Bedrock entity reference provider.
- `blenderRender.ts` — independent Gateway-owned `blender_render` MCP capability. Consumes bounded, source-checked Blockbench GLB handoffs and controls the shared Cycles worker via start/status/preview/cancel. One strict schema covers AI discovery and invocation, source/worker hashes are retained in the receipt, and status without an ID recovers the latest process-local job. No interactive Blender modeling API, second MCP server or duplicate 3D engine.

Root files `gateway/localCapabilities.ts` and `gateway/vanillaEntityReference.ts` are compatibility re-exports only. New Gateway-local providers belong here and must remain lazily probed so they do not inflate normal AI context.
