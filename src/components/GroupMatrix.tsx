import { Fragment } from "react";
import { ArrowDown, ArrowRight, Plus } from "lucide-react";
import type { LogoGroup } from "../types";
import { actions, useAppState } from "../state/store";
import { GroupBand, groupAccent } from "./GroupBand";
import { PreviewCell } from "./PreviewCell";
import { VariationHeader } from "./VariationHeader";

/** Matrix track sizes per zoom level (S / M / L). */
export const COL_MIN = [148, 184, 232];
export const ROW_MIN = [92, 120, 156];

/**
 * One self-contained group: its header band plus its own mini-matrix of
 * profiles (columns) × surfaces (rows). Each group manages its own profiles,
 * rows and per-row backgrounds independently of the others.
 */
export function GroupMatrix({
  group,
  index,
  canDelete,
}: {
  group: LogoGroup;
  index: number;
  canDelete: boolean;
}) {
  const zoom = useAppState((s) => s.zoom);
  const logoScale = useAppState((s) => s.logoScale);
  const accent = groupAccent(index);

  const cols = group.logoVariations;
  const rows = group.bgVariations;

  const gridTemplateColumns = `200px repeat(${cols.length}, minmax(${COL_MIN[zoom]}px, 1fr)) 132px`;
  const gridTemplateRows =
    rows.length > 0
      ? `120px repeat(${rows.length}, minmax(${ROW_MIN[zoom]}px, 1fr)) 48px`
      : `120px 48px`;

  return (
    <section className="bg-white border border-neutral-200 rounded-xl shadow-sm overflow-hidden">
      <GroupBand group={group} index={index} canDelete={canDelete} />
      <div className="overflow-x-auto custom-scrollbar">
        <div
          className="min-w-full"
          style={{ display: "grid", gridTemplateColumns, gridTemplateRows }}
        >
          {/* Corner: orientation */}
          <div className="bg-neutral-50 border-r border-b border-neutral-200 sticky left-0 z-40 select-none flex flex-col items-start justify-between p-3">
            <div className="flex items-center gap-1 text-neutral-500">
              <span className="text-[9.5px] font-mono font-bold uppercase tracking-widest">
                Logos
              </span>
              <ArrowRight size={10} />
            </div>
            <div className="flex items-center gap-1 text-neutral-500">
              <span className="text-[9.5px] font-mono font-bold uppercase tracking-widest">
                Backgrounds
              </span>
              <ArrowDown size={10} />
            </div>
          </div>

          {/* Column headers: this group's logo profiles */}
          {cols.map((v) => (
            <VariationHeader
              key={v.id}
              variation={v}
              side="logo"
              groupId={group.id}
              className="border-r border-b border-neutral-200 bg-white"
            />
          ))}

          {/* Add logo column */}
          <div className="bg-neutral-50 border-b border-neutral-200">
            <AddButton label="Logo" onClick={() => actions.addVariation(group.id, "logo")} />
          </div>

          {/* Surface rows */}
          {rows.map((bgVar) => (
            <Fragment key={bgVar.id}>
              <VariationHeader
                variation={bgVar}
                side="bg"
                groupId={group.id}
                accent={accent}
                className="border-r border-b border-neutral-200 bg-white sticky left-0 z-30"
              />
              {cols.map((logoVar) => (
                <PreviewCell
                  key={`${logoVar.id}-${bgVar.id}`}
                  logoVar={logoVar}
                  bgVar={bgVar}
                  group={group}
                  override={group.overrides[`${logoVar.id}-${bgVar.id}`]}
                  logoScale={logoScale}
                />
              ))}
              <div className="border-b border-neutral-200 bg-neutral-50" />
            </Fragment>
          ))}

          {/* Add-row button lives in the row (left) column */}
          <div className="bg-neutral-50 border-r border-neutral-200 sticky left-0 z-30">
            <AddButton
              label="Background"
              title="Add a background to this group (starts as paper white)"
              onClick={() => actions.addVariation(group.id, "bg")}
            />
          </div>
          <div className="bg-neutral-50" style={{ gridColumn: "2 / -1" }} />
        </div>
      </div>
    </section>
  );
}

/** "+" track button that adds a new white profile/surface immediately. */
export function AddButton({
  label,
  onClick,
  title,
}: {
  label: string;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      className="w-full h-full flex items-center justify-center gap-2.5 hover:bg-neutral-100 transition-colors cursor-pointer group px-3"
      onClick={onClick}
      title={title ?? `Add a ${label.toLowerCase()} (starts as paper white)`}
    >
      <div className="w-7 h-7 shrink-0 bg-white border border-neutral-300 rounded-full flex items-center justify-center group-hover:border-neutral-900 group-hover:bg-neutral-900 group-hover:text-white transition-all shadow-sm">
        <Plus className="w-3.5 h-3.5" />
      </div>
      <span className="text-[9.5px] font-bold uppercase tracking-widest text-neutral-500 group-hover:text-black transition-colors whitespace-nowrap">
        {label}
      </span>
    </button>
  );
}
