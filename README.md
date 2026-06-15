# Color Iris

A print-proofing utility for vector logos. Upload an SVG, define CMYK color
profiles (columns) and background surfaces (rows), tweak any intersection,
and export a **fully vector, DeviceCMYK-encoded A3 PDF** proof sheet.

## What's new in V2

- **Inspector panel** — click any column/row header or matrix cell to edit it
  in a persistent right-hand panel (replaces the v1 popover + modal). Cell
  edits apply live and per side (logo / surface).
- **Undo / redo** — ⌘Z / ⇧⌘Z (or the toolbar buttons); continuous edits like
  slider scrubs coalesce into single history steps.
- **Autosave** — the document persists to `localStorage` and is restored on
  load; the toolbar "new project" button starts fresh.
- **Better CMYK controls** — per-channel sliders whose tracks preview the
  simulated on-paper result of sweeping that channel, plus scrubbable chips,
  exact numeric entry and hex quick-entry (SWOP separation).
- **Gradient editor** — draggable stop handles on a live gradient bar
  (double-click to add a stop) and an angle control for linear washes,
  honored identically by the CSS preview, the SVG renderer and the PDF
  shadings.
- **Presets** — surface quick-adds (Cream, Kraft, Navy, Rich Black, …) and
  profile quick-adds (Mono Black, Reversed).
- **Global drag & drop** — drop an SVG anywhere and choose Logo or
  Background.
- **Status bar** — sheet stats, override counts, autosave time and a
  cell-density zoom (S/M/L).
- **Shortcuts** — ⌘Z undo, ⇧⌘Z redo, ⌘E export PDF, Esc closes the
  inspector. Arrow keys walk the matrix (cells flow into the column/row
  headers at the edges); ⌫ clears a cell override or deletes a custom
  variation.
- **Project files** — save/open the whole document as `.coloriris.json`
  (toolbar buttons), independent of the browser autosave.
- **Reordering** — move columns left/right and rows up/down from the
  inspector; auto profiles keep their position when source colors change.
- **Build clipboard** — copy any ink build (variation or cell side) and
  paste it elsewhere; copying also puts the readable CMYK values on the OS
  clipboard, and the per-color readout is click-to-copy.
- **Cell tooltips** — hovering a cell shows the exact logo/surface ink
  builds it will print with.
- **Fresh artwork resets cell tweaks** — uploading a new logo clears the
  logo-side coloring of every cell override (background uploads clear the
  surface side); exclusions are kept. Undo restores everything.
- **Selection stays visible** — selecting a row, column or cell scrolls it
  into view so the inspector never hides what you're editing.
- **Logo groups** — the matrix is split into horizontal sections, each with
  its own logo, source colors and optional background texture. Rows belong
  to a group (movable in the inspector); auto profiles re-separate per
  group's palette.
- **Logo size** — a status-bar slider sets the logo footprint as a fraction
  of the cell, identically on screen and on the printed sheet.
- **Twin proof sheets** — the PDF is A3 landscape with the matrix printed
  twice (left/right) and a separation line through the center. Cells with a
  spec override print their actual ink builds.

## Run

```bash
npm install        # first run only
npm run dev        # http://localhost:3000
npm run build      # production build
npm run lint       # typecheck
```

> **Note on typings:** this rebuild was done in a sandbox without npm registry
> access, so `src/react-shim.d.ts` provides minimal ambient React typings.
> Once you have registry access, run `npm i -D @types/react @types/react-dom`
> and delete that file.

## Architecture

The core idea of the rebuild: **the uploaded SVG is parsed exactly once** into
a normalized `Artwork` model (`src/types.ts`), and *both* the on-screen
preview and the PDF generator render from that same model. No string
replacement of SVG markup, no duplicated logo/background drawing logic.

```
src/
  types.ts            Domain model: CMYK, Paint, Coloring, Variation, Artwork
  color/
    convert.ts        Hex/RGB/CMYK conversions, separation algorithms (SWOP/UCR/GCR), TAC
    simulate.ts       Screen simulation of ink on coated stock (ink RGB, paper tint, dot gain)
  svg/
    transform.ts      2D affine matrix helpers
    parse.ts          SVG → Artwork (baked transforms, palette slots, resolved gradients)
    render.ts         Artwork + Coloring → preview SVG (through the CMYK simulation)
  pdf/
    shading.ts        DeviceCMYK axial/radial shadings with exact stop offsets
    proof.ts          A3 landscape proof sheet (headers, swatches, TAC warnings, crop marks)
  state/store.ts      Dependency-free external store (useSyncExternalStore)
  components/         Swiss-minimal matrix UI
scripts/
  generate-sample-proof.ts   Headless PDF smoke test (npx tsx scripts/…)
```

### Key concepts

- **Slot** — a distinct color extracted from the uploaded SVG. Every fill in
  the artwork references a slot (or keeps a fixed color). A variation assigns
  one CMYK build per slot.
- **Wash** — an optional whole-artwork paint (solid or linear/radial gradient
  with per-stop offsets) that overrides the slots for that variation.
- **Override** — a per-cell replacement of the logo and/or surface coloring,
  or an exclusion of the cell from the sheet.

### PDF output

A3 landscape (1190.55 × 841.89 pt), everything vector and DeviceCMYK —
including text and hairlines. Gradients are native PDF Type 2/3 shadings with
stitching functions, so stop offsets survive exactly. The sheet carries crop
marks, per-variation ink builds with swatch chips, document metadata and a
spec footer.

The previous implementation is archived in `legacy-backup.zip`.
