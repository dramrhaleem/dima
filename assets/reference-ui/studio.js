'use strict';
(() => {
  const $ = selector => document.querySelector(selector);
  const theme = $('#theme-toggle');
  theme.addEventListener('click', () => { const dark = document.documentElement.dataset.theme !== 'dark'; document.documentElement.dataset.theme = dark ? 'dark' : 'light'; theme.textContent = dark ? 'Light preview' : 'Dark preview'; theme.setAttribute('aria-pressed', String(dark)); });
  const commands = [{label:'Today',description:'Your next sample learning task',href:'prototype/index.html#today'},{label:'My Plan',description:'Study rhythm and recovery',href:'prototype/index.html#plan'},{label:'Course library',description:'Explore the two seed courses',href:'prototype/index.html#library'},{label:'Activity',description:'Local learning and work sessions',href:'prototype/index.html#activity'},{label:'Landing experience',description:'See the components in context',href:'prototype/landing.html'}];
  const launch = $('#open-commands');
  launch.addEventListener('click', () => window.DimaUI?.openCommands(commands, launch));
  document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); window.DimaUI?.openCommands(commands, document.activeElement); }});
  $('#progress-value').addEventListener('input', event => { const value = Number(event.target.value); $('#sample-progress').setAttribute('value', String(value)); $('#progress-caption').textContent = `${value / 25} of 4 illustrative tasks complete.`; });
  let step = 1;
  const updateSteps = () => { $('#sample-steps').setAttribute('current', String(step)); $('#previous-step').disabled = step === 1; $('#next-step').disabled = step === 3; $('#step-status').textContent = `Step ${step} of 3`; };
  $('#previous-step').addEventListener('click', () => { step = Math.max(1,step - 1); updateSteps(); });
  $('#next-step').addEventListener('click', () => { step = Math.min(3,step + 1); updateSteps(); });
  $('#replay-reveal').addEventListener('click', () => window.DimaUI?.replay($('#reveal-copy')));
  if ('IntersectionObserver' in window) { const links = [...document.querySelectorAll('.studio-index a')]; const observer = new IntersectionObserver(entries => { for(const entry of entries) if(entry.isIntersecting) { links.forEach(link => link.removeAttribute('aria-current')); links.find(link => link.hash === `#${entry.target.id}`)?.setAttribute('aria-current','location'); } }, {rootMargin:'-10% 0px -65% 0px'}); document.querySelectorAll('.specimen').forEach(section => observer.observe(section)); }
  window.DimaUI?.init(document);
})();
