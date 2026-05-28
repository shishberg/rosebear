module.exports = {
  params: {
    designator: 'LED',
    VDD: {type: 'net', value: 'LED_VDD'},
    GND: {type: 'net', value: 'GND'},
    din: undefined,
    dout: undefined,
  },
  body: p => `
    (module SK6812MINI-E_MX-reverse (layer F.Cu) (tedit 6012BF31)
      (descr "SK6812 MINI-E reverse-mount LED add-on for MX footprints")
      ${p.at}
      (fp_text reference "${p.ref}" (at -7.2 7.15 ${p.rot}) (layer B.SilkS) ${p.ref_hide} (effects (font (size 1 1) (thickness 0.15)) (justify mirror)))
      (fp_text value "SK6812MINI-E" (at -2.4 8.55 ${p.rot}) (layer B.Fab) hide (effects (font (size 1 1) (thickness 0.15)) (justify mirror)))

      (fp_line (start 0.794452 6.579999) (end -0.794452 6.579999) (layer Edge.Cuts) (width 0.1))
      (fp_line (start 1.699999 4.377157) (end 1.699999 5.782841) (layer Edge.Cuts) (width 0.1))
      (fp_line (start -0.794452 3.58) (end 0.794453 3.58) (layer Edge.Cuts) (width 0.1))
      (fp_line (start -1.699999 5.782841) (end -1.699999 4.377157) (layer Edge.Cuts) (width 0.1))
      (fp_arc (start -1.298969 6.216596) (end -1.749484 5.999719) (angle -146.0053744) (layer Edge.Cuts) (width 0.1))
      (fp_arc (start -2.199999 5.782841) (end -1.749484 5.999719) (angle -25.70611205) (layer Edge.Cuts) (width 0.1))
      (fp_arc (start -2.199999 4.377157) (end -1.699999 4.377157) (angle -25.70611954) (layer Edge.Cuts) (width 0.1))
      (fp_arc (start -1.298969 3.943401) (end -1.046711 3.5117) (angle -146.0054017) (layer Edge.Cuts) (width 0.1))
      (fp_arc (start -0.794452 3.08) (end -1.046711 3.5117) (angle -30.29928212) (layer Edge.Cuts) (width 0.1))
      (fp_arc (start 0.794453 3.08) (end 0.794453 3.58) (angle -30.29922831) (layer Edge.Cuts) (width 0.1))
      (fp_arc (start 1.298969 3.943402) (end 1.749484 4.160279) (angle -146.0053097) (layer Edge.Cuts) (width 0.1))
      (fp_arc (start 2.199999 4.377157) (end 1.749484 4.160279) (angle -25.70608136) (layer Edge.Cuts) (width 0.1))
      (fp_arc (start 2.199999 5.782841) (end 1.699999 5.782841) (angle -25.70617777) (layer Edge.Cuts) (width 0.1))
      (fp_arc (start 1.298969 6.216597) (end 1.046711 6.648298) (angle -146.0055121) (layer Edge.Cuts) (width 0.1))
      (fp_arc (start 0.794452 7.079999) (end 1.046711 6.648298) (angle -30.29933433) (layer Edge.Cuts) (width 0.1))
      (fp_arc (start -0.794452 7.079999) (end -0.794452 6.579999) (angle -30.2992623) (layer Edge.Cuts) (width 0.1))

      (fp_poly (pts (xy 4.2 6.079999) (xy 3.3 6.979999) (xy 4.2 6.979999)) (layer B.SilkS) (width 0.1))
      (fp_line (start 1.6 5.979999) (end 1.1 6.479999) (layer Dwgs.User) (width 0.12))
      (fp_line (start 1.6 5.979999) (end 1.6 3.679999) (layer Dwgs.User) (width 0.12))
      (fp_line (start -1.6 6.479999) (end 1.1 6.479999) (layer Dwgs.User) (width 0.12))
      (fp_line (start -1.6 3.679999) (end -1.6 6.479999) (layer Dwgs.User) (width 0.12))
      (fp_line (start 1.6 3.679999) (end -1.6 3.679999) (layer Dwgs.User) (width 0.12))
      (fp_line (start -3.8 3.079999) (end -3.8 7.079999) (layer B.CrtYd) (width 0.05))
      (fp_line (start -3.8 7.079999) (end 3.8 7.079999) (layer B.CrtYd) (width 0.05))
      (fp_line (start 3.8 7.079999) (end 3.8 3.079999) (layer B.CrtYd) (width 0.05))
      (fp_line (start 3.8 3.079999) (end -3.8 3.079999) (layer B.CrtYd) (width 0.05))

      (pad 1 smd roundrect (at -2.6 4.329999 ${p.rot + 270}) (size 0.82 1.6) (layers B.Cu B.Paste B.Mask) (roundrect_rratio 0.1) ${p.VDD.str})
      (pad 2 smd roundrect (at -2.6 5.829999 ${p.rot + 270}) (size 0.82 1.6) (layers B.Cu B.Paste B.Mask) (roundrect_rratio 0.1) ${p.dout.str})
      (pad 3 smd roundrect (at 2.6 5.829999 ${p.rot + 270}) (size 0.82 1.6) (layers B.Cu B.Paste B.Mask) (roundrect_rratio 0.1) ${p.GND.str})
      (pad 4 smd roundrect (at 2.6 4.329999 ${p.rot + 270}) (size 0.82 1.6) (layers B.Cu B.Paste B.Mask) (roundrect_rratio 0.1) ${p.din.str})
    )
  `,
}
