/**
 * Minimal dependency-free external store (zustand-style, via
 * useSyncExternalStore). State is always replaced immutably, so selecting
 * sub-objects in components is reference-stable.
 *
 * V2+ features on top of the plain store:
 * - undo/redo — document mutations snapshot the doc slice; rapid edits with
 *   the same coalesce key (slider scrubs, typing) merge into one history step
 * - persistence — the doc slice autosaves to localStorage (debounced) and is
 *   restored on load; older payloads migrate forward
 * - selection — one variation or cell is "selected" and edited in the
 *   Inspector panel
 * - groups — the matrix is split into horizontal sections, each with its own
 *   logo artwork, source colors and optional background texture
 */
import { useSyncExternalStore } from "react";
import type { Artwork, CellOverride, CMYK, Coloring, LogoGroup, Variation } from "../types";
import { hexToRgb, separate, SEPARATION_ALGORITHMS } from "../color/convert";
import { cloneColoring, coloringColors, formatCmyk } from "../lib/coloring";
import { parseSvg } from "../svg/parse";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_LOGO_HEX = "#FF5500";
export const DEFAULT_LOGO_SCALE = 0.64;

/** Rounded square placeholder shown before a logo is uploaded. */
function defaultLogoArtwork(): Artwork {
  return {
    paths: [
      {
        d: "M26,10 h48 a16,16 0 0 1 16,16 v48 a16,16 0 0 1 -16,16 h-48 a16,16 0 0 1 -16,-16 v-48 a16,16 0 0 1 16,-16 z",
        fill: { kind: "ref", ref: { kind: "slot", index: 0 } },
        bounds: [10, 10, 90, 90],
      },
    ],
    viewBox: { x: 0, y: 0, w: 100, h: 100 },
    palette: [DEFAULT_LOGO_HEX],
  };
}

const PAPER_WHITE: CMYK = { c: 0, m: 0, y: 0, k: 0 };
const RICH_BLACK: CMYK = { c: 60, m: 40, y: 40, k: 100 };

function solidColoring(cmyk: CMYK): Coloring {
  return { slots: [cmyk], wash: null };
}

let groupCounter = 0;

function makeGroup(name: string): LogoGroup {
  return {
    id: `group-${Date.now()}-${++groupCounter}`,
    name,
    logoArtwork: defaultLogoArtwork(),
    logoIsDefault: true,
    bgArtwork: null,
    masterHexes: [DEFAULT_LOGO_HEX],
  };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type Side = "logo" | "bg";

export type Selection =
  | { kind: "variation"; side: Side; id: string }
  | { kind: "cell"; logoId: string; bgId: string }
  | null;

export type Zoom = 0 | 1 | 2;

/** The document: everything that is undoable and persisted. */
interface DocState {
  projectName: string;
  groups: LogoGroup[];
  logoVariations: Variation[];
  bgVariations: Variation[];
  overrides: Record<string, CellOverride>;
  /** Logo footprint as a fraction of the cell (same on screen and PDF). */
  logoScale: number;
}

export interface AppState extends DocState {
  selection: Selection;
  zoom: Zoom;
  loadError: string | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Epoch ms of the last successful autosave (null before the first one). */
  savedAt: number | null;
  /** True once a coloring has been copied (enables paste buttons). */
  hasClipboard: boolean;
}

/** The group a surface row belongs to (defensive: falls back to the first). */
export function groupForRow(groups: LogoGroup[], row: Variation): LogoGroup {
  return groups.find((g) => g.id === row.groupId) ?? groups[0];
}

/** Surface rows of one group, in stored order. */
export function rowsForGroup(
  groups: LogoGroup[],
  bgVariations: Variation[],
  groupId: string,
): Variation[] {
  return bgVariations.filter((v) => groupForRow(groups, v).id === groupId);
}

function autoLogoVariations(masterHexes: string[], previous: Variation[]): Variation[] {
  const make = (i: number, prev?: Variation): Variation => ({
    id: `auto-${i}`,
    name: prev?.name ?? SEPARATION_ALGORITHMS[i].name,
    coloring: {
      slots: masterHexes.map((hex) => separate(hexToRgb(hex), SEPARATION_ALGORITHMS[i].kBias)),
      wash: prev?.coloring.wash ?? null,
    },
    enabled: prev?.enabled ?? true,
    isCustom: false,
    algorithmIndex: i,
  });
  // Recompute autos in place so user reordering survives master-color edits.
  const result = previous.map((v) => {
    if (v.isCustom) return v;
    const i = v.algorithmIndex ?? -1;
    return SEPARATION_ALGORITHMS[i] ? make(i, v) : v;
  });
  SEPARATION_ALGORITHMS.forEach((_, i) => {
    if (!result.some((v) => !v.isCustom && v.algorithmIndex === i)) result.push(make(i));
  });
  return result;
}

function defaultBgVariations(groupId: string): Variation[] {
  return [
    {
      id: "bg-white",
      name: "Paper White",
      coloring: solidColoring({ ...PAPER_WHITE }),
      enabled: true,
      isCustom: true,
      groupId,
    },
    {
      id: "bg-richblack",
      name: "Rich Black",
      coloring: solidColoring({ ...RICH_BLACK }),
      enabled: true,
      isCustom: true,
      groupId,
    },
  ];
}

function initialDoc(): DocState {
  const group = makeGroup("Logo A");
  return {
    projectName: "iris",
    groups: [group],
    logoVariations: autoLogoVariations(group.masterHexes, []),
    bgVariations: defaultBgVariations(group.id),
    overrides: {},
    logoScale: DEFAULT_LOGO_SCALE,
  };
}

/**
 * Removes one side's coloring from the overrides of cells whose row is in
 * `rowIds` (used when a group gets new artwork: per-cell builds for the old
 * artwork are stale). Exclusions and the other side are kept.
 */
function stripOverrides(
  overrides: Record<string, CellOverride>,
  side: Side,
  rowIds: Set<string>,
): Record<string, CellOverride> {
  const next: Record<string, CellOverride> = {};
  for (const [key, o] of Object.entries(overrides)) {
    const affected = [...rowIds].some((id) => key.endsWith(`-${id}`));
    if (!affected) {
      next[key] = o;
      continue;
    }
    const kept: CellOverride = { ...o };
    delete kept[side];
    if (kept.logo !== undefined || kept.bg !== undefined || kept.disabled) next[key] = kept;
  }
  return next;
}

function pickDoc(s: AppState | DocState): DocState {
  return {
    projectName: s.projectName,
    groups: s.groups,
    logoVariations: s.logoVariations,
    bgVariations: s.bgVariations,
    overrides: s.overrides,
    logoScale: s.logoScale,
  };
}

// ---------------------------------------------------------------------------
// Persistence + migration
// ---------------------------------------------------------------------------

const STORAGE_KEY = "color-iris:v2";
const SAVE_DEBOUNCE_MS = 400;

/** Cheap shape check for the current (v3) document. */
function isValidDoc(doc: unknown): doc is DocState {
  const d = doc as DocState | null;
  return !!(
    d &&
    Array.isArray(d.groups) &&
    d.groups.length > 0 &&
    d.groups.every((g) => g?.logoArtwork?.paths && Array.isArray(g.masterHexes)) &&
    typeof d.projectName === "string" &&
    Array.isArray(d.logoVariations) &&
    Array.isArray(d.bgVariations) &&
    d.overrides &&
    typeof d.overrides === "object"
  );
}

/** Upgrades a v2 single-logo document to the grouped v3 shape. */
function migrateV2Doc(old: any): DocState | null {
  if (!old?.logoArtwork?.paths || !Array.isArray(old.bgVariations)) return null;
  const group: LogoGroup = {
    id: `group-migrated-1`,
    name: "Logo A",
    logoArtwork: old.logoArtwork,
    logoIsDefault: !!old.logoIsDefault,
    bgArtwork: old.bgArtwork ?? null,
    masterHexes: Array.isArray(old.masterHexes) ? old.masterHexes : [DEFAULT_LOGO_HEX],
  };
  return {
    projectName: typeof old.projectName === "string" ? old.projectName : "iris",
    groups: [group],
    logoVariations: Array.isArray(old.logoVariations) ? old.logoVariations : [],
    bgVariations: old.bgVariations.map((v: Variation) => ({
      ...v,
      groupId: group.id,
      // The v2 auto "base BG" row is user-owned now (its sync is gone).
      isCustom: v.id === "bg-master" ? true : v.isCustom,
    })),
    overrides: old.overrides ?? {},
    logoScale: DEFAULT_LOGO_SCALE,
  };
}

function docFromPayload(data: any): DocState | null {
  if (data?.v === 3 && isValidDoc(data.doc)) return data.doc;
  if (data?.v === 2) {
    const migrated = migrateV2Doc(data.doc);
    if (migrated && isValidDoc(migrated)) return migrated;
  }
  return null;
}

function loadPersisted(): { doc: DocState; zoom: Zoom } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const doc = docFromPayload(data);
    if (!doc) return null;
    const zoom: Zoom = data.zoom === 0 || data.zoom === 2 ? data.zoom : 1;
    return { doc, zoom };
  } catch {
    return null;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function schedulePersist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ v: 3, doc: pickDoc(state), zoom: state.zoom }),
      );
      setState({ savedAt: Date.now() });
    } catch {
      // Quota/serialization failures are non-fatal: the session keeps working.
    }
  }, SAVE_DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// Store core + history
// ---------------------------------------------------------------------------

function initialState(): AppState {
  const persisted = loadPersisted();
  return {
    ...(persisted?.doc ?? initialDoc()),
    selection: null,
    zoom: persisted?.zoom ?? 1,
    loadError: null,
    canUndo: false,
    canRedo: false,
    savedAt: null,
    hasClipboard: false,
  };
}

let state: AppState = initialState();
const listeners = new Set<() => void>();
let duplicateCounter = 0;

/** Internal coloring clipboard (session-only, survives selection changes). */
let coloringClipboard: Coloring | null = null;

/** A fresh copy of the last copied coloring, or null. */
export function getClipboardColoring(): Coloring | null {
  return coloringClipboard ? cloneColoring(coloringClipboard) : null;
}

const HISTORY_LIMIT = 100;
const COALESCE_MS = 800;
let past: DocState[] = [];
let future: DocState[] = [];
let lastEdit = { key: "", at: 0 };

export function getState(): AppState {
  return state;
}

function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  listeners.forEach((l) => l());
}

/**
 * Applies a document mutation as one undoable step. Consecutive calls with
 * the same non-empty `coalesceKey` within COALESCE_MS merge into the
 * previous step (so a slider scrub is one undo, not fifty).
 */
function mutateDoc(
  patch: Partial<AppState> | ((s: AppState) => Partial<AppState>),
  coalesceKey?: string,
) {
  const now = Date.now();
  const coalesce =
    !!coalesceKey && coalesceKey === lastEdit.key && now - lastEdit.at < COALESCE_MS;
  if (!coalesce) {
    past.push(pickDoc(state));
    if (past.length > HISTORY_LIMIT) past.shift();
    future = [];
  }
  lastEdit = { key: coalesceKey ?? "", at: now };
  setState((s) => ({
    ...(typeof patch === "function" ? patch(s) : patch),
    canUndo: true,
    canRedo: false,
  }));
  schedulePersist();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Select reference-stable slices only (whole state or stored sub-objects). */
export function useAppState<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

/** Drops a selection that points at something that no longer exists. */
function sanitizeSelection(s: AppState): Selection {
  const sel = s.selection;
  if (!sel) return null;
  if (sel.kind === "variation") {
    const list = sel.side === "logo" ? s.logoVariations : s.bgVariations;
    return list.some((v) => v.id === sel.id) ? sel : null;
  }
  const okLogo = s.logoVariations.some((v) => v.id === sel.logoId);
  const okBg = s.bgVariations.some((v) => v.id === sel.bgId);
  return okLogo && okBg ? sel : null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const actions = {
  // ---- ui ----

  select(selection: Selection) {
    setState({ selection });
  },

  setZoom(zoom: Zoom) {
    setState({ zoom });
    schedulePersist();
  },

  dismissError() {
    setState({ loadError: null });
  },

  // ---- history ----

  undo() {
    if (past.length === 0) return;
    future.push(pickDoc(state));
    const doc = past.pop()!;
    lastEdit = { key: "", at: 0 };
    setState((s) => ({
      ...doc,
      canUndo: past.length > 0,
      canRedo: true,
      selection: sanitizeSelection({ ...s, ...doc }),
    }));
    schedulePersist();
  },

  redo() {
    if (future.length === 0) return;
    past.push(pickDoc(state));
    if (past.length > HISTORY_LIMIT) past.shift();
    const doc = future.pop()!;
    lastEdit = { key: "", at: 0 };
    setState((s) => ({
      ...doc,
      canUndo: true,
      canRedo: future.length > 0,
      selection: sanitizeSelection({ ...s, ...doc }),
    }));
    schedulePersist();
  },

  /** Discards the document, history and autosave; starts fresh. */
  resetProject() {
    past = [];
    future = [];
    lastEdit = { key: "", at: 0 };
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setState((s) => ({
      ...initialDoc(),
      selection: null,
      zoom: s.zoom,
      loadError: null,
      canUndo: false,
      canRedo: false,
    }));
  },

  // ---- document ----

  setProjectName(projectName: string) {
    mutateDoc({ projectName }, "project-name");
  },

  setLogoScale(logoScale: number) {
    mutateDoc({ logoScale: Math.min(1, Math.max(0.2, logoScale)) }, "logo-scale");
  },

  // ---- groups ----

  addGroup() {
    const name = `Logo ${String.fromCharCode(65 + (getState().groups.length % 26))}`;
    const group = makeGroup(name);
    const row: Variation = {
      id: `bg-custom-${Date.now()}`,
      name: "Paper White",
      coloring: solidColoring({ ...PAPER_WHITE }),
      enabled: true,
      isCustom: true,
      groupId: group.id,
    };
    mutateDoc((s) => ({
      groups: [...s.groups, group],
      bgVariations: [...s.bgVariations, row],
    }));
    setState({ selection: null });
  },

  renameGroup(groupId: string, name: string) {
    mutateDoc(
      (s) => ({
        groups: s.groups.map((g) => (g.id === groupId ? { ...g, name } : g)),
      }),
      `gname-${groupId}`,
    );
  },

  /** Removes a group; its rows move to the first remaining group. */
  removeGroup(groupId: string) {
    const s = getState();
    if (s.groups.length <= 1) return;
    const remaining = s.groups.filter((g) => g.id !== groupId);
    const fallback = remaining[0].id;
    mutateDoc((cur) => ({
      groups: cur.groups.filter((g) => g.id !== groupId),
      bgVariations: cur.bgVariations.map((v) =>
        groupForRow(cur.groups, v).id === groupId ? { ...v, groupId: fallback } : v,
      ),
    }));
    setState((cur) => ({ selection: sanitizeSelection(cur) }));
  },

  /** Moves a surface row to another group (placed at that group's end). */
  setRowGroup(rowId: string, groupId: string) {
    mutateDoc((s) => {
      const row = s.bgVariations.find((v) => v.id === rowId);
      if (!row) return {};
      const rest = s.bgVariations.filter((v) => v.id !== rowId);
      const moved = { ...row, groupId };
      // Insert after the last row of the target group to keep display order.
      let insertAt = rest.length;
      for (let i = rest.length - 1; i >= 0; i--) {
        if (groupForRow(s.groups, rest[i]).id === groupId) {
          insertAt = i + 1;
          break;
        }
      }
      return {
        bgVariations: [...rest.slice(0, insertAt), moved, ...rest.slice(insertAt)],
      };
    });
  },

  loadLogoSvg(groupId: string, svgText: string) {
    try {
      const artwork = parseSvg(svgText);
      mutateDoc((s) => {
        const isPrimary = s.groups[0]?.id === groupId;
        const rowIds = new Set(rowsForGroup(s.groups, s.bgVariations, groupId).map((v) => v.id));
        return {
          groups: s.groups.map((g) =>
            g.id === groupId
              ? { ...g, logoArtwork: artwork, logoIsDefault: false, masterHexes: artwork.palette }
              : g,
          ),
          logoVariations: isPrimary
            ? autoLogoVariations(artwork.palette, s.logoVariations)
            : s.logoVariations,
          overrides: stripOverrides(s.overrides, "logo", rowIds),
          loadError: null,
        };
      });
    } catch (err) {
      setState({ loadError: err instanceof Error ? err.message : "Could not read SVG." });
    }
  },

  loadBgSvg(groupId: string, svgText: string) {
    try {
      const artwork = parseSvg(svgText);
      mutateDoc((s) => {
        const rowIds = new Set(rowsForGroup(s.groups, s.bgVariations, groupId).map((v) => v.id));
        return {
          groups: s.groups.map((g) => (g.id === groupId ? { ...g, bgArtwork: artwork } : g)),
          overrides: stripOverrides(s.overrides, "bg", rowIds),
          loadError: null,
        };
      });
    } catch (err) {
      setState({ loadError: err instanceof Error ? err.message : "Could not read SVG." });
    }
  },

  clearBgArtwork(groupId: string) {
    mutateDoc((s) => ({
      groups: s.groups.map((g) => (g.id === groupId ? { ...g, bgArtwork: null } : g)),
    }));
  },

  setMasterHex(groupId: string, index: number, hex: string) {
    mutateDoc((s) => {
      const isPrimary = s.groups[0]?.id === groupId;
      const groups = s.groups.map((g) =>
        g.id === groupId
          ? { ...g, masterHexes: g.masterHexes.map((h, i) => (i === index ? hex : h)) }
          : g,
      );
      return {
        groups,
        logoVariations: isPrimary
          ? autoLogoVariations(groups[0].masterHexes, s.logoVariations)
          : s.logoVariations,
      };
    }, `master-hex-${groupId}-${index}`);
  },

  // ---- variations ----

  /**
   * `coalesceKey` lets continuous edits (typing a name, scrubbing CMYK)
   * collapse into one undo step. Discrete toggles should omit it.
   */
  updateVariation(side: Side, variation: Variation, coalesceKey?: string) {
    const key = side === "logo" ? "logoVariations" : "bgVariations";
    mutateDoc(
      (s) => ({
        [key]: s[key].map((v) => (v.id === variation.id ? variation : v)),
      }),
      coalesceKey,
    );
  },

  /** Adds a column/row (defaulting to paper white) and selects it. */
  addVariation(side: Side, groupId?: string) {
    if (side === "logo") {
      const v: Variation = {
        id: `logo-custom-${Date.now()}`,
        name: "New Profile",
        coloring: {
          slots: (getState().groups[0]?.masterHexes ?? [DEFAULT_LOGO_HEX]).map(() => ({
            ...PAPER_WHITE,
          })),
          wash: null,
        },
        enabled: true,
        isCustom: true,
      };
      mutateDoc((s) => ({ logoVariations: [...s.logoVariations, v] }));
      setState({ selection: { kind: "variation", side: "logo", id: v.id } });
      return;
    }
    const s = getState();
    const gid = groupId ?? s.groups[s.groups.length - 1].id;
    const v: Variation = {
      id: `bg-custom-${Date.now()}`,
      name: "New Surface",
      coloring: solidColoring({ ...PAPER_WHITE }),
      enabled: true,
      isCustom: true,
      groupId: gid,
    };
    mutateDoc((cur) => {
      // Insert after the last row of the group to keep display order.
      const list = cur.bgVariations;
      let insertAt = list.length;
      for (let i = list.length - 1; i >= 0; i--) {
        if (groupForRow(cur.groups, list[i]).id === gid) {
          insertAt = i + 1;
          break;
        }
      }
      return { bgVariations: [...list.slice(0, insertAt), v, ...list.slice(insertAt)] };
    });
    setState({ selection: { kind: "variation", side: "bg", id: v.id } });
  },

  duplicateVariation(side: Side, id: string) {
    const key = side === "logo" ? "logoVariations" : "bgVariations";
    const list = getState()[key];
    const idx = list.findIndex((v) => v.id === id);
    if (idx === -1) return;
    const src = list[idx];
    const copy: Variation = {
      ...src,
      id: `${side}-copy-${++duplicateCounter}-${Date.now()}`,
      name: `${src.name} Copy`,
      coloring: cloneColoring(src.coloring),
      // Copies are user-owned: they keep their values when masters change.
      isCustom: true,
      algorithmIndex: undefined,
      enabled: true,
    };
    mutateDoc((s) => {
      const cur = s[key];
      const at = cur.findIndex((v) => v.id === id);
      return { [key]: [...cur.slice(0, at + 1), copy, ...cur.slice(at + 1)] };
    });
    setState({ selection: { kind: "variation", side, id: copy.id } });
  },

  removeVariation(side: Side, id: string) {
    const key = side === "logo" ? "logoVariations" : "bgVariations";
    mutateDoc((s) => ({ [key]: s[key].filter((v) => v.id !== id) }));
    setState((s) => ({ selection: sanitizeSelection(s) }));
  },

  setOverride(cellId: string, override: CellOverride | null, coalesceKey?: string) {
    mutateDoc((s) => {
      const overrides = { ...s.overrides };
      if (override === null) delete overrides[cellId];
      else overrides[cellId] = override;
      return { overrides };
    }, coalesceKey);
  },

  /**
   * Copies a coloring to the internal clipboard (for pasting onto other
   * variations/cells) and mirrors a readable build string to the OS
   * clipboard for use in layout apps.
   */
  copyColoring(coloring: Coloring) {
    coloringClipboard = cloneColoring(coloring);
    setState({ hasClipboard: true });
    try {
      void navigator.clipboard?.writeText(coloringColors(coloring).map(formatCmyk).join(" / "));
    } catch {
      /* OS clipboard is best-effort */
    }
  },

  // ---- project files ----

  /** The current document as a portable JSON string. */
  exportProject(): string {
    return JSON.stringify({ v: 3, app: "color-iris", doc: pickDoc(state) }, null, 2);
  },

  /** Replaces the document from a project file (undoable; v2 files migrate). */
  importProject(json: string) {
    try {
      const doc = docFromPayload(JSON.parse(json));
      if (!doc) throw new Error();
      mutateDoc(() => doc);
      setState({ selection: null, loadError: null });
    } catch {
      setState({ loadError: "Not a valid Color Iris project file." });
    }
  },
};
