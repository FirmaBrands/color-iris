/**
 * Renders an `Artwork` + `Coloring` to a concrete SVG string for on-screen
 * preview. Colors pass through the CMYK print simulation, so the preview
 * shows the same ink builds the PDF will contain.
 */
import type { Artwork, Coloring, Paint, Stop } from "../types";
import { DEFAULT_WASH_ANGLE } from "../types";
import { cmykToHex } from "../color/simulate";
import { resolveRef } from "../lib/coloring";

/**
 * Endpoints of a CSS-convention linear gradient (angle in degrees, 0 = up,
 * clockwise) across a box, in y-down coordinates. The line is centered and
 * sized so the first/last stops touch the box corners, like CSS.
 */
export function linearEndpoints(
  angle: number,
  x: number,
  y: number,
  w: number,
  h: number,
): [number, number, number, number] {
  const t = (angle * Math.PI) / 180;
  const dx = Math.sin(t);
  const dy = -Math.cos(t); // y-down: CSS 0deg points "up" (negative y)
  const half = (w * Math.abs(dx) + h * Math.abs(dy)) / 2;
  const cx = x + w / 2;
  const cy = y + h / 2;
  return [cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half];
}

let uidCounter = 0;

function stopsToSvg(stops: Stop[]): string {
  return stops
    .map(
      (s) =>
        `<stop offset="${Math.round(s.offset * 1000) / 10}%" stop-color="${cmykToHex(s.cmyk)}"/>`,
    )
    .join("");
}

/** Whole-artwork wash gradient definition in viewBox (user-space) coords. */
function washDef(paint: Paint, id: string, vb: Artwork["viewBox"]): string {
  if (paint.kind === "solid") return "";
  if (paint.kind === "linear") {
    const [x1, y1, x2, y2] = linearEndpoints(
      paint.angle ?? DEFAULT_WASH_ANGLE,
      vb.x, vb.y, vb.w, vb.h,
    );
    return (
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
      `x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">` +
      stopsToSvg(paint.stops) +
      `</linearGradient>`
    );
  }
  const cx = vb.x + vb.w / 2;
  const cy = vb.y + vb.h / 2;
  const r = Math.sqrt(vb.w * vb.w + vb.h * vb.h) / 2;
  return (
    `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
    `cx="${cx}" cy="${cy}" r="${r}">` +
    stopsToSvg(paint.stops) +
    `</radialGradient>`
  );
}

export function renderArtworkSvg(
  artwork: Artwork,
  coloring: Coloring,
  opts: { preserveAspectRatio?: string } = {},
): string {
  const { viewBox: vb } = artwork;
  const uid = `ci${(uidCounter = (uidCounter + 1) % 1_000_000)}`;
  const defs: string[] = [];
  const body: string[] = [];

  let washFill: string | null = null;
  if (coloring.wash) {
    if (coloring.wash.kind === "solid") {
      washFill = cmykToHex(coloring.wash.cmyk);
    } else {
      const id = `${uid}-wash`;
      defs.push(washDef(coloring.wash, id, vb));
      washFill = `url(#${id})`;
    }
  }

  artwork.paths.forEach((path, i) => {
    let fill: string;
    if (washFill) {
      fill = washFill;
    } else if (path.fill.kind === "ref") {
      fill = cmykToHex(resolveRef(path.fill.ref, coloring.slots));
    } else {
      const g = path.fill.gradient;
      const id = `${uid}-g${i}`;
      const stops = g.stops
        .map(
          (s) =>
            `<stop offset="${Math.round(s.offset * 1000) / 10}%" ` +
            `stop-color="${cmykToHex(resolveRef(s.ref, coloring.slots))}"/>`,
        )
        .join("");
      if (g.type === "linear") {
        const [x1, y1, x2, y2] = g.coords;
        defs.push(
          `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
            `x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops}</linearGradient>`,
        );
      } else {
        const [fx, fy, cx, cy, r] = g.coords;
        defs.push(
          `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
            `cx="${cx}" cy="${cy}" r="${r}" fx="${fx}" fy="${fy}">${stops}</radialGradient>`,
        );
      }
      fill = `url(#${id})`;
    }
    body.push(`<path d="${path.d.replace(/"/g, "'")}" fill="${fill}"/>`);
  });

  const par = opts.preserveAspectRatio ?? "xMidYMid meet";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" ` +
    `preserveAspectRatio="${par}" width="100%" height="100%" ` +
    `style="display:block;max-width:100%;max-height:100%">` +
    (defs.length ? `<defs>${defs.join("")}</defs>` : "") +
    body.join("") +
    `</svg>`
  );
}
