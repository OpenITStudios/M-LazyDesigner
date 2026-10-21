const fs=require('fs'),C=require('./cannon-es.cjs');
const input=JSON.parse(fs.readFileSync(__dirname+'/input.json','utf8'));
const V=a=>new C.Vec3(...a), rad=Math.PI/180;
function shape(e) {
 const q=new C.Quaternion();q.setFromEuler(...e.rotation.map(v=>v*rad),'ZYX');
 const center=e.from.map((v,j)=>(v+e.to[j])/2),p=q.vmult(V(center.map((v,j)=>v-e.origin[j]))).vadd(V(e.origin));
 const size=e.to.map((v,j)=>v-e.from[j]);
 return {q,p,size,volume:size.reduce((a,b)=>a*b,1)};
}
const world=new C.World({gravity:new C.Vec3(0,-110,0),allowSleep:true});
world.solver.iterations=35;world.solver.tolerance=1e-7;
world.defaultContactMaterial.friction=.68;world.defaultContactMaterial.restitution=.035;
world.defaultContactMaterial.contactEquationStiffness=1e5;
world.defaultContactMaterial.contactEquationRelaxation=8;
const ground=new C.Body({mass:0,shape:new C.Plane()});ground.quaternion.setFromEuler(-Math.PI/2,0,0);world.addBody(ground);
for(const e of input.base){const s=shape(e),b=new C.Body({mass:0,position:s.p,quaternion:s.q,shape:new C.Box(V(s.size.map(v=>v/2)))});world.addBody(b);}
const pieces=input.parts.map(p=>{
 const shapes=p.elements.map(shape),vol=shapes.reduce((a,s)=>a+s.volume,0),com=new C.Vec3();
 for(const s of shapes)com.vadd(s.p.scale(s.volume/vol),com);
 const stone=p.elements.some(e=>e.to[1]-e.from[1]>10)&&!p.name.startsWith('banner');
 const b=new C.Body({mass:Math.max(.3,vol*.015),position:com.vadd(new C.Vec3(0,p.initial,0)),type:C.Body.KINEMATIC,linearDamping:.25,angularDamping:.45,sleepSpeedLimit:.25,sleepTimeLimit:.5,collisionFilterMask:0});
 for(const s of shapes)b.addShape(new C.Box(V(s.size.map(v=>Math.max(.04,v/2)))),s.p.vsub(com),s.q);
 world.addBody(b);
 const delay=.3+((p.index*37)%13)*.005;
 return {...p,b,com,delay,released:false,stone,frames:[],prev:[0,0,0]};
});
function euler(q,prev){
 const {x,y,z,w}=q,clamp=v=>Math.max(-1,Math.min(1,v));
 const m11=1-2*(y*y+z*z),m21=2*(x*y+w*z),m31=2*(x*z-w*y),m32=2*(y*z+w*x),m33=1-2*(x*x+y*y);
 let out=[Math.atan2(m32,m33),Math.asin(-clamp(m31)),Math.atan2(m21,m11)].map(v=>v/rad);
 const alt=[out[0]+180,180-out[1],out[2]+180];
 const unwrap=a=>a.map((v,i)=>v+360*Math.round((prev[i]-v)/360));
 const a=unwrap(out),b=unwrap(alt),score=p=>p.reduce((n,v,i)=>n+(v-prev[i])**2,0);
 return score(a)<=score(b)?a:b;
}
const dt=1/240;
for(let n=0;n<=1920;n++){
 const t=n*dt;
 for(const p of pieces)if(!p.released&&t>=p.delay){
  p.released=true;p.b.type=C.Body.DYNAMIC;p.b.updateMassProperties();p.b.wakeUp();
  const i=p.index,angle=i*2.399,side=p.stone?1.6:2.7;
  p.b.velocity.set(Math.cos(angle)*side,-.15,Math.sin(angle)*side);
  const spin=p.stone?.65:1.8;
  p.b.angularVelocity.set(Math.sin(i*1.7)*spin,.35*Math.cos(i*2.1),Math.cos(i*.91)*spin);
  if(p.elements.some(e=>e.to[1]-e.from[1]>19)&&!p.name.startsWith('banner')){
   const sign=i%2?-1:1;
   p.b.velocity.set(sign*4,-.2,2);
   p.b.angularVelocity.set(sign*2.8,.2,sign*1.3);
  }
 }
 for(const p of pieces){
  if(t>.5)p.b.collisionFilterMask=-1;
  if(p.b.velocity.length()>32)p.b.velocity.scale(32/p.b.velocity.length(),p.b.velocity);
  if(p.b.angularVelocity.length()>4)p.b.angularVelocity.scale(4/p.b.angularVelocity.length(),p.b.angularVelocity);
 }
 if(n)world.step(dt);
 if(n%8===0)for(const p of pieces){
  const q=p.b.quaternion,offset=q.vmult(p.com.vsub(V(p.origin)));
  const pos=p.b.position.vsub(offset).vsub(V(p.origin));
  const rotation=euler(q,p.prev);p.prev=rotation;
  p.frames.push({time:+t.toFixed(5),position:pos.toArray(),rotation});
 }
}
const result=pieces.map(p=>({name:p.name,origin:p.origin,frames:p.frames,sleep:p.b.sleepState,speed:p.b.velocity.length(),angular:p.b.angularVelocity.length()}));
fs.writeFileSync(__dirname+'/result.json',JSON.stringify(result));
console.log(JSON.stringify(result.map(p=>({name:p.name,sleep:p.sleep,speed:+p.speed.toFixed(4),angular:+p.angular.toFixed(4)}))));
