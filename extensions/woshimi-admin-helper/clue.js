(() => {
  'use strict';

  if (!/\/modules\/drama\/clue\/?$/.test(window.location.pathname)) return;

  let applied = false;
  let retryTimer = null;
  let retryCount = 0;

  function readNumber(value) {
    const match = String(value || '').replace(/,/g, '').match(/\d+/);
    return match ? Number(match[0]) : 0;
  }

  function scheduleRetry() {
    if (applied || retryTimer || retryCount >= 40) return;
    retryCount += 1;
    retryTimer = window.setTimeout(() => {
      retryTimer = null;
      applyBestPageSize();
    }, 100);
  }

  function applyBestPageSize() {
    if (applied) return;
    const pagination = document.querySelector('.fixed-table-pagination');
    const button = pagination?.querySelector('.page-list button, .page-list .dropdown-toggle');
    if (!pagination || !button) {
      scheduleRetry();
      return;
    }

    const options = Array.from(pagination.querySelectorAll('.page-list a, .dropdown-menu a'))
      .map(anchor => ({ anchor, size: readNumber(anchor.textContent) }))
      .filter(option => option.size > 0)
      .sort((left, right) => left.size - right.size);
    if (!options.length) {
      button.click();
      scheduleRetry();
      return;
    }

    const info = pagination.querySelector('.pagination-info')?.textContent || pagination.textContent;
    const totalMatch = String(info || '').replace(/,/g, '').match(/(?:总共|共)\s*(\d+)\s*条/);
    const total = totalMatch ? Number(totalMatch[1]) : 0;
    const current = readNumber(button.textContent);
    const target = (total > 0 ? options.find(option => option.size >= total) : null) || options[options.length - 1];
    if (target.size === current) {
      applied = true;
      return;
    }

    button.click();
    window.setTimeout(() => {
      const liveTarget = Array.from(pagination.querySelectorAll('.page-list a, .dropdown-menu a'))
        .find(anchor => readNumber(anchor.textContent) === target.size);
      if (!liveTarget) {
        scheduleRetry();
        return;
      }
      applied = true;
      liveTarget.click();
    }, 80);
  }

  const observer = new MutationObserver(applyBestPageSize);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  applyBestPageSize();
})();
