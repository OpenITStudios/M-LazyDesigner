# Modelling

Owns geometry/modelling policy and profile-specific modelling knowledge.

```text
standard.md
profiles/README.md
profiles/<selected-profile>.md
knowledge-curation.md   (conditional: curation contract)
decision-cases.md      (conditional: G1 source-grounded decision examples)
```

`standard.md` owns the universal **Bedrock-native representation and anti-overcube policy**, including Adaptive Cuboid Budget, Marginal Geometry Value, Representation Ladder, segmented-curve rules, and the cohort merge/remove challenge. Profiles may specialize asset decisions but must not replace those universal rules with fixed Cube counts.

[Geometry Knowledge Curation](knowledge-curation.md) defines gap-first case selection and acceptance. The bounded [G1 decision casebook](decision-cases.md) holds eight paired source-grounded examples with explicit exceptions, not a second modelling policy or ready-to-execute asset presets.

AI load rule: load `standard.md` plus exactly one primary profile by default. Secondary profile guidance must be narrow and decision-specific. Load `knowledge-curation.md` only for corpus planning/evaluation; read a casebook section only when a concrete unresolved Geometry decision requires its source/exception evidence. The Runtime does not yet index these cases.
