'use strict';
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SignalTerminal = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const RANK_LABEL = Object.freeze({0: 'LIVE', 1: 'DEGRADED', 2: 'STALE', 3: 'DOWN'});

  function age(ms) {
    if (ms === null) return 'never';
    if (ms < 1000) return 'now';
    if (ms < 60000) return Math.round(ms / 1000) + 's';
    if (ms < 3600000) return Math.round(ms / 60000) + 'm';
    return Math.round(ms / 3600000) + 'h';
  }

  function panel(source, view) {
    const el = document.createElement('section');
    el.className = 'term-panel';
    el.dataset.rank = source.rank;
    el.innerHTML = '<header><span class="name"></span><span class="badge"></span><span class="age"></span></header>' +
      '<div class="body"><div class="count"></div><div class="note"></div><button class="recheck">recheck</button></div>';
    el.querySelector('.name').textContent = source.label;
    el.querySelector('.badge').textContent = RANK_LABEL[source.rank];
    el.querySelector('.age').textContent = age(source.ageMs);
    el.querySelector('.count').textContent = source.itemCount ? source.itemCount + ' items' : '—';
    el.querySelector('.note').textContent = source.error || (source.drift ? 'payload changed ' + age(source.fetchedAt - source.driftAt) + ' ago' : source.sourceUrl.replace(/^https:\/\//, ''));
    el.querySelector('.recheck').onclick = () => {
      Promise.resolve(window.sampleApp.recheckSource(source.id)).then(() => render(view)).catch(() => {});
    };
    return el;
  }

  async function render(view) {
    const summary = await window.sampleApp.signal();
    view.dataset.rank = summary.worstRank;
    const row = view.querySelector('.signal-row');
    row.replaceChildren(...summary.sources.map(source => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.rank = source.rank; button.textContent = source.id;
      button.onclick = () => {
        Promise.resolve(window.sampleApp.recheckSource(source.id)).then(() => render(view)).catch(() => {});
      };
      return button;
    }));
    view.querySelector('.signal-grid').replaceChildren(...summary.sources.map(source => panel(source, view)));
    view.querySelector('.signal-global').textContent = summary.status.toUpperCase();
  }

  function mount(view) {
    render(view).catch(() => {});
    const timer = setInterval(() => { if (document.visibilityState === 'visible') render(view).catch(() => {}); }, 30000);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  if (typeof document !== 'undefined' && !document.documentElement.classList.contains('render') && !new URLSearchParams(location.search).has('render')) {
    const view = document.querySelector('[data-view="terminal"]');
    if (view) mount(view);
  }

  return {mount, render, age};
});
