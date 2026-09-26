const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync(process.argv[2],'utf8');
let live=0,created=0,deleted=0,bound=null,alpha=1,depthWrite=true;
const enabledGL=new Set(),calls=[];
const gl=new Proxy({
 createBuffer(){live++;return {id:++created}},deleteBuffer(){live--;deleted++},
 getShaderParameter(){return true},getProgramParameter(){return true},
 getUniformLocation(program,key){return key},bindBuffer(type,b){bound=b},
 bufferData(type,data){bound.data=data},uniform1f(key,value){if(key==='alpha')alpha=value},
 depthMask(value){depthWrite=value},enable(key){enabledGL.add(key)},disable(key){enabledGL.delete(key)},
 drawArrays(type,start,count){calls.push({type,count,alpha,depthWrite,depthTest:enabledGL.has('DEPTH_TEST'),blend:enabledGL.has('BLEND'),data:bound.data})}
}, {get(target,key){return key in target?target[key]:/^[A-Z_0-9]+$/.test(key)?key:(()=>({}))}});
function element(value=''){return {value,textContent:'',checked:false,clientWidth:1000,clientHeight:800,firstChild:{},children:[],append(x){this.children.push(x);if(!this.value&&x.value)this.value=x.value},getContext(){return gl},setPointerCapture(){}}}
const elems=new Map();
for(const m of html.matchAll(/<script type="application\/json" id="([^"]+)">([\s\S]*?)<\/script>/g)){const e=element();e.textContent=m[2];elems.set(m[1],e)}
elems.set('hand',element('r'));elems.set('opacity',element('1'));
const links=['report.json','config.json','cut-shell-review.obj','control-mesh.json'].map(file=>({dataset:{file},href:file}));
const document={getElementById(id){if(!elems.has(id))elems.set(id,element());return elems.get(id)},createElement(){return element()},querySelectorAll(q){return q==='[data-file]'?links:[]}};
const context=vm.createContext({document,window:{devicePixelRatio:1},ResizeObserver:class{observe(){}},console,Float32Array});
const js=html.match(/<script>([\s\S]*?)<\/script>/)[1];
vm.runInContext(js,context,{timeout:20000});
assert.equal(document.getElementById('variant').children.length,1);
assert.equal(document.getElementById('variant').value,'ffc_below');
assert(calls.length>1);
assert(calls.every(c=>c.depthWrite&&c.depthTest&&!c.blend&&c.alpha===1),'Opaque rendering must write depth with blending off');
vm.runInContext("yaw=.7;pitch=-.4;zoom=1.2;enabled.add('keycaps')",context);
for(const id of ['ffc_below']){
 const selector=document.getElementById('variant');selector.value=id;selector.onchange();
 assert.equal(vm.runInContext('yaw',context),.7);assert.equal(vm.runInContext('zoom',context),1.2);
 assert(vm.runInContext("enabled.has('keycaps')",context));
 assert.equal(links[0].href,id+'/report.json');
 assert.equal(live,vm.runInContext('objects.length',context));
 document.getElementById('hand').value='l';document.getElementById('hand').onchange();
 document.getElementById('hand').value='r';document.getElementById('hand').onchange();
}
for(const [yaw,pitch] of [[0,0],[.7,-.4],[1.2,Math.PI]]){
 vm.runInContext(`yaw=${yaw};pitch=${pitch}`,context);calls.length=0;
 document.getElementById('opacity').value='0.9';document.getElementById('opacity').oninput();
 const transparent=calls.filter(c=>c.alpha<1);assert.equal(transparent.length,1);
 const t=transparent[0];assert(t.depthTest&&t.blend&&!t.depthWrite);
 assert(calls.indexOf(t)===calls.length-1,'Transparent shell must follow opaque hardware');
 assert(calls.filter(c=>c!==t).every(c=>c.depthWrite&&!c.blend&&c.alpha===1));
 const depths=[];for(let i=0;i<t.data.length;i+=18){let z=0;for(let k=0;k<3;k++){const p=i+k*6;z+=Math.sin(yaw)*Math.sin(pitch)*t.data[p]+Math.cos(yaw)*Math.sin(pitch)*t.data[p+1]+Math.cos(pitch)*t.data[p+2]}depths.push(z/3)}
 for(let i=1;i<depths.length;i++)assert(depths[i]>=depths[i-1]-1e-5,'Triangles must be sorted far to near in the actual camera frame');
 assert(depthWrite&&enabledGL.has('DEPTH_TEST')&&!enabledGL.has('BLEND'),'Restore render state after transparency');
}
calls.length=0;document.getElementById('opacity').value='1';document.getElementById('opacity').oninput();
assert(calls.every(c=>c.depthWrite&&c.depthTest&&!c.blend),'Return from transparency to opacity must restore depth writes');
vm.runInContext("enabled.add('cage');draw();",context);
assert(calls.filter(c=>c.type==='LINES').every(c=>!c.depthTest&&!c.blend&&c.alpha===1),'Only the selected cage uses x-ray drawing');
assert(document.getElementById('variant-label').hidden);assert.equal(links[3].href,'ffc_below/control-mesh.json');assert(deleted>0);
console.log('Viewer checks passed: links, camera/layers, GPU cleanup, opaque depth, transparency ordering, state restoration and cage overlay.',{created,deleted,live});
