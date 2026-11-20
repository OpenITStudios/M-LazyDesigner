/** Derived view-only Paint selection mask, not editable atlas state. */
import type {SelectionRow,SelectionRaster} from './rustSurfaceTools';

  // Transient downscaled overlay: never bitmap, UV or Paint authority.
  export function drawSurfaceSelectionOverlay(canvas:HTMLCanvasElement,settings:{
    rows:SelectionRow[];width:number;height:number;
    raster:SelectionRaster|null;
  }){
    const draw=(data:typeof settings)=>{
      const context=canvas.getContext('2d');
      if(!context)return;
      context.clearRect(0,0,canvas.width,canvas.height);
      if(data.raster){
        // Small view-only OR-occupancy overview, not an editable PNG layer.
        try{
          if(canvas.width!==data.raster.width||canvas.height!==data.raster.height)return;
          const bytes=atob(data.raster.packed_mask_base64);
          if(bytes.length!==Math.ceil(canvas.width*canvas.height/8))return;
          const pixels=context.createImageData(canvas.width,canvas.height);
          for(let i=0;i<canvas.width*canvas.height;i++){
            if((bytes.charCodeAt(i>>3)&(1<<(i&7)))===0)continue;
            const at=i*4;
            pixels.data[at]=91;pixels.data[at+1]=177;
            pixels.data[at+2]=241;pixels.data[at+3]=120;
          }
          context.putImageData(pixels,0,0);
        }catch{/* Unsupported WebView preview never grants native edit permission. */}
        return;
      }
      context.fillStyle='rgba(91,177,241,0.38)';
      const sx=canvas.width/data.width,sy=canvas.height/data.height;
      for(const row of data.rows){
        context.fillRect(row.x0*sx,row.y*sy,(row.x1-row.x0)*sx,sy);
      }
    };
    draw(settings);
    return {update:draw};
  }
