/* Dima Course Explorer — independent vanilla expanding-grid implementation.
 * Interaction inspiration: Expanding Cards by vaib215
 * https://21st.dev/@vaib215/components/expanding-cards
 * No original JSX, demo copy or third-party imagery reproduced.
 * <dima-course-explorer library-href="index.html#library"></dima-course-explorer>
 * API: element.selectCourse(0|1); course-preview-change event.
 */
(() => {
  let sequence = 0;
  class DimaCourseExplorer extends HTMLElement {
    connectedCallback() {
      if (this._ready) return;
      this._ready = true;
      const uid = `dima-courses-${++sequence}`;
      this.innerHTML = `<div class="dc-grid">
        <article class="dc-course dc-pm" data-dima-course-index="0" data-active="true">
          <div class="dc-art" aria-hidden="true"><svg viewBox="0 0 500 320" fill="none"><path d="M-20 275H92Q125 275 125 242V217Q125 185 160 185H230Q260 185 260 153V123Q260 90 294 90H360Q390 90 390 58V-15" stroke="currentColor" stroke-width="52"/><path d="M-20 275H92Q125 275 125 242V217Q125 185 160 185H230Q260 185 260 153V123Q260 90 294 90H360Q390 90 390 58V-15" stroke="#fff" stroke-opacity=".3" stroke-width="1.5"/></svg></div>
          <div class="dc-content"><p class="dc-provider">Google · Coursera</p><h3><button type="button" aria-expanded="true" aria-controls="${uid}-pm" data-expand="0">Google Project<br> Management<span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M6 18 18 6M6 6h12v12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span></button></h3><p class="dc-summary">Turn a project into a plan.<br> Then bring the plan to life.</p><div class="dc-detail" id="${uid}-pm"><p>Start with a clear outline, set your pace, and track your next activity.</p></div><div class="dc-meta"><span>Reviewed outline · Manual progress</span><a data-library-link>View offering <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></a></div></div>
        </article>
        <article class="dc-course dc-cs" data-dima-course-index="1" data-active="false">
          <div class="dc-art" aria-hidden="true"><svg viewBox="0 0 500 320" fill="none"><path d="m170 65-68 85 68 85M330 65l68 85-68 85M280 40l-60 220" stroke="currentColor" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
          <div class="dc-content"><p class="dc-provider">Harvard University</p><h3><button type="button" aria-expanded="false" aria-controls="${uid}-cs" data-expand="1">CS50<br> Business<span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M6 18 18 6M6 6h12v12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span></button></h3><p class="dc-summary">Understand the technology<br> behind the decisions.</p><div class="dc-detail" id="${uid}-cs" hidden><p>A standalone course. Make space for computational thinking alongside your other learning.</p></div><div class="dc-meta"><span>Reviewed outline · Manual progress</span><a data-library-link>View offering <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></a></div></div>
        </article>
      </div>`;
      this.querySelectorAll('[data-library-link]').forEach((a, index) => a.setAttribute('href', ['/library/google-project-management', '/library/cs50-business'][index]));
      this.addEventListener('click', e => {
        const button = e.target.closest('[data-expand]');
        if (button) this.selectCourse(Number(button.dataset.expand));
      });
      this.addEventListener('focusin', e => {
        const course = e.target.closest('[data-dima-course-index]');
        if (course) this.selectCourse(Number(course.dataset.dimaCourseIndex));
      });
      this.selectCourse(Number(this.getAttribute('active') || 0));
    }
    selectCourse(index) {
      if (![0,1].includes(index)) return;
      this.dataset.active = String(index);
      this.querySelectorAll('[data-dima-course-index]').forEach((course, i) => {
        course.dataset.active = String(i === index);
        course.querySelector('[data-expand]').setAttribute('aria-expanded', String(i === index));
        course.querySelector('.dc-detail').hidden = i !== index;
      });
      this.dispatchEvent(new CustomEvent('course-preview-change', { detail: { index }, bubbles: true }));
    }
  }
  if (!customElements.get('dima-course-explorer')) customElements.define('dima-course-explorer', DimaCourseExplorer);
})();
