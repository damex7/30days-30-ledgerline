// Checks every colour pair the UI relies on against WCAG 2.2:
// 4.5:1 for body text, 3:1 for large text, UI parts and focus rings.
//   npm run check:contrast
// If a pair fails, adjust the token value in app/globals.css (and here),
// not the rule.

const light = {
  page: "#ffffff", card: "#faf7ef", ink: "#121110", ink2: "#4a463c", gold: "#b8892b", goldInk: "#7a5a0e",
  onGold: "#121110", field: "#7c735f", night: "#121110", nightInk: "#f6f2e7", nightGold: "#e2b94a", tint: "#f3ecdb",
};
const dark = {
  page: "#0c0b09", card: "#16140f", ink: "#f6f2e7", ink2: "#bfb7a3", gold: "#e2b94a", goldInk: "#e2b94a",
  onGold: "#121110", field: "#8a8170", night: "#050504", nightInk: "#f6f2e7", nightGold: "#e2b94a", tint: "#211d15",
};

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

const pairs = (t, mode) => [
  [`${mode} body text on page`, t.ink, t.page, 4.5],
  [`${mode} body text on card`, t.ink, t.card, 4.5],
  [`${mode} body text on tint`, t.ink, t.tint, 4.5],
  [`${mode} secondary text on page`, t.ink2, t.page, 4.5],
  [`${mode} secondary text on card`, t.ink2, t.card, 4.5],
  [`${mode} gold text/link on page`, t.goldInk, t.page, 4.5],
  [`${mode} gold text/link on card`, t.goldInk, t.card, 4.5],
  [`${mode} text on gold fill`, t.onGold, t.gold, 4.5],
  [`${mode} gold fill/rule vs page (UI)`, t.gold, t.page, 3],
  [`${mode} field border vs page (UI)`, t.field, t.page, 3],
  [`${mode} field border vs card (UI)`, t.field, t.card, 3],
  [`${mode} sidebar text`, t.nightInk, t.night, 4.5],
  [`${mode} sidebar gold text`, t.nightGold, t.night, 4.5],
];

const focus = [
  ["light focus ring (black inner) vs page", light.ink, light.page, 3],
  ["light focus ring (black inner) vs card", light.ink, light.card, 3],
  ["light focus ring (gold outer) vs page", light.gold, light.page, 3],
  ["dark focus ring (gold) vs page", dark.gold, dark.page, 3],
  ["dark focus ring (gold) vs card", dark.gold, dark.card, 3],
];

let failed = 0;
for (const [name, fg, bg, min] of [...pairs(light, "light"), ...pairs(dark, "dark"), ...focus]) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${r.toFixed(2).padStart(5)}:1 (needs ${min})  ${name}`);
}
console.log(failed ? `\n${failed} pair(s) fail.` : "\nAll pairs pass.");
process.exitCode = failed ? 1 : 0;
