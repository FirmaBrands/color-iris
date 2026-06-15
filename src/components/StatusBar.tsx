import { useState } from "react";
import { Keyboard } from "lucide-react";
import { cn } from "../lib/cn";
import { exceedsTac } from "../lib/coloring";
import { actions, useAppState, type Zoom } from "../state/store";

const ZOOM_LABELS: Array<{ z: Zoom; label: string }> = [
  { z: 0, label: "S" },
  { z: 1, label: "M" },
  { z: 2, label: "L" },
];

const SHORTCUTS: Array<[string, string]> = [
  ["⌘Z / ⇧⌘Z", "Undo / redo"],
  ["⌘E", "Generate PDF"],
  ["↑ ↓ ← →", "Walk the matrix"],
  ["⌫", "Clear override / delete custom"],
  ["Esc", "Close inspector"],
  ["Drag SVG", "Load logo or background"],
];

/** Bottom status bar: sheet stats, autosave state and the cell-density zoom. */
export function StatusBar() {
  const [showKeys, setShowKeys] = useState(false);
  const logoVariations = useAppState((s) => s.logoVariations);
  const bgVariations = useAppState((s) => s.bgVariations);
  const overrides = useAppState((s) => s.overrides);
  const zoom = useAppState((s) => s.zoom);
  const savedAt = useAppState((s) => s.savedAt);

  const logoScale = useAppState((s) => s.logoScale);
  const cols = logoVariations.filter((v) => v.enabled).length;
  const rows = bgVariations.filter((v) => v.enabled).length;
  const overrideCount = Object.keys(overrides).length;
  const tacWarnings =
    logoVariations.filter((v) => exceedsTac(v.coloring)).length +
    bgVariations.filter((v) => exceedsTac(v.coloring)).length;

  return (
    <footer className="h-8 shrink-0 border-t border-neutral-200 bg-white flex items-center justify-between px-4 select-none">
      <div className="flex items-center gap-3 text-[8.5px] font-mono font-bold uppercase tracking-widest text-neutral-400 min-w-0">
        <span title="Active profiles × surfaces on the sheet">
          {cols} × {rows} <span className="hidden sm:inline">on sheet</span>
        </span>
        <span className="h-3 w-px bg-neutral-200" />
        <span title="Cells deviating from their row/column spec">
          {overrideCount} {overrideCount === 1 ? "override" : "overrides"}
        </span>
        <span className="h-3 w-px bg-neutral-200" />
        <span
          className={cn(tacWarnings > 0 && "text-[#C75000]")}
          title="Variations whose ink coverage exceeds the 300% coated-stock limit"
        >
          {tacWarnings} TAC {tacWarnings === 1 ? "warning" : "warnings"}
        </span>
        {savedAt && (
          <>
            <span className="h-3 w-px bg-neutral-200 hidden md:block" />
            <span className="hidden md:inline" title="Autosaved to this browser">
              Saved{" "}
              {new Date(savedAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-3">
        <span
          className="hidden lg:block text-[8.5px] font-mono font-bold uppercase tracking-widest text-neutral-400"
          title="On-screen simulation parameters"
        >
          Sim · Coated SWOP · Dot gain 14%
        </span>
        <div
          className="flex items-center gap-1.5"
          title="Logo size as a fraction of each cell (matches the printed sheet)"
        >
          <span className="text-[8.5px] font-mono font-bold uppercase tracking-widest text-neutral-400">
            Logo
          </span>
          <input
            type="range"
            min={20}
            max={100}
            step={1}
            value={Math.round(logoScale * 100)}
            onChange={(e) => actions.setLogoScale(parseInt(e.target.value, 10) / 100)}
            className="ci-range w-20"
            style={{ background: "linear-gradient(to right, #d4d4d4, #525252)" }}
          />
          <span className="text-[8.5px] font-mono font-bold text-neutral-500 w-7">
            {Math.round(logoScale * 100)}%
          </span>
        </div>
        <div className="flex items-center gap-1.5" title="Cell density">
          <span className="text-[8.5px] font-mono font-bold uppercase tracking-widest text-neutral-400">
            Cells
          </span>
          <div className="flex border border-neutral-200 rounded-md overflow-hidden">
            {ZOOM_LABELS.map(({ z, label }) => (
              <button
                key={z}
                onClick={() => actions.setZoom(z)}
                className={cn(
                  "h-5 w-6 text-[8.5px] font-bold transition-all",
                  z === zoom
                    ? "bg-neutral-900 text-white"
                    : "bg-white text-neutral-500 hover:text-black hover:bg-neutral-50",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Keyboard shortcuts */}
        <div className="relative">
          <button
            onClick={() => setShowKeys((v) => !v)}
            className={cn(
              "p-1 rounded-md transition-colors",
              showKeys ? "bg-neutral-900 text-white" : "text-neutral-400 hover:text-black hover:bg-neutral-100",
            )}
            title="Keyboard shortcuts"
          >
            <Keyboard size={13} />
          </button>
          {showKeys && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowKeys(false)} />
              <div className="absolute bottom-[calc(100%+8px)] right-0 z-50 bg-white border border-neutral-200 rounded-lg shadow-xl p-3 w-[230px]">
                <p className="text-[8.5px] font-mono font-bold uppercase tracking-widest text-neutral-400 mb-2">
                  Shortcuts
                </p>
                <div className="flex flex-col gap-1.5">
                  {SHORTCUTS.map(([keys, what]) => (
                    <div key={keys} className="flex items-center justify-between gap-2">
                      <span className="text-[9.5px] font-mono font-bold text-neutral-700 bg-neutral-100 rounded px-1.5 py-0.5">
                        {keys}
                      </span>
                      <span className="text-[9px] text-neutral-500 text-right">{what}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </footer>
  );
}
