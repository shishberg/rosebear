board: rosebear.yaml
	npx ergogen rosebear.yaml -o output

v2: v2/config.yaml v2/footprints/*.js
	npx ergogen v2 -o output_v2

v3:
	cd v3 && baml run build

v3-test:
	cd v3 && baml test

.PHONY: v3 v3-test

# Chassis-aligned matrix pipeline; legacy targets above remain available.
v4:
	v4/run

v4-test:
	"$${KICAD_PYTHON:-/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/Current/bin/python3}" v4/tools/test.py

v4-benchmark:
	v4/run --reuse-geometry --router freerouting --board finger_l

.PHONY: v4 v4-test v4-benchmark

# Individual handwired key-tile chassis; does not run PCB routing.
v4-chassis:
	"$${KICAD_PYTHON:-/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/Current/bin/python3}" v4/tools/build_chassis.py --foundation

v4-chassis-test:
	"$${KICAD_PYTHON:-/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/Current/bin/python3}" v4/tools/build_chassis.py --foundation-test

.PHONY: v4-chassis v4-chassis-test

# Live browser chassis editor; KiCad stays in the offline v4 pipeline.
v4-editor:
	npm --prefix v4/editor run dev -- --port 5177 --strictPort

v4-editor-test:
	npm --prefix v4/editor test

.PHONY: v4-editor v4-editor-test
