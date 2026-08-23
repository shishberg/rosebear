import { loadPoints } from "./load.js";

const configPath = process.argv[2];
if (configPath === undefined) {
  console.error("usage: dump.ts <ergogen-config>");
  process.exit(1);
}
const { points, ergogenVersion } = await loadPoints(configPath);
console.log(`ergogen ${ergogenVersion}, ${Object.keys(points).length} points\n`);
for (const [name, p] of Object.entries(points)) {
  const m = p.meta;
  console.log(
    `${name.padEnd(28)} x=${p.x.toFixed(2).padStart(8)} y=${p.y.toFixed(2).padStart(8)} r=${String(p.r).padStart(6)}  ` +
      `mir=${String(m.mirrored).padEnd(5)} col=${m.col_net ?? "-"} row=${m.row_net ?? "-"} din=${m.led_in ?? "-"} dout=${m.led_out ?? "-"}`,
  );
}
