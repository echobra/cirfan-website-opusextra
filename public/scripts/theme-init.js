// public/scripts/theme-init.js
// Runs before first paint (render-blocking on purpose, ~300 bytes) so the page never flashes the wrong theme.
// Order: saved choice in localStorage, otherwise the device setting.
(function () {
  var saved = null;
  try {
    saved = localStorage.getItem('cirfan-theme');
  } catch (e) {}
  var theme =
    saved === 'light' || saved === 'dark'
      ? saved
      : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
  var root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.classList.add('js');
})();
