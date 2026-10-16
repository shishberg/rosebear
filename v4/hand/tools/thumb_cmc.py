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
measurement.

Each print is where the thumb's last section touched the paper: its lowest
point, a quarter of the way past the IP (ip_pad), with the whole thumb above the
paper. The last section is wider than deep: a flat pad PAD mm below the bone
with round edges, PAD_W across (an estimate), so it touches on the flat or an
edge depending on how far it's rolled. The resting IP's measured height isn't
used: 32 mm up, it's 37 mm from the rest print, and the last section reaches
about 19. That height came from taking the knuckles' skin dots to sit straight
above the joints (the nail up); here they sit DOT mm out from the joints on the
back of the thumb, whichever way it faces, and the photo gives where they are
seen from above. The MCP's measured height is its top, whichever way the thumb
faces, so its centre is still 9 mm under it. The dots are matched along the
camera's line of sight (thumb.rest.dot_sightlines), at their fitted height. Usage: thumb_cmc.py left-hand.json (rewritten in place)."""
import json, sys, numpy as np
from scipy.optimize import least_squares

path = sys.argv[1]
m = json.load(open(path))
th = m['thumb']
L1, L2, END = th['segment_mm']['mcp_ip'], th['segment_mm']['ip_pad'], th['segment_mm']['ip_end']
PAD = 8.0          # the pad below the distal axis, mm (and its round edges' radius)
PAD_W = 22.0       # the last section across, mm: an estimate, not measured
DOT = {'mcp': 9.0, 'ip': 7.0}  # the knuckles' skin dots out from the joints, mm (as export.py)
EDGE = PAD_W / 2 - PAD
LM, LM_SD = 46.0, 5.0
MCP, IP = np.array(th['rest']['joints']['mcp']), np.array(th['rest']['joints']['ip'])
SEEN = {k: (np.array(v['on_paper'][:2]), np.array(v['per_mm_up'])) for k, v in th['rest']['dot_sightlines'].items()}
seen = lambda k, p: p[:2] - (SEEN[k][0] + p[2] * SEEN[k][1])   # off the line of sight, in plan
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

def lowest(a, u, side):
    """The lowest point of the last section's cross-section at `a` on the bone
    (u along it, side across it): a stadium, the bone's line EDGE either side,
    swept PAD round. Flat on the paper (side level), its middle."""
    g = np.array([0, 0, -1.0]) - u * -u[2]
    g /= np.linalg.norm(g)
    return a + EDGE * np.clip(g @ side / 0.05, -1, 1) * side + PAD * g

def dots(C, lm, q):
    """The MCP and IP skin dots: out from each joint on the back of the thumb,
    square to it (halfway between the bones either side)."""
    yaw, pitch, roll, b1, b2 = q
    Rq = R(yaw, pitch, roll)
    up = lambda a: Rq @ np.array([np.sin(np.radians(a)), np.cos(np.radians(a)), 0])
    M, I, _ = chain(C, lm, q)
    return M + DOT['mcp'] * up(b1 / 2), I + DOT['ip'] * up(b1 + b2 / 2)

def chain(C, lm, q, s=None):
    """Joint centres and the last section's lowest point `s` mm past the IP
    (default: the print's place, L2) for pose q = (yaw, pitch, roll, mcp, ip)
    in degrees. Local frame: x along the metacarpal, y toward the back of the
    thumb (the nail); bending turns toward -y."""
    yaw, pitch, roll, b1, b2 = q
    Rq = R(yaw, pitch, roll)
    def d(a):
        a = np.radians(a); return Rq @ np.array([np.cos(a), -np.sin(a), 0])
    def up(a):
        a = np.radians(a); return Rq @ np.array([np.sin(a), np.cos(a), 0])
    M = C + lm * d(0)
    I = M + L1 * d(b1)
    u = d(b1 + b2)
    P = lowest(I + (L2 if s is None else s) * u, u, np.cross(u, up(b1 + b2)))
    return M, I, P

def unpack(x):
    return x[:3], x[3], {k: x[4 + 5 * i: 9 + 5 * i] for i, k in enumerate(KEYS)}

def residuals(x):
    C, lm, Q = unpack(x)
    r = []
    for k in KEYS:
        M, I, P = chain(C, lm, Q[k])
        r += list((P - prints[k]) / 0.5)                                 # each print, to 0.5 mm
        # The thumb above the paper: the knuckles' centres at least PAD up, the
        # last section's lowest point at the IP and where its end rounds off no
        # lower than the print (a mm into the skin allowed).
        r += [min(0, M[2] - PAD) / 0.5, min(0, I[2] - PAD) / 0.5]
        r += [min(0, chain(C, lm, Q[k], s)[2][2] + 1) / 0.5 for s in (0, END - PAD)]
    M, I, _ = chain(C, lm, Q['1'])                                       # print 1 is the resting pose
    dM, dI = dots(C, lm, Q['1'])                                         # the dots, seen from above
    r += list(seen('mcp', dM) / 3) + list(seen('ip', dI) / 3)
    r += [(M[2] - MCP[2]) / 6, (lm - LM) / LM_SD, (Q['1'][3] - MCP_REST) / MCP_REST_SD]
    r += list((C - CMC0) / CMC_SD)
    for k in KEYS[1:]:                                                   # least movement from rest
        r += list((Q[k] - Q['1']) / np.array([30, 30, 30, 30, 30]))
    return np.array(r)

# Start: metacarpal reaching back and down from the resting MCP toward the wrist.
d0 = MCP - (MCP + np.array([10, -40, -18]))
yaw0 = np.degrees(np.arctan2(d0[1], d0[0])); pitch0 = -np.degrees(np.arcsin(d0[2] / np.linalg.norm(d0)))
lo = np.r_[[-np.inf] * 3, 30, np.tile([-np.inf, -np.inf, -np.inf, -15, -20], len(KEYS))]
hi = np.r_[[np.inf] * 3, 60, np.tile([np.inf, np.inf, np.inf, 70, 85], len(KEYS))]
# Nothing in the prints sets how far the thumb is turned about its metacarpal,
# so start from several turns and keep the best fit.
fits = [least_squares(residuals, np.r_[MCP + np.array([10, -40, -18]), LM,
                                       np.tile([yaw0, pitch0, r0, 10, 10], len(KEYS))], bounds=(lo, hi))
        for r0 in (-90, -45, 0, 45, 90)]
for f in fits:
    print('start roll', round(float(f.x[6]), 1), 'cost', round(float(f.cost), 2), file=sys.stderr)
fit = min(fits, key=lambda f: f.cost)
C, lm, Q = unpack(fit.x)
misses = {k: round(float(np.linalg.norm(chain(C, lm, Q[k])[2] - prints[k])), 1) for k in KEYS}
M, I, _ = chain(C, lm, Q['1'])
r1 = lambda v: [round(float(a), 1) for a in v]
th['assumed_cmc'] = {
    'note': 'Not measured. Fitted so the thumb reaches all five prints, assuming a ball joint at the base, '
            'typical anatomy (a 46 mm metacarpal, the CMC about 60 mm behind the index knuckle) and the least joint movement from rest. '
            'Each print is the last section\'s lowest point, the thumb above the paper; the knuckle dots on the back of the thumb, along the camera\'s line of sight. '
            'Angles in degrees; bending is + toward the pad.',
    'cmc': r1(C),
    'metacarpal_mm': round(float(lm), 1),
    'pad_below_distal_axis_mm': PAD,
    'pad_width_mm': PAD_W,
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
