/**
 * Source-only face-local artist mask/stroke proposal compiler.
 * Inspired by pixel brushes and material masks, NOT copied from editors.
 * It never reads pixels, guesses a light source or writes a texture.
 * The Rust guarded Cube face painter owns atlas projection, protected
 * source colors, Undo, output and independently authorized mutations.
 */
const MAX_SIDE=256;
const MAX_PIXELS=4096;
const MAX_MASK_SPANS=64;
const MAX_OUTPUT_SPANS=64;
const MAX_STROKES=8;
const MAX_POINTS=12;
const MAX_PATH_SAMPLES=512;
const TOKEN=/^[a-z][a-z0-9_-]{0,63}$/;
// Aseprite-style shade selection steps through *existing authored swatches*.
// No HSL/OKLab synthesis, source-pixel inference or material-name ramp.
const SHADE_ROLES=['deep_shadow','shadow','base','highlight','edge_light'];

function invalid(){throw new TypeError('MATERIAL_BRUSH_COMPOSITION_INVALID');}
function object(value,fields){
  if(!value || typeof value!=='object' || Array.isArray(value) ||
      Object.keys(value).some(field=>!fields.includes(field)))invalid();
}
function reason(value){
  if(typeof value!=='string' || value!==value.trim() ||
     value.length<16 || value.length>220 ||
     /[\x00-\x1f\x7f]/.test(value))invalid();
  return value;
}
function spanList(value,required){
  if(!Array.isArray(value) || value.length>(MAX_MASK_SPANS) ||
     (required && value.length===0))invalid();
  const rows=value.map(span=>{
    object(span,['y','x0','x1']);
    if(![span.y,span.x0,span.x1].every(Number.isInteger) ||
       span.y<0 || span.y>=MAX_SIDE ||
       span.x0<0 || span.x0>=span.x1 || span.x1>MAX_SIDE)invalid();
    return Object.freeze({y:span.y,x0:span.x0,x1:span.x1});
  }).sort((a,b)=>a.y-b.y||a.x0-b.x0||a.x1-b.x1);
  for(let i=1;i<rows.length;i++){
    if(rows[i].y===rows[i-1].y && rows[i].x0<rows[i-1].x1)invalid();
  }
  return Object.freeze(rows);
}
function rasterMask(rows){
  const pixels=new Uint8Array(MAX_SIDE*MAX_SIDE);
  let count=0;
  for(const span of rows){
    for(let x=span.x0;x<span.x1;x++){
      const i=span.y*MAX_SIDE+x;
      if(pixels[i])invalid();
      pixels[i]=1;
      if(++count>MAX_PIXELS)invalid();
    }
  }
  return pixels;
}
function resolveShadeRole(stroke,roles){
  const direct=stroke.role!==undefined;
  const stepped=stroke.shadeWalk!==undefined;
  if(direct===stepped)invalid(); // exactly one selector
  if(direct){
    if(!roles.includes(stroke.role))invalid();
    return stroke.role;
  }
  object(stroke.shadeWalk,['from','steps']);
  const {from,steps}=stroke.shadeWalk;
  if(!SHADE_ROLES.includes(from) ||
     !roles.includes(from) || (steps!==-1 && steps!==1))invalid();
  const selectable=SHADE_ROLES.filter(role=>roles.includes(role));
  const target=selectable[selectable.indexOf(from)+steps];
  if(!target)invalid();
  return target;
}
function strokePoints(points){
  if(!Array.isArray(points) || points.length<1 || points.length>MAX_POINTS)invalid();
  const out=points.map(p=>{
    if(!Array.isArray(p) || p.length!==2 ||
       !p.every(v=>Number.isInteger(v)&&v>=0&&v<MAX_SIDE))invalid();
    return Object.freeze([...p]);
  });
  if(out.some((p,i)=>i>0 && p[0]===out[i-1][0] && p[1]===out[i-1][1]))invalid();
  return Object.freeze(out);
}
/** Source-only normalization, not reviewer consent or visual evidence. */
export function normalizedMaterialBrushComposition(value,roles){
  object(value,['mask','strokes']);
  if(!Array.isArray(roles) || roles.length===0 ||
     roles.some(role=>typeof role!=='string') ||
     new Set(roles).size!==roles.length)invalid();
  object(value.mask,['reason','paintable','rest']);
  const mask=Object.freeze({
    reason:reason(value.mask.reason),
    paintable:spanList(value.mask.paintable,true),
    rest:spanList(value.mask.rest??[],false),
  });
  if(!Array.isArray(value.strokes) || value.strokes.length<1 ||
     value.strokes.length>MAX_STROKES)invalid();
  const ids=new Set();
  const strokes=value.strokes.map(stroke=>{
    object(stroke,['id','role','shadeWalk','formReason','points','radius','tip','taper']);
    if(typeof stroke.id!=='string' || !TOKEN.test(stroke.id) ||
       ids.has(stroke.id) ||
       !Number.isInteger(stroke.radius) || stroke.radius<0 ||
       stroke.radius>2 ||
       !['square','diamond'].includes(stroke.tip) ||
       !['none','ends'].includes(stroke.taper))invalid();
    ids.add(stroke.id);
    resolveShadeRole(stroke,roles);
    return Object.freeze({id:stroke.id,
      ...(stroke.role!==undefined?{role:stroke.role}:{
        shadeWalk:Object.freeze({from:stroke.shadeWalk.from,steps:stroke.shadeWalk.steps}),
      }),
      formReason:reason(stroke.formReason),
      points:strokePoints(stroke.points),radius:stroke.radius,
      tip:stroke.tip,taper:stroke.taper});
  });
  const normalized=Object.freeze({mask,strokes:Object.freeze(strokes)});
  // Reject an unsafe or unrepresentable path before it reaches host approval.
  draw(normalized,roles);
  return normalized;
}
function pathSamples(points){
  const samples=[points[0]];
  for(let i=1;i<points.length;i++){
    const [x0,y0]=points[i-1], [x1,y1]=points[i];
    const steps=Math.max(Math.abs(x1-x0),Math.abs(y1-y0));
    for(let j=1;j<=steps;j++){
      const x=Math.round(x0+(x1-x0)*j/steps);
      const y=Math.round(y0+(y1-y0)*j/steps);
      const last=samples[samples.length-1];
      // Deliberate 4-connected staircase, not diagonal-island noise.
      if(x!==last[0] && y!==last[1])samples.push([x,last[1]]);
      samples.push([x,y]);
      if(samples.length>MAX_PATH_SAMPLES)invalid();
    }
  }
  return samples;
}
function spansFromPixels(pixels){
  const spans=[];
  for(let y=0;y<MAX_SIDE;y++){
    let x=0;
    while(x<MAX_SIDE){
      if(!pixels.has(y*MAX_SIDE+x)){x++;continue;}
      const x0=x++;
      while(x<MAX_SIDE && pixels.has(y*MAX_SIDE+x))x++;
      spans.push(Object.freeze({y,x0,x1:x}));
      if(spans.length>MAX_OUTPUT_SPANS)invalid();
    }
  }
  if(spans.length===0)invalid();
  return Object.freeze(spans);
}
function draw(composition,roles){
  const paintable=rasterMask(composition.mask.paintable);
  const rest=rasterMask(composition.mask.rest);
  for(let i=0;i<rest.length;i++)if(rest[i] && !paintable[i])invalid();
  const used=new Set();
  const clusters=[];
  for(const stroke of composition.strokes){
    const path=pathSamples(stroke.points);
    const pixels=new Set();
    for(let j=0;j<path.length;j++){
      const [px,py]=path[j];
      if(!paintable[py*MAX_SIDE+px] || rest[py*MAX_SIDE+px])invalid();
      const radius=stroke.taper==='ends'?
        Math.min(stroke.radius,j,path.length-1-j):stroke.radius;
      for(let dy=-radius;dy<=radius;dy++){
        for(let dx=-radius;dx<=radius;dx++){
          if(stroke.tip==='diamond' && Math.abs(dx)+Math.abs(dy)>radius)continue;
          const x=px+dx,y=py+dy;
          if(x<0||x>=MAX_SIDE||y<0||y>=MAX_SIDE)continue;
          const index=y*MAX_SIDE+x;
          if(paintable[index] && !rest[index])pixels.add(index);
        }
      }
    }
    if(used.size+pixels.size>MAX_PIXELS)invalid();
    for(const i of pixels)if(used.has(i))invalid();
    for(const i of pixels)used.add(i);
    clusters.push(Object.freeze({
      id:stroke.id,role:resolveShadeRole(stroke,roles),
      formReason:stroke.formReason,
      spans:spansFromPixels(pixels),
    }));
  }
  if(clusters.reduce((n,c)=>n+c.spans.length,0)>MAX_OUTPUT_SPANS)invalid();
  return Object.freeze(clusters);
}
/** Build exact row-span cluster candidates; later native UV preflight remains mandatory. */
export function compileMaterialBrushComposition(value,roles){
  return draw(normalizedMaterialBrushComposition(value,roles),roles);
}
