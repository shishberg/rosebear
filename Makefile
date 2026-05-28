board: rosebear.yaml
	npx ergogen rosebear.yaml -o output

v2: v2/config.yaml v2/footprints/*.js
	npx ergogen v2 -o output_v2
