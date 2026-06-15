/** Shared helpers for resolving colorings, refs and ink coverage. */
import type { CellOverride, CMYK, ColorRef, Coloring, LogoGroup, Paint, Variation } from "../types";
import { hexToRgb, separate, SEPARATION_ALGORITHMS, tac, TAC_LIMIT } from "../color/convert";

/**
 * The logo coloring a profile produces for one group. Auto profiles
 * re-separate that group's master colors with their algorithm; custom
 * profiles apply their fixed slots to any logo (slot refs wrap).
 */
export function logoColoringForGroup(variation: Variation, group: LogoGroup): Coloring {
  const algo =
    variation.algorithmIndex !== undefined
      ? SEPARATION_ALGORITHMS[variation.algorithmIndex]
      : undefined;
  if (variation.isCustom || !algo) return variation.coloring;
  return {
    slots: group.masterHexes.map((hex) => separate(hexToRgb(hex), algo.kBias)),
    wash: variation.coloring.wash,
  };
}

export function resolveRef(ref: ColorRef, slots: CMYK[]): CMYK {
  if (ref.kind === "fixed") return ref.cmyk;
  return slots[ref.index % slots.length] ?? slots[0] ?? { c: 0, m: 0, y: 0, k: 100 };
}

/** The coloring a cell actually uses for one side, considering its override. */
export function effectiveColoring(
  variation: Variation,
  override: CellOverride | undefined,
  side: "logo" | "bg",
): Coloring {
  return (side === "logo" ? override?.logo : override?.bg) ?? variation.coloring;
}

export function cloneColoring(c: Coloring): Coloring {
  return {
    slots: c.slots.map((s) => ({ ...s })),
    wash: c.wash
      ? c.wash.kind === "solid"
        ? { kind: "solid", cmyk: { ...c.wash.cmyk } }
        : { kind: c.wash.kind, stops: c.wash.stops.map((s) => ({ cmyk: { ...s.cmyk }, offset: s.offset })) }
      : null,
  };
}

/** All concrete colors a coloring can put on paper. */
export function coloringColors(c: Coloring): CMYK[] {
  if (c.wash) {
    return c.wash.kind === "solid" ? [c.wash.cmyk] : c.wash.stops.map((s) => s.cmyk);
  }
  return c.slots;
}

/** Highest total area coverage used by the coloring. */
export function maxTac(c: Coloring): number {
  return Math.max(0, ...coloringColors(c).map(tac));
}

export function exceedsTac(c: Coloring): boolean {
  return maxTac(c) > TAC_LIMIT;
}

/** Display string like "C60 M40 Y40 K100". */
export function formatCmyk(c: CMYK): string {
  return `C${c.c} M${c.m} Y${c.y} K${c.k}`;
}

/** One-line human summary of a coloring, for tooltips. */
export function describeColoring(c: Coloring): string {
  if (c.wash) {
    if (c.wash.kind === "solid") return formatCmyk(c.wash.cmyk);
    return `${c.wash.kind} gradient · ${c.wash.stops.map((s) => formatCmyk(s.cmyk)).join(" → ")}`;
  }
  return c.slots.map(formatCmyk).join(" · ");
}

export function solid(c: CMYK): Paint {
  return { kind: "solid", cmyk: c };
}
