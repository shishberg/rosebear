#!/usr/bin/env python3
"""Exact-plane thumb unfolding study. This emits review geometry, not fabrication files."""
import argparse
import itertools
import json
import math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]

def dot(a,b): return sum(x*y for x,y in zip(a,b))
def add(a,b): return [x+y for x,y in zip(a,b)]
def sub(a,b): return [x-y for x,y in zip(a,b)]
def scale(a,s): return [s*x for x in a]
def length(a): return math.sqrt(dot(a,a))
def unit(a): return scale(a,1/length(a))
def cross(a,b): return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
def rotate(p,axis,angle):
    c,s=math.cos(angle),math.sin(angle)
    return add(add(scale(p,c),scale(cross(axis,p),s)),scale(axis,dot(axis,p)*(1-c)))
def angle(a,b): return math.acos(max(-1,min(1,dot(a,b))))
def corners(key):
    return [add(key['origin'],add(scale(key['axes'][0],x),scale(key['axes'][1],y)))
            for x,y in [(-8.9,-11.5),(8.9,-11.5),(8.9,8),(-8.9,8)]]
def intersection(a,b):
    n,m=a['axes'][2],b['axes'][2]
    projected=sub(m,scale(n,dot(m,n)))
    p=add(a['origin'],scale(projected,dot(m,sub(b['origin'],a['origin']))/dot(projected,projected)))
    return p,unit(cross(m,n)),angle(m,n)
def closest(poly,p):
    found=[]
    for a,b in zip(poly,poly[1:]+poly[:1]):
        v=sub(b,a);t=max(0,min(1,dot(sub(p,a),v)/dot(v,v)));q=add(a,scale(v,t));found.append((length(sub(q,p)),q))
    # Convex polygon: negative distance flags a point inside.
    signs=[(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]) for a,b in zip(poly,poly[1:]+poly[:1])]
    d,q=min(found)
    return (-d if all(v>=0 for v in signs) or all(v<=0 for v in signs) else d),q

def assess(chassis,config):
    keys={k['id']:json.loads(json.dumps(k)) for k in chassis['keys'] if k['column']=='thumb'}
    z=chassis['config']['plate_thickness']-config['plate_top_to_pcb_mm']
    for k in keys.values(): k['origin']=add(k['origin'],scale(k['axes'][2],z))
    home=keys['thumb_home']
    def project(p): return [dot(sub(p,home['origin']),a) for a in home['axes'][:2]]
    flat={};checks=[];hinges=[]
    for name,k in keys.items():
        if name=='thumb_home': fn=lambda p:p
        else:
            point,axis,theta=intersection(home,k)
            fn=lambda p,c=point,u=axis,t=theta:add(c,rotate(sub(p,c),u,t))
            hinges.append({'keys':['thumb_home',name],'point':project(point),
                           'direction':[dot(axis,a) for a in home['axes'][:2]],
                           'bend_deg':math.degrees(theta),
                           'full_frame_rotation_deg':math.degrees(math.acos(max(-1,min(1,(sum(dot(a,b) for a,b in zip(home['axes'],k['axes']))-1)/2))))})
        points=[fn(p) for p in corners(k)]
        flat[name]={'polygon':[project(p) for p in points],'center':project(fn(k['origin']))}
        residual=max(abs(dot(sub(p,home['origin']),home['axes'][2])) for p in points)
        checks.append({'name':name+' unfolded plane residual mm','value':residual,'passed':residual<1e-8})
        if name!='thumb_home':
            restored=[add(point,rotate(sub(p,point),axis,-theta)) for p in points]
            error=max(length(sub(p,q)) for p,q in zip(restored,corners(k)))
            checks.append({'name':name+' refold corner residual mm','value':error,'passed':error<1e-8})
    for hinge in hinges:
        p,u=hinge['point'],hinge['direction'];normal=[-u[1],u[0]]
        hinge['signed_corner_distances_mm']={name:[dot(sub(q,p),normal) for q in flat[name]['polygon']] for name in hinge['keys']}
        hinge['intersects_rigid_polygon']=[name for name,ds in hinge['signed_corner_distances_mm'].items() if min(ds)<0<max(ds)]
        # A localized bend can sit further along its axis, outside both key areas.
        # Test both sides, using a conservative disk around the proposed bend.
        hinge['outboard_candidates']=[]
        radius=2.0;width=3.6;transition=.8
        clearance=width/2+radius*math.tan(math.radians(hinge['bend_deg'])/2)+transition
        for side in [-1,1]:
            for step in range(24,101):
                x=side*step/2
                if abs(u[0])<1e-9: continue
                c=add(p,scale(u,(x-p[0])/u[0]))
                distances={n:closest(f['polygon'],c)[0] for n,f in flat.items()}
                if min(distances.values())>=clearance:
                    hinge['outboard_candidates'].append({'side':side,'center':c,'rigid_polygon_clearances_mm':distances,
                                                        'assumed_flex_radius_mm':radius,'bridge_width_mm':width,
                                                        'status':'bend location only; connecting arms and full chassis clearance not validated'})
                    break
    return {'status':'mechanical feasibility study, not a routed PCB or a qualified flex design',
            'chassis_sha256':chassis['source_sha256'],'pcb_datum_mm':z,'flat_islands':flat,'hinges':hinges,'checks':checks,
            'assumptions':{'island_bounds_local_mm':[-8.9,-11.5,8.9,8],
                           'flex_radius_mm':2,'bridge_width_mm':3.6,
                           'finite_radius_note':'Unfolding uses ideal hinges. Finite-radius bend allowance must be included in a production outline.',
                           'electrical_note':'Bridge width is a routing allowance, not a verified LED current rating.'}}

def svg(data,path):
    # Native vector drawing keeps dimensions reviewable without a CAD runtime.
    scale=7;ox=340;oy=330
    def pt(p):return f'{ox+p[0]*scale:.3f},{oy-p[1]*scale:.3f}'
    def line(a,b,style):return f'<line x1="{ox+a[0]*scale}" y1="{oy-a[1]*scale}" x2="{ox+b[0]*scale}" y2="{oy-b[1]*scale}" {style}/>'
    parts=['<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">',
           '<rect width="1000" height="1000" fill="#fafafa"/>',
           '<g font-family="sans-serif" fill="#18242e">',
           '<text x="30" y="35" font-size="22">Connected thumb cluster: exact-plane unfolding study</text>',
           '<text x="30" y="60" font-size="14">Right thumb cluster only. Diagram is an ideal-hinge study, not a PCB outline.</text>']
    for name,f in data['flat_islands'].items():
        parts.append('<polygon points="'+' '.join(pt(p) for p in f['polygon'])+'" fill="#dbece4" stroke="#315d4b" stroke-width="2"/>')
        x,y=map(float,pt(f['center']).split(','));parts.append(f'<text x="{x}" y="{y}" text-anchor="middle" font-size="15">{name}</text>')
    for h in data['hinges']:
        p,u=h['point'],h['direction'];parts.append(line(add(p,scale_vector(u,-38)),add(p,scale_vector(u,38)),'stroke="#b55e19" stroke-width="1.5" stroke-dasharray="5 5"'))
        for c in h['outboard_candidates']:
            x,y=map(float,pt(c['center']).split(','));parts.append(f'<circle cx="{x}" cy="{y}" r="13" fill="#dce9fa" stroke="#3762a0" stroke-width="2"/>')
    for i,t in enumerate(['Green: current rigid key-area envelopes','Dashed: exact relative rotation axes','Blue: candidate localized bend positions','', 'Straight bridges would crease through key areas.', 'Moving bends outboard avoids those areas.', '', 'Not checked here:', '• connecting-arm routing and swept clearance', '• complete chassis, keycaps and trackball carrier', '• finite-radius unfolding and material qualification', '• LED supply sizing and electrical routing']):
        parts.append(f'<text x="640" y="{140+25*i}" font-size="14">{t}</text>')
    parts.append('<text x="30" y="680" font-size="14">Adjacent plane changes: 4.90° and 9.51°. Thumb/finger separation is retained.</text></g></svg>')
    path.write_text('\n'.join(parts))
def scale_vector(a,s):return [x*s for x in a]

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--out',type=Path,default=ROOT/'output_v4/thumb-study');args=p.parse_args();args.out.mkdir(parents=True,exist_ok=True)
    config=json.loads((ROOT/'v4/config.json').read_text());chassis=json.loads((ROOT/'v4'/config['chassis']).read_text())
    data=assess(chassis,config);(args.out/'geometry.json').write_text(json.dumps(data,indent=2)+'\n');svg(data,args.out/'unfolded.svg')
    if not all(c['passed'] for c in data['checks']):raise RuntimeError('Unfold/refold verification failed')
    for h in data['hinges']:print(h['keys'],round(h['bend_deg'],2),'degrees; outboard candidates:',[c['center'] for c in h['outboard_candidates']])
    print(args.out)
