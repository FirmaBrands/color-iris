/**
 * A3 landscape, DeviceCMYK, fully vector proof sheet.
 *
 * The proof is printed twice — once on the left half, once on the right —
 * with a separation line through the page center (compare side by side,
 * fold, or trim into two proofs). Each half carries the project name and
 * date. Every fill — including text — is DeviceCMYK; gradients are native
 * PDF shadings (see ./shading).
 *
 * Each logo group is an independent block: its own column headers (logo
 * profiles, with their CMYK builds), then its surface rows. Backgrounds are
 * per row. Cells with a spec override print their actual ink builds.
 */
import { cmyk, PDFDocument, PDFName, PDFOperator, StandardFonts } from "pdf-lib";
import type {
  Artwork,
  CellOverride,
  CMYK,
  Coloring,
  LogoGroup,
  Paint,
  Stop,
  Variation,
} from "../types";
import { DEFAULT_WASH_ANGLE } from "../types";
import { linearEndpoints } from "../svg/render";
import { tac, TAC_LIMIT } from "../color/convert";
import {
  coloringColors,
  effectiveColoring,
  formatCmyk,
  logoColoringForGroup,
  resolveRef,
} from "../lib/coloring";
import { registerShading } from "./shading";

// ---- page geometry (points) ------------------------------------------------
const PAGE_W = 1190.55; // A3 landscape
const PAGE_H = 841.89;
const MARGIN = 48;
const TITLE_H = 46;
const FOOTER_H = 8; // small bottom breathing room (no footer text)
const CENTER_GAP = 24; // breathing room around the center line
const HEADER_COL_W = 96;
const GROUP_LABEL_H = 15; // group name strip atop each block
const GROUP_HEADER_H = 62; // column-header band per block
const GROUP_GAP = 14; // gap between stacked group blocks

const INK_BLACK = cmyk(0, 0, 0, 1);
const INK_GRAY = cmyk(0, 0, 0, 0.55);
const INK_LIGHT = cmyk(0, 0, 0, 0.25);
const INK_WARN = cmyk(0, 0.45, 1, 0);
const INK_PAPER = cmyk(0, 0, 0, 0);
const INK_BAND = cmyk(0, 0, 0, 0.06);

const toCmyk = (c: CMYK) => cmyk(c.c / 100, c.m / 100, c.y / 100, c.k / 100);

export interface ProofInput {
  groups: LogoGroup[];
  projectName: string;
  /** Logo footprint as a fraction of the cell (matches the screen preview). */
  logoScale: number;
}

/** One group reduced to its enabled columns and rows for printing. */
interface Section {
  group: LogoGroup;
  cols: Variation[];
  rows: Variation[];
}

export async function generateProofPdf(input: ProofInput): Promise<Uint8Array> {
  const { groups, projectName } = input;
  const logoScale = Math.min(1, Math.max(0.2, input.logoScale || 0.64));

  // Each group is its own block; skip groups with no enabled column or row.
  const sections: Section[] = groups
    .map((group) => ({
      group,
      cols: group.logoVariations.filter((v) => v.enabled),
      rows: group.bgVariations.filter((v) => v.enabled),
    }))
    .filter((s) => s.cols.length > 0 && s.rows.length > 0);

  const pdfDoc = await PDFDocument.create();
  const name = projectName.trim() || "untitled";
  pdfDoc.setTitle(`${name} — CMYK proof sheet`);
  pdfDoc.setSubject("Vector logo CMYK reproduction proof (DeviceCMYK, A3)");
  pdfDoc.setAuthor("Color Iris");
  pdfDoc.setCreator("Color Iris proofing matrix");
  pdfDoc.setCreationDate(new Date());

  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  drawCropMarks(page);

  // Center separation line.
  page.drawLine({
    start: { x: PAGE_W / 2, y: MARGIN },
    end: { x: PAGE_W / 2, y: PAGE_H - MARGIN },
    thickness: 0.5,
    color: INK_GRAY,
  });

  if (sections.length === 0) {
    page.drawText("NO ACTIVE PROFILES / SURFACES", {
      x: MARGIN,
      y: PAGE_H / 2,
      size: 14,
      font: helvBold,
      color: INK_GRAY,
    });
    return pdfDoc.save();
  }

  // The same proof on both halves — each carries its own name + date so a
  // trimmed half is a complete, labelled proof.
  const date = new Date().toISOString().slice(0, 16).replace("T", " ");
  const halfW = (PAGE_W - 2 * MARGIN - CENTER_GAP) / 2;
  const halves = [MARGIN, PAGE_W / 2 + CENTER_GAP / 2];
  for (const x0 of halves) {
    drawSheet(pdfDoc, page, helv, helvBold, { x0, width: halfW, sections, logoScale, name, date });
  }

  return pdfDoc.save();
}

// ---------------------------------------------------------------------------
// One half-sheet — a vertical stack of group blocks
// ---------------------------------------------------------------------------

function drawSheet(
  pdfDoc: PDFDocument,
  page: any,
  helv: any,
  helvBold: any,
  opts: {
    x0: number;
    width: number;
    sections: Section[];
    logoScale: number;
    name: string;
    date: string;
  },
) {
  const { x0, width, sections, logoScale, name, date } = opts;

  drawHalfTitle(page, helv, helvBold, name, date, x0, width);

  const gridTop = PAGE_H - MARGIN - TITLE_H;
  const gridBottom = MARGIN + FOOTER_H;

  const totalRows = sections.reduce((n, s) => n + s.rows.length, 0);
  const nG = sections.length;
  const overhead = nG * (GROUP_LABEL_H + GROUP_HEADER_H) + (nG - 1) * GROUP_GAP;
  const cellH = Math.max(20, (gridTop - gridBottom - overhead) / Math.max(1, totalRows));

  let yTop = gridTop;
  for (const section of sections) {
    drawGroupBlock(pdfDoc, page, helv, helvBold, { x0, width, section, logoScale, yTop, cellH });
    yTop -= GROUP_LABEL_H + GROUP_HEADER_H + section.rows.length * cellH + GROUP_GAP;
  }
}

function drawGroupBlock(
  pdfDoc: PDFDocument,
  page: any,
  helv: any,
  helvBold: any,
  o: {
    x0: number;
    width: number;
    section: Section;
    logoScale: number;
    yTop: number;
    cellH: number;
  },
) {
  const { x0, width, section, logoScale, yTop, cellH } = o;
  const { group, cols, rows } = section;
  const gridLeft = x0 + HEADER_COL_W;
  const gridRight = x0 + width;
  const cellW = (gridRight - gridLeft) / cols.length;
  const overrides = group.overrides;

  // Group label strip across the block.
  const labelBottom = yTop - GROUP_LABEL_H;
  page.drawRectangle({
    x: x0, y: labelBottom, width: gridRight - x0, height: GROUP_LABEL_H, color: INK_BAND,
  });
  let label = group.name.toUpperCase();
  while (label.length > 1 && helvBold.widthOfTextAtSize(label, 7) > width - 12) {
    label = label.slice(0, -1);
  }
  page.drawText(label, {
    x: x0 + 5, y: labelBottom + (GROUP_LABEL_H - 7) / 2 + 0.5, size: 7, font: helvBold, color: INK_BLACK,
  });

  // Column headers: this group's logo profiles (name + swatches + CMYK builds).
  const headerTop = labelBottom;
  cols.forEach((col, ci) => {
    drawHeader(page, helv, helvBold, col, {
      x: gridLeft + ci * cellW + 5,
      yTop: headerTop - 11,
      maxW: cellW - 10,
    });
  });

  const cellTop = headerTop - GROUP_HEADER_H;

  let yCursor = cellTop;
  for (const row of rows) {
    const y = yCursor - cellH;

    drawHeader(page, helv, helvBold, row, {
      x: x0 + 2,
      yTop: yCursor - 11,
      maxW: HEADER_COL_W - 8,
    });

    cols.forEach((col, ci) => {
      const x = gridLeft + ci * cellW;
      const override = overrides[`${col.id}-${row.id}`];

      if (override?.disabled) {
        drawOmittedCell(page, helv, x, y, cellW, cellH);
      } else {
        const bgColoring = effectiveColoring(row, override, "bg");
        const logoColoring = override?.logo ?? logoColoringForGroup(col, group);
        drawCellBackground(pdfDoc, page, row.bgArtwork ?? null, bgColoring, x, y, cellW, cellH);
        drawArtworkInRect(
          pdfDoc, page, group.logoArtwork, logoColoring,
          x + (cellW * (1 - logoScale)) / 2,
          y + (cellH * (1 - logoScale)) / 2,
          cellW * logoScale,
          cellH * logoScale,
          "contain",
        );
        // Adjusted cells carry their actual ink builds on the sheet.
        if (override && (override.logo || override.bg)) {
          drawOverrideInfo(page, helv, helvBold, override, x, y, cellW);
        }
      }

      // hairline cell border
      page.drawRectangle({
        x, y, width: cellW, height: cellH,
        borderColor: INK_LIGHT, borderWidth: 0.5,
      });
    });

    yCursor = y;
  }

  // Outer grid frame.
  page.drawRectangle({
    x: gridLeft, y: yCursor,
    width: gridRight - gridLeft, height: cellTop - yCursor,
    borderColor: INK_GRAY, borderWidth: 1,
  });
}

/** Ink builds of an adjusted cell, printed bottom-left on a paper backing. */
function drawOverrideInfo(
  page: any,
  helv: any,
  helvBold: any,
  override: CellOverride,
  x: number,
  y: number,
  cellW: number,
) {
  const size = 4;
  const lineH = 5.5;
  const maxW = cellW - 8;

  const lineFor = (prefix: string, coloring: Coloring): string => {
    let text = `${prefix} ${coloringColors(coloring).map(formatCmyk).join(" / ")}`;
    if (coloring.wash && coloring.wash.kind !== "solid") {
      text += ` (${coloring.wash.kind.toUpperCase()} GRAD)`;
    }
    while (text.length > prefix.length + 2 && helv.widthOfTextAtSize(text, size) > maxW) {
      text = text.slice(0, -2) + "…";
    }
    return text;
  };

  const lines: string[] = [];
  if (override.logo) lines.push(lineFor("LOGO", override.logo));
  if (override.bg) lines.push(lineFor("SURF", override.bg));
  if (lines.length === 0) return;

  const textW = Math.max(...lines.map((l) => helv.widthOfTextAtSize(l, size)));
  const boxH = lines.length * lineH + 3;
  page.drawRectangle({
    x: x + 1.5, y: y + 1.5, width: textW + 5, height: boxH,
    color: INK_PAPER, borderColor: INK_LIGHT, borderWidth: 0.3,
  });
  lines.forEach((line, i) => {
    page.drawText(line, {
      x: x + 4,
      y: y + 4 + (lines.length - 1 - i) * lineH,
      size,
      font: i === 0 && override.logo ? helvBold : helv,
      color: INK_BLACK,
    });
  });
}

// ---------------------------------------------------------------------------
// Artwork rendering
// ---------------------------------------------------------------------------

/**
 * Fills an SVG path with a gradient: the path becomes a clip, then the
 * shading is painted inside it. The CTM installed by drawSvgPath maps the
 * shading coordinates into the same (y-down) viewBox space as the path data.
 */
function drawGradientPath(
  page: any,
  pathD: string,
  drawOpts: { x: number; y: number; scale: number },
  shadingName: string,
) {
  const stream = page.getContentStream();
  page.drawSvgPath(pathD, {
    ...drawOpts,
    color: undefined,
    borderColor: undefined,
    borderWidth: 0,
  });
  const ops = stream.operators;
  if (ops.length > 0 && ops[ops.length - 1]?.name === "Q") ops.pop();
  ops.push(PDFOperator.of("W" as any, []));
  ops.push(PDFOperator.of("n" as any, []));
  ops.push(PDFOperator.of("sh" as any, [PDFName.of(shadingName)]));
  ops.push(PDFOperator.of("Q" as any, []));
}

/** Wash gradient geometry across the whole artwork, in viewBox coords. */
function washCoords(paint: Paint, vb: Artwork["viewBox"]): { type: "linear" | "radial"; coords: number[] } {
  if (paint.kind === "radial") {
    const r = Math.sqrt(vb.w * vb.w + vb.h * vb.h) / 2;
    const cx = vb.x + vb.w / 2;
    const cy = vb.y + vb.h / 2;
    return { type: "radial", coords: [cx, cy, cx, cy, r] };
  }
  // drawSvgPath's CTM keeps viewBox space y-down, so the CSS-convention
  // endpoint math applies directly (same as the screen preview).
  const coords = linearEndpoints(
    paint.kind === "linear" ? paint.angle ?? DEFAULT_WASH_ANGLE : DEFAULT_WASH_ANGLE,
    vb.x, vb.y, vb.w, vb.h,
  );
  return { type: "linear", coords: [...coords] };
}

function drawArtworkInRect(
  pdfDoc: PDFDocument,
  page: any,
  artwork: Artwork,
  coloring: Coloring,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  fit: "contain" | "cover" | "stretch",
) {
  const vb = artwork.viewBox;
  const ctx = (pdfDoc as any).context;
  const stream = page.getContentStream();

  let drawOpts: { x: number; y: number; scale: number };
  let stretched = false;
  if (fit === "stretch") {
    // Non-uniform fill: draw at the x scale, then a CTM stretches y so the
    // whole artwork exactly covers the rect (gradients stretch with it).
    const sx = rw / vb.w;
    const sy = rh / vb.h;
    stretched = true;
    stream.push(PDFOperator.of("q" as any, []));
    stream.push(
      PDFOperator.of("cm" as any, [
        ctx.obj(1), ctx.obj(0), ctx.obj(0), ctx.obj(sy / sx),
        ctx.obj(0), ctx.obj(ry + rh + vb.y * sy),
      ]),
    );
    drawOpts = { x: rx - vb.x * sx, y: 0, scale: sx };
  } else {
    const scale =
      fit === "contain"
        ? Math.min(rw / vb.w, rh / vb.h)
        : Math.max(rw / vb.w, rh / vb.h);
    const offsetX = rx + (rw - vb.w * scale) / 2 - vb.x * scale;
    const offsetY = ry + rh - (rh - vb.h * scale) / 2 + vb.y * scale;
    drawOpts = { x: offsetX, y: offsetY, scale };
  }

  const wash = coloring.wash;
  const washSolid = wash && wash.kind === "solid" ? wash.cmyk : null;
  const washGradient = wash && wash.kind !== "solid" ? wash : null;

  for (const path of artwork.paths) {
    if (washGradient) {
      const { type, coords } = washCoords(washGradient, vb);
      const shName = registerShading(pdfDoc, page, type, coords, washGradient.stops);
      drawGradientPath(page, path.d, drawOpts, shName);
    } else if (washSolid) {
      page.drawSvgPath(path.d, { ...drawOpts, color: toCmyk(washSolid) });
    } else if (path.fill.kind === "gradient") {
      const g = path.fill.gradient;
      const stops: Stop[] = g.stops.map((s) => ({
        offset: s.offset,
        cmyk: resolveRef(s.ref, coloring.slots),
      }));
      const shName = registerShading(pdfDoc, page, g.type, g.coords, stops);
      drawGradientPath(page, path.d, drawOpts, shName);
    } else {
      const c = resolveRef(path.fill.ref, coloring.slots);
      page.drawSvgPath(path.d, { ...drawOpts, color: toCmyk(c) });
    }
  }

  if (stretched) stream.push(PDFOperator.of("Q" as any, []));
}

function drawCellBackground(
  pdfDoc: PDFDocument,
  page: any,
  bgArtwork: Artwork | null,
  coloring: Coloring,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const ctx = (pdfDoc as any).context;
  const stream = page.getContentStream();
  const wash = coloring.wash;

  if (bgArtwork) {
    // Paper base under the artwork, then the artwork stretched to the cell
    // (non-uniform) so the whole background is visible.
    stream.push(PDFOperator.of("q" as any, []));
    stream.push(
      PDFOperator.of("re" as any, [ctx.obj(x), ctx.obj(y), ctx.obj(w), ctx.obj(h)]),
    );
    stream.push(PDFOperator.of("W" as any, []));
    stream.push(PDFOperator.of("n" as any, []));
    drawArtworkInRect(pdfDoc, page, bgArtwork, coloring, x, y, w, h, "stretch");
    stream.push(PDFOperator.of("Q" as any, []));
    return;
  }

  if (wash && wash.kind !== "solid") {
    // Gradient surface: clip to cell, translate, paint shading.
    const isRadial = wash.kind === "radial";
    let coords: number[];
    if (isRadial) {
      coords = [w / 2, h / 2, w / 2, h / 2, Math.sqrt(w * w + h * h) / 2];
    } else {
      // Cell-local space is y-up here, so flip the y direction.
      const t = ((wash.angle ?? DEFAULT_WASH_ANGLE) * Math.PI) / 180;
      const dx = Math.sin(t);
      const dy = Math.cos(t);
      const half = (w * Math.abs(dx) + h * Math.abs(dy)) / 2;
      coords = [w / 2 - dx * half, h / 2 - dy * half, w / 2 + dx * half, h / 2 + dy * half];
    }
    const shName = registerShading(
      pdfDoc, page, isRadial ? "radial" : "linear", coords, wash.stops,
    );
    stream.push(PDFOperator.of("q" as any, []));
    stream.push(
      PDFOperator.of("re" as any, [ctx.obj(x), ctx.obj(y), ctx.obj(w), ctx.obj(h)]),
    );
    stream.push(PDFOperator.of("W" as any, []));
    stream.push(PDFOperator.of("n" as any, []));
    stream.push(
      PDFOperator.of("cm" as any, [
        ctx.obj(1), ctx.obj(0), ctx.obj(0), ctx.obj(1), ctx.obj(x), ctx.obj(y),
      ]),
    );
    stream.push(PDFOperator.of("sh" as any, [PDFName.of(shName)]));
    stream.push(PDFOperator.of("Q" as any, []));
    return;
  }

  const colors = wash && wash.kind === "solid" ? [wash.cmyk] : coloring.slots;
  if (colors.length <= 1) {
    const c = colors[0] ?? { c: 0, m: 0, y: 0, k: 0 };
    if (tac(c) > 0) {
      page.drawRectangle({ x, y, width: w, height: h, color: toCmyk(c) });
    }
    return;
  }
  // Multiple flat surface colors → vertical stripes (side-by-side comparison).
  const stripeW = w / colors.length;
  colors.forEach((c, i) => {
    page.drawRectangle({
      x: x + i * stripeW,
      y,
      width: stripeW + (i < colors.length - 1 ? 0.5 : 0),
      height: h,
      color: toCmyk(c),
    });
  });
}

// ---------------------------------------------------------------------------
// Chrome (headers, marks, labels)
// ---------------------------------------------------------------------------

function drawHeader(
  page: any,
  helv: any,
  helvBold: any,
  variation: Variation,
  pos: { x: number; yTop: number; maxW: number },
) {
  let label = variation.name.toUpperCase();
  while (label.length > 4 && helvBold.widthOfTextAtSize(label, 7) > pos.maxW) {
    label = label.slice(0, -1);
  }
  page.drawText(label, {
    x: pos.x, y: pos.yTop, size: 7, font: helvBold, color: INK_BLACK,
  });

  const coloring = variation.coloring;
  const colors = coloringColors(coloring);
  const isGradient = !!coloring.wash && coloring.wash.kind !== "solid";
  let y = pos.yTop - 10;

  colors.slice(0, 3).forEach((c) => {
    // swatch chip
    page.drawRectangle({
      x: pos.x, y: y - 1, width: 5.5, height: 5.5,
      color: toCmyk(c), borderColor: INK_LIGHT, borderWidth: 0.4,
    });
    let build = formatCmyk(c);
    while (build.length > 4 && helv.widthOfTextAtSize(build, 5) > pos.maxW - 12) {
      build = build.slice(0, -1);
    }
    page.drawText(build, {
      x: pos.x + 8, y, size: 5, font: helv, color: INK_GRAY,
    });
    if (tac(c) > TAC_LIMIT) {
      const w = helv.widthOfTextAtSize(build, 5);
      page.drawText(`TAC ${tac(c)}`, {
        x: pos.x + 10.5 + w, y, size: 5, font: helvBold, color: INK_WARN,
      });
    }
    y -= 8;
  });
  if (colors.length > 3) {
    page.drawText(`+${colors.length - 3} MORE`, {
      x: pos.x, y, size: 4.5, font: helv, color: INK_GRAY,
    });
    y -= 8;
  }
  if (isGradient) {
    page.drawText(coloring.wash!.kind === "radial" ? "RADIAL GRAD" : "LINEAR GRAD", {
      x: pos.x, y, size: 4.5, font: helvBold, color: INK_GRAY,
    });
  }
}

function drawOmittedCell(page: any, helv: any, x: number, y: number, w: number, h: number) {
  page.drawLine({
    start: { x: x + 6, y: y + 6 },
    end: { x: x + w - 6, y: y + h - 6 },
    thickness: 0.4,
    color: INK_LIGHT,
  });
  const label = "OMITTED";
  const tw = helv.widthOfTextAtSize(label, 5);
  page.drawText(label, {
    x: x + (w - tw) / 2, y: y + h / 2 + 4, size: 5, font: helv, color: INK_GRAY,
  });
}

/** Project name + generation date, printed at the top of one half-sheet. */
function drawHalfTitle(
  page: any, helv: any, helvBold: any,
  name: string, date: string, x0: number, width: number,
) {
  const yTitle = PAGE_H - MARGIN - 16;
  let label = name.toUpperCase();
  while (label.length > 1 && helvBold.widthOfTextAtSize(label, 15) > width - 4) {
    label = label.slice(0, -1);
  }
  page.drawText(label, {
    x: x0, y: yTitle, size: 15, font: helvBold, color: INK_BLACK,
  });
  page.drawText(`GENERATED ${date} UTC`, {
    x: x0, y: yTitle - 13, size: 7, font: helv, color: INK_GRAY,
  });
}

function drawCropMarks(page: any) {
  const len = 14;
  const gap = 8;
  const corners: [number, number, number, number][] = [
    // [x, y, dirX, dirY] — marks point away from the page corner
    [0, 0, 1, 1],
    [PAGE_W, 0, -1, 1],
    [0, PAGE_H, 1, -1],
    [PAGE_W, PAGE_H, -1, -1],
  ];
  for (const [cx, cy, dx, dy] of corners) {
    // horizontal tick
    page.drawLine({
      start: { x: cx + dx * gap, y: cy + dy * (gap + len) },
      end: { x: cx + dx * gap, y: cy + dy * gap },
      thickness: 0.3,
      color: INK_BLACK,
    });
    // vertical tick
    page.drawLine({
      start: { x: cx + dx * (gap + len), y: cy + dy * gap },
      end: { x: cx + dx * gap, y: cy + dy * gap },
      thickness: 0.3,
      color: INK_BLACK,
    });
  }
}

export { PAGE_W, PAGE_H };
