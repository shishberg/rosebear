"""Review drawings and fabrication-reference layers for connected thumb FPCs."""
import json,csv,subprocess
import numpy as np
import pcbnew as pcb
from shapely.geometry import Point
from .pcb import CLI,xy
from .thumb_checks import holes
from .thumb_geometry import folded


def gerber_regions(polygons,path):
    lines=['G04 Front FR4 stiffener; finished 0.40 mm nominal including agreed adhesive*','%FSLAX46Y46*%','%MOMM*%','%LPD*%','G01*']
    def ring(coords):
        lines.append('G36*')
        for i,(x,y) in enumerate(coords):lines.append('X%dY%dD%02d*'%(round(x*1e6),round(y*1e6),2 if i==0 else 1))
        lines.append('G37*')
    for poly in polygons:
        lines.append('%LPD*%');ring(poly.exterior.coords)
        if poly.interiors:
            lines.append('%LPC*%')
            for hole in poly.interiors:ring(hole.coords)
    lines.append('M02*');path.write_text('\n'.join(lines)+'\n')


def export(board,g,path,out):
    out.mkdir(parents=True,exist_ok=True);cutouts=holes(board)
    stiff=[p.difference(cutouts) for p in g['islands'].values()]
    gerber_regions(stiff,out/'F_Stiffener.gbr')
    # Square review canvas avoids aspect-ratio cropping in macOS previews.
    bounds=g['outline'].bounds;cx=(bounds[0]+bounds[2])/2;cy=(bounds[1]+bounds[3])/2;span=max(bounds[2]-bounds[0],bounds[3]-bounds[1])+18
    def points(poly):return ' '.join(f'{x:.4f},{-y:.4f}' for x,y in poly.exterior.coords)
    svg=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{cx-span/2} {-cy-span/2} {span} {span}" width="1200" height="1200">','<rect x="-200" y="-200" width="400" height="400" fill="#f5f5f2"/>']
    svg.append(f'<polygon points="{points(g["outline"])}" fill="#dfa638" stroke="#413b29" stroke-width=".15"/>')
    for name,poly in g['islands'].items():svg.append(f'<polygon points="{points(poly)}" fill="#80af99" stroke="#245644" stroke-width=".1"/>')
    for p in ([cutouts] if cutouts.geom_type=='Polygon' else cutouts.geoms):svg.append(f'<polygon points="{points(p)}" fill="#f5f5f2"/>')
    for t in board.GetTracks():
        if isinstance(t,pcb.PCB_VIA):
            x,y=xy(t.GetPosition());svg.append(f'<circle cx="{x}" cy="{y}" r=".3" fill="#333"/><circle cx="{x}" cy="{y}" r=".15" fill="#eee"/>')
        else:
            a=xy(t.GetStart());b=xy(t.GetEnd());color='#b83039' if t.GetLayer()==pcb.F_Cu else '#235eae'
            svg.append(f'<path d="M {a[0]},{a[1]} L {b[0]},{b[1]}" fill="none" stroke="{color}" stroke-width="{t.GetWidth()/1e6}"/>')
    for name,p in g['poses'].items():
        x,y=p['center'];svg.append(f'<text x="{x}" y="{-y+2}" text-anchor="middle" font-family="sans-serif" font-size="1.5" fill="#163429">{name.upper()}</text>')
    svg.append(f'<text x="{cx}" y="{-cy-span/2+3}" text-anchor="middle" font-family="sans-serif" font-size="2">THUMB {g["hand"].upper()} · ONE CONNECTED FPC · 4 MATRIX WIRES</text>')
    svg.append('</svg>');(out/'layout.svg').write_text('\n'.join(svg))
    with (out/'bom.csv').open('w',newline='') as f:
        w=csv.writer(f);w.writerow(['Reference','Value','Footprint','Side'])
        for fp in sorted(board.GetFootprints(),key=lambda f:f.GetReference()):w.writerow([fp.GetReference(),fp.GetValue(),fp.GetFPIDAsString(),'back' if fp.IsFlipped() else 'front'])
    for command in [['pcb','export','gerbers','--layers','F.Cu,B.Cu,F.Mask,B.Mask,F.Silkscreen,B.Silkscreen,Edge.Cuts','-o',str(out/'gerbers')+'/',str(path)],['pcb','export','drill','-o',str(out/'gerbers')+'/',str(path)]]:
        p=subprocess.run([str(CLI)]+command,capture_output=True,text=True)
        if p.returncode:raise RuntimeError(p.stderr+p.stdout)
    (out/'README.md').write_text('# Fabrication review package\n\nNative copper, mask and drill exports plus a separate filled front stiffener reference. This is a prototype review package, not a released manufacturing order. Confirm coverlay openings/trace clearance, stiffener adhesive and finished seating thickness with the fabricator. F_Stiffener.gbr uses the same coordinates as the board and includes switch and harness apertures.\n')


def folded_drawing(glb,path):
    """Orthographic review of generated CAD meshes, without a renderer dependency."""
    import trimesh,math
    scene=trimesh.load(glb,force='scene');items=[]
    # Camera looks down toward the thumb area; depth-sort the visible faces.
    view=np.array([[.866,-.5,0],[.25,.433,.866],[-.433,-.75,.5]])
    for name,mesh in scene.geometry.items():
        if 'existing_chassis' in name:continue
        vv=np.asarray(mesh.vertices)@view.T;tri=vv[mesh.faces]
        normals=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]);keep=normals[:,2]>0
        colors=mesh.visual.face_colors
        for idx in np.where(keep)[0]:items.append((float(tri[idx,:,2].mean()),tri[idx,:,:2],colors[idx]))
    coords=np.concatenate([p for _,p,_ in items]);lo=coords.min(axis=0);hi=coords.max(axis=0);center=(lo+hi)/2;span=max(hi-lo)+12
    lines=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{center[0]-span/2} {-center[1]-span/2} {span} {span}" width="1200" height="1200">',f'<rect x="{center[0]-span/2}" y="{-center[1]-span/2}" width="{span}" height="{span}" fill="#f7f7f4"/>']
    for depth,points,color in sorted(items,key=lambda item:item[0]):
        pts=' '.join(f'{x:.4f},{-y:.4f}' for x,y in points);rgb=','.join(str(int(x)) for x in color[:3])
        lines.append(f'<polygon points="{pts}" fill="rgb({rgb})" fill-opacity="{max(.35,color[3]/255)}" stroke="rgb({rgb})" stroke-width=".01" stroke-opacity="{max(.35,color[3]/255)}"/>')
    lines.append(f'<text x="{center[0]}" y="{-center[1]-span/2+3}" text-anchor="middle" font-family="sans-serif" font-size="1.6">FOLDED THUMB · mechanical clearance model</text>')
    lines.append('</svg>');path.write_text('\n'.join(lines))
