/** Core domain model shared by the UI, the preview renderer and the PDF generator. */

export type RGB = { r: number; g: number; b: number };

/** Process ink coverage, 0–100 per channel. */
export type CMYK = { c: number; m: number; y: number; k: number };

/** A positioned color stop. `offset` is 0..1. */
export type Stop = { cmyk: CMYK; offset: number };

/**
 * How an area is painted. A "wash" gradient paints across the whole artwork
 * bounding box; solids paint flat.
 */
export type Paint =
  | { kind: "solid"; cmyk: CMYK }
  /** `angle` follows the CSS convention (degrees, 0 = up, clockwise). Default 135. */
  | { kind: "linear"; stops: Stop[]; angle?: number }
  | { kind: "radial"; stops: Stop[] };

/** Default wash gradient angle (top-left → bottom-right, like v1). */
export const DEFAULT_WASH_ANGLE = 135;

/**
 * The colors a variation assigns to an artwork.
 *
 * - `slots` — one solid CMYK per artwork color slot (slot = a distinct color
 *   extracted from the uploaded SVG; a single-color artwork has 1 slot).
 * - `wash`  — when set, overrides the slots entirely and paints the whole
 *   artwork with one paint (used for variation-level gradients).
 */
export interface Coloring {
  slots: CMYK[];
  wash: Paint | null;
}

/** A column (logo profile) or row (background surface) of the proofing matrix. */
export interface Variation {
  id: string;
  name: string;
  coloring: Coloring;
  enabled: boolean;
  /** Auto variations are recomputed from the master colors; custom ones are user-owned. */
  isCustom: boolean;
  /** Which separation algorithm produced an auto variation. */
  algorithmIndex?: number;
  /** Surface rows only: an optional background texture behind this row. */
  bgArtwork?: Artwork | null;
}

/**
 * A self-contained block of the proof: its own logo (plus editable source
 * colors), its own set of logo profiles (columns) and surface rows (rows),
 * and its own per-cell overrides. Each group is an independent mini-matrix.
 */
export interface LogoGroup {
  id: string;
  name: string;
  logoArtwork: Artwork;
  /** True while the group still shows the placeholder artwork. */
  logoIsDefault: boolean;
  /** Editable master colors, one per logo palette slot. */
  masterHexes: string[];
  /** This group's logo profiles (matrix columns). */
  logoVariations: Variation[];
  /** This group's surface rows (matrix rows). */
  bgVariations: Variation[];
  /** Per-cell deviations, keyed `${logoId}-${bgId}` within this group. */
  overrides: Record<string, CellOverride>;
}

/** Per-cell deviation from the row/column defaults. */
export interface CellOverride {
  logo?: Coloring;
  bg?: Coloring;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Parsed artwork model (the single source of truth for preview + PDF)
// ---------------------------------------------------------------------------

/** Reference to a color: either an artwork slot or a fixed literal color. */
export type ColorRef =
  | { kind: "slot"; index: number }
  | { kind: "fixed"; cmyk: CMYK };

/** A gradient defined inside the artwork itself (preserved from the SVG). */
export interface ArtGradient {
  type: "linear" | "radial";
  /**
   * Geometry in final (transform-baked) viewBox coordinates:
   * linear → [x1, y1, x2, y2]; radial → [fx, fy, cx, cy, r]
   */
  coords: number[];
  stops: { offset: number; ref: ColorRef }[];
}

export type ArtFill =
  | { kind: "ref"; ref: ColorRef }
  | { kind: "gradient"; gradient: ArtGradient };

/** One fillable path with all transforms already baked into `d`. */
export interface ArtPath {
  d: string;
  fill: ArtFill;
  /** [minX, minY, maxX, maxY] in viewBox space. */
  bounds: [number, number, number, number];
}

/** Normalized, render-ready artwork. */
export interface Artwork {
  paths: ArtPath[];
  viewBox: { x: number; y: number; w: number; h: number };
  /** Original hex color of each slot, in extraction order. */
  palette: string[];
}
