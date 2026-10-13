"""Camera pose for the two uncropped hand photos (2x zoom, so f is twice the 24 mm-equivalent),
and the edited-to-original pixel transform for each (the edits were a rotation and a crop)."""
import json, numpy as np
from grid import dlt, apply
from measure import PITCH, NI
F2 = 2*24/43.267*5000
def load(n):
    P = np.array(json.load(open(f'g_{n}.json'))['pts'])
    return P[:, 2:4], np.c_[(P[:, 0]+NI)*PITCH, P[:, 1]*PITCH]
def zhang(Hm, W, H):
    T = np.array([[1,0,-W/2],[0,1,-H/2],[0,0,1]]); Hc = T@Hm; h1, h2 = Hc[:,0], Hc[:,1]
    a = -(h1[0]*h2[0]+h1[1]*h2[1])/(h1[2]*h2[2]); b = -((h1[0]**2+h1[1]**2)-(h2[0]**2+h2[1]**2))/(h1[2]**2-h2[2]**2)
    return [np.sqrt(x) if x > 0 else float('nan') for x in (a, b)]
def pose(Hm, f, cx, cy):
    K = np.array([[f,0,cx],[0,f,cy],[0,0,1.]]); M = np.linalg.inv(K)@Hm
    lam = 1/np.sqrt(np.linalg.norm(M[:,0])*np.linalg.norm(M[:,1]))
    r1, r2, t = M[:,0]*lam, M[:,1]*lam, M[:,2]*lam
    r1 /= np.linalg.norm(r1); r2 -= r1*(r1@r2); r2 /= np.linalg.norm(r2)
    R = np.c_[r1, r2, np.cross(r1, r2)]; C = -R.T@t
    if C[2] < 0: R = np.c_[-r1, -r2, np.cross(r1, r2)]; t = -t; C = -R.T@t
    return K, R, t, C
if __name__ == '__main__':
    out = {}
    for n, e, (W, H) in (('ua', 'ha', (3000, 4000)), ('ub', 'hb', (4000, 3000))):
        img, mm = load(n)
        Hm = dlt(mm, img)
        res = np.hypot(*(apply(dlt(img, mm), img) - mm).T)
        print(n, 'grid pts', len(img), 'resid median %.2f p95 %.2f mm' % (np.median(res), np.percentile(res, 95)))
        print('   f from grid perspective (centred pp): %.0f / %.0f   expected 2x zoom: %.0f' % (*zhang(Hm, W, H), F2))
        K, R, t, C = pose(Hm, F2, W/2, H/2)
        print('   camera at x %.0f y %.0f, height %.0f mm, tilt %.1f deg' % (C[0], C[1], C[2], np.degrees(np.arccos(R[2,2]))))
        # edited -> original similarity via the plane
        ei, em = load(e)
        S = Hm @ dlt(ei, em)
        S /= S[2,2]
        # report as similarity
        A = S[:2,:2]; sc = np.sqrt(abs(np.linalg.det(A))); ang = np.degrees(np.arctan2(A[1,0], A[0,0]))
        print('   edited->original: scale %.3f rot %.2f deg, projective terms %.1e %.1e' % (sc, ang, S[2,0], S[2,1]))
        out[n] = dict(K=K.tolist(), R=R.tolist(), t=t.tolist(), C=C.tolist(), S=S.tolist(), H=Hm.tolist())
    json.dump(out, open('cam2.json', 'w'), indent=1)
