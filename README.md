# Purify for Plex

Brave extension that adds a **P** button in the top-right corner of Plex movie posters, keeps **Purify** in movie context menus, and submits the movie to Purifier's `POST /media` endpoint.

## Install

1. Open `brave://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this repository folder.
3. Click the extension's toolbar icon (or open its **Details → Extension options**).
4. Enter your Purifier address and [Plex token](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/). The default direct Plex address is `http://localhost:32400`. Set another server address if needed, or leave it empty for Plex account discovery.
5. Save and grant the requested access to your servers and Plex Direct connections.
6. Ensure Purifier has a saved profile named exactly `Movie`, with its media type and processing settings configured.
7. Refresh Plex and click the **P** on a movie poster, or choose **Purify** from its three-dot menu.

Supported Plex pages: `https://app.plex.tv`, `http://localhost:32400`, and `http://127.0.0.1:32400`. Server IDs are read from the movie route; the extension verifies a direct server's identity before using it. Other account servers are discovered through Plex's resource API. Discovered connections use HTTPS Plex Direct hosts.

## Request and paths

```json
{
  "file_path": "/media/Movies/13 Going on 30 (2004).mp4",
  "profile": "Movie",
  "title": "13 Going on 30"
}
```

Default case-sensitive prefix mapping: `/Volumes/Media/Media` → `/media`. Thus `/Volumes/Media/Media/Movies/13 Going on 30 (2004).mp4` becomes `/media/Movies/13 Going on 30 (2004).mp4`. Unmatched paths are rejected; change the mapping in settings if needed. Purifier also supports server-side path mappings, if you prefer to manage those there.

The movie name uses `title`, as required by Purifier's existing API. The named profile supplies the media type and processing settings. No Purifier code changes are required.

## Scope and troubleshooting

- Movie libraries only. Plex library type and movie metadata agent are verified; home videos (even when Plex labels their item type as movie), TV, and unidentified libraries are excluded before submission.
- Movies with multiple versions show a version status summary, but submission is disabled to avoid selecting the wrong file. Multi-part or inaccessible movies show an unavailable indicator with an explanation.
- Success is shown only when Purifier returns `queued: true`; duplicate/ignored responses and API errors are displayed.
- Plex connection discovery and read-only metadata requests run concurrently; the first successful connection wins and other requests are canceled. The working connection is cached for 10 minutes in extension session storage, including across service worker restarts. Changed Plex credentials or direct addresses use a separate cache entry. Failed cached connections fall back to discovery after at most 2.5 seconds.
- Requests time out after 15 seconds. A timeout may occur after the server accepted a job: check Purifier before retrying.
- The Plex token is stored locally, not synced or sent to Purifier. Cross-origin requests run in the extension service worker. Only configured/discovered server destinations are used; content scripts cannot choose a request URL or payload.
- Plex menus use internal DOM classes that can change. If the entry is missing, provide a screenshot of the opened menu and its inspected HTML so selectors can be updated. Card selection requires a unique movie link in the card; viewing the movie's detail page also provides its identity.
- After reloading the extension, refresh Plex tabs.

## Validation

Core tests cover route parsing, path mapping, payloads, and ambiguous media. Run `node --test tests/*.test.mjs` with Node.js 20+ installed. Live integration still requires loading the extension in Brave with your Plex credentials and running Purifier. No real processing jobs are submitted by tests.

Implementation references: [Chrome cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests), [Plex server API](https://developer.plex.tv/pms/).

## Poster indicators and status API

- Gold **P**: no matching cached job; click to send.
- Amber **↥**: locally sent or queued in Purifier.
- Blue **◌**: processing.
- Green **✓**: Purifier recorded processing success. This can mean ready for manual review; it does not verify Plex visibility, export, or that every requested edit occurred.
- Red **!**: failed or canceled; click to retry.
- Amber **1/2** (or similar): one of two grouped Plex versions is completed. Hover for filenames and individual states. Submission is disabled until the files are separated in Plex. All-completed groups show a green check.
- **?**: submission unavailable, for example missing files or multi-part media; hover for the reason.

Hover or focus a button for its status and any safe error summary. Sent, queued, processing, and completed indicators are disabled to prevent accidental resubmission. A successful POST updates the local indicator immediately and records the returned job ID. An absent server match does not erase a local sent record.

Status comes from the documented [Purifier v1 contract](docs/purifier-status-api.md). One full `GET /media/status?media_type=video&limit=100` traversal discovers jobs from all clients. Every opaque cursor is followed with the same filters; the complete result is published atomically. The server bounds traversal membership, but job states can change between pages. No Plex token is sent to Purifier. Existing submission fields stay unchanged.

If jobs were originally processed under a staging prefix (for example `/processing`) and then exported to the library (`/media`), configure **Status path matching** in settings. This optional alias preserves the full relative path and affects status only, never POST submission paths. Both prefixes default to blank.

Matching uses the exact, case-sensitive mapped file path and canonical path groups from the response. An exact original submitted path can identify its canonical group when Purifier mapped the path further; conflicting destinations remain unknown. Titles, profile names, and Plex IDs are never used as identity. Changing server mappings or symlinks can make historical aliases ambiguous; keep mount/path mappings stable. Within a group, the server's authoritative job ID wins, so a newer failed job supersedes an older completed one. Locally submitted job IDs protect against a snapshot predating that submission.

Artwork and overlay links are detected independently in current Plex cards. New cards and recycled cards are handled dynamically, and read-only Plex metadata verifies media type and file identity. At most four poster lookups run concurrently. TV items receive no button.

## Refresh settings

Automatic refresh defaults to **once every 24 hours**. Settings allow disabling it, choosing 1–8760 whole hours, and **Refresh now**, which works even with automatic refresh off. Settings show the last successful refresh and any refresh error.

The service worker owns a persisted cache shared across tabs and browser restarts. Chrome alarms trigger due refreshes while Brave is running, even without a Plex tab open. New posters and newly opened libraries reuse the cache; they do not each fetch Purifier status. A daily sync can require multiple HTTP requests if there are more than 100 job records. Simultaneous refresh requests are coalesced. Opening Plex checks whether the shared cache is due rather than restarting the daily clock.

Failures keep the last complete snapshot and last successful timestamp. Automatic retries back off from one minute to one hour; manual refresh can retry immediately. Automatic refresh off also disables automatic retries. No processing jobs are submitted by a refresh. Missing or unavailable status is never shown as completed. Settings explicitly refresh Purifier, rather than just rereading extension-local submission history.

## Custom POST body

Edit **POST request body → JSON body template** in settings. The default is:

```json
{
  "file_path": "{{file_path}}",
  "profile": "{{profile}}",
  "title": "{{title}}"
}
```

Add any nested JSON settings supported by Purifier, change the profile, or include Plex identity metadata. Available placeholders are `file_path` (mapped), `plex_file_path` (original), `title`, `profile` (Movie), `year`, `media_type` (video), `rating_key`, `server_id`, `duration_ms`, and `plex_guid`. Tokens are not exposed as variables. Missing year, duration, or GUID becomes null.

Use double-quoted placeholders in JSON values. A whole-value placeholder preserves its original number/null type; a placeholder embedded in longer text inserts a string. Movie values are substituted after JSON parsing and serialized safely, so quotes, backslashes, and newlines cannot inject JSON fields. Placeholders in keys, unknown variables, malformed JSON, non-object bodies, and missing/relative `file_path` values are rejected before saving and again before sending. No JavaScript or expression evaluation occurs.

The example preview uses sample movie data and never sends a request. **Reset body to default** resets the editor; save to apply it. The destination remains the configured Purifier origin's `POST /media`. If you customize `file_path`, local history records that submitted path alongside the selected Plex file so subsequent job status can still be linked.
