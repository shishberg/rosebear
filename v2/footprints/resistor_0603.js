module.exports = {
  params: {
    designator: 'R',
    side: 'F',
    from: undefined,
    to: undefined,
  },
  body: p => `
    (module R_0603_1608Metric (layer F.Cu) (tedit 00000000)
      ${p.at}
      (fp_text reference "${p.ref}" (at 0 -1.25 ${p.rot}) (layer ${p.side}.SilkS) ${p.ref_hide} (effects (font (size 0.8 0.8) (thickness 0.12))))
      (fp_text value "R_0603" (at 0 1.25 ${p.rot}) (layer ${p.side}.Fab) hide (effects (font (size 0.8 0.8) (thickness 0.12))))
      (fp_line (start -0.2 -0.45) (end 0.2 -0.45) (layer ${p.side}.SilkS) (width 0.12))
      (fp_line (start -0.2 0.45) (end 0.2 0.45) (layer ${p.side}.SilkS) (width 0.12))
      (fp_line (start -1.55 -0.7) (end 1.55 -0.7) (layer ${p.side}.CrtYd) (width 0.05))
      (fp_line (start 1.55 -0.7) (end 1.55 0.7) (layer ${p.side}.CrtYd) (width 0.05))
      (fp_line (start 1.55 0.7) (end -1.55 0.7) (layer ${p.side}.CrtYd) (width 0.05))
      (fp_line (start -1.55 0.7) (end -1.55 -0.7) (layer ${p.side}.CrtYd) (width 0.05))
      (pad 1 smd roundrect (at -0.775 0 ${p.rot}) (size 0.8 0.95) (layers ${p.side}.Cu ${p.side}.Paste ${p.side}.Mask) (roundrect_rratio 0.25) ${p.from.str})
      (pad 2 smd roundrect (at 0.775 0 ${p.rot}) (size 0.8 0.95) (layers ${p.side}.Cu ${p.side}.Paste ${p.side}.Mask) (roundrect_rratio 0.25) ${p.to.str})
    )
  `,
}
