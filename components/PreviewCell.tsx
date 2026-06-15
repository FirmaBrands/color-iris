import { useEffect, useMemo, useRef } from "react";
import { Eye, EyeOff } from "lucide-react";
import type { CellOverride, LogoGroup, Variation } from "../types";
import { cn } from "../lib/cn";
import { coloringToCss } from "../color/simulate";
import {
  artworkOwnColoring,
  coloringColors,
  describeColoring,
  effectiveColoring,
  formatCmyk,
  logoColoringForGroup,
} from "../lib/coloring";
import type { Coloring } from "../types";
import { actions, useAppState } from "../state/store";
import { renderArtworkSvg } from "../svg/render";

/**
 * One intersection of the proofing matrix: logo profile × background
 * surface. The row's group supplies the artwork; auto profiles re-separate
 * per group. Clicking selects the cell for override editing in the
 * Inspector; the hover corner button quick-toggles exclusion.
 */
export function PreviewCell({
  logoVar,
  bgVar,
  group,
  override,
  logoScale,
}: {
  logoVar: Variation;
  bgVar: Variation;
  group: LogoGroup;
  override: CellOverride | undefined;
  /** Logo footprint as a fraction of the cell — identical to the PDF. */
  logoScale: number;
}) {
  const cellId = `${logoVar.id}-${bgVar.id}`;
  const ref = useRef<HTMLDivElement | null>(null);
  const selection = useAppState((s) => s.selection);
  const isSelected =
    selection?.kind === "cell" &&
    selection.groupId === group.id &&
    selection.logoId === logoVar.id &&
    selection.bgId === bgVar.id;

  // Keep the selected cell visible when the inspector opens/resizes the
  // matrix. scroll-margins account for the sticky header tracks.
  useEffect(() => {
    if (isSelected) {
      ref.current?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }
  }, [isSelected]);

  const logoColoring = override?.logo ?? logoColoringForGroup(logoVar, group);
  const bgColoring = effectiveColoring(bgVar, override, "bg");
  const bgArtwork = bgVar.bgArtwork ?? null;

  const isExcluded = !!override?.disabled;
  const isRowColOmitted = !logoVar.enabled || !bgVar.enabled;
  const isOmitted = isExcluded || isRowColOmitted;
  const hasSpecChange = !!override && (override.logo !== undefined || override.bg !== undefined);

  const logoSvg = useMemo(
    () => renderArtworkSvg(group.logoArtwork, logoColoring),
    [group.logoArtwork, logoColoring],
  );
  const bgSvg = useMemo(
    () =>
      bgArtwork
        ? // Painted in its own colors, stretched to the cell (matches the PDF).
          renderArtworkSvg(bgArtwork, artworkOwnColoring(bgArtwork), {
            preserveAspectRatio: "none",
          })
        : null,
    [bgArtwork],
  );

  return (
    <div
      ref={ref}
      onClick={() =>
        actions.select({ kind: "cell", groupId: group.id, logoId: logoVar.id, bgId: bgVar.id })
      }
      className={cn(
        "border-r border-b border-neutral-200 flex flex-col justify-center relative group/cell w-full h-full items-center overflow-hidden transition-shadow duration-150 cursor-pointer scroll-mt-[120px] scroll-ml-[200px]",
        isOmitted && "bg-neutral-50",
        !isSelected && !hasSpecChange && "hover:ring-2 hover:ring-inset hover:ring-indigo-400/50",
        // Edited cells stay outlined in magenta so they're obvious at a glance.
        !isSelected && hasSpecChange && "ring-2 ring-inset ring-[#E6007E]",
        isSelected && "ring-2 ring-inset ring-indigo-600 z-20",
      )}
      style={isOmitted ? undefined : { background: coloringToCss(bgColoring) }}
      title={`Logo: ${describeColoring(logoColoring)}\nSurface: ${describeColoring(bgColoring)}\nClick to inspect / override this cell`}
    >
      {/* Background artwork layer */}
      {!isOmitted && bgSvg && (
        <div
          className="absolute inset-0 w-full h-full [&>svg]:w-full [&>svg]:h-full z-0 pointer-events-none"
          dangerouslySetInnerHTML={{ __html: bgSvg }}
        />
      )}

      {/* Logo layer — same cell fraction as the printed sheet */}
      <div
        className={cn(
          "w-full h-full flex items-center justify-center z-10",
          isOmitted && "opacity-10",
        )}
      >
        <div
          className="max-w-full max-h-full overflow-hidden [&>svg]:w-full [&>svg]:h-full"
          style={{ width: `${logoScale * 100}%`, height: `${logoScale * 100}%` }}
          dangerouslySetInnerHTML={{ __html: logoSvg }}
        />
      </div>

      {/* Override indicator — names the changed side(s) and the new build */}
      {hasSpecChange && (
        <div className="absolute top-1.5 left-1.5 max-w-[calc(100%-28px)] flex flex-col gap-0.5 z-20 items-start pointer-events-none">
          {override?.logo && (
            <ChangeChip side="Logo" from={logoColoringForGroup(logoVar, group)} to={override.logo} />
          )}
          {override?.bg && <ChangeChip side="Bg" from={bgVar.coloring} to={override.bg} />}
        </div>
      )}

      {/* Quick exclude / restore (hover) */}
      {!isRowColOmitted && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            actions.setOverride(
              group.id,
              cellId,
              isExcluded
                ? override?.logo || override?.bg
                  ? { ...override, disabled: false }
                  : null
                : { ...override, disabled: true },
            );
          }}
          className={cn(
            "absolute top-1.5 right-1.5 z-30 p-1.5 bg-white/95 border border-neutral-300 rounded-md hover:border-black text-neutral-500 hover:text-black transition-all shadow-sm",
            isExcluded ? "opacity-100" : "opacity-0 group-hover/cell:opacity-100 focus-visible:opacity-100",
          )}
          aria-label={isExcluded ? "Restore cell" : "Exclude cell from the sheet"}
          title={isExcluded ? "Restore cell" : "Exclude cell from the sheet"}
        >
          {isExcluded ? <Eye size={11} /> : <EyeOff size={11} />}
        </button>
      )}

      {/* Omitted label */}
      {isOmitted && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none z-10">
          <div
            className="bg-white border border-neutral-300 rounded-full px-2.5 py-1 shadow-sm text-[9px] font-black tracking-widest text-[#111] uppercase"
            title={
              isExcluded
                ? "This cell is excluded from the sheet"
                : "Off because its logo or background is turned off"
            }
          >
            {isExcluded ? "Excluded" : "Off"}
          </div>
        </div>
      )}
    </div>
  );
}

/** Magenta chip naming an edited side and its new CMYK build (vs the spec). */
function ChangeChip({ side, from, to }: { side: string; from: Coloring; to: Coloring }) {
  const toBuild = coloringColors(to).map(formatCmyk).join(" / ");
  const fromBuild = coloringColors(from).map(formatCmyk).join(" / ");
  return (
    <div
      className="max-w-full flex items-center gap-1 bg-white border border-[#E6007E] rounded px-1.5 py-0.5 shadow-sm"
      title={`${side} edited — was ${fromBuild}  →  now ${toBuild}`}
    >
      <span className="text-[8.5px] font-black uppercase tracking-wider text-[#E6007E] shrink-0">
        {side} ✎
      </span>
      <span className="font-mono text-[9px] font-bold text-neutral-700 truncate">{toBuild}</span>
    </div>
  );
}
