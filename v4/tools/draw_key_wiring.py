"""Standalone wiring sketch: logical connectivity, not a chassis fit drawing."""
from pathlib import Path
from html import escape
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'output_v4/key-quotes';OUT.mkdir(parents=True,exist_ok=True)
svg=['<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="1420" viewBox="0 0 1440 1420">',
     '<rect width="1440" height="1420" fill="#f5f7fb"/>',
     '<style>text{font-family:Arial,sans-serif;fill:#17243b} .title{font-size:27px;font-weight:bold}.sub{font-size:17px}.small{font-size:14px}.label{font-size:16px;font-weight:bold}</style>',
     '<defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7" fill="#9c38a5"/></marker></defs>']
def text(x,y,s,cl='sub',color=None):
    size={'title':27,'sub':17,'small':14,'label':16}[cl]
    weight='bold' if cl in ['title','label'] else 'normal'
    svg.append(f'<text x="{x}" y="{y}" font-family="Arial,sans-serif" font-size="{size}" font-weight="{weight}" fill="{color or "#17243b"}">'+escape(s)+'</text>')
def line(points,color,width=3,arrow=False,dash=False):
    svg.append('<polyline points="'+' '.join(f'{x},{y}' for x,y in points)+f'" fill="none" stroke="{color}" stroke-width="{width}" stroke-linejoin="round"'+(' marker-end="url(#arrow)"' if arrow else '')+(' stroke-dasharray="7 5"' if dash else '')+'/>')
def box(x,y,w,h,fill='#fff',stroke='#bec9d9'):
    svg.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="9" fill="{fill}" stroke="{stroke}"/>')
def dot(x,y,color):svg.append(f'<circle cx="{x}" cy="{y}" r="4" fill="{color}"/>')
text(35,43,'ROSEBEAR — INDIVIDUAL KEY PCB WIRING','title')
text(35,72,'One 18-key half shown. Repeat for the other half; only the right breakout uses the trackball connections.')
box(25,93,1390,440)
text(45,126,'1  SWITCH MATRIX: three row buses + six column buses','title')
text(45,152,'Physical thumb positions can be angled freely. They form a sixth electrical column, not a fourth row.')
xs=[180,360,540,720,900,1140];ys=[240,350,460]
cols=['C0 pinky','C1 ring','C2 middle','C3 index','C4 inner','C5 thumbs']
rows=['RT / top','RH / home','RB / bottom'];colors=['#008980','#d17812','#286ac4']
for i,x in enumerate(xs):
    text(x-55,188,cols[i],'label')
    line([(x+62,205),(x+62,478)],'#748093',3)
for j,y in enumerate(ys):
    text(45,y+5,rows[j],'label',colors[j])
    line([(140,y+43),(1260,y+43)],colors[j],3)
    for i,x in enumerate(xs):
        box(x-46,y-30,85,61)
        text(x-31,y-7,(['far','home','near'][j]) if i==5 else f'K{i*3+j+1}','label')
        text(x-35,y+15,'R     C','small')
        line([(x-28,y+16),(x-28,y+43)],colors[j],2)
        dot(x-28,y+43,colors[j]);line([(x+10,y+15),(x+62,y+15)],'#748093',2);dot(x+62,y+15,'#748093')
text(45,523,'Custom PCB: COL2ROW. AliExpress R2C likely means ROW2COL; verify the diode direction before configuring firmware.','small')
box(25,550,1390,305)
text(45,587,'2  RGB DATA: one continuous DI → DO chain','title')
text(45,614,'The data wire snakes through all 15 finger keys, then the three thumbs. It does not branch.')
rx=[180,355,530,705,880];ry=[664,731,798];chain=[]
for i,x in enumerate(rx):
    order=range(3) if i%2==0 else range(2,-1,-1)
    for j in order:chain.append((x,ry[j],f'{cols[i].split()[0]}-{j+1}'))
chain += [(1070,798,'near'),(1190,731,'home'),(1310,664,'far')]
line([(70,664),(135,664)],'#9c38a5',3,True);text(44,645,'RGB feed','small')
for k,(x,y,label) in enumerate(chain):
    box(x-44,y-19,88,38,'#fbf0fd');text(x-39,y+5,str(k+1)+' '+label,'small')
    if k+1<len(chain):
        xx,yy,_=chain[k+1]
        if xx==x:line([(x,y+(19 if yy>y else -19)),(xx,yy+(-23 if yy>y else 23))],'#9c38a5',3,True)
        else:line([(x+44,y),(xx-48,yy)],'#9c38a5',3,True)
text(1120,825,'Last DO: leave unconnected','small')
box(25,875,1390,245)
text(45,912,'3  POWER: +5V and GND to every key, in parallel','title')
text(45,939,'Wire +5V to +5V and GND to GND throughout. Use paired power pads where available.')
for y,color,name in [(990,'#ce4141','+5V'),(1042,'#26384f','GND')]:
    line([(140,y),(1260,y)],color,4);text(50,y+5,name,'label',color)
for x in [210,410,610,810,1010,1210]:
    box(x-48,1000,96,32);text(x-30,1021,'key PCB','small')
    line([(x-18,990),(x-18,1000)],'#ce4141',3);dot(x-18,990,'#ce4141')
    line([(x+18,1032),(x+18,1042)],'#26384f',3);dot(x+18,1042,'#26384f')
text(45,1090,'About 300 mA RGB total (USB). Custom tiles have local capacitors; test purchased boards before adding any.','small')
box(25,1140,1390,250)
text(45,1178,'4  TWO RIBBONS TO THE POD','title')
box(85,1220,235,74);text(105,1250,'LEFT BREAKOUT','label');text(105,1276,'18 keys: matrix + RGB','small')
box(550,1210,325,100);text(572,1237,'POD + ESP32-P4 MODULE','label');text(572,1262,'3.3V → 5V RGB buffers','small');text(572,1286,'Separate regulated 5V LED input','small')
box(1095,1220,235,74);text(1115,1250,'RIGHT BREAKOUT','label');text(1115,1276,'18 keys + trackball','small')
line([(320,1256),(550,1256)],'#506cc0',10);line([(875,1256),(1095,1256)],'#506cc0',10)
text(358,1234,'24-way FFC','small');text(918,1234,'24-way FFC','small')
text(45,1350,'Practical workload: about 90 wire segments / 180 soldered wire ends per half, plus seven trackball wires on the right.','small')
text(45,1375,'Short service loops at keys; strain relief at both ribbon breakouts. This drawing shows connectivity, not chassis geometry.','small')
svg.append('</svg>')
(OUT/'handwiring.svg').write_text('\n'.join(svg))
print(OUT/'handwiring.svg')
