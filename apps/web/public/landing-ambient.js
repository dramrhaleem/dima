/* global document, window, matchMedia, IntersectionObserver, localStorage, Event, Element, requestAnimationFrame, cancelAnimationFrame */
// Section-local ambient paths. Content, controls and account state stay untouched.
(() => {
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  const key = 'dima-ambient-paused-v1';
  let paused = false;
  try { paused = localStorage.getItem(key) === 'true'; } catch { /* Session-only when storage is unavailable. */ }
  let pageActive = true, frame = 0, hovered = null;
  const states = [];
  const routes = [
    'M-45 610H86Q120 610 120 576V510Q120 476 154 476H227Q261 476 261 442V380Q261 346 295 346H352Q386 346 386 312V251Q386 217 420 217H475Q509 217 509 183V-25',
    'M1245 90H1114Q1080 90 1080 124V191Q1080 225 1046 225H973Q939 225 939 259V321Q939 355 905 355H848Q814 355 814 389V450Q814 484 780 484H725Q691 484 691 518V725',
  ];
  const allowed = () => pageActive && !paused && !reduced.matches && !document.hidden;
  function element(tag, attributes) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attributes).forEach(([name, value]) => node.setAttribute(name, String(value)));
    return node;
  }
  document.querySelectorAll('main > section').forEach((section, index) => {
    if (section.querySelector(':scope > .dima-ambient-layer')) return;
    section.classList.add('dima-ambient-host');
    const layer = document.createElement('div');
    layer.className = 'dima-ambient-layer'; layer.setAttribute('aria-hidden', 'true');
    const field = document.createElement('div'); field.className = 'dima-ambient-field';
    const svg = element('svg', { viewBox: '0 0 1200 700', preserveAspectRatio: 'none', focusable: 'false' });
    const animations = [];
    routes.forEach((route, routeIndex) => {
      const group = element('g', { class: `dima-ambient-route is-${routeIndex ? 'orange' : 'blue'}` });
      const base = element('path', { d: route, class: 'dima-ambient-line', 'vector-effect': 'non-scaling-stroke' });
      const traveler = element('path', { d: route, pathLength: '1', class: 'dima-ambient-traveler', 'vector-effect': 'non-scaling-stroke' });
      group.append(base, traveler); svg.append(group);
      if (typeof traveler.animate === 'function') {
        const travel = traveler.animate([{ strokeDashoffset: 0 }, { strokeDashoffset: -1 }], { duration: 34000 + routeIndex * 11000 + index * 1700, iterations: Infinity, easing: 'linear' });
        travel.pause(); travel.currentTime = (index * 5300 + routeIndex * 17000) % 34000;
        const drift = group.animate([{ transform: 'translate(0px, 0px)' }, { transform: `translate(${routeIndex ? -3 : 3}px, 3px)` }, { transform: 'translate(0px, 0px)' }], { duration: 19000 + index * 900, iterations: Infinity, easing: 'ease-in-out' });
        drift.pause(); animations.push(travel, drift);
      }
    });
    field.append(svg); layer.append(field); section.prepend(layer);
    states.push({ section, layer, field, animations, visible: false, x: 0, y: 0, targetX: 0, targetY: 0 });
  });
  function resetPointer() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0; hovered = null;
    states.forEach(state => { state.x = state.y = state.targetX = state.targetY = 0; state.field.style.transform = ''; });
  }
  function sync() {
    root.dataset.ambientPaused = String(paused);
    document.querySelectorAll('[data-ambient-toggle]').forEach(button => {
      button.hidden = false;
      button.textContent = paused ? 'Resume background motion' : 'Pause background motion';
      button.setAttribute('aria-pressed', String(paused));
    });
    states.forEach(state => {
      const running = allowed() && state.visible;
      state.layer.dataset.ambientActive = String(running);
      state.animations.forEach(animation => { if (running) animation.play(); else animation.pause(); });
    });
    if (!allowed() || !finePointer.matches) resetPointer();
  }
  function tick() {
    frame = 0;
    if (!allowed() || !finePointer.matches) { resetPointer(); return; }
    let moving = false;
    states.forEach(state => {
      if (!state.visible) state.targetX = state.targetY = 0;
      state.x += (state.targetX - state.x) * .13; state.y += (state.targetY - state.y) * .13;
      const settled = Math.abs(state.targetX - state.x) + Math.abs(state.targetY - state.y) < .035;
      if (settled) { state.x = state.targetX; state.y = state.targetY; } else moving = true;
      state.field.style.transform = state.x || state.y ? `translate(${state.x.toFixed(2)}px,${state.y.toFixed(2)}px)` : '';
    });
    if (moving) frame = requestAnimationFrame(tick);
  }
  function queuePointer() { if (!frame && allowed() && finePointer.matches) frame = requestAnimationFrame(tick); }
  function leave() { if (hovered) { hovered.targetX = hovered.targetY = 0; hovered = null; queuePointer(); } }
  document.addEventListener('pointermove', event => {
    if (!allowed() || !finePointer.matches || event.pointerType === 'touch') return;
    const section = event.target instanceof Element ? event.target.closest('main > section') : null;
    const next = states.find(state => state.section === section && state.visible) ?? null;
    if (hovered !== next) leave(); hovered = next;
    if (!next) return;
    const rect = next.section.getBoundingClientRect();
    const clamp = value => Math.max(-1, Math.min(1, value));
    next.targetX = clamp((event.clientX - rect.left) / rect.width * 2 - 1) * 6;
    next.targetY = clamp((event.clientY - rect.top) / rect.height * 2 - 1) * 6;
    queuePointer();
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', leave); window.addEventListener('blur', leave);
  document.addEventListener('click', event => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-ambient-toggle]')) return;
    paused = !paused;
    try { localStorage.setItem(key, String(paused)); } catch { /* The active page still honors the choice. */ }
    sync(); window.dispatchEvent(new Event('dima-ambient-change'));
  });
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    try { paused = localStorage.getItem(key) === 'true'; } catch { return; }
    sync(); window.dispatchEvent(new Event('dima-ambient-change'));
  });
  document.addEventListener('visibilitychange', sync); reduced.addEventListener('change', sync); finePointer.addEventListener('change', sync);
  window.addEventListener('pagehide', () => { pageActive = false; sync(); });
  window.addEventListener('pageshow', () => { pageActive = true; sync(); });
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => { const state = states.find(item => item.section === entry.target); if (state) state.visible = entry.isIntersecting; }); sync();
    }, { threshold: 0 });
    states.forEach(state => observer.observe(state.section));
  }
  sync();
})();
