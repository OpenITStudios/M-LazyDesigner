//! Bounded advisory evidence from actually saved RGBA8 atlas pixels.
//! NEVER an artistic PASS or user approval.
use super::{paint, face_regions, uv_sharing, AuthoringDocument, MaterialPatchRegion, Result, FACE_NAMES};
use serde_json::{json,Value};
use std::collections::HashSet;

fn pixel(bytes: &[u8], width: u32, x: u32, y: u32) -> [u8; 4] {
    let index = ((y * width + x) * 4) as usize;
    [bytes[index], bytes[index + 1], bytes[index + 2], bytes[index + 3]]
}

/// One bounded saved-atlas crop. Hints describe patterns for human review,
/// not the artistic quality or final finish of a painted material.
fn analyze(bytes: &[u8], width: u32, region: &MaterialPatchRegion) -> Value {
    let region_width = region.to[0] - region.from[0];
    let region_height = region.to[1] - region.from[1];
    let mut exact_colors = HashSet::<[u8; 3]>::new();

    // High three RGB bits yield 8 * 8 * 8 buckets; no per-pixel map hashing.
    let mut coarse = [0u32; 512];
    let (mut visible, mut opaque) = (0u32, 0u32);
    let (mut low, mut high) = (255u32, 0u32);
    let (mut different, mut adjacency) = (0u32, 0u32);
    let mut row_colors = Vec::<[u8; 3]>::with_capacity(region_height as usize);
    let mut uniform_rows = true;

    for y in region.from[1]..region.to[1] {
        let (mut first, mut uniform) = (None, true);
        for x in region.from[0]..region.to[0] {
            let rgba = pixel(bytes, width, x, y);
            if rgba[3] == 0 {
                uniform = false;
                continue;
            }

            visible += 1;
            if rgba[3] == 255 { opaque += 1; }
            let rgb = [rgba[0], rgba[1], rgba[2]];
            exact_colors.insert(rgb);
            let bucket = ((usize::from(rgba[0]) >> 5) << 6)
                | ((usize::from(rgba[1]) >> 5) << 3)
                | (usize::from(rgba[2]) >> 5);
            coarse[bucket] += 1;

            let luma = (54 * u32::from(rgba[0]) +
                183 * u32::from(rgba[1]) + 19 * u32::from(rgba[2])) / 256;
            low = low.min(luma);
            high = high.max(luma);

            if first.is_some_and(|color| color != rgb) { uniform = false; }
            if first.is_none() { first = Some(rgb); }

            // Count each horizontal/vertical adjacency once.
            for (neighbor_x, neighbor_y) in [(x + 1, y), (x, y + 1)] {
                if neighbor_x >= region.to[0] || neighbor_y >= region.to[1] {
                    continue;
                }
                let neighbor = pixel(bytes, width, neighbor_x, neighbor_y);
                if neighbor[3] > 0 {
                    adjacency += 1;
                    if neighbor[..3] != rgba[..3] { different += 1; }
                }
            }
        }
        if !uniform { uniform_rows = false; }
        if let Some(rgb) = first { row_colors.push(rgb); }
    }

    let mut hints = Vec::<&str>::new();
    if visible >= 16 {
        if exact_colors.len() == 1 {
            hints.push("UNIFORM_VISIBLE_COLOR_BASE_ONLY_CANDIDATE");
        } else if high - low < 21 &&
            coarse.iter().copied().max().unwrap_or(0) * 100 >= visible * 92 {
            hints.push("LOW_FORM_VALUE_VARIATION_CANDIDATE");
        }

        if region_width >= 4 && region_height >= 4 &&
            opaque == region_width * region_height &&
            uniform_rows && row_colors.iter().any(|color| *color != row_colors[0]) {
            hints.push("UNIFORM_HORIZONTAL_BANDS_REVIEW");
        }
        if adjacency >= 8 && different * 100 >= adjacency * 85 {
            hints.push("FRAGMENTED_OR_NOISE_FIRST_REVIEW");
        }
    }

    // Bars are diagnostic candidates: deliberate panels and seams are valid.
    if region_width >= 4 && region_height >= 4 &&
        opaque == region_width * region_height {
        let mut columns_uniform = true;
        let mut columns_different = false;
        let first_column = pixel(bytes, width, region.from[0], region.from[1]);
        for x in region.from[0]..region.to[0] {
            let first = pixel(bytes, width, x, region.from[1]);
            if first[..3] != first_column[..3] { columns_different = true; }
            for y in region.from[1] + 1..region.to[1] {
                if pixel(bytes, width, x, y)[..3] != first[..3] {
                    columns_uniform = false;
                    break;
                }
            }
            if !columns_uniform { break; }
        }
        if columns_uniform && columns_different {
            hints.push("UNIFORM_VERTICAL_BANDS_REVIEW");
        }
    }

    let status = if hints.contains(&"UNIFORM_VISIBLE_COLOR_BASE_ONLY_CANDIDATE") {
        "BASE_ONLY_CANDIDATE"
    } else if hints.is_empty() {
        "NOT_EVALUATED"
    } else {
        "REVIEW_REQUIRED"
    };
    json!({
        "scope": "selected_saved_rgba8_atlas_region",
        "region": region, "region_pixels": region_width * region_height,
        "visible_pixels": visible, "unique_visible_rgb": exact_colors.len(),
        "approx_luma_span": if visible == 0 { Value::Null } else { json!(high - low) },
        "review_hints": hints, "status": status,
        "visual_verdict": "UNVERIFIED", "texture_completion_attested": false,
        "note": "Only an atlas candidate diagnostic. No proof of form-following shading, reference alignment or artistic acceptance."
    })
}

pub fn inspect_texture_styling_region(doc:&AuthoringDocument,
    texture_uuid:&str,region:&MaterialPatchRegion)->Result<Value>{
    doc.validate()?;
    if !super::valid_uuid(texture_uuid){
        return Err("TEXTURE_STYLING_UUID_INVALID".into());
    }
    let width=doc.resolution.width;let height=doc.resolution.height;
    if region.from[0]>=region.to[0]||region.from[1]>=region.to[1]||
        region.to[0]>width||region.to[1]>height{
        return Err("TEXTURE_STYLING_REGION_INVALID".into());
    }
    let w=region.to[0]-region.from[0];let h=region.to[1]-region.from[1];
    if w.checked_mul(h).is_none_or(|n|n>4096){
        return Err("TEXTURE_STYLING_REGION_TOO_LARGE".into());
    }
    let mut assets=doc.texture_assets.iter().filter(|t|
        t.get("uuid").and_then(Value::as_str)==Some(texture_uuid));
    let texture=assets.next().ok_or_else(||
        "TEXTURE_STYLING_TEXTURE_NOT_FOUND".to_string())?;
    if assets.next().is_some(){
        return Err("TEXTURE_STYLING_TEXTURE_AMBIGUOUS".into());
    }
    let bytes=paint::decode_for_uv_inspection(texture,width,height)
        .map_err(|_|"TEXTURE_STYLING_BITMAP_UNSUPPORTED".to_string())?;
    let mut report=analyze(&bytes,width,region);
    report["texture_uuid"]=json!(texture_uuid);
    Ok(report)
}

/// Original saved RGBA source colors in one bounded physical atlas crop.
/// This allows a trusted reviewer to CHOOSE explicit overwrite preconditions
/// from actual source colors instead of guessing RGBs from a lit 3D render.
/// It is not a permission/approval list, source-reference match or artistic
/// verdict. The legacy first page remains small for low tool usage, but
/// all exact original colors can be inspected through deterministic pages.
pub fn inspect_texture_source_colors(
    doc:&AuthoringDocument, texture_uuid:&str, region:&MaterialPatchRegion
)->Result<Value>{
    inspect_texture_source_colors_page(doc,texture_uuid,region,0,16)
}
pub fn inspect_texture_source_colors_page(
    doc:&AuthoringDocument, texture_uuid:&str, region:&MaterialPatchRegion,
    offset:usize,limit:usize,
)->Result<Value>{
    if offset>4096 || limit==0 || limit>64{
        return Err("SOURCE_COLORS_PAGE_INVALID".into());
    }
    doc.validate()?;
    if !super::valid_uuid(texture_uuid) {
        return Err("SOURCE_COLORS_UUID_INVALID".into());
    }
    let width=doc.resolution.width;
    let height=doc.resolution.height;
    if region.from[0]>=region.to[0] || region.from[1]>=region.to[1] ||
       region.to[0]>width || region.to[1]>height {
        return Err("SOURCE_COLORS_REGION_INVALID".into());
    }
    let w=region.to[0]-region.from[0];
    let h=region.to[1]-region.from[1];
    if w.checked_mul(h).is_none_or(|count|count>4096) {
        return Err("SOURCE_COLORS_REGION_TOO_LARGE".into());
    }
    let mut assets=doc.texture_assets.iter().filter(|texture|
        texture.get("uuid").and_then(Value::as_str)==Some(texture_uuid));
    let texture=assets.next().ok_or_else(||
        "SOURCE_COLORS_TEXTURE_NOT_FOUND".to_string())?;
    if assets.next().is_some(){
        return Err("SOURCE_COLORS_TEXTURE_AMBIGUOUS".into());
    }
    let pixels=paint::decode_for_uv_inspection(texture,width,height)
        .map_err(|_|"SOURCE_COLORS_BITMAP_UNSUPPORTED".to_string())?;
    let mut counts=std::collections::HashMap::<[u8;4],u32>::new();
    for y in region.from[1]..region.to[1] {
        for x in region.from[0]..region.to[0] {
            let at=((y*width+x)*4) as usize;
            let rgba=[
                pixels[at],pixels[at+1],pixels[at+2],pixels[at+3]
            ];
            *counts.entry(rgba).or_default()+=1;
        }
    }
    let unique=counts.len();
    let mut colors:Vec<_>=counts.into_iter().collect();
    colors.sort_by(|a,b|b.1.cmp(&a.1).then_with(||a.0.cmp(&b.0)));
    let end=offset.saturating_add(limit).min(unique);
    let entries=colors.into_iter().skip(offset).take(limit)
        .map(|(rgba,pixels)|json!({"rgba":rgba,"pixels":pixels}))
        .collect::<Vec<_>>();
    let complete=offset==0 && end==unique;
    Ok(json!({
        "scope":"saved_physical_atlas_original_rgba_colors",
        "texture_uuid":texture_uuid,
        "region":region,
        "sampled_pixels":w*h,
        "unique_rgba":unique,
        "colors":entries,
        "offset":offset,"limit":limit,
        "next_offset":if end<unique{Some(end)}else{None},
        "histogram_complete":true,
        "complete":complete,
        "reason":if complete {Value::Null}
            else if offset==0 && limit==16 {
                json!("SOURCE_COLORS_MORE_THAN_16_UNIQUE")
            }else{json!("SOURCE_COLORS_PAGED")},
        "visual_verdict":"UNVERIFIED",
        "texture_completion_attested":false,
        "note":"Measured original saved texture RGBA only. The reviewer must independently choose which colors may be overwritten; these counts grant no paint permission."
    }))
}

/// Review every approved correction rectangle, not only the first one.
/// A large/unreadable region is reported as NOT_EVALUATED with its index
/// instead of silently disappearing from the mutation receipt. These
/// statistics never authorize finish/propagation or evaluate reference art.
pub fn inspect_texture_styling_regions(
    doc:&AuthoringDocument, texture_uuid:&str, regions:&[MaterialPatchRegion]
)->Result<Value>{
    doc.validate()?;
    if regions.is_empty() || regions.len()>16 {
        return Err("TEXTURE_STYLING_REGION_SET_INVALID".into());
    }
    if !super::valid_uuid(texture_uuid) {
        return Err("TEXTURE_STYLING_UUID_INVALID".into());
    }
    let mut assets=doc.texture_assets.iter().filter(|t|
        t.get("uuid").and_then(Value::as_str)==Some(texture_uuid));
    let texture=assets.next().ok_or_else(||
        "TEXTURE_STYLING_TEXTURE_NOT_FOUND".to_string())?;
    if assets.next().is_some() {
        return Err("TEXTURE_STYLING_TEXTURE_AMBIGUOUS".into());
    }
    let width=doc.resolution.width;
    let height=doc.resolution.height;
    let decoded=paint::decode_for_uv_inspection(texture,width,height).ok();
    let mut measured=0usize;
    let mut warning_regions=0usize;
    let mut unavailable=0usize;
    let mut observations=Vec::with_capacity(regions.len());
    for (index,region) in regions.iter().enumerate() {
        if region.from[0]>=region.to[0] || region.from[1]>=region.to[1] ||
            region.to[0]>width || region.to[1]>height {
            return Err("TEXTURE_STYLING_REGION_INVALID".into());
        }
        let w=region.to[0]-region.from[0];
        let h=region.to[1]-region.from[1];
        let area=w.checked_mul(h);
        let mut item=match (area,decoded.as_ref()) {
            (Some(n),Some(pixels)) if n<=4096 => {
                measured+=1;
                let evidence=analyze(pixels,width,region);
                if evidence["review_hints"].as_array()
                    .is_some_and(|h|!h.is_empty()) { warning_regions+=1; }
                evidence
            },
            (Some(n),_) if n>4096 => {
                unavailable+=1;
                json!({"status":"NOT_EVALUATED","reason":"REGION_TOO_LARGE",
                    "region":region,"review_hints":[]})
            },
            (_,None) => {
                unavailable+=1;
                json!({"status":"NOT_EVALUATED","reason":"BITMAP_UNSUPPORTED",
                    "region":region,"review_hints":[]})
            },
            _ => return Err("TEXTURE_STYLING_REGION_INVALID".into()),
        };
        item["index"]=json!(index);
        item["source_measured"]=json!(
            item.get("reason").is_none()
        );
        observations.push(item);
    }
    Ok(json!({
        "scope":"all_declared_correction_regions",
        "texture_uuid":texture_uuid,
        "region_count":regions.len(),
        "source_measured_regions":measured,
        "source_unavailable_regions":unavailable,
        "warning_regions":warning_regions,
        "coverage":if unavailable==0{"all_declared_regions_measured"}else{"partial"},
        "regions":observations,
        "visual_verdict":"UNVERIFIED","texture_completion_attested":false,
        "next":"Review actual mapped faces and reference; a non-warning is not an artistic PASS."
    }))
}

/// Evaluate the selected face in its *displayed* Cube-local pixel orientation.
/// Uses the same signed/rotated UV mapper as Rust PaintCubeFaceRegionsGuarded.
/// Unlike an atlas crop, this can expose stripes rotated into face-space.
/// The owner is still the saved .bbmodel; no rendered view or material style
/// is inferred from a PNG histogram.
pub fn inspect_texture_styling_face(
    doc:&AuthoringDocument, texture_uuid:&str, cube_uuid:&str, side:&str
)->Result<Value>{
    doc.validate()?;
    if !FACE_NAMES.contains(&side) {
        return Err("TEXTURE_STYLING_FACE_INVALID".into());
    }
    let matches:Vec<_>=doc.texture_assets.iter().enumerate().filter(|(_,t)|
        t.get("uuid").and_then(Value::as_str)==Some(texture_uuid)).collect();
    let (texture_index,texture)=match matches.as_slice() {
        [] => return Err("TEXTURE_STYLING_TEXTURE_NOT_FOUND".into()),
        [item] => (item.0,item.1),
        _ => return Err("TEXTURE_STYLING_TEXTURE_AMBIGUOUS".into()),
    };
    let cube=doc.cubes.iter().find(|c|c.uuid==cube_uuid)
        .ok_or_else(||"TEXTURE_STYLING_CUBE_NOT_FOUND".to_string())?;
    let selected_face=cube.faces.get(side)
        .ok_or_else(||"TEXTURE_STYLING_FACE_MISSING".to_string())?;
    if selected_face.get("enabled").is_some_and(|v|v!=&Value::Bool(true)) {
        return Err("TEXTURE_STYLING_FACE_DISABLED".into());
    }
    let linked=match selected_face.get("texture") {
        Some(Value::String(id)) => id==texture_uuid,
        Some(Value::Number(index)) => index.as_u64()==Some(texture_index as u64),
        _ => false,
    };
    if !linked {
        return Err("TEXTURE_STYLING_FACE_TEXTURE_UNBOUND".into());
    }
    let projected=uv_sharing::project_supported_uv(doc,cube)
        .map_err(|_|"TEXTURE_STYLING_UV_UNSUPPORTED".to_string())?;
    let uv=super::face_uv(&projected,side)
        .map_err(|_|"TEXTURE_STYLING_UV_UNSUPPORTED".to_string())?;
    let (lo,hi)=paint::uv_pixel_rectangle(
        doc.resolution.width,doc.resolution.height,uv
    ).map_err(|_|"TEXTURE_STYLING_UV_UNSUPPORTED".to_string())?;
    let rotation=match projected.faces.get(side).and_then(|v|v.get("rotation")) {
        None => 0u16,
        Some(Value::Number(n)) => match n.as_f64() {
            Some(v) if v==0.0 => 0,
            Some(v) if v==90.0 => 90,
            Some(v) if v==180.0 => 180,
            Some(v) if v==270.0 => 270,
            _ => return Err("TEXTURE_STYLING_ROTATION_UNSUPPORTED".into())
        },
        _ => return Err("TEXTURE_STYLING_ROTATION_UNSUPPORTED".into()),
    };
    let (width,height)=if rotation==90 || rotation==270 {
        (hi[1]-lo[1],hi[0]-lo[0])
    }else{(hi[0]-lo[0],hi[1]-lo[1])};
    let source_form=super::material_form::inspect_source_form(
        doc,cube,side,Some([width,height]));
    let size=width.checked_mul(height);
    if size.is_none_or(|n|n>4096) {
        return Ok(json!({
            "scope":"saved_cube_face_local_pixels",
            "texture_uuid":texture_uuid,"cube_uuid":cube_uuid,"face":side,
            "face_size":[width,height],"status":"NOT_EVALUATED",
            "reason":"FACE_TOO_LARGE_FOR_BOUNDED_INSPECTION",
            "surface_form":source_form,
            "review_hints":[],"visual_verdict":"UNVERIFIED",
            "texture_completion_attested":false
        }));
    }
    let atlas=paint::decode_for_uv_inspection(texture,
        doc.resolution.width,doc.resolution.height)
        .map_err(|_|"TEXTURE_STYLING_BITMAP_UNSUPPORTED".to_string())?;
    let mut local=vec![0u8;(width*height*4) as usize];
    for y in 0..height { for x in 0..width {
        let (from,to)=face_regions::face_local_pixel_rectangle(
            doc.resolution.width,doc.resolution.height,uv,rotation,
            [x,y],[x+1,y+1]
        ).map_err(|_|"TEXTURE_STYLING_FACE_MAPPING_INVALID".to_string())?;
        if to!=[from[0]+1,from[1]+1] {
            return Err("TEXTURE_STYLING_FACE_MAPPING_INVALID".into());
        }
        let src=((from[1]*doc.resolution.width+from[0])*4) as usize;
        let dst=((y*width+x)*4) as usize;
        local[dst..dst+4].copy_from_slice(&atlas[src..src+4]);
    }}
    let mut report=analyze(&local,width,&MaterialPatchRegion{
        from:[0,0],to:[width,height]
    });
    report["scope"]=json!("saved_cube_face_local_pixels");
    report["texture_uuid"]=json!(texture_uuid);
    report["cube_uuid"]=json!(cube_uuid);
    report["face"]=json!(side);
    report["face_size"]=json!([width,height]);
    report["uv_rotation"]=json!(rotation);
    report["uv_alias_exclusivity"]=json!("NOT_ASSESSED");
    report["mapped_render_review"]=json!("REQUIRED");
    report["surface_form"]=source_form;
    Ok(report)
}

#[cfg(test)]
mod tests{
    use super::*;
    use crate::authoring::{EditOperation,EditorSession};
    const TEX:&str="00000000-0000-4000-8000-000000007101";
    fn region()->MaterialPatchRegion{MaterialPatchRegion{
        from:[0,0],to:[8,8]
    }}
    #[test]
    fn original_source_color_palette_is_exact_and_not_an_artistic_pass() {
        let mut s=EditorSession::from_document(
            AuthoringDocument::new_bedrock("Source palette","source_palette").unwrap()
        ).unwrap();
        s.apply(0,&[EditOperation::CreatePaintTexture {
            uuid:TEX.into(),name:"original.png".into(),
        }]).unwrap();
        s.apply(1,&[
            EditOperation::PaintTexturePixel {
                texture_index:0,x:1,y:1,rgba:[80,100,120,255],
            },
            EditOperation::PaintTexturePixel {
                texture_index:0,x:2,y:1,rgba:[170,25,25,255],
            },
        ]).unwrap();
        let crop=MaterialPatchRegion{from:[1,1],to:[3,2]};
        let palette=inspect_texture_source_colors(s.document(),TEX,&crop).unwrap();
        assert_eq!(palette["scope"],"saved_physical_atlas_original_rgba_colors");
        assert_eq!(palette["complete"],true);
        assert_eq!(palette["unique_rgba"],2);
        assert_eq!(palette["colors"][0]["pixels"],1);
        assert_eq!(palette["colors"][0]["rgba"],json!([80,100,120,255]));
        assert_eq!(palette["colors"][1]["rgba"],json!([170,25,25,255]));
        assert_eq!(palette["visual_verdict"],"UNVERIFIED");
        assert_eq!(palette["texture_completion_attested"],false);
        let bad=MaterialPatchRegion{from:[0,0],to:[256,256]};
        assert_eq!(inspect_texture_source_colors(s.document(),TEX,&bad).unwrap_err(),
            "SOURCE_COLORS_REGION_TOO_LARGE");

        // A detailed source with >16 unique original colors is explicitly
        // partial, not a complete overwrite permission inferred from top-N.
        let details=(0u32..17).map(|index|
            EditOperation::PaintTexturePixel {
                texture_index:0,x:1+index,y:3,
                rgba:[index as u8,5,8,255],
            }
        ).collect::<Vec<_>>();
        s.apply(2,&details).unwrap();
        let detailed=inspect_texture_source_colors(s.document(),TEX,
            &MaterialPatchRegion{from:[1,3],to:[18,4]}).unwrap();
        assert_eq!(detailed["unique_rgba"],17);
        assert_eq!(detailed["colors"].as_array().unwrap().len(),16);
        assert_eq!(detailed["complete"],false);
        assert_eq!(detailed["reason"],"SOURCE_COLORS_MORE_THAN_16_UNIQUE");
        assert_eq!(detailed["next_offset"],16);
        assert_eq!(detailed["histogram_complete"],true);
        let rest=inspect_texture_source_colors_page(s.document(),TEX,
            &MaterialPatchRegion{from:[1,3],to:[18,4]},16,64).unwrap();
        assert_eq!(rest["unique_rgba"],17);
        assert_eq!(rest["colors"].as_array().unwrap().len(),1);
        assert_eq!(rest["offset"],16);
        assert_eq!(rest["next_offset"],Value::Null);
        assert_eq!(rest["reason"],"SOURCE_COLORS_PAGED");
        assert_eq!(inspect_texture_source_colors_page(s.document(),TEX,
            &MaterialPatchRegion{from:[1,3],to:[18,4]},0,65).unwrap_err(),
            "SOURCE_COLORS_PAGE_INVALID");
        assert_eq!(detailed["visual_verdict"],"UNVERIFIED");
    }

    #[test]
    fn one_color_saved_png_is_not_final_texture_shading(){
        let mut session=EditorSession::from_document(
            AuthoringDocument::new_bedrock("Material","material").unwrap()
        ).unwrap();
        session.apply(0,&[EditOperation::CreatePaintTexture{
            uuid:TEX.into(),name:"material.png".into()
        }]).unwrap();
        session.apply(1,&[EditOperation::PaintTextureRectangle{
            texture_index:0,from:[0,0],to:[8,8],rgba:[70,70,70,255],
            erase:false
        }]).unwrap();
        let original=session.export().unwrap();
        let r=inspect_texture_styling_region(session.document(),TEX,&region()).unwrap();
        assert_eq!(r["status"],"BASE_ONLY_CANDIDATE");
        assert_eq!(r["texture_completion_attested"],false);
        assert_eq!(r["visual_verdict"],"UNVERIFIED");
        assert_eq!(session.export().unwrap(),original);
    }
    #[test]
    fn straight_three_color_bands_and_checker_noise_need_review(){
        for noise in [false,true]{
            let mut rgba=vec![0u8;8*8*4];
            for y in 0..8usize{for x in 0..8usize{
                let v=if noise{if(x+y)%2==0{20}else{220}}
                    else if y<2{40}else if y<6{110}else{195};
                let i=(y*8+x)*4;rgba[i..i+4].copy_from_slice(&[v,v,v,255]);
            }}
            let report=analyze(&rgba,8,&region());
            let key=if noise{"FRAGMENTED_OR_NOISE_FIRST_REVIEW"}
                else{"UNIFORM_HORIZONTAL_BANDS_REVIEW"};
            assert!(report["review_hints"].as_array().unwrap().iter().any(|v|v==key));
            assert_eq!(report["status"],"REVIEW_REQUIRED");
        }
    }
    #[test]
    fn all_correction_regions_are_accounted_for_without_artistic_pass(){
        let mut s=EditorSession::from_document(
            AuthoringDocument::new_bedrock("Regions","regions").unwrap()
        ).unwrap();
        s.apply(0,&[EditOperation::CreatePaintTexture{
            uuid:TEX.into(),name:"atlas.png".into()
        }]).unwrap();
        s.apply(1,&[EditOperation::PaintTextureRectangle{
            texture_index:0,from:[0,0],to:[8,8],rgba:[50,60,70,255],erase:false
        }]).unwrap();
        let original=s.export().unwrap();
        let read=inspect_texture_styling_regions(s.document(),TEX,&[
            region(),MaterialPatchRegion{from:[0,0],to:[65,64]}
        ]).unwrap();
        assert_eq!(read["region_count"],2);
        assert_eq!(read["source_measured_regions"],1);
        assert_eq!(read["source_unavailable_regions"],1);
        assert_eq!(read["coverage"],"partial");
        assert_eq!(read["regions"][0]["status"],"BASE_ONLY_CANDIDATE");
        assert_eq!(read["regions"][1]["reason"],"REGION_TOO_LARGE");
        assert_eq!(read["texture_completion_attested"],false);
        assert_eq!(s.export().unwrap(),original);
    }
    #[test]
    fn saved_cube_local_face_uses_real_uv_and_no_visual_pass(){
        let mut d=AuthoringDocument::import_bbmodel(
            include_bytes!("../../fixtures/bedrock-texture-interchange.bbmodel")
        ).unwrap();
        let t="00000000-0000-4000-8000-000000000101";
        // The interchange fixture deliberately has an invalid PNG source
        // and opaque texture_set metadata. Replace only the in-test atlas
        // with canonical Rust-owned RGBA8 pixels; never edit the fixture.
        d.texture_assets[0]=paint::create(t,"atlas.png",64,32).unwrap();
        let cube="00000000-0000-4000-8000-000000000002";
        let original=d.clone();
        let report=inspect_texture_styling_face(&d,t,cube,"north").unwrap();
        assert_eq!(report["scope"],"saved_cube_face_local_pixels");
        assert_eq!(report["cube_uuid"],cube);
        assert_eq!(report["uv_alias_exclusivity"],"NOT_ASSESSED");
        assert_eq!(report["texture_completion_attested"],false);
        assert_eq!(report["visual_verdict"],"UNVERIFIED");
        assert_eq!(inspect_texture_styling_face(&d,t,cube,"south")
            .unwrap_err(),"TEXTURE_STYLING_FACE_TEXTURE_UNBOUND");
        assert_eq!(d,original);
    }
    #[test]
    fn vertical_stripes_also_raise_review_hint(){
        let mut rgba=vec![0u8;8*8*4];
        for y in 0..8usize{for x in 0..8usize{
            let v=if x<2{35}else if x<6{110}else{190};
            let i=(y*8+x)*4;rgba[i..i+4].copy_from_slice(&[v,v,v,255]);
        }}
        let report=analyze(&rgba,8,&region());
        assert!(report["review_hints"].as_array().unwrap().iter().any(
            |v|v=="UNIFORM_VERTICAL_BANDS_REVIEW"));
        assert_eq!(report["visual_verdict"],"UNVERIFIED");
    }
    #[test]
    fn four_pixel_identity_is_not_wrongly_called_flat_material(){
        let report=analyze(&vec![120u8;2*2*4],2,&MaterialPatchRegion{
            from:[0,0],to:[2,2]});
        assert_eq!(report["status"],"NOT_EVALUATED");
    }
    #[test]
    fn low_variation_review_uses_exact_nine_bit_color_bucket_counts() {
        let mut rgba = vec![0u8; 8 * 8 * 4];
        for (index, pixel) in rgba.chunks_exact_mut(4).enumerate() {
            // Two distinct RGBs in the SAME high-three-bit bucket. Both
            // should be counted, rather than classified as a flat color.
            let shade = if index == 63 { 101 } else { 100 };
            pixel.copy_from_slice(&[shade, shade, shade, 255]);
        }
        let report = analyze(&rgba, 8, &region());
        assert_eq!(report["unique_visible_rgb"], 2);
        assert!(report["review_hints"].as_array().unwrap().iter()
            .any(|hint| hint == "LOW_FORM_VALUE_VARIATION_CANDIDATE"));
        assert_eq!(report["visual_verdict"], "UNVERIFIED");

        // Distinct coarse buckets and a wide value span must not receive
        // the low-variation hint, regardless of a dominant first color.
        rgba[63 * 4..63 * 4 + 4].copy_from_slice(&[240, 240, 240, 255]);
        let contrast = analyze(&rgba, 8, &region());
        assert!(!contrast["review_hints"].as_array().unwrap().iter()
            .any(|hint| hint == "LOW_FORM_VALUE_VARIATION_CANDIDATE"));
    }

}
