import { useMemo, useRef, useState } from "react";
import { Plus, Trash2, Upload, X } from "lucide-react";
import type { LogoGroup } from "../types";
import { cn } from "../lib/cn";
import { hexToRgb, rgbToCmyk } from "../color/convert";
import { formatCmyk } from "../lib/coloring";
import { actions } from "../state/store";
import { renderArtworkSvg } from "../svg/render";

/** Muted accent per section, cycled — bands and their rows share it. */
const GROUP_ACCENTS = ["#4F46E5", "#0D9488", "#D97706", "#BE185D", "#7C3AED", "#15803D"];

export function groupAccent(index: number): string {
  return GROUP_ACCENTS[index % GROUP_ACCENTS.length];
}

function readSvgFile(file: File | undefined, onText: (text: string) => void) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === "string") onText(reader.result);
  };
  reader.readAsText(file);
}

/** Click-or-drop SVG upload wrapper around arbitrary content. */
function UploadTarget({
  onLoad,
  title,
  className,
  children,
}: {
  onLoad: (svgText: string) => void;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        readSvgFile(e.dataTransfer?.files?.[0], onLoad);
      }}
      className={cn(className, isDragOver && "ring-2 ring-indigo-500 ring-offset-1")}
      title={title}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".svg,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          readSvgFile(e.target.files?.[0], onLoad);
          e.target.value = "";
        }}
      />
      {children}
    </div>
  );
}

/** Tiny caption before a control cluster. */
function ClusterLabel({ text }: { text: string }) {
  return (
    <span className="text-[7.5px] font-mono font-bold uppercase tracking-widest text-neutral-400 shrink-0">
      {text}
    </span>
  );
}

function ColorChip({
  hex,
  label,
  onChange,
}: {
  hex: string;
  label: string;
  onChange: (hex: string) => void;
}) {
  return (
    <div
      className="relative w-6 h-6 rounded-md ring-1 ring-black/15 hover:ring-black/40 transition-all cursor-pointer overflow-hidden shrink-0 shadow-sm"
      style={{ backgroundColor: hex }}
      title={`Source color ${label} — click to edit`}
    >
      <input
        type="color"
        value={hex}
        onChange={(e) => onChange(e.target.value)}
        className="absolute -inset-2 w-[150%] h-[150%] cursor-pointer p-0 m-0 outline-none opacity-0"
      />
    </div>
  );
}

/**
 * Section band above a group's surface rows: numbered badge + name, the
 * group's logo (thumbnail, click to replace), its editable source colors,
 * the optional background texture, and row management. The accent color
 * continues down the section's row headers.
 */
export function GroupBand({
  group,
  index,
  canDelete,
}: {
  group: LogoGroup;
  index: number;
  canDelete: boolean;
}) {
  const accent = groupAccent(index);

  // Thumbnail of the section's logo through the print simulation.
  const thumbSvg = useMemo(
    () =>
      renderArtworkSvg(group.logoArtwork, {
        slots: group.masterHexes.map((hex) => rgbToCmyk(hexToRgb(hex))),
        wash: null,
      }),
    [group.logoArtwork, group.masterHexes],
  );

  return (
    <div
      className="border-b border-t border-neutral-200 bg-neutral-50"
      style={{ gridColumn: "1 / -1", borderLeft: `3px solid ${accent}` }}
    >
      {/* Sticky so the controls stay visible while scrolling horizontally. */}
      <div className="sticky left-0 h-full flex items-center gap-2 px-2.5 w-fit max-w-full overflow-x-auto custom-scrollbar">
        <span
          className="w-5 h-5 rounded-full text-white text-[9.5px] font-black flex items-center justify-center shrink-0"
          style={{ backgroundColor: accent }}
          title={`Section ${index + 1}`}
        >
          {index + 1}
        </span>
        <input
          value={group.name}
          onChange={(e) => actions.renameGroup(group.id, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="bg-transparent text-[11px] font-black uppercase tracking-wide text-black outline-none w-[84px] truncate border-b border-transparent focus:border-indigo-500 transition-colors shrink-0"
          title="Rename this section"
        />

        <span className="h-5 w-px bg-neutral-200 shrink-0" />

        {/* Logo: thumbnail = current artwork; click to replace */}
        <ClusterLabel text="Logo" />
        <UploadTarget
          onLoad={(svg) => actions.loadLogoSvg(group.id, svg)}
          title="This section's logo — click (or drop an SVG) to replace it"
          className="relative w-8 h-8 bg-white border border-neutral-300 rounded-md p-1 cursor-pointer hover:border-neutral-600 transition-colors shrink-0 group/thumb shadow-sm"
        >
          {group.logoIsDefault ? (
            <div className="w-full h-full flex items-center justify-center text-neutral-400 pointer-events-none">
              <Upload size={14} />
            </div>
          ) : (
            <div
              className="w-full h-full [&>svg]:w-full [&>svg]:h-full pointer-events-none"
              dangerouslySetInnerHTML={{ __html: thumbSvg }}
            />
          )}
          <span className="absolute inset-0 rounded-md bg-black/55 text-white opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
            <Upload size={11} />
          </span>
        </UploadTarget>

        {/* Source colors extracted from the logo */}
        <ClusterLabel text="Colors" />
        <div className="flex items-center gap-1 shrink-0">
          {group.masterHexes.map((hex, i) => (
            <ColorChip
              key={i}
              hex={hex}
              label={`C${i + 1}`}
              onChange={(h) => actions.setMasterHex(group.id, i, h)}
            />
          ))}
        </div>

        {/* This group's CMYK ink builds (separated from its source colors) */}
        <ClusterLabel text="CMYK" />
        <div className="flex flex-col justify-center gap-0.5 shrink-0">
          {group.masterHexes.map((hex, i) => (
            <span
              key={i}
              className="font-mono text-[8px] font-bold tracking-tight text-neutral-600 leading-none whitespace-nowrap"
              title={`Source color C${i + 1} as a CMYK build`}
            >
              {formatCmyk(rgbToCmyk(hexToRgb(hex)))}
            </span>
          ))}
        </div>

        <span className="h-5 w-px bg-neutral-200 shrink-0" />

        {/* Background texture behind this section's rows */}
        <ClusterLabel text="Texture" />
        <UploadTarget
          onLoad={(svg) => actions.loadBgSvg(group.id, svg)}
          title="Background texture behind this section's cells — click or drop an SVG"
          className={cn(
            "flex items-center gap-1 px-2 h-6 border rounded-md text-[8.5px] font-bold uppercase tracking-wider cursor-pointer bg-white transition-colors shrink-0 shadow-sm",
            group.bgArtwork
              ? "border-neutral-400 text-neutral-800"
              : "border-neutral-300 text-neutral-500 hover:border-neutral-600",
          )}
        >
          {group.bgArtwork ? "Loaded ✓" : "None"}
        </UploadTarget>
        {group.bgArtwork && (
          <button
            onClick={() => actions.clearBgArtwork(group.id)}
            className="p-1 border border-neutral-300 rounded-md bg-white hover:border-black text-neutral-400 hover:text-black transition-colors shrink-0"
            title="Remove the background texture"
          >
            <X size={10} />
          </button>
        )}

        <span className="h-5 w-px bg-neutral-200 shrink-0" />

        <button
          onClick={() => actions.addVariation("bg", group.id)}
          className="flex items-center gap-1 px-2 h-6 border border-neutral-300 rounded-md bg-white hover:border-neutral-900 text-neutral-500 hover:text-black text-[8.5px] font-bold uppercase tracking-wider transition-colors shrink-0 shadow-sm"
          title="Add a surface row to this section"
        >
          <Plus size={10} />
          Row
        </button>
        {canDelete && (
          <button
            onClick={() => actions.removeGroup(group.id)}
            className="p-1 border border-neutral-300 rounded-md bg-white hover:border-[#C75000] text-neutral-400 hover:text-[#C75000] transition-colors shrink-0"
            title="Delete this section (its rows move to the first section)"
          >
            <Trash2 size={10} />
          </button>
        )}
      </div>
    </div>
  );
}
