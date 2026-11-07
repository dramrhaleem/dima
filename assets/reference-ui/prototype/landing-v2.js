/* Landing composition hooks. Core controls remain native links and custom elements. */
(() => {
  const initialize = () => {
    if (window.DimaUI) window.DimaUI.init(document);
    const stage = document.querySelector('.hero-stage');
    if (stage && 'IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => entries.forEach(entry => {
        entry.target.dataset.inView = String(entry.isIntersecting);
      }));
      observer.observe(stage);
    } else if (stage) stage.dataset.inView = 'true';
    // A fallback keeps the visible motion control useful if the shared kit is omitted.
    if (!window.DimaUI) {
      const button = document.querySelector('[data-motion-toggle]');
      if (!button) return;
      let disabled = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const sync = () => {
        document.documentElement.dataset.dimaMotion = disabled ? 'off' : 'on';
        document.documentElement.dataset.dimaMotionAllowed = String(!disabled);
        button.textContent = disabled ? 'Enable motion' : 'Pause motion';
        button.setAttribute('aria-pressed', String(disabled));
      };
      button.addEventListener('click', () => { disabled = !disabled; sync(); });
      sync();
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
