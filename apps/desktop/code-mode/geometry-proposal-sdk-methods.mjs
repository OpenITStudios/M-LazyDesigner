/**
 * Three bounded, source-SHA-bound read-only Geometry proposal SDK methods.
 * Owns transport of Rust planning inputs and verification of native proposal
 * receipts, never a voxel compiler, EditPlan publisher or permission grant.
 *
 * The parent client.mjs supplies its single trusted CLI "call" transport,
 * absolute-path guard and digest validation; no second Rust runner exists.
 * SOURCE_ONLY / TEST_AUTHORED_NOT_RUN.
 */
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SHA256} from './sdk-inputs.mjs';
import {
  generatedBlockoutCubeUuid,generatedSweepCubeUuid,generatedProfileCubeUuid,
  serializeGeometryAssembly,serializeGeometryAttachment,serializeGeometryPropagation,
} from './geometry-plan-input-transport.mjs';
import {validAxisAlignedOverlapReview} from './geometry-overlap-review.mjs';
import {normalizedGeometryVoidZones,validGeometryVoidEvidence}
  from './geometry-void.mjs';

export function createGeometryProposalSdkMethods({call,absolute,hash}) {
  return {
    async planGeometryResizePropagation({ input, expectedSha256, propagation }) {
      const digest = hash(expectedSha256).toLowerCase();
      const source = absolute(input, 'input');
      const payload = serializeGeometryPropagation(propagation);
      const directory = await mkdtemp(join(tmpdir(), 'lazydesigner-propagation-'));
      const file = join(directory, 'propagation.json');
      try {
        await writeFile(file, payload, { encoding:'utf8', mode:0o600, flag:'wx' });
        const receipt = await call('plan-geometry-resize-propagation', {
          input:source, 'expected-sha256':digest, propagation:file,
        });
        const plan = receipt.plan, preview = receipt.preflight;
        const diagnostic = receipt.diagnostic;
        const first = plan?.operations?.[0];
        const remainder = Array.isArray(plan?.operations) ?
          plan.operations.slice(1) : [];
        const targets = new Set(propagation.links.map(link=>link.moving_cube_uuid));
        const declaredParents = new Map(propagation.links.map(link=>[
          link.moving_cube_uuid, link.anchor_cube_uuid,
        ]));
        const rows = diagnostic?.ordered_links;
        const rowTargets = Array.isArray(rows) ?
          new Set(rows.map(row=>row?.moving_cube_uuid)) : new Set();
        const changedRows = Array.isArray(rows) ?
          rows.filter(row=>row?.status === 'translation_planned') : [];
        if (typeof receipt.sha256 !== 'string' ||
            receipt.sha256.toLowerCase() !== digest ||
            receipt.summary?.revision !== 0 ||
            !plan || plan.expected_revision !== 0 ||
            plan.correction_scope !== null ||
            !Array.isArray(plan.operations) ||
            plan.operations.length < 1 || plan.operations.length > 33 ||
            first?.op !== 'reframe_cube' ||
            first.uuid !== propagation.resize_cube_uuid ||
            first.uv_policy !== propagation.uv_policy ||
            !Array.isArray(first.from) || !Array.isArray(first.to) ||
            first.from.length !== 3 || first.to.length !== 3 ||
            !first.from.every((v,i)=>v === propagation.from?.[i]) ||
            !first.to.every((v,i)=>v === propagation.to?.[i]) ||
            remainder.some(op=>op?.op !== 'translate_cube' ||
              !targets.has(op.uuid) ||
              !Array.isArray(op.delta) || op.delta.length !== 3 ||
              !op.delta.every(Number.isFinite)) ||
            new Set(remainder.map(op=>op.uuid)).size !== remainder.length ||
            preview?.status !== 'VALIDATED_NOT_APPLIED' ||
            preview.base_revision !== 0 ||
            preview.mutation?.revision !== 1 ||
            preview.mutation.operation_count !== plan.operations.length ||
            !Array.isArray(preview.mutation.changed_uuids) ||
            preview.mutation.changed_uuids.length !== plan.operations.length ||
            preview.mutation.changed_uuids.some((uuid,i)=>
              uuid !== plan.operations[i].uuid) ||
            preview.candidate_summary?.revision !== 1 ||
            typeof preview.candidate_sha256 !== 'string' ||
            !SHA256.test(preview.candidate_sha256) ||
            preview.write_authority !== 'NOT_GRANTED' ||
            preview.visual_verdict !== 'UNVERIFIED' ||
            diagnostic?.scope !== 'one_shot_same_bone_resize_propagation' ||
            diagnostic.resize_cube_uuid !== propagation.resize_cube_uuid ||
            typeof diagnostic.parent_bone_uuid !== 'string' ||
            diagnostic.dependency_count !== propagation.links.length ||
            diagnostic.translated_count !== remainder.length ||
            diagnostic.unchanged_count !== propagation.links.length - remainder.length ||
            !Array.isArray(rows) || rows.length !== propagation.links.length ||
            rowTargets.size !== targets.size ||
            [...rowTargets].some(uuid=>!targets.has(uuid)) ||
            rows.some(row=>!row ||
              declaredParents.get(row.moving_cube_uuid) !== row.anchor_cube_uuid ||
              !Array.isArray(row.delta) || row.delta.length !== 3 ||
              !row.delta.every(Number.isFinite) ||
              !['translation_planned','already_aligned'].includes(row.status) ||
              (row.status === 'already_aligned' &&
                row.delta.some(v=>v !== 0))) ||
            changedRows.length !== remainder.length ||
            changedRows.some((row,i)=>row.moving_cube_uuid !== remainder[i].uuid ||
              row.delta.some((value,j)=>value !== remainder[i].delta[j])) ||
            diagnostic.persistent_constraints !== false ||
            diagnostic.collision_verdict !== 'NOT_EVALUATED' ||
            !validAxisAlignedOverlapReview(diagnostic.aabb_overlap_review,
              new Set([propagation.resize_cube_uuid,...remainder.map(op=>op.uuid)])) ||
            diagnostic.visual_verdict !== 'UNVERIFIED' ||
            receipt.write_authority !== 'NOT_GRANTED' ||
            receipt.visual_verdict !== 'UNVERIFIED') {
          throw new Error('CODE_MODE_GEOMETRY_PROPAGATION_RECEIPT_INVALID');
        }
        return receipt;
      } finally {
        await rm(directory, { recursive:true, force:true });
      }
    },
    async planGeometryAttachment({ input, expectedSha256, attachment }) {
      const digest = hash(expectedSha256).toLowerCase();
      const source = absolute(input, 'input');
      const payload = serializeGeometryAttachment(attachment);
      const directory = await mkdtemp(join(tmpdir(), 'lazydesigner-face-attachment-'));
      const file = join(directory, 'attachment.json');
      try {
        await writeFile(file, payload, { encoding:'utf8', mode:0o600, flag:'wx' });
        const receipt = await call('plan-geometry-attachment', {
          input:source, 'expected-sha256':digest, attachment:file,
        });
        const plan = receipt.plan, preview = receipt.preflight;
        const op = plan?.operations?.[0], diagnostic = receipt.diagnostic;
        if (typeof receipt.sha256 !== 'string' ||
            receipt.sha256.toLowerCase() !== digest ||
            receipt.summary?.revision !== 0 ||
            !plan || plan.expected_revision !== 0 ||
            plan.correction_scope !== null ||
            !Array.isArray(plan.operations) || plan.operations.length !== 1 ||
            op?.op !== 'translate_cube' ||
            op.uuid !== attachment.moving_cube_uuid ||
            !Array.isArray(op.delta) || op.delta.length !== 3 ||
            !op.delta.every(Number.isFinite) ||
            preview?.status !== 'VALIDATED_NOT_APPLIED' ||
            preview.base_revision !== 0 || preview.mutation?.revision !== 1 ||
            preview.mutation.operation_count !== 1 ||
            !Array.isArray(preview.mutation.changed_uuids) ||
            !preview.mutation.changed_uuids.includes(attachment.moving_cube_uuid) ||
            preview.candidate_summary?.revision !== 1 ||
            typeof preview.candidate_sha256 !== 'string' ||
            !SHA256.test(preview.candidate_sha256) ||
            preview.write_authority !== 'NOT_GRANTED' ||
            preview.visual_verdict !== 'UNVERIFIED' ||
            diagnostic?.scope !== 'same_bone_axis_aligned_face_attachment' ||
            diagnostic.anchor_cube_uuid !== attachment.anchor_cube_uuid ||
            diagnostic.moving_cube_uuid !== attachment.moving_cube_uuid ||
            typeof diagnostic.parent_bone_uuid !== 'string' ||
            diagnostic.anchor_face !== attachment.anchor_face ||
            diagnostic.moving_face !== attachment.moving_face ||
            diagnostic.clearance !== attachment.clearance ||
            !Array.isArray(diagnostic.tangent_offset) ||
            diagnostic.tangent_offset.length !== 2 ||
            !diagnostic.tangent_offset.every((n,i) =>
              n === attachment.tangent_offset?.[i]) ||
            !Array.isArray(diagnostic.delta) ||
            diagnostic.delta.length !== 3 ||
            !diagnostic.delta.every((n,i) => n === op.delta[i]) ||
            diagnostic.collision_verdict !== 'NOT_EVALUATED' ||
            !validAxisAlignedOverlapReview(diagnostic.aabb_overlap_review,
              new Set([attachment.moving_cube_uuid])) ||
            diagnostic.visual_verdict !== 'UNVERIFIED' ||
            receipt.write_authority !== 'NOT_GRANTED' ||
            receipt.visual_verdict !== 'UNVERIFIED') {
          throw new Error('CODE_MODE_GEOMETRY_ATTACHMENT_RECEIPT_INVALID');
        }
        return receipt;
      } finally {
        await rm(directory, { recursive:true, force:true });
      }
    },
    async planGeometryAssembly({ input, expectedSha256, assembly }) {
      const digest = hash(expectedSha256).toLowerCase();
      const source = absolute(input, 'input');
      const zones=normalizedGeometryVoidZones(assembly);
      const payload = serializeGeometryAssembly(assembly);
      const directory = await mkdtemp(join(tmpdir(), 'lazydesigner-geometry-plan-'));
      const file = join(directory, 'assembly.json');
      try {
        await writeFile(file, payload, { encoding:'utf8', mode:0o600, flag:'wx' });
        // Read-only Rust compiler and opt-in saved-local negative-space
        // checks. No new writer, geometry engine or image-derived bounds.
        const args={input:source,'expected-sha256':digest,assembly:file};
        if (zones!==null) {
          const zoneFile=join(directory,'void-zones.json');
          await writeFile(zoneFile,JSON.stringify(zones),
            {encoding:'utf8',mode:0o600,flag:'wx'});
          args['void-zones']=zoneFile;
        }
        const receipt = await call('plan-geometry-assembly',args);
        const plan = receipt.plan, preview = receipt.preflight;
        // Bind each returned UUID to one declared Bone, Cube or G3 blockout
        // panel. All shape calculation remains in the canonical Rust owner.
        const declared = new Map();
        const proposedOperations = Array.isArray(plan?.operations)
          ? plan.operations : [];
        let declarationValid = true;
        for (const part of assembly.parts) {
          if (!part || typeof part !== 'object' || !part.bone ||
              !Array.isArray(part.cubes) ||
              (part.frames !== undefined && !Array.isArray(part.frames)) ||
              (part.hollow_boxes !== undefined &&
                !Array.isArray(part.hollow_boxes)) ||
              (part.arches !== undefined &&
                !Array.isArray(part.arches)) ||
              (part.sweeps !== undefined &&
                !Array.isArray(part.sweeps)) ||
              (part.profile_sweeps !== undefined &&
                !Array.isArray(part.profile_sweeps)) ||
              (part.lofts !== undefined && !Array.isArray(part.lofts)) ||
              (part.revolves !== undefined && !Array.isArray(part.revolves)) ||
              (part.rib_arrays !== undefined && !Array.isArray(part.rib_arrays))) {
            declarationValid = false;
            break;
          }
          const declare = (uuid, op, parent, name, blockout = false) => {
            if (typeof uuid !== 'string' || !uuid.length || declared.has(uuid)) {
              declarationValid = false;
            } else { declared.set(uuid, {op,parent,name,blockout}); }
          };
          declare(part.bone.uuid, 'add_bone', part.parent_uuid, part.bone.name);
          for (const cube of part.cubes) {
            declare(cube?.uuid, 'add_cube', part.bone.uuid, cube?.name);
          }
          for (const frame of part.frames ?? []) {
            if (!frame || !Array.isArray(frame.cube_uuids) ||
                frame.cube_uuids.length !== 4 || typeof frame.name !== 'string') {
              declarationValid = false;
              break;
            }
            ['left','right','bottom','top'].forEach((side,i) =>
              declare(frame.cube_uuids[i], 'add_cube', part.bone.uuid,
                frame.name+'_'+side,true));
          }
          for (const hollow of part.hollow_boxes ?? []) {
            if (!hollow || !Array.isArray(hollow.cube_uuids) ||
                hollow.cube_uuids.length !== 5 ||
                typeof hollow.name !== 'string') {
              declarationValid = false;
              break;
            }
            ['wall_a_low','wall_a_high','wall_b_low','wall_b_high','back']
              .forEach((side,i) =>
                declare(hollow.cube_uuids[i], 'add_cube', part.bone.uuid,
                  hollow.name+'_'+side,true));
          }
          for (const arch of part.arches ?? []) {
            const ids = arch?.cube_uuids;
            // Only verify transport shape/identity. Rust alone owns
            // semicircle math, source-validated dimensions and topology.
            if (!Array.isArray(ids) || ids.length < 5 || ids.length > 17 ||
                ids.length % 2 !== 1 || typeof arch?.name !== 'string') {
              declarationValid = false;
              break;
            }
            declare(ids[0], 'add_cube', part.bone.uuid,
              arch.name+'_left_pier',true);
            declare(ids[1], 'add_cube', part.bone.uuid,
              arch.name+'_right_pier',true);
            ids.slice(2).forEach((uuid,i) =>
              declare(uuid, 'add_cube', part.bone.uuid,
                arch.name+'_curve_'+(i+1),true));
          }
          for (const sweep of part.sweeps ?? []) {
            const mode=sweep?.interpolation ?? 'LINEAR';
            const curved=mode === 'CENTRIPETAL_CATMULL_ROM';
            const tolerance=sweep?.max_chord_error;
            if (!sweep || typeof sweep.uuid_seed !== 'string' ||
                typeof sweep.name !== 'string' ||
                !Array.isArray(sweep.stations) ||
                sweep.stations.length < (curved ? 3 : 2) ||
                sweep.stations.length > 8 ||
                (mode !== 'LINEAR' && !curved) ||
                (curved ?
                  !Number.isFinite(tolerance) ||
                    tolerance < 0.25 || tolerance > 1 :
                  tolerance !== undefined)) {
              declarationValid = false;
              break;
            }
            // Number of raster Cubes is known only after canonical Rust
            // partition. Bind each observed index to its seed-derived UUID;
            // missing indices, unexpected outputs and foreign owners fail.
            let count=0;
            while (count < 64) {
              const uuid=generatedSweepCubeUuid(sweep.uuid_seed,count);
              if (!proposedOperations.some(op =>
                op?.op === 'add_cube' && op.cube?.uuid === uuid)) break;
              declare(uuid,'add_cube',part.bone.uuid,
                sweep.name+'_v_'+count,true);
              count++;
            }
            if (count === 0) declarationValid = false;
          }
          for (const profile of part.profile_sweeps ?? []) {
            if (!profile || typeof profile.uuid_seed !== 'string' ||
                typeof profile.name !== 'string' ||
                !['X','Y','Z'].includes(profile.up_axis) ||
                !['ELLIPSE','RECTANGLE'].includes(profile.cross_section) ||
                !Array.isArray(profile.stations) ||
                profile.stations.length < 2 || profile.stations.length > 8 ||
                profile.stations.some(station => !station ||
                  (station.twist_degrees !== undefined &&
                    (!Number.isFinite(station.twist_degrees) ||
                      Math.abs(station.twist_degrees) > 180)))) {
              declarationValid = false;
              break;
            }
            // Only the canonical Rust partition knows its output count.
            // Bind the contiguous UUID index namespace, Bone and name;
            // all actual geometry and bounded preflight remain Rust-owned.
            let count=0;
            while (count < 64) {
              const uuid=generatedProfileCubeUuid(profile.uuid_seed,count);
              if (!proposedOperations.some(op =>
                op?.op === 'add_cube' && op.cube?.uuid === uuid)) break;
              declare(uuid,'add_cube',part.bone.uuid,
                profile.name+'_v_'+count,true);
              count++;
            }
            if (count === 0) declarationValid = false;
          }
          // LOFT and REVOLVE reuse the canonical Rust voxel partition.
          // This checks transport limits and source UUID identities only.
          for (const [kind, shapes] of [
            ['loft',part.lofts ?? []], ['revolve',part.revolves ?? []],
          ]) {
            if (shapes.length > 4) { declarationValid=false; break; }
            for (const shape of shapes) {
              const valid = shape &&
                typeof shape.name === 'string' &&
                typeof shape.uuid_seed === 'string' &&
                ['X','Y','Z'].includes(shape.axis) &&
                Array.isArray(shape.origin) && shape.origin.length === 3 &&
                shape.origin.every(n => Number.isInteger(n) && Math.abs(n) <= 64) &&
                Array.isArray(shape.sections) &&
                shape.sections.length >= 2 && shape.sections.length <= 12 &&
                shape.sections.every(section =>
                  section && Number.isInteger(section.height) &&
                  section.height >= 0 && section.height <= 32 &&
                  (kind === 'loft' ?
                    Array.isArray(section.center) && section.center.length === 2 &&
                    section.center.every(n => Number.isFinite(n) && Math.abs(n) <= 16) &&
                    Array.isArray(section.size) && section.size.length === 2 &&
                    section.size.every(n => Number.isInteger(n) && n >= 1 && n <= 32) :
                    Number.isInteger(section.outer_radius) &&
                    section.outer_radius >= 1 && section.outer_radius <= 12 &&
                    Number.isInteger(section.inner_radius) &&
                    section.inner_radius >= 0 &&
                    section.inner_radius + 1 <= section.outer_radius));
              if (!valid) { declarationValid=false; break; }
              let count=0;
              while (count < 64) {
                const uuid=generatedBlockoutCubeUuid(
                  'geometry-'+kind+'-v1',shape.uuid_seed,count);
                if (!proposedOperations.some(op =>
                  op?.op === 'add_cube' && op.cube?.uuid === uuid)) break;
                declare(uuid,'add_cube',part.bone.uuid,
                  shape.name+'_v_'+count,true);
                count++;
              }
              if (count === 0) { declarationValid=false; break; }
            }
            if (!declarationValid) break;
          }
          // G6: stable per-seed indices for a uniform, integer-spaced
          // sequence of native Cubes. Rust computes the actual boxes,
          // validates source UV and runs the canonical G1 preflight.
          for (const rib of part.rib_arrays ?? []) {
            const axis = {X:0,Y:1,Z:2}[rib?.axis];
            const bounds = rib && Array.isArray(rib.from) &&
              Array.isArray(rib.to) && rib.from.length===3 &&
              rib.to.length===3 && rib.from.every((v,i) =>
                Number.isInteger(v) && Number.isInteger(rib.to[i]) &&
                v>=-2147483648 && v<=2147483647 &&
                rib.to[i]>=-2147483648 && rib.to[i]<=2147483647 &&
                rib.to[i]>v);
            const valid = bounds && Number.isInteger(axis) &&
              typeof rib.name==='string' && !!rib.name.trim() &&
              typeof rib.uuid_seed==='string' && !!rib.uuid_seed &&
              Number.isInteger(rib.count) && rib.count>=2 &&
              rib.count<=128 && Number.isInteger(rib.thickness) &&
              rib.thickness>0 && rib.thickness<=4294967295;
            if (!valid) { declarationValid=false; break; }
            const width = rib.to[axis]-rib.from[axis];
            const gapRoom = width-rib.count*rib.thickness;
            if (gapRoom<=0 || gapRoom%(rib.count-1)!==0) {
              declarationValid=false; break;
            }
            for (let i=0;i<rib.count;i++) {
              const uuid=generatedBlockoutCubeUuid(
                'geometry-rib-array-v1',rib.uuid_seed,i);
              declare(uuid,'add_cube',part.bone.uuid,
                rib.name+'_rib_'+i,true);
            }
          }
        }
        const used = new Set();
        const operationIdentityValid = Array.isArray(plan?.operations) &&
          plan.operations.every(op => {
            const uuid = op?.op === 'add_bone' ? op.bone?.uuid : op?.cube?.uuid;
            const claim = declared.get(uuid);
            if (!claim || claim.op !== op.op || used.has(uuid)) return false;
            used.add(uuid);
            return op.op === 'add_bone' ?
              op.parent_uuid === claim.parent && op.bone?.name === claim.name :
              op.bone_uuid === claim.parent && op.cube?.name === claim.name &&
                (!claim.blockout || op.cube?.box_uv === true);
          });
        const expected = declared.size;
        if (!declarationValid || expected < 1 || expected > 128 ||
            typeof receipt.sha256 !== 'string' ||
            receipt.sha256.toLowerCase() !== digest ||
            receipt.summary?.revision !== 0 ||
            !plan || plan.expected_revision !== 0 ||
            plan.correction_scope !== null ||
            !Array.isArray(plan.operations) ||
            plan.operations.length < 1 || plan.operations.length !== expected ||
            plan.operations.length > 128 || !operationIdentityValid ||
            used.size !== expected ||
            plan.operations.some(op => !op ||
              !['add_bone','add_cube'].includes(op.op)) ||
            preview?.status !== 'VALIDATED_NOT_APPLIED' ||
            preview.base_revision !== 0 || preview.mutation?.revision !== 1 ||
            preview.mutation?.operation_count !== plan.operations.length ||
            !Array.isArray(preview.mutation?.changed_uuids) ||
            preview.mutation.changed_uuids.length !== plan.operations.length ||
            preview.mutation.changed_uuids.some((uuid,i) =>
              uuid !== (plan.operations[i].op === 'add_bone' ?
                plan.operations[i].bone.uuid : plan.operations[i].cube.uuid)) ||
            preview.candidate_summary?.revision !== 1 ||
            typeof preview.candidate_sha256 !== 'string' ||
            !SHA256.test(preview.candidate_sha256) ||
            preview.write_authority !== 'NOT_GRANTED' ||
            preview.visual_verdict !== 'UNVERIFIED' ||
            receipt.write_authority !== 'NOT_GRANTED' ||
            receipt.visual_verdict !== 'UNVERIFIED') {
          throw new Error('CODE_MODE_GEOMETRY_ASSEMBLY_RECEIPT_INVALID');
        }
        if (!validGeometryVoidEvidence(receipt.void_evidence,zones)) {
          throw new Error('CODE_MODE_GEOMETRY_VOID_EVIDENCE_INVALID');
        }
        return receipt;
      } finally {
        await rm(directory, { recursive:true, force:true });
      }
    },
  };
}
