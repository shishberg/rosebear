"""Independent right-thumb trackball module; seven wires directly to the pod.

Sensor centres follow SparkFun's open reference, not the old branch's rounded
placement. DRV5033 DBZ pin numbers come from TI SLIS152G, page 4. This is NOT
pin-compatible with the A1104 assumed in the older branch.
"""
import json
import xml.etree.ElementTree as ET
import pcbnew as pcb
from .pcb import footprint,wirepad,outline,label,net,pad_of,xy,track,vec
from . import pod_pins

SIGNALS=['TB_UP','TB_DOWN','TB_LEFT','TB_RIGHT','TB_BTN']
WIRES=['TB_3V3','GND']+SIGNALS
FIRMWARE={'supply_v':3.3,'active_low':True,'motion':'four independent direction pulse inputs, not quadrature',
          'click':'debounced active-low switch','rotation':'calibrate direction mapping after mounting'}


def harness(spec):
    """Wire order W1..W7 with each wire's pod header pin and GPIO, from pod.json."""
    pins=pod_pins.group_pins(spec,'trackball')
    return [{'net':n,'pod_pad':'WT'+str(i)+'/1','trackball_pad':'W'+str(i)+'/1','header':pins[n][0],
             'module_header_pin':pins[n][1],'gpio':pod_pins.gpio(pins[n][2])} for i,n in enumerate(WIRES,1)]


def sensor_positions(root):
    tree=ET.parse(root/'v4/reference/trackball.brd')
    elements={e.get('name'):e for e in tree.findall('.//elements/element')}
    origin=elements['U$3']; ox,oy=float(origin.get('x')),float(origin.get('y'))
    result=[]
    for i in range(1,5):
        e=elements['U'+str(i)]
        result.append((float(e.get('x'))-ox,-(float(e.get('y'))-oy)))
    return result


def make(root,config):
    b=pcb.BOARD()
    footprint(b,root,'rosebear_v4:Trackball_BB','TB1',(0,0),{})
    click=footprint(b,root,'rosebear_v4:Trackball_Click_SparkFun','SW1',(0,0),{'1':'TB_BTN','2':'GND'},angle=125)
    click.SetValue('SparkFun COM-00097')
    # Per-sensor decoupling; explicit output pullups to 3.3 V.
    for i,((x,y),name) in enumerate(zip(sensor_positions(root),SIGNALS),1):
        # DSN/SES stores placements on a 0.1 micron grid. Snap before routing.
        x,y=round(x-1e-9,4),round(y-1e-9,4)
        sensor=footprint(b,root,'Package_TO_SOT_SMD:SOT-23','U'+str(i),(x,y),{'1':'TB_3V3','2':name,'3':'GND'})
        sensor.SetValue(config['trackball']['sensor'])
        cx=7.5 if x>0 else -7.5
        cy=2.0 if y>0 else -2.0
        c=footprint(b,root,'Capacitor_SMD:C_0603_1608Metric','C'+str(i),(cx,cy),{'1':'TB_3V3','2':'GND'},angle=90,back=True)
        c.SetValue('100nF')
    pad_positions=[(-8,-9),(-8,9),(8,6),(-8,-5.5),(8,-6),(-8,5.5),(0,9)]
    for i,(name,pos) in enumerate(zip(WIRES,pad_positions),1):
        wirepad(b,root,'W'+str(i),name,pos)
        if name in SIGNALS:
            # Resistors on the back leave the ball and sensors unobstructed.
            rx,ry={'TB_UP':(3.8,7.5),'TB_DOWN':(-3.8,-7.5),'TB_LEFT':(3.8,-7.5),'TB_RIGHT':(-3.8,7.5),'TB_BTN':(0,6)}[name]
            r=footprint(b,root,'Resistor_SMD:R_0603_1608Metric','R'+str(i-2),(rx,ry),{'1':name,'2':'TB_3V3'},back=True)
            r.SetValue('10k')
    outline(b,[(-10,-11),(10,-11),(10,11),(-10,11)])
    label(b,'TRACKBALL',(0,-8.7))
    return b


def extend_pod(board,root,spec):
    wires=harness(spec)
    for i,w in enumerate(wires,1):
        socket=next(f for f in board.GetFootprints() if f.GetReference()==w['header'])
        name=w['net']; p=pad_of(socket,w['module_header_pin'])
        if p.GetNetname() not in ('',name): raise ValueError('Trackball GPIO already assigned: '+p.GetNetname())
        p.SetNet(net(board,name)); x,y=xy(p.GetPosition())
        end=x-5-(i%2)*3.5
        wirepad(board,root,'WT'+str(i),name,(end,y))
        track(board,[(x,y),(end,y)],'F.Cu',name,0.25)
    return wires
