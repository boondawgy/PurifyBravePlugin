import {baseUrl} from './core.js';

const states = new Set(['queued', 'processing', 'completed', 'failed']);
export const refreshAlarm = 'purify-status-refresh';
export const snapshotKey = settings => 'purifierStatus:' + baseUrl(settings.purifierUrl);
export function refreshInterval(settings) {
  const hours = Number(settings.statusRefreshHours);
  return (Number.isInteger(hours) && hours >= 1 && hours <= 8760 ? hours : 24) * 3600000;
}

// Store only display/matching fields. Read the entire bounded traversal before
// publishing anything; a failed page must not erase a previous good snapshot.
export async function fetchSnapshot(settings, request) {
  const jobs = new Map();
  const cursors = new Set();
  let cursor = null;
  do {
    const url = new URL('/media/status', baseUrl(settings.purifierUrl));
    url.searchParams.set('media_type', 'video');
    url.searchParams.set('limit', '100');
    if (cursor !== null) url.searchParams.set('cursor', cursor);
    const page = await request(url.href, {method: 'GET', headers: {Accept: 'application/json'}}, 'Purifier status');
    if (page?.api_version !== 1 || !Array.isArray(page.items) ||
        !(page.next_cursor === null || (typeof page.next_cursor === 'string' && page.next_cursor.length))) {
      throw new Error('Purifier status: unsupported or invalid v1 response.');
    }
    for (const item of page.items) {
      if (!Number.isSafeInteger(item.job_id) || item.job_id < 1 || item.media_type !== 'video' ||
          typeof item.file_path !== 'string' || !item.file_path.startsWith('/') ||
          typeof item.submitted_file_path !== 'string' || !states.has(item.status) ||
          typeof item.authoritative !== 'boolean' || !Number.isSafeInteger(item.authoritative_job_id) ||
          item.authoritative_job_id < item.job_id ||
          item.authoritative !== (item.authoritative_job_id === item.job_id)) {
        throw new Error('Purifier status: invalid job record.');
      }
      if (jobs.has(item.job_id)) throw new Error('Purifier status: repeated job in pagination.');
      jobs.set(item.job_id, {
        jobId: item.job_id, path: item.file_path, submittedPath: item.submitted_file_path,
        status: item.status, authoritativeJobId: item.authoritative_job_id,
        error: typeof item.error?.message === 'string' ? item.error.message.slice(0, 300) : null
      });
    }
    cursor = page.next_cursor;
    if (cursor !== null) {
      if (cursors.has(cursor) || cursors.size >= 10000) throw new Error('Purifier status: invalid pagination loop.');
      cursors.add(cursor);
    }
  } while (cursor !== null);
  return [...jobs.values()];
}

// Alias resolution remains exact and case-sensitive. An old submission path is
// useful when Purifier remapped it; conflicting canonical destinations are unknown.
export function matchStatus(snapshot, path, local, settings = {}) {
  // A user-configured namespace alias lets historical processing inputs match
  // files published to Plex. This never changes POST payloads or matches titles.
  const source = (settings.statusSourcePrefix || '').replace(/\/+$/, '');
  const target = (settings.statusTargetPrefix || '').replace(/\/+$/, '');
  const normalize = value => source && (value === source || value.startsWith(source + '/'))
    ? target + value.slice(source.length) : value;
  path = normalize(path);
  const jobs = snapshot?.jobs || [];
  const submittedPath = local?.submittedPath && normalize(local.submittedPath);
  const canonical = new Set(jobs.filter(job => normalize(job.path) === path || normalize(job.submittedPath) === path ||
    (submittedPath && (normalize(job.path) === submittedPath || normalize(job.submittedPath) === submittedPath)))
    .map(job => normalize(job.path)));
  let job;
  if (canonical.size === 1) {
    const candidates = jobs.filter(item => normalize(item.path) === [...canonical][0]);
    const authority = Math.max(...candidates.map(item => item.authoritativeJobId));
    job = candidates.find(item => item.jobId === authority);
  }
  // A POST accepted after this traversal is newer evidence. Keep it pending until
  // a subsequent traversal includes that job (or a newer authoritative one).
  if (local && (!job || (local.jobId ? job.jobId < local.jobId : snapshot.fetchedAt < local.sentAt))) {
    return {status: 'sent', sent: true, jobId: local.jobId || null, error: null};
  }
  if (!job) return {status: 'unknown', sent: false, error: null};
  return {status: job.status, sent: job.status !== 'failed', jobId: job.jobId, error: job.error};
}

export function createStatusSync({request, storage, now = Date.now, changed = async () => {}}) {
  const inFlight = new Map();
  async function read(settings) { return (await storage.get(snapshotKey(settings)))[snapshotKey(settings)] || null; }
  async function ensure(settings, force = false) {
    const key = snapshotKey(settings);
    if (inFlight.has(key)) return inFlight.get(key);
    // Claim the shared flight before the first await, including the storage read.
    const flight = (async () => {
      const previous = await read(settings);
      if (!force && (!settings.statusAutoRefresh ||
          (!previous?.error && previous?.fetchedAt && now() < previous.fetchedAt + refreshInterval(settings)) ||
          (previous?.retryAt && now() < previous.retryAt))) return previous;
      try {
        const startedAt = now();
        const jobs = await fetchSnapshot(settings, request);
        const snapshot = {jobs, fetchedAt: startedAt, failures: 0, retryAt: null, error: null};
        await storage.set({[key]: snapshot});
        await changed().catch(() => {});
        return snapshot;
      } catch (error) {
        const failures = (previous?.failures || 0) + 1;
        const snapshot = {...previous, failures, retryAt: now() + Math.min(3600000, 60000 * 2 ** Math.min(failures - 1, 6)), error: error.message};
        await storage.set({[key]: snapshot});
        await changed().catch(() => {});
        return snapshot;
      }
    })();
    inFlight.set(key, flight);
    try { return await flight; } finally { inFlight.delete(key); }
  }
  return {read, ensure};
}
