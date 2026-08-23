import { loadPoints } from "./load.js";

const { points } = await loadPoints(process.argv[2] ?? "v2/config.yaml");
for (const [name, p] of Object.entries(points)) {
  console.log(`${name}\t${p.x}\t${p.y}\t${p.r}`);
}
