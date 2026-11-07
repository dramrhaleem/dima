/* global document, window, matchMedia, IntersectionObserver, performance */
// Bounded, account-free product examples. No tracking or network dependencies.
(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const demo = document.querySelector('[data-social-demo]');
  if (!demo) return;
  const tabs = [...demo.querySelectorAll('[data-ensemble-tab]')];
  const status = demo.querySelector('[data-ensemble-status]');
  const step = demo.querySelector('[data-ensemble-step]');
  const runner = demo.querySelector('[data-you-track] .ensemble-runner');
  const burst = demo.querySelector('.ensemble-burst');
  let completion = 25;
  let burstAnimation, runnerAnimation;
  const settleProgress = () => { burstAnimation?.cancel(); runnerAnimation?.cancel(); };
  function progress(value) {
    completion = value;
    demo.querySelector('[data-you-track]').style.setProperty('--position', `${value}%`);
    demo.querySelector('[data-you-percent]').textContent = `${value}%`;
    step.disabled = value === 100;
    status.textContent = value === 25 ? 'Try a step. Watch your place move.' : value === 100 ? 'Example complete. Every small step counted.' : `${value}% complete. One small step further.`;
    settleProgress();
    if (value > 25 && !reduced.matches && !document.hidden) {
      burstAnimation = burst.animate([{opacity:0,transform:'scale(.3) rotate(0deg)'},{opacity:1,offset:.25},{opacity:0,transform:'scale(1.7) rotate(35deg)'}],{duration:650,easing:'ease-out'});
      runnerAnimation = runner.animate([{translate:'0 0'},{translate:'0 -9px',offset:.45},{translate:'0 0'}],{duration:550,easing:'cubic-bezier(.16,1,.3,1)'});
    }
  }
  step.addEventListener('click', () => progress(Math.min(100, completion + 25)));
  demo.querySelector('[data-ensemble-reset]').addEventListener('click', () => progress(25));

  let remaining = 30000, deadline = 0, timer = null;
  const timerButton = demo.querySelector('[data-ensemble-timer]');
  const timerStatus = demo.querySelector('[data-ensemble-timer-status]');
  const clock = demo.querySelector('[data-ensemble-clock]');
  const clockProgress = demo.querySelector('[data-ensemble-clock-progress]');
  function drawClock() {
    clock.textContent = `00:${String(Math.ceil(remaining / 1000)).padStart(2,'0')}`;
    clockProgress.style.transform = `scaleX(${1 - remaining / 30000})`;
  }
  function stopTimer() {
    if (timer === null) return;
    remaining = Math.max(0, deadline - performance.now());
    window.clearInterval(timer); timer = null;
    drawClock();
    timerButton.textContent = remaining ? 'Resume preview' : 'Try another round';
    demo.dataset.timerState = remaining ? 'paused' : 'complete';
  }
  function pauseTimer() {
    if (timer === null) return;
    stopTimer();
    timerStatus.textContent = remaining ? 'Preview paused. Resume when you’re ready.' : 'Preview complete. Ready for a real session?';
  }
  timerButton.addEventListener('click', () => {
    if (timer !== null) { pauseTimer(); return; }
    if (remaining <= 0) remaining = 30000;
    deadline = performance.now() + remaining;
    demo.dataset.timerState = 'running';
    timerButton.textContent = 'Pause preview';
    timerStatus.textContent = 'Preview running. One thing at a time.';
    timer = window.setInterval(() => {
      remaining = Math.max(0, deadline - performance.now()); drawClock();
      if (remaining === 0) { stopTimer(); timerStatus.textContent = 'Preview complete. Ready for a real session?'; }
    }, 250);
  });
  demo.querySelector('[data-ensemble-timer-reset]').addEventListener('click', () => {
    stopTimer(); remaining = 30000; drawClock();
    demo.dataset.timerState = 'ready';
    timerButton.textContent = 'Start 30-second preview';
    timerStatus.textContent = 'Try the timer. No room is joined.';
  });
  function selectTab(tab) {
    tabs.forEach(button => { const selected = button === tab; button.setAttribute('aria-selected',String(selected)); button.tabIndex = selected ? 0 : -1; });
    demo.querySelectorAll('[data-ensemble-panel]').forEach(panel => panel.hidden = panel.dataset.ensemblePanel !== tab.dataset.ensembleTab);
    if (tab.dataset.ensembleTab !== 'focus') pauseTimer();
  }
  tabs.forEach((tab,index) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault(); selectTab(tabs[next]); tabs[next].focus();
    });
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { pauseTimer(); settleProgress(); } });
  window.addEventListener('pagehide', () => { stopTimer(); settleProgress(); });
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) { if (entry.isIntersecting) demo.dataset.arrived = 'true'; else { pauseTimer(); settleProgress(); } }
    },{threshold:.12});
    observer.observe(demo);
  }
  reduced.addEventListener('change', () => { if (reduced.matches) demo.getAnimations({subtree:true}).forEach(animation => animation.cancel()); });

  // Tie the hero's route and feedback directly to the visitor's sample action.
  const preview = document.querySelector('dima-preview-switcher');
  const hero = document.querySelector('.hero-stage');
  const note = document.querySelector('[data-hero-win]');
  preview?.addEventListener('change', event => {
    if (!event.target.matches('[data-task]')) return;
    const done = preview.querySelectorAll('[data-task]:checked').length;
    hero.dataset.steps = String(done);
    note.textContent = done === 0 ? 'Your next step starts here.' : done === 1 ? 'One small step. A real start.' : 'Two steps forward. Keep that feeling.';
  });
})();
