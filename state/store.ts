/**
 * Minimal dependency-free external store (zustand-style, via
 * useSyncExternalStore). State is always replaced immutably, so selecting
 * sub-objects in components is reference-stable.
 *
 * Features on top of the plain store:
 * - undo/redo — document mutations snapshot the doc slice; rapid edits with
 *   the same coalesce key (slider scrubs, typing) merge into one history step
 * - persistence — the doc slice autosaves to localStorage (debounced) and is
 *   restored on load; older payloads migrate forward
 * - selection — one variation or cell is "selected" and edited in the
 *   Inspector panel
 * - groups — the proof is a stack of independent blocks (groups). Each group
 *   owns its logo artwork, source colors, logo profiles (columns), surface
 *   rows (rows, each with an optional background texture) and per-cell
 *   overrides.
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

let idCounter = 0;
/** Process-unique id with a readable prefix. */
const uid = (prefix: string) => `${prefix}-${Date.now()}-${++idCounter}`;

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

function defaultBgVariations(): Variation[] {
  return [
    {
      id: uid("bg-white"),
      name: "Paper White",
      coloring: solidColoring({ ...PAPER_WHITE }),
      enabled: true,
      isCustom: true,
      bgArtwork: null,
    },
    {
      id: uid("bg-richblack"),
      name: "Rich Black",
      coloring: solidColoring({ ...RICH_BLACK }),
      enabled: true,
      isCustom: true,
      bgArtwork: null,
    },
  ];
}

function makeGroup(name: string): LogoGroup {
  const masterHexes = [DEFAULT_LOGO_HEX];
  return {
    id: uid("group"),
    name,
    logoArtwork: defaultLogoArtwork(),
    logoIsDefault: true,
    masterHexes,
    logoVariations: autoLogoVariations(masterHexes, []),
    bgVariations: defaultBgVariations(),
    overrides: {},
  };
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type Side = "logo" | "bg";

export type Selection =
  | { kind: "variation"; groupId: string; side: Side; id: string }
  | { kind: "cell"; groupId: string; logoId: string; bgId: string }
  | null;

export type Zoom = 0 | 1 | 2;

/** The document: everything that is undoable and persisted. */
interface DocState {
  projectName: string;
  groups: LogoGroup[];
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

/** Look a group up by id (defensive: falls back to the first group). */
export function findGroup(groups: LogoGroup[], groupId: string): LogoGroup {
  return groups.find((g) => g.id === groupId) ?? groups[0];
}

function autoLogoVariations(masterHexes: string[], previous: Variation[]): Variation[] {
  const make = (i: number, prev?: Variation): Variation => ({
    id: prev?.id ?? uid("auto"),
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

function initialDoc(): DocState {
  return {
    projectName: "iris",
    groups: [makeGroup("Logo A")],
    logoScale: DEFAULT_LOGO_SCALE,
  };
}

/**
 * Removes one side's coloring from a group's overrides for the given rows
 * (used when a group's logo changes: per-cell builds for the old artwork are
 * stale). Exclusions and the other side are kept.
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
    logoScale: s.logoScale,
  };
}

// ---------------------------------------------------------------------------
// Persistence + migration
// ---------------------------------------------------------------------------

const STORAGE_KEY = "color-iris:v2";
const SAVE_DEBOUNCE_MS = 400;

/** Cheap shape check for the current (v4) document. */
function isValidDoc(doc: unknown): doc is DocState {
  const d = doc as DocState | null;
  return !!(
    d &&
    Array.isArray(d.groups) &&
    d.groups.length > 0 &&
    d.groups.every(
      (g) =>
        g?.logoArtwork?.paths &&
        Array.isArray(g.masterHexes) &&
        Array.isArray(g.logoVariations) &&
        Array.isArray(g.bgVariations) &&
        g.overrides &&
        typeof g.overrides === "object",
    ) &&
    typeof d.projectName === "string"
  );
}

/** Upgrades a v3 (global-columns) document to the per-group v4 shape. */
function migrateV3toV4(old: any): DocState | null {
  if (!Array.isArray(old?.groups) || !Array.isArray(old?.logoVariations)) return null;
  const allRows: Variation[] = Array.isArray(old.bgVariations) ? old.bgVariations : [];
  const overrides: Record<string, CellOverride> = old.overrides ?? {};
  const firstId = old.groups[0]?.id;
  const groups: LogoGroup[] = old.groups.map((g: any) => {
    const rowsHere = allRows
      .filter((v: any) => (v.groupId ?? firstId) === g.id)
      .map((v: any) => {
        const { groupId, ...rest } = v;
        // v3 had one texture per group; carry it onto each of its rows.
        return { ...rest, bgArtwork: g.bgArtwork ?? null } as Variation;
      });
    const rowIds = new Set(rowsHere.map((r) => r.id));
    const ovHere: Record<string, CellOverride> = {};
    for (const [key, o] of Object.entries(overrides)) {
      if ([...rowIds].some((id) => key.endsWith(`-${id}`))) ovHere[key] = o as CellOverride;
    }
    return {
      id: g.id,
      name: g.name,
      logoArtwork: g.logoArtwork,
      logoIsDefault: !!g.logoIsDefault,
      masterHexes: Array.isArray(g.masterHexes) ? g.masterHexes : [DEFAULT_LOGO_HEX],
      // Each group gets its own copy of the (formerly shared) profiles.
      logoVariations: old.logoVariations.map((v: Variation) => ({
        ...v,
        coloring: cloneColoring(v.coloring),
      })),
      bgVariations: rowsHere,
      overrides: ovHere,
    } as LogoGroup;
  });
  return {
    projectName: typeof old.projectName === "string" ? old.projectName : "iris",
    groups,
    logoScale: typeof old.logoScale === "number" ? old.logoScale : DEFAULT_LOGO_SCALE,
  };
}

/** Upgrades a v2 single-logo document to the grouped v3 shape (then on to v4). */
function migrateV2toV3(old: any): any | null {
  if (!old?.logoArtwork?.paths || !Array.isArray(old.bgVariations)) return null;
  const groupId = `group-migrated-1`;
  return {
    projectName: typeof old.projectName === "string" ? old.projectName : "iris",
    groups: [
      {
        id: groupId,
        name: "Logo A",
        logoArtwork: old.logoArtwork,
        logoIsDefault: !!old.logoIsDefault,
        bgArtwork: old.bgArtwork ?? null,
        masterHexes: Array.isArray(old.masterHexes) ? old.masterHexes : [DEFAULT_LOGO_HEX],
      },
    ],
    logoVariations: Array.isArray(old.logoVariations) ? old.logoVariations : [],
    bgVariations: old.bgVariations.map((v: Variation) => ({ ...v, groupId })),
    overrides: old.overrides ?? {},
    logoScale: DEFAULT_LOGO_SCALE,
  };
}

function docFromPayload(data: any): DocState | null {
  if (data?.v === 4 && isValidDoc(data.doc)) return data.doc;
  if (data?.v === 3) {
    const v4 = migrateV3toV4(data.doc);
    if (v4 && isValidDoc(v4)) return v4;
  }
  if (data?.v === 2) {
    const v3 = migrateV2toV3(data.doc);
    const v4 = v3 && migrateV3toV4(v3);
    if (v4 && isValidDoc(v4)) return v4;
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
        JSON.stringify({ v: 4, doc: pickDoc(state), zoom: state.zoom }),
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

/** Convenience: replace one group in the list via an updater. */
function withGroup(s: AppState, groupId: string, fn: (g: LogoGroup) => LogoGroup): LogoGroup[] {
  return s.groups.map((g) => (g.id === groupId ? fn(g) : g));
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
  const group = s.groups.find((g) => g.id === sel.groupId);
  if (!group) return null;
  if (sel.kind === "variation") {
    const list = sel.side === "logo" ? group.logoVariations : group.bgVariations;
    return list.some((v) => v.id === sel.id) ? sel : null;
  }
  const okLogo = group.logoVariations.some((v) => v.id === sel.logoId);
  const okBg = group.bgVariations.some((v) => v.id === sel.bgId);
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
    mutateDoc((s) => ({ groups: [...s.groups, group] }));
    setState({ selection: null });
  },

  renameGroup(groupId: string, name: string) {
    mutateDoc((s) => ({ groups: withGroup(s, groupId, (g) => ({ ...g, name })) }), `gname-${groupId}`);
  },

  removeGroup(groupId: string) {
    const s = getState();
    if (s.groups.length <= 1) return;
    mutateDoc((cur) => ({ groups: cur.groups.filter((g) => g.id !== groupId) }));
    setState((cur) => ({ selection: sanitizeSelection(cur) }));
  },

  loadLogoSvg(groupId: string, svgText: string) {
    try {
      const artwork = parseSvg(svgText);
      mutateDoc((s) => ({
        groups: withGroup(s, groupId, (g) => {
          const rowIds = new Set(g.bgVariations.map((v) => v.id));
          return {
            ...g,
            logoArtwork: artwork,
            logoIsDefault: false,
            masterHexes: artwork.palette,
            logoVariations: autoLogoVariations(artwork.palette, g.logoVariations),
            overrides: stripOverrides(g.overrides, "logo", rowIds),
          };
        }),
        loadError: null,
      }));
    } catch (err) {
      setState({ loadError: err instanceof Error ? err.message : "Could not read SVG." });
    }
  },

  setMasterHex(groupId: string, index: number, hex: string) {
    mutateDoc(
      (s) => ({
        groups: withGroup(s, groupId, (g) => {
          const masterHexes = g.masterHexes.map((h, i) => (i === index ? hex : h));
          return { ...g, masterHexes, logoVariations: autoLogoVariations(masterHexes, g.logoVariations) };
        }),
      }),
      `master-hex-${groupId}-${index}`,
    );
  },

  // ---- per-row background texture ----

  loadRowBgSvg(groupId: string, rowId: string, svgText: string) {
    try {
      const artwork = parseSvg(svgText);
      mutateDoc((s) => ({
        groups: withGroup(s, groupId, (g) => ({
          ...g,
          bgVariations: g.bgVariations.map((v) =>
            v.id === rowId ? { ...v, bgArtwork: artwork } : v,
          ),
        })),
        loadError: null,
      }));
    } catch (err) {
      setState({ loadError: err instanceof Error ? err.message : "Could not read SVG." });
    }
  },

  clearRowBgArtwork(groupId: string, rowId: string) {
    mutateDoc((s) => ({
      groups: withGroup(s, groupId, (g) => ({
        ...g,
        bgVariations: g.bgVariations.map((v) =>
          v.id === rowId ? { ...v, bgArtwork: null } : v,
        ),
      })),
    }));
  },

  // ---- variations ----

  /**
   * `coalesceKey` lets continuous edits (typing a name, scrubbing CMYK)
   * collapse into one undo step. Discrete toggles should omit it.
   */
  updateVariation(groupId: string, side: Side, variation: Variation, coalesceKey?: string) {
    const key = side === "logo" ? "logoVariations" : "bgVariations";
    mutateDoc(
      (s) => ({
        groups: withGroup(s, groupId, (g) => ({
          ...g,
          [key]: g[key].map((v) => (v.id === variation.id ? variation : v)),
        })),
      }),
      coalesceKey,
    );
  },

  /** Adds a column/row (defaulting to paper white) to a group and selects it. */
  addVariation(groupId: string, side: Side) {
    const group = findGroup(getState().groups, groupId);
    if (side === "logo") {
      const v: Variation = {
        id: uid("logo-custom"),
        name: "New Logo",
        coloring: {
          slots: group.masterHexes.map(() => ({ ...PAPER_WHITE })),
          wash: null,
        },
        enabled: true,
        isCustom: true,
      };
      mutateDoc((s) => ({
        groups: withGroup(s, groupId, (g) => ({ ...g, logoVariations: [...g.logoVariations, v] })),
      }));
      setState({ selection: { kind: "variation", groupId, side: "logo", id: v.id } });
      return;
    }
    const v: Variation = {
      id: uid("bg-custom"),
      name: "New Background",
      coloring: solidColoring({ ...PAPER_WHITE }),
      enabled: true,
      isCustom: true,
      bgArtwork: null,
    };
    mutateDoc((s) => ({
      groups: withGroup(s, groupId, (g) => ({ ...g, bgVariations: [...g.bgVariations, v] })),
    }));
    setState({ selection: { kind: "variation", groupId, side: "bg", id: v.id } });
  },

  duplicateVariation(groupId: string, side: Side, id: string) {
    const key = side === "logo" ? "logoVariations" : "bgVariations";
    const group = findGroup(getState().groups, groupId);
    const list = group[key];
    const src = list.find((v) => v.id === id);
    if (!src) return;
    const copy: Variation = {
      ...src,
      id: uid(`${side}-copy-${++duplicateCounter}`),
      name: `${src.name} Copy`,
      coloring: cloneColoring(src.coloring),
      // Copies are user-owned: they keep their values when masters change.
      isCustom: true,
      algorithmIndex: undefined,
      enabled: true,
    };
    mutateDoc((s) => ({
      groups: withGroup(s, groupId, (g) => {
        const cur = g[key];
        const at = cur.findIndex((v) => v.id === id);
        return { ...g, [key]: [...cur.slice(0, at + 1), copy, ...cur.slice(at + 1)] };
      }),
    }));
    setState({ selection: { kind: "variation", groupId, side, id: copy.id } });
  },

  removeVariation(groupId: string, side: Side, id: string) {
    const key = side === "logo" ? "logoVariations" : "bgVariations";
    mutateDoc((s) => ({
      groups: withGroup(s, groupId, (g) => {
        // Drop overrides that referenced the removed row/column.
        const overrides: Record<string, CellOverride> = {};
        for (const [k, o] of Object.entries(g.overrides)) {
          const refersToRemoved =
            side === "logo" ? k.startsWith(`${id}-`) : k.endsWith(`-${id}`);
          if (!refersToRemoved) overrides[k] = o;
        }
        return { ...g, [key]: g[key].filter((v) => v.id !== id), overrides };
      }),
    }));
    setState((s) => ({ selection: sanitizeSelection(s) }));
  },

  setOverride(groupId: string, cellId: string, override: CellOverride | null, coalesceKey?: string) {
    mutateDoc((s) => ({
      groups: withGroup(s, groupId, (g) => {
        const overrides = { ...g.overrides };
        if (override === null) delete overrides[cellId];
        else overrides[cellId] = override;
        return { ...g, overrides };
      }),
    }), coalesceKey);
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
    return JSON.stringify({ v: 4, app: "color-iris", doc: pickDoc(state) }, null, 2);
  },

  /** Replaces the document from a project file (undoable; older files migrate). */
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
