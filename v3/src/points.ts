import { z } from "zod";

/**
 * Schema for a single ergogen point. Ergogen emits far more `meta` than we
 * consume; we validate the fields we depend on and pass the rest through.
 *
 * Net fields (col_net/row_net/led_in/led_out) are per-key values declared in
 * the ergogen config, so they are optional here -- a config that omits them is
 * valid ergogen, just not routable by us. `assertRoutable` enforces that later,
 * where we can give a useful error.
 */
export const PointMetaSchema = z.looseObject({
  name: z.string(),
  colrow: z.string(),
  /** Ergogen sets this only on mirrored points; absent means the source half. */
  mirrored: z.boolean().default(false),
  col_net: z.string().optional(),
  row_net: z.string().optional(),
  led_in: z.string().optional(),
  led_out: z.string().optional(),
});

export const PointSchema = z.object({
  x: z.number(),
  y: z.number(),
  r: z.number(),
  meta: PointMetaSchema,
});

export const PointsSchema = z.record(z.string(), PointSchema);

export type PointMeta = z.infer<typeof PointMetaSchema>;
export type Point = z.infer<typeof PointSchema>;
export type Points = z.infer<typeof PointsSchema>;
