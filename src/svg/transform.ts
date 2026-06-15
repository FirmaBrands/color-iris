/** 2D affine transforms: [a, b, c, d, e, f] == matrix(a,b,c,d,e,f). */

export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

/** Returns m ∘ n (n is applied to the point first, then m). */
export function matMultiply(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function matApply(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Average scale factor (used to scale radii under non-uniform transforms). */
export function matScaleFactor(m: Mat): number {
  const det = m[0] * m[3] - m[1] * m[2];
  return Math.sqrt(Math.abs(det)) || 1;
}

/** Parses an SVG transform list ("translate(..) rotate(..) ...") into one matrix. */
export function parseTransform(str: string | null | undefined): Mat {
  let m: Mat = IDENTITY;
  if (!str) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(str)) !== null) {
    const name = match[1];
    const args = match[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let t: Mat = IDENTITY;
    if (name === "matrix" && args.length === 6) {
      t = [args[0], args[1], args[2], args[3], args[4], args[5]];
    } else if (name === "translate") {
      t = [1, 0, 0, 1, args[0] || 0, args[1] || 0];
    } else if (name === "scale") {
      const sx = args.length > 0 ? args[0] : 1;
      const sy = args.length > 1 ? args[1] : sx;
      t = [sx, 0, 0, sy, 0, 0];
    } else if (name === "rotate") {
      const a = ((args[0] || 0) * Math.PI) / 180;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      t = [cos, sin, -sin, cos, 0, 0];
      if (args.length === 3) {
        const [, cx, cy] = args;
        t = matMultiply(matMultiply([1, 0, 0, 1, cx, cy], t), [1, 0, 0, 1, -cx, -cy]);
      }
    } else if (name === "skewX") {
      t = [1, 0, Math.tan(((args[0] || 0) * Math.PI) / 180), 1, 0, 0];
    } else if (name === "skewY") {
      t = [1, Math.tan(((args[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
    }
    // Transform lists apply left-to-right: combined = first ∘ second ∘ ...
    m = matMultiply(m, t);
  }
  return m;
}
