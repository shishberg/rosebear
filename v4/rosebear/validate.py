"""Cross-board electrical contract, independent of track connectivity DRC."""
from .pcb import pad_of


def validate(boards):
    errors=[]
    for name,board in boards.items():
        refs={f.GetReference() for f in board.GetFootprints()}
        if name.startswith('finger_'):
            expected={'J1'}|{'W'+str(i) for i in range(1,5)}|{p+str(i) for p in ['SW','D'] for i in range(1,16)}
            if refs!=expected:errors.append(name+': unexpected matrix-only component set')
        if name=='pod' and any(r.startswith(('UL','CL','RL','WL','WP')) for r in refs):errors.append('pod: lighting support component remains')
        for f in board.GetFootprints():
            if f.GetReference().startswith(('LED','WLED')) or 'SK6812' in f.GetValue():errors.append(name+': lighting component remains')
        if any(t.GetNetname().startswith('LED_') for t in board.GetTracks()):errors.append(name+': lighting copper remains')
        if any(p.GetNetname().startswith('LED_') for f in board.GetFootprints() for p in f.Pads()):errors.append(name+': lighting net remains')

    def pads(name,ref):
        f=next((f for f in boards[name].GetFootprints() if f.GetReference()==ref),None)
        if f is None: errors.append(name+': missing '+ref); return {}
        return {p.GetNumber():p.GetNetname() for p in f.Pads() if p.GetNumber()}
    for h in ['l','r']:
        if 'finger_'+h not in boards: continue
        finger='finger_'+h; prefix=h.upper()
        refs={f.GetReference() for f in boards[finger].GetFootprints()}
        if 'J2' in refs: errors.append(finger+': obsolete thumb ribbon connector')
        for i,net in enumerate(['COL_'+prefix+'_THUMB']+['ROW_'+prefix+'_'+r for r in ['TOP','HOME','BOTTOM']],1):
            if pads(finger,'W'+str(i)).get('1')!=net: errors.append(finger+': incorrect wire assignment W'+str(i))
        for which,row in [('near','BOTTOM'),('home','HOME'),('far','TOP')]:
            name='thumb_'+h+'_'+which
            if name not in boards: continue
            sw=pads(name,'SW1'); d=pads(name,'D1')
            if sw.get('1')!='COL_'+prefix+'_THUMB': errors.append(name+': switch column')
            if d.get('1')!='ROW_'+prefix+'_'+row: errors.append(name+': diode cathode row')
            if not sw.get('2') or sw.get('2')!=d.get('2'): errors.append(name+': switch/diode series junction')
    for h in ['l','r']:
        name='thumb_'+h
        if name not in boards:continue
        expected={p+str(i) for p in ['SW','D'] for i in range(1,4)}|{'W'+str(i) for i in range(1,5)}
        if {f.GetReference() for f in boards[name].GetFootprints()}!=expected:errors.append(name+': unexpected flat cluster components')
        col='COL_'+h.upper()+'_THUMB'
        for i,row in enumerate(['BOTTOM','HOME','TOP'],1):
            row='ROW_'+h.upper()+'_'+row
            sw=pads(name,'SW'+str(i));d=pads(name,'D'+str(i))
            if sw.get('1')!=col or d.get('1')!=row or sw.get('2')!=d.get('2'):errors.append(name+': switch/diode contract '+str(i))
            if pads(name,'W'+str(i)).get('1')!=row:errors.append(name+': row wire '+str(i))
        if pads(name,'W4').get('1')!=col:errors.append(name+': column wire')
    if 'pod' in boards:
        if pads('pod','J_R').get('22') or pads('pod','J_R').get('23'):errors.append('pod: former lighting GPIOs must be unused')
    if 'pod' in boards and 'trackball' in boards:
        # These are physical module header pins, not GPIO numbers.
        contract=[('TB_3V3',25),('GND',26),('TB_UP',17),('TB_DOWN',18),('TB_LEFT',19),('TB_RIGHT',20),('TB_BTN',21)]
        header=pads('pod','J_R')
        for i,(net,pin) in enumerate(contract,1):
            if header.get(str(pin))!=net or pads('pod','WT'+str(i)).get('1')!=net or pads('trackball','W'+str(i)).get('1')!=net:
                errors.append('trackball harness mismatch '+net)
        for i,direction in enumerate(['UP','DOWN','LEFT','RIGHT'],1):
            if pads('trackball','U'+str(i))!={'1':'TB_3V3','2':'TB_'+direction,'3':'GND'}:
                errors.append('DRV5033 pinout mismatch U'+str(i))
    return errors
