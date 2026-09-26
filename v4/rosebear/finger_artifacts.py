def export(board,path,out):
    """Native fabrication review exports, for matrix-only finger boards."""
    import csv,subprocess
    from .pcb import CLI
    out.mkdir(parents=True,exist_ok=True)
    commands=[['pcb','export','svg','--mode-single','--page-size-mode','2','--exclude-drawing-sheet','--layers','F.Cu,B.Cu,B.Fab,Edge.Cuts','-o',str(out/'layout.svg'),str(path)],
              ['pcb','export','gerbers','--layers','F.Cu,B.Cu,F.Mask,B.Mask,F.Silkscreen,B.Silkscreen,Edge.Cuts','-o',str(out/'gerbers')+'/',str(path)],
              ['pcb','export','drill','-o',str(out/'gerbers')+'/',str(path)]]
    for command in commands:
        result=subprocess.run([str(CLI)]+command,capture_output=True,text=True)
        if result.returncode:raise RuntimeError(result.stderr+result.stdout)
    with (out/'bom.csv').open('w',newline='') as f:
        writer=csv.writer(f);writer.writerow(['Reference','Value','Footprint','Side'])
        for fp in sorted(board.GetFootprints(),key=lambda f:f.GetReference()):
            writer.writerow([fp.GetReference(),fp.GetValue(),fp.GetFPIDAsString(),'back' if fp.IsFlipped() else 'front'])
    (out/'README.md').write_text('# Finger PCB fabrication review\n\nTwo-layer 0.60 mm segmented finger PCB, with switches and matrix diodes. This is a prototype review package, not a released manufacturing order. Confirm segmented-board bend construction with the fabricator. The thumb harness carries four matrix wires; no lighting supply is required.\n')
