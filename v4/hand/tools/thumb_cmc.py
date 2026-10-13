"""Place the thumb's base joint (CMC), which the photos don't show, and add it to left-hand.json.

The thumb is a chain CMC-MCP-IP-pad. The CMC is a ball joint: it aims the
metacarpal (yaw, pitch) and turns the thumb about it (roll). The MCP and IP are
hinges that bend the thumb toward its pad. Each of the five thumb prints gets
its own pose, and all poses share one CMC.

The prints alone can't fix the CMC: the thumb bends differently at each print.
So the fit also asks for the resting knuckles where pose B put them, typical
anatomy (a 46 mm metacarpal, the CMC about 60 mm behind the index knuckle, a
resting MCP bent about 15 degrees), and as little joint movement from rest as
reaches each print. The result is an assumption the prints agree with, not a
measurement. Usage: thumb_cmc.py left-hand.json (rewritten in place)."""
import json, sys, numpy as np
from scipy.optimize import least_squares

path = sys.argv[1]
m = json.load(open(path))
th = m['thumb']
L1, L2 = th['segment_mm']['mcp_ip'], th['segment_mm']['ip_pad']
PAD = 8.0          # pad contact below the distal axis, mm
LM, LM_SD = 46.0, 5.0
MCP, IP = np.array(th['rest']['joints']['mcp']), np.array(th['rest']['joints']['ip'])
# Typical anatomy, as soft targets: the CMC sits on the thumb side of the index
# metacarpal's base, about 60 mm behind and 25 mm below the index knuckle, and a
# resting thumb bends its MCP about 15 degrees.
IDX = np.array(m['fingers']['index']['rest']['joints']['mcp'])
CMC0, CMC_SD = IDX + np.array([-10, -60, -25]), 10.0
MCP_REST, MCP_REST_SD = 15.0, 15.0
prints = {k: np.array(v) for k, v in m['measured']['thumb_prints'].items()}
KEYS = sorted(prints)

def R(yaw, pitch, roll):
    a, b, c = np.radians([yaw, pitch, roll])
    Rz = np.array([[np.cos(a), -np.sin(a), 0], [np.sin(a), np.cos(a), 0], [0, 0, 1]])
    Ry = np.array([[np.cos(b), 0, np.sin(b)], [0, 1, 0], [-np.sin(b), 0, np.cos(b)]])
    Rx = np.array([[1, 0, 0], [0, np.cos(c), -np.sin(c)], [0, np.sin(c), np.cos(c)]])
    return Rz @ Ry @ Rx

def chain(C, lm, q):
    """Joint centres and pad for pose q = (yaw, pitch, roll, mcp, ip) in degrees.
    Local frame: x along the metacarpal, y toward the back of the thumb; bending
    turns toward -y."""
    yaw, pitch, roll, b1, b2 = q
    Rq = R(yaw, pitch, roll)
    def d(a):
        a = np.radians(a); return Rq @ np.array([np.cos(a), -np.sin(a), 0])
    def up(a):
        a = np.radians(a); return Rq @ np.array([np.sin(a), np.cos(a), 0])
    M = C + lm * d(0)
    I = M + L1 * d(b1)
    P = I + L2 * d(b1 + b2) - PAD * up(b1 + b2)
    return M, I, P

def unpack(x):
    return x[:3], x[3], {k: x[4 + 5 * i: 9 + 5 * i] for i, k in enumerate(KEYS)}

def residuals(x):
    C, lm, Q = unpack(x)
    r = []
    for k in KEYS:
        r += list((chain(C, lm, Q[k])[2] - prints[k]) / 0.5)          # each print, to 0.5 mm
    M, I, _ = chain(C, lm, Q['1'])                                       # print 1 is the resting pose
    r += list((M[:2] - MCP[:2]) / 3) + list((I[:2] - IP[:2]) / 3)
    r += [(M[2] - MCP[2]) / 6, (lm - LM) / LM_SD, (Q['1'][3] - MCP_REST) / MCP_REST_SD]
    r += list((C - CMC0) / CMC_SD)
    for k in KEYS[1:]:                                                   # least movement from rest
        r += list((Q[k] - Q['1']) / np.array([30, 30, 30, 30, 30]))
    return np.array(r)

# Start: metacarpal reaching back and down from the resting MCP toward the wrist.
d0 = MCP - (MCP + np.array([10, -40, -18]))
yaw0 = np.degrees(np.arctan2(d0[1], d0[0])); pitch0 = -np.degrees(np.arcsin(d0[2] / np.linalg.norm(d0)))
x0 = np.r_[MCP + np.array([10, -40, -18]), LM, np.tile([yaw0, pitch0, 0, 10, 10], len(KEYS))]
lo = np.r_[[-np.inf] * 3, 30, np.tile([-np.inf, -np.inf, -np.inf, -15, -20], len(KEYS))]
hi = np.r_[[np.inf] * 3, 60, np.tile([np.inf, np.inf, np.inf, 70, 85], len(KEYS))]
fit = least_squares(residuals, x0, bounds=(lo, hi))
C, lm, Q = unpack(fit.x)
misses = {k: round(float(np.linalg.norm(chain(C, lm, Q[k])[2] - prints[k])), 1) for k in KEYS}
M, I, _ = chain(C, lm, Q['1'])
r1 = lambda v: [round(float(a), 1) for a in v]
th['assumed_cmc'] = {
    'note': 'Not measured. Fitted so the thumb reaches all five prints, assuming a ball joint at the base, '
            'typical anatomy (a 46 mm metacarpal, the CMC about 60 mm behind the index knuckle) and the least joint movement from rest. Angles in degrees; bending is + toward the pad.',
    'cmc': r1(C),
    'metacarpal_mm': round(float(lm), 1),
    'pad_below_distal_axis_mm': PAD,
    'pose_order': ['yaw', 'pitch', 'roll', 'mcp', 'ip'],
    'poses': {k: r1(Q[k]) for k in KEYS},
    'print_misses_mm': misses,
    'rest_joints_fitted': {'mcp': r1(M), 'ip': r1(I)},
}
json.dump(m, open(path, 'w'), indent=1)
open(path, 'a').write('\n')
print('cmc', r1(C), 'metacarpal', round(float(lm), 1), 'misses', misses)
print('rest mcp', r1(M), 'vs', list(MCP), ' ip', r1(I), 'vs', list(IP))
for k in KEYS: print(k, r1(Q[k]))
