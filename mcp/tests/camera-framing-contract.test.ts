import { describe, expect, test } from "bun:test";
import {
  buildModelViewReferenceComparison,
  captureModelViewsParameters,
  modelViewReferenceContract,
  prepareOffscreenPreview,
  resolveCaptureViewSelection,
  captureCameraSpecMetadata,
  recordCaptureImageDelivery,
  selectCaptureSizeForEvidence,
  selectModelViewsForEvidence,
} from "@/server/tools/inspection/camera";

const baseInput = {
  views: ["front"],
  front_direction: "+z",
} as const;

describe("lossless capture image evidence transport", () => {
  test("reuses only exact PNG bytes within one response, retaining each view identity", () => {
    const ledger = new Map();
    const first = recordCaptureImageDelivery(ledger, "MODEL", "front", "AQID");
    const same = recordCaptureImageDelivery(ledger, "MODEL", "back", "AQID");
    const different = recordCaptureImageDelivery(ledger, "MODEL", "left", "AQIE");
    expect(first).toMatchObject({ send_image: true, reused_from_view: null });
    expect(same).toMatchObject({
      image_sha256: first.image_sha256,
      send_image: false,
      reused_from_view: "front",
    });
    expect(different).toMatchObject({ send_image: true, reused_from_view: null });
    expect(different.image_sha256).not.toBe(first.image_sha256);
  });

  test("does not alias silhouette data to a shaded image or reuse another capture session", () => {
    const ledger = new Map();
    const model = recordCaptureImageDelivery(ledger, "MODEL", "front", "AQID");
    const silhouette = recordCaptureImageDelivery(ledger, "SILHOUETTE", "front", "AQID");
    const repeatedMask = recordCaptureImageDelivery(ledger, "SILHOUETTE", "right", "AQID");
    expect(model.send_image).toBe(true);
    expect(silhouette.send_image).toBe(true);
    expect(repeatedMask).toMatchObject({
      send_image: false, reused_from_view: "front",
    });
    expect(recordCaptureImageDelivery(new Map(), "MODEL", "back", "AQID").send_image).toBe(true);
  });

  test("runtime preserves per-view provenance, complete captures and bounded image delivery", async () => {
    const source = await Bun.file("server/tools/inspection/camera.ts").text();
    expect(source).toContain('image_sha256: modelImageDelivery.image_sha256');
    expect(source).toContain('reused_from_view: modelImageDelivery.reused_from_view');
    expect(source).toContain('all_requested_views_captured: true');
    expect(source).toContain('cross_revision_reuse: false');
    expect(source).toContain('content.push(image)');
    expect(source).toContain('content.push(silhouetteImage)');
    expect(source).toContain('reference_comparison: buildModelViewReferenceComparison(');
  });
});

describe("capture_model_views explicit framing contract", () => {
  test("requires either explicit views or evidence targets", () => {
    expect(
      captureModelViewsParameters.safeParse({ front_direction: "+z" }).success
    ).toBe(false);
    expect(
      captureModelViewsParameters.safeParse({
        front_direction: "+z",
        evidence_targets: ["depth"],
      }).success
    ).toBe(true);
  });

  test("selects the minimum high-information view set deterministically", () => {
    expect(selectModelViewsForEvidence(["width", "height", "silhouette"]).views).toEqual([
      "front",
    ]);
    expect(selectModelViewsForEvidence(["depth", "attachment"]).views).toEqual([
      "left",
    ]);
    expect(selectModelViewsForEvidence(["orientation", "layering"]).views).toEqual([
      "front_left_3q",
    ]);
    expect(selectModelViewsForEvidence(["rear_topology", "depth"]).views).toEqual([
      "left",
      "back",
    ]);
    expect(selectModelViewsForEvidence(["underside"]).views).toEqual(["bottom"]);
  });

  test("selects minimum evidence resolution by target detail and risk", () => {
    expect(selectCaptureSizeForEvidence(["width", "silhouette"], "LOW")).toBe(256);
    expect(selectCaptureSizeForEvidence(["depth"], "LOW")).toBe(384);
    expect(selectCaptureSizeForEvidence(["attachment"], "LOW")).toBe(512);
    expect(selectCaptureSizeForEvidence(["width"], "MEDIUM")).toBe(384);
    expect(selectCaptureSizeForEvidence(["width"], "HIGH")).toBe(512);
    expect(selectCaptureSizeForEvidence(["attachment"], "MEDIUM")).toBe(512);
  });

  test("expands evidence by risk without asking the model to choose cameras", () => {
    expect(selectModelViewsForEvidence(["width", "silhouette"], "LOW").views).toEqual([
      "front",
    ]);
    expect(selectModelViewsForEvidence(["width", "silhouette"], "MEDIUM").views).toEqual([
      "front",
      "left",
    ]);
    expect(selectModelViewsForEvidence(["width", "silhouette"], "HIGH").views).toEqual([
      "front",
      "left",
      "top",
    ]);
    expect(selectModelViewsForEvidence(["underside"], "MEDIUM")).toMatchObject({
      minimum_views: ["bottom"],
      expansion: ["front_left_3q"],
      views: ["bottom", "front_left_3q"],
    });
  });

  test("risk is forwarded by the runtime selection route", () => {
    expect(resolveCaptureViewSelection(undefined, ["width"], "LOW").views).toEqual(["front"]);
    expect(resolveCaptureViewSelection(undefined, ["width"], "MEDIUM")).toMatchObject({
      risk: "MEDIUM", minimum_views: ["front"], views: ["front", "left"], expansion: ["left"],
    });
    expect(resolveCaptureViewSelection(undefined, ["width"], "HIGH")).toMatchObject({
      risk: "HIGH", minimum_views: ["front"], views: ["front", "left", "top"], expansion: ["left", "top"],
    });
  });

  test("explicit views expose unsupported targets rather than pretending coverage", () => {
    expect(resolveCaptureViewSelection(["front"], ["width", "attachment"], "HIGH")).toMatchObject({
      views: ["front"], minimum_views: ["front"], expansion: [],
      coverage: [{view: "front", targets: ["width"]}],
      uncovered_targets: ["attachment"], risk: "HIGH",
    });
    expect(resolveCaptureViewSelection(["front", "left"], ["width", "attachment"], "MEDIUM")).toMatchObject({
      uncovered_targets: [], coverage: [
        {view: "front", targets: ["width"]},
        {view: "left", targets: ["attachment"]},
      ],
    });
    expect(resolveCaptureViewSelection(["front"], undefined, "LOW")).toMatchObject({
      requested_targets: [], uncovered_targets: [], views: ["front"],
    });
  });

  test("camera-plan metadata is independent of subsequent input object mutation", () => {
    const position: [number, number, number] = [2, 4, 6];
    const metadata = captureCameraSpecMetadata({
      view: "front", projection: "orthographic", position,
      target: [0, 0, 0], up: [0, 1, 0], zoom: 12,
    });
    expect(metadata).toEqual({
      projection: "orthographic", position: [2, 4, 6],
      target: [0, 0, 0], up: [0, 1, 0], zoom: 12, fov: null,
    });
    position[0] = 90;
    expect(metadata.position).toEqual([2, 4, 6]);
  });

  test("validates bounded landmark pairs before any capture or Cube lookup", () => {
    const source = {
      reference_image_id: "IMG_FRONT",
      reference_sha256: "a".repeat(64),
      landmark_id: "torso",
      reference_uv: [0.5, 0.5],
      view: "front",
      model_cube_uuid: "uuid-body",
    };
    expect(captureModelViewsParameters.safeParse({
      ...baseInput, landmark_pairs: [source],
    }).success).toBe(true);
    const invalid = [
      { ...source, view: "left" },
      { ...source, reference_uv: [1.1, 0.5] },
      { ...source, reference_uv: [Number.NaN, 0.5] },
      { ...source, reference_sha256: "not-a-hash" },
      { ...source, model_cube_uuid: "" },
    ];
    for (const pair of invalid) {
      expect(captureModelViewsParameters.safeParse({
        ...baseInput, landmark_pairs: [pair],
      }).success).toBe(false);
    }
    expect(captureModelViewsParameters.safeParse({
      front_direction: "+z", evidence_targets: ["width"], landmark_pairs: [source],
    }).success).toBe(false);
    expect(captureModelViewsParameters.safeParse({
      ...baseInput, landmark_pairs: [source, source],
    }).success).toBe(false);
    expect(captureModelViewsParameters.safeParse({
      ...baseInput, landmark_pairs: [
        source, { ...source, landmark_id: "eye", reference_sha256: "b".repeat(64) },
      ],
    }).success).toBe(false);
  });

  test("landmarks are only diagnostic projections of rendered Cube centers", async () => {
    const code = await Bun.file("server/tools/inspection/camera.ts").text();
    expect(code).toContain("getGlobalVertexPositions()");
    expect(code).toContain("cube.mesh.updateWorldMatrix(true, false)");
    expect(code).toContain(".project(camera)");
    expect(code).toContain('model_anchor: "CUBE_CENTER"');
    expect(code).toContain("source_camera_calibrated: false");
    expect(code).toContain("automatic_correction: false");
    expect(code).toContain("landmark_projections: landmarkProjections");
  });

  test("correspondence capture accepts bounded current-reference claims but no visual approval field", () => {
    const input = {
      recipe_id: "bedrock-chair",
      reference: {
        package_fingerprint: "a".repeat(64),
        current_package_fingerprint: "a".repeat(64),
        images: [{
          id: "IMG_FRONT", sha256: "b".repeat(64), integrity: "VERIFIED",
          status: "APPROVED", view: "front",
          regions: [{
            id: "seat-region", part_id: "seat",
            evidence_role: "PRIMARY_VOLUME", visibility: "DIRECT",
            box_uv: [0.1, 0.2, 0.8, 0.9], related_part_id: null,
          }],
        }],
        parts: [{ id: "seat", role: "GEOMETRY" }],
      },
      proposals: [{
        image_id: "IMG_FRONT", region_id: "seat-region", part_id: "seat",
        native_cube_uuids: ["cube-1", "cube-2"],
      }],
    };
    const asInput = (reference_correspondence: unknown) => ({
      ...baseInput, reference_correspondence,
    });
    expect(captureModelViewsParameters.safeParse(asInput(input)).success).toBe(true);
    expect(captureModelViewsParameters.safeParse(asInput({
      ...input, proposals: [{ ...input.proposals[0], native_cube_uuids: [] }],
    })).success).toBe(true); // Absence remains provisional, not "missing geometry".
    expect(captureModelViewsParameters.safeParse(asInput({
      ...input, proposals: [{ ...input.proposals[0], review: {
        outcome: "MATCHED", source_pixels_inspected: true,
      } }],
    })).success).toBe(false);
    expect(captureModelViewsParameters.safeParse(asInput({
      ...input, reference: { ...input.reference, images: [{
        ...input.reference.images[0], regions: [{
          ...input.reference.images[0].regions[0], evidence_role: "INVENTED",
        }],
      }] },
    })).success).toBe(false);
    expect(captureModelViewsParameters.safeParse(asInput({
      ...input, reference: { ...input.reference, package_fingerprint: "bad-hash" },
    })).success).toBe(false);
    expect(captureModelViewsParameters.safeParse(asInput({
      ...input, proposals: Array.from({ length: 17 }, () => input.proposals[0]),
    })).success).toBe(false);
  });

  test("existing capture binds correspondence to current saved recipe-owned native state", async () => {
    const captureSource = await Bun.file("server/tools/inspection/camera.ts").text();
    const nativeSource = await Bun.file("server/runtime/recipes/authoring/service.ts").text();
    expect(captureSource).toContain('name: "capture_model_views"');
    expect(captureSource).toContain("readRecipePartCaptureScope(");
    expect(captureSource).toContain("assessVisualPartCorrespondence({");
    expect(captureSource).toContain("source_authority: \"CALLER_SUPPLIED_NOT_VERIFIED_BY_RUNTIME\"");
    expect(captureSource).toContain("review_state: \"PENDING_ACTUAL_IMAGE_COMPARISON\"");
    expect(captureSource).toContain("automatic_correction: false");
    expect(captureSource).toContain("PART_CORRESPONDENCE_CAPTURE_STALE");
    expect(captureSource).not.toContain("createTool(\"part_correspondence\"");
    expect(nativeSource).toContain("assertAuthoringRecipeNativeMatchesCompiled(native, recipe)");
    expect(nativeSource).toContain("resolveSemanticIdentity(recipe, native,");
    expect(nativeSource).toContain("fingerprintAuthoringRecipeNativeSnapshot(native)");
    expect(nativeSource).toContain("RECIPE_OWNED_CUBES_ONLY");
  });

  test("caps automatic evidence selection at the five-view context budget", () => {
    const result = selectModelViewsForEvidence([
      "width",
      "height",
      "length",
      "depth",
      "silhouette",
      "count",
      "rear_topology",
      "asymmetry",
      "attachment",
      "negative_space",
      "layering",
      "orientation",
      "underside",
    ]);
    expect(result.views.length).toBeLessThanOrEqual(5);
    expect(new Set(result.views).size).toBe(result.views.length);
    const covered = new Set(
      result.coverage.flatMap((entry) => entry.targets)
    );
    const accounted = new Set([
      ...covered,
      ...result.uncovered_targets,
    ]);
    expect(accounted).toEqual(new Set(result.requested_targets));
  });

  test("prefers reference-paired views when information gain ties", () => {
    const result = selectModelViewsForEvidence(["height"]);
    expect(result.views).toEqual(["front"]);
    expect(modelViewReferenceContract(result.views[0]!).reference_slot).not.toBeNull();
  });

  test("icon sizes resize both native projection bases and explicit views retain runtime 512 fallback",()=>{
    expect(captureModelViewsParameters.parse(baseInput).size).toBeUndefined();
    for(const size of [32,48,512,1024]){
      const input=captureModelViewsParameters.parse({...baseInput,size});
      let dimensions:number[]=[];
      const preview={resize:(w:number,h:number)=>{dimensions=[w,h];},camPers:{aspect:0,updateProjectionMatrix(){}},camOrtho:{left:0,right:0,top:0,bottom:0,updateProjectionMatrix(){}}};
      prepareOffscreenPreview(preview as any,input.size);
      expect(dimensions).toEqual([size,size]);expect(preview.camPers.aspect).toBe(1);
      expect([preview.camOrtho.left,preview.camOrtho.right,preview.camOrtho.top,preview.camOrtho.bottom]).toEqual([-size/80,size/80,size/80,-size/80]);
    }
    for(const size of [0,31,1025,48.5])expect(captureModelViewsParameters.safeParse({...baseInput,size}).success).toBe(false);
  });
  test("uses overflow-safe midpoint math for accepted explicit envelopes", async () => {
    const cameraSource = await Bun.file(new URL("../server/tools/inspection/camera.ts", import.meta.url)).text();
    expect(cameraSource).toContain("min[0] + size[0] / 2");
    expect(cameraSource).toContain("min[1] + size[1] / 2");
    expect(cameraSource).toContain("min[2] + size[2] / 2");
    expect(cameraSource).not.toContain("(min[0] + max[0]) / 2");
    expect(cameraSource).toContain("this tool does not judge resemblance");
  });

  test("runtime binding exports risk, camera specs and honest proof boundaries", async () => {
    const code = await Bun.file("server/tools/inspection/camera.ts").text();
    expect(code).toContain("const selection = resolveCaptureViewSelection(");
    expect(code).toContain("verification_risk as VisualEvidenceRisk");
    expect(code).toContain("camera_spec: captureCameraSpecMetadata(spec)");
    expect(code).toContain("framing_bounds:");
    expect(code).toContain("uncovered_targets: selection.uncovered_targets");
    expect(code).toContain("native_camera_attested: false");
  });

  test("keeps model and explicit framing Cube-owned after retirement of 3D-assisted evidence", async () => {
    const cameraSource = await Bun.file(
      new URL("../server/tools/inspection/camera.ts", import.meta.url)
    ).text();
    expect(cameraSource).not.toContain("BlockItThreeDAssistedReference");
    expect(cameraSource).not.toContain("3D-Assisted Evidence");
    expect(cameraSource).toContain('framingInput.mode === "model"');
    expect(cameraSource).toContain("Model framing requires visible Cube geometry");
    expect(cameraSource).toContain("Explicit framing requires visible Cube geometry to capture.");
  });

  test("accepts a finite positive target envelope", () => {
    const result = captureModelViewsParameters.safeParse({
      ...baseInput,
      framing: {
        mode: "explicit",
        min: [-16, 0, -8],
        max: [16, 32, 8],
      },
    });
    expect(result.success).toBe(true);
  });

  test("rejects invalid or non-finite framing math before camera runtime", () => {
    const invalidFramings = [
      { mode: "explicit", min: [0, 0, 0], max: [Number.POSITIVE_INFINITY, 16, 16] },
      { mode: "explicit", min: [-1e308, 0, 0], max: [1e308, 16, 16] },
      { mode: "explicit", min: [0, 0, 0], max: [0, 16, 16] },
    ];
    for (const framing of invalidFramings) {
      const result = captureModelViewsParameters.safeParse({ ...baseInput, framing });
      expect(result.success).toBe(false);
    }
  });

  test("maps canonical captures to the approved five-preview board without scoring resemblance", () => {
    const comparison = buildModelViewReferenceComparison([
      "front",
      "left",
      "top",
      "back",
      "front_left_3q",
    ]);

    expect(comparison.board_layout).toBe(
      "UPPER:LEFT|FRONT|BACK;LOWER:TOP|FRONT_LEFT_3Q"
    );
    expect(comparison.visual_verdict).toBe("not_evaluated");
    expect(comparison.difference_first).toBe(true);
    expect(comparison.views.map((entry) => entry.reference_slot)).toEqual([
      "upper_front",
      "upper_left",
      "lower_top",
      "upper_back",
      "lower_front_left_3q",
    ]);
    expect(modelViewReferenceContract("left").primary_evidence).toContain("depth");
    expect(modelViewReferenceContract("right").reference_slot).toBeNull();
  });

  test("DIRECT core-view triad carries complete canonical correspondence without forcing five captures", () => {
    const comparison = buildModelViewReferenceComparison(["front", "left", "top"]);
    expect(comparison.views).toHaveLength(3);
    expect(comparison.views.map((entry) => entry.reference_slot)).toEqual([
      "upper_front",
      "upper_left",
      "lower_top",
    ]);
    expect(comparison.views.flatMap((entry) => entry.primary_evidence)).toEqual(
      expect.arrayContaining(["width", "height", "length", "depth", "negative_space"])
    );
    expect(comparison.visual_verdict).toBe("not_evaluated");
  });
});
