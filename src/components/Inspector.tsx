import { useMemo, useState } from "react";
import {
  Check,
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  Eye,
  EyeOff,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import type { Coloring, LogoGroup, Variation } from "../types";
import { cn } from "../lib/cn";
import { coloringToCss } from "../color/simulate";
import { artworkOwnColoring, effectiveColoring, logoColoringForGroup } from "../lib/coloring";
import { actions, getClipboardColoring, useAppState } from "../state/store";
import { renderArtworkSvg } from "../svg/render";
import { PaintEditor } from "./PaintEditor";

/**
 * Right-hand inspector panel. Shows the current selection — a variation
 * (column/row) or a single cell — and edits it in place with live preview.
 * All edits go through the store, so they are undoable.
 */
export function Inspector() {
  const selection = useAppState((s) => s.selection);
  const groups = useAppState((s) => s.groups);

  if (!selection) return null;
  const group = groups.find((g) => g.id === selection.groupId);
  if (!group) return null;

  let body: React.ReactNode = null;
  let title = "";
  let subtitle = "";

  if (selection.kind === "variation") {
    const list = selection.side === "logo" ? group.logoVariations : group.bgVariations;
    const variation = list.find((v) => v.id === selection.id);
    if (!variation) return null;
    title = selection.side === "logo" ? "Logo" : "Background";
    subtitle = groups.length > 1 ? group.name : selection.side === "logo" ? "Column" : "Row";
    body = <VariationPanel group={group} side={selection.side} variation={variation} />;
  } else {
    const logoVar = group.logoVariations.find((v) => v.id === selection.logoId);
    const bgVar = group.bgVariations.find((v) => v.id === selection.bgId);
    if (!logoVar || !bgVar) return null;
    title = "Cell";
    subtitle = `${logoVar.name} × ${bgVar.name}`;
    if (groups.length > 1) subtitle += ` · ${group.name}`;
    body = <CellPanel group={group} logoVar={logoVar} bgVar={bgVar} />;
  }

  return (
    <aside className="w-[288px] shrink-0 border-l border-neutral-200 bg-white flex flex-col min-h-0 z-30 shadow-[-4px_0_12px_rgba(0,0,0,0.03)]">
      <div className="h-11 shrink-0 border-b border-neutral-200 flex items-center justify-between pl-4 pr-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-[10.5px] font-black uppercase tracking-[0.18em]">{title}</span>
          <span className="text-[8.5px] font-mono text-neutral-400 uppercase tracking-wider truncate">
            {subtitle}
          </span>
        </div>
        <button
          onClick={() => actions.select(null)}
          className="p-1.5 rounded-md text-neutral-400 hover:text-black hover:bg-neutral-100 transition-colors"
          title="Close inspector (Esc)"
        >
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-3.5">
        {body}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Variation (column/row) panel
// ---------------------------------------------------------------------------

function VariationPanel({
  group,
  side,
  variation,
}: {
  group: LogoGroup;
  side: "logo" | "bg";
  variation: Variation;
}) {
  const hasClipboard = useAppState((s) => s.hasClipboard);
  const update = (patch: Partial<Variation>, coalesceKey?: string) =>
    actions.updateVariation(group.id, side, { ...variation, ...patch }, coalesceKey);

  return (
    <>
      {/* Name + provenance */}
      <div className="flex flex-col gap-1.5">
        <input
          value={variation.name}
          onChange={(e) => update({ name: e.target.value }, `vname-${variation.id}`)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="bg-transparent text-[14px] font-black uppercase tracking-wide text-black outline-none w-full border-b border-neutral-200 focus:border-indigo-500 pb-1 transition-colors"
          title="Rename"
        />
        {!variation.isCustom && (
          <p className="text-[8.5px] font-mono text-neutral-400 leading-relaxed uppercase tracking-wide">
            Auto — recalculated from this group's source colors. Duplicate it to make a
            user-owned copy.
          </p>
        )}
      </div>

      {/* Export-to-PDF toggle + duplicate / delete */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => update({ enabled: !variation.enabled })}
          className="flex items-center gap-2 border border-neutral-200 rounded-lg px-2.5 h-8 hover:border-neutral-400 transition-colors flex-1 bg-white"
          title={
            side === "logo"
              ? "Include this logo in the exported PDF"
              : "Include this background in the exported PDF"
          }
        >
          <Switch on={variation.enabled} />
          <span className="text-[9px] font-bold uppercase tracking-widest text-neutral-600">
            Export to PDF
          </span>
        </button>
        <button
          onClick={() => actions.duplicateVariation(group.id, side, variation.id)}
          className="h-8 px-2.5 border border-neutral-200 rounded-lg hover:border-neutral-400 hover:bg-neutral-50 text-neutral-500 hover:text-black flex items-center gap-1 transition-colors"
          title="Duplicate"
        >
          <Copy size={12} />
          <span className="text-[9px] font-bold uppercase tracking-widest">Dup</span>
        </button>
        {variation.isCustom && (
          <button
            onClick={() => actions.removeVariation(group.id, side, variation.id)}
            className="h-8 px-2.5 border border-neutral-200 rounded-lg hover:border-[#C75000] hover:bg-orange-50 text-neutral-500 hover:text-[#C75000] flex items-center transition-colors"
            title="Delete (⌫)"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      <BuildClipboard
        coloring={variation.coloring}
        hasClipboard={hasClipboard}
        onPaste={(coloring) => update({ coloring })}
      />

      <div className="h-px bg-neutral-100" />

      <PaintEditor
        coloring={variation.coloring}
        onChange={(coloring) => update({ coloring }, `vcol-${variation.id}`)}
        allowSlotEdit={side === "bg" && variation.isCustom}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Build clipboard
// ---------------------------------------------------------------------------

/** Small animated toggle (visual only — wrap it in a button/label). */
function Switch({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        "relative inline-block w-7 h-4 rounded-full transition-colors shrink-0",
        on ? "bg-indigo-600" : "bg-neutral-300",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all",
          on ? "left-3.5" : "left-0.5",
        )}
      />
    </span>
  );
}

/** Copy / paste buttons for a whole coloring (internal build clipboard). */
function BuildClipboard({
  coloring,
  hasClipboard,
  onPaste,
  className,
  compact = false,
}: {
  coloring: Coloring;
  hasClipboard: boolean;
  onPaste: (coloring: Coloring) => void;
  className?: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    actions.copyColoring(coloring);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const paste = () => {
    const c = getClipboardColoring();
    if (c) onPaste(c);
  };
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <button
        onClick={copy}
        className={cn(
          "h-8 px-2 border rounded-lg flex items-center justify-center gap-1 transition-colors flex-1",
          copied
            ? "border-emerald-300 bg-emerald-50 text-emerald-700"
            : "border-neutral-200 bg-white hover:border-neutral-400 hover:bg-neutral-50 text-neutral-500 hover:text-black",
        )}
        title="Copy this ink build (also puts the CMYK values on the OS clipboard)"
      >
        {copied ? <Check size={12} /> : <ClipboardCopy size={12} />}
        {!compact && (
          <span className="text-[9px] font-bold uppercase tracking-widest">
            {copied ? "Copied" : "Copy build"}
          </span>
        )}
      </button>
      <button
        onClick={paste}
        disabled={!hasClipboard}
        className={cn(
          "h-8 px-2 border rounded-lg flex items-center justify-center gap-1 transition-colors flex-1",
          hasClipboard
            ? "border-neutral-200 bg-white hover:border-neutral-400 hover:bg-neutral-50 text-neutral-500 hover:text-black"
            : "border-neutral-100 text-neutral-300 cursor-default",
        )}
        title="Paste the copied ink build here"
      >
        <ClipboardPaste size={12} />
        {!compact && <span className="text-[9px] font-bold uppercase tracking-widest">Paste</span>}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cell panel
// ---------------------------------------------------------------------------

function CellPanel({
  group,
  logoVar,
  bgVar,
}: {
  group: LogoGroup;
  logoVar: Variation;
  bgVar: Variation;
}) {
  const overrides = group.overrides;
  const hasClipboard = useAppState((s) => s.hasClipboard);

  const cellId = `${logoVar.id}-${bgVar.id}`;
  const override = overrides[cellId];
  const isExcluded = !!override?.disabled;
  const hasSpecChange = !!override && (override.logo !== undefined || override.bg !== undefined);

  const logoColoring = override?.logo ?? logoColoringForGroup(logoVar, group);
  const bgColoring = effectiveColoring(bgVar, override, "bg");
  const bgArtwork = bgVar.bgArtwork ?? null;

  const logoSvg = useMemo(
    () => renderArtworkSvg(group.logoArtwork, logoColoring),
    [group.logoArtwork, logoColoring],
  );
  const bgSvg = useMemo(
    () =>
      bgArtwork
        ? // Painted in its own colors, stretched to the preview (matches the PDF).
          renderArtworkSvg(bgArtwork, artworkOwnColoring(bgArtwork), {
            preserveAspectRatio: "none",
          })
        : null,
    [bgArtwork],
  );

  return (
    <>
      {/* Live proof preview */}
      <div
        className={cn(
          "h-32 w-full flex items-center justify-center border border-neutral-200 rounded-lg relative overflow-hidden shrink-0 shadow-sm",
          isExcluded && "opacity-40 grayscale",
        )}
        style={{ background: coloringToCss(bgColoring) }}
      >
        {bgSvg && (
          <div
            className="absolute inset-0 w-full h-full [&>svg]:w-full [&>svg]:h-full pointer-events-none"
            dangerouslySetInnerHTML={{ __html: bgSvg }}
          />
        )}
        <span className="absolute top-1.5 left-2 text-[7.5px] font-mono text-black/50 uppercase tracking-widest z-10 bg-white/70 rounded-full px-1.5 py-0.5">
          Live Proof
        </span>
        <div
          className="w-16 h-16 z-10 [&>svg]:w-full [&>svg]:h-full"
          dangerouslySetInnerHTML={{ __html: logoSvg }}
        />
      </div>

      {/* Cell status + actions */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() =>
            actions.setOverride(
              group.id,
              cellId,
              isExcluded
                ? override?.logo || override?.bg
                  ? { ...override, disabled: false }
                  : null
                : { ...override, disabled: true },
            )
          }
          className={cn(
            "h-8 px-2.5 border rounded-md flex items-center gap-1.5 transition-colors flex-1",
            isExcluded
              ? "border-black bg-black text-white hover:bg-neutral-800"
              : "border-neutral-200 bg-white hover:border-neutral-400 hover:bg-neutral-50 text-neutral-600 hover:text-black",
          )}
          title="Excluded cells are crossed off the printed sheet"
        >
          {isExcluded ? <Eye size={12} /> : <EyeOff size={12} />}
          <span className="text-[9px] font-bold uppercase tracking-widest">
            {isExcluded ? "Restore cell" : "Exclude cell"}
          </span>
        </button>
        {hasSpecChange && (
          <button
            onClick={() =>
              actions.setOverride(group.id, cellId, isExcluded ? { disabled: true } : null)
            }
            className="h-8 px-2.5 border border-neutral-200 rounded-md bg-white hover:border-neutral-400 hover:bg-neutral-50 text-neutral-500 hover:text-black flex items-center gap-1.5 transition-colors"
            title="Discard the per-cell colors and follow the row/column spec"
          >
            <RotateCcw size={12} />
            <span className="text-[9px] font-bold uppercase tracking-widest">Reset to spec</span>
          </button>
        )}
      </div>

      {hasSpecChange && (
        <div className="flex items-center gap-1.5 border border-neutral-200 rounded-md bg-pink-50/50 px-2.5 py-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-[#E6007E] shrink-0" />
          <span className="font-mono text-[7.5px] font-bold tracking-tight uppercase text-neutral-700">
            Spec adjusted — this cell deviates from its row/column
          </span>
        </div>
      )}

      {/* Per-side editors (live, undoable) */}
      <section>
        <div className="flex items-center justify-between mb-1.5">
          <h4 className="text-[9px] font-black text-black uppercase tracking-wider truncate mr-2">
            Logo · {logoVar.name}
          </h4>
          <BuildClipboard
            coloring={logoColoring}
            hasClipboard={hasClipboard}
            onPaste={(coloring) =>
              actions.setOverride(group.id, cellId, { ...override, logo: coloring, disabled: false })
            }
            compact
            className="shrink-0 [&>button]:flex-none [&>button]:h-6"
          />
        </div>
        <PaintEditor
          coloring={logoColoring}
          onChange={(coloring) =>
            actions.setOverride(
              group.id,
              cellId,
              { ...override, logo: coloring, disabled: false },
              `ov-logo-${cellId}`,
            )
          }
        />
      </section>

      <section>
        <div className="flex items-center justify-between mb-1.5">
          <h4 className="text-[9px] font-black text-black uppercase tracking-wider truncate mr-2">
            Background · {bgVar.name}
          </h4>
          <BuildClipboard
            coloring={bgColoring}
            hasClipboard={hasClipboard}
            onPaste={(coloring) =>
              actions.setOverride(group.id, cellId, { ...override, bg: coloring, disabled: false })
            }
            compact
            className="shrink-0 [&>button]:flex-none [&>button]:h-6"
          />
        </div>
        <PaintEditor
          coloring={bgColoring}
          onChange={(coloring) =>
            actions.setOverride(
              group.id,
              cellId,
              { ...override, bg: coloring, disabled: false },
              `ov-bg-${cellId}`,
            )
          }
          allowSlotEdit
        />
      </section>
    </>
  );
}
