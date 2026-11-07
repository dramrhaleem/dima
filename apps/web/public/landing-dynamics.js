/* global document, window, matchMedia, IntersectionObserver */
// Finite journey reveal and action feedback. Ambient motion is owned separately.
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const owners = new Map();
  const allowed = () => !reduced.matches && !document.hidden;
  const cancel = owner => { owners.get(owner)?.forEach(animation => animation.cancel()); owners.delete(owner); };
  function animate(owner, element, frames, duration = 500) {
    if (!allowed() || !element?.animate) return;
    const animation = element.animate(frames, {duration, easing:'cubic-bezier(.16,1,.3,1)'});
    if (!owners.has(owner)) owners.set(owner, new Set());
    owners.get(owner).add(animation);
    animation.finished.catch(() => {}).finally(() => { owners.get(owner)?.delete(animation); });
  }
  const demo = document.querySelector('[data-recovery-path]');
  let journeySeen = false;
  function journey() {
    if (!demo) return;
    cancel(demo);
    if (document.documentElement.dataset.ambientPaused === 'true') return;
    animate(demo, demo.querySelector('[data-path-ahead]'), [
      { strokeDashoffset: 1, opacity: .4 }, { strokeDashoffset: 0, opacity: .85 }
    ], 3600);
    animate(demo, demo.querySelector('[data-path-traveller]'), [
      { strokeDashoffset: 0, opacity: 0 }, { opacity: 1, offset: .1 },
      { opacity: 1, offset: .85 }, { strokeDashoffset: -1, opacity: 0 }
    ], 4000);
  }
  const replay = demo?.querySelector('[data-path-replay]');
  if (replay) { replay.hidden = false; replay.addEventListener('click', journey); }

  const hero = document.querySelector('.hero-stage');
  const preview = hero?.querySelector('dima-preview-switcher');
  const route = hero?.querySelector('.route-base');
  let response;
  if (route) {
    response = route.cloneNode(false); response.setAttribute('class','route-response');
    response.setAttribute('pathLength','1'); route.parentNode.append(response);
  }
  function heroResponse() {
    if (!hero) return;
    cancel(hero);
    animate(hero,response,[{strokeDashoffset:1,opacity:0},{opacity:1,offset:.15},{opacity:1,offset:.75},{strokeDashoffset:-1,opacity:0}],1050);
    animate(hero,hero.querySelector('.hero-win'),[{translate:'0 6px'},{translate:'0 0'}],320);
  }
  preview?.addEventListener('change', event => {
    if (event.target.matches('[data-task]')) { if (event.target.checked) heroResponse(); }
    else if (event.target.closest('.dp-days')) {
      const days = preview.querySelectorAll('.dp-days input:checked').length;
      hero.querySelector('[data-hero-win]').textContent = days ? `${days} study ${days === 1 ? 'day' : 'days'}. A rhythm that fits.` : 'Make room for one small step.';
      heroResponse();
    }
  });
  preview?.addEventListener('preview-change', event => {
    const tab=event.detail.tab,done=preview.querySelectorAll('[data-task]:checked').length;
    hero.querySelector('[data-hero-win]').textContent = tab==='plan' ? 'Your time. Your rhythm.' : tab==='recover' ? 'A new pace. Your progress stays.' : done===0 ? 'Your next step starts here.' : done===1 ? 'One small step. A real start.' : 'Two steps forward. Keep that feeling.';
    heroResponse();
  });
  preview?.addEventListener('click',event=>{if(event.target.closest('[data-apply]')) heroResponse();});
  const stopAll=()=>{[...owners.keys()].forEach(cancel);};
  reduced.addEventListener('change',()=>{if(reduced.matches)stopAll();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopAll();});
  window.addEventListener('pagehide',stopAll);
  window.addEventListener('dima-ambient-change',()=>{if(document.documentElement.dataset.ambientPaused === 'true')cancel(demo);});
  if ('IntersectionObserver' in window) {
    const observer=new IntersectionObserver(entries=>{entries.forEach(entry=>{if(!entry.isIntersecting)cancel(entry.target);else if(entry.target === demo && !journeySeen){journeySeen=true;journey();}});},{threshold:.15});
    [demo,hero].filter(Boolean).forEach(owner=>observer.observe(owner));
  }
})();
