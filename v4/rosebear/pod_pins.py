"""Pod pin map: v4/pod.json is the only hand-edited source.

The module header, the cost of each concession and the hand-chosen (fixed)
assignments come from pod.json. The seed picks matrix and button pins from what
is left; the built pod board is then read back into one joined table, which
renders pod-pins.json, pinout.txt and firmware-pinout.json.
"""
import json
import re
from pathlib import Path

PATH=Path(__file__).resolve().parents[1]/'pod.json'
POWER={'GND','3V3','5V','VO4'}


def load(path=PATH):
    spec=json.loads(Path(path).read_text())
    for g,nets in groups(spec).items():
        for n,target in nets.items(): resolve(spec,target)
    return spec


def headers(spec):
    return {h:names for h,names in spec['headers'].items() if not h.startswith('_')}


def groups(spec):
    return {g:nets for g,nets in spec['fixed'].items() if not g.startswith('_')}


def concessions(spec):
    return sorted(((k,c) for k,c in spec['concessions'].items() if not k.startswith('_')),key=lambda kc:kc[1]['cost'])


def resolve(spec,target):
    """'IO32' or '3V3' by unique silkscreen name, or 'J_R:26'. Returns (header, pin, name)."""
    if ':' in target:
        h,pin=target.split(':'); pin=int(pin)
        return h,pin,headers(spec)[h][pin-1]
    hits=[(h,i,n) for h,names in headers(spec).items() for i,n in enumerate(names,1) if n==target]
    if len(hits)!=1: raise ValueError('pod.json: '+target+' matches '+str(len(hits))+' header pins; use HEADER:number')
    return hits[0]


def gpio(name):
    return int(name[2:]) if name.startswith('IO') else None


def concession(spec,name):
    return next(((k,c) for k,c in concessions(spec) if name in c['pins']),(None,{'cost':0,'note':''}))


def group_pins(spec,group):
    return {n:resolve(spec,t) for n,t in groups(spec)[group].items()}


def reserved(spec):
    """GPIO name -> (group, net) for every fixed GPIO, built or not."""
    return {p[2]:(g,n) for g in groups(spec) for n,p in group_pins(spec,g).items() if gpio(p[2]) is not None}


def stage_seed(spec,text,replace_once):
    """Rewrite the staged v3 pod.baml to take its header and costs from pod.json.

    Reserved GPIOs are renamed so the seed's is_gpio() never offers them.
    """
    rsv=reserved(spec)
    for h,fn in [('J_L','HEADER_LEFT'),('J_R','HEADER_RIGHT')]:
        names=','.join(json.dumps('RSV_'+n if n in rsv else n) for n in headers(spec)[h])
        text=replace_once(r'function '+fn+r'\(\) -> HeaderPin\[\] \{[^}]*\}',
                          'function '+fn+'() -> HeaderPin[] { header_pins(['+names+']) }',text)
    cost='\n'.join('    if (contains_str('+json.dumps(c['pins'])+', name)) { return '+str(c['cost'])+'; }' for k,c in concessions(spec))
    note='\n'.join('    if (contains_str('+json.dumps(c['pins'])+', name)) { return '+json.dumps(c['note'])+'; }' for k,c in concessions(spec))
    text=replace_once(r'(?s)function pin_cost\(name: string\) -> int \{.*?\n\}\n',
                      lambda m:'function pin_cost(name: string) -> int {\n'+cost+'\n    0\n}\n',text)
    return replace_once(r'(?s)function concession\(name: string\) -> string \{.*?\n\}\n',
                        lambda m:'function concession(name: string) -> string {\n'+note+'\n    ""\n}\n',text)


def socket_nets(board):
    return {f.GetReference():{int(p.GetNumber()):p.GetNetname() for p in f.Pads() if p.GetNumber()}
            for f in board.GetFootprints() if f.GetReference() in ('J_L','J_R')}


def check(spec,board,active):
    """Errors if the pod board disagrees with pod.json for the built groups."""
    nets=socket_nets(board); errors=[]
    for g in groups(spec):
        for n,(h,pin,name) in group_pins(spec,g).items():
            got=nets.get(h,{}).get(pin,'')
            if g in active and got!=n: errors.append('pod: '+h+' pin '+str(pin)+' ('+name+') should carry '+n+', has '+repr(got))
            if g not in active and gpio(name) is not None and got: errors.append('pod: '+name+' is reserved for '+g+' but carries '+got)
    return errors


def pin_map(spec,board,active):
    """One row per header pin: where it is, what it carries and why."""
    nets=socket_nets(board); rsv=reserved(spec)
    fixed={(p[0],p[1]):(g,n) for g in active for n,p in group_pins(spec,g).items()}
    rows=[]
    for h,names in headers(spec).items():
        for pin,name in enumerate(names,1):
            net=nets.get(h,{}).get(pin,''); k,c=concession(spec,name)
            if (h,pin) in fixed and fixed[(h,pin)][1]==net: source='fixed:'+fixed[(h,pin)][0]
            elif name in POWER: source='power'
            elif net: source='routed'
            elif name in rsv: source='reserved:'+rsv[name][0]
            else: source='unused'
            rows.append({'header':h,'pin':pin,'name':name,'gpio':gpio(name),'net':net,'source':source,
                         'concession':k,'note':c['note']})
    return rows


def render_text(spec,rows):
    lines=[spec['module']+' pod pin map. Source: v4/pod.json; generated from the built pod board.','']
    for h in headers(spec):
        mine=[r for r in rows if r['header']==h]
        used=[r for r in mine if r['net'] and (r['gpio'] is not None or r['source'].startswith('fixed'))]
        lines.append(h+' -- '+str(len(used))+' assigned')
        for r in used:
            lines.append('  pin '+str(r['pin'])+'\t'+r['name']+'\t'+r['net']+'\t'+r['source']+('  <- '+r['note'] if r['note'] else ''))
        for r in mine:
            if r['source'].startswith('reserved'): lines.append('  pin '+str(r['pin'])+'\t'+r['name']+'\t(reserved for '+r['source'][9:]+', not built)')
        spare=sorted((r for r in mine if r['source']=='unused' and r['gpio'] is not None),
                     key=lambda r:(concession(spec,r['name'])[1]['cost'],r['pin']))
        lines.append('  unused: '+', '.join(r['name']+(' ['+r['concession']+']' if r['concession'] else '') for r in spare))
        lines.append('')
    return '\n'.join(lines)


def firmware(spec,rows):
    return {'module':spec['module'],
            'gpio':{r['net']:r['gpio'] for r in rows if r['gpio'] is not None and r['net']},
            'reserved_not_built':{rsv_net(spec,r['name']):r['gpio'] for r in rows if r['source'].startswith('reserved')},
            'unused_gpio':sorted(r['gpio'] for r in rows if r['source']=='unused' and r['gpio'] is not None)}


def rsv_net(spec,name):
    return reserved(spec)[name][1]
