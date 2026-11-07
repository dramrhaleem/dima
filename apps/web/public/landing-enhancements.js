/* global matchMedia, document, window, IntersectionObserver */
// Dima's finite path choreography. Sample interactions never write account data.
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const active = new Set();
  const allowed = () => !reduced.matches && !document.hidden;
  const animate = (element, frames, duration = 280) => {
    if (!element || !allowed() || !element.animate) return;
    element.getAnimations().filter(animation => active.has(animation)).forEach(animation => animation.cancel());
    const animation = element.animate(frames, {duration, easing:'cubic-bezier(.16,1,.3,1)'});
    active.add(animation);
    animation.finished.catch(() => {}).finally(() => active.delete(animation));
  };
  const sync = () => {
    if (!allowed()) active.forEach(animation => animation.cancel());
  };
  document.addEventListener('visibilitychange', sync);
  reduced.addEventListener('change', sync);
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) entry.target.dataset.arrived = 'true';
      entry.target.querySelectorAll('*').forEach(child => {
        child.getAnimations().forEach(animation => {
          if (!['dima-route-arrive','dima-preview-arrive','dima-return-path','dima-clock-arrive','dima-rhythm-arrive'].includes(animation.animationName) || animation.playState === 'finished') return;
          if (!entry.isIntersecting) animation.pause();
          else if (allowed()) animation.play();
        });
      });
    });
  }, {threshold: .12}) : null;
  document.querySelectorAll('.hero-stage,.return-diagram,.room-sample').forEach(element => observer?.observe(element));
  document.querySelector('.hero')?.setAttribute('data-arrived', 'true');
  document.querySelectorAll('.room-rhythm span').forEach((element, index) => element.style.setProperty('--beat', String(index)));
  const preview = document.querySelector('dima-preview-switcher');
  const caption = document.querySelector('[data-preview-caption] span:last-child');
  const captions = {learn:'Try a task. See a small step add up.',plan:'Choose your days. Make room for real life.',recover:'A different pace. The same progress kept.'};
  preview?.addEventListener('preview-change', event => {
    const tab = event.detail.tab;
    if (caption) caption.textContent = captions[tab];
    animate(preview.querySelector(`[data-panel="${tab}"]`), [{opacity:.65,transform:'translateX(9px)'},{opacity:1,transform:'none'}]);
  });
  preview?.addEventListener('change', event => {
    if (event.target.matches('[data-task]') && event.target.checked) {
      animate(event.target.nextElementSibling, [{transform:'scale(.85)'},{transform:'scale(1.12)'},{transform:'scale(1)'}], 240);
    }
  });
})();
