/* The theme switch: auto (the system's), light or dark. Charts read their colours from CSS. */

function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  Prefs.saveTheme(mode);
  $('#themeBtn').textContent = { auto: '◐ Auto', light: '☀︎ Light', dark: '☾ Dark' }[mode];
  $('#themeBtn').dataset.mode = mode;
  Panels.invalidate(['theme']);
}

function initTheme() {
  applyTheme(Prefs.theme);
  $('#themeBtn').addEventListener('click', () => {
    const order = ['auto', 'light', 'dark'];
    applyTheme(order[(order.indexOf($('#themeBtn').dataset.mode) + 1) % 3]);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => Panels.invalidate(['theme']));
}
