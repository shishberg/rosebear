"""Dependency-free offline mesh viewer and vector review sheets."""
import html
import json
import math
import struct
import zlib
import base64
import numpy as np


def write_viewer(path, objects, report, palette, variants=None, foundation=False):
    template = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rosebear · parametric chassis</title><style>
*{box-sizing:border-box}body{margin:0;background:#101d25;color:#e9f0ed;font:15px system-ui}header{padding:20px 26px;border-bottom:1px solid #34434b}h1{font-size:23px;margin:0 0 7px}p{margin:5px 0;color:#b5c5ca}main{display:grid;grid-template-columns:250px 1fr;height:calc(100vh - 115px);min-height:540px}aside{padding:22px;overflow:auto}label{display:block;padding:7px 0}input{accent-color:#72c4b4}button,select{background:#233943;color:#f1f5f2;border:1px solid #52717a;padding:8px;border-radius:5px;margin:3px}select{max-width:100%;width:100%}canvas{width:100%;height:100%;touch-action:none;display:block}small{display:block;color:#b4c4ca;line-height:1.5;margin-top:15px}.swatch{display:inline-block;width:10px;height:10px;margin-right:7px;border-radius:3px}a{color:#83d2c4}.badge{color:#f2c67d} @media(max-width:650px){main{grid-template-columns:170px 1fr}aside{padding:10px}}
</style><header><h1>Rosebear / chassis study 16</h1><p>Surface-first well · normal-aligned keys · 10° tent · raised trackball · 1.5u centre thumb + clearance</p></header><main><aside>
<label id="variant-label">Arrangement<select id="variant" aria-label="Arrangement"></select></label>
<select id="hand" aria-label="Hand"><option value="r">Right hand</option><option value="l">Left hand</option></select>
<div id="layers"></div><label><input id="explode" type="checkbox"> Lower the base</label>
<button data-view="iso">3D view</button><button data-view="top">Top</button><button data-view="under">Underside</button><button data-view="front">Palm side</button>
<button data-view="inner">Pod / inner side</button>
<small>Drag to orbit · scroll to zoom · double-click to reset. Dimensions in mm. Purchased components are simplified envelopes.</small>
<small class="badge">Prototype: confirm PCB, adapter, trackball and switch fits before printing the whole shell.</small>
<small id="fit-warnings" class="badge"></small><small id="status"></small><small><a data-file="report.json" href="report.json">Geometry report</a> · <a data-file="config.json" href="config.json">Configuration snapshot</a><br><a data-file="r-shell.stl" href="r-shell.stl">Right shell STL</a> · <a data-file="l-shell.stl" href="l-shell.stl">Left shell STL</a><br><a data-file="switch-pcb-fit-coupon.stl" href="switch-pcb-fit-coupon.stl">Fit coupon STL</a></small>
</aside><canvas id="c" aria-label="Rotatable 3D chassis preview"></canvas></main>__MESH_DATA__<script>
const datasets=__DATASETS__, palette=__PALETTE__;
let objects=JSON.parse(document.getElementById('mesh-'+datasets[0].id).textContent),report=datasets[0].report;
const variant=document.getElementById('variant');
for(const d of datasets){const option=document.createElement('option');option.value=d.id;option.textContent=d.label;variant.append(option)}
document.getElementById('variant-label').hidden=datasets.length<2;
document.getElementById('fit-warnings').textContent=(report.warnings||[]).length+' fit warnings — see Geometry report.';
const c=document.getElementById('c'),gl=c.getContext('webgl',{antialias:true}),enabled=new Set(['shell','pcb','components','trackball','ball','adapter']);
if(!gl){document.getElementById('status').innerHTML='WebGL unavailable. <a href="perspective.png">Open static preview</a>.';throw new Error('WebGL unavailable')}
function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s}
const prog=gl.createProgram();gl.attachShader(prog,shader(gl.VERTEX_SHADER,`attribute vec3 pos;attribute vec3 normal;uniform mat4 view;uniform mat3 rot;uniform vec3 center;uniform float drop;varying float light;void main(){vec3 p=pos-center;p.z-=drop;gl_Position=view*vec4(p,1.);light=.5+.5*max(0.,dot(normalize(rot*normal),normalize(vec3(-.3,-.4,.85))));}`));
gl.attachShader(prog,shader(gl.FRAGMENT_SHADER,`precision mediump float;uniform vec3 color;varying float light;void main(){gl_FragColor=vec4(color*light,1.);}`));gl.linkProgram(prog);if(!gl.getProgramParameter(prog,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(prog));gl.useProgram(prog);
const loc={};for(const k of ['view','rot','center','drop','color'])loc[k]=gl.getUniformLocation(prog,k);loc.pos=gl.getAttribLocation(prog,'pos');loc.normal=gl.getAttribLocation(prog,'normal');
function upload(){for(const o of objects){let data=[];for(const f of o.f){let a=o.v[f[0]],b=o.v[f[1]],c=o.v[f[2]],u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];for(const p of [a,b,c])data.push(...p,...n)}o.buffer=gl.createBuffer();o.count=data.length/6;gl.bindBuffer(gl.ARRAY_BUFFER,o.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW)}}upload();
gl.enable(gl.DEPTH_TEST);gl.enable(gl.CULL_FACE);gl.cullFace(gl.BACK);gl.clearColor(16/255,29/255,37/255,1);
const labels={shell:'Shell',base:'Removable base',pcb:'Key PCBs',components:'Sockets / LEDs / diodes',switch:'Switch bodies',keycaps:'Keycaps',adapter:'FFC adapter',trackball:'Trackball module',ball:'Ball',surface:'Uncut design surface'};
for(const [k,v] of Object.entries(labels)){const l=document.createElement('label');l.innerHTML=`<input type="checkbox" ${enabled.has(k)?'checked':''} value="${k}"> <span class="swatch" style="background:${palette[k]}"></span>${v}`;l.firstChild.onchange=e=>{e.target.checked?enabled.add(k):enabled.delete(k);draw()};document.getElementById('layers').append(l)}
let yaw=-.55,pitch=-.9,zoom=1,drag=null;
const hand=document.getElementById('hand'),explode=document.getElementById('explode');
hand.onchange=()=>{zoom=1;draw()};explode.onchange=draw;
variant.onchange=()=>{
 const d=datasets.find(d=>d.id===variant.value);
 for(const o of objects)gl.deleteBuffer(o.buffer);
 objects=JSON.parse(document.getElementById('mesh-'+d.id).textContent);report=d.report;upload();
 document.getElementById('fit-warnings').textContent=(report.warnings||[]).length+' fit warnings — see Geometry report.';
 document.querySelectorAll('[data-file]').forEach(a=>a.href=d.directory+a.dataset.file);
 draw();
};
function preset(v){if(v==='top'){yaw=0;pitch=0}else if(v==='under'){yaw=0;pitch=Math.PI}else if(v==='front'){yaw=0;pitch=-Math.PI/2}else if(v==='inner'){yaw=hand.value==='r'?Math.PI/2:-Math.PI/2;pitch=-1.1}else{yaw=-.55;pitch=-.9}zoom=1;draw()}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>preset(b.dataset.view));
c.onpointerdown=e=>{drag=[e.clientX,e.clientY];c.setPointerCapture(e.pointerId)};
c.onpointermove=e=>{if(drag){yaw+=(e.clientX-drag[0])*.008;pitch+=(e.clientY-drag[1])*.008;drag=[e.clientX,e.clientY];draw()}};
c.onpointerup=c.onpointercancel=()=>drag=null;c.ondblclick=()=>preset('iso');
c.onwheel=e=>{e.preventDefault();zoom=Math.max(.35,Math.min(5,zoom*Math.exp(-e.deltaY*.001)));draw()};
function draw(){const ratio=Math.min(window.devicePixelRatio||1,2),w=c.clientWidth,h=c.clientHeight;if(!w||!h)return;c.width=w*ratio;c.height=h*ratio;gl.viewport(0,0,c.width,c.height);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
 const all=objects.filter(o=>o.hand===hand.value), verts=all.filter(o=>o.group==='shell')[0].v;
 const lo=[0,1,2].map(i=>Math.min(...verts.map(v=>v[i]))),hi=[0,1,2].map(i=>Math.max(...verts.map(v=>v[i]))),mid=lo.map((v,i)=>(v+hi[i])/2);
 const scale=Math.min(w/(hi[0]-lo[0]+50),h/(hi[1]-lo[1]+65))*zoom,sy=Math.sin(yaw),cy=Math.cos(yaw),sp=Math.sin(pitch),cp=Math.cos(pitch),sx=2*scale/w,sz=2*scale/h;
 gl.uniformMatrix4fv(loc.view,false,new Float32Array([cy*sx,sy*cp*sz,-sy*sp/500,0,-sy*sx,cy*cp*sz,-cy*sp/500,0,0,-sp*sz,-cp/500,0,0,0,0,1]));
 gl.uniformMatrix3fv(loc.rot,false,new Float32Array([cy,sy*cp,sy*sp,-sy,cy*cp,cy*sp,0,-sp,cp]));gl.uniform3fv(loc.center,mid);
 for(const o of all){if(!enabled.has(o.group))continue;gl.bindBuffer(gl.ARRAY_BUFFER,o.buffer);gl.enableVertexAttribArray(loc.pos);gl.enableVertexAttribArray(loc.normal);gl.vertexAttribPointer(loc.pos,3,gl.FLOAT,false,24,0);gl.vertexAttribPointer(loc.normal,3,gl.FLOAT,false,24,12);gl.uniform3fv(loc.color,[1,3,5].map(i=>parseInt(palette[o.group].slice(i,i+2),16)/255));gl.uniform1f(loc.drop,o.group==='base'&&explode.checked?20:0);gl.drawArrays(gl.TRIANGLES,0,o.count)}
 document.getElementById('status').textContent=`Shell: ${(hi[0]-lo[0]).toFixed(1)} × ${(hi[1]-lo[1]).toFixed(1)} × ${(hi[2]-lo[2]).toFixed(1)} mm. ${report.collisions.filter(c=>c.hand===hand.value).length} nominal overlap findings; see report.`;
}new ResizeObserver(draw).observe(c);draw();
</script></html>'''
    if foundation:
        template=template.replace('href="perspective.png"','href="'+(variants[0]['directory'] if variants else '')+'perspective.png"')
        template=template.replace('Rosebear / chassis study 16','Rosebear / shared-surface foundation')
        template=template.replace('Surface-first well · normal-aligned keys · 10° tent · raised trackball · 1.5u centre thumb + clearance','Inner trackball · FFC underneath · component cutout review')
        template=template.replace('<label><input id="explode" type="checkbox"> Lower the base</label>', '<label hidden><input id="explode" type="checkbox"> Lower the base</label><label>Exterior opacity<input id="opacity" type="range" min="0.1" max="1" step="0.05" value="1"></label>')
        template=template.replace('Prototype: confirm PCB, adapter, trackball and switch fits before printing the whole shell.','Cutout review: nominal 2 mm shell with switch, trackball and ribbon openings. Clips and PCB retention are pending. Review fit findings before manufacturing. Other arrangements are paused.')
        template=template.replace('data-file="r-shell.stl" href="r-shell.stl">Right shell STL','data-file="cut-shell-review.obj" href="cut-shell-review.obj">Cut shell review OBJ')
        template=template.replace('data-file="l-shell.stl" href="l-shell.stl">Left shell STL','data-file="control-mesh.json" href="control-mesh.json">Control mesh JSON')
        template=template.replace('<br><a data-file="switch-pcb-fit-coupon.stl" href="switch-pcb-fit-coupon.stl">Fit coupon STL</a>','')
        template=template.replace("' fit warnings — see Geometry report.'","' fit review findings — see Geometry report.'")
        template=template.replace("new Set(['shell','pcb','components','trackball','ball','adapter'])","new Set(['shell','pcb','trackball','ball','adapter'])")
        template=template.replace('vec3 p=pos-center;', 'gl_PointSize=5.;vec3 p=pos-center;')
        template=template.replace('uniform vec3 color;varying float light;', 'uniform vec3 color;uniform float alpha;varying float light;')
        template=template.replace('vec4(color*light,1.)','vec4(color*light,alpha)')
        template=template.replace("['view','rot','center','drop','color']","['view','rot','center','drop','color','alpha']")
        template=template.replace('for(const p of [a,b,c])data.push(...p,...n)', 'for(let i=0;i<3;i++)data.push(...[a,b,c][i],...(o.n?o.n[f[i]]:n))')
        template=template.replace('o.buffer=gl.createBuffer();', "if(o.lines){data=[];for(const edge of o.lines)for(const i of edge)data.push(...o.v[i],0,0,1)}o.triangleData=new Float32Array(data);o.buffer=gl.createBuffer();")
        template=template.replace("surface:'Uncut design surface'", "cage:'Shape controls (x-ray)'")
        template=template.replace("shell:'Shell',base:'Removable base',","shell:'Cut shell',")
        template=template.replace("gl.enable(gl.DEPTH_TEST);", "gl.enable(gl.DEPTH_TEST);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);")
        template=template.replace("hand.onchange=()=>", "document.getElementById('opacity').oninput=draw;hand.onchange=()=>")
        start=template.index(' for(const o of all){if(!enabled.has(o.group))continue;')
        end=template.index(" document.getElementById('status').textContent=",start)
        template=template[:start]+"""
 const visible=all.filter(o=>enabled.has(o.group)),opacity=Number(document.getElementById('opacity').value);
 function paint(o,alpha){gl.uniform1f(loc.alpha,alpha);gl.bindBuffer(gl.ARRAY_BUFFER,o.buffer);gl.enableVertexAttribArray(loc.pos);gl.enableVertexAttribArray(loc.normal);gl.vertexAttribPointer(loc.pos,3,gl.FLOAT,false,24,0);gl.vertexAttribPointer(loc.normal,3,gl.FLOAT,false,24,12);gl.uniform3fv(loc.color,[1,3,5].map(i=>parseInt(palette[o.group].slice(i,i+2),16)/255));gl.uniform1f(loc.drop,0);gl.drawArrays(o.lines?gl.LINES:gl.TRIANGLES,0,o.count);if(o.lines)gl.drawArrays(gl.POINTS,0,o.count)}
 // Opaque surfaces establish depth first. Hardware is opaque too, so a farther
 // component cannot paint over a nearer component or an opaque shell.
 gl.depthMask(true);gl.disable(gl.BLEND);
 for(const o of visible)if(!o.lines&&(o.group!=='shell'||opacity>=1))paint(o,1);
 // Sort individual shell triangles far-to-near in the same camera frame used
 // by the projection. Object-level sorting is insufficient for a curved shell.
 if(opacity<1){gl.enable(gl.BLEND);gl.depthMask(false);
  for(const o of visible.filter(o=>!o.lines&&o.group==='shell')){
   const raw=o.triangleData,order=Array.from({length:raw.length/18},(_,i)=>i);
   const depths=order.map(i=>{let z=0;for(let k=0;k<3;k++){const p=i*18+k*6;z+=sy*sp*raw[p]+cy*sp*raw[p+1]+cp*raw[p+2]}return z/3});
   order.sort((a,b)=>depths[a]-depths[b]);const sorted=new Float32Array(raw.length);
   order.forEach((i,j)=>sorted.set(raw.subarray(i*18,i*18+18),j*18));
   gl.bindBuffer(gl.ARRAY_BUFFER,o.buffer);gl.bufferData(gl.ARRAY_BUFFER,sorted,gl.DYNAMIC_DRAW);paint(o,opacity);
  }
 }
 // The explicitly selected authoring cage is an x-ray overlay, not part of
 // the material transparency pass. It intentionally remains visible inside.
 gl.disable(gl.BLEND);gl.depthMask(false);gl.disable(gl.DEPTH_TEST);
 for(const o of visible)if(o.lines)paint(o,1);
 gl.enable(gl.DEPTH_TEST);gl.depthMask(true);
"""+template[end:]
        template=template.replace("document.getElementById('status').textContent=`Shell:", "document.getElementById('status').textContent=`Exterior:")
        template=template.replace('${report.collisions.filter(c=>c.hand===hand.value).length} nominal overlap findings; see report.', '${report.control_points} shape controls + ${report.derived_wall_points} generated wall vertices. Maximum mounting height deviation: ${report.maximum_mount_error_mm.toFixed(2)} mm. ${report.collisions.filter(c=>c.hand===hand.value).length} hardware overlaps; see report. Mirrored left preview is provisional.')
        template=template.replace('}new ResizeObserver(draw).observe(c);draw();', "}document.querySelectorAll('[data-file]').forEach(a=>a.href=datasets[0].directory+a.dataset.file);new ResizeObserver(draw).observe(c);draw();")
    variants = variants or [{'id':'current','label':'Front trackball · inner FFC','directory':'','objects':objects,'report':report}]
    metadata = [{k:v for k,v in item.items() if k!='objects'} for item in variants]
    payloads = ''.join('<script type="application/json" id="mesh-'+item['id']+'">'+json.dumps(item['objects'],separators=(',',':')).replace('<','\\u003c')+'</script>' for item in variants)
    path.write_text(template.replace('__MESH_DATA__',payloads).replace('__DATASETS__',json.dumps(metadata)).replace('__PALETTE__',json.dumps(palette)))



def write_views(out, objects, palette):
    for view, yaw, pitch in [('perspective', -.55, -.9), ('underside', 0, math.pi), ('top', 0, 0), ('inner-side', math.pi/2, -1.1), ('keycaps', 0, 0), ('design-surface', -.55, -.9)]:
        cy, sy = math.cos(yaw), math.sin(yaw); cp, sp = math.cos(pitch), math.sin(pitch)
        R = np.array([[cy, -sy, 0], [sy*cp, cy*cp, -sp], [sy*sp, cy*sp, cp]])
        groups = {'shell', 'pcb', 'components', 'trackball', 'ball', 'adapter'}
        if view == 'keycaps': groups |= {'keycaps', 'switch'}
        if view == 'design-surface': groups = {'surface'}
        tris = []
        for obj in objects:
            if obj['hand'] != 'r' or obj['group'] not in groups: continue
            v = np.array(obj['v']) @ R.T
            for f in obj['f']:
                tri = v[f]; normal = np.cross(tri[1]-tri[0], tri[2]-tri[0]); norm = np.linalg.norm(normal)
                if normal[2] <= 0 or norm < 1e-9: continue
                light = .5+.5*max(0, np.dot(normal, [-.3, -.4, .85])/norm)
                color = palette[obj['group']]; rgb = [int(int(color[i:i+2], 16)*light) for i in [1, 3, 5]]
                tri = tri.copy(); tri[:, 1] *= -1
                tris.append((tri, rgb))
        cloud = np.concatenate([t[0][:, :2] for t in tris]); low = cloud.min(axis=0); high = cloud.max(axis=0)
        scale = min(1040/(high-low)[0], 760/(high-low)[1]); center = (high+low)/2
        svg = ['<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="980" viewBox="0 0 1200 980">', '<rect width="1200" height="980" fill="#101d25"/>', '<text x="45" y="52" fill="#ecf3ef" font-family="sans-serif" font-size="26">Rosebear · parametric chassis / '+view+'</text>', '<text x="45" y="83" fill="#afc2c8" font-family="sans-serif" font-size="16">Right hand · base removed · nominal component envelopes · prototype geometry</text>']
        pixels = np.full((980, 1200, 3), [16, 29, 37], dtype=np.uint8)
        depth = np.full((980, 1200), -np.inf)
        for tri, color in tris:
            p = (tri[:, :2]-center)*scale+[600, 505]
            lo = np.maximum(np.floor(p.min(axis=0)).astype(int), [0, 0]); hi = np.minimum(np.ceil(p.max(axis=0)).astype(int), [1199, 979])
            if np.any(hi < lo): continue
            xx, yy = np.meshgrid(np.arange(lo[0], hi[0]+1)+.5, np.arange(lo[1], hi[1]+1)+.5)
            a, b, c = p; denom = (b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
            if abs(denom) < 1e-9: continue
            u = ((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/denom
            v = ((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/denom
            w = 1-u-v; z = u*tri[0, 2]+v*tri[1, 2]+w*tri[2, 2]
            sub = depth[lo[1]:hi[1]+1, lo[0]:hi[0]+1]; mask = (u>=-1e-7)&(v>=-1e-7)&(w>=-1e-7)&(z>sub)
            sub[mask] = z[mask]; pixels[lo[1]:hi[1]+1, lo[0]:hi[0]+1][mask] = color
        def chunk(tag, data):
            return struct.pack('!I', len(data))+tag+data+struct.pack('!I', zlib.crc32(tag+data)&0xffffffff)
        png = b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR', struct.pack('!2I5B', 1200, 980, 8, 2, 0, 0, 0))+chunk(b'IDAT', zlib.compress(b''.join(b'\0'+row.tobytes() for row in pixels)))+chunk(b'IEND', b'')
        (out/(view+'.png')).write_bytes(png)
        svg.insert(2, '<image width="1200" height="980" href="data:image/png;base64,'+base64.b64encode(png).decode()+'"/>')
        svg += ['<text x="45" y="942" fill="#afc2c8" font-family="sans-serif" font-size="16">Rounded perimeter · internal PCB guides · underside trackball mount · inner ribbon exit toward pod</text>', '</svg>']
        (out/(view+'.svg')).write_text('\n'.join(svg))
