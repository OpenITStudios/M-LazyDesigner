import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCurrentClusterReferenceVerifier,
  verifyCurrentClusterReferenceClaims,
} from "./clusterReferenceEvidence";
import { readReferencePackageProjection } from "./referencePackage";
import type { executeNativeBoundClusterComposition } from "../../server/tools/paint/textureTransaction";

const RED_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCAk+Uzr4AAAAASUVORK5CYII=",
  "base64"
);
const BLUE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGNkYPj/n4GBgYGJAQoAHRkCAjRcHicAAAAASUVORK5CYII=",
  "base64"
);
const SHA = createHash("sha256").update(RED_PNG).digest("hex");
const roots: string[] = [];

function declaredImage(
  changes: Record<string, unknown> = {},
  regionChanges: Record<string, unknown> = {}
) {
  return {
    id: "IMG_FRONT",
    file: "images/front.png",
    role: "MATERIAL_TEXTURE",
    view: "front",
    used_by: ["TEXTURE"],
    status: "APPROVED",
    regions: [{
      id: "armor_plate", part_id: "chest_armor",
      evidence_role: "SURFACE_DETAIL", visibility: "DIRECT",
      box_uv: [0, 0, 1, 1], related_part_id: null,
      ...regionChanges,
    }],
    ...changes,
  };
}

async function createPackage(
  imageChanges: Record<string, unknown> = {},
  regionChanges: Record<string, unknown> = {}
) {
  const root = await mkdtemp(join(tmpdir(), "ld-cluster-ref-"));
  roots.push(root);
  await mkdir(join(root, "images"));
  await writeFile(join(root, "images/front.png"), RED_PNG);
  await writeFile(join(root, "REFERENCE.json"), JSON.stringify({
    schema: "lazydesigner-reference-v1",
    asset: { name: "Armor", kind: "MODEL", profile: "MECHANICAL" },
    parts: [{ id: "chest_armor", role: "TEXTURE" }],
    readiness: { overall: "READY", geometry: "READY", texture: "READY" },
    images: [declaredImage(imageChanges, regionChanges)],
  }));
  const projection = await readReferencePackageProjection(root);
  expect(projection.available).toBe(true);
  return { root, projection };
}

function face(overrides: Record<string, unknown> = {}) {
  return {
    cube_uuid: "armor_cube", face: "north" as const,
    source_claim: {
      image_id: "IMG_FRONT",
      image_sha256: SHA,
      image_region_id: "armor_plate",
      part_id: "chest_armor",
      observation_id: "hand_authored_shadow_01",
    },
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root =>
    rm(root, { recursive: true, force: true })
  ));
});

describe("Control-owned reference proof for internal pixel cluster painting", () => {
  test("checks actual approved PNG bytes and annotated visible part, never visual PASS", async () => {
    const { root, projection } = await createPackage();
    const request = {
      reference_package_path: root,
      expected_reference_fingerprint: projection.fingerprint!,
      faces: [face()],
    };
    const receipt = await verifyCurrentClusterReferenceClaims(request);
    expect(receipt).toMatchObject({
      state: "source_bytes_and_region_annotations_matched",
      image_count: 1, face_claim_count: 1,
      image_bytes_attested: true,
      surface_region_annotations_attested: true,
      reference_cluster_shapes_attested: false,
      source_to_native_face_correspondence_attested: false,
      human_approval_attested: false,
      painting_authorized: false,
      visual_verdict: "not_evaluated",
      source_images: [{ image_id: "IMG_FRONT", sha256: SHA }],
    });
    const trustedIdentity = {
      reference_package_path: root,
      expected_reference_fingerprint: projection.fingerprint!,
    };
    const trusted: Parameters<typeof executeNativeBoundClusterComposition>[1] =
      createCurrentClusterReferenceVerifier(trustedIdentity);
    // The trusted reference authority remains pinned for the second
    // callback even if a caller mutates its original settings object.
    trustedIdentity.expected_reference_fingerprint = "b".repeat(64);
    await expect(trusted([face()])).resolves.toBeUndefined();
  });

  test("rejects fake SHA and incorrect source-part/visible surface identity", async () => {
    const { root, projection } = await createPackage();
    const run = async (faceClaim: ReturnType<typeof face>) =>
      verifyCurrentClusterReferenceClaims({
        reference_package_path: root,
        expected_reference_fingerprint: projection.fingerprint!,
        faces: [faceClaim],
      });
    await expect(run(face({
      source_claim: {
        ...face().source_claim,
        image_sha256: "b".repeat(64),
      },
    }))).rejects.toThrow("CLUSTER_REFERENCE_IMAGE_IDENTITY_NOT_APPROVED");
    await expect(run(face({
      source_claim: {
        ...face().source_claim, part_id: "unrelated_part",
      },
    }))).rejects.toThrow("CLUSTER_REFERENCE_VISIBLE_REGION_UNVERIFIED");
    await expect(run(face({
      source_claim: {
        ...face().source_claim, image_region_id: "nonexistent",
      },
    }))).rejects.toThrow("CLUSTER_REFERENCE_VISIBLE_REGION_UNVERIFIED");
  });

  test("rejects draft, non-texture, occluded and volume-only sources", async () => {
    const cases = [
      [ { status: "DRAFT" }, {},
        "CLUSTER_REFERENCE_IMAGE_IDENTITY_NOT_APPROVED" ],
      [ { used_by: ["GEOMETRY"] }, {},
        "CLUSTER_REFERENCE_IMAGE_IDENTITY_NOT_APPROVED" ],
      [ {}, { evidence_role: "PRIMARY_VOLUME" },
        "CLUSTER_REFERENCE_VISIBLE_REGION_UNVERIFIED" ],
      [ {}, { visibility: "OCCLUDED", box_uv: null },
        "CLUSTER_REFERENCE_VISIBLE_REGION_UNVERIFIED" ],
    ] as const;
    for (const [image, region, expected] of cases) {
      const {root,projection}=await createPackage(image,region);
      await expect(verifyCurrentClusterReferenceClaims({
        reference_package_path:root,
        expected_reference_fingerprint:projection.fingerprint!,
        faces:[face()],
      })).rejects.toThrow(expected);
    }
  });

  test("rejects replacement image bytes, stale manifest revision and blocked texture readiness", async () => {
    const {root,projection}=await createPackage();
    const args = {
      reference_package_path:root,
      expected_reference_fingerprint:projection.fingerprint!,
      faces:[face()],
    };
    await writeFile(join(root,"images/front.png"),BLUE_PNG);
    await expect(verifyCurrentClusterReferenceClaims(args))
      .rejects.toThrow("CLUSTER_REFERENCE_PACKAGE_CHANGED_OR_BLOCKED");

    const next=await createPackage();
    const manifest = {
      schema:"lazydesigner-reference-v1",
      asset:{name:"Armor",kind:"MODEL"},
      parts:[{id:"chest_armor",role:"TEXTURE"}],
      readiness:{texture:"BLOCKED"},
      images:[declaredImage()],
    };
    await writeFile(join(next.root,"REFERENCE.json"),JSON.stringify(manifest));
    const blocked=await readReferencePackageProjection(next.root);
    await expect(verifyCurrentClusterReferenceClaims({
      reference_package_path:next.root,
      expected_reference_fingerprint:blocked.fingerprint!,
      faces:[face()],
    })).rejects.toThrow("CLUSTER_REFERENCE_PACKAGE_CHANGED_OR_BLOCKED");

    const another=await createPackage();
    await writeFile(join(another.root,"REFERENCE.json"),JSON.stringify({
      schema:"lazydesigner-reference-v1",
      asset:{name:"Armor V2",kind:"MODEL"},
      parts:[{id:"chest_armor",role:"TEXTURE"}],
      images:[declaredImage()],
    }));
    await expect(verifyCurrentClusterReferenceClaims({
      reference_package_path:another.root,
      expected_reference_fingerprint:another.projection.fingerprint!,
      faces:[face()],
    })).rejects.toThrow("CLUSTER_REFERENCE_PACKAGE_CHANGED_OR_BLOCKED");
  });

  test("rejects duplicate/invalid face claims and budgets before filesystem reads", async () => {
    const {root,projection}=await createPackage();
    const args={
      reference_package_path:root,
      expected_reference_fingerprint:projection.fingerprint!,
    };
    await expect(verifyCurrentClusterReferenceClaims({...args,faces:[]}))
      .rejects.toThrow("CLUSTER_REFERENCE_FACE_BUDGET");
    await expect(verifyCurrentClusterReferenceClaims({
      ...args,faces:[face(),face()],
    })).rejects.toThrow("CLUSTER_REFERENCE_DUPLICATE_FACE");
    await expect(verifyCurrentClusterReferenceClaims({
      ...args,faces:[face({face:"diagonal"}) as ReturnType<typeof face>],
    })).rejects.toThrow("CLUSTER_REFERENCE_CLAIM_INVALID");
    await expect(verifyCurrentClusterReferenceClaims({
      ...args,faces:[face({
        source_claim:{...face().source_claim,observation_id:""},
      })],
    })).rejects.toThrow("CLUSTER_REFERENCE_CLAIM_INVALID");
    await expect(verifyCurrentClusterReferenceClaims({
      ...args,faces:Array.from({length:17},(_,i)=>face({
        cube_uuid:"cube"+i,
      }))],
    })).rejects.toThrow("CLUSTER_REFERENCE_FACE_BUDGET");
    await expect(verifyCurrentClusterReferenceClaims({
      ...args,expected_reference_fingerprint:"not-a-hash",faces:[face()],
    })).rejects.toThrow("CLUSTER_REFERENCE_PACKAGE_IDENTITY_REQUIRED");
  });
});
