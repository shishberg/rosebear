module.exports = {
  params: {
    designator: 'D',
    side: 'F',
    from: undefined,
    to: undefined,
  },
  body: p => `
    (module SOD-123 (layer F.Cu) (tedit 00000000)
      ${p.at}
      (fp_text reference "${p.ref}" (at 0 -1.8 ${p.rot}) (layer ${p.side}.SilkS) ${p.ref_hide} (effects (font (size 1 1) (thickness 0.15))))
      (fp_text value "SOD-123" (at 0 1.8 ${p.rot}) (layer ${p.side}.Fab) hide (effects (font (size 1 1) (thickness 0.15))))
      (fp_line (start -1.25 -0.85) (end 1.25 -0.85) (layer ${p.side}.SilkS) (width 0.12))
      (fp_line (start -1.25 0.85) (end 1.25 0.85) (layer ${p.side}.SilkS) (width 0.12))
      (fp_line (start -0.45 -0.85) (end -0.45 0.85) (layer ${p.side}.SilkS) (width 0.12))
      (fp_line (start -2.6 -1.05) (end 2.6 -1.05) (layer ${p.side}.CrtYd) (width 0.05))
      (fp_line (start 2.6 -1.05) (end 2.6 1.05) (layer ${p.side}.CrtYd) (width 0.05))
      (fp_line (start 2.6 1.05) (end -2.6 1.05) (layer ${p.side}.CrtYd) (width 0.05))
      (fp_line (start -2.6 1.05) (end -2.6 -1.05) (layer ${p.side}.CrtYd) (width 0.05))
      (pad 1 smd roundrect (at -1.85 0 ${p.rot}) (size 1.2 1.4) (layers ${p.side}.Cu ${p.side}.Paste ${p.side}.Mask) (roundrect_rratio 0.15) ${p.to.str})
      (pad 2 smd roundrect (at 1.85 0 ${p.rot}) (size 1.2 1.4) (layers ${p.side}.Cu ${p.side}.Paste ${p.side}.Mask) (roundrect_rratio 0.15) ${p.from.str})
    )
  `,
}
