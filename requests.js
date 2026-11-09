export function plexHeaders(token, clientIdentifier) {
  return {
    'X-Plex-Token': token,
    'X-Plex-Client-Identifier': clientIdentifier,
    'X-Plex-Product': 'Purify for Plex',
    'X-Plex-Version': '0.1.4',
    Accept: 'application/json'
  };
}

export async function jsonRequest(url, init = {}, label = 'Server', fetcher = fetch, acceptNonJson = false) {
  let response;
  try {
    response = await fetcher(url, {...init, redirect: 'error', signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000)});
  } catch (error) {
    throw new Error(`${label}: ${error.name === 'TimeoutError' ? 'request timed out; check the queue before retrying' : 'cannot connect; check the address and granted site access'}.`);
  }
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  if (!response.ok) {
    const raw = body?.message || body?.errors?.[0]?.message || body?.errors?.[0]?.error ||
      body?.error || text.match(/<error\b[^>]*message="([^"]+)"/i)?.[1] ||
      text.match(/<message[^>]*>([^<]+)<\/message>/i)?.[1] ||
      text.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
    // Don't expose tokens if a server happens to echo them in an error.
    const token = init.headers?.['X-Plex-Token'];
    let detail = typeof raw === 'string' ? raw : '';
    if (token) detail = detail.split(token).join('[redacted]');
    detail = detail.replace(/X-Plex-Token=[^\s&"<>]+/gi, 'X-Plex-Token=[redacted]').slice(0, 300);
    throw new Error(`${label} (HTTP ${response.status})${detail ? `: ${detail}` : ': the server rejected the request.'}`);
  }
  if (!body && acceptNonJson) return {accepted: true};
  if (!body) throw new Error(`${label}: the server did not return JSON.`);
  return body;
}
