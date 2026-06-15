/**
 * Headless smoke test: builds a representative proof sheet without the UI.
 *
 * Covers: multi-slot artwork, an artwork-internal linear gradient with
 * offsets, a wash gradient variation, a radial surface gradient, stripes,
 * a cell override and an excluded cell.
 *
 * Run (after `npm i -D tsx`):  npx tsx scripts/generate-sample-proof.ts
 */
import { writeFileSync } from "node:fs";
import { generateProofPdf } from "../src/pdf/proof";
import type { Artwork, LogoGroup, Variation } from "../src/types";

const logo: Artwork = {
  viewBox: { x: 0, y: 0, w: 100, h: 100 },
  palette: ["#ff5500", "#003366"],
  paths: [
    {
      // rounded square — slot 0
      d: "M26,10 h48 a16,16 0 0 1 16,16 v48 a16,16 0 0 1 -16,16 h-48 a16,16 0 0 1 -16,-16 v-48 a16,16 0 0 1 16,-16 z",
      fill: { kind: "ref", ref: { kind: "slot", index: 0 } },
      bounds: [10, 10, 90, 90],
    },
    {
      // inner circle — artwork gradient slot 0 → slot 1 with a mid stop
      d: "M30,50 a20,20 0 1,0 40,0 a20,20 0 1,0 -40,0 z",
      fill: {
        kind: "gradient",
        gradient: {
          type: "linear",
          coords: [30, 30, 70, 70],
          stops: [
            { offset: 0, ref: { kind: "slot", index: 0 } },
            { offset: 0.35, ref: { kind: "slot", index: 1 } },
            { offset: 1, ref: { kind: "fixed", cmyk: { c: 0, m: 0, y: 0, k: 90 } } },
          ],
        },
      },
      bounds: [30, 30, 70, 70],
    },
  ],
};

const logoVariations: Variation[] = [
  {
    id: "auto-0",
    name: "Standard SWOP",
    coloring: {
      slots: [
        { c: 0, m: 67, y: 100, k: 0 },
        { c: 100, m: 50, y: 0, k: 60 },
      ],
      wash: null,
    },
    enabled: true,
    isCustom: false,
    // Auto profile: re-separates each group's master colors on the sheet.
    algorithmIndex: 0,
  },
  {
    id: "custom-wash",
    name: "Gradient Wash",
    coloring: {
      slots: [
        { c: 0, m: 67, y: 100, k: 0 },
        { c: 100, m: 50, y: 0, k: 60 },
      ],
      wash: {
        kind: "linear",
        stops: [
          { cmyk: { c: 0, m: 90, y: 85, k: 0 }, offset: 0 },
          { cmyk: { c: 85, m: 50, y: 0, k: 0 }, offset: 0.6 },
          { cmyk: { c: 60, m: 0, y: 100, k: 0 }, offset: 1 },
        ],
      },
    },
    enabled: true,
    isCustom: true,
  },
  {
    id: "custom-heavy",
    name: "Heavy Ink (TAC test)",
    coloring: {
      slots: [
        { c: 90, m: 80, y: 70, k: 80 }, // TAC 320 → warning expected
        { c: 100, m: 50, y: 0, k: 60 },
      ],
      wash: null,
    },
    enabled: true,
    isCustom: true,
  },
];

const bgVariations: Variation[] = [
  {
    id: "bg-white",
    name: "Paper White",
    coloring: { slots: [{ c: 0, m: 0, y: 0, k: 0 }], wash: null },
    enabled: true,
    isCustom: true,
  },
  {
    id: "bg-richblack",
    name: "Rich Black",
    coloring: { slots: [{ c: 60, m: 40, y: 40, k: 100 }], wash: null },
    enabled: true,
    isCustom: true,
  },
  {
    id: "bg-grad",
    name: "Radial Surface",
    coloring: {
      slots: [{ c: 10, m: 5, y: 0, k: 0 }],
      wash: {
        kind: "radial",
        stops: [
          { cmyk: { c: 5, m: 0, y: 20, k: 0 }, offset: 0 },
          { cmyk: { c: 40, m: 20, y: 0, k: 20 }, offset: 1 },
        ],
      },
    },
    enabled: true,
    isCustom: true,
  },
  {
    id: "bg-stripes",
    name: "Stock Compare",
    coloring: {
      slots: [
        { c: 0, m: 0, y: 10, k: 0 },
        { c: 0, m: 5, y: 25, k: 5 },
        { c: 5, m: 5, y: 5, k: 10 },
      ],
      wash: null,
    },
    enabled: true,
    isCustom: true,
  },
];

const groupA: LogoGroup = {
  id: "group-a",
  name: "Logo A",
  logoArtwork: logo,
  logoIsDefault: false,
  bgArtwork: null,
  masterHexes: logo.palette,
};

// Second group: same artwork recolored, to exercise grouped sections.
const groupB: LogoGroup = {
  id: "group-b",
  name: "Logo B",
  logoArtwork: logo,
  logoIsDefault: false,
  bgArtwork: null,
  masterHexes: ["#0066AA", "#552200"],
};

async function main() {
  const bytes = await generateProofPdf({
    groups: [groupA, groupB],
    logoVariations,
    bgVariations: bgVariations.map((v, i) => ({
      ...v,
      groupId: i < 2 ? "group-a" : "group-b",
    })),
    overrides: {
      "custom-wash-bg-richblack": {
        logo: {
          slots: [
            { c: 0, m: 0, y: 0, k: 0 },
            { c: 0, m: 0, y: 0, k: 0 },
          ],
          wash: null,
        },
        bg: { slots: [{ c: 60, m: 40, y: 40, k: 100 }], wash: null },
      },
      "custom-heavy-bg-stripes": { disabled: true },
    },
    projectName: "sample proof",
    logoScale: 0.64,
  });
  const out = process.argv[2] || "sample-proof.pdf";
  writeFileSync(out, bytes);
  console.log(`Wrote ${out} (${bytes.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
