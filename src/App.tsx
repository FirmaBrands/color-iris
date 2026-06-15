import { Fragment, useEffect, useRef, useState } from "react";
import { Download, FilePlus2, FolderOpen, Plus, Printer, Redo2, Undo2, X } from "lucide-react";
import { actions, getState, rowsForGroup, useAppState, type Selection } from "./state/store";
import { generateProofPdf } from "./pdf/proof";
import { cn } from "./lib/cn";
import { DropOverlay } from "./components/DropOverlay";
import { GroupBand, groupAccent } from "./components/GroupBand";
import { Inspector } from "./components/Inspector";
import { OriginCell } from "./components/OriginCell";
import { PreviewCell } from "./components/PreviewCell";
import { StatusBar } from "./components/StatusBar";
import { VariationHeader } from "./components/VariationHeader";

/** Matrix track sizes per zoom level (S / M / L). */
const COL_MIN = [148, 184, 232];
const ROW_MIN = [92, 120, 156];

export default function App() {
  const projectName = useAppState((s) => s.projectName);
  const groups = useAppState((s) => s.groups);
  const logoScale = useAppState((s) => s.logoScale);
  const logoVariations = useAppState((s) => s.logoVariations);
  const bgVariations = useAppState((s) => s.bgVariations);
  const overrides = useAppState((s) => s.overrides);
  const loadError = useAppState((s) => s.loadError);
  const selection = useAppState((s) => s.selection);
  const canUndo = useAppState((s) => s.canUndo);
  const canRedo = useAppState((s) => s.canRedo);
  const zoom = useAppState((s) => s.zoom);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    if (!loadError) return;
    const t = setTimeout(actions.dismissError, 5000);
    return () => clearTimeout(t);
  }, [loadError]);

  const handleExport = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const bytes = await generateProofPdf({
        groups,
        logoVariations,
        bgVariations,
        overrides,
        projectName,
        logoScale,
      });
      const blob = new Blob([bytes], { type: "application/pdf" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      const safe = projectName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "sheet";
      link.download = `color-iris-proof-${safe}-${Date.now()}.pdf`;
      link.click();
      URL.revokeObjectURL(link.href);
    } finally {
      setIsExporting(false);
    }
  };

  const handleNew = () => {
    if (window.confirm("Start a new project? The current sheet and its history are discarded.")) {
      actions.resetProject();
    }
  };

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleSaveFile = () => {
    const blob = new Blob([actions.exportProject()], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    const safe = projectName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "untitled";
    link.download = `${safe}.coloriris.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const handleOpenFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") actions.importProject(reader.result);
    };
    reader.readAsText(file);
  };

  // Keyboard: ⌘Z undo, ⇧⌘Z / ⌘Y redo, ⌘E export, Esc deselect,
  // arrows walk the matrix, ⌫ clears an override / deletes a custom variation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inField = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      const typingText =
        target.tagName === "TEXTAREA" ||
        (target.tagName === "INPUT" && (target as HTMLInputElement).type === "text");
      const mod = e.metaKey || e.ctrlKey;

      if (e.key === "Escape") {
        actions.select(null);
        return;
      }
      if (mod && e.key.toLowerCase() === "e") {
        e.preventDefault();
        void handleExport();
        return;
      }

      // Fields own their arrow/delete keys (sliders, numbers, text).
      if (!inField && navigateMatrix(e)) return;
      if (!inField && (e.key === "Delete" || e.key === "Backspace")) {
        e.preventDefault();
        deleteSelection();
        return;
      }

      // Leave native text-field undo alone.
      if (typingText) return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) actions.redo();
        else actions.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        actions.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const rowsOf = (groupId: string) => rowsForGroup(groups, bgVariations, groupId);

  const gridTemplateColumns = `200px repeat(${logoVariations.length}, minmax(${COL_MIN[zoom]}px, 1fr)) 132px`;
  const gridTemplateRows = [
    "120px",
    ...groups.flatMap((g) => [
      "44px",
      ...rowsOf(g.id).map(() => `minmax(${ROW_MIN[zoom]}px, 1fr)`),
    ]),
    "48px",
  ].join(" ");

  return (
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-[#F3F3F1] text-[#141414] font-sans antialiased">
      {/* Toolbar */}
      <header className="h-[56px] shrink-0 border-b border-neutral-200 bg-white flex items-center justify-between px-5 z-50 relative">
        <div className="flex items-center gap-4 min-w-0">
          <span className="text-[13px] font-black uppercase tracking-[0.22em] leading-none whitespace-nowrap">
            Color&nbsp;Iris
          </span>
          <span className="h-5 w-px bg-neutral-200 shrink-0" />
          <div
            className="flex items-center gap-2 min-w-0"
            title="Project name (printed on the proof sheet)"
          >
            <span className="text-[8.5px] font-mono font-bold text-neutral-400 uppercase tracking-widest shrink-0">
              Project
            </span>
            <input
              type="text"
              value={projectName}
              onChange={(e) => actions.setProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="bg-neutral-100 hover:bg-neutral-50 focus:bg-white border border-transparent focus:border-indigo-500 rounded-md px-2 h-8 text-[11px] font-bold text-black uppercase tracking-wide outline-none w-[110px] sm:w-[170px] placeholder-neutral-400 transition-colors"
              placeholder="untitled"
            />
          </div>
          <div className="hidden sm:flex items-center gap-2">
            <div className="flex items-center border border-neutral-200 rounded-lg overflow-hidden bg-white">
              <ToolButton onClick={actions.undo} disabled={!canUndo} title="Undo (⌘Z)">
                <Undo2 size={13} />
              </ToolButton>
              <span className="w-px h-4 bg-neutral-200" />
              <ToolButton onClick={actions.redo} disabled={!canRedo} title="Redo (⇧⌘Z)">
                <Redo2 size={13} />
              </ToolButton>
            </div>
            <div className="flex items-center border border-neutral-200 rounded-lg overflow-hidden bg-white">
              <ToolButton onClick={handleNew} title="New project (clears the autosave)">
                <FilePlus2 size={13} />
              </ToolButton>
              <span className="w-px h-4 bg-neutral-200" />
              <ToolButton onClick={handleSaveFile} title="Save project file (.coloriris.json)">
                <Download size={13} />
              </ToolButton>
              <span className="w-px h-4 bg-neutral-200" />
              <ToolButton onClick={() => fileInputRef.current?.click()} title="Open project file">
                <FolderOpen size={13} />
              </ToolButton>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                handleOpenFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          {loadError && (
            <button
              onClick={actions.dismissError}
              className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-white bg-[#C75000] rounded-md px-2.5 py-1.5"
              title="Dismiss"
            >
              {loadError}
              <X size={10} />
            </button>
          )}
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="flex items-center justify-center gap-1.5 bg-neutral-900 hover:bg-black disabled:opacity-50 text-white h-9 px-4 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all shadow-sm hover:shadow active:scale-[0.98]"
            title="Generate the A3 DeviceCMYK proof sheet (⌘E)"
          >
            <Printer className="w-3.5 h-3.5 text-neutral-300" />
            <span>{isExporting ? "Generating…" : "Generate PDF"}</span>
          </button>
        </div>
      </header>

      {/* Matrix + inspector */}
      <div className="flex-1 flex min-h-0">
        <main className="flex-1 p-3 lg:p-4 min-h-0 min-w-0 relative">
          <div className="w-full h-full bg-white border border-neutral-200 rounded-xl shadow-sm overflow-auto relative custom-scrollbar">
            <div
              className="min-w-full min-h-full"
              style={{ display: "grid", gridTemplateColumns, gridTemplateRows }}
            >
              <OriginCell />

              {/* Column headers: logo profiles */}
              {logoVariations.map((v) => (
                <VariationHeader
                  key={v.id}
                  variation={v}
                  side="logo"
                  className="border-r border-b border-neutral-200 bg-white sticky top-0 z-50"
                />
              ))}

              {/* Add profile column */}
              <div className="bg-neutral-50 border-b border-neutral-200 sticky top-0 z-50">
                <AddButton label="Profile" onClick={() => actions.addVariation("logo")} />
              </div>

              {/* Group sections: band + that group's rows */}
              {groups.map((group, gi) => (
                <Fragment key={group.id}>
                  <GroupBand group={group} index={gi} canDelete={groups.length > 1} />
                  {rowsOf(group.id).map((bgVar) => (
                    <Fragment key={bgVar.id}>
                      <VariationHeader
                        variation={bgVar}
                        side="bg"
                        accent={groupAccent(gi)}
                        className="border-r border-b border-neutral-200 bg-white sticky left-0 z-40"
                      />
                      {logoVariations.map((logoVar) => (
                        <PreviewCell
                          key={`${logoVar.id}-${bgVar.id}`}
                          logoVar={logoVar}
                          bgVar={bgVar}
                          group={group}
                          override={overrides[`${logoVar.id}-${bgVar.id}`]}
                          logoScale={logoScale}
                        />
                      ))}
                      <div className="border-b border-neutral-200 bg-neutral-50" />
                    </Fragment>
                  ))}
                </Fragment>
              ))}

              {/* Bottom track: add a new section */}
              <div className="bg-neutral-50" style={{ gridColumn: "1 / -1" }}>
                <div className="sticky left-0 w-fit h-full">
                  <AddButton
                    label="Logo group"
                    title="Add a new section with its own logo, colors and rows"
                    onClick={() => actions.addGroup()}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* First-run hint */}
          {groups.length === 1 && groups[0].logoIsDefault && (
            <div className="absolute bottom-9 left-1/2 -translate-x-1/2 pointer-events-none z-[70]">
              <div className="bg-neutral-900 text-white rounded-full px-4 py-2 text-[9px] font-bold uppercase tracking-[0.18em] shadow-lg">
                Drop an SVG anywhere to load your logo
              </div>
            </div>
          )}
        </main>

        <Inspector key={selectionKey(selection)} />
      </div>

      <StatusBar />
      <DropOverlay />
    </div>
  );
}

/**
 * Arrow-key navigation over the matrix: cells move in four directions and
 * flow into the column/row headers at the top/left edges. Returns true if
 * the key was handled.
 */
function navigateMatrix(e: KeyboardEvent): boolean {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return false;
  const s = getState();
  const sel = s.selection;
  if (!sel) return false;
  const cols = s.logoVariations;
  // Display order: rows grouped by their logo group.
  const rows = s.groups.flatMap((g) => rowsForGroup(s.groups, s.bgVariations, g.id));
  const cell = (ci: number, ri: number) =>
    actions.select({ kind: "cell", logoId: cols[ci].id, bgId: rows[ri].id });
  const colHead = (ci: number) =>
    actions.select({ kind: "variation", side: "logo", id: cols[ci].id });
  const rowHead = (ri: number) => actions.select({ kind: "variation", side: "bg", id: rows[ri].id });

  e.preventDefault();
  if (sel.kind === "variation") {
    if (sel.side === "logo") {
      const ci = cols.findIndex((v) => v.id === sel.id);
      if (ci === -1) return true;
      if (e.key === "ArrowLeft" && ci > 0) colHead(ci - 1);
      else if (e.key === "ArrowRight" && ci < cols.length - 1) colHead(ci + 1);
      else if (e.key === "ArrowDown" && rows.length > 0) cell(ci, 0);
    } else {
      const ri = rows.findIndex((v) => v.id === sel.id);
      if (ri === -1) return true;
      if (e.key === "ArrowUp" && ri > 0) rowHead(ri - 1);
      else if (e.key === "ArrowDown" && ri < rows.length - 1) rowHead(ri + 1);
      else if (e.key === "ArrowRight" && cols.length > 0) cell(0, ri);
    }
    return true;
  }

  const ci = cols.findIndex((v) => v.id === sel.logoId);
  const ri = rows.findIndex((v) => v.id === sel.bgId);
  if (ci === -1 || ri === -1) return true;
  if (e.key === "ArrowLeft") ci > 0 ? cell(ci - 1, ri) : rowHead(ri);
  else if (e.key === "ArrowRight" && ci < cols.length - 1) cell(ci + 1, ri);
  else if (e.key === "ArrowUp") ri > 0 ? cell(ci, ri - 1) : colHead(ci);
  else if (e.key === "ArrowDown" && ri < rows.length - 1) cell(ci, ri + 1);
  return true;
}

/** ⌫ on a cell clears its override; on a custom variation, deletes it. */
function deleteSelection() {
  const s = getState();
  const sel = s.selection;
  if (!sel) return;
  if (sel.kind === "cell") {
    const cellId = `${sel.logoId}-${sel.bgId}`;
    if (s.overrides[cellId]) actions.setOverride(cellId, null);
    return;
  }
  const list = sel.side === "logo" ? s.logoVariations : s.bgVariations;
  const v = list.find((x) => x.id === sel.id);
  if (v?.isCustom) actions.removeVariation(sel.side, sel.id);
}

/** Remounts the inspector when the selection target changes, resetting its local editor state. */
function selectionKey(selection: Selection): string {
  if (!selection) return "none";
  return selection.kind === "variation"
    ? `v-${selection.side}-${selection.id}`
    : `c-${selection.logoId}-${selection.bgId}`;
}

/** "+" track button that adds a new white profile/surface immediately. */
function AddButton({
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
      <span className="text-[8.5px] font-bold uppercase tracking-widest text-neutral-400 group-hover:text-black transition-colors whitespace-nowrap">
        {label}
      </span>
    </button>
  );
}

function ToolButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "p-2 transition-colors",
        disabled
          ? "text-neutral-300 cursor-default"
          : "text-neutral-500 hover:text-black hover:bg-neutral-100",
      )}
    >
      {children}
    </button>
  );
}
