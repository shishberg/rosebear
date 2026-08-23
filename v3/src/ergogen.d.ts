declare module "ergogen" {
  /** Ergogen 4.x is untyped CommonJS. This declares only the surface we use. */
  export const version: string;
  export function process(
    raw: unknown,
    debug: boolean,
    logger: (msg: string) => void,
  ): Promise<{ points?: Record<string, unknown> }>;
}
