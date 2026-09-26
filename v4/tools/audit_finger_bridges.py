"""Report bridge lengths and imposed rotations; this is NOT a stress model."""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def audit(chassis, geometry):
    keys = {k['id']: k for k in chassis['keys']}
    columns = {c['name']: c for c in geometry['well']['columns']}
    strips = geometry['fingers'][0]['strips']
    result = []
    for a, b in zip(strips, strips[1:]):
        # Exported axes are basis vectors, i.e. matrix columns. A^T B
        # expresses the relative orientation in the first key's frame.
        A = keys['matrix_' + a['column'] + '_bottom']['axes']
        B = keys['matrix_' + b['column'] + '_bottom']['axes']
        R = [[sum(x*y for x, y in zip(u, v)) for v in B] for u in A]
        angle = math.acos(max(-1, min(1, (sum(R[i][i] for i in range(3))-1)/2)))
        axis = ([0, 0, 0] if abs(angle) < 1e-10 else
                [(R[2][1]-R[1][2])/(2*math.sin(angle)),
                 (R[0][2]-R[2][0])/(2*math.sin(angle)),
                 (R[1][0]-R[0][1])/(2*math.sin(angle))])
        span = b['cx']-b['half_w']-(a['cx']+a['half_w'])
        arc = 2*math.pi*span/4
        straight = max(0, a['neck_len']-arc, abs(b['neck_y']-a['neck_y']))
        result.append(dict(bridge=a['column']+' → '+b['column'],
            normal_step_mm=abs(columns[a['column']]['normal']-columns[b['column']]['normal']),
            target_length_mm=a['neck_len'], span_mm=span, arc_floor_mm=arc,
            centerline_length_mm=arc+straight, straight_leg_sum_mm=straight,
            relative_rotation_deg=math.degrees(angle), axis_in_first_bottom_key_frame=axis))
    return result


if __name__ == '__main__':
    result = audit(json.loads((ROOT/'v4/mechanical/chassis.json').read_text()),
                   json.loads((ROOT/'output_v4/geometry.json').read_text()))
    path = ROOT/'output_v4/finger-bridge-audit.json'
    path.write_text(json.dumps(result, indent=2)+'\n')
    print(path)
