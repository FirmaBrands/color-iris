import { useRef, useState } from "react";
import { Check, Copy, Minus, Plus, Trash2 } from "lucide-react";
import type { CMYK, Coloring, Paint, Stop } from "../types";
import { DEFAULT_WASH_ANGLE } from "../types";
import { cn } from "../lib/cn";
import { clamp, hexToRgb, rgbToCmyk, tac, TAC_LIMIT } from "../color/convert";
import { cmykToHex, stopsToCss } from "../color/simulate";
import { formatCmyk, maxTac } from "../lib/coloring";
import { CMYKField } from "./CMYKField";

/**
 * Edits a full `Coloring` with a select-then-edit flow:
 * - flat colorings — a strip of slot swatches; click one, edit it below
 * - gradient colorings — a live gradient bar with draggable stop handles, a
 *   linear/radial switch and an angle control for linear washes
 * The editor follows whatever the coloring already is; it does not convert
 * between flat and gradient.
 */
export function PaintEditor({
  coloring,
  onChange,
  allowSlotEdit = false,
}: {
  coloring: Coloring;
  onChange: (next: Coloring) => void;
  /** Allow adding/removing slots (multi-color flat surfaces). */
  allowSlotEdit?: boolean;
}) {
  const [selected, setSelected] = useState(0);
  const [copied, setCopied] = useState(false);

  const wash = coloring.wash;
  const gradientWash = wash && wash.kind !== "solid" ? wash : null;
  const isGradient = gradientWash !== null;

  const count = isGradient ? gradientWash.stops.length : coloring.slots.length;
  const sel = Math.min(selected, Math.max(0, count - 1));

  const setWash = (w: Paint | null) => onChange({ ...coloring, wash: w });

  const updateStop = (i: number, stop: Stop) => {
    if (!gradientWash) return;
    setWash({
      ...gradientWash,
      stops: gradientWash.stops.map((s, j) => (j === i ? stop : s)),
    });
  };

  const addStop = (offset?: number) => {
    if (!gradientWash) return;
    const src = gradientWash.stops[sel] ?? gradientWash.stops[gradientWash.stops.length - 1];
    const stop: Stop = { cmyk: { ...src.cmyk }, offset: offset ?? clamp(src.offset + 0.25, 0, 1) };
    setSelected(gradientWash.stops.length);
    setWash({ ...gradientWash, stops: [...gradientWash.stops, stop] });
  };

  const selectedCmyk: CMYK = isGradient ? gradientWash.stops[sel].cmyk : coloring.slots[sel];
  const setSelectedCmyk = (c: CMYK) => {
    if (isGradient) updateStop(sel, { ...gradientWash.stops[sel], cmyk: c });
    else onChange({ ...coloring, slots: coloring.slots.map((s, j) => (j === sel ? c : s)) });
  };

  return (
    <div className="flex flex-col gap-2.5">
      {/* Gradient geometry controls */}
      {gradientWash && (
        <div className="flex items-center gap-1.5">
          <Segmented
            options={["Linear", "Radial"]}
            value={gradientWash.kind === "linear" ? 0 : 1}
            onChange={(i) =>
              setWash(
                i === 0
                  ? { kind: "linear", angle: DEFAULT_WASH_ANGLE, stops: gradientWash.stops }
                  : { kind: "radial", stops: gradientWash.stops },
              )
            }
          />
          {gradientWash.kind === "linear" && (
            <div
              className="flex items-center h-6 border border-neutral-200 rounded-md bg-white ml-auto px-1"
              title="Gradient angle (Shift+arrows = 15° steps)"
            >
              <input
                type="number"
                min={0}
                max={360}
                value={Math.round(gradientWash.angle ?? DEFAULT_WASH_ANGLE)}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  setWash({
                    ...gradientWash,
                    angle: ((isNaN(v) ? 0 : v) % 360 + 360) % 360,
                  });
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    e.preventDefault();
                    const dir = e.key === "ArrowUp" ? 1 : -1;
                    const cur = gradientWash.angle ?? DEFAULT_WASH_ANGLE;
                    const next = cur + dir * (e.shiftKey ? 15 : 1);
                    setWash({ ...gradientWash, angle: ((next % 360) + 360) % 360 });
                  }
                }}
                className="w-9 text-right font-mono text-[10px] font-bold bg-transparent border-0 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <span className="text-[9px] text-neutral-400 pl-0.5">°</span>
            </div>
          )}
        </div>
      )}

      {/* Swatch strip / gradient bar */}
      {isGradient ? (
        <GradientBar
          wash={gradientWash}
          selected={sel}
          onSelect={setSelected}
          onMove={(i, offset) => updateStop(i, { ...gradientWash.stops[i], offset })}
          onAdd={(offset) => addStop(offset)}
        />
      ) : (
        <div className="flex items-center gap-1.5 flex-wrap">
          {coloring.slots.map((slot, i) => (
            <button
              key={i}
              onClick={() => setSelected(i)}
              className={cn(
                "w-8 h-8 rounded-md border transition-all",
                i === sel
                  ? "border-indigo-600 ring-2 ring-indigo-600/30"
                  : "border-black/15 hover:border-neutral-500",
              )}
              style={{ backgroundColor: cmykToHex(slot) }}
              title={`C${i + 1} · ${formatCmyk(slot)}`}
            />
          ))}
          {allowSlotEdit && (
            <>
              <button
                onClick={() => {
                  setSelected(coloring.slots.length);
                  onChange({
                    ...coloring,
                    slots: [...coloring.slots, { ...coloring.slots[coloring.slots.length - 1] }],
                  });
                }}
                className="w-8 h-8 rounded-md border border-dashed border-neutral-300 bg-white hover:border-neutral-600 flex items-center justify-center text-neutral-400 hover:text-black transition-colors"
                title="Add a flat surface color (rendered side by side)"
              >
                <Plus size={13} />
              </button>
              {coloring.slots.length > 1 && (
                <button
                  onClick={() => {
                    setSelected(Math.max(0, sel - 1));
                    onChange({
                      ...coloring,
                      slots: coloring.slots.filter((_, j) => j !== sel),
                    });
                  }}
                  className="w-8 h-8 rounded-md border border-dashed border-neutral-300 bg-white hover:border-neutral-600 flex items-center justify-center text-neutral-400 hover:text-black transition-colors"
                  title="Remove the selected color"
                >
                  <Minus size={13} />
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Selected color/stop editor */}
      <div className="border border-neutral-200 bg-neutral-50/70 rounded-lg p-2.5 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[8.5px] font-mono font-bold uppercase tracking-widest text-neutral-500">
            {isGradient ? `Stop ${sel + 1} / ${count}` : count > 1 ? `Color C${sel + 1}` : "Color"}
          </span>
          <div className="flex items-center gap-1.5">
            {isGradient && (
              <>
                <div
                  className="flex items-center h-6 border border-neutral-200 rounded-md bg-white px-1"
                  title="Stop position (%)"
                >
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={Math.round(gradientWash.stops[sel].offset * 100)}
                    onChange={(e) => {
                      const v = clamp(parseInt(e.target.value, 10) || 0, 0, 100) / 100;
                      updateStop(sel, { ...gradientWash.stops[sel], offset: v });
                    }}
                    className="w-8 text-right font-mono text-[10px] font-bold bg-transparent border-0 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="text-[9px] text-neutral-400 pl-0.5">%</span>
                </div>
                <button
                  onClick={() => addStop()}
                  className="h-6 px-2 rounded-md border bg-white text-neutral-600 border-neutral-200 hover:border-neutral-600 hover:text-black text-[8px] font-bold uppercase tracking-widest transition-colors"
                  title="Add gradient stop (or double-click the bar)"
                >
                  + Stop
                </button>
                {gradientWash.stops.length > 2 && (
                  <button
                    onClick={() => {
                      setSelected(Math.max(0, sel - 1));
                      setWash({
                        ...gradientWash,
                        stops: gradientWash.stops.filter((_, j) => j !== sel),
                      });
                    }}
                    className="text-neutral-400 hover:text-red-600 transition-colors"
                    title="Remove stop"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </>
            )}
            <HexInput onApply={setSelectedCmyk} />
          </div>
        </div>

        <CMYKField cmyk={selectedCmyk} onChange={setSelectedCmyk} />

        <div className="flex items-center justify-between">
          <button
            onClick={() => {
              try {
                void navigator.clipboard?.writeText(formatCmyk(selectedCmyk));
              } catch {
                /* OS clipboard is best-effort */
              }
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
            className={cn(
              "flex items-center gap-1 text-[9px] font-mono tracking-wide transition-colors",
              copied ? "text-emerald-600" : "text-neutral-400 hover:text-black",
            )}
            title="Copy CMYK values to the clipboard"
          >
            {formatCmyk(selectedCmyk)}
            {copied ? <Check size={9} /> : <Copy size={9} />}
          </button>
          {tac(selectedCmyk) > TAC_LIMIT && (
            <span
              className="text-[8px] font-black text-[#C75000] tracking-tight whitespace-nowrap"
              title={`Total area coverage ${tac(selectedCmyk)}% exceeds the ${TAC_LIMIT}% coated-stock limit`}
            >
              TAC {tac(selectedCmyk)}
            </span>
          )}
        </div>
      </div>

      <TacMeter value={maxTac(coloring)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Segmented({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: number;
  onChange: (index: number) => void;
}) {
  return (
    <div className="flex h-6 border border-neutral-200 rounded-md overflow-hidden bg-white">
      {options.map((opt, i) => (
        <button
          key={opt}
          onClick={() => onChange(i)}
          className={cn(
            "px-2 text-[8px] font-bold uppercase tracking-widest transition-all",
            i === value ? "bg-neutral-900 text-white" : "text-neutral-500 hover:text-black",
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

/** Always-horizontal gradient preview with draggable stop handles. */
function GradientBar({
  wash,
  selected,
  onSelect,
  onMove,
  onAdd,
}: {
  wash: { kind: "linear" | "radial"; stops: Stop[] };
  selected: number;
  onSelect: (i: number) => void;
  onMove: (i: number, offset: number) => void;
  onAdd: (offset: number) => void;
}) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef({ active: false, index: -1 });

  const sorted = [...wash.stops].sort((a, b) => a.offset - b.offset);
  const css = `linear-gradient(to right, ${stopsToCss(sorted)})`;

  const offsetFromEvent = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return clamp((clientX - rect.left) / rect.width, 0, 1);
  };

  return (
    <div className="pt-1 pb-2.5 px-1">
      <div
        ref={barRef}
        className="relative h-8 rounded-md border border-black/15"
        style={{ background: css }}
        onDoubleClick={(e) => onAdd(offsetFromEvent(e.clientX))}
        title="Drag handles to move stops · double-click to add a stop"
      >
        {wash.stops.map((stop, i) => (
          <div
            key={i}
            className="absolute top-[-4px] bottom-[-8px] w-[14px] -ml-[7px] cursor-ew-resize touch-none flex flex-col items-center"
            style={{ left: `${stop.offset * 100}%` }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { active: true, index: i };
              onSelect(i);
            }}
            onPointerMove={(e) => {
              if (!drag.current.active || drag.current.index !== i) return;
              onMove(i, offsetFromEvent(e.clientX));
            }}
            onPointerUp={(e) => {
              if (drag.current.active) {
                drag.current = { active: false, index: -1 };
                e.currentTarget.releasePointerCapture(e.pointerId);
              }
            }}
          >
            <div
              className={cn(
                "w-[11px] flex-1 rounded-[3px] border-2 bg-clip-padding shadow-sm",
                i === selected
                  ? "border-indigo-600 ring-2 ring-indigo-600/30"
                  : "border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]",
              )}
              style={{ backgroundColor: cmykToHex(stop.cmyk) }}
            />
            <div
              className={cn(
                "w-0 h-0 border-l-[5px] border-r-[5px] border-b-[5px] border-l-transparent border-r-transparent rotate-180",
                i === selected ? "border-b-indigo-600" : "border-b-neutral-400",
              )}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Tiny hex field: type a hex, press Enter, get the SWOP separation. */
function HexInput({ onApply }: { onApply: (cmyk: CMYK) => void }) {
  const [text, setText] = useState("");
  const apply = () => {
    const h = text.trim().replace(/^#/, "");
    if (!/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(h)) return;
    onApply(rgbToCmyk(hexToRgb(`#${h}`)));
    setText("");
  };
  return (
    <div
      className="flex items-center h-6 border border-neutral-200 rounded-md bg-white px-1.5"
      title="Hex → CMYK (SWOP separation), apply with Enter"
    >
      <span className="text-[9px] text-neutral-400">#</span>
      <input
        type="text"
        value={text}
        placeholder="hex"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") apply();
        }}
        onBlur={() => text && apply()}
        className="w-10 font-mono text-[10px] font-bold pl-0.5 bg-transparent border-0 outline-none placeholder-neutral-300 uppercase"
        maxLength={7}
        spellCheck={false}
      />
    </div>
  );
}

/** Total-area-coverage meter with the coated-stock limit marked. */
export function TacMeter({ value }: { value: number }) {
  const scaleMax = 400;
  const pct = clamp(value / scaleMax, 0, 1) * 100;
  const limitPct = (TAC_LIMIT / scaleMax) * 100;
  const over = value > TAC_LIMIT;
  return (
    <div title={`Highest total area coverage in this coloring. Above ${TAC_LIMIT}% expect drying/set-off problems on coated stock.`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[8px] font-mono font-bold uppercase tracking-widest text-neutral-400">
          Max ink coverage
        </span>
        <span
          className={cn(
            "text-[9px] font-mono font-bold",
            over ? "text-[#C75000]" : "text-neutral-500",
          )}
        >
          {Math.round(value)}% / {TAC_LIMIT}%
        </span>
      </div>
      <div className="relative h-1.5 bg-neutral-200 rounded-full">
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full",
            over ? "bg-[#C75000]" : "bg-neutral-700",
          )}
          style={{ width: `${pct}%` }}
        />
        <div
          className="absolute top-[-3px] bottom-[-3px] w-[2px] rounded-full bg-neutral-900"
          style={{ left: `${limitPct}%` }}
        />
      </div>
    </div>
  );
}
