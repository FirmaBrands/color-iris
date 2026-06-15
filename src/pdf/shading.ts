/**
 * DeviceCMYK gradient shadings for pdf-lib.
 *
 * Gradients are encoded as native PDF Type 2/3 (axial/radial) shadings with
 * stitching functions, so stop offsets are preserved exactly and the output
 * stays fully vector in DeviceCMYK.
 */
import { PDFDocument, PDFName } from "pdf-lib";
import type { CMYK, Stop } from "../types";

const comps = (c: CMYK) => [c.c / 100, c.m / 100, c.y / 100, c.k / 100];

/**
 * Builds a PDF function interpolating the given stops across [0, 1].
 * Equal adjacent offsets express hard stops.
 */
export function createGradientFunction(pdfDoc: PDFDocument, stops: Stop[]) {
  const ctx = (pdfDoc as any).context;
  const constantFn = (c: CMYK) =>
    ctx.register(
      ctx.obj({ FunctionType: 2, Domain: [0, 1], C0: comps(c), C1: comps(c), N: 1 }),
    );

  if (stops.length === 0) return constantFn({ c: 0, m: 0, y: 0, k: 0 });
  if (stops.length === 1) return constantFn(stops[0].cmyk);

  // Sanitize: clamp, sort-preserve (non-decreasing), pad to cover [0, 1].
  let list = stops.map((s) => ({
    cmyk: s.cmyk,
    offset: Math.min(1, Math.max(0, isFinite(s.offset) ? s.offset : 0)),
  }));
  for (let i = 1; i < list.length; i++) {
    if (list[i].offset < list[i - 1].offset) list[i].offset = list[i - 1].offset;
  }
  if (list[0].offset > 0) list = [{ ...list[0], offset: 0 }, ...list];
  if (list[list.length - 1].offset < 1) {
    list = [...list, { ...list[list.length - 1], offset: 1 }];
  }

  // Non-degenerate segments only.
  const segs: { c0: CMYK; c1: CMYK; end: number }[] = [];
  for (let i = 0; i < list.length - 1; i++) {
    if (list[i + 1].offset - list[i].offset < 1e-6) continue;
    segs.push({ c0: list[i].cmyk, c1: list[i + 1].cmyk, end: list[i + 1].offset });
  }
  if (segs.length === 0) return constantFn(list[0].cmyk);
  if (segs.length === 1) {
    const s = segs[0];
    return ctx.register(
      ctx.obj({ FunctionType: 2, Domain: [0, 1], C0: comps(s.c0), C1: comps(s.c1), N: 1 }),
    );
  }

  const funcs = segs.map((s) =>
    ctx.register(
      ctx.obj({ FunctionType: 2, Domain: [0, 1], C0: comps(s.c0), C1: comps(s.c1), N: 1 }),
    ),
  );
  const bounds = segs.slice(0, -1).map((s) => s.end);
  const encode: number[] = [];
  for (let i = 0; i < segs.length; i++) encode.push(0, 1);

  return ctx.register(
    ctx.obj({
      FunctionType: 3,
      Domain: [0, 1],
      Functions: funcs,
      Bounds: bounds,
      Encode: encode,
    }),
  );
}

let shadingCounter = 0;

/**
 * Registers an axial/radial DeviceCMYK shading in the page's resources and
 * returns its resource name (for the `sh` operator).
 *
 * `coords`: linear → [x1, y1, x2, y2]; radial → [fx, fy, cx, cy, r].
 */
export function registerShading(
  pdfDoc: PDFDocument,
  page: any,
  type: "linear" | "radial",
  coords: number[],
  stops: Stop[],
): string {
  const ctx = (pdfDoc as any).context;
  const fn = createGradientFunction(pdfDoc, stops);
  const pdfCoords =
    type === "radial"
      ? [coords[0], coords[1], 0, coords[2], coords[3], coords[4]]
      : coords;
  const shadingRef = ctx.register(
    ctx.obj({
      ShadingType: type === "radial" ? 3 : 2,
      ColorSpace: PDFName.of("DeviceCMYK"),
      Coords: pdfCoords,
      Domain: [0, 1],
      Function: fn,
      Extend: [true, true],
    }),
  );

  let resources = page.node.Resources();
  if (!resources) {
    resources = ctx.obj({});
    page.node.set(PDFName.of("Resources"), resources);
  }
  if (!resources.has(PDFName.of("Shading"))) {
    resources.set(PDFName.of("Shading"), ctx.obj({}));
  }
  const name = `SH${++shadingCounter}`;
  resources.get(PDFName.of("Shading")).set(PDFName.of(name), shadingRef);
  return name;
}
