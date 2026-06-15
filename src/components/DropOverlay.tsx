import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Layers } from "lucide-react";
import { cn } from "../lib/cn";
import { actions, getState } from "../state/store";

function readSvgFile(file: File | undefined, onText: (text: string) => void) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === "string") onText(reader.result);
  };
  reader.readAsText(file);
}

/**
 * Full-window drag-and-drop target. Dragging a file over the app reveals two
 * zones — drop on the left to load it as the logo, on the right as the
 * background texture.
 */
export function DropOverlay() {
  const [active, setActive] = useState(false);
  const [hover, setHover] = useState<"logo" | "bg" | null>(null);
  const depth = useRef(0);

  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types?.includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current += 1;
      setActive(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setActive(false);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      // Zones handle their own drops; this prevents the browser from
      // navigating to the file when dropped anywhere else.
      e.preventDefault();
      depth.current = 0;
      setActive(false);
      setHover(null);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  if (!active) return null;

  const zone = (
    side: "logo" | "bg",
    label: string,
    hint: string,
    Icon: typeof ImageIcon,
  ) => (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setHover(side);
      }}
      onDragLeave={() => setHover((h) => (h === side ? null : h))}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        depth.current = 0;
        setActive(false);
        setHover(null);
        const group = getState().groups[0];
        readSvgFile(e.dataTransfer?.files?.[0], (text) =>
          side === "logo"
            ? actions.loadLogoSvg(group.id, text)
            : actions.loadRowBgSvg(group.id, group.bgVariations[0]?.id ?? "", text),
        );
      }}
      className={cn(
        "flex-1 m-5 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center gap-3 transition-all",
        hover === side
          ? "border-indigo-600 bg-white shadow-lg"
          : "border-neutral-400 bg-white/70 hover:border-neutral-700",
      )}
    >
      <Icon className="w-7 h-7" strokeWidth={1.5} />
      <span className="text-[13px] font-black uppercase tracking-[0.2em]">{label}</span>
      <span className="text-[9px] font-mono text-neutral-500 uppercase tracking-widest">
        {hint}
      </span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[300] bg-[#F4F4F3]/85 backdrop-blur-[2px] flex flex-col">
      <div className="text-center pt-8">
        <span className="text-[10px] font-mono font-bold uppercase tracking-[0.3em] text-neutral-500">
          Drop SVG to load
        </span>
      </div>
      <div className="flex-1 flex">
        {zone("logo", "Logo", "Replaces the first group's artwork & colors", ImageIcon)}
        {zone("bg", "Background", "Texture behind the first group's first row", Layers)}
      </div>
    </div>
  );
}
