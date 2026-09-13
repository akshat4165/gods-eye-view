// UI THEMES — palette picker for the HUD chrome.
//
// build/themeColors.js rewrites style.css's cyan accent family into OKLCH
// expressions driven by three root properties (--gev-h hue shift, --gev-c
// chroma factor, --gev-l lightness factor). A theme sets those, plus a tinted
// glass/background, on <html>. The globe imagery and sensor styles are
// untouched — those stay under VISUAL PRESETS.

import './themes.css';

const STORAGE_KEY = 'gev.uiTheme';

export const THEMES = Object.freeze([
  { id: 'cyan', label: 'Cyan Ops', swatch: '#00d4ff', h: 0, c: 1, l: 1, bg: '#0a0a0f', glass: 'rgba(12, 12, 20, 0.72)' },
  { id: 'amber', label: 'Amber Cockpit', swatch: '#ffb347', h: -150, c: 0.95, l: 1, bg: '#0f0b06', glass: 'rgba(22, 16, 8, 0.74)' },
  { id: 'phosphor', label: 'Phosphor Green', swatch: '#3dff8a', h: -75, c: 1, l: 1, bg: '#060d08', glass: 'rgba(8, 20, 12, 0.74)' },
  { id: 'crimson', label: 'Red Alert', swatch: '#ff5a5f', h: 165, c: 1.15, l: 0.9, bg: '#100607', glass: 'rgba(24, 9, 11, 0.74)' },
  { id: 'violet', label: 'Synthwave', swatch: '#b58cff', h: 80, c: 1.05, l: 0.95, bg: '#0b0714', glass: 'rgba(18, 11, 30, 0.74)' },
  { id: 'rose', label: 'Sakura', swatch: '#ff8fc7', h: 130, c: 0.9, l: 0.97, bg: '#10070c', glass: 'rgba(26, 11, 19, 0.74)' },
  { id: 'arctic', label: 'Arctic Blue', swatch: '#7aa8ff', h: 45, c: 0.9, l: 0.95, bg: '#070a12', glass: 'rgba(10, 15, 28, 0.74)' },
  { id: 'graphite', label: 'Graphite', swatch: '#d9dde3', h: 0, c: 0, l: 1.05, bg: '#0b0b0c', glass: 'rgba(16, 16, 18, 0.76)' },
]);

const byId = new Map(THEMES.map((theme) => [theme.id, theme]));

function readSavedThemeId() {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function saveThemeId(id) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, id);
  } catch {
    // Private mode / blocked storage: the theme still applies for this session.
  }
}

/** Apply a theme to <html>. Unknown ids fall back to the default. */
export function applyTheme(id, root = document.documentElement) {
  const theme = byId.get(id) || THEMES[0];
  root.dataset.gevTheme = theme.id;
  root.style.setProperty('--gev-h', `${theme.h}deg`);
  root.style.setProperty('--gev-c', String(theme.c));
  root.style.setProperty('--gev-l', String(theme.l));
  root.style.setProperty('--bg-dark', theme.bg);
  root.style.setProperty('--glass-bg', theme.glass);
  return theme;
}

/** Apply the persisted theme as early as possible (called from main.js). */
export function applySavedTheme() {
  return applyTheme(readSavedThemeId());
}

/**
 * Bind the palette button in the top-center actions to a theme popover.
 * @param {{ button: HTMLButtonElement|null, onChange?: (theme: object) => void }} options
 * @returns {{ destroy(): void }}
 */
export function bindThemePicker({ button, onChange = null }) {
  if (!button) return { destroy() {} };

  const popover = document.createElement('div');
  popover.id = 'theme-popover';
  popover.setAttribute('role', 'radiogroup');
  popover.setAttribute('aria-label', 'UI theme');
  popover.hidden = true;

  const heading = document.createElement('div');
  heading.className = 'theme-popover-heading';
  heading.textContent = 'UI THEME';
  popover.append(heading);

  const options = THEMES.map((theme) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'theme-option';
    option.dataset.themeId = theme.id;
    option.setAttribute('role', 'radio');
    option.innerHTML = '<span class="theme-swatch" aria-hidden="true"></span><span class="theme-name"></span>';
    option.querySelector('.theme-swatch').style.setProperty('--swatch', theme.swatch);
    option.querySelector('.theme-name').textContent = theme.label;
    popover.append(option);
    return option;
  });
  document.body.append(popover);

  const sync = () => {
    const active = document.documentElement.dataset.gevTheme || THEMES[0].id;
    for (const option of options) {
      const selected = option.dataset.themeId === active;
      option.classList.toggle('active', selected);
      option.setAttribute('aria-checked', String(selected));
    }
  };

  const position = () => {
    const rect = button.getBoundingClientRect();
    popover.style.top = `${Math.round(rect.bottom + 10)}px`;
    popover.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
  };

  const setOpen = (open) => {
    popover.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    button.classList.toggle('is-active', open);
    if (open) {
      sync();
      position();
      (options.find((o) => o.classList.contains('active')) || options[0]).focus();
    }
  };

  const onButtonClick = (event) => {
    event.stopPropagation();
    setOpen(popover.hidden);
  };
  const onPopoverClick = (event) => {
    const option = event.target.closest('.theme-option');
    if (!option) return;
    const theme = applyTheme(option.dataset.themeId);
    saveThemeId(theme.id);
    sync();
    onChange?.(theme);
  };
  const onDocumentPointer = (event) => {
    if (popover.hidden) return;
    if (popover.contains(event.target) || button.contains(event.target)) return;
    setOpen(false);
  };
  const onKeyDown = (event) => {
    if (popover.hidden) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      setOpen(false);
      button.focus();
      return;
    }
    const index = options.indexOf(document.activeElement);
    if (index < 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      options[(index + step + options.length) % options.length].focus();
    }
  };

  button.setAttribute('aria-haspopup', 'true');
  button.setAttribute('aria-expanded', 'false');
  button.addEventListener('click', onButtonClick);
  popover.addEventListener('click', onPopoverClick);
  document.addEventListener('pointerdown', onDocumentPointer, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', position);

  return {
    destroy() {
      button.removeEventListener('click', onButtonClick);
      popover.removeEventListener('click', onPopoverClick);
      document.removeEventListener('pointerdown', onDocumentPointer, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', position);
      popover.remove();
    },
  };
}
