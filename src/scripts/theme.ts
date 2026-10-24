// src/scripts/theme.ts
// Light/dark mode.
// 1. First visit: follows the device setting, and keeps following it if the device changes.
// 2. Once the visitor uses the switch, that choice is saved in localStorage and wins from then on.
// The initial value is applied before paint by /public/scripts/theme-init.js.

type Theme = 'light' | 'dark';

const KEY = 'cirfan-theme';
const root = document.documentElement;
const deviceDark = window.matchMedia('(prefers-color-scheme: dark)');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const readSaved = (): Theme | null => {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
};

const save = (theme: Theme) => {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* Storage blocked (private mode, strict settings): the switch still works for this page view. */
  }
};

const current = (): Theme => (root.dataset.theme === 'dark' ? 'dark' : 'light');

const apply = (theme: Theme) => {
  root.dataset.theme = theme;
  document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]').forEach((button) => {
    button.setAttribute('aria-checked', String(theme === 'dark'));
  });
};

const switchTo = (theme: Theme, origin?: HTMLElement) => {
  const canAnimate = typeof document.startViewTransition === 'function' && !reduceMotion.matches && origin;
  if (!canAnimate) {
    apply(theme);
    return;
  }
  const rect = origin.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const transition = document.startViewTransition(() => apply(theme));
  transition.ready
    .then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 700, easing: 'cubic-bezier(0.6, 0.05, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    })
    .catch(() => {});
};

export function initTheme() {
  apply(readSaved() ?? (deviceDark.matches ? 'dark' : 'light'));

  document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const next: Theme = current() === 'dark' ? 'light' : 'dark';
      save(next);
      switchTo(next, button);
    });
  });

  deviceDark.addEventListener('change', (event) => {
    if (!readSaved()) apply(event.matches ? 'dark' : 'light');
  });

  // Keep several open tabs in sync.
  window.addEventListener('storage', (event) => {
    if (event.key === KEY) apply(readSaved() ?? (deviceDark.matches ? 'dark' : 'light'));
  });
}
