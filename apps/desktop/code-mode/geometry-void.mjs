// G5 source-only negative-space intent and receipt checks.
// Values are exact operator/agent-declared model-unit bounds; NOT inferred
// from image pixels and never a mutation permission or through-hole proof.
const id=/^[A-Za-z0-9_-]{1,128}$/;
function triplet(value){
  return Array.isArray(value)&&value.length===3&&
    value.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=100000);
}
export function normalizedGeometryVoidZones(assembly){
  if(!Object.hasOwn(assembly,'void_zones'))return null;
  const zones=assembly.void_zones;
  if(!Array.isArray(zones)||zones.length<1||zones.length>16||
     !Array.isArray(assembly.parts))throw new TypeError('GEOMETRY_VOID_ZONE_INVALID');
  const parentIds=new Set(assembly.parts.map(p=>p?.bone?.uuid));
  const seen=new Set();
  return zones.map(value=>{
    if(!value||typeof value!=='object'||Array.isArray(value)||
       Object.keys(value).length!==3||
       Object.keys(value).some(k=>!['bone_uuid','from','to'].includes(k))||
       typeof value.bone_uuid!=='string'||!id.test(value.bone_uuid)||
       !parentIds.has(value.bone_uuid)||!triplet(value.from)||!triplet(value.to)||
       !value.from.every((n,i)=>n<value.to[i]))
        throw new TypeError('GEOMETRY_VOID_ZONE_INVALID');
    const zone={bone_uuid:value.bone_uuid,from:[...value.from],to:[...value.to]};
    const key=JSON.stringify(zone);
    if(seen.has(key))throw new TypeError('GEOMETRY_VOID_ZONE_DUPLICATE');
    seen.add(key);
    return zone;
  });
}
export function validGeometryVoidEvidence(e,zones){
  if(zones===null)return e===undefined;
  if(!e||typeof e!=='object'||Array.isArray(e)||
      Object.keys(e).length!==9 ||
      Object.keys(e).some(k=>![
        'scope','zones','zones_checked','tested_cube_checks','local_bounds_verdict',
        'whole_model_contact_verdict','through_hole_verdict',
        'visual_verdict','write_authority'].includes(k)))return false;
  return e.scope==='new_bone_saved_cube_bounds_empty_zone'&&
    JSON.stringify(e.zones)===JSON.stringify(zones)&&
    e.zones_checked===zones.length&&
    Number.isSafeInteger(e.tested_cube_checks)&&
    e.tested_cube_checks>=zones.length&&e.tested_cube_checks<=zones.length*128&&
    e.local_bounds_verdict==='CLEAR_OF_PROPOSED_AXIS_ALIGNED_CUBES'&&
    e.whole_model_contact_verdict==='UNVERIFIED'&&
    e.through_hole_verdict==='UNVERIFIED'&&
    e.visual_verdict==='UNVERIFIED'&&e.write_authority==='NOT_GRANTED';
}
