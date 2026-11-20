/** Read-only bounded Rust inspection selector transport; no model or host authority. */
import {PLAN_LIMIT,nonempty,wholeNumber} from './sdk-inputs.mjs';
// Multiple focused read selectors, using one Rust document load. The program
// host still owns filesystem permissions; this is not an OS sandbox.
const INSPECTION_QUERY_FIELDS = Object.freeze({
  authoring_target: ['domain', 'category', 'name'],
  cube: ['uuid'],
  cube_surfaces: ['uuid'],
  cube_face_alpha: ['uuid'],
  cube_uv_sharing: ['uuid', 'texture_uuid'],
  geometry_impact: ['cube_uuid','change'],
  asset_handoff: ['texture_uuid', 'offset', 'limit'],
  model_texture_coverage: ['offset', 'limit', 'attention_only'],
  material_pair: ['reference_uuid', 'candidate_uuid', 'reference_region', 'candidate_region'],
  material_face_patch: ['texture_uuid','cube_uuid','face','region','face_spans'],
  texture_styling: ['texture_uuid','region'],
  texture_source_colors: ['texture_uuid','region','offset','limit'],
  texture_styling_face: ['texture_uuid','cube_uuid','face'],
  catalog: ['category', 'offset', 'limit'],
  texture: ['index'],
  texture_alpha: ['uuid'],
  animation: ['uuid'],
  animation_track: ['animation_uuid', 'bone_uuid', 'offset', 'limit'],
  animation_transform_track: ['animation_uuid', 'bone_uuid', 'channel', 'offset', 'limit'],
  animation_effect_events: ['animation_uuid', 'offset', 'limit'],
  animation_timeline_markers: ['animation_uuid', 'offset', 'limit'],
  audit: [],
});

// Exact cropped atlas evidence. Identical physical dimensions are enforced in Rust.
// Region limits match the existing owned 256x256 RGBA8 Paint decoder.
function materialPatchRegion(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !['from', 'to'].includes(key))) {
    throw new TypeError('MATERIAL_PAIR_REGION_INVALID');
  }
  const point = xy => {
    if (!Array.isArray(xy) || xy.length !== 2) {
      throw new TypeError('MATERIAL_PAIR_REGION_INVALID');
    }
    return xy.map(n => Number(wholeNumber(n, 'material coordinate', 0, 256)));
  };
  const from = point(value.from), to = point(value.to);
  if (from[0] >= to[0] || from[1] >= to[1]) {
    throw new TypeError('MATERIAL_PAIR_REGION_INVALID');
  }
  if ((to[0]-from[0])*(to[1]-from[1]) > 4096) {
    throw new TypeError('MATERIAL_PAIR_REGION_TOO_LARGE');
  }
  return {from, to};
}
export function serializeInspectionQueries(requests) {
  if (!Array.isArray(requests) || requests.length < 1 || requests.length > 8) {
    throw new TypeError('Inspection batch must contain 1 through 8 selectors');
  }
  const selected = requests.map((query) => {
    if (!query || typeof query !== 'object' || Array.isArray(query)) {
      throw new TypeError('Inspection selector must be an object');
    }
    const kind = nonempty(query.kind, 'kind');
    const allowed = Object.hasOwn(INSPECTION_QUERY_FIELDS, kind)
      ? INSPECTION_QUERY_FIELDS[kind] : null;
    if (!allowed || Object.keys(query).some((key) =>
      key !== 'kind' && !allowed.includes(key))) {
      throw new TypeError('Unknown inspection selector or field');
    }
    const output = { kind };
    for (const field of allowed) {
      if (query[field] === undefined) continue;
      const value = query[field];
      if (field === 'offset' || field === 'limit' || field === 'index') {
        output[field] = Number(wholeNumber(
          value, field, field === 'limit' ? 1 : 0,
          field === 'limit' ? (kind === 'model_texture_coverage' ? 8 :
            kind === 'animation_effect_events' ? 16 :
            kind === 'animation_timeline_markers' || kind === 'asset_handoff' ? 32 : 64) :
            (field === 'offset' && kind === 'asset_handoff' ? 393216 :
              field === 'offset' && kind === 'texture_source_colors' ? 4096 : 65536),
        ));
      } else if (field === 'face_spans') {
        // Exact face-local row spans; only Rust maps them through rotated UV.
        if(kind!=='material_face_patch' || !Array.isArray(value) ||
           value.length<1 || value.length>64) {
          throw new TypeError('MATERIAL_FACE_SPANS_INVALID');
        }
        output.face_spans=value.map(span=>{
          if(!span || typeof span!=='object' || Array.isArray(span) ||
             Object.keys(span).some(key=>!['y','x0','x1'].includes(key)) ||
             !['y','x0','x1'].every(key=>Number.isInteger(span[key])) ||
             span.y<0 || span.y>=256 || span.x0<0 || span.x0>=span.x1 ||
             span.x1>256) {
            throw new TypeError('MATERIAL_FACE_SPANS_INVALID');
          }
          return {y:span.y,x0:span.x0,x1:span.x1};
        });
      } else if (field === 'attention_only') {
        if (typeof value !== 'boolean') {
          throw new TypeError('Inspection attention_only must be a boolean');
        }
        output.attention_only = value;
      } else if (field === 'change') {
        if (kind !== 'geometry_impact' ||
            !['reshape','translate','texture','pose'].includes(value)) {
          throw new TypeError('GEOMETRY_IMPACT_CHANGE_INVALID');
        }
        output.change = value;
      } else if (field === 'channel') {
        if (!['rotation', 'position', 'scale'].includes(value)) {
          throw new TypeError('Unsupported transform channel');
        }
        output.channel = value;
      } else if (field === 'domain') {
        if (!['geometry','uv','texturing','animation'].includes(value)) {
          throw new TypeError('Unknown authoring domain');
        }
        output.domain = value;
      } else if (field === 'name' && kind === 'authoring_target') {
        if (typeof value !== 'string' || value !== value.trim() ||
            !value.length || [...value].length > 128 ||
            /[\x00-\x1f\x7f]/.test(value)) {
          throw new TypeError('AUTHORING_TARGET_NAME_INVALID');
        }
        output.name = value;
      } else if (field === 'category') {
        if (!['cubes', 'bones', 'textures', 'animations'].includes(value)) {
          throw new TypeError('Unknown catalog category');
        }
        output.category = value;
      } else if (field === 'reference_region' || field === 'candidate_region' ||
                 field === 'region') {
        output[field] = materialPatchRegion(value);
      } else if (field === 'face') {
        if (!['north','east','south','west','up','down'].includes(value)) {
          throw new TypeError('MATERIAL_FACE_SIDE_UNKNOWN');
        }
        output.face = value;
      } else {
        output[field] = nonempty(value, field);
        if (Buffer.byteLength(output[field], 'utf8') > 128) {
          throw new TypeError('Inspection UUID is too long');
        }
        if (['material_face_patch','texture_styling_face',
             'texture_source_colors'].includes(kind) &&
            (field === 'texture_uuid' || field === 'cube_uuid') &&
            /[\s\x00-\x1f\x7f]/.test(output[field])) {
          throw new TypeError('MATERIAL_FACE_UUID_INVALID');
        }
      }
    }
    if (kind === 'authoring_target' &&
        !({geometry:['cubes','bones'],uv:['cubes'],
           texturing:['cubes','textures'],animation:['bones','animations']}[
           output.domain] ?? []).includes(output.category)) {
      throw new TypeError('AUTHORING_TARGET_DOMAIN_MISMATCH');
    }
    for (const field of allowed) {
      if (!['offset', 'limit', 'attention_only', 'face_spans'].includes(field) && output[field] === undefined) {
        throw new TypeError('Missing required inspection selector field: ' + field);
      }
    }
    return output;
  });
  const encoded = JSON.stringify({ requests: selected });
  if (Buffer.byteLength(encoded, 'utf8') > PLAN_LIMIT) {
    throw new TypeError('INSPECT_BATCH_SIZE_INVALID');
  }
  return { payload: encoded, normalized: selected };
}

