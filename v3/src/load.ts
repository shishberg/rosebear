import { readFile } from "node:fs/promises";
import { load as parseYaml } from "js-yaml";
import ergogen from "ergogen";
import { PointsSchema, type Points } from "./points.js";

export type LoadResult = {
  readonly points: Points;
  readonly ergogenVersion: string;
};

/**
 * Run ergogen as a library and return validated points.
 *
 * Two deliberate choices:
 *  - `debug: true` is what makes ergogen populate `results.points`.
 *  - The config's `pcbs` section is stripped before processing. v3 generates
 *    the PCB itself, and leaving `pcbs` in would make this depend on ergogen's
 *    custom footprint plugins (which we no longer use) just to reach the
 *    points, failing on any footprint ergogen doesn't recognise.
 */
export async function loadPoints(configPath: string): Promise<LoadResult> {
  const text = await readFile(configPath, "utf8");
  const config = parseYaml(text);

  if (config === null || typeof config !== "object") {
    throw new Error(`${configPath} did not parse to a YAML mapping`);
  }
  const { pcbs: _discarded, ...pointsOnly } = config as Record<string, unknown>;

  const results = await ergogen.process(pointsOnly, true, () => {});
  if (results.points === undefined) {
    throw new Error(`ergogen produced no points for ${configPath}`);
  }

  const parsed = PointsSchema.safeParse(results.points);
  if (!parsed.success) {
    throw new Error(
      `ergogen points failed validation:\n` +
        parsed.error.issues
          .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("\n"),
    );
  }
  return { points: parsed.data, ergogenVersion: ergogen.version };
}
