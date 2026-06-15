import { ArrowDown, ArrowRight } from "lucide-react";

/**
 * Top-left corner of the matrix. Sources (logos, textures, master colors)
 * live in the group bands, so this is a simple orientation cell.
 */
export function OriginCell() {
  return (
    <div className="bg-neutral-50 border-r border-b border-neutral-200 sticky left-0 top-0 z-[60] select-none h-full w-full flex flex-col items-start justify-between p-3">
      <div className="flex items-center gap-1 text-neutral-400">
        <span className="text-[8.5px] font-mono font-bold uppercase tracking-widest">
          Profiles
        </span>
        <ArrowRight size={9} />
      </div>
      <div className="flex items-center gap-1 text-neutral-400">
        <span className="text-[8.5px] font-mono font-bold uppercase tracking-widest">
          Surfaces
        </span>
        <ArrowDown size={9} />
      </div>
    </div>
  );
}
