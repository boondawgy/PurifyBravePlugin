// Home-video libraries also report individual files as type=movie. Require a
// movie library with an actual movie metadata agent, rather than item type alone.
export function isMovieLibrary(section) {
  return section?.type === 'movie' && [
    'tv.plex.agents.movie', 'com.plexapp.agents.plexmovie',
    'com.plexapp.agents.imdb', 'com.plexapp.agents.themoviedb'
  ].includes(section.agent);
}

// Only read-only Plex requests race. Purifier receives exactly one POST.
export function createMovieLookup(request, cache) {
  const sectionLookups = new Map();
  async function movieLibrary(origin, sectionId, headers) {
    if (!/^\d+$/.test(String(sectionId || ''))) return false;
    // Share this read across cards; credentials isolate servers/accounts in memory.
    const key = JSON.stringify([origin, headers['X-Plex-Token']]);
    let cached = sectionLookups.get(key);
    if (!cached || cached.expires <= Date.now()) {
      const promise = request(`${origin}/library/sections`, {headers}, 'Plex library types');
      cached = {promise, expires: Date.now() + 600000};
      sectionLookups.set(key, cached);
      promise.catch(() => { if (sectionLookups.get(key) === cached) sectionLookups.delete(key); });
    }
    const result = await cached.promise;
    const section = result.MediaContainer?.Directory?.find(item => String(item.key) === String(sectionId));
    return isMovieLibrary(section);
  }
  async function metadata(origin, context, headers, signal) {
    const result = await request(`${origin}/library/metadata/${context.ratingKey}`, {headers, signal}, 'Plex movie metadata');
    const item = result.MediaContainer?.Metadata?.[0];
    if (!item) throw new Error('Plex returned no movie metadata.');
    const eligible = item.type === 'movie' && await movieLibrary(origin, item.librarySectionID || result.MediaContainer?.librarySectionID, headers);
    return {item: {...item, purifyMovieLibrary: eligible}, origin};
  }
  return async function lookup(settings, context, headers, cacheKey) {
    const cached = await cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      try {
        return (await metadata(cached.origin, context, headers, AbortSignal.timeout(2500))).item;
      } catch { await cache.delete(cacheKey); }
    }
    const controller = new AbortController();
    const signal = controller.signal;
    const candidates = [];
    if (settings.plexUrl) candidates.push((async () => {
      const origin = new URL(settings.plexUrl).origin;
      const identity = await request(`${origin}/identity`, {headers, signal}, 'Plex server identity');
      if (identity.MediaContainer?.machineIdentifier !== context.server) throw new Error('The direct Plex address belongs to another server.');
      return metadata(origin, context, headers, signal);
    })());
    candidates.push((async () => {
      const resources = await request('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1', {headers, signal}, 'Plex server discovery');
      const resource = resources.find(item => item.clientIdentifier === context.server && item.provides?.split(',').includes('server'));
      const origins = [...new Set((resource?.connections || []).map(item => new URL(item.uri))
        .filter(url => url.protocol === 'https:' && url.hostname.endsWith('.plex.direct')).map(url => url.origin))];
      if (!origins.length) throw new Error('Cannot find this Plex server. Check the direct Plex address and token in settings.');
      try { return await Promise.any(origins.map(origin => metadata(origin, context, headers, signal))); }
      catch (error) { throw error.errors?.[0] || error; }
    })());
    try {
      const winner = await Promise.any(candidates);
      await cache.set(cacheKey, {origin: winner.origin, expires: Date.now() + 10 * 60 * 1000});
      return winner.item;
    } catch (error) {
      // Prefer the account discovery error over an unavailable optional local server.
      throw error.errors?.at(-1) || error;
    } finally { controller.abort(); }
  };
}
