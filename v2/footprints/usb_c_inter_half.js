module.exports = {
  params: {
    designator: 'J',
    GND: {type: 'net', value: 'GND'},
    VBUS: {type: 'net', value: 'WIRED_5V'},
    tx: undefined,
    rx: undefined,
    detect: undefined,
    spare: undefined,
  },
  body: p => `
    (module USB-C_inter_half_placeholder (layer F.Cu) (tedit 00000000)
      (descr "USB-C receptacle used as a private inter-half connector; placeholder footprint, replace/check exact part before fabrication")
      ${p.at}
      (fp_text reference "${p.ref}" (at 0 -4.8 ${p.rot}) (layer F.SilkS) ${p.ref_hide} (effects (font (size 1 1) (thickness 0.15))))
      (fp_text value "INTER-HALF USB-C ONLY" (at 0 4.8 ${p.rot}) (layer F.SilkS) (effects (font (size 0.8 0.8) (thickness 0.12))))
      (fp_text user "INTER-HALF ONLY" (at 0 6.2 ${p.rot}) (layer F.SilkS) (effects (font (size 0.9 0.9) (thickness 0.15))))
      (fp_text user "NOT USB" (at 0 7.4 ${p.rot}) (layer F.SilkS) (effects (font (size 0.9 0.9) (thickness 0.15))))

      (fp_line (start -4.6 -3.9) (end 4.6 -3.9) (layer F.SilkS) (width 0.12))
      (fp_line (start -4.6 3.9) (end 4.6 3.9) (layer F.SilkS) (width 0.12))
      (fp_line (start -4.6 -3.9) (end -4.6 3.9) (layer F.SilkS) (width 0.12))
      (fp_line (start 4.6 -3.9) (end 4.6 3.9) (layer F.SilkS) (width 0.12))
      (fp_line (start -4.9 -4.2) (end 4.9 -4.2) (layer F.CrtYd) (width 0.05))
      (fp_line (start 4.9 -4.2) (end 4.9 4.2) (layer F.CrtYd) (width 0.05))
      (fp_line (start 4.9 4.2) (end -4.9 4.2) (layer F.CrtYd) (width 0.05))
      (fp_line (start -4.9 4.2) (end -4.9 -4.2) (layer F.CrtYd) (width 0.05))

      (pad S1 thru_hole oval (at -4.32 -2.85 ${p.rot}) (size 1.2 1.8) (drill oval 0.65 1.25) (layers *.Cu *.Mask) ${p.GND.str})
      (pad S2 thru_hole oval (at 4.32 -2.85 ${p.rot}) (size 1.2 1.8) (drill oval 0.65 1.25) (layers *.Cu *.Mask) ${p.GND.str})
      (pad S3 thru_hole oval (at -4.32 2.85 ${p.rot}) (size 1.2 1.8) (drill oval 0.65 1.25) (layers *.Cu *.Mask) ${p.GND.str})
      (pad S4 thru_hole oval (at 4.32 2.85 ${p.rot}) (size 1.2 1.8) (drill oval 0.65 1.25) (layers *.Cu *.Mask) ${p.GND.str})

      (pad A1 smd rect (at -3.2 -2.65 ${p.rot}) (size 0.35 1.2) (layers F.Cu F.Paste F.Mask) ${p.GND.str})
      (pad A4 smd rect (at -2.4 -2.65 ${p.rot}) (size 0.35 1.2) (layers F.Cu F.Paste F.Mask) ${p.VBUS.str})
      (pad A5 smd rect (at -1.6 -2.65 ${p.rot}) (size 0.35 1.2) (layers F.Cu F.Paste F.Mask) ${p.detect.str})
      (pad A6 smd rect (at -0.8 -2.65 ${p.rot}) (size 0.35 1.2) (layers F.Cu F.Paste F.Mask) ${p.tx.str})
      (pad A7 smd rect (at 0 -2.65 ${p.rot}) (size 0.35 1.2) (layers F.Cu F.Paste F.Mask) ${p.rx.str})
      (pad A8 smd rect (at 0.8 -2.65 ${p.rot}) (size 0.35 1.2) (layers F.Cu F.Paste F.Mask) ${p.spare.str})
      (pad A9 smd rect (at 1.6 -2.65 ${p.rot}) (size 0.35 1.2) (layers F.Cu F.Paste F.Mask) ${p.VBUS.str})
      (pad A12 smd rect (at 2.4 -2.65 ${p.rot}) (size 0.35 1.2) (layers F.Cu F.Paste F.Mask) ${p.GND.str})

      (pad B1 smd rect (at -3.2 2.65 ${p.rot}) (size 0.35 1.2) (layers F.Cu F.Paste F.Mask) ${p.GND.str})
      (pad B4 smd rect (at -2.4 2.65 ${p.rot}) (size 0.35 1.2) (layers F.Cu F.Paste F.Mask) ${p.VBUS.str})
      (pad B5 smd rect (at -1.6 2.65 ${p.rot}) (size 0.35 1.2) (layers F.Cu F.Paste F.Mask) ${p.detect.str})
      (pad B6 smd rect (at -0.8 2.65 ${p.rot}) (size 0.35 1.2) (layers F.Cu F.Paste F.Mask) ${p.tx.str})
      (pad B7 smd rect (at 0 2.65 ${p.rot}) (size 0.35 1.2) (layers F.Cu F.Paste F.Mask) ${p.rx.str})
      (pad B8 smd rect (at 0.8 2.65 ${p.rot}) (size 0.35 1.2) (layers F.Cu F.Paste F.Mask) ${p.spare.str})
      (pad B9 smd rect (at 1.6 2.65 ${p.rot}) (size 0.35 1.2) (layers F.Cu F.Paste F.Mask) ${p.VBUS.str})
      (pad B12 smd rect (at 2.4 2.65 ${p.rot}) (size 0.35 1.2) (layers F.Cu F.Paste F.Mask) ${p.GND.str})
    )
  `,
}
