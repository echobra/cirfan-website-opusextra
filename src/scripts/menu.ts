// src/scripts/menu.ts
// Mobile navigation toggle.
export function initMenu() {
  const button = document.querySelector<HTMLButtonElement>('[data-menu-button]');
  const nav = document.getElementById('site-nav');
  if (!button || !nav) return;

  const setOpen = (open: boolean) => {
    button.setAttribute('aria-expanded', String(open));
    nav.classList.toggle('is-open', open);
  };

  button.addEventListener('click', () => setOpen(button.getAttribute('aria-expanded') !== 'true'));

  nav.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('a')) setOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      button.focus();
    }
  });

  window.matchMedia('(min-width: 52.0625rem)').addEventListener('change', (event) => {
    if (event.matches) setOpen(false);
  });
}
