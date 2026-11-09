export const defaults = {
  purifierUrl: 'http://localhost:8787', plexToken: '', plexUrl: 'http://localhost:32400',
  sourcePrefix: '/Volumes/Media/Media', targetPrefix: '/media'
};

export function baseUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('Use an HTTP(S) server address without a path, credentials, query, or fragment.');
  }
  return url.origin;
}

export function movieContext(value) {
  try {
    const url = new URL(value, 'https://app.plex.tv');
    const hash = url.hash.slice(1);
    const query = new URLSearchParams(hash.split('?')[1] || '');
    const server = hash.match(/\/server\/([^/?]+)/)?.[1] || hash.match(/\/media\/([^/?]+)/)?.[1];
    const key = query.get('key') || '';
    const ratingKey = key.match(/^\/library\/metadata\/(\d+)\/?$/)?.[1];
    return server && ratingKey ? {server, ratingKey} : null;
  } catch { return null; }
}

export function mapPath(path, source, target) {
  source = source.replace(/\/+$/, '');
  target = target.replace(/\/+$/, '');
  if (!source) return path;
  if (path === source || path.startsWith(source + '/')) return target + path.slice(source.length);
  throw new Error('Plex file path does not match the configured source prefix. Check path mapping in Purify settings.');
}

export function moviePayload(metadata, settings) {
  if (metadata?.type !== 'movie') throw new Error('Purify currently supports movies only.');
  const media = metadata.Media || [];
  if (media.length !== 1 || media[0].Part?.length !== 1 || !media[0].Part[0].file) {
    throw new Error('This movie has multiple versions, multiple parts, or no accessible file path. Select a single-file movie for this first version.');
  }
  if (!metadata.title) throw new Error('Plex did not return a movie title.');
  return {file_path: mapPath(media[0].Part[0].file, settings.sourcePrefix, settings.targetPrefix), profile: 'Movie', title: metadata.title};
}
