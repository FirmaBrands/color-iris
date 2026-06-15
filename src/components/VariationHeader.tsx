import { useEffect, useRef } from "react";
import type { Variation } from "../types";
import { cn } from "../lib/cn";
import { coloringToCss } from "../color/simulate";
import { exceedsTac } from "../lib/coloring";
import { actions, useAppState } from "../state/store";

/**
 * Column (logo profile) or row (background surface) header of the matrix.
 * Clicking it selects the variation for editing in the Inspector panel.
 */
export function VariationHeader({
  variation,
  side,
  className,
  accent,
}: {
  variation: Variation;
  side: "logo" | "bg";
  className?: string;
  /** Row headers: the owning section's accent color (left edge). */
  accent?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const selection = useAppState((s) => s.selection);
  const isSelected =
    selection?.kind === "variation" && selection.side === side && selection.id === variation.id;
  const isOmitted = !variation.enabled;
  const swatchCss = coloringToCss(variation.coloring);

  // Keep the selected header visible when the inspector opens/resizes the matrix.
  useEffect(() => {
    if (isSelected) {
      ref.current?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    }
  }, [isSelected]);

  const select = () => actions.select({ kind: "variation", side, id: variation.id });

  return (
    <div
      ref={ref}
      onClick={select}
      className={cn(
        "p-2.5 lg:p-3 flex flex-col justify-between relative transition-all duration-150 w-full h-full select-none cursor-pointer group",
        isOmitted && "opacity-40 grayscale",
        isSelected ? "ring-2 ring-inset ring-indigo-600 bg-indigo-50/40" : "hover:bg-neutral-50",
        className,
      )}
      style={accent ? { borderLeft: `3px solid ${accent}` } : undefined}
      title="Click to edit in the inspector"
    >
      {/* Name + quick toggle */}
      <div className="flex items-start justify-between gap-1.5 w-full">
        <div className="flex flex-col gap-1.5 flex-1 min-w-0 mr-1">
          <input
            value={variation.name}
            onClick={(e) => e.stopPropagation()}
            onFocus={select}
            onChange={(e) =>
              actions.updateVariation(
                side,
                { ...variation, name: e.target.value },
                `vname-${variation.id}`,
              )
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="bg-transparent text-[11px] lg:text-[11.5px] font-black uppercase tracking-wide text-black outline-none w-full truncate border-b border-transparent focus:border-indigo-500 transition-colors cursor-text rounded-none"
            title="Rename"
          />
          <div className="flex items-center gap-1">
            {!variation.isCustom && (
              <span className="text-[7.5px] font-mono font-bold tracking-widest uppercase text-neutral-500 bg-neutral-100 border border-neutral-200 rounded-full px-1.5 py-0.5 w-fit leading-none">
                Auto
              </span>
            )}
            {exceedsTac(variation.coloring) && (
              <span
                className="text-[7.5px] font-mono font-bold tracking-widest uppercase text-white bg-[#C75000] rounded-full px-1.5 py-0.5 w-fit leading-none"
                title="Total area coverage exceeds the 300% coated-stock limit"
              >
                TAC
              </span>
            )}
          </div>
        </div>

        <input
          type="checkbox"
          checked={variation.enabled}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) =>
            actions.updateVariation(side, { ...variation, enabled: e.target.checked })
          }
          className="w-3.5 h-3.5 shrink-0 cursor-pointer accent-indigo-600"
          title={side === "logo" ? "Toggle column" : "Toggle row"}
        />
      </div>

      {/* Swatch */}
      <div className="w-full mt-2">
        <div
          className={cn(
            "block h-8 w-full rounded-md border shadow-sm transition-all",
            isSelected ? "border-indigo-600" : "border-black/15 group-hover:border-neutral-500",
          )}
          style={{ background: swatchCss }}
        />
      </div>
    </div>
  );
}
