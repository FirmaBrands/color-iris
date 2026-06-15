import { useMemo } from "react";
import { Trash2, Upload } from "lucide-react";
import type { LogoGroup } from "../types";
import { hexToRgb, rgbToCmyk } from "../color/convert";
import { formatCmyk } from "../lib/coloring";
import { actions } from "../state/store";
import { renderArtworkSvg } from "../svg/render";
import { UploadTarget } from "./UploadTarget";

/** Muted accent per section, cycled — bands and their rows share it. */
const GROUP_ACCENTS = ["#4F46E5", "#0D9488", "#D97706", "#BE185D", "#7C3AED", "#15803D"];

export function groupAccent(index: number): string {
  return GROUP_ACCENTS[index % GROUP_ACCENTS.length];
}

/** Tiny caption before a control cluster. */
function ClusterLabel({ text }: { text: string }) {
  return (
    <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-neutral-500 shrink-0">
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
 * Header strip above a group's mini-matrix: numbered badge + name, the
 * group's logo (thumbnail, click to replace), its editable source colors and
 * their CMYK builds, and a delete control. Profiles, rows and per-row
 * backgrounds are managed inside the matrix itself. The accent continues down
 * the section's row headers.
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
      className="border-b border-neutral-200 bg-neutral-50"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      <div className="flex items-center gap-2 px-2.5 py-2 w-full overflow-x-auto custom-scrollbar">
        <span
          className="w-5 h-5 rounded-full text-white text-[9.5px] font-black flex items-center justify-center shrink-0"
          style={{ backgroundColor: accent }}
          title={`Group ${index + 1}`}
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
          title="Rename this group"
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
              className="font-mono text-[10px] font-bold tracking-tight text-neutral-700 leading-tight whitespace-nowrap"
              title={`Source color C${i + 1} as a CMYK build`}
            >
              {formatCmyk(rgbToCmyk(hexToRgb(hex)))}
            </span>
          ))}
        </div>

        {canDelete && (
          <>
            <span className="h-5 w-px bg-neutral-200 shrink-0" />
            <button
              onClick={() => actions.removeGroup(group.id)}
              aria-label="Delete this group"
              className="p-1 border border-neutral-300 rounded-md bg-white hover:border-[#C75000] text-neutral-500 hover:text-[#C75000] transition-colors shrink-0"
              title="Delete this group"
            >
              <Trash2 size={10} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
