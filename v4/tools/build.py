#!/usr/bin/env python3
import argparse
import faulthandler
faulthandler.enable()
import json
import shutil
import subprocess
import sys
from pathlib import Path
sys.path[:0]=[str(Path(__file__).resolve().parents[1]),str(Path(__file__).resolve().parents[2]/'output_v4/tools/python39')]
from rosebear.job_guard import guard_entry
guard_entry(Path(__file__).resolve().parents[2],__file__)
import pcbnew as pcb
import wx
from rosebear import mechanical, pod_pins, seed, routing, assembly, trackball, route_cache, validate, overview, thumb_geometry, thumb_pcb, thumb_router, thumb_finish, thumb_checks, thumb_artifacts, thumb_mechanical, finger_artifacts, rigid_thumb, flat_thumb
from rosebear.pcb import load_board, finger, thumb, save, drc, metrics

ROOT=Path(__file__).resolve().parents[2]


def main():
    wx.Log.SetLogLevel(wx.LOG_Error)
    app = wx.App(False)
    parser=argparse.ArgumentParser()
    parser.add_argument('--out',type=Path,default=ROOT/'output_v4')
    parser.add_argument('--reuse-geometry',action='store_true')
    parser.add_argument('--place-only',action='store_true')
    parser.add_argument('--no-router',action='store_true')
    parser.add_argument('--router',choices=['template','freerouting'],default='template')
    parser.add_argument('--board',default='all',choices=['all','finger_l','finger_r','thumbs','pod','trackball']+['thumb_l','thumb_r'])
    parser.add_argument('--mode',choices=['seeded','fresh'],default='seeded')
    args=parser.parse_args(); out=args.out.resolve(); out.mkdir(parents=True,exist_ok=True)
    if args.board=='all':mechanical.write_json(out/'build-status.json',{'status':'build in progress or interrupted','manufacturing_release':False})
    config=json.loads((ROOT/'v4/config.json').read_text())
    if config['wire_pad_drill_mm']!=1 or config['wire_pad_diameter_mm']!=2:
        raise ValueError('The selected wire-pad footprint requires 1 mm drill / 2 mm diameter')
    chassis=json.loads((ROOT/'v4'/config['chassis']).read_text())
    if args.reuse_geometry:
        seed.verify_cache(ROOT,out,chassis,config)
        data=json.loads((out/'geometry.json').read_text()); seedpath=out/'geometry/seed'
    else: data,seedpath=seed.generate(ROOT,out,chassis,config)
    pins=pod_pins.load()
    report={};thumb_geometries={}
    candidates=out/('optimized' if args.router=='freerouting' else args.mode)
    for s in data['fingers']:
        if args.board not in ('all',s['id']): continue
        b,regions=finger(ROOT,seedpath,s,args.mode)
        path=candidates/(s['id']+'.kicad_pcb')
        save(b,path,config,ROOT)
        print('Placed '+s['id']+' '+str(metrics(b)),flush=True)
        if not args.place_only:
            b=load_board(path)
            if args.router=='freerouting' and not args.no_router:
                b=routing.route(path,ROOT,out,config)
            save(b,path,config,ROOT);checks=drc(path);b=load_board(path)
            bends=routing.check_bends(b,regions)
            report[s['id']]={**metrics(b),'drc':checks,'bend_errors':bends}
            print(s['id']+': '+str(metrics(b))+' violations='+str(len(checks['violations']))+' unconnected='+str(len(checks['unconnected']))+' bends='+str(len(bends)),flush=True)
            if not (checks['violations'] or checks['unconnected'] or bends):finger_artifacts.export(b,path,out/'fabrication'/s['id'])
    tile_config={**config,'pcb_thickness_mm':config['thumb_pcb_thickness_mm']}
    flat_spec=flat_thumb.spec(ROOT)
    chassis=flat_thumb.chassis_layout(chassis,flat_spec)
    mechanical.write_json(out/'layout-chassis.json',chassis)
    for hand in ['l','r']:
        name='thumb_'+hand
        if args.board not in ('all','thumbs',name):continue
        b,shape=flat_thumb.make(ROOT,flat_spec,hand)
        path=candidates/(name+'.kicad_pcb');save(b,path,tile_config,ROOT)
        if not args.place_only:
            checks=drc(path);report[name]={**metrics(b),'drc':checks,'bend_errors':[]}
            print(name+': '+str(report[name]),flush=True)
            if not (checks['violations'] or checks['unconnected']):
                finger_artifacts.export(b,path,out/'fabrication'/name)
                (out/'fabrication'/name/'README.md').write_text('# Flat rigid three-key thumb PCB\n\n1.6 mm FR4. W1=near/bottom row, W2=home row, W3=far/top row, W4=shared column. Four wires to the finger PCB; no inter-key wires. See ../../wiring.md and ../../mechanical/flat-thumb/README.md.\n')
                flat_thumb.export_prototype(flat_spec,shape,out/'mechanical/flat-thumb',hand)
    if args.board in ('all','pod'):
        b=load_board(str(seedpath/'pod.kicad_pcb')); path=candidates/'pod.kicad_pcb'
        active=['trackball'] if config['trackball']['enabled'] else []
        if active:
            mechanical.write_json(out/'trackball-pinout.json',trackball.extend_pod(b,ROOT,pins))
        rows=pod_pins.pin_map(pins,b,active)
        mechanical.write_json(out/'pod-pins.json',rows)
        (out/'pinout.txt').write_text(pod_pins.render_text(pins,rows)+'\n')
        mechanical.write_json(out/'firmware-pinout.json',{**pod_pins.firmware(pins,rows),**({'trackball':trackball.FIRMWARE} if active else {})})
        save(b,path,config,ROOT)
        if not args.place_only: report['pod']={**metrics(b),'drc':drc(path),'bend_errors':[]}
    if config['trackball']['enabled'] and args.board in ('all','trackball'):
        b=trackball.make(ROOT,config); path=candidates/'trackball.kicad_pcb'; save(b,path,config,ROOT)
        if not args.place_only:
            if args.router=='freerouting' and not args.no_router:
                b=routing.route(path,ROOT,out,config)
            else:
                route_cache.apply(b,config,ROOT/'v4/routes/trackball.json')
                save(b,path,config,ROOT)
            checks=drc(path); report['trackball']={**metrics(b),'drc':checks,'bend_errors':[]}
            print('trackball: '+str(metrics(b))+' violations='+str(len(checks['violations']))+' unconnected='+str(len(checks['unconnected'])),flush=True)
    mechanical.write_json(candidates/('report-'+args.board+'.json'),report)
    if any(v['drc']['violations'] or v['drc']['unconnected'] or v['bend_errors'] for v in report.values()): return 1
    if args.board=='all' and not args.place_only:
        boards={name:load_board(str(candidates/(name+'.kicad_pcb'))) for name in report}
        errors=validate.validate(boards,pins)
        mechanical.write_json(out/'electrical-contract.json',{'errors':errors})
        if errors:
            print('Electrical contract failed: '+str(errors),flush=True)
            return 1
        model=assembly.build(chassis,config,data,boards,out)
        if any(c['failures'] for c in model['checks']):
            print('Mechanical model has collisions; see assembly.json',flush=True)
            return 1
        subprocess.run([sys.executable,str(ROOT/'v4/tools/overview.py'),str(candidates)]+list(report),check=True)
        print('Overview: '+str(candidates/'all.kicad_pcb'),flush=True)
        archive=out/'superseded-thumb-tiles-flat-revision'
        for hand in ['l','r']:
            for key in ['near','home','far']:
                name='thumb_'+hand+'_'+key
                for old in candidates.glob(name+'.*'):
                    archive.mkdir(exist_ok=True)
                    shutil.move(str(old),str(archive/old.name))
                old=out/'fabrication'/name
                if old.exists():
                    dest=archive/'fabrication'/name;dest.parent.mkdir(parents=True,exist_ok=True)
                    if not dest.exists():shutil.move(str(old),str(dest))
        old=out/'fabrication/thumb_key'
        if old.exists():
            dest=archive/'fabrication/thumb_key';dest.parent.mkdir(parents=True,exist_ok=True)
            if not dest.exists():shutil.move(str(old),str(dest))
        mechanical.write_json(out/'build-status.json',{'status':'digital prototype checked','boards':list(report),'overview':str(candidates/'all.kicad_pcb'),'manufacturing_release':False,'remaining':['physical thumb fit, reach, socket support and wire strain relief trial','transverse finger coupon trial; full finger bridge replacement and installed clearance remain unqualified','new complete chassis after layout fit trial']})
    return 0

if __name__=='__main__': sys.exit(main())
