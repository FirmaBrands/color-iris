import { useRef } from "react";
import type { CMYK } from "../types";
import { cn } from "../lib/cn";
import { clamp } from "../color/convert";
import { cmykToHex } from "../color/simulate";

const CHANNELS = [
  { label: "C", key: "c", chip: "bg-[#009FDF] text-white" },
  { label: "M", key: "m", chip: "bg-[#E6007E] text-white" },
  { label: "Y", key: "y", chip: "bg-[#FFE600] text-black" },
  { label: "K", key: "k", chip: "bg-[#221E1F] text-white" },
] as const;

/**
 * Four-channel CMYK editor. Each channel is a slider whose track previews
 * the simulated on-paper result of sweeping that channel 0→100 while the
 * others stay put. The chip scrubs (drag up/down, Shift = 5× steps) and the
 * number field takes exact values; arrow keys nudge.
 */
export function CMYKField({
  cmyk,
  onChange,
}: {
  cmyk: CMYK;
  onChange: (updated: CMYK) => void;
}) {
  const scrub = useRef({ y: 0, val: 0, active: false, key: "" });

  return (
    <div className="flex flex-col gap-1.5">
      {CHANNELS.map(({ label, key, chip }) => {
        const val = cmyk[key];
        const set = (v: number) => onChange({ ...cmyk, [key]: clamp(Math.round(v), 0, 100) });
        const track = `linear-gradient(to right, ${cmykToHex({ ...cmyk, [key]: 0 })}, ${cmykToHex(
          { ...cmyk, [key]: 100 },
        )})`;
        return (
          <div key={key} className="flex items-center gap-2">
            <span
              className={cn(
                "w-5 h-5 shrink-0 rounded-[5px] flex items-center justify-center text-[9px] font-black select-none cursor-ns-resize shadow-sm",
                chip,
              )}
              title="Drag up/down to scrub · Shift = 5× steps"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                scrub.current = { y: e.clientY, val, active: true, key };
              }}
              onPointerMove={(e) => {
                if (!scrub.current.active || scrub.current.key !== key) return;
                const delta = scrub.current.y - e.clientY;
                const step = e.shiftKey ? 5 : 1;
                set(scrub.current.val + Math.round(delta / 3) * step);
              }}
              onPointerUp={(e) => {
                if (scrub.current.active) {
                  scrub.current.active = false;
                  e.currentTarget.releasePointerCapture(e.pointerId);
                }
              }}
            >
              {label}
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={val}
              onChange={(e) => set(parseInt(e.target.value, 10))}
              className="ci-range flex-1 min-w-0"
              style={{ background: track }}
              title={`${label} ${val}%`}
            />
            <div className="flex items-center h-6 border border-neutral-200 rounded-md bg-white shrink-0 focus-within:border-indigo-500 transition-colors">
              <input
                type="number"
                min={0}
                max={100}
                value={val}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  set(isNaN(v) ? 0 : v);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    e.preventDefault();
                    const dir = e.key === "ArrowUp" ? 1 : -1;
                    set(val + dir * (e.shiftKey ? 5 : 1));
                  }
                }}
                className="w-8 text-right font-mono text-[11px] font-bold px-1 bg-transparent border-0 outline-none focus:ring-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
