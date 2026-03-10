// Apply saved theme before first paint (prevents flash)
(function () {
  var saved = localStorage.getItem('theme');
  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (saved === 'dark' || (!saved && prefersDark)) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();

function toggleTheme() {
  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('theme', 'light');
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('theme', 'dark');
  }
  _syncThemeBtns();
}

function _syncThemeBtns() {
  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.querySelectorAll('.theme-toggle').forEach(function (btn) {
    btn.textContent = isDark ? '\u2600\uFE0F' : '\uD83C\uDF19';
    btn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  });
}

document.addEventListener('DOMContentLoaded', _syncThemeBtns);

// When served behind a sub-path proxy, intercept fetch so absolute API paths
// (e.g. /api/complaint) are automatically prefixed with the base path.
if (window.__BASE__) {
  var _origFetch = window.fetch;
  window.fetch = function (url, opts) {
    if (typeof url === 'string' && url.charAt(0) === '/' && url.charAt(1) !== '/') {
      url = window.__BASE__ + url;
    }
    return _origFetch.call(this, url, opts);
  };
}
