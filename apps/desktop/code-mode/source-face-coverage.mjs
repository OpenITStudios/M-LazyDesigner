/** SHA-bound read-only source-face coverage scan for trusted image reviewers.
 * No approval, model writer or cross-execution cache is introduced.
 * SOURCE_AUTHORED_NOT_RUN.
 */
import {MAX_FACES_PER_REVIEW,MAX_PAGED_REVIEW_FACES}
  from './paged-face-review.mjs';

// A high-detail model still gets source-only coverage beyond the former
// 32-page/256-Cube cap. Keep this bounded: no partial source or visual PASS.
const MAX_SOURCE_COVERAGE_PAGES = 128; // 1,024 Cubes maximum per scan
const COVERAGE_BATCH_THRESHOLD_CUBES = 256;

// Reuse ONE immutable Rust inspectBatch for two adjacent 8-Cube pages only
// when the first page has proved a larger source total. A pair is at most
// two native 32-KiB coverage results, below the existing 96-KiB read budget.
// Never persist the lookahead beyond this one SHA-pinned source scan.
function sourceCoverageReader(model) {
  let prefetched = null;
  return async (offset,totalCubes) => {
    if (prefetched !== null) {
      const page=prefetched;
      prefetched=null;
      if(page?.coverage?.offset!==offset) {
        throw new Error('CODE_MODE_COVERAGE_BATCH_CURSOR_INVALID');
      }
      return {sha256:model.expectedSha256,results:[page]};
    }
    const requests=[{kind:'model_texture_coverage',
      offset,limit:8,attention_only:false}];
    if (Number.isSafeInteger(totalCubes) &&
        totalCubes>COVERAGE_BATCH_THRESHOLD_CUBES &&
        offset+8<totalCubes &&
        offset+16<=MAX_SOURCE_COVERAGE_PAGES*8) {
      requests.push({kind:'model_texture_coverage',
        offset:offset+8,limit:8,attention_only:false});
    }
    const receipt=await model.inspectBatch(requests);
    if(receipt?.sha256!==model.expectedSha256 ||
       !Array.isArray(receipt.results) ||
       receipt.results.length!==requests.length ||
       receipt.results.some((entry,i)=>
         entry?.kind!=='model_texture_coverage' ||
         entry.coverage?.offset!==requests[i].offset)) {
      throw new Error('CODE_MODE_COVERAGE_BATCH_INVALID');
    }
    prefetched=receipt.results[1]??null;
    return {sha256:receipt.sha256,results:[receipt.results[0]]};
  };
}

// The trusted external image reviewer needs source-owned face IDs, not
// model-invented names. This focused read is optional for hosts whose reviewer
// can bind faces independently, and never certifies camera correspondence.
async function sourceFacesForImageReviewer(model) {
  const faces=[];
  let cursor=0, pages=0, totalCubes=null;
  const readCoverage=sourceCoverageReader(model);
  while(pages<MAX_SOURCE_COVERAGE_PAGES) {
    const receipt=await readCoverage(cursor,totalCubes);
    const item=receipt.results?.[0]?.coverage;
    if(receipt.sha256!==model.expectedSha256 ||
       receipt.results?.[0]?.kind!=='model_texture_coverage' ||
       item?.scope!=='saved_face_texture_coverage_page' ||
       item.offset!==cursor ||
       !Number.isSafeInteger(item.total_cubes) ||
       (totalCubes!==null && totalCubes!==item.total_cubes) ||
       !Number.isSafeInteger(item.reviewed_cubes) ||
       item.reviewed_cubes!==Math.min(8,Math.max(0,item.total_cubes-cursor)) ||
       !Array.isArray(item.cubes) ||
       item.cubes.length!==item.reviewed_cubes) {
      throw new Error('CODE_MODE_REVIEW_FACE_SOURCE_INVALID');
    }
    totalCubes=item.total_cubes;
    for(const cube of item.cubes) {
      if(typeof cube?.cube_uuid!=='string' ||
         !Array.isArray(cube.faces) || cube.faces.length!==6 ||
         new Set(cube.faces.map(f=>f.side)).size!==6) {
        throw new Error('CODE_MODE_REVIEW_FACE_SOURCE_INVALID');
      }
      for(const face of cube.faces) {
        if(!['north','east','south','west','up','down'].includes(face.side) ||
           typeof face.status!=='string') {
          throw new Error('CODE_MODE_REVIEW_FACE_SOURCE_INVALID');
        }
        if(face.status==='absent_declared')continue;
        faces.push(Object.freeze({
          cube_uuid:cube.cube_uuid,face:face.side,
          texture_uuid:face.texture_uuid??null,
          source_status:face.status,
        }));
      }
    }
    pages++;
    if(faces.length>MAX_PAGED_REVIEW_FACES) {
      return Object.freeze({
        scope:'trusted_saved_cube_face_inventory',
        source_model_sha256:model.expectedSha256,
        total_cubes:totalCubes,complete:false,
        reason:'REVIEW_INVENTORY_TOTAL_FACE_LIMIT',
        faces:Object.freeze(faces.slice(0,MAX_FACES_PER_REVIEW)),
      });
    }
    if(item.next_offset===null) {
      if(cursor+item.reviewed_cubes!==totalCubes){
        throw new Error('CODE_MODE_REVIEW_FACE_SOURCE_CURSOR_INVALID');
      }
      return Object.freeze({
        scope:'trusted_saved_cube_face_inventory',
        source_model_sha256:model.expectedSha256,
        total_cubes:totalCubes,complete:true,
        faces:Object.freeze(faces),
      });
    }
    if(!Number.isSafeInteger(item.next_offset) ||
       item.next_offset!==cursor+item.reviewed_cubes ||
       item.next_offset>totalCubes) {
      throw new Error('CODE_MODE_REVIEW_FACE_SOURCE_CURSOR_INVALID');
    }
    cursor=item.next_offset;
  }
  return Object.freeze({
    scope:'trusted_saved_cube_face_inventory',
    source_model_sha256:model.expectedSha256,
    total_cubes:totalCubes,complete:false,
    reason:'REVIEW_INVENTORY_PAGE_LIMIT',
    faces:Object.freeze(faces),
  });
}


export {MAX_SOURCE_COVERAGE_PAGES,sourceCoverageReader,sourceFacesForImageReviewer};
