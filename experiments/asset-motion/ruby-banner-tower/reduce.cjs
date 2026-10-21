const fs=require('fs'),a=require('./result.json');
function simplify(f){
 const keep=new Set([0,f.length-1]);
 function rec(l,r){if(r-l<2)return;let max=0,at=0;
  for(let i=l+1;i<r;i++){const t=(f[i].time-f[l].time)/(f[r].time-f[l].time);let error=0;
   for(const [field,tol] of [['position',.045],['rotation',.45]])for(let j=0;j<3;j++)error=Math.max(error,Math.abs(f[i][field][j]-(f[l][field][j]*(1-t)+f[r][field][j]*t))/tol);
   if(error>max){max=error;at=i;}
  }if(max>1){keep.add(at);rec(l,at);rec(at,r);}
 }rec(0,f.length-1);
 return [...keep].sort((a,b)=>a-b).map(i=>({time:+f[i].time.toFixed(3),position:f[i].position.map(v=>+v.toFixed(5)),rotation:f[i].rotation.map(v=>+v.toFixed(5))}));
}
fs.writeFileSync(__dirname+'/reduced.json',JSON.stringify(a.map(p=>({...p,frames:simplify(p.frames)}))));
console.log(a.length);
