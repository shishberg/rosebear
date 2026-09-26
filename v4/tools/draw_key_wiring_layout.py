"""Physical harness study, pure Python; no KiCad or router processes.
Key frames are authoritative; bought-tile pads and harness mounts are proposals.
"""
import json, math
from pathlib import Path
from html import escape
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'output_v4/key-quotes'
source=json.loads((ROOT/'output_v4/layout-chassis.json').read_text())
keys={k['id']:k for k in source['keys']}
COLS=['pinky','ring','middle','index','inner']
ROWS=['top','home','bottom']
CHAIN=[f'matrix_{c}_{r}' for n,c in enumerate(COLS) for r in (ROWS if n%2==0 else ROWS[::-1])]+['thumb_near','thumb_home','thumb_far']
# Approximate terminal zones, not a purchased-board pinout. Local switch frame.
PADS={'R':(-7,-7),'C':(7,5),'DI':(-7,-3),'DO':(7,-3),'+':(-7,0),'G':(7,-7)}
colors={'rows':'#137bba','columns':'#bd7510','data':'#973bad','power':'#d33b40','ground':'#3e505e','trackball':'#008577'}
S=6

def world(k,x,y,z=0.1):
    f=keys[k]
    return [f['origin'][i]+sum(f['axes'][j][i]*[x,y,z][j] for j in range(3)) for i in range(3)]
def project(w,view):
    x,y,z=w
    # Looking up from below: mirror X, retain distal/palm orientation.
    return (-x,-y) if view=='plan' else (-x, -.82*y+.42*(z-15))
def point(k,x=0,y=0,view='plan'):return project(world(k,x,y),view)
def pad(k,p,view):return point(k,*PADS[p],view)
def xy(p):return (65+(p[0]+39)*S,150+(p[1]+49)*S)
def nums(p):return ','.join(f'{v:.2f}' for v in xy(p))
def text(x,y,t,size=16,color='#213143',weight='normal'):
    return f'<text x="{x}" y="{y}" font-family="Arial,sans-serif" font-size="{size}" fill="{color}" font-weight="{weight}">{escape(t)}</text>'
def poly(ps,fill,stroke='#9aa9b7',width=1,dash=''):
    return '<polygon points="'+' '.join(nums(p) for p in ps)+f'" fill="{fill}" stroke="{stroke}" stroke-width="{width}"'+(f' stroke-dasharray="{dash}"' if dash else '')+'/>'
def wire(ps,c,width=2.4):
    # White casing distinguishes insulated crossings from junctions.
    pts=[xy(p) for p in ps]
    d=f'M{pts[0][0]:.2f},{pts[0][1]:.2f}'
    for a,b,nextp in zip(pts,pts[1:],pts[2:]):
        u=math.dist(a,b);v=math.dist(b,nextp);r=min(7,u/3,v/3)
        if min(u,v)<.01:continue
        entry=(b[0]+(a[0]-b[0])*r/u,b[1]+(a[1]-b[1])*r/u)
        leave=(b[0]+(nextp[0]-b[0])*r/v,b[1]+(nextp[1]-b[1])*r/v)
        d+=f'L{entry[0]:.2f},{entry[1]:.2f} Q{b[0]:.2f},{b[1]:.2f} {leave[0]:.2f},{leave[1]:.2f}'
    d+=f'L{pts[-1][0]:.2f},{pts[-1][1]:.2f}'
    return f'<path d="{d}" fill="none" stroke="#fff" stroke-width="{width+2}"/><path d="{d}" fill="none" stroke="{c}" stroke-width="{width}"/>'

def shifted(p,dx=0,dy=0):return (p[0]+dx,p[1]+dy)
BX,BY=-8,66
# Exact breakout wire-hole pattern, turned 180 degrees to face FFC toward palm.
def bp(i):return (BX-(i-12.5)*1.27,BY-((7 if i%2 else 12)-11.5))

routes=[]
def add(group,points,name):routes.append((group,points,name))
def make(view):
    routes.clear()
    for ci,c in enumerate(COLS):
        ks=[f'matrix_{c}_{r}' for r in ROWS]
        for a,b in zip(ks,ks[1:]):
            pa,pb=pad(a,'C',view),pad(b,'C',view)
            add('columns',[pa,shifted(pa,-3),shifted(pb,-3),pb],f'C{ci}: {a} to {b}')
        p=pad(ks[-1],'C',view);q=bp(7+ci)
        add('columns',[p,shifted(p,-3,5),(q[0],43+ci*1.5),q],f'C{ci} feed, ribbon {7+ci}')
    for ri,r in enumerate(ROWS):
        ks=[f'matrix_{c}_{r}' for c in COLS]
        for a,b in zip(ks,ks[1:]):
            pa,pb=pad(a,'R',view),pad(b,'R',view)
            add('rows',[pa,shifted(pa,0,3),shifted(pb,0,3),pb],f'{r} row: {a} to {b}')
        # Feed at pinky; run around its outside so it does not span socket bodies.
        pa=pad(ks[0],'R',view);q=bp(4+ri);lane=-35-ri*1.4
        add('rows',[pa,shifted(pa,0,3),(lane,pa[1]+3),(lane,45+ri*2),(q[0],49+ri*2),q],f'{r} feed, ribbon {4+ri}')
        thumb=['thumb_far','thumb_home','thumb_near'][ri]
        pa,pb=pad(ks[-1],'R',view),pad(thumb,'R',view)
        # Parallel corridor between inner finger and thumbs, then individual tails.
        add('rows',[pa,shifted(pa,0,3),(76+ri*1.5,pa[1]+3),(76+ri*1.5,25+ri*2),(pb[0]+3,pb[1]+4),pb],f'{r} to {thumb}')
    ts=['thumb_near','thumb_home','thumb_far']
    for a,b in zip(ts,ts[1:]):
        pa,pb=pad(a,'C',view),pad(b,'C',view)
        add('columns',[pa,shifted(pa,-3,2),shifted(pb,-3,2),pb],'C5 thumb column')
    pa=pad(ts[0],'C',view);q=bp(12)
    add('columns',[q,(q[0],46),(25,46),(pa[0]-4,pa[1]+4),pa],'C5 feed, ribbon 12')
    for group,terminal,pin,off in [('data','DI',2,0),('power','+',22,1.3),('ground','G',24,2.6)]:
        for a,b in zip(CHAIN,CHAIN[1:]):
            pa=pad(a,'DO' if group=='data' else terminal,view);pb=pad(b,terminal,view)
            # Follow the outside edge of each tile; diagonal inter-column hops occur in row gaps.
            ca,cb=point(a,view=view),point(b,view=view)
            if a.split('_')[1]==b.split('_')[1] and a.startswith('matrix'):
                lane=min(ca[0],cb[0])-11-off
                ps=[pa,(lane,pa[1]),(lane,pb[1]),pb]
            else:
                lane=max(pa[1],pb[1])+4+off
                ps=[pa,(pa[0],lane),(pb[0],lane),pb]
            add(group,ps,f'{group}: {a} to {b}')
        p=pad(CHAIN[0],terminal,view);q=bp(pin);lane=-41-off
        add(group,[q,(q[0],54+off),(lane,54+off),(lane,p[1]),p],f'{group} input ribbon {pin}')
    # Bought breakout's connector location is unspecified: bundle terminates at an edge zone.
    for j,pin in enumerate([14,15,16,17,18,19,20]):
        q=bp(pin)
        add('trackball',[q,(q[0],q[1]-2),(BX+20+j*.9,q[1]-2),(BX+20+j*.9,74+j*.9),(103+j*.9,74+j*.9),(103+j*.9,30),(94+j*.9,30)],f'Trackball ribbon {pin}')
    svg=['<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1230" viewBox="0 0 1400 1230">','<rect width="1400" height="1230" fill="#f7f9fc"/>',text(35,42,'RIGHT HALF — PHYSICAL HANDWIRING STUDY',27,weight='bold'),text(35,72,'Underside • actual key frames • '+('plan projection' if view=='plan' else 'tilted key-depth study; accessory envelopes held fixed')+' • dimensions in mm'),text(35,98,'Candidate harness paths; 19 mm purchased tiles and terminal zones are approximate. No chassis-fit claim.',15)]
    for i,(g,c) in enumerate(colors.items()):
        x=35+i*170
        svg.append(f'<path d="M{x},122 h25" stroke="{c}" stroke-width="4"/>'+text(x+32,127,g.title(),14))
    svg.append(text(60,158,'FINGERTIPS ↑',14))
    for k in CHAIN:
        corners=[point(k,x,y,view) for x,y in [(-9.5,-9.5),(9.5,-9.5),(9.5,9.5),(-9.5,9.5)]]
        svg.append(poly(corners,'#e2eee8','#6f9984',1.5))
        # Socket and LED envelopes only: use geometry, never obstruct stem with wires deliberately.
        svg.append(poly([point(k,x,y,view) for x,y in [(-8,2),(8,2),(8,8),(-8,8)]],'#65717b','#65717b'))
        svg.append(poly([point(k,x,y,view) for x,y in [(-2,-6),(2,-6),(2,-3),(-2,-3)]],'#fff4b0','#ac9b50'))
        p=xy(point(k,view=view));svg.append(f'<circle cx="{p[0]}" cy="{p[1]}" r="10" fill="#f7f9fc" stroke="#6f9984"/>')
        label=str(CHAIN.index(k)+1)
        svg.append(text(p[0]-6,p[1]+5,label,13,weight='bold'))
    # Proposed, same-scale breakout and trackball envelopes.
    svg.append(poly([(BX-18,BY-15.5),(BX+18,BY-15.5),(BX+18,BY+15.5),(BX-18,BY+15.5)],'#e5eaf4','#637ea4',2,'7 4'))
    svg.append(poly([(BX-14,BY+9),(BX+14,BY+9),(BX+14,BY+13),(BX-14,BY+13)],'#65717b'))
    svg.append(poly([(BX-12,BY+13),(BX+12,BY+13),(BX+12,BY+25),(BX-12,BY+25)],'#dfdce9','#9b8eae'))
    for i in range(1,25):
        p=xy(bp(i));svg.append(f'<circle cx="{p[0]}" cy="{p[1]}" r="3.5" fill="#d1a746"/>')
    p=xy((BX,BY-9.5));svg.append(f'<circle cx="{p[0]}" cy="{p[1]}" r="24" fill="#7a8495" stroke="#45506a"/>')
    svg.append(poly([(83,0),(105,0),(105,28),(83,28)],'#e1f0ed','#008577',2,'7 4'))
    p=xy((94,13));svg.append(f'<circle cx="{p[0]}" cy="{p[1]}" r="24" fill="#aac4bf"/>')
    for group,col in colors.items():
        svg.append(f'<g data-layer="{group}">')
        for g,ps,name in routes:
            if g==group:svg.append('<g><title>'+escape(name)+'</title>'+wire(ps,col,2.2 if g not in ['power','ground'] else 3)+'</g>')
        svg.append('</g>')
    for k in CHAIN:
        for n,(x,y) in PADS.items():
            p=xy(point(k,x,y,view));svg.append(f'<circle cx="{p[0]}" cy="{p[1]}" r="3" fill="#bf9340" stroke="#fff" stroke-width=".7"/>')
    svg.append(text(*xy((BX-17,BY+30)),'24-way ribbon → central pod',15))
    svg.append(text(*xy((78,-4)),'22 × 28 trackball',14))
    svg.append(text(400,992,'36 × 33 breakout (proposed)',14))
    svg.append('<path d="M400,1008 H520 M400,1003 V1013 M520,1003 V1013" stroke="#213143"/>')
    svg.append(text(429,1034,'20 mm',14))
    # Labels below tiles avoid covering socket and wires.
    for i,c in enumerate(COLS):
        p=point(f'matrix_{c}_top',view=view)
        svg.append(text(*xy((p[0]-6,p[1]-13)),f'C{i} {c}',13))
    def note(n,p,y,title,lines):
        x,z=xy(p)
        svg.append(f'<circle cx="{x}" cy="{z}" r="14" fill="#fff" stroke="#c66a25" stroke-width="2"/>'+text(x-5,z+5,str(n),15,weight='bold'))
        svg.append(text(1025,y,f'{n}  {title}',19,weight='bold'))
        for j,line in enumerate(lines):svg.append(text(1025,y+27+j*23,line,15))
    note(1,(-8,49),205,'Breakout fan-out',['12 key-harness leads, plus','7 trackball leads on right.','Solder with the board out;','clamp the loom before FFC.'])
    note(2,(55,31),365,'Thumb transition',['7 conductors enter thumbs:','3 rows, C5, data, 5V, GND.','Keep a loose service loop;','support it at both ends.'])
    note(3,(3,22),525,'Between columns',['Rows cross the column,','RGB and power runs here.','Insulated wires cross;','crossings are not splices.'])
    note(4,(88,42),685,'Trackball corridor',['7 wires around thumb edge.','Keep clear of key travel','and thumb screw access.','Mount position is provisional.'])
    svg += [text(40,1085,'BUILD ORDER   1 Fit/support tiles   2 Columns   3 Rows   4 LED data   5 Power pair   6 Breakout + trackball',18,weight='bold'),text(40,1120,'Wire paths show traffic, not cut lengths. Allow slack for height changes; do not pull the boards together with wires.',16),text(40,1147,'Socket = dark body; LED = cream body; gold dots = approximate terminal zones. Numbers 1–18 follow the RGB chain.',16),text(40,1174,'Left half: mirror the key positions and omit trackball wiring. Same bought PCBs require rechecking pad orientation after placement.',16),text(40,1201,'Wire strokes are exaggerated for readability. Reserve a supported wiring space below sockets; its depth still needs a physical fit check.',16),'</svg>']
    return ''.join(svg)

for view in ['plan','tilted']:
    (OUT/f'handwiring-layout-{view}.svg').write_text(make(view))
# Standalone project artifact with layer selection; no network dependencies.
html='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Rosebear physical wiring layout</title><style>body{font:16px system-ui;margin:20px;color:#213143;background:#f7f9fc}header{display:flex;flex-wrap:wrap;gap:18px;align-items:center}label{white-space:nowrap}svg{width:100%;height:auto}button,select{font:inherit;padding:7px}#drawing{overflow:auto}#drawing svg{min-width:950px}p{max-width:1000px}</style><header><strong>Physical wiring layout</strong><label>View <select id="view"><option value="plan">Underside</option><option value="tilted">Tilted underside</option></select></label>'''
for g in colors:html+=f'<label><input type="checkbox" data-group="{g}" checked> {g.title()}</label>'
html+='''<button id="matrix">Matrix only</button><button id="lighting">Lighting only</button><button id="all">All wires</button></header><p>Current key geometry; proposed harness and accessory locations. Toggle layers to trace the congested areas. Scroll horizontally on a small screen. This is a planning layout, not a verified pad-by-pad assembly guide.</p><div id="drawing">'''
for v in ['plan','tilted']:html+=f'<div data-view="{v}"'+(' hidden' if v!='plan' else '')+'>'+(OUT/f'handwiring-layout-{v}.svg').read_text()+'</div>'
html+='''</div><script>
const root=document.getElementById('drawing');
const checks=[...document.querySelectorAll('[data-group]')];
function update(){checks.forEach(c=>root.querySelectorAll('[data-layer="'+c.dataset.group+'"]').forEach(g=>g.style.display=c.checked?'':'none'));}
checks.forEach(c=>c.addEventListener('change',update));
document.getElementById('view').addEventListener('change',e=>root.querySelectorAll('[data-view]').forEach(v=>v.hidden=v.dataset.view!==e.target.value));
for(const [id,groups] of Object.entries({matrix:['rows','columns'],lighting:['data','power','ground'],all:checks.map(c=>c.dataset.group)}))document.getElementById(id).addEventListener('click',()=>{checks.forEach(c=>c.checked=groups.includes(c.dataset.group));update();});
</script></html>'''
(OUT/'handwiring-layout.html').write_text(html)
# Count circuit segments, rather than each bend of a wire.
make('plan')
counts={g:sum(r[0]==g for r in routes) for g in colors}
assert counts=={'rows':18,'columns':18,'data':18,'power':18,'ground':18,'trackball':7},counts
print('Wrote physical layout views and HTML;',counts)
