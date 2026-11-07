/* Dima Preview Switcher — independent vanilla implementation.
 * Interaction inspiration: Preview Switch Hero by ruixen.ui
 * https://21st.dev/@ruixen.ui/components/preview-switch-hero
 * No source JSX, imagery or demo copy reproduced. Uses shared Dima tokens.
 * <dima-preview-switcher app-href="index.html#setup"></dima-preview-switcher>
 * API: element.selectTab('learn'|'plan'|'recover'); preview-change event.
 * Demo task / recovery state is local to this instance, never an account claim.
 */
(() => {
  let sequence = 0;
  const arrow = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  class DimaPreviewSwitcher extends HTMLElement {
    connectedCallback() {
      if (this._ready) return;
      this._ready = true;
      const uid = `dima-preview-${++sequence}`;
      this.innerHTML = `
        <div class="dp-shell">
          <div class="dp-top"><span class="dp-brand">Your daily rhythm</span><span class="dp-demo">Interactive sample</span></div>
          <div class="dp-tabs" role="tablist" aria-label="Explore the Dima experience">
            ${['Learn','Plan','Recover'].map((name, i) => `<button type="button" role="tab" id="${uid}-tab-${name.toLowerCase()}" aria-controls="${uid}-${name.toLowerCase()}" aria-selected="${!i}" tabindex="${i ? '-1' : '0'}" data-tab="${name.toLowerCase()}">${name}</button>`).join('')}
          </div>
          <section class="dp-panel" role="tabpanel" tabindex="0" id="${uid}-learn" aria-labelledby="${uid}-tab-learn" data-panel="learn">
            <div class="dp-panel-title"><div><span class="dp-small">A sample day</span><h3>One useful step.</h3></div><span class="dp-day">Today</span></div>
            <label class="dp-task"><input type="checkbox" data-task="0"><span class="dp-check" aria-hidden="true"></span><span><strong>Explore the project life cycle</strong><small>Google Project Management</small></span><span class="dp-duration">25 min</span></label>
            <label class="dp-task"><input type="checkbox" data-task="1"><span class="dp-check" aria-hidden="true"></span><span><strong>Think computationally</strong><small>CS50 Business</small></span><span class="dp-duration">30 min</span></label>
            <div class="dp-completion"><span data-progress-label>0 of 2 sample tasks complete</span><span class="dp-progress-track"><span data-progress-bar></span></span></div>
            <p class="dp-footnote">Try ticking a task. This sample resets when you reload.</p>
          </section>
          <section class="dp-panel" role="tabpanel" tabindex="0" id="${uid}-plan" aria-labelledby="${uid}-tab-plan" data-panel="plan" hidden>
            <div class="dp-panel-title"><div><span class="dp-small">Room for real life</span><h3>A rhythm you choose.</h3></div><span class="dp-day">Plan</span></div>
            <p class="dp-body">Try a weekly rhythm. Your actual plan will use your course outline and available days.</p>
            <fieldset class="dp-days"><legend>Sample study days</legend>${['M','T','W','T','F','S','S'].map((day, i) => `<label><input type="checkbox" aria-label="${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][i]}" ${[0,2,4].includes(i) ? 'checked' : ''}><span>${day}</span></label>`).join('')}</fieldset>
            <div class="dp-plan-result" aria-live="polite"><strong data-days-count>3 days</strong><span>set aside to keep learning moving.</span></div>
            <p class="dp-footnote">Choose the days that fit. You can change your rhythm later.</p>
          </section>
          <section class="dp-panel" role="tabpanel" tabindex="0" id="${uid}-recover" aria-labelledby="${uid}-tab-recover" data-panel="recover" hidden>
            <div class="dp-panel-title"><div><span class="dp-small">A pause is part of the path</span><h3>Pick up from here.</h3></div><span class="dp-day dp-day-orange">Recover</span></div>
            <p class="dp-body">In this example, two tasks need a new place. Completed work stays complete.</p>
            <fieldset class="dp-options"><legend class="dp-sr-only">Choose a sample recovery option</legend><label><input type="radio" name="${uid}-recovery" value="later" checked><span><strong>Give yourself another day</strong><small>Same daily load. A little more room.</small></span></label><label><input type="radio" name="${uid}-recovery" value="more"><span><strong>Add one task to the next two days</strong><small>Keep the target. A fuller schedule.</small></span></label></fieldset>
            <button class="dp-action" type="button" data-apply>Preview this change ${arrow}</button>
            <p class="dp-footnote dp-recovery-status" role="status" data-recovery-status>No changes applied. This is a sample plan.</p>
          </section>
          <div class="dp-bottom"><span>Make it your own.</span><a data-app-link>Build a plan ${arrow}</a></div>
        </div>`;
      const href = this.getAttribute('app-href') || 'index.html#setup';
      this.querySelector('[data-app-link]').setAttribute('href', href);
      this._abort = new AbortController();
      const opts = { signal: this._abort.signal };
      this.addEventListener('click', e => {
        const tab = e.target.closest('[data-tab]');
        if (tab) this.selectTab(tab.dataset.tab);
        if (e.target.closest('[data-apply]')) {
          const choice = this.querySelector('.dp-options input:checked').value;
          this.querySelector('[data-recovery-status]').textContent = choice === 'later' ? 'Sample updated: target moved by one day. Your completed work stays.' : 'Sample updated: one task added to each of the next two days. Your completed work stays.';
          this.querySelector('[data-apply]').textContent = 'Preview updated';
        }
      }, opts);
      this.addEventListener('keydown', e => {
        if (!e.target.matches('[role="tab"]')) return;
        const tabs = [...this.querySelectorAll('[role="tab"]')];
        let next = tabs.indexOf(e.target);
        if (e.key === 'ArrowRight') next = (next + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') next = (next + tabs.length - 1) % tabs.length;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = tabs.length - 1;
        else return;
        e.preventDefault();
        this.selectTab(tabs[next].dataset.tab);
        tabs[next].focus();
      }, opts);
      this.addEventListener('change', e => {
        if (e.target.matches('[data-task]')) {
          const done = this.querySelectorAll('[data-task]:checked').length;
          this.querySelector('[data-progress-label]').textContent = `${done} of 2 sample tasks complete`;
          this.querySelector('[data-progress-bar]').style.width = `${done * 50}%`;
        }
        if (e.target.closest('.dp-days')) {
          const days = this.querySelectorAll('.dp-days input:checked').length;
          this.querySelector('[data-days-count]').textContent = `${days} ${days === 1 ? 'day' : 'days'}`;
          this.querySelector('.dp-plan-result span').textContent = days ? 'set aside to keep learning moving.' : 'selected. Choose a day when you have room.';
        }
        if (e.target.closest('.dp-options')) {
          this.querySelector('[data-apply]').innerHTML = `Preview this change ${arrow}`;
          this.querySelector('[data-recovery-status]').textContent = 'No changes applied. This is a sample plan.';
        }
      }, opts);
      this.selectTab(this.getAttribute('active') || 'learn');
    }
    selectTab(id) {
      if (!['learn','plan','recover'].includes(id)) return;
      this.querySelectorAll('[data-tab]').forEach(tab => {
        const selected = tab.dataset.tab === id;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
      });
      this.querySelectorAll('[data-panel]').forEach(panel => panel.hidden = panel.dataset.panel !== id);
      this.dataset.active = id;
      this.dispatchEvent(new CustomEvent('preview-change', { detail: { tab: id }, bubbles: true }));
    }
  }
  if (!customElements.get('dima-preview-switcher')) customElements.define('dima-preview-switcher', DimaPreviewSwitcher);
})();
