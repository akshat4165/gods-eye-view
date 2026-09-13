// UI THEMES — build-time recoloring of style.css.
//
// The stylesheet hard-codes its cyan accent family in hundreds of places. Rather
// than hand-editing it (and fighting every upstream merge), this Vite plugin
// rewrites each cyan/sky-blue color literal inside declaration values into an
// OKLCH expression that keeps the color's own lightness and chroma but reads
// its hue shift, chroma and lightness factors from root custom properties:
//
//   #00d4ff  →  oklch(calc(0.8078 * var(--gev-l, 1)) calc(0.1497 * var(--gev-c, 1))
//                     calc(219.13deg + var(--gev-h, 0deg)))
//
// With the defaults (1, 1, 0deg) every color renders as before; a theme only
// sets those three properties on <html data-gev-theme="…"> (src/ui/themes.js).

const HUE_MIN = 175; // teal
const HUE_MAX = 255; // sky / azure
const CHROMA_MIN = 0.035; // leaves near-greys alone

const COLOR_RE =
  /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|rgba?\(\s*[\d.]+%?\s*(?:,\s*|\s+)[\d.]+%?\s*(?:,\s*|\s+)[\d.]+%?\s*(?:(?:,|\/)\s*[\d.]+%?\s*)?\)/g;

// A declaration value: text after a colon that ends at `;` or `}` without
// crossing a `{` — so selectors (`#id:hover {`) and at-rule preludes are skipped.
const DECLARATION_RE = /:([^;{}]+)(?=[;}])/g;

function parseColor(literal) {
  let r, g, b, a = 1;
  if (literal[0] === '#') {
    let hex = literal.slice(1);
    if (hex.length <= 4) hex = [...hex].map((ch) => ch + ch).join('');
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
    if (hex.length === 8) a = parseInt(hex.slice(6, 8), 16) / 255;
  } else {
    const parts = literal.slice(literal.indexOf('(') + 1, -1).split(/[\s,/]+/).filter(Boolean);
    const channel = (v) => (v.endsWith('%') ? (parseFloat(v) * 255) / 100 : parseFloat(v));
    [r, g, b] = parts.slice(0, 3).map(channel);
    if (parts[3] != null) a = parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
  }
  if (![r, g, b, a].every(Number.isFinite)) return null;
  return { r, g, b, a };
}

/** sRGB 0-255 → OKLCH { l, c, h(deg) }. */
export function rgbToOklch({ r, g, b }) {
  const lin = (v) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [lr, lg, lb] = [lin(r), lin(g), lin(b)];
  const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const c = Math.hypot(A, B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

const round = (n, digits = 4) => Number(n.toFixed(digits));

/** Themed replacement for one literal, or null when it isn't an accent color. */
export function themeColorLiteral(literal) {
  const rgb = parseColor(literal);
  if (!rgb) return null;
  const { l, c, h } = rgbToOklch(rgb);
  if (c < CHROMA_MIN || h < HUE_MIN || h > HUE_MAX) return null;
  const alpha = rgb.a < 1 ? ` / ${round(rgb.a, 3)}` : '';
  return (
    `oklch(calc(${round(l)} * var(--gev-l, 1)) calc(${round(c)} * var(--gev-c, 1)) ` +
    `calc(${round(h, 2)}deg + var(--gev-h, 0deg))${alpha})`
  );
}

/** Rewrite accent colors in every declaration value. Returns { code, count }. */
export function themeifyCss(css) {
  let count = 0;
  const code = css.replace(DECLARATION_RE, (declaration, value) => {
    const next = value.replace(COLOR_RE, (literal) => {
      if (/^\s*url\(/i.test(value)) return literal;
      const themed = themeColorLiteral(literal);
      if (!themed) return literal;
      count++;
      return themed;
    });
    return `:${next}`;
  });
  return { code, count };
}

/** Vite plugin: applies themeifyCss to the root style.css only. */
export function themeColorsPlugin() {
  return {
    name: 'gev-theme-colors',
    enforce: 'pre',
    transform(code, id) {
      const path = id.split('?')[0];
      if (!/[\\/]style\.css$/.test(path) || /node_modules/.test(path)) return null;
      return { code: themeifyCss(code).code, map: null };
    },
  };
}
