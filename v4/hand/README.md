# Hand model

A measured model of the left hand, to narrow down where the finger and thumb keys can go. The halves are printed as mirror images, so it serves both. [`left-hand.json`](left-hand.json) holds the model.

## Coordinates

The model uses the editor's layout axes, so the left hand reads directly as the right half's layout:

- origin at the middle fingertip's resting print
- +X toward the pinky
- +Y away from you, along the mean finger direction
- +Z up from the surface the fingertips rest on
- millimetres and degrees

## What it holds

**Measured on the surface (within about 1–2 mm):**

| | X | Y |
| --- | ---: | ---: |
| index fingertip | −20.8 | −4.7 |
| middle fingertip | 0 | 0 |
| ring fingertip | 21.0 | −10.0 |
| pinky fingertip | 40.2 | −27.5 |
| thumb 1, rest | −45.2 | −55.1 |
| thumb 2, swept in toward the index | −29.3 | −53.4 |
| thumb 3, swept out, away from the palm | −62.8 | −70.2 |
| thumb 4, pulled back toward you | −74.0 | −90.5 |
| thumb 5, curled in under the hand | −44.0 | −80.5 |

- The fingertips rest 21, 23 and 26 mm apart, index to pinky.
- Thumb positions 1–4 lie on a circle of radius 47 mm centred at (−27, −100), within 1.1 mm.

**Segment lengths, joint to joint, from the flat hand:**

| | MCP–PIP | PIP–DIP | DIP–pad |
| --- | ---: | ---: | ---: |
| index | 42.5 | 26.5 | 15.0 |
| middle | 50.1 | 29.5 | 15.7 |
| ring | 45.5 | 28.0 | 15.8 |
| pinky | 31.2 | 21.2 | 14.6 |

The thumb measures 35.0 mm from MCP to IP, 17.5 mm from IP to the pad's print and 25.9 mm from IP to its end (where the traced outline round its tip reaches furthest along the thumb).

**Resting pose in 3D (model-based):** the joint centres, segment pitches and PIP/DIP flexion of each finger. The thumb's MCP and IP joint centres at rest are also given. The fit misses the knuckle dots by 1.7 mm on average, and 4.7 mm at most.

The heights depend on your measured 80 mm middle-knuckle height and 45 mm thumb-knuckle height. The camera, about 80 cm up, barely sees height, so without those two measurements the pose is ambiguous.

The knuckle tops come out at 71, 80, 71 and 53 mm above the surface, index to pinky.

**Not in the model:**
- **MCP flexion:** the back-of-hand angle is poorly determined.
- **A measured thumb base joint (CMC):** the procedure needed a photo of the thumb's knuckles at each of the five positions, and there is only the one at rest. The tip prints alone can't place it, because the thumb bends differently at each. `thumb.assumed_cmc` gives an assumed one instead (`thumb_cmc.py`): typical anatomy, about 65 mm behind the index knuckle, nudged so the thumb reaches all five prints (within 0.4 mm) with the least joint movement. Each print is where the last section is lowest, with the whole thumb above the paper. The knuckle dots are matched along the camera's line of sight, on the back of the thumb, which faces the camera there (within 70° of its line of sight; without that the fit turned the dots away from the camera and tipped the nail toward the paper). That lays the resting thumb on its side, the pad facing the index, and puts the resting thumb knuckle about 8 mm lower than measured.
- **Reach to the top and bottom rows:** where you put your finger for those keys is a matter of preference, which the anatomy doesn't settle.

All measurements are on a flat surface, with no tenting.

## How it was measured

The measurements use 5 mm grid paper, which the ruler showed printed 0.5% small, so the scripts use a 4.975 mm pitch.

The knuckles were dotted on the skin with a marker, and the fingertip and thumb pads were inked so they printed where they touched. There were two poses:

- **A:** the hand flat, traced.
- **B:** resting in a typing curl with the fingertips on the paper, then five thumb positions with the fingers held still.

Each pose was photographed from above with the hand in place, and again without it. The knuckle heights were measured with a ruler.

## Rebuilding

The scripts:

1. Find the grid in each photo.
2. Map the dots and prints to sheet millimetres.
3. Recover each hand photo's camera pose from the uncropped original (2× zoom).
4. Correct each dot for its height above the paper.
5. Fit a joint chain per finger: lengths from pose A, and the pose from the pose-B dots and prints.

```sh
PHOTOS=/path/to/photos PYTHON=/path/to/venv/bin/python v4/hand/tools/run.sh
```

`run.sh` needs Python 3 with numpy, pillow and scipy. It writes `left-hand.json`, and puts the grid-check overlays in `output_v4/hand/`.

The photos (`kb-sheet-a.jpg`, `kb-sheet-b.jpg`, `kb-hand-a.jpg`, `kb-hand-b.jpg`, `kb-uncropped-a.jpg`, `kb-uncropped-b.jpg`) aren't in the repo. `PHOTOS` defaults to the repo root.

The grid seeds in `run.sh` (the corner pixel and pitch for each photo) and the dot labels in `measure.py` are specific to these photos.
