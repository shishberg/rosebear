"""Write the hand model (left-hand.json) from the measured points and the pose-B solve.

Hand frame (matches the editor's layout axes, so the left hand reads as the right
half's layout): origin at the middle fingertip's resting print, +X toward the
pinky, +Y away from you along the mean finger direction, +Z up from the surface
the fingertips rest on. Millimetres and degrees."""
import json, sys, numpy as np
from scipy.optimize import least_squares
import solve as S

q = least_squares(S.residuals, S.init(), args=(True,))
ph0, C = S.unpack(q.x)
par = {f: q.x[1 + 7 * i: 8 + 7 * i] for i, f in enumerate(S.FINGERS)}

psi = np.mean([par[f][3] for f in S.FINGERS])
Y = np.array([np.cos(psi), np.sin(psi), 0])
X = np.array([-np.sin(psi), np.cos(psi), 0])          # left hand: the pinky is anticlockwise of the fingers' heading (so the frame is mirrored)
origin = S.tipB['middle'] * [1, 1, 0]
def to(p):
    d = np.asarray(p, float) - origin
    return [round(float(d @ X), 1), round(float(d @ Y), 1), round(float(d[2]), 1)]
assert to(S.tipB['pinky'])[0] > 0

fingers = {}
for f in S.FINGERS:
    p, c, L = par[f], C[f], S.L[f]
    pitch = np.degrees(p[4:7])
    fingers[f] = {
        'segment_mm': {'mcp_pip': round(L['b1'], 1), 'pip_dip': round(L['b2'], 1), 'dip_pad': round(L['b3'], 1)},
        'rest': {
            'pad': to(S.tipB[f]),
            'joints': {'mcp': to(c['J0']), 'pip': to(c['J1']), 'dip': to(c['J2'])},
            'segment_pitch_deg': [round(float(a), 0) for a in pitch],
            'flexion_deg': {'pip': round(float(pitch[1] - pitch[0]), 0), 'dip': round(float(pitch[2] - pitch[1]), 0)},
            'heading_deg': round(float(np.degrees(p[3] - psi)), 1),
        },
    }

# thumb: lengths from pose A, rest joints from pose B (MCP from the measured 45 mm knuckle height)
JM_A = S.CA.at_height(S.imgA['thumb MCP'], 20) - [0, 0, 10]
JI_A = S.CA.at_height(S.imgA['thumb IP'], 16) - [0, 0, 8]
b1 = np.linalg.norm(JM_A - JI_A)
b2 = np.linalg.norm((JI_A - S.tipA['thumb'])[:2])
JM = S.CB.at_height(S.imgB['thumb MCP'], 45) - [0, 0, 9]
zs = np.linspace(7, 90, 400)
miss = [abs(np.linalg.norm(S.CB.at_height(S.imgB['thumb IP'], z) - [0, 0, 7] - JM) - b1) for z in zs]
JI = S.CB.at_height(S.imgB['thumb IP'], zs[int(np.argmin(miss))]) - [0, 0, 7]
prints = {str(k): to(v) for k, v in sorted(S.thumbB.items())}
P = np.array([to(S.thumbB[k])[:2] for k in (2, 1, 3, 4)])
arc = least_squares(lambda c: np.hypot(*(P - c[:2]).T) - c[2], np.r_[P.mean(0) + [20, -20], 50])

model = {
    'hand': 'left',
    'frame': __doc__.split('\n\n')[1].replace('\n', ' '),
    'measured': {
        'fingertip_rest': {f: to(S.tipB[f]) for f in S.FINGERS},
        'thumb_prints': prints,
        'thumb_prints_key': {'1': 'rest', '2': 'swept in, toward the index', '3': 'swept out, away from the palm',
                             '4': 'pulled back, toward you', '5': 'curled in, under the hand'},
        'mcp_knuckle_height_mm': {'middle': 80, 'thumb': 45},
        'accuracy': 'Positions on the surface (fingertip_rest, thumb_prints) are within about 1-2 mm.',
    },
    'fingers': fingers,
    'thumb': {
        'segment_mm': {'mcp_ip': round(float(b1), 1), 'ip_pad': round(float(b2), 1)},
        'rest': {'pad': prints['1'], 'joints': {'mcp': to(JM), 'ip': to(JI)}},
        'arc_through_prints_1_to_4': {'centre': [round(float(v), 1) for v in arc.x[:2]], 'radius_mm': round(float(arc.x[2]), 1),
                                      'misses_mm': [round(float(v), 1) for v in arc.fun]},
        'cmc': 'Not measured: the photos show the thumb knuckles at rest only. See assumed_cmc.',
    },
    'fit': {
        'pose_b_rms_mm': round(float(np.sqrt(np.mean(q.fun ** 2))), 2),
        'pose_b_max_mm': round(float(np.abs(q.fun).max()), 2),
    },
    'assumptions': {
        'skin_dot_above_joint_axis_mm': S.RD, 'pad_below_distal_axis_mm': S.PAD, 'size_scale': S.SCALE,
        'pose_a_dot_height': 'twice the dot offset (the joint axis is as far above the paper as the dot is above the axis)',
        'grid_pitch_mm': 4.975,
        'note': 'Rest-pose heights rest on the 80 mm middle knuckle measurement: the camera, about 80 cm above the paper, '
                'barely sees height. MCP flexion is not given because the back-of-hand angle is poorly determined.',
    },
}
json.dump(model, sys.stdout, indent=1)
print()
