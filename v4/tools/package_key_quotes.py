"""Package only reviewed quote artifacts, excluding router scratch files."""
import csv,hashlib,json,shutil,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'output_v4/key-quotes'
manifest=json.loads((OUT/'manifest.json').read_text())
assert len(manifest)==6
assert (OUT/'electrical-audit.json').exists()
shutil.copyfile(ROOT/'v4/docs/key-pcb-quote-options.md',OUT/'README.md')
lib=OUT/'footprints/rosebear_v4.pretty';lib.mkdir(parents=True,exist_ok=True)
for name in ['Wire_D2_Drill1','Key_Socket_MX']:
    shutil.copyfile(ROOT/'v4/footprints/rosebear_v4.pretty'/(name+'.kicad_mod'),lib/(name+'.kicad_mod'))
counts={'key_single':(50,1,36),'key_panel_8':(5,8,36),'key_panel_9':(5,9,36),'key_panel_10':(5,10,36),
        'hand_breakout':(5,1,2),'pod_rgb':(5,1,1)}
included=[OUT/'README.md',OUT/'handwiring.svg',OUT/'handwiring-layout.html',OUT/'handwiring-layout-plan.svg',OUT/'handwiring-layout-tilted.svg',OUT/'manifest.json',OUT/'electrical-audit.json']+list(lib.glob('*'))
with (OUT/'quote-comparison.csv').open('w',newline='') as f:
    w=csv.writer(f);w.writerow(['Option','Width mm','Height mm','Order quantity','Units per panel','Units supplied','Units used','Spare','Assembly components per ordered board or panel','Bare price','Assembled price','Currency','Shipping','Tax'])
    for item in manifest:
        name=item['name'];quantity,per,used=counts[name]
        w.writerow([name,item['width_mm'],item['height_mm'],quantity,per,quantity*per,used,quantity*per-used,item['components'],'','','','',''])
        folder=OUT/name;d=json.loads((folder/'drc-summary.json').read_text())
        assert not d['violations'] and not d['unconnected'],name
        (folder/'fp-lib-table').write_text('(fp_lib_table (version 7) (lib (name "rosebear_v4") (type "KiCad") (uri "${KIPRJMOD}/../footprints/rosebear_v4.pretty") (options "") (descr "Quote footprints")))\n')
        archive=OUT/(name+'-gerbers.zip')
        with zipfile.ZipFile(archive) as z:
            assert z.testzip() is None
            files=z.namelist()
            assert any(x.endswith('-PTH.drl') for x in files),name
            assert any(x.endswith('-NPTH.drl') for x in files),name
            assert sum(x.endswith('.drl') for x in files)==2,name
            assert any(x.endswith('.gm1') for x in files),name
        included.append(archive)
        for filename in [name+'.kicad_pcb',name+'.kicad_pro','fp-lib-table','bom.csv','positions.csv','layout.svg','drc-summary.json']:
            included.append(folder/filename)
included.append(OUT/'quote-comparison.csv')
hashes={str(p.relative_to(OUT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in included}
(OUT/'SHA256.json').write_text(json.dumps(hashes,indent=2)+'\n');included.append(OUT/'SHA256.json')
with zipfile.ZipFile(OUT/'rosebear-key-quotes.zip','w',zipfile.ZIP_DEFLATED) as z:
    for p in included:z.write(p,str(p.relative_to(OUT)))
print('Packaged',len(included),'files;',len(manifest),'DRC-clean designs')
print(OUT/'rosebear-key-quotes.zip')
