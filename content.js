(() => {
  // Plex uses hash routes, including URL-encoded metadata keys.
  function contextFrom(value) {
    try {
      const hash = new URL(value, location.href).hash.slice(1);
      const params = new URLSearchParams(hash.split('?')[1] || '');
      const server = hash.match(/\/(?:server|media)\/([^/?]+)/)?.[1];
      const ratingKey = (params.get('key') || '').match(/^\/library\/metadata\/(\d+)\/?$/)?.[1];
      return server && ratingKey ? {server, ratingKey} : null;
    } catch { return null; }
  }
  let selected = null;
  let selectedAt = 0;
  let route = location.href;
  const menuSelector = '[role="menu"], [class*="Menu-menu-"]';

  // Capture the card that opened a portalled menu before Plex moves focus.
  document.addEventListener('click', event => {
    if (!(event.target instanceof Element) || event.target.closest(menuSelector)) return;
    selected = null;
    selectedAt = Date.now();
    for (let node = event.target; node && node !== document.body; node = node.parentElement) {
      const links = [...node.querySelectorAll('a[href]')].map(link => contextFrom(link.href)).filter(Boolean);
      if (node.matches('a[href]')) links.unshift(contextFrom(node.href));
      const unique = new Map(links.filter(Boolean).map(item => [`${item.server}:${item.ratingKey}`, item]));
      if (unique.size === 1) { selected = [...unique.values()][0]; break; }
      if (unique.size > 1) break;
    }
    selected ||= contextFrom(location.href);
  }, true);

  function toast(message, error = false) {
    document.getElementById('purify-toast')?.remove();
    const node = document.createElement('div');
    node.id = 'purify-toast';
    node.setAttribute('role', error ? 'alert' : 'status');
    node.textContent = message;
    document.body.append(node);
    setTimeout(() => node.remove(), error ? 12000 : 6000);
  }
  function isMovieActionMenu(menu) {
    const labels = [...menu.querySelectorAll('button, a, [role="menuitem"], [class*="MenuItem-"]')]
      .filter(item => !item.classList.contains('purify-menu-item') && item.closest(menuSelector) === menu)
      .map(item => item.textContent || '');
    return PurifyMenuPolicy.isMovieActionMenu(labels);
  }

  function update() {
    scanPosters();
    if (route !== location.href) {
      route = location.href;
      selected = null;
      document.querySelectorAll('.purify-menu-item').forEach(node => node.remove());
    }
    for (const menu of document.querySelectorAll(menuSelector)) {
      if (!menu.getClientRects().length) continue;
      if (!isMovieActionMenu(menu)) {
        menu.querySelectorAll('.purify-menu-item').forEach(item => item.remove());
        continue;
      }
      if (menu.querySelector('.purify-menu-item')) continue;
      const context = (Date.now() - selectedAt < 2000 ? selected : null) || contextFrom(location.href);
      if (!context) continue;
      for (const [type, label] of [['purify', 'Purify']]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'purify-menu-item';
        button.setAttribute('role', 'menuitem');
        button.textContent = label;
        button.addEventListener('click', async event => {
          event.preventDefault();
          event.stopPropagation();
          if (button.disabled) return;
          button.disabled = true;
          button.textContent = 'Sending…';
          try {
            const result = await chrome.runtime.sendMessage({type, context});
            toast(result?.message || `${label} could not submit this movie.`, !result?.ok);
            if (result?.ok && result.sent) {
              states.set(identity(context), {...result, eligible: true});
              refreshButtons(identity(context));
            }
          } catch { toast('Purify was reloaded. Refresh this Plex tab and try again.', true); }
          finally { button.disabled = false; button.textContent = label; }
        });
        menu.append(button);
      }
    }
  }
  // Only decorate image links with an unambiguous Plex metadata identity.
  // Plex also uses these routes for episodes: verify media type before showing a button.
  const states = new Map();
  let inspecting = 0;
  const inspectQueue = [];
  const identity = context => `${context.server}:${context.ratingKey}`;
  function paint(button, state) {
    const status = state.status || (state.sent ? 'sent' : 'unknown');
    const labels = {
      unknown: 'Send to Purifier (no matched job in the saved status)',
      sent: 'Sent to Purifier — awaiting status refresh',
      queued: 'Queued in Purifier', processing: 'Processing in Purifier',
      completed: 'Purifier processing completed',
      failed: 'Purifier failed — click to retry',
      versions: `${state.completedCount} of ${state.versionCount} versions completed — separate the files in Plex to submit one`,
      blocked: 'Purifier submission unavailable'
    };
    let label = state.sending ? 'Sending to Purifier…' : labels[status] || labels.unknown;
    if (state.versionSummary) label += `: ${state.versionSummary}`;
    if (state.error && ['failed', 'blocked'].includes(status)) label += `: ${state.error}`;
    if (state.stale) label += ' (status refresh unavailable; showing last known status)';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.classList.toggle('purify-sent', status === 'completed');
    button.classList.toggle('purify-queued', status === 'queued' || status === 'sent' || status === 'versions');
    button.classList.toggle('purify-processing', status === 'processing');
    button.classList.toggle('purify-failed', status === 'failed');
    button.disabled = !!state.sent || !!state.sending || !!state.loading || !!state.blocked;
    const symbol = state.sending ? '…' : status === 'versions' ? `${state.completedCount}/${state.versionCount}` : status === 'blocked' ? '?' : {completed: '✓', sent: '↥', queued: '↥', processing: '◌', failed: '!'}[status] || 'P';
    if (button.textContent !== symbol) button.textContent = symbol;
  }
  function refreshButtons(key) {
    for (const button of document.querySelectorAll('.purify-poster-button')) {
      if (button.dataset.purifyKey === key) paint(button, states.get(key));
    }
  }
  async function sendPoster(context) {
    const key = identity(context);
    const state = states.get(key);
    if (!state || state.sent || state.sending || state.blocked) return;
    state.sending = true;
    refreshButtons(key);
    try {
      const result = await chrome.runtime.sendMessage({type: 'purify', context});
      if (result?.ok && result.sent) Object.assign(state, result);
      toast(result?.message || 'Could not send this movie to Purifier.', !result?.ok);
    } catch { toast('Purify was reloaded. Refresh this Plex tab and try again.', true); }
    finally { state.sending = false; refreshButtons(key); }
  }
  function drainInspections() {
    while (inspecting < 4 && inspectQueue.length) {
      const context = inspectQueue.shift();
      inspecting++;
      const expected = states.get(identity(context));
      chrome.runtime.sendMessage({type: 'purify-status', context}).then(result => {
        if (states.get(identity(context)) !== expected || expected.sending) return;
        if (result?.ok) states.set(identity(context), {...result, eligible: !!result.eligible});
        else states.set(identity(context), {...expected, loading: false, stale: true});
      }).catch(() => {
        if (states.get(identity(context)) === expected) states.set(identity(context), {...expected, loading: false, stale: true});
      }).finally(() => {
        inspecting--;
        scanPosters();
        drainInspections();
      });
    }
  }
  function posterTargets() {
    const targets = new Map();
    // Current Plex renders artwork and an empty, absolutely positioned link
    // as siblings inside this artwork-sized card, not an image inside a link.
    for (const host of document.querySelectorAll('[class*="PosterCard-card-"]')) {
      const contexts = new Map([...host.querySelectorAll('a[href]')]
        .map(link => contextFrom(link.href)).filter(Boolean)
        .map(context => [identity(context), context]));
      if (contexts.size === 1) targets.set(host, [...contexts.values()][0]);
    }
    // Older Plex versions wrap the image with the link. Use a sibling button
    // in its parent rather than nesting an interactive button inside an anchor.
    for (const link of document.querySelectorAll('a[href]')) {
      if (link.closest('[class*="PosterCard-card-"]')) continue;
      const context = contextFrom(link.href);
      const host = link.parentElement;
      if (!context || !host || !link.querySelector('img, [class*="PosterCard-image"], [class*="PosterCard-art"]')) continue;
      const contexts = new Set([...host.querySelectorAll('a[href]')]
        .map(item => contextFrom(item.href)).filter(Boolean).map(identity));
      if (contexts.size === 1) targets.set(host, context);
    }
    return targets;
  }
  function scanPosters() {
    const targets = posterTargets();
    // Plex virtualizes/recycles cards: never keep an old movie's control.
    for (const button of document.querySelectorAll('.purify-poster-button')) {
      const context = targets.get(button.parentElement);
      if (!context || identity(context) !== button.dataset.purifyKey) button.remove();
    }
    for (const [host, context] of targets) {
      if (!host.getClientRects().length) continue;
      const key = identity(context);
      if (!states.has(key)) {
        states.set(key, {loading: true});
        inspectQueue.push(context);
      }
      const state = states.get(key);
      if (!state.eligible) {
        const existing = host.querySelector('.purify-poster-button');
        if (existing && state.loading) existing.disabled = true;
        else existing?.remove();
        continue;
      }
      // The host spans only artwork, keeping the button above Plex's link overlay.
      const existing = host.querySelector('.purify-poster-button');
      if (existing) { paint(existing, state); continue; }
      host.classList.add('purify-poster-host');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'purify-poster-button';
      button.dataset.purifyKey = key;
      paint(button, state);
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        sendPoster(context);
      });
      host.append(button);
    }
    drainInspections();
  }
  // The service worker owns one durable refresh schedule/cache across all tabs.
  // Repainting posters reads that cache; it does not start per-tab API polling.
  function refreshStatus() {
    for (const [key, state] of states) {
      if (!state.sending) states.delete(key);
    }
    scanPosters();
  }
  chrome.runtime.onMessage.addListener(message => {
    if (['purify-status-updated', 'purify-refresh-settings'].includes(message?.type)) refreshStatus();
  });
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; update(); });
  }).observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'src']});
  window.addEventListener('hashchange', update);
  window.addEventListener('scroll', () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; scanPosters(); });
  }, true);
  update();
})();
