// G4 source-only receipt guard. Data may inform a reviewer but cannot grant
// contact/UV exclusivity, artistic acceptance or any mutation authority.
const id=/^[A-Za-z0-9_-]{1,128}$/;
const changes=new Set(['reshape','translate','texture','pose']);
const reasons=new Set([
  'SAME_PARENT_NEIGHBORS_NOT_CONTACT_PROOF',
  'SAVED_UV_AND_ATLAS_REQUIRE_REVIEW',
  'OTHER_ATLAS_USERS_NOT_UV_ALIAS_PROOF',
  'IMPLICIT_TEXTURE_BINDINGS_UNRESOLVED',
  'ANIMATED_BONE_POSES_REQUIRE_REVIEW',
  'REFERENCE_VISUAL_FIDELITY_UNVERIFIED',
]);
const keys=[
  'scope','cube_uuid','change','parent_bone_uuid',
  'ancestor_count','ancestor_bone_uuids','ancestors_truncated','dimensions',
  'same_parent_cube_uuids','same_parent_cube_count','same_parent_truncated',
  'declared_texture_uuids','same_atlas_cube_uuids','same_atlas_cube_count',
  'same_atlas_truncated','texture_relations_complete','matching_animation_uuids',
  'matching_animation_count','matching_animation_truncated',
  'animation_relation_verdict','review_reasons','collision_verdict',
  'visual_verdict','write_authority','source_change_verdict',
];
const ids=(a,lim)=>Array.isArray(a)&&a.length<=lim&&
  a.every(x=>typeof x==='string'&&id.test(x))&&new Set(a).size===a.length;
const relation=(v,count,list,truncated,lim)=>
  Number.isSafeInteger(v[count])&&v[count]>=0&&ids(v[list],lim)&&
  v[count]>=v[list].length&&typeof v[truncated]==='boolean'&&
  v[truncated]===(v[count]>v[list].length);
export function validGeometryImpact(v,request){
  if(!v||typeof v!=='object'||Array.isArray(v)||
    Object.keys(v).length!==keys.length||Object.keys(v).some(k=>!keys.includes(k)))return false;
  if(v.scope!=='saved_geometry_impact_advisory'||
    v.cube_uuid!==request?.cube_uuid||!id.test(v.cube_uuid)||
    v.change!==request.change||!changes.has(v.change)||
    !(v.parent_bone_uuid===null||(typeof v.parent_bone_uuid==='string'&&id.test(v.parent_bone_uuid)))||
    !relation(v,'ancestor_count','ancestor_bone_uuids','ancestors_truncated',24)||
    !relation(v,'same_parent_cube_count','same_parent_cube_uuids','same_parent_truncated',12)||
    !relation(v,'same_atlas_cube_count','same_atlas_cube_uuids','same_atlas_truncated',12)||
    !relation(v,'matching_animation_count','matching_animation_uuids','matching_animation_truncated',12)||
    !ids(v.declared_texture_uuids,16)||
    !Array.isArray(v.dimensions)||v.dimensions.length!==3||
    !v.dimensions.every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0)||
    typeof v.texture_relations_complete!=='boolean'||
    v.animation_relation_verdict!=='EXACT_KEYS_ONLY'||
    !Array.isArray(v.review_reasons)||v.review_reasons.length>reasons.size||
    !v.review_reasons.every(r=>reasons.has(r))||
    new Set(v.review_reasons).size!==v.review_reasons.length||
    !v.review_reasons.includes('REFERENCE_VISUAL_FIDELITY_UNVERIFIED')||
    v.collision_verdict!=='UNVERIFIED'||v.visual_verdict!=='UNVERIFIED'||
    v.write_authority!=='NOT_GRANTED'||v.source_change_verdict!=='NOT_APPLIED')return false;
  if(v.ancestor_count===0&&v.parent_bone_uuid!==null)return false;
  if(v.ancestor_count>0&&v.ancestor_bone_uuids.at(-1)!==v.parent_bone_uuid)return false;
  if(v.same_parent_cube_uuids.includes(v.cube_uuid)||
     v.same_atlas_cube_uuids.includes(v.cube_uuid))return false;
  return true;
}
