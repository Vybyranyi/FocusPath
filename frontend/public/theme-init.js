/*
 * Applies the saved theme before the first paint. React loads too late:
 * without this the page renders in the device theme and swaps once the app
 * hydrates — a visible flash of the wrong colours on every load.
 *
 * A file rather than an inline <script>: the Content-Security-Policy is
 * `script-src 'self'`, which refuses inline scripts, so the inline version
 * never ran in production. Vite's dev server sends no CSP, which is why it
 * looked fine locally. The key must match THEME_STORAGE_KEY in src/lib/theme.ts.
 */
(function () {
  try {
    var choice = localStorage.getItem('focuspath:theme');
    if (choice === 'light' || choice === 'dark') {
      document.documentElement.setAttribute('data-theme', choice);
    }
  } catch (e) {
    /* Private browsing can throw on access; the device theme applies. */
  }
})();
