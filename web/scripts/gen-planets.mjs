/**
 * Generates planet sprite assets (SVG) into web/public/assets/planets/.
 *
 * These are the "nicer planet sprites" that replace the plain placeholder
 * circles via the swap seam in src/Planet.tsx (PlanetSprite). Swapping these
 * out for e.g. Deep-Fold PNGs later is a drop-in: same filenames, same seam,
 * NO change to state/animation logic.
 *
 * Run:  node scripts/gen-planets.mjs
 *
 * Each sprite is a 120x120 SVG with the planet disc centered (radius 48) plus
 * room for atmosphere/ring. Transparent background so the scene's glow/rings
 * (drawn by Planet) show through. Light comes from the upper-left.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "assets", "planets");
mkdirSync(OUT, { recursive: true });

const CX = 60, CY = 60, R = 48;

// Small seeded RNG so output is identical every run (reproducible assets).
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

// Shared defs: limb-darkening overlay + a bright crescent on the lit side.
function shellDefs(id) {
  return `
    <radialGradient id="limb-${id}" cx="38%" cy="34%" r="75%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.22"/>
      <stop offset="55%" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.55"/>
    </radialGradient>
    <clipPath id="disc-${id}"><circle cx="${CX}" cy="${CY}" r="${R}"/></clipPath>`;
}

// The disc base + limb shading + a thin atmosphere rim, wrapping feature markup.
function disc(id, baseFill, features, rim = "#9fd0ff") {
  return `
  <g clip-path="url(#disc-${id})">
    <circle cx="${CX}" cy="${CY}" r="${R}" fill="${baseFill}"/>
    ${features}
    <circle cx="${CX}" cy="${CY}" r="${R}" fill="url(#limb-${id})"/>
  </g>
  <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${rim}" stroke-opacity="0.35" stroke-width="1.5"/>`;
}

function svg(id, defs, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <defs>${shellDefs(id)}${defs}</defs>
  ${body}
</svg>`;
}

// ---- planet builders -------------------------------------------------------

function blobs(seed, color, count, sizeMin, sizeMax, op = 0.85) {
  const r = rng(seed);
  let out = "";
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2;
    const rad = R * 0.78 * Math.sqrt(r());
    const x = CX + Math.cos(a) * rad;
    const y = CY + Math.sin(a) * rad;
    const s = sizeMin + r() * (sizeMax - sizeMin);
    out += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${s.toFixed(1)}" ry="${(s * (0.6 + r() * 0.5)).toFixed(1)}" fill="${color}" opacity="${op}"/>`;
  }
  return out;
}

function bands(colors) {
  let out = "";
  const n = colors.length;
  for (let i = 0; i < n; i++) {
    const y0 = CY - R + (i * (2 * R)) / n;
    const h = (2 * R) / n + 1;
    out += `<rect x="${CX - R}" y="${y0.toFixed(1)}" width="${2 * R}" height="${h.toFixed(1)}" fill="${colors[i]}"/>`;
  }
  return out;
}

function planets() {
  return {
    // 0 — terran: ocean + green continents + polar caps + cloud wisps
    "planet-0": svg(
      "0",
      `<radialGradient id="ocn0" cx="40%" cy="36%" r="75%"><stop offset="0%" stop-color="#3aa0e0"/><stop offset="100%" stop-color="#0d4f86"/></radialGradient>`,
      disc(
        "0",
        "url(#ocn0)",
        blobs(11, "#3f9e54", 9, 6, 13) +
          blobs(23, "#2f7d42", 6, 4, 8, 0.7) +
          `<ellipse cx="${CX}" cy="${CY - R + 7}" rx="20" ry="6" fill="#eaf6ff" opacity="0.85"/>` +
          `<ellipse cx="${CX}" cy="${CY + R - 6}" rx="16" ry="5" fill="#eaf6ff" opacity="0.85"/>` +
          blobs(99, "#ffffff", 5, 5, 10, 0.18),
      ),
    ),
    // 1 — gas giant (amber bands + storm)
    "planet-1": svg(
      "1",
      "",
      disc(
        "1",
        "#caa15e",
        bands(["#e8c98a", "#c79550", "#e3bd7c", "#b07e3e", "#d8ad6a", "#9c6e34", "#e0b873"]) +
          `<ellipse cx="${CX + 12}" cy="${CY + 8}" rx="9" ry="6" fill="#7a4a22" opacity="0.8"/>` +
          `<ellipse cx="${CX + 12}" cy="${CY + 8}" rx="4.5" ry="3" fill="#b85c2a" opacity="0.9"/>`,
        "#ffd9a0",
      ),
    ),
    // 2 — ice world (pale, cracked)
    "planet-2": svg(
      "2",
      `<radialGradient id="ice2" cx="40%" cy="36%" r="78%"><stop offset="0%" stop-color="#eaffff"/><stop offset="100%" stop-color="#9fc4d8"/></radialGradient>`,
      disc(
        "2",
        "url(#ice2)",
        blobs(7, "#cfe9f5", 7, 6, 12, 0.6) +
          `<path d="M${CX - 30} ${CY - 6} L${CX - 6} ${CY + 4} L${CX + 18} ${CY - 8} L${CX + 34} ${CY + 6}" stroke="#7fa9bd" stroke-width="1.4" fill="none" opacity="0.7"/>` +
          `<path d="M${CX - 24} ${CY + 16} L${CX} ${CY + 20} L${CX + 26} ${CY + 12}" stroke="#7fa9bd" stroke-width="1.2" fill="none" opacity="0.6"/>`,
        "#dff6ff",
      ),
    ),
    // 3 — lava world (dark crust + glowing cracks)
    "planet-3": svg(
      "3",
      `<radialGradient id="lava3" cx="40%" cy="36%" r="78%"><stop offset="0%" stop-color="#5a2418"/><stop offset="100%" stop-color="#1c0d0a"/></radialGradient>`,
      disc(
        "3",
        "url(#lava3)",
        `<path d="M${CX - 34} ${CY - 10} L${CX - 8} ${CY - 2} L${CX + 10} ${CY - 14} L${CX + 30} ${CY - 4}" stroke="#ff7a2a" stroke-width="2.2" fill="none" opacity="0.95"/>` +
          `<path d="M${CX - 28} ${CY + 12} L${CX - 4} ${CY + 18} L${CX + 16} ${CY + 8} L${CX + 30} ${CY + 16}" stroke="#ff9d3d" stroke-width="1.8" fill="none" opacity="0.9"/>` +
          blobs(42, "#ff8a30", 5, 3, 6, 0.85),
        "#ff8a4a",
      ),
    ),
    // 4 — desert / mars (rust + craters)
    "planet-4": svg(
      "4",
      `<radialGradient id="des4" cx="40%" cy="36%" r="78%"><stop offset="0%" stop-color="#d9763e"/><stop offset="100%" stop-color="#7f3417"/></radialGradient>`,
      disc(
        "4",
        "url(#des4)",
        blobs(17, "#b85a2c", 8, 5, 10, 0.55) +
          blobs(61, "#e89a63", 6, 3, 6, 0.5) +
          `<ellipse cx="${CX}" cy="${CY - R + 6}" rx="13" ry="4" fill="#f3e6da" opacity="0.8"/>`,
        "#f0a878",
      ),
    ),
    // 5 — ocean world (deep blue swirls)
    "planet-5": svg(
      "5",
      `<radialGradient id="oce5" cx="40%" cy="36%" r="78%"><stop offset="0%" stop-color="#2f7fcf"/><stop offset="100%" stop-color="#0a2f63"/></radialGradient>`,
      disc(
        "5",
        "url(#oce5)",
        blobs(33, "#4f9be0", 7, 6, 12, 0.5) +
          blobs(88, "#ffffff", 6, 4, 9, 0.16) +
          `<ellipse cx="${CX}" cy="${CY + R - 6}" rx="15" ry="4" fill="#eaf6ff" opacity="0.8"/>`,
        "#bfe0ff",
      ),
    ),
    // 6 — exotic (violet bands + glow)
    "planet-6": svg(
      "6",
      "",
      disc(
        "6",
        "#7a3fb0",
        bands(["#b07ce0", "#7a3fb0", "#9b5fcf", "#5e2c8c", "#a86fdc", "#4a2270", "#9457c8"]) +
          blobs(55, "#d9b6ff", 5, 4, 8, 0.35),
        "#e3c6ff",
      ),
    ),
    // 7 — ringed gas world (the ring sits outside the disc)
    "planet-7": svg(
      "7",
      `<linearGradient id="ring7" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#d9c8a0" stop-opacity="0.1"/><stop offset="50%" stop-color="#efe2bf" stop-opacity="0.95"/><stop offset="100%" stop-color="#d9c8a0" stop-opacity="0.1"/></linearGradient>`,
      // ring behind, disc, then ring front-half for the "passes in front" look
      `<g transform="rotate(-18 ${CX} ${CY})">
         <ellipse cx="${CX}" cy="${CY}" rx="${R + 12}" ry="13" fill="none" stroke="url(#ring7)" stroke-width="7"/>
       </g>` +
        disc(
          "7",
          "#5fb0a6",
          bands(["#8fd3c9", "#5fb0a6", "#7cc6bc", "#3f8a82", "#86ccc3", "#2f6b64", "#79c2b9"]) +
            `<ellipse cx="${CX - 10}" cy="${CY - 6}" rx="7" ry="4" fill="#2f6b64" opacity="0.7"/>`,
          "#bff0e8",
        ) +
        `<g transform="rotate(-18 ${CX} ${CY})">
         <path d="M ${CX - R - 12} ${CY} A ${R + 12} 13 0 0 0 ${CX + R + 12} ${CY}" fill="none" stroke="url(#ring7)" stroke-width="7"/>
       </g>`,
    ),
  };
}

const all = planets();
for (const [name, markup] of Object.entries(all)) {
  writeFileSync(join(OUT, `${name}.svg`), markup);
}
console.log(`Wrote ${Object.keys(all).length} planet sprites to ${OUT}`);
