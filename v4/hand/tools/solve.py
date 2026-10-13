"""Finger and thumb geometry from the two poses.
World frame: sheet mm, x right, y away from you, z up from the paper."""
import json, sys, numpy as np
from scipy.optimize import least_squares
from grid import apply

pts = json.load(open('points.json'))
cam = json.load(open('cam2.json'))
FINGERS = ['index', 'middle', 'ring', 'pinky']
# dorsal skin offset from joint axis (mm); pinky scaled down
RD = {'MCP': 12, 'PIP': 9, 'DIP': 7}
PAD = 7
SCALE = {'index': 1, 'middle': 1, 'ring': 0.95, 'pinky': 0.85}

class Cam:
    def __init__(self, c):
        self.K, self.R, self.t, self.C, self.S = (np.array(c[k]) for k in ('K', 'R', 't', 'C', 'S'))
    def orig_px(self, edited_px):
        return apply(self.S, edited_px)[0]
    def ray(self, edited_px):
        u = self.orig_px(edited_px)
        d = self.R.T @ np.linalg.solve(self.K, np.r_[u, 1])
        return self.C, d
    def at_height(self, edited_px, z):
        C, d = self.ray(edited_px)
        return C + d * (z - C[2]) / d[2]
    def project(self, X):
        x = self.K @ (self.R @ X + self.t)
        return x[:2] / x[2]
    def px_per_mm(self):
        return self.K[0, 0] / self.C[2]

CA, CB = Cam(cam['ua']), Cam(cam['ub'])
imgA, imgB = pts['hand-a:img'], pts['hand-b:img']
tipA = {k.split()[0]: np.r_[v, 0] for k, v in pts['sheet-a'].items()}
tipB = {k.split()[0]: np.r_[v, 0] for k, v in pts['sheet-b'].items() if 'tip' in k}
thumbB = {int(k.split()[1]): np.r_[v, 0] for k, v in pts['sheet-b'].items() if k.startswith('thumb')}

def u(phi, psi):
    return np.array([np.cos(phi) * np.cos(psi), np.cos(phi) * np.sin(psi), -np.sin(phi)])
def nd(phi, psi):
    return np.array([np.sin(phi) * np.cos(psi), np.sin(phi) * np.sin(psi), np.cos(phi)])

# ---- pose A: lengths ----
L = {}
for f in FINGERS:
    s = SCALE[f]
    J = {}
    for j in ('MCP', 'PIP', 'DIP'):
        r = RD[j] * s
        dot = CA.at_height(imgA[f'{f} {j}'], 2 * r)
        J[j] = dot - np.array([0, 0, r])
    b1 = np.linalg.norm(J['PIP'] - J['MCP'])
    b2 = np.linalg.norm(J['DIP'] - J['PIP'])
    b3 = np.linalg.norm((J['DIP'] - tipA[f])[:2])
    L[f] = dict(b1=b1, b2=b2, b3=b3, s=s)

# ---- pose B: chain fit ----
def chain(f, J0, psi, ph0, ph1, ph2, ph3):
    l = L[f]; s = l['s']
    J1 = J0 + l['b1'] * u(ph1, psi)
    J2 = J1 + l['b2'] * u(ph2, psi)
    T = J2 + l['b3'] * u(ph3, psi) - PAD * s * nd(ph3, psi)
    def bis(a, b):
        v = nd(a, psi) + nd(b, psi); return v / np.linalg.norm(v)
    dots = {'MCP': J0 + RD['MCP'] * s * bis(ph0, ph1),
            'PIP': J1 + RD['PIP'] * s * bis(ph1, ph2),
            'DIP': J2 + RD['DIP'] * s * bis(ph2, ph3)}
    return dict(J0=J0, J1=J1, J2=J2, T=T, dots=dots)

def unpack(q):
    ph0 = q[0]; out = {}
    for i, f in enumerate(FINGERS):
        p = q[1 + 7 * i: 8 + 7 * i]
        out[f] = chain(f, p[:3], p[3], ph0, *p[4:7])
    return ph0, out

def residuals(q, use_height):
    ph0, C = unpack(q); r = []
    ppm = CB.px_per_mm()
    for f in FINGERS:
        c = C[f]
        for j in ('MCP', 'PIP', 'DIP'):
            r += list((CB.project(c['dots'][j]) - CB.orig_px(imgB[f'{f} {j}'])) / ppm)
        r += list(c['T'] - tipB[f])
    if use_height:
        r.append(C['middle']['dots']['MCP'][2] - 80)
    return np.array(r)

def init():
    q = [np.radians(5)]
    for f in FINGERS:
        M = CB.at_height(imgB[f'{f} MCP'], 70)
        d = tipB[f][:2] - M[:2]; psi = np.arctan2(d[1], d[0])
        q += [M[0], M[1], 60, psi, np.radians(20), np.radians(70), np.radians(100)]
    return np.array(q)

def solveB(use_height):
    s = least_squares(residuals, init(), args=(use_height,))
    return s

if __name__ == '__main__':
    for f in FINGERS:
        l = L[f]; print(f'{f:7s} lengths (joint to joint): MCP-PIP {l["b1"]:.1f}  PIP-DIP {l["b2"]:.1f}  DIP-pad {l["b3"]:.1f}')
    for uh in (False, True):
        s = solveB(uh)
        ph0, C = unpack(s.x)
        r = s.fun
        print(f'\n== pose B solve, {"with" if uh else "WITHOUT"} the 80 mm height: rms resid {np.sqrt(np.mean(r**2)):.2f} mm, max {np.abs(r).max():.2f}')
        print(f'   back-of-hand pitch {np.degrees(ph0):.0f} deg (down toward fingers)')
        for i, f in enumerate(FINGERS):
            p = s.x[1 + 7 * i: 8 + 7 * i]
            ph = np.degrees(np.r_[ph0, p[4:7]])
            c = C[f]
            print(f'   {f:7s} MCP knuckle top z {c["dots"]["MCP"][2]:5.1f}  joint angles MCP {ph[1]-ph[0]:5.0f} PIP {ph[2]-ph[1]:5.0f} DIP {ph[3]-ph[2]:5.0f}  '
                  f'segment pitch {ph[1]:4.0f} {ph[2]:4.0f} {ph[3]:4.0f}  heading {np.degrees(p[3]):5.1f}')
    np.save('qB.npy', solveB(True).x)
