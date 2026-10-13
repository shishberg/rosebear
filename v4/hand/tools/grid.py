"""Find 5 mm grid intersections, indexed from the grid's bottom-right corner.
Frame: x mm to the right, y mm up (away from the user), origin at that corner."""
import sys, os, json, numpy as np
SATMAX = float(os.environ.get("SATMAX", 45))
from PIL import Image

def load(f):
    a = np.asarray(Image.open(f).convert('RGB')).astype(float)
    gray = a.mean(2)
    sat = a.max(2) - a.min(2)
    return gray, sat

def dlt(src, dst, w=None):
    A = []
    if w is None: w = np.ones(len(src))
    for (x, y), (u, v), wi in zip(src, dst, w):
        s = np.sqrt(wi)
        A.append(s*np.array([-x, -y, -1, 0, 0, 0, u*x, u*y, u]))
        A.append(s*np.array([0, 0, 0, -x, -y, -1, v*x, v*y, v]))
    _, _, Vt = np.linalg.svd(np.array(A))
    H = Vt[-1].reshape(3, 3)
    return H / H[2, 2]

def apply(H, p):
    p = np.atleast_2d(p)
    q = np.c_[p, np.ones(len(p))] @ H.T
    return q[:, :2] / q[:, 2:]

def refine_point(gray, sat, x, y, r):
    x0, y0 = int(round(x)), int(round(y))
    h, w = gray.shape
    if x0-r < 0 or y0-r < 0 or x0+r+1 > w or y0+r+1 > h: return None
    g = gray[y0-r:y0+r+1, x0-r:x0+r+1]
    s = sat[y0-r:y0+r+1, x0-r:x0+r+1]
    if np.median(s) > SATMAX: return None          # skin, not paper
    d = np.median(g) - g
    out = []
    for prof in (d.mean(0), d.mean(1)):
        i = int(np.argmax(prof))
        if i == 0 or i == len(prof)-1: return None
        base = np.median(prof)
        if prof[i] - base < 6: return None
        a, b, c = prof[i-1], prof[i], prof[i+1]
        den = a - 2*b + c
        off = 0.5*(a - c)/den if den != 0 else 0
        out.append(i + off - r)
    return x0 + out[0], y0 + out[1]

def find(f, corner, pitch, maxn=60):
    gray, sat = load(f)
    # image -> mm homography, start as similarity: image y down = mm y down... mm y up
    pts = {}
    pts[(0, 0)] = np.array(corner, float)
    H = None
    r = int(pitch*0.3)
    for ring in range(1, maxn):
        for _ in range(2):
            if len(pts) >= 6:
                src = np.array([pts[k] for k in pts]); dst = np.array([[5*k[0], 5*k[1]] for k in pts])
                H = dlt(src, dst)
            new = {}
            for i in range(-ring, 1):
                for j in range(0, ring+1):
                    if (i, j) in pts or max(-i, j) != ring and _ == 0: continue
                    if (i, j) in pts: continue
                    if H is None:
                        guess = np.array(corner) + np.array([i*pitch, -j*pitch])
                    else:
                        # local prediction from nearest known neighbours
                        Hi = np.linalg.inv(H)
                        guess = apply(Hi, [5*i, 5*j])[0]
                    p = refine_point(gray, sat, *guess, r)
                    if p is not None and np.hypot(p[0]-guess[0], p[1]-guess[1]) < pitch*0.25:
                        new[(i, j)] = np.array(p)
            pts.update(new)
        if not any(max(-k[0], k[1]) == ring for k in pts) and ring > 5:
            break
    return pts

if __name__ == '__main__':
    f, cx, cy, pitch, out = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), sys.argv[5]
    pts = find(f, (cx, cy), pitch)
    src = np.array([pts[k] for k in pts]); dst = np.array([[5*k[0], 5*k[1]] for k in pts])
    H = dlt(src, dst)
    res = np.hypot(*(apply(H, src) - dst).T)
    keys = list(pts)
    print(f, 'points', len(pts), 'i range', min(k[0] for k in keys), 'j range', max(k[1] for k in keys),
          'global H residual mm: median %.2f p95 %.2f max %.2f' % (np.median(res), np.percentile(res, 95), res.max()))
    json.dump({'pts': [[k[0], k[1], float(v[0]), float(v[1])] for k, v in pts.items()]}, open(out, 'w'))
