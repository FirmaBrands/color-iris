declare module "svg-path-bounds" {
  /** Returns [minX, minY, maxX, maxY] for an SVG path data string. */
  export default function getBounds(d: string): [number, number, number, number];
}
