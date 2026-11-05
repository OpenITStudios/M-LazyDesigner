# Reference Images

Canonical visual-reference documentation.

```text
standard.md               unified sheet layout, panel economy, anti-drift
scale-and-escalation.md   Minecraft player scale + one-sheet vs multi-sheet rules
prompt-contract.md        internal generation prompt contract
master-templates.md       Sheet 01, Sheet 02+, correction prompt templates
reference-samples.md     approved positive visual guidelines and rejected historical QA evidence
```

AI load rule: start with `standard.md`; load the other files only when the current decision needs scale/escalation or prompt construction.

**Production four-side model route:** model authoring first (existing Geometry stage) → actual `capture_model_views` with explicit `["front","right","back","left"]` → automatically assembled native 2×2 PNG + source receipt → independent actual-pixel QA. This is NOT a ChatGPT image-generation function. Without a model/live Runtime, return `NATIVE_MODEL_REQUIRED` for the Geometry owner rather than fabricate production four-side images. `master-templates.md` remains image-only `ILLUSTRATIVE_CONCEPT` prompting, which cannot prove physical 3D consistency.

When a visual exemplar matters, consult [reference-samples.md](reference-samples.md) for approved-vs-rejected status and Library path. **MD-REF-01 is the sole approved positive sample; MD-REF-02 is REJECTED_VISUAL_QUALITY and quarantined under Library `Rejected/` for negative QA only, never new generation.** Inspect actual pixels; names, hashes or GitHub catalog text are not auto-loaded images or native modelling proof.
