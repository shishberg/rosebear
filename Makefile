board: rosebear.yaml
	npx ergogen rosebear.yaml -o output

v2: v2/config.yaml v2/footprints/*.js
	npx ergogen v2 -o output_v2

v3:
	cd v3 && baml run build

v3-leds:
	cd v3 && baml run build_leds

v3-test:
	cd v3 && baml test

.PHONY: v3 v3-leds v3-test
