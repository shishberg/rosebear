"""Run grid2.find on an image rotated by theta degrees, then map points back."""
import sys, json, numpy as np
from PIL import Image
import grid2
f, cx, cy, pitch, theta, out = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5]), sys.argv[6]
im = Image.open(f).convert('RGB')
W, H = im.size
t = np.radians(theta)
# rotated q -> original p : p = c + M (q - c), M rotates by +theta (image coords, y down)
M = np.array([[np.cos(t), -np.sin(t)], [np.sin(t), np.cos(t)]])
c = np.array([W/2, H/2])
off = c - M @ c
rot = im.transform((W, H), Image.AFFINE, (M[0,0], M[0,1], off[0], M[1,0], M[1,1], off[1]), resample=Image.BICUBIC, fillcolor=(0,0,0))
rot.save('rot_tmp.png')
qc = np.linalg.solve(M, np.array([cx, cy]) - off)
pts = grid2.find('rot_tmp.png', tuple(qc), pitch)
import os; os.remove('rot_tmp.png')
back = {k: M @ v + off for k, v in pts.items()}
print(f.split('/')[-1], 'points', len(pts), 'i', min(k[0] for k in pts), 'j', max(k[1] for k in pts))
json.dump({'pts': [[k[0], k[1], float(v[0]), float(v[1])] for k, v in back.items()]}, open(out, 'w'))
