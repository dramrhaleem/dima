/* Dima native UI kit — 2026-10-31. No framework or remote runtime.
 * Pattern references retrieved from 21st.dev:
 * Magnetic: https://21st.dev/@mohammadshehadeh/components/magnetic-button
 * Original notice: Magnetic Button from Hirael <https://hirael.com/components/animation/magnetic-button>
 * MIT · Mohammad Shehadeh · https://github.com/MohammadShehadeh/hirael
 * Progress: https://21st.dev/@dillionverma/components/animated-circular-progress-bar (MIT)
 * Reveal: https://21st.dev/@ddoemonn/components/text-reveal (MIT)
 * Steps: https://21st.dev/@originui/components/stepper (MIT)
 * Path-field inspiration: https://21st.dev/@uniquesonu/components/animated-svg-background
 * Command-pattern inspiration: https://21st.dev/@rafa-porto/components/command-palette
 * Last two licenses were not established. Their implementations here are independent;
 * no original path data, layout or source chunks are included. See catalog provenance.
 * Dima-specific adaptations do not establish exclusive ownership of upstream patterns.
 */
(function () {
  'use strict';
  if (window.DimaUI) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
  const initialized = new WeakSet();
  const motionToggles = new WeakSet();
  const reveals = new WeakSet();
  const activeReveals = new Set();
  const html = document.documentElement;
  const SVG = 'http://www.w3.org/2000/svg';
  const motionEnabled = () => !reduced.matches && html.dataset.dimaMotion !== 'off' && !document.hidden;
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
  function elements(root, selector) {
    return [...(root.matches?.(selector) ? [root] : []), ...root.querySelectorAll(selector)];
  }
  function syncMotion() {
    const allowed = motionEnabled();
    html.dataset.dimaMotionAllowed = String(allowed);
    document.querySelectorAll('[data-motion-toggle]').forEach(button => {
      const enabled = !reduced.matches && html.dataset.dimaMotion !== 'off';
      button.setAttribute('aria-pressed', String(enabled));
      button.setAttribute('aria-label', reduced.matches ? 'Motion off: system reduced-motion preference' : `Decorative motion ${enabled ? 'on' : 'off'}`);
      const label = button.querySelector('[data-motion-label]');
      (label || button).textContent = reduced.matches ? 'Motion off · system' : `Motion ${enabled ? 'on' : 'off'}`;
      button.setAttribute('aria-disabled', String(reduced.matches));
    });
    if (!allowed) {
      document.querySelectorAll('[data-magnetic]').forEach(resetMagnetic);
      activeReveals.forEach(animation => animation.cancel());
      activeReveals.clear();
    }
  }
  function resetMagnetic(target) {
    target.style.setProperty('--dima-magnetic-x', '0px');
    target.style.setProperty('--dima-magnetic-y', '0px');
  }
  function initMagnetic(target) {
    if (!target.matches('button, a[href]') || initialized.has(target)) return;
    initialized.add(target);
    let inner = target.querySelector(':scope > .dima-magnetic-content');
    if (!inner) {
      inner = document.createElement('span');
      inner.className = 'dima-magnetic-content';
      inner.append(...target.childNodes);
      target.append(inner);
    }
    target.addEventListener('pointermove', event => {
      if (!motionEnabled() || !fine.matches || event.pointerType === 'touch' || target.matches(':focus-visible, :disabled, [aria-disabled="true"]')) return resetMagnetic(target);
      const rect = target.getBoundingClientRect();
      // Move the label, never the hit target. Maximum total displacement is 4px.
      const dx = (event.clientX - rect.left - rect.width / 2) * 0.08;
      const dy = (event.clientY - rect.top - rect.height / 2) * 0.08;
      const scale = Math.min(1, 4 / Math.max(1, Math.hypot(dx, dy)));
      target.style.setProperty('--dima-magnetic-x', `${dx * scale}px`);
      target.style.setProperty('--dima-magnetic-y', `${dy * scale}px`);
    });
    ['pointerleave', 'pointercancel', 'blur', 'keydown', 'focus'].forEach(type => target.addEventListener(type, () => resetMagnetic(target)));
  }
  function replay(element) {
    if (!element || !motionEnabled() || typeof element.animate !== 'function') return;
    element.getAnimations().filter(animation => activeReveals.has(animation)).forEach(animation => animation.cancel());
    const animation = element.animate([
      { opacity: 0.72, transform: 'translateY(8px)', filter: 'blur(1px)' },
      { opacity: 1, transform: 'translateY(0)', filter: 'blur(0)' }
    ], { duration: 360, easing: 'cubic-bezier(.16,1,.3,1)' });
    activeReveals.add(animation);
    animation.finished.catch(() => {}).finally(() => activeReveals.delete(animation));
    return animation;
  }
  const revealObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      revealObserver.unobserve(entry.target);
      replay(entry.target);
    });
  }, { threshold: 0.15 }) : null;

  class DimaPathField extends HTMLElement {
    connectedCallback() {
      this.setAttribute('aria-hidden', 'true');
      if (!this.firstElementChild) {
        const svg = document.createElementNS(SVG, 'svg');
        svg.setAttribute('viewBox', '0 0 900 600');
        svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
        svg.setAttribute('focusable', 'false');
        // Authored uneven, rounded stairway. Not the logo or upstream path geometry.
        for (let i = 0; i < 8; i += 1) {
          const path = document.createElementNS(SVG, 'path');
          path.setAttribute('d', 'M-100 590 H130 Q161 590 161 559 V489 Q161 460 191 460 H292 Q319 460 319 434 V372 Q319 347 347 347 H415 Q447 347 447 315 V264 Q447 235 476 235 H603 Q637 235 637 200 V122 Q637 94 667 94 H825 Q857 94 857 62 V-50');
          path.setAttribute('transform', `translate(${i * 13 - 45} ${i * 17 - 50})`);
          path.setAttribute('pathLength', '100');
          path.style.setProperty('--path-delay', `${i * -1.7}s`);
          path.classList.add(i % 2 ? 'dima-path-accent' : 'dima-path-primary');
          svg.append(path);
        }
        this.append(svg);
      }
      if ('IntersectionObserver' in window) {
        this._observer = new IntersectionObserver(entries => {
          this.dataset.inView = String(entries[0].isIntersecting);
        }, { rootMargin: '40px' });
        this._observer.observe(this);
      } else this.dataset.inView = 'true';
    }
    disconnectedCallback() { this._observer?.disconnect(); }
  }
  class DimaProgress extends HTMLElement {
    static get observedAttributes() { return ['value', 'label']; }
    connectedCallback() { this.render(); }
    attributeChangedCallback() { if (this.isConnected) this.render(); }
    render() {
      const value = Math.round(clamp(this.getAttribute('value'), 0, 100) * 10) / 10;
      this.setAttribute('role', 'progressbar');
      this.setAttribute('aria-label', this.getAttribute('label') || 'Task completion');
      this.setAttribute('aria-valuemin', '0');
      this.setAttribute('aria-valuemax', '100');
      this.setAttribute('aria-valuenow', String(value));
      this.innerHTML = '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><circle class="dima-progress-track" cx="50" cy="50" r="43"/><circle class="dima-progress-fill" cx="50" cy="50" r="43" pathLength="100"/></svg><span class="dima-progress-value" aria-hidden="true"></span>';
      this.querySelector('.dima-progress-fill').style.strokeDashoffset = String(100 - value);
      this.querySelector('.dima-progress-value').textContent = `${value}%`;
    }
  }
  class DimaSteps extends HTMLElement {
    static get observedAttributes() { return ['current', 'labels']; }
    connectedCallback() { this.render(); }
    attributeChangedCallback() { if (this.isConnected) this.render(); }
    render() {
      const labels = (this.getAttribute('labels') || '').split('|').map(label => label.trim()).filter(Boolean);
      const current = Math.round(clamp(this.getAttribute('current') || 1, 1, Math.max(1, labels.length)));
      const list = document.createElement('ol');
      list.className = 'dima-step-list';
      list.setAttribute('aria-label', 'Plan setup steps');
      labels.forEach((label, index) => {
        const item = document.createElement('li');
        item.className = 'dima-step';
        item.dataset.state = index + 1 === current ? 'current' : index + 1 < current ? 'previous' : 'upcoming';
        if (index + 1 === current) item.setAttribute('aria-current', 'step');
        const number = document.createElement('span');
        number.className = 'dima-step-number';
        number.textContent = String(index + 1);
        const text = document.createElement('span');
        text.textContent = label;
        item.append(number, text);
        list.append(item);
      });
      this.replaceChildren(list);
    }
  }
  for (const [name, component] of [['dima-path-field', DimaPathField], ['dima-progress', DimaProgress], ['dima-steps', DimaSteps]]) {
    if (!customElements.get(name)) customElements.define(name, component);
  }

  let commandDialog;
  let commandTrigger;
  let commandItems = [];
  let commandResults = [];
  let selected = 0;
  function safeHref(href) {
    if (typeof href !== 'string' || !href.trim()) return null;
    try {
      const url = new URL(href, document.baseURI);
      return ['https:', 'http:', 'file:'].includes(url.protocol) ? href : null;
    } catch (_) { return null; }
  }
  function chooseCommand(index) {
    const item = commandResults[index];
    if (!item) return;
    commandDialog.close();
    window.location.assign(item.href);
  }
  function selectCommand(index) {
    selected = clamp(index, 0, Math.max(0, commandResults.length - 1));
    commandDialog.querySelectorAll('[role="option"]').forEach((option, i) => {
      option.setAttribute('aria-selected', String(i === selected));
      if (i === selected) option.scrollIntoView({ block: 'nearest' });
    });
    const input = commandDialog.querySelector('input');
    if (commandResults.length) input.setAttribute('aria-activedescendant', `dima-command-${selected}`);
    else input.removeAttribute('aria-activedescendant');
  }
  function renderCommands() {
    const query = commandDialog.querySelector('input').value.trim().toLocaleLowerCase();
    commandResults = commandItems.filter(item => `${item.label} ${item.description}`.toLocaleLowerCase().includes(query));
    const results = commandDialog.querySelector('[role="listbox"]');
    results.replaceChildren();
    commandResults.forEach((item, index) => {
      const option = document.createElement('li');
      option.id = `dima-command-${index}`;
      option.setAttribute('role', 'option');
      option.className = 'dima-command-option';
      const title = document.createElement('strong');
      title.textContent = item.label;
      const description = document.createElement('span');
      description.textContent = item.description;
      option.append(title, description);
      option.addEventListener('click', () => chooseCommand(index));
      option.addEventListener('pointermove', () => selectCommand(index));
      results.append(option);
    });
    commandDialog.querySelector('[data-command-empty]').hidden = commandResults.length > 0;
    commandDialog.querySelector('[data-command-count]').textContent = `${commandResults.length} destination${commandResults.length === 1 ? '' : 's'}`;
    selectCommand(0);
  }
  function createCommandDialog() {
    const dialog = document.createElement('dialog');
    dialog.className = 'dima-command-dialog';
    dialog.setAttribute('aria-labelledby', 'dima-command-heading');
    dialog.innerHTML = '<div class="dima-command-header"><h2 id="dima-command-heading">Quick navigation</h2><button type="button" class="dima-command-close">Close</button></div><label class="dima-command-label" for="dima-command-search">Search destinations</label><input id="dima-command-search" type="search" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="dima-command-results" autocomplete="off" placeholder="Find a page or course…"><ul id="dima-command-results" role="listbox" aria-label="Destinations"></ul><p data-command-empty hidden>No matching destinations. Try a different search.</p><footer class="dima-command-footer"><span data-command-count role="status" aria-live="polite"></span><span>↑ ↓ to choose · Enter to open · Esc to close</span></footer>';
    dialog.querySelector('.dima-command-close').addEventListener('click', () => dialog.close());
    dialog.querySelector('input').addEventListener('input', renderCommands);
    dialog.querySelector('input').addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        selectCommand(selected + (event.key === 'ArrowDown' ? 1 : -1));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        chooseCommand(selected);
      }
    });
    dialog.addEventListener('close', () => {
      if (commandTrigger?.isConnected) commandTrigger.focus({ preventScroll: true });
    });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
    document.body.append(dialog);
    return dialog;
  }
  function openCommands(items, trigger = document.activeElement) {
    commandDialog ||= createCommandDialog();
    commandTrigger = trigger;
    commandItems = (Array.isArray(items) ? items : []).filter(item => item && typeof item.label === 'string' && item.label.trim() && safeHref(item.href)).map(item => ({ label: item.label, description: String(item.description || ''), href: safeHref(item.href) }));
    commandDialog.querySelector('input').value = '';
    renderCommands();
    if (!commandDialog.open) commandDialog.showModal();
    commandDialog.querySelector('input').focus();
    return commandDialog;
  }
  function init(root = document) {
    elements(root, '[data-magnetic]').forEach(initMagnetic);
    elements(root, '[data-reveal]').forEach(element => {
      if (reveals.has(element)) return;
      reveals.add(element);
      if (revealObserver) revealObserver.observe(element);
      else replay(element);
    });
    elements(root, '[data-motion-toggle]').forEach(button => {
      if (motionToggles.has(button)) return;
      motionToggles.add(button);
      button.addEventListener('click', () => {
        if (reduced.matches) return;
        html.dataset.dimaMotion = html.dataset.dimaMotion === 'off' ? 'on' : 'off';
        syncMotion();
      });
    });
    syncMotion();
  }
  window.DimaUI = Object.freeze({ init, openCommands, replay });
  reduced.addEventListener('change', syncMotion);
  fine.addEventListener('change', syncMotion);
  document.addEventListener('visibilitychange', syncMotion);
  new MutationObserver(syncMotion).observe(html, { attributes: true, attributeFilter: ['data-dima-motion'] });
  if (!html.dataset.dimaMotion) html.dataset.dimaMotion = 'on';
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => init(), { once: true });
  else init();
})();
