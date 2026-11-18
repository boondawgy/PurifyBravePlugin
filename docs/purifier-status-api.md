# Purify for Plex: read-only status API (v1)

This is the server contract for a separately implemented browser extension integration.
A successful submission means **sent/queued**, not completed. Discover jobs from all
clients using the database, rather than extension-local history.

## Requests and authentication

`GET /media/status` returns `Content-Type: application/json`. Send `Accept:
application/json`. No request body or Content-Type header is required for this GET.
The existing listener has **no built-in inbound authentication** or API key header.
Reuse the same reverse proxy authentication/cookies/Authorization header as your
existing `POST /media` deployment, if any. There is no new Purifier bearer token.
Never send a Plex token to this API. ABS_API_TOKEN is an outbound server credential,
not an API credential for extensions. Do not expose an unauthenticated listener to
untrusted clients.

An extension should use its background/service worker with host permissions for
the Purifier origin; allow the proxy origin too if applicable. The listener does
not implement CORS/OPTIONS for arbitrary webpage fetches. Browser cookie policy
and proxy login flows depend on the deployment. Proxy authentication failures
(e.g. 401/403) may have proxy-defined bodies, not the envelope below.

Existing submission stays unchanged:

```http
POST /media
Content-Type: application/json

{"file_path":"/plex/Movies/Arrival.mkv","profile":"Movie","title":"Arrival"}
```

With an existing Movie profile, successful enqueue returns HTTP 202 and
`{"queued":true,"job_id":123}` (other existing fields may also be present).
Existing request_id deduplication and `queued:false` responses are unchanged.
No new required POST fields or status-side mutations have been added.

## Query parameters and bounded batch lookup

- `media_type`: defaults to `video`; also supports music, podcast, audiobook,
  ebook. Movies and television both use `video`; profile/title are descriptive,
  not identity filters. Jobs without a named profile are included.
- `limit`: integer 1–100, default 50.
- `cursor`: opaque `next_cursor` from the previous response. Keep the same
  media_type and file_path filters. You may change limit. Start without a cursor
  for every new polling cycle.
- `file_path`: repeat for batch lookup, at most 100 nonempty submitted paths,
  each at most 4096 characters. Omit to discover all jobs of that media type.
  Paths go through that media type's current server path map and canonicalization.
  No filesystem existence check is required. Matching is exact and case-sensitive.

Examples (percent-encode query values with URLSearchParams or equivalent):

```http
GET /media/status?media_type=video&limit=50
Accept: application/json

GET /media/status?media_type=video&file_path=%2Fplex%2FMovies%2FArrival.mkv&file_path=%2Fplex%2FMovies%2FAlien.mkv&limit=100
Accept: application/json

GET /media/status?limit=50&cursor=OPAQUE_NEXT_CURSOR
Accept: application/json
```

Batch lookup is GET with repeated query parameters, **not POST** and not a JSON
body. All matching jobs are paginated, including duplicates. Duplicate input paths
are collapsed after canonicalization. `missing_file_paths` lists canonical paths
with no job in this traversal, on every page; missing is not a processing state
and is not an error. An empty database returns HTTP 200, items `[]`, next_cursor
`null`; a batch against it also lists all requested canonical paths as missing.
Keep the complete encoded request line below 64 KiB (or a smaller proxy limit);
split long path batches accordingly. Request-line rejection may be HTTP 414 from
the HTTP server/proxy, outside this JSON contract.

## Responses and state definitions

Example HTTP 200:

```json
{
  "api_version": 1,
  "items": [
    {
      "job_id": 123,
      "file_path": "/media/Movies/Arrival.mkv",
      "submitted_file_path": "/plex/Movies/Arrival.mkv",
      "media_type": "video",
      "title": "Arrival",
      "profile": "Movie",
      "status": "queued",
      "updated_at": "2026-11-18T17:30:00Z",
      "authoritative": true,
      "authoritative_job_id": 123,
      "error": null,
      "plex": {"machineIdentifier": "server-id", "ratingKey": "42"}
    }
  ],
  "next_cursor": null,
  "missing_file_paths": []
}
```

`job_id` is the stable integer database job ID, scoped to this Purifier database.
There is no separate permanent movie ID. `profile` is null for direct-settings
jobs or older records without the submitted profile. `title` may be null.
`submitted_file_path` is always present; older records fall back to the normalized
payload path or stored canonical path. `updated_at` is the job's last recorded
update, UTC ISO 8601, not a completion timestamp or server polling timestamp.

The following are complete item state variants; all other item fields follow the
example above:

```json
[
  {"status":"queued","error":null},
  {"status":"processing","error":null},
  {"status":"completed","error":null},
  {"status":"failed","error":{"code":"processing_failed","message":"Processing failed. Check the Purifier dashboard for details."}},
  {"status":"failed","error":{"code":"canceled","message":"Processing was canceled."}}
]
```

- `queued`: accepted and waiting, including a paused queue.
- `processing`: internal `running`; worker processing has started.
- `completed`: internal `succeeded`; the configured processor returned success and
  the worker recorded success. This can mean preparation for manual review rather
  than final export, depending on processing policy. It does **not** guarantee
  every requested edit occurred, absence of warnings, human review approval,
  Plex scan/visibility, a particular destination, or that the original input was
  overwritten. Do not label it “Plex verified” or “all content removed.”
- `failed`: internal failed or canceled. Unknown future internal states also fail
  closed to this state. Cancellation has its own error code.

Error messages are fixed safe display summaries. Raw exception text, processor
logs, payloads, request headers, Plex tokens, and other credentials are excluded.
Detailed diagnostics remain in the existing dashboard; no raw diagnostic strings
are copied into this API.

Invalid limit, cursor, media_type, excessive/empty paths, unknown parameters, or
repeated scalar parameters return HTTP 400:

```json
{"api_version":1,"error":{"code":"invalid_request","message":"limit must be an integer from 1 to 100."}}
```

Invalid or mismatched cursor example:

```json
{"api_version":1,"error":{"code":"invalid_request","message":"Invalid cursor or cursor query does not match."}}
```

Treat network failures, proxy errors, and server 5xx as unavailable status, never
as completed or as evidence that a job is missing. Retry with backoff.

## Identity, duplicate submissions, retries, and path mappings

Match **exact canonical file_path**, after the extension's configured prefix
mapping and the server's media-type mapping. Title alone is never identity.
For example Plex `/library/Movies/Arrival.mkv` might be extension-mapped to
`/plex/Movies/Arrival.mkv`, then Purifier VIDEO_PATH_MAP
`/plex=/media` produces `/media/Movies/Arrival.mkv`. Compare that exact string
with the response file_path. Batch lookup accepts the submitted `/plex/...` path
and performs the second step for you. Do not apply a server mapping twice.

The server uses its existing path rules: first boundary-matching prefix in its
configured map (parsed configuration sorts longest prefix first), followed by
Path.expanduser().resolve(): absolute paths, dot segments removed, filesystem
symlinks resolved where available. Leading/trailing submitted whitespace is
trimmed by existing submission normalization. Case is not folded, and filenames
are not compared by title, basename, Unicode normalization, or Plex ID.
Use absolute paths and stable mount/mapping configuration. Changing maps or
symlinks does not rewrite old stored canonical paths; discovery exposes those
stored paths and original submitted paths for diagnosis. Output renaming/moving
does not change the source identity returned here.

Each job is a separate item. The largest job_id for a canonical path and media
type is authoritative, regardless of state or client. Use authoritative_job_id /
authoritative, not updated_at or the most recent successful job. A newer failed
job therefore supersedes an older completed one. Retrying/restarting an existing
job reuses its ID and updates its state/time; it does not create an attempt history
or supersede a newer job for the same path. A fresh POST normally creates a new ID.
The existing request_id deduplication can instead reference an existing job.

Raw submission JSON already retains arbitrary optional metadata, so clients may
include `"plex":{"machineIdentifier":"...","ratingKey":"..."}` without any new
required fields. Only those two string fields (up to 256 characters each) are
exposed if retained in that shape. Existing records need neither. No IDs are
inferred from titles or other fields; these are optional corroborating metadata,
not a substitute for canonical path identity.

## Pagination and polling

Items are ordered by job_id descending. The first page captures the largest ID;
subsequent pages exclude newer submissions, use a descending ID boundary, and
return each surviving matching job at most once. Each page is read in one database
transaction. Membership is bounded by the initial ID, **not a frozen snapshot of
states**: retries, edits, completions, and deletions between requests are visible.
Authoritative IDs are evaluated within that same bounded membership. Newer jobs
appear on the next fresh traversal. Cursors are not authorization and must not be
edited, reused with different filters, or retained across database replacement.
Database restore/replacement invalidates the logical traversal; start over.

For a Plex page, batch its mapped paths and follow every next_cursor until null.
Poll active queued/processing jobs about every 10 seconds while visible; back off
to 30–60 seconds when idle/hidden, and exponentially back off on errors. Restart
from page one each poll to discover new jobs and retry transitions. Cache by
canonical path plus job ID, replace the authoritative result each cycle, and
avoid overlapping polling cycles. Local “sent” history should remain pending
until the server's authoritative result resolves it; an absent match is unknown.
