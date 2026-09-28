import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {toCreasedNormals} from 'three/addons/utils/BufferGeometryUtils.js';
import {STLExporter} from 'three/addons/exporters/STLExporter.js';
import {defaults,clone,validateProject,componentFrames,tentFrame,ROWS,type Project,type MeshData,type V3,type Cluster} from './geometry';
import {hardware,type BuildResult,type Report,type Highlight} from './solid';
import './style.css';
const $=<E extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as E;
const STORAGE='rosebear-chassis-editor:v2';
$('app').innerHTML=`<header><div><h1>Rosebear / chassis editor</h1><p>Right hand · swept Skeletyl chassis · Cirque trackpad</p></div><span id="save-state">Local project</span></header><main><aside>
<section><h2>Key layout</h2><label><input id="edit" type="checkbox" checked> Show handles</label><small>Drag a handle parallel to the view: the Top view moves things in plan, the Front and Inner views change heights. Gold: a finger key. Up and down sets that key's height; along the column moves the column's stagger. Move a column sideways with its X offset field. Cyan: a thumb cluster's centre. Pink: turns a thumb cluster. Purple: the trackpad. Drag empty space to orbit; right-drag to pan; wheel to zoom.</small><div id="selection" aria-live="polite"><small>Click a handle to edit its numbers.</small></div><small>Values are in layout coordinates, before the whole hand is tented: +X toward the pinky, +Y away from you, +Z up.</small><button id="undo">Undo</button><button id="redo">Redo</button><button id="reset">Reset model</button></section>
<section><h2>View</h2><label><input id="caps" type="checkbox"> Keycaps (actual configured sizes)</label><label><input id="parts" type="checkbox" checked> Tiles and components</label><label><input id="base" type="checkbox" checked> Bottom plate</label><label>Chassis opacity<input id="opacity" type="range" min="0.1" max="1" step="0.05" value="1"></label><button id="rebuild">Rebuild & check</button><small>Handles and parts update while dragging. The previous chassis stays visible until rebuilding finishes.</small></section>
<section><h2>Clearance checks</h2><label>Keycap bottom at full press (mm) <input id="bottom-out" type="number" min="0" max="20" step="0.1"></label><small>Height above the flat switch seating plane.</small><label><input id="show-failures" type="checkbox" checked> Highlight failures in 3D</label><small id="fit-legend"><span class="rest">Red: at-rest / hardware collision</span><br><span class="travel">Orange: travel + clearance collision</span><br><span class="opening">Pink: opening / switch-seat defect / loose piece</span><br>Highlights show through the chassis. Click a result to isolate it.</small><button id="all-failures">Show all failures</button><div id="fit-focus" aria-live="polite"></div><div id="fit-badge">Starting geometry engine…</div><ul id="fit-list"></ul><small>Passing clearance alone does not qualify the chassis for manufacture.</small><button id="report" disabled>Save report</button></section>
<section><h2>Project</h2><button class="primary" id="export">Save project</button><button id="import">Open project</button><input id="file" type="file" accept=".json,application/json" hidden><button id="stl" disabled>Export review STL</button><small>Autosaved in this browser. Save a project file for backup or another browser.</small><div id="load-error"></div><details><summary>All configuration</summary><small>Every layout, chassis and component dimension. The handles and fields above edit the same values.</small><textarea id="config" aria-label="Configuration"></textarea><button id="apply-config">Apply configuration</button></details></section></aside>
<div id="viewport"><div id="viewbar">${['3D','Top','Underside','Front','Inner'].map(v=>`<button data-view="${v}">${v}</button>`).join('')}</div><div id="view-state">Loading model…</div></div></main>`;
let project=clone(defaults),loadProblem='';
try{const saved=localStorage.getItem(STORAGE);if(saved){const p=JSON.parse(saved);validateProject(p);project=p;$('save-state').textContent='Restored local autosave'}}catch(e){loadProblem='Could not restore autosave: '+String(e)}
$('load-error').textContent=loadProblem;
const undo:Project[]=[],redo:Project[]=[];
let hasShell=false,buildRequests=0,selected='';
let revision=0,solidRevision=-1,report:Report|undefined,busy=false,pending=false,timer:ReturnType<typeof setTimeout>|undefined,timeout:ReturnType<typeof setTimeout>|undefined;
const viewport=$('viewport'),scene=new T.Scene();scene.background=new T.Color('#101d25');
const camera=new T.OrthographicCamera(-120,120,100,-100,.1,1500);camera.up.set(0,0,1);
const renderer=new T.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=T.SRGBColorSpace;viewport.prepend(renderer.domElement);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.target.set(-20,-25,20);controls.minZoom=.3;controls.maxZoom=8;
scene.add(new T.HemisphereLight(0xc7e8ed,0x45585f,2));const light=new T.DirectionalLight(0xffffff,2.5);light.position.set(-60,-100,180);scene.add(light);
const material=new T.MeshStandardMaterial({color:0xb1cfca,roughness:.8,side:T.FrontSide});
const shell=new T.Mesh(new T.BufferGeometry(),material);scene.add(shell);
const basePlate=new T.Mesh(new T.BufferGeometry(),new T.MeshStandardMaterial({color:0x7f9a96,roughness:.8}));scene.add(basePlate);
const pad=new T.Mesh(new T.BufferGeometry(),new T.MeshStandardMaterial({color:0x3d474c,roughness:.35}));scene.add(pad);
const parts=new T.Group();scene.add(parts);
const failures=new T.Group();scene.add(failures);let focusedFailure:string|undefined;
function clearFailures(){for(const child of [...failures.children]){const mesh=child as T.Mesh;mesh.geometry.dispose();(mesh.material as T.Material).dispose();failures.remove(mesh)}focusedFailure=undefined;$('fit-focus').textContent='';render()}
function updateFailures(items:Highlight[]){clearFailures();for(const item of items){const color=item.kind==='travel'?0xffa124:(item.kind==='opening'||item.kind==='seat'||item.kind==='loose')?0xf16bd8:0xff303e;
 const mesh=new T.Mesh(geometry(item.mesh,false),new T.MeshBasicMaterial({color,transparent:true,opacity:.85,depthTest:false,depthWrite:false,side:T.FrontSide}));
 mesh.name=item.name;mesh.userData.kind=item.kind;mesh.renderOrder=item.kind==='travel'?5:6;failures.add(mesh)}failureVisibility()}
function failureVisibility(){failures.visible=$('show-failures').matches(':checked');for(const mesh of failures.children)mesh.visible=focusedFailure===undefined||mesh.name===focusedFailure;
 $('fit-focus').textContent=focusedFailure?`Showing: ${focusedFailure.replaceAll('_',' ')}`:'';
 document.querySelectorAll<HTMLButtonElement>('#fit-list button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.failure===focusedFailure)));render()}
function focusFailure(name?:string){focusedFailure=name;$<HTMLInputElement>('show-failures').checked=true;failureVisibility()}
$('show-failures').onchange=failureVisibility;$('all-failures').onclick=()=>focusFailure();

// Handles. Each has a world position and a drag rule that edits the project.
// A key handle ignores sideways movement; the X offset field moves a column.
type Cfg=Project['config'];type ClusterKey='thumb'|'thumb_extra';
const clusterOf=(c:Cfg,k:ClusterKey)=>(c.geometry as unknown as Record<ClusterKey,Cluster|undefined>)[k];
const clusters=(c:Cfg)=>(['thumb','thumb_extra'] as ClusterKey[]).filter(k=>clusterOf(c,k));
const tentRotation=(c:Cfg)=>{const t=tentFrame(c);t.setPosition(0,0,0);return t};
const toLayout=(c:Cfg,d:T.Vector3)=>d.clone().applyMatrix4(tentRotation(c).invert());
const world=(c:Cfg,p:number[])=>new T.Vector3(...p as V3).applyMatrix4(tentFrame(c));
const TURN=40;
function handles(p:Project){
 const c=p.config,frames=componentFrames(c),out:{id:string;kind:'key'|'cluster'|'turn'|'trackpad';at:T.Vector3}[]=[];
 for(const [n,m] of Object.entries(frames))if(n.startsWith('matrix_'))out.push({id:'key:'+n,kind:'key',at:new T.Vector3().setFromMatrixPosition(m)});
 for(const k of clusters(c)){const cl=clusterOf(c,k)!,root=new T.Vector3(...cl.position_mm as V3),a=cl.rotation_deg[2]*Math.PI/180;
  out.push({id:'cluster:'+k,kind:'cluster',at:world(c,root.toArray())});
  // In front of the cluster centre, in layout plan, along the cluster's own -Y.
  out.push({id:'turn:'+k,kind:'turn',at:world(c,[root.x+Math.sin(a)*TURN,root.y-Math.cos(a)*TURN,root.z])});}
 out.push({id:'trackpad',kind:'trackpad',at:new T.Vector3().setFromMatrixPosition(frames.trackpad)});
 return out;
}
// The layout axis nearest the view direction is left unchanged, so a drag in
// the top view never changes a height, whatever the tent.
function dragTo(base:Project,id:string,delta:T.Vector3,start:T.Vector3,view:T.Vector3):Project{
 const p=clone(base),c=p.config,d=toLayout(c,delta),v=toLayout(c,view),axis=[0,1,2].reduce((a,i)=>Math.abs(v.getComponent(i))>Math.abs(v.getComponent(a))?i:a,0);d.setComponent(axis,0);
 if(id.startsWith('key:')){const [,col,row]=id.slice(4).split('_'),column=c.geometry.columns.find(x=>x.name===col)!;
  column.heights_mm[ROWS.indexOf(row as typeof ROWS[number])]+=d.z;column.offset_mm[1]+=d.y}
 else if(id.startsWith('cluster:')){const cl=clusterOf(c,id.slice(8) as ClusterKey)!;cl.position_mm=cl.position_mm.map((x,i)=>x+d.getComponent(i))}
 else if(id.startsWith('turn:')){const cl=clusterOf(c,id.slice(5) as ClusterKey)!,o=world(c,cl.position_mm),s=toLayout(c,start.clone().sub(o)),e=toLayout(c,start.clone().add(delta).sub(o));
  cl.rotation_deg[2]+=(Math.atan2(e.y,e.x)-Math.atan2(s.y,s.x))*180/Math.PI}
 else if(id==='trackpad')c.trackpad.position_mm=c.trackpad.position_mm.map((x,i)=>x+d.getComponent(i));
 return p;
}
// Number fields for the selected handle: [label, path into the config].
type Field=[string,(string|number)[]];
function fields(id:string):{title:string;list:Field[]}{
 if(id.startsWith('key:')){const [,col]=id.slice(4).split('_'),i=defaults.config.geometry.columns.findIndex(x=>x.name===col),b=['geometry','columns',i];
  return {title:`${col} column`,list:[['X offset mm',[...b,'offset_mm',0]],['Stagger mm',[...b,'offset_mm',1]],...ROWS.map((r,j)=>[`${r} key height mm`,[...b,'heights_mm',j]] as Field),['Sideways tilt °',[...b,'roll_deg']],['Splay °',[...b,'rotation_deg',2]]]}}
 if(id.startsWith('cluster:')||id.startsWith('turn:')){const k=id.split(':')[1],b=['geometry',k];
  return {title:k==='thumb'?'thumb cluster':'extra thumb row',list:[['Centre X mm',[...b,'position_mm',0]],['Centre Y mm',[...b,'position_mm',1]],['Centre Z mm',[...b,'position_mm',2]],['Angle °',[...b,'rotation_deg',2]],['Tilt about X °',[...b,'rotation_deg',0]],['Tilt about Y °',[...b,'rotation_deg',1]],['Arc radius mm',[...b,'arc','radius_mm']],['Key spacing °',[...b,'arc','step_deg']],['Well ° per key',[...b,'arc','well_deg']]]}}
 if(id==='trackpad')return {title:'trackpad',list:[['X mm',['trackpad','position_mm',0]],['Y mm',['trackpad','position_mm',1]],['Z mm',['trackpad','position_mm',2]],['Tilt about Y °',['trackpad','rotation_deg',1]]]};
 return {title:'',list:[]};
}
const getAt=(o:unknown,path:(string|number)[])=>path.reduce((x:any,k)=>x?.[k],o) as number;
const setAt=(o:unknown,path:(string|number)[],v:number)=>{const last=path.at(-1)!;(path.slice(0,-1).reduce((x:any,k)=>x[k],o) as any)[last]=v};
function updateSelection(){
 const box=$('selection'),{title,list}=fields(selected);
 if(!title){box.innerHTML='<small>Click a handle to edit its numbers.</small>';return}
 box.innerHTML=`<strong>${title}</strong><div class="params">${list.map(([label],i)=>`<label>${label}<input type="number" step="0.5" data-field="${i}"></label>`).join('')}</div>`;
 box.querySelectorAll<HTMLInputElement>('input').forEach(input=>{const path=list[Number(input.dataset.field)][1];input.value=String(+getAt(project.config,path).toFixed(3));
  input.onchange=()=>{const v=Number(input.value);try{if(!Number.isFinite(v))throw Error('Not a number');const next=clone(project);setAt(next.config,path,v);validateProject(next);snapshot();project=next;refreshInputs();edited()}catch(e){$('load-error').textContent=String(e);input.value=String(getAt(project.config,path))}}});
}
const handleColors={key:0xffd48b,cluster:0x60dfff,turn:0xff8fd8,trackpad:0xb58cff};
const handleGroup=new T.Group();scene.add(handleGroup);
function updateHandles(){
 for(const o of [...handleGroup.children]){const pts=o as T.Points;pts.geometry.dispose();(pts.material as T.Material).dispose();handleGroup.remove(o)}
 const hs=handles(project);
 for(const [kind,color] of Object.entries(handleColors)){const ps=hs.filter(h=>h.kind===kind);
  const pts=new T.Points(new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(ps.flatMap(h=>h.at.toArray()),3)),new T.PointsMaterial({color,size:10,sizeAttenuation:false,depthTest:false,depthWrite:false,transparent:true}));pts.renderOrder=11;handleGroup.add(pts)}
 const sel=hs.find(h=>h.id===selected);
 if(sel){const pts=new T.Points(new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(sel.at.toArray(),3)),new T.PointsMaterial({color:0xffffff,size:15,sizeAttenuation:false,depthTest:false,depthWrite:false,transparent:true}));pts.renderOrder=12;handleGroup.add(pts)}
 // Lines from each cluster's centre to its turn handle.
 const lines:number[]=[];for(const k of clusters(project.config)){const a=hs.find(h=>h.id==='cluster:'+k)!,b=hs.find(h=>h.id==='turn:'+k)!;lines.push(...a.at.toArray(),...b.at.toArray())}
 const seg=new T.LineSegments(new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(lines,3)),new T.LineBasicMaterial({color:0xff8fd8,depthTest:false,transparent:true,opacity:.7}));seg.renderOrder=10;handleGroup.add(seg);
 handleGroup.visible=$('edit').matches(':checked');render();
}

let originalIndices=new Uint32Array(),scheduled=false;
const geometry=(data:MeshData,sharp:boolean)=>{const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(data.positions,3));g.setIndex(new T.BufferAttribute(data.indices,1));if(!sharp){g.computeVertexNormals();return g}const result=toCreasedNormals(g,Math.PI/6);if(result!==g)g.dispose();if(!result.index)result.setIndex(new T.BufferAttribute(Uint32Array.from({length:result.getAttribute('position').count},(_,i)=>i),1));return result};
function setMesh(mesh:T.Mesh,data:MeshData){mesh.geometry.dispose();mesh.geometry=geometry(data,true)}
function setShell(r:BuildResult){hasShell=true;setMesh(shell,r.mesh);setMesh(basePlate,r.base);setMesh(pad,r.trackpad);originalIndices=(shell.geometry.getIndex()!.array as Uint32Array).slice();render()}
function render(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;
 if(material.opacity<1&&originalIndices.length){camera.updateMatrixWorld();const pos=shell.geometry.getAttribute('position'),m=camera.matrixWorldInverse.elements,depth=new Float64Array(originalIndices.length/3);for(let i=0;i<depth.length;i++)for(let j=0;j<3;j++){const v=originalIndices[i*3+j];depth[i]+=m[2]*pos.getX(v)+m[6]*pos.getY(v)+m[10]*pos.getZ(v)}const order=Array.from(depth.keys()).sort((a,b)=>depth[a]-depth[b]),indices=new Uint32Array(originalIndices.length);order.forEach((f,i)=>indices.set(originalIndices.subarray(f*3,f*3+3),i*3));const index=shell.geometry.getIndex()!;(index.array as Uint32Array).set(indices);index.needsUpdate=true}
 renderer.render(scene,camera);
 })}
controls.addEventListener('change',render);
function resize(){const w=viewport.clientWidth,h=viewport.clientHeight;renderer.setSize(w,h);camera.left=-100*w/h;camera.right=100*w/h;camera.top=100;camera.bottom=-100;camera.updateProjectionMatrix();render()}
new ResizeObserver(resize).observe(viewport);
function preset(name:string){camera.up.set(0,0,1);let offset:V3=[-140,-170,150];if(name==='Top'){offset=[0,0,250];camera.up.set(0,1,0)}if(name==='Underside'){offset=[0,0,-250];camera.up.set(0,-1,0)}if(name==='Front')offset=[0,-250,0];if(name==='Inner')offset=[-250,0,0];camera.position.copy(controls.target).add(new T.Vector3(...offset));camera.zoom=1;camera.lookAt(controls.target);camera.updateProjectionMatrix();controls.update();render()}
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>b.onclick=()=>preset(b.dataset.view!));preset('3D');
const colors:Record<string,number>={pcb:0x268878,components:0x303b43,switch:0x667e86,keycaps:0xd7d8bd,trackpad:0x3d474c,adapter:0xd1a443};
function updateHardware(){for(const o of [...parts.children]){parts.remove(o);const m=o as T.Mesh;m.geometry.dispose();(m.material as T.Material).dispose()}
 for(const p of hardware(project)){if(p.group==='trackpad')continue;const g=new T.BoxGeometry(...p.size),o=new T.Mesh(g,new T.MeshStandardMaterial({color:colors[p.group],roughness:.8}));g.translate(...p.center);o.applyMatrix4(new T.Matrix4().fromArray(p.matrix));o.userData.group=p.group;o.name=p.name;parts.add(o)}visibility()}
function visibility(){for(const o of parts.children)o.visible=o.userData.group==='keycaps'?$('caps').matches(':checked'):o.userData.group==='switch'?false:$('parts').matches(':checked');basePlate.visible=$('base').matches(':checked');handleGroup.visible=$('edit').matches(':checked');render()}
function autosave(){try{localStorage.setItem(STORAGE,JSON.stringify(project));$('save-state').textContent='Autosaved locally'}catch{$('save-state').textContent='Autosave unavailable — save a project file'}}
function snapshot(){undo.push(clone(project));if(undo.length>60)undo.shift();redo.length=0;historyButtons()}
function historyButtons(){$<HTMLButtonElement>('undo').disabled=!undo.length;$<HTMLButtonElement>('redo').disabled=!redo.length}
function markStale(){clearFailures();revision++;solidRevision=-1;report=undefined;$<HTMLButtonElement>('stl').disabled=true;$<HTMLButtonElement>('report').disabled=true;$('fit-badge').className='';$('fit-badge').textContent='Not checked for this edit';$('fit-list').replaceChildren();$('view-state').textContent=hasShell?'Editing — showing the previous chassis until rebuild':'Editing — first chassis is pending'}
function preview(){try{componentFrames(project.config);updateHardware();updateHandles();parts.visible=true}catch(e){parts.visible=false;render();$('view-state').textContent=String(e)+' — undo to recover'}}
function edited(){markStale();preview();autosave();clearTimeout(timer);timer=setTimeout(requestBuild,250)}
function refreshInputs(){$<HTMLInputElement>('bottom-out').value=String(project.config.switch.keycap_bottom_above_plate_mm-project.config.switch.travel_mm);$<HTMLTextAreaElement>('config').value=JSON.stringify(project.config,null,2);updateSelection()}
let worker:Worker,workerBuilds=0;
// Each build leaves some geometry-engine memory behind, so a fresh worker takes over every few builds.
function startWorker(){worker=new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});workerBuilds=0;worker.onmessage=(e:MessageEvent<BuildResult&{id:number;error?:string}>)=>{clearTimeout(timeout);busy=false;if(++workerBuilds>=8){worker.terminate();startWorker()}if(e.data.id===revision){if(e.data.error){$('fit-badge').className='fail';$('fit-badge').textContent='Invalid geometry';$('view-state').textContent=e.data.error+' — edit or undo to recover';$('fit-list').replaceChildren()}else{setShell(e.data);updateFailures(e.data.highlights);report=e.data.report;solidRevision=revision;showReport(report);$<HTMLButtonElement>('stl').disabled=false;$<HTMLButtonElement>('report').disabled=false;$('view-state').textContent=`Chassis rebuilt in ${(report.milliseconds/1000).toFixed(2)} s`}}if(pending){pending=false;requestBuild()}};worker.onerror=e=>{clearTimeout(timeout);busy=false;pending=false;$('fit-badge').className='fail';$('fit-badge').textContent='Geometry worker failed';$('view-state').textContent=e.message;worker.terminate();startWorker()}}
function requestBuild(){clearTimeout(timer);if(drag||busy){pending=true;return}pending=false;busy=true;const id=revision;$('fit-badge').className='';$('fit-badge').textContent='Building chassis & checking fit…';buildRequests++;worker.postMessage({id,project:clone(project)});timeout=setTimeout(()=>{worker.terminate();busy=false;pending=false;startWorker();$('fit-badge').className='fail';$('fit-badge').textContent='Rebuild timed out';$('view-state').textContent='Worker stopped after 30 seconds. Undo the last change or try Rebuild again.'},30000)}
function showReport(r:Report){const badge=$('fit-badge');badge.className=r.passed?'pass':'fail';badge.textContent=r.passed?'Clearance checks PASS':'Clearance checks FAIL';const list=$('fit-list');list.replaceChildren();const add=(text:string,name?:string)=>{const li=document.createElement('li');if(name){const b=document.createElement('button');b.textContent=text;b.dataset.failure=name;b.setAttribute('aria-pressed','false');b.onclick=()=>focusFailure(name);li.append(b)}else li.textContent=text;list.append(li)};
 add(`${r.seats.filter(s=>s.passed).length}/${r.seats.length} flat switch seats pass thickness and clip-clearance checks.`);
 add(r.pieces.length===1?'The chassis is one piece without the bottom plate.':`The chassis is ${r.pieces.length} pieces without the bottom plate.`);
 for(let i=1;i<r.pieces.length;i++)add(`loose piece ${i}: ${(r.pieces[i]/1000).toFixed(1)} cm³`,`loose piece ${i}`);
 for(const seat of r.seats)if(!seat.passed)add(`${seat.name}: switch seat defect (${seat.missing.toFixed(2)} mm³ missing, ${seat.excess.toFixed(2)} mm³ outside seating planes, ${seat.clipBlocked.toFixed(2)} mm³ clip obstruction)`,seat.name);
 for(const k of r.keycaps)if(!k.passed)add(`${k.name.replaceAll('_',' ')}: ${k.atRest.toFixed(2)} mm³ at rest; ${k.swept.toFixed(2)} mm³ through travel + ${k.margin} mm clearance`,k.name);
 for(const h of r.hardware)add(`${h.name}: ${h.volume.toFixed(2)} mm³ ${h.group}/chassis overlap`,h.name);
 for(const o of r.openings)if(o.covered<9||o.blocked||o.removed<.001)add(`${o.name}: incomplete opening (${o.covered}/9 probes, ${o.blocked} blocked)`,o.name);
 for(const g of r.capGaps)add(`Closest keycaps, ${g.between}: ${g.gap<=0?'touching':g.gap.toFixed(1)+' mm'}`);
 if(r.passed)add('No chassis intersections with the checked hardware and keycap envelopes.');}
$('undo').onclick=()=>{const p=undo.pop();if(!p)return;redo.push(clone(project));project=p;historyButtons();refreshInputs();edited()};
$('redo').onclick=()=>{const p=redo.pop();if(!p)return;undo.push(clone(project));project=p;historyButtons();refreshInputs();edited()};
$('reset').onclick=()=>{snapshot();project=clone(defaults);refreshInputs();edited()};
for(const id of ['edit','caps','parts','base'])$(id).onchange=visibility;
$('opacity').oninput=()=>{material.opacity=Number($<HTMLInputElement>('opacity').value);material.transparent=material.opacity<1;material.depthWrite=!material.transparent;material.needsUpdate=true;render()};
$('rebuild').onclick=requestBuild;
$('bottom-out').onchange=()=>{const n=Number($<HTMLInputElement>('bottom-out').value);if(!Number.isFinite(n)||n<0||n>20){refreshInputs();return}snapshot();project.config.switch.keycap_bottom_above_plate_mm=project.config.switch.travel_mm+n;refreshInputs();edited()};
$('apply-config').onclick=()=>{try{const next=clone(project);next.config=JSON.parse($<HTMLTextAreaElement>('config').value);validateProject(next);snapshot();project=next;refreshInputs();edited();$('load-error').textContent=''}catch(e){$('load-error').textContent=String(e)}};
function download(name:string,data:BlobPart,type:string){const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
$('export').onclick=()=>download('rosebear-chassis-project.json',JSON.stringify(project,null,2),'application/json');
$('report').onclick=()=>{if(solidRevision===revision&&report)download('rosebear-clearance-report.json',JSON.stringify({report,evaluatedProject:project},null,2),'application/json')};
$('stl').onclick=()=>{if(solidRevision!==revision)return;download('rosebear-right-review.stl',new STLExporter().parse(shell,{binary:true}) as DataView<ArrayBuffer>,'application/octet-stream')};
$('import').onclick=()=>$<HTMLInputElement>('file').click();
$('file').onchange=async()=>{const input=$<HTMLInputElement>('file'),file=input.files?.[0];if(!file)return;try{if(file.size>2_000_000)throw Error('Project file exceeds 2 MB');const next=JSON.parse(await file.text());validateProject(next);snapshot();project=next;selected='';refreshInputs();edited();$('load-error').textContent=''}catch(e){$('load-error').textContent=String(e)}finally{input.value=''}};
const ray=new T.Raycaster(),pointer=new T.Vector2();let drag:{plane:T.Plane;start:T.Vector3;point:T.Vector3;id:string;changed:boolean;base:Project}|undefined;
function cursor(e:PointerEvent){const r=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(pointer,camera)}
const screen=(p:T.Vector3)=>{const r=renderer.domElement.getBoundingClientRect(),q=p.clone().project(camera);return {x:r.left+(q.x+1)*r.width/2,y:r.top+(1-q.y)*r.height/2,visible:q.z>=-1&&q.z<=1}};
renderer.domElement.addEventListener('pointerdown',e=>{
 if(e.button!==0||!$('edit').matches(':checked'))return;
 let best=13,hit:ReturnType<typeof handles>[number]|undefined;
 for(const h of handles(project)){const s=screen(h.at),d=Math.hypot(s.x-e.clientX,s.y-e.clientY);if(s.visible&&d<best){best=d;hit=h}}
 if(!hit)return;e.stopImmediatePropagation();e.preventDefault();selected=hit.id;updateSelection();updateHandles();cursor(e);
 const plane=new T.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new T.Vector3()),hit.at),start=ray.ray.intersectPlane(plane,new T.Vector3());if(!start)return;
 drag={plane,start,point:hit.at.clone(),id:hit.id,changed:false,base:clone(project)};controls.enabled=false;renderer.domElement.setPointerCapture(e.pointerId);render()},true);
renderer.domElement.addEventListener('pointermove',e=>{if(!drag)return;e.stopImmediatePropagation();cursor(e);const hit=ray.ray.intersectPlane(drag.plane,new T.Vector3());if(!hit)return;const delta=hit.sub(drag.start);if(drag.point.clone().add(delta).toArray().some(x=>Math.abs(x)>1000))return;
 let next:Project;try{next=dragTo(drag.base,drag.id,delta,drag.point,camera.getWorldDirection(new T.Vector3()));validateProject(next)}catch{return}
 if(!drag.changed){snapshot();clearTimeout(timer)}markStale();project=next;drag.changed=true;preview();updateSelection()},true);
function endDrag(e:PointerEvent,cancel=false){if(!drag)return;e.stopImmediatePropagation();if(cancel&&drag.changed){const previous=undo.pop();if(previous)project=previous;historyButtons();preview()}const changed=drag.changed;drag=undefined;controls.enabled=true;refreshInputs();autosave();if(changed)requestBuild()}
renderer.domElement.addEventListener('pointerup',e=>endDrag(e),true);renderer.domElement.addEventListener('pointercancel',e=>endDrag(e,true),true);
window.addEventListener('keydown',e=>{if((e.target as HTMLElement).matches('input,textarea,select'))return;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();$(e.shiftKey?'redo':'undo').click()}});
// Used by browser tests to inspect the exact state behind visible controls.
Object.assign(window,{rosebearEditor:{getBuildRequests:()=>buildRequests,getShellId:()=>shell.geometry.uuid,getProject:()=>clone(project),getRevision:()=>revision,getSolidRevision:()=>solidRevision,getReport:()=>report,getSelected:()=>selected,
 handleScreen:(id:string)=>{const h=handles(project).find(h=>h.id===id);if(!h)throw Error('No handle '+id);return screen(h.at)},
 getHardware:()=>parts.children.map(o=>({name:o.name,group:o.userData.group,matrix:o.matrix.elements.slice()})),
 getHighlights:()=>failures.children.map(m=>({name:m.name,kind:m.userData.kind,visible:failures.visible&&m.visible,triangles:(m as T.Mesh).geometry.getIndex()!.count/3})),viewNormal:()=>camera.getWorldDirection(new T.Vector3()).toArray()}});
historyButtons();refreshInputs();preview();startWorker();requestBuild();resize();
