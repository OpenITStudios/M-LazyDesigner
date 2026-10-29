# Modelling

Owns geometry/modelling policy and profile-specific modelling knowledge.

```text
standard.md
profiles/README.md
profiles/<selected-profile>.md
knowledge-curation.md   (conditional: library enrichment/coverage only)
```

`standard.md` owns the universal **Bedrock-native representation and anti-overcube policy**, including Adaptive Cuboid Budget, Marginal Geometry Value, Representation Ladder, segmented-curve rules, and the cohort merge/remove challenge. Profiles may specialize asset decisions but must not replace those universal rules with fixed Cube counts.

[Geometry Knowledge Curation](knowledge-curation.md) defines gap-first case selection, evidence provenance and Recipe integration acceptance; it is **not** an additional normal authoring payload or a second modelling policy.

AI load rule: load `standard.md` plus exactly one primary profile by default. Secondary profile guidance must be narrow and decision-specific. Load `knowledge-curation.md` only for corpus planning/evaluation or when a material knowledge-source issue is being investigated.
