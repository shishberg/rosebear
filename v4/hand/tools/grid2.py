"""Flood-fill the 5 mm grid from its bottom-right corner. Frame: x right, y up, mm, origin at that corner."""
import sys, json, numpy as np
from collections import deque
from grid import load, dlt, apply, refine_point

def find(f, corner, pitch):
    gray, sat = load(f)
    r = int(pitch*0.3)
    pts = {(0, 0): np.array(corner, float)}
    q = deque([(0, 0)])
    H = None; since = 0
    while q:
        k = q.popleft()
        for di, dj in ((-1,0),(1,0),(0,1),(0,-1)):
            n = (k[0]+di, k[1]+dj)
            if n in pts or n[0] > 0 or n[1] < 0: continue
            # predict from neighbours: local affine from found points near k
            near = [m for m in pts if abs(m[0]-n[0]) <= 3 and abs(m[1]-n[1]) <= 3]
            if len(near) >= 4:
                src = np.array([[5*m[0], 5*m[1]] for m in near]); dst = np.array([pts[m] for m in near])
                A = np.c_[src, np.ones(len(src))]
                coef, *_ = np.linalg.lstsq(A, dst, rcond=None)
                guess = np.array([5*n[0], 5*n[1], 1]) @ coef
            else:
                guess = pts[k] + np.array([di*pitch, -dj*pitch])
            p = refine_point(gray, sat, *guess, r)
            if p is not None and np.hypot(p[0]-guess[0], p[1]-guess[1]) < pitch*0.2:
                pts[n] = np.array(p); q.append(n)
    return pts

if __name__ == '__main__':
    f, cx, cy, pitch, out = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), sys.argv[5]
    pts = find(f, (cx, cy), pitch)
    src = np.array([pts[k] for k in pts]); dst = np.array([[5*k[0], 5*k[1]] for k in pts])
    H = dlt(src, dst)
    res = np.hypot(*(apply(H, src) - dst).T)
    keys = list(pts)
    print(f.split('/')[-1], 'points', len(pts), 'i', min(k[0] for k in keys), 'j', max(k[1] for k in keys),
          'global H resid median %.2f p95 %.2f max %.2f' % (np.median(res), np.percentile(res, 95), res.max()))
    json.dump({'pts': [[k[0], k[1], float(v[0]), float(v[1])] for k, v in pts.items()]}, open(out, 'w'))
