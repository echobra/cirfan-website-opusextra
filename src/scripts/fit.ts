// src/scripts/fit.ts
// Questionnaire enhancements: progress counter and a single submit.
const form = document.querySelector<HTMLFormElement>('[data-fit-form]');

if (form) {
  const groups = Array.from(form.querySelectorAll<HTMLFieldSetElement>('[data-question]'));
  const count = document.querySelector<HTMLElement>('[data-progress-count]');
  const fill = document.querySelector<HTMLElement>('[data-progress-fill]');
  const submit = form.querySelector<HTMLButtonElement>('[data-submit]');
  const submitLabel = submit?.textContent ?? '';

  const update = () => {
    const answered = groups.filter((g) => g.querySelector('input:checked')).length;
    if (count) count.textContent = String(answered);
    if (fill) fill.style.transform = `scaleX(${groups.length ? answered / groups.length : 0})`;
  };

  form.addEventListener('change', update);
  update();

  form.addEventListener('submit', (event) => {
    if (submit?.getAttribute('aria-disabled') === 'true') {
      event.preventDefault();
      return;
    }
    submit?.setAttribute('aria-disabled', 'true');
    if (submit) submit.textContent = 'Sending';
  });

  // Coming back with the browser's back button restores the page from cache: re-enable the button.
  window.addEventListener('pageshow', () => {
    submit?.removeAttribute('aria-disabled');
    if (submit) submit.textContent = submitLabel;
    update();
  });
}
