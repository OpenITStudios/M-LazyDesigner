/** Source-identity check for one operator-selected material master Texture.
 * Confirms a unique UUID through SHA-bound paginated Rust catalog reads.
 * Does NOT approve artwork, grant mutation rights, expose source bitmap bytes
 * or store any additional authorization state.
 * SOURCE_AUTHORED_NOT_RUN.
 */
// A host-selected style master must resolve to exactly one real saved
// texture identity in the pinned Rust model. Otherwise an arbitrary string
// would appear to protect an approved texture that never existed.
export async function assertUniqueSavedMaterialTextureUuid(project,uuid){
  if(!project) {
    throw new Error('CODE_MODE_MATERIAL_REFERENCE_REQUIRES_EXISTING_MODEL');
  }
  let offset=0,total=null,matches=0;
  for(let page=0;page<32;page++){
    let receipt;
    try {
      receipt=await project.catalog('textures',{offset,limit:32});
    } catch {
      throw new Error('CODE_MODE_MATERIAL_REFERENCE_SOURCE_UNVERIFIED');
    }
    const list=receipt?.catalog;
    if(receipt?.sha256!==project.expectedSha256 ||
       list?.kind!=='textures' || list.offset!==offset ||
       !Number.isSafeInteger(list.total) || list.total<0 ||
       list.total>65536 || (total!==null && total!==list.total) ||
       !Array.isArray(list.entries) ||
       list.entries.length!==Math.min(32,Math.max(0,list.total-offset)) ||
       list.entries.some((entry,index)=>
         entry?.kind!=='texture' || entry.index!==offset+index ||
         (entry.uuid!==null && typeof entry.uuid!=='string'))) {
      throw new Error('CODE_MODE_MATERIAL_REFERENCE_SOURCE_UNVERIFIED');
    }
    total=list.total;
    matches+=list.entries.filter(entry=>entry.uuid===uuid).length;
    if(list.next_offset===null){
      if(offset+list.entries.length!==total){
        throw new Error('CODE_MODE_MATERIAL_REFERENCE_SOURCE_UNVERIFIED');
      }
      if(matches!==1) {
        throw new Error(matches===0 ?
          'CODE_MODE_MATERIAL_REFERENCE_NOT_FOUND':
          'CODE_MODE_MATERIAL_REFERENCE_AMBIGUOUS');
      }
      return;
    }
    if(!Number.isSafeInteger(list.next_offset) ||
       list.next_offset!==offset+list.entries.length ||
       list.next_offset>=total) {
      throw new Error('CODE_MODE_MATERIAL_REFERENCE_SOURCE_UNVERIFIED');
    }
    offset=list.next_offset;
  }
  throw new Error('CODE_MODE_MATERIAL_REFERENCE_CATALOG_INCOMPLETE');
}
