# Benchmark Scripts

This directory owns deterministic benchmark implementations and benchmark-only comparison fixtures.

```text
benchmark-authoring-orchestration.ts
benchmark-gateway-hot-path.ts
benchmark-gateway-replay-shadow.ts
benchmark-material-recipe.ts
benchmark-motion-recipe.ts
benchmark-parametric-authoring.ts
benchmark-semantic-invalidation-scope.ts
benchmark-semantic-rig.ts
benchmark-semantic-uv.ts
benchmark-zero-waste-bottlenecks.ts
benchmark-zero-waste-golden.ts
benchmark-zero-waste-total-context.ts
benchmark-zero-waste-workflow.ts
```

Benchmarks may import canonical product/runtime owners and measurement helpers, but production source must never depend on benchmark code. Invoke them through the `benchmark:*` package commands.

The existing `benchmark:zero-waste-workflow` now includes a
`targeted_geometry_texture_animation_evidence` source-contract scenario.
It compares planned shaded views/mask counts, revision-locked Texture crop
selection and focused authored-keyframe times. The counts and image pixel
areas are **synthetic selection proxies**; they do not measure actual
Blockbench PNGs, AI image consumption, Codex allowance or quality acceptance.
The existing opt-in Gateway trace measures actual returned MCP image-item
counts/bytes when a real execution becomes available. The Golden full-asset
benchmark still requires separate native/reference/human acceptance. No
verification CI or additional production tool is introduced.
