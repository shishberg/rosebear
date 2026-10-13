#!/bin/sh
# Rebuild the hand model from the photos into v4/hand/left-hand.json.
# Needs Python 3 with numpy, pillow and scipy (set PYTHON to use a venv).
# PHOTOS is the directory holding the kb-*.jpg photos (default: the repo root).
# Overlays and intermediate files go to output_v4/hand/.
set -e
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../../.." && pwd)
: "${PHOTOS:=$repo}"
: "${PYTHON:=python3}"
export PHOTOS PYTHONPATH="$here"
out="$repo/output_v4/hand"
mkdir -p "$out"
cd "$out"

# Grid seeds: the grid's bottom-right corner in pixels and the pitch in pixels.
"$PYTHON" "$here/grid2.py" "$PHOTOS/kb-sheet-a.jpg" 2974 3702 72 g_sa.json
"$PYTHON" "$here/grid2.py" "$PHOTOS/kb-sheet-b.jpg" 2798 3620 67 g_sb.json
SATMAX=70 "$PYTHON" "$here/grid2.py" "$PHOTOS/kb-hand-a.jpg" 1362 1945 34 g_ha.json
SATMAX=70 "$PYTHON" "$here/grid2.py" "$PHOTOS/kb-hand-b.jpg" 1350 1043 33 g_hb.json
SATMAX=70 "$PYTHON" "$here/grid2.py" "$PHOTOS/kb-uncropped-a.jpg" 2238 2370 35 g_ua.json
# The sheet is turned about 17 degrees in this one; straighten it before detecting.
SATMAX=70 "$PYTHON" "$here/grid_rot.py" "$PHOTOS/kb-uncropped-b.jpg" 3090 1472 33 17 g_ub.json

"$PYTHON" "$here/measure.py"
"$PYTHON" "$here/cam2.py"
"$PYTHON" "$here/export.py" > "$repo/v4/hand/left-hand.json"
echo "wrote v4/hand/left-hand.json; overlays in output_v4/hand/"
