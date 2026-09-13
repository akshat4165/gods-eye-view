import test from 'node:test';
import assert from 'node:assert/strict';
import { themeColorLiteral, themeifyCss } from '../../build/themeColors.js';

test('cyan accent literals become theme-driven OKLCH expressions', () => {
  const themed = themeColorLiteral('rgba(0, 212, 255, 0.15)');
  assert.match(themed, /^oklch\(calc\(0\.\d+ \* var\(--gev-l, 1\)\) calc\(0\.\d+ \* var\(--gev-c, 1\)\) calc\([\d.]+deg \+ var\(--gev-h, 0deg\)\) \/ 0\.15\)$/);
  assert.ok(themeColorLiteral('#00d4ff'));
  assert.ok(themeColorLiteral('#22e6e6'));
});

test('warm, neutral and dark colors are left alone', () => {
  for (const literal of ['#ffb800', '#d5a863', '#ff4444', 'rgba(255, 255, 255, 0.08)', '#0a0a0f', 'rgba(12, 12, 20, 0.72)', '#000']) {
    assert.equal(themeColorLiteral(literal), null, literal);
  }
});

test('only declaration values are rewritten, never selectors or at-rule preludes', () => {
  const css = '#add:hover, #bed { color: #00d4ff; border: 1px solid rgba(0,212,255,.4) }\n@media (max-width: 700px) { #cafe { color: #ffb800; } }';
  const { code, count } = themeifyCss(css);
  assert.equal(count, 2);
  assert.ok(code.startsWith('#add:hover, #bed {'));
  assert.ok(code.includes('#cafe { color: #ffb800; }'));
  assert.ok(code.includes('@media (max-width: 700px)'));
});
