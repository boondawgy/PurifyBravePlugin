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
      for (const [type, label] of [['purify', 'Purify'], ['save-subtitle', 'Save subtitle as sidecar']]) {
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
          } catch { toast('Purify was reloaded. Refresh this Plex tab and try again.', true); }
          finally { button.disabled = false; button.textContent = label; }
        });
        menu.append(button);
      }
    }
  }
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; update(); });
  }).observe(document.body, {childList: true, subtree: true});
  window.addEventListener('hashchange', update);
})();
