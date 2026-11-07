/* global document, localStorage, window, Event, Element */
/* One browser-local appearance contract for the static landing and React app.
   Explicit opt-in only: neither device mode nor legacy account values enable dark. */
(() => {
  const key = 'dima-appearance-v1';
  const root = document.documentElement;
  const normalize = value => value === 'dark' ? 'dark' : 'light';
  const read = () => { try { return normalize(localStorage.getItem(key)); } catch { return 'light'; } };
  function apply(value, persist = false) {
    const mode = normalize(value);
    root.dataset.theme = mode;
    root.style.colorScheme = mode;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'dark' ? '#0C1220' : '#FAF9F6');
    document.querySelectorAll('[data-theme-toggle]').forEach(button => button.setAttribute('aria-pressed', String(mode === 'dark')));
    if (persist) { try { localStorage.setItem(key, mode); } catch { /* This page still switches when persistence is unavailable. */ } }
    window.dispatchEvent(new Event('dima-appearance-change'));
  }
  apply(read());
  window.addEventListener('dima-appearance-set', event => apply(event.detail, true));
  window.addEventListener('storage', event => { if (event.key === key || event.key === null) apply(read()); });
  window.addEventListener('pageshow', event => { if (event.persisted) apply(read()); });
  document.addEventListener('DOMContentLoaded', () => apply(root.dataset.theme));
  document.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('[data-theme-toggle]')) apply(root.dataset.theme === 'dark' ? 'light' : 'dark', true);
  });
})();
