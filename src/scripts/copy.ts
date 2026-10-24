// src/scripts/copy.ts
// "Copy email" buttons: <button data-copy="text">. Announces the result to screen readers.
export function initCopy() {
  document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((button) => {
    const label = button.querySelector<HTMLElement>('[data-copy-label]') ?? button;
    const original = label.textContent ?? '';
    const status = document.getElementById(button.getAttribute('aria-describedby') ?? '') as HTMLElement | null;
    let timer: number | undefined;

    button.addEventListener('click', async () => {
      const text = button.dataset.copy ?? '';
      let ok = false;
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch {
        ok = false;
      }
      label.textContent = ok ? 'Copied' : 'Copy failed. Select the address instead.';
      if (status) status.textContent = ok ? `${text} copied to clipboard` : 'Copy failed';
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        label.textContent = original;
        if (status) status.textContent = '';
      }, 2200);
    });
  });
}
