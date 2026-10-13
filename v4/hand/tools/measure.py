"""Map labelled dots to sheet mm and draw check overlays.
Sheet frame: origin at the printed grid's bottom-left corner, x right, y up (away from you), mm.
Grid is 37 x 54 squares; pitch 4.975 mm (ruler: printed 0.5% small)."""
import json, os, numpy as np
from PIL import Image, ImageDraw, ImageFont
from grid import dlt, apply

PITCH = 4.975
NI, NJ = 37, 54
R = os.environ.get('PHOTOS', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..')) + '/'
LABELS = {
 'hand-a': {'middle DIP':(811,625),'ring DIP':(587,646),'index DIP':(996,770),'pinky DIP':(283,789),
            'middle PIP':(737,830),'ring PIP':(541,848),'pinky PIP':(295,944),'index PIP':(919,949),
            'pinky MCP':(309,1170),'ring MCP':(465,1172),'middle MCP':(608,1175),'index MCP':(757,1215),
            'thumb IP':(1116,1409),'thumb MCP':(939,1587)},
 'hand-b': {'middle DIP':(544,190),'ring DIP':(382,223),'index DIP':(694,280),'middle PIP':(487,302),
            'ring PIP':(317,340),'pinky DIP':(197,348),'index PIP':(672,401),'pinky PIP':(153,456),
            'middle MCP':(411,682),'ring MCP':(275,698),'pinky MCP':(144,702),'index MCP':(591,714),
            'thumb IP':(856,755),'thumb MCP':(762,987)},
 'sheet-a': {'middle tip':(1809,843),'ring tip':(1346,882),'index tip':(2174,1102),'pinky tip':(817,1193),'thumb tip':(2472,2289)},
 'sheet-b': {'middle tip':(1123,1909),'ring tip':(821,1978),'index tip':(1379,2030),'pinky tip':(516,2151),
             'thumb 2':(1348,2693),'thumb 1':(1552,2764),'thumb 3':(1742,3021),'thumb 5':(1462,3101),'thumb 4':(1834,3335)},
}

class Grid:
    def __init__(self, name):
        self.global_only = name.startswith('hand')
        P = np.array(json.load(open(f'g_{name[0]}{name.split("-")[1][0]}.json'))['pts'])
        self.img = P[:, 2:4]
        self.mm = np.c_[(P[:, 0] + NI) * PITCH, P[:, 1] * PITCH]
        self.ij = P[:, :2]
    def _local(self, src, dst, p, sigma):
        d = np.hypot(*(src - p).T)
        w = np.exp(-0.5 * (d / sigma) ** 2)
        keep = w > 1e-3
        if keep.sum() < 12: keep = np.argsort(d)[:40]
        return apply(dlt(src[keep], dst[keep], w[keep] + 1e-6), p)[0]
    def to_mm(self, p):
        if self.global_only: return apply(self.Hinv, np.asarray(p, float))[0]
        return self._local(self.img, self.mm, np.asarray(p, float), sigma=self.sig_img)
    def to_img(self, q):
        if self.global_only: return apply(self.H, np.asarray(q, float))[0]
        return self._local(self.mm, self.img, np.asarray(q, float), sigma=40.0)
    def setup(self):
        # sigma in image px equivalent to ~40 mm
        H = dlt(self.mm, self.img)
        a = apply(H, [[100, 100], [140, 100]])
        self.sig_img = np.hypot(*(a[1] - a[0]))
        self.H = H
        self.Hinv = dlt(self.img, self.mm)
        return self

def dots(name):
    a = np.asarray(Image.open(R + f'kb-{name}.jpg').convert('RGB')).astype(int)
    from scipy import ndimage
    m = (a[..., 2] > 180) & (a[..., 0] < 90) & (a[..., 2] - a[..., 1] > 60)
    lab, n = ndimage.label(m)
    cs = [np.array(ndimage.center_of_mass(m, lab, i))[::-1] for i in range(1, n + 1) if (lab == i).sum() >= 8]
    out = {}
    for k, v in LABELS[name].items():
        d = [np.hypot(*(c - v)) for c in cs]
        out[k] = cs[int(np.argmin(d))]
        assert min(d) < 15, (name, k)
    return out

def font(sz):
    for f in ('/System/Library/Fonts/Menlo.ttc', '/System/Library/Fonts/Supplemental/Arial.ttf'):
        try: return ImageFont.truetype(f, sz)
        except Exception: pass
    return ImageFont.load_default()

def overlay(name, g, pts_img, pts_mm, extra=None, scale=1.0):
    im = Image.open(R + f'kb-{name}.jpg').convert('RGB')
    W, Hh = im.size
    lw = max(1, int(round(2 / scale))) if scale < 1 else 1
    d = ImageDraw.Draw(im, 'RGBA')
    f = font(int(13 / scale))
    fs = font(int(11 / scale))
    # fitted grid lines, every square; bold every 10
    def line_pts(fixed, axis):
        rng = np.linspace(0, (NJ if axis == 0 else NI) * PITCH, 60)
        q = [(fixed, t) if axis == 0 else (t, fixed) for t in rng]
        return [tuple(g.to_img(x)) for x in q]
    for i in range(NI + 1):
        x = i * PITCH
        c = (0, 170, 200, 200) if i % 10 else (230, 0, 160, 230)
        d.line(line_pts(x, 0), fill=c, width=lw * (2 if i % 10 == 0 else 1))
    for j in range(NJ + 1):
        y = j * PITCH
        c = (0, 170, 200, 200) if j % 10 else (230, 0, 160, 230)
        d.line(line_pts(y, 1), fill=c, width=lw * (2 if j % 10 == 0 else 1))
    for i in range(0, NI + 1, 10):
        p = g.to_img((i * PITCH, 0)); d.text((p[0] + 4 / scale, p[1] + 4 / scale), f'x{i*PITCH:.1f}', fill=(230, 0, 160), font=fs)
    for j in range(10, NJ + 1, 10):
        p = g.to_img((NI * PITCH, j * PITCH)); d.text((p[0] + 4 / scale, p[1] - 14 / scale), f'y{j*PITCH:.1f}', fill=(230, 0, 160), font=fs)
    # detected intersections
    r = 2.5 / scale
    for p in g.img:
        d.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], outline=(255, 140, 0, 230), width=lw)
    # labelled dots
    R0 = 9 / scale
    for k, p in pts_img.items():
        d.ellipse([p[0] - R0, p[1] - R0, p[0] + R0, p[1] + R0], outline=(255, 30, 30), width=lw * 2)
        m = pts_mm[k]
        t = f'{k}  ({m[0]:.1f}, {m[1]:.1f})'
        tx, ty = p[0] + 12 / scale, p[1] - 8 / scale
        bb = d.textbbox((tx, ty), t, font=f)
        d.rectangle([bb[0] - 2, bb[1] - 2, bb[2] + 2, bb[3] + 2], fill=(255, 255, 255, 210))
        d.text((tx, ty), t, fill=(200, 0, 0), font=f)
    if extra:
        for k, p in extra.items():
            s = 10 / scale
            d.line([p[0] - s, p[1] - s, p[0] + s, p[1] + s], fill=(0, 120, 255), width=lw * 2)
            d.line([p[0] - s, p[1] + s, p[0] + s, p[1] - s], fill=(0, 120, 255), width=lw * 2)
            t = k
            d.text((p[0] + 12 / scale, p[1] + 4 / scale), t, fill=(0, 90, 220), font=f)
    if scale < 1:
        im = im.resize((int(W * scale), int(Hh * scale)), Image.LANCZOS)
    im.save(f'ov-{name}.jpg', quality=88)

if __name__ == '__main__':
    out = {}
    G = {n: Grid(n).setup() for n in LABELS}
    for n in LABELS:
        pi = dots(n)
        out[n] = {k: [round(float(v), 2) for v in G[n].to_mm(p)] for k, p in pi.items()}
        res = np.hypot(*(apply(G[n].Hinv, G[n].img) - G[n].mm).T)
        print(n, 'grid pts', len(G[n].img), 'global-fit resid median %.2f mm' % np.median(res))
        # local-fit residuals
        lr = [np.hypot(*(G[n].to_mm(G[n].img[i]) - G[n].mm[i])) for i in range(0, len(G[n].img), 7)]
        print('   local-fit resid median %.2f p95 %.2f max %.2f mm' % (np.median(lr), np.percentile(lr, 95), np.max(lr)))
        out[n + ':img'] = {k: [round(float(v), 1) for v in p] for k, p in pi.items()}
    json.dump(out, open('points.json', 'w'), indent=1)
    # cross-photo check: sheet tip marks drawn into the hand photo (paper-level, no parallax)
    xa = {f'A {k}': G['hand-a'].to_img(v) for k, v in out['sheet-a'].items()}
    xb = {f'B {k}': G['hand-b'].to_img(v) for k, v in out['sheet-b'].items()}
    for n, sc, ex in (('hand-a', 1.0, xa), ('hand-b', 1.0, xb), ('sheet-a', 0.5, None), ('sheet-b', 0.5, None)):
        pi = {k: np.array(v) for k, v in out[n + ':img'].items()}
        overlay(n, G[n], pi, out[n], ex, sc)
    for n in LABELS:
        print(n); [print(f'   {k:12s} {v[0]:7.1f} {v[1]:7.1f}') for k, v in out[n].items()]
