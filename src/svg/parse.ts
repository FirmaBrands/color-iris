/**
 * Parses an uploaded SVG **once** into a normalized `Artwork` model:
 *
 * - every shape becomes a path with all ancestor transforms baked into `d`
 * - every fill becomes either a palette-slot reference or a fixed color
 * - gradients are resolved (href chains, units, gradientTransform) into
 *   concrete viewBox-space geometry with slot-referencing stops
 *
 * Both the on-screen preview and the PDF generator render from this model,
 * so what you see is what gets proofed.
 */
import svgpath from "svgpath";
import getBounds from "svg-path-bounds";
import type { ArtFill, ArtGradient, Artwork, ColorRef } from "../types";
import { hexToRgb, rgbToCmyk } from "../color/convert";
import {
  IDENTITY,
  Mat,
  matApply,
  matMultiply,
  matScaleFactor,
  parseTransform,
} from "./transform";

export const MAX_SLOTS = 12;

const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  lime: "#00ff00",
  blue: "#0000ff",
  yellow: "#ffff00",
  cyan: "#00ffff",
  aqua: "#00ffff",
  magenta: "#ff00ff",
  fuchsia: "#ff00ff",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  maroon: "#800000",
  olive: "#808000",
  navy: "#000080",
  teal: "#008080",
  purple: "#800080",
  orange: "#ffa500",
};

/** Normalizes any CSS color string to 6-digit lowercase hex, or null. */
export function normalizeColor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (!v || v === "none" || v === "transparent" || v === "inherit") return null;
  if (v.startsWith("#")) {
    if (/^#[0-9a-f]{3}$/.test(v)) {
      return "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    }
    if (/^#[0-9a-f]{6}/.test(v)) return v.slice(0, 7);
    return null;
  }
  const rgbMatch = v.match(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (rgbMatch) {
    const to2 = (s: string) =>
      Math.min(255, parseInt(s, 10)).toString(16).padStart(2, "0");
    return "#" + to2(rgbMatch[1]) + to2(rgbMatch[2]) + to2(rgbMatch[3]);
  }
  return NAMED_COLORS[v] ?? null;
}

function readStyleProp(el: Element, prop: string): string | null {
  const style = el.getAttribute("style");
  if (!style) return null;
  const m = style.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
  return m ? m[1].trim() : null;
}

function getById(doc: Document, id: string): Element | null {
  try {
    return doc.querySelector(`[id="${id}"]`);
  } catch {
    return null;
  }
}

/** Converts a basic shape element to path data (untransformed). */
function shapeToPathData(el: Element): string {
  const num = (attr: string, def = "0") => parseFloat(el.getAttribute(attr) || def);
  switch (el.tagName.toLowerCase()) {
    case "path":
      return el.getAttribute("d") || "";
    case "rect": {
      const x = num("x");
      const y = num("y");
      const w = num("width");
      const h = num("height");
      let rx = el.hasAttribute("rx") ? num("rx") : el.hasAttribute("ry") ? num("ry") : 0;
      let ry = el.hasAttribute("ry") ? num("ry") : rx;
      if (!(w > 0 && h > 0)) return "";
      rx = Math.min(rx, w / 2);
      ry = Math.min(ry, h / 2);
      if (rx > 0 && ry > 0) {
        return (
          `M${x + rx},${y} h${w - 2 * rx} a${rx},${ry} 0 0 1 ${rx},${ry} ` +
          `v${h - 2 * ry} a${rx},${ry} 0 0 1 ${-rx},${ry} h${2 * rx - w} ` +
          `a${rx},${ry} 0 0 1 ${-rx},${-ry} v${2 * ry - h} a${rx},${ry} 0 0 1 ${rx},${-ry} z`
        );
      }
      return `M${x},${y} h${w} v${h} h${-w} z`;
    }
    case "circle": {
      const cx = num("cx");
      const cy = num("cy");
      const r = num("r");
      if (!(r > 0)) return "";
      return `M${cx - r},${cy} a${r},${r} 0 1,0 ${r * 2},0 a${r},${r} 0 1,0 ${-r * 2},0 z`;
    }
    case "ellipse": {
      const cx = num("cx");
      const cy = num("cy");
      const rx = num("rx");
      const ry = num("ry");
      if (!(rx > 0 && ry > 0)) return "";
      return `M${cx - rx},${cy} a${rx},${ry} 0 1,0 ${rx * 2},0 a${rx},${ry} 0 1,0 ${-rx * 2},0 z`;
    }
    case "line":
      return `M${num("x1")},${num("y1")} L${num("x2")},${num("y2")}`;
    case "polygon":
    case "polyline": {
      const points = (el.getAttribute("points") || "").trim().split(/[\s,]+/);
      if (points.length < 4) return "";
      let d = `M${points[0]},${points[1]}`;
      for (let i = 2; i + 1 < points.length; i += 2) {
        d += ` L${points[i]},${points[i + 1]}`;
      }
      if (el.tagName.toLowerCase() === "polygon") d += " z";
      return d;
    }
    default:
      return "";
  }
}

/** Inlines <style> rules onto matching elements (attribute wins over rule). */
function inlineStylesheets(svg: Element): void {
  const styles = Array.from(svg.querySelectorAll("style"));
  for (const styleEl of styles) {
    const text = styleEl.textContent || "";
    const ruleRe = /([^{}]+)\{([^}]*)\}/g;
    let match: RegExpExecArray | null;
    while ((match = ruleRe.exec(text)) !== null) {
      const selector = match[1].trim();
      const decls = match[2].split(";");
      let targets: Element[];
      try {
        targets = Array.from(svg.querySelectorAll(selector));
      } catch {
        continue;
      }
      for (const el of targets) {
        for (const decl of decls) {
          const idx = decl.indexOf(":");
          if (idx === -1) continue;
          const prop = decl.slice(0, idx).trim().toLowerCase();
          const val = decl.slice(idx + 1).trim();
          if (
            ["fill", "stroke", "stop-color"].includes(prop) &&
            val &&
            !el.hasAttribute(prop)
          ) {
            el.setAttribute(prop, val);
          }
        }
      }
    }
  }
}

/** Replaces <use> references with positioned clones of their targets. */
function resolveUses(doc: Document): void {
  for (const useEl of Array.from(doc.querySelectorAll("use"))) {
    const href = useEl.getAttribute("href") || useEl.getAttribute("xlink:href");
    if (!href || !href.startsWith("#")) continue;
    const def = getById(doc, href.slice(1));
    if (!def) continue;
    const clone = def.cloneNode(true) as Element;
    const x = useEl.getAttribute("x") || "0";
    const y = useEl.getAttribute("y") || "0";
    let transform = useEl.getAttribute("transform") || "";
    if (x !== "0" || y !== "0") transform = `${transform} translate(${x}, ${y})`.trim();
    const childT = clone.getAttribute("transform") || "";
    if (transform || childT) {
      clone.setAttribute("transform", `${transform} ${childT}`.trim());
    }
    for (const attr of ["fill", "stroke"]) {
      const v = useEl.getAttribute(attr);
      if (v && !clone.hasAttribute(attr)) clone.setAttribute(attr, v);
    }
    useEl.replaceWith(clone);
  }
}

// ---------------------------------------------------------------------------
// Gradient resolution
// ---------------------------------------------------------------------------

function resolveGradient(
  doc: Document,
  id: string,
  elementMatrix: Mat,
  pathBounds: [number, number, number, number],
  vbWidth: number,
  vbHeight: number,
  toRef: (hex: string | null) => ColorRef,
): ArtGradient | null {
  // Walk the href inheritance chain (Illustrator/Figma keep stops on templates).
  const chain: Element[] = [];
  let cur: Element | null = getById(doc, id);
  while (cur && chain.length < 8) {
    chain.push(cur);
    const href = cur.getAttribute("href") || cur.getAttribute("xlink:href");
    cur = href && href.startsWith("#") ? getById(doc, href.slice(1)) : null;
  }
  if (chain.length === 0) return null;

  const type: "linear" | "radial" =
    chain[0].tagName.toLowerCase().includes("radial") ? "radial" : "linear";

  const attr = (name: string): string | null => {
    for (const el of chain) {
      const v = el.getAttribute(name);
      if (v !== null && v !== "") return v;
    }
    return null;
  };

  let stopEls: Element[] = [];
  for (const el of chain) {
    const s = Array.from(el.querySelectorAll("stop"));
    if (s.length > 0) {
      stopEls = s;
      break;
    }
  }
  if (stopEls.length === 0) return null;

  const stops: ArtGradient["stops"] = [];
  stopEls.forEach((stopEl, i) => {
    const colorStr =
      stopEl.getAttribute("stop-color") || readStyleProp(stopEl, "stop-color") || "#000000";
    const hex = normalizeColor(colorStr);
    if (!hex) return;
    const offsetRaw = stopEl.getAttribute("offset");
    let offset: number;
    if (offsetRaw === null || offsetRaw === "") {
      offset = stopEls.length > 1 ? i / (stopEls.length - 1) : 0;
    } else {
      const f = offsetRaw.trim().endsWith("%")
        ? parseFloat(offsetRaw) / 100
        : parseFloat(offsetRaw);
      offset = isNaN(f) ? 0 : Math.max(0, Math.min(1, f));
    }
    stops.push({ offset, ref: toRef(hex) });
  });
  if (stops.length === 0) return null;
  for (let i = 1; i < stops.length; i++) {
    if (stops[i].offset < stops[i - 1].offset) stops[i].offset = stops[i - 1].offset;
  }

  // ----- Geometry -----
  const units = attr("gradientUnits") || "objectBoundingBox";
  const isOBB = units !== "userSpaceOnUse";
  const gt = parseTransform(attr("gradientTransform"));

  const [bLeft, bTop, bRight, bBottom] = pathBounds;
  const bW = Math.max(bRight - bLeft, 0);
  const bH = Math.max(bBottom - bTop, 0);

  const parseLen = (val: string | null, def: string, refUser: number): number => {
    const s = val === null || val === "" ? def : val;
    if (s.trim().endsWith("%")) {
      const f = parseFloat(s) / 100;
      return isNaN(f) ? 0 : isOBB ? f : f * refUser;
    }
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  };

  const toFinal = (px: number, py: number): [number, number] => {
    const [gx, gy] = matApply(gt, px, py);
    if (isOBB) return [bLeft + gx * bW, bTop + gy * bH];
    return matApply(elementMatrix, gx, gy);
  };

  if (type === "linear") {
    const p1 = toFinal(parseLen(attr("x1"), "0%", vbWidth), parseLen(attr("y1"), "0%", vbHeight));
    const p2 = toFinal(parseLen(attr("x2"), "100%", vbWidth), parseLen(attr("y2"), "0%", vbHeight));
    let coords = [p1[0], p1[1], p2[0], p2[1]];
    if (Math.abs(coords[0] - coords[2]) < 0.01 && Math.abs(coords[1] - coords[3]) < 0.01) {
      coords = [bLeft, bTop, bLeft + bW, bTop + bH]; // degenerate → bbox diagonal
    }
    return { type, coords, stops };
  }

  const cxg = parseLen(attr("cx"), "50%", vbWidth);
  const cyg = parseLen(attr("cy"), "50%", vbHeight);
  const fxg = attr("fx") !== null ? parseLen(attr("fx"), "50%", vbWidth) : cxg;
  const fyg = attr("fy") !== null ? parseLen(attr("fy"), "50%", vbHeight) : cyg;
  const [cx, cy] = toFinal(cxg, cyg);
  const [fx, fy] = toFinal(fxg, fyg);

  const rRefUser = Math.sqrt((vbWidth * vbWidth + vbHeight * vbHeight) / 2);
  const rg = parseLen(attr("r"), "50%", rRefUser);
  const r = isOBB
    ? rg * Math.sqrt((bW * bW + bH * bH) / 2) * matScaleFactor(gt)
    : rg * matScaleFactor(gt) * matScaleFactor(elementMatrix);
  if (!(r > 0.001)) return null;
  return { type, coords: [fx, fy, cx, cy, r], stops };
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export function parseSvg(svgText: string): Artwork {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg || doc.querySelector("parsererror")) {
    throw new Error("Not a valid SVG file.");
  }

  resolveUses(doc);
  inlineStylesheets(svg);

  // Palette: hex → slot index, assigned in encounter order, capped.
  const palette: string[] = [];
  const slotOf = new Map<string, number>();
  const toRef = (hex: string | null): ColorRef => {
    const h = hex ?? "#000000";
    let idx = slotOf.get(h);
    if (idx === undefined && palette.length < MAX_SLOTS) {
      idx = palette.length;
      palette.push(h);
      slotOf.set(h, idx);
    }
    if (idx === undefined) {
      const { r, g, b } = hexToRgb(h);
      return { kind: "fixed", cmyk: rgbToCmyk({ r, g, b }) };
    }
    return { kind: "slot", index: idx };
  };

  // viewBox
  let vb = { x: 0, y: 0, w: 0, h: 0 };
  const vbAttr = svg.getAttribute("viewBox");
  if (vbAttr) {
    const parts = vbAttr.split(/[\s,]+/).filter(Boolean).map(parseFloat);
    if (parts.length >= 4 && parts[2] > 0 && parts[3] > 0) {
      vb = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
    }
  }
  if (vb.w === 0) {
    const w = parseFloat(svg.getAttribute("width") || "0");
    const h = parseFloat(svg.getAttribute("height") || "0");
    if (w > 0 && h > 0) vb = { x: 0, y: 0, w, h };
  }

  const shapeEls = Array.from(
    svg.querySelectorAll("path, circle, rect, polygon, polyline, ellipse, line"),
  ).filter((el) => !el.closest("defs") && !el.closest("clipPath") && !el.closest("mask"));

  const paths: Artwork["paths"] = [];

  for (const el of shapeEls) {
    let d = shapeToPathData(el);
    if (!d) continue;

    // Collect ancestor transforms (innermost first) and bake them into `d`.
    const transforms: string[] = [];
    let tEl: Element | null = el;
    while (tEl && tEl.tagName.toLowerCase() !== "svg") {
      const t = tEl.getAttribute("transform");
      if (t) transforms.push(t);
      tEl = tEl.parentElement;
    }
    let elementMatrix: Mat = IDENTITY;
    for (let i = transforms.length - 1; i >= 0; i--) {
      elementMatrix = matMultiply(elementMatrix, parseTransform(transforms[i]));
    }
    if (transforms.length > 0) {
      let sp = svgpath(d);
      for (const t of transforms) sp = sp.transform(t);
      d = sp.toString();
    }

    // Fill lookup: attribute or inline style, walking up the ancestor chain.
    let fillStr = "";
    let lookEl: Element | null = el;
    while (lookEl && lookEl.tagName.toLowerCase() !== "svg") {
      const f = lookEl.getAttribute("fill") || readStyleProp(lookEl, "fill");
      const s = lookEl.getAttribute("stroke") || readStyleProp(lookEl, "stroke");
      if (f) {
        fillStr = f;
        break;
      }
      if (s) {
        fillStr = s; // stroke-only shapes are proofed as fills (simplification)
        break;
      }
      lookEl = lookEl.parentElement;
    }

    if (fillStr.trim().toLowerCase() === "none" || fillStr.trim().toLowerCase() === "transparent") {
      continue;
    }

    let bounds: [number, number, number, number] = [0, 0, 0, 0];
    try {
      bounds = getBounds(d) as [number, number, number, number];
    } catch {
      // keep zeros; gradient bbox fallbacks will degrade gracefully
    }

    let fill: ArtFill | null = null;
    const urlMatch = fillStr.match(/url\(\s*["']?\s*#([^"')\s]+)/);
    if (urlMatch) {
      const grad = resolveGradient(
        doc,
        urlMatch[1],
        elementMatrix,
        bounds,
        vb.w || 100,
        vb.h || 100,
        toRef,
      );
      if (grad && grad.stops.length > 1) {
        fill = { kind: "gradient", gradient: grad };
      } else if (grad) {
        fill = { kind: "ref", ref: grad.stops[0].ref };
      } else {
        fill = { kind: "ref", ref: toRef("#000000") };
      }
    } else if (fillStr.trim().toLowerCase() === "currentcolor") {
      fill = { kind: "ref", ref: toRef(palette[0] ?? "#000000") };
    } else {
      // Plain color (or empty → SVG default black).
      fill = { kind: "ref", ref: toRef(normalizeColor(fillStr)) };
    }

    paths.push({ d, fill, bounds });
  }

  // No viewBox anywhere: derive it from the union of path bounds.
  if (vb.w === 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of paths) {
      minX = Math.min(minX, p.bounds[0]);
      minY = Math.min(minY, p.bounds[1]);
      maxX = Math.max(maxX, p.bounds[2]);
      maxY = Math.max(maxY, p.bounds[3]);
    }
    vb = isFinite(minX) && maxX > minX && maxY > minY
      ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
      : { x: 0, y: 0, w: 100, h: 100 };
  }

  if (paths.length === 0) throw new Error("The SVG contains no drawable shapes.");

  if (palette.length === 0) palette.push("#000000");

  return { paths, viewBox: vb, palette };
}
