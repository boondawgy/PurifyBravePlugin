# Purify for Plex

Brave extension that adds **Purify** to Plex movie context menus and submits the movie to Purifier's `POST /media` endpoint.

## Install

1. Open `brave://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this repository folder.
3. Click the extension's toolbar icon (or open its **Details → Extension options**).
4. Enter your Purifier address and [Plex token](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/). The default direct Plex address is `http://localhost:32400`. Set another server address if needed, or leave it empty for Plex account discovery.
5. Save and grant the requested access to your servers and Plex Direct connections.
6. Ensure Purifier has a saved profile named exactly `Movie`, with its media type and processing settings configured.
7. Refresh Plex, view a movie or open its card's three-dot menu, and choose **Purify**.

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

- Movies only. TV episodes are rejected before submission.
- Movies with multiple versions or parts are rejected to avoid selecting the wrong file.
- Success is shown only when Purifier returns `queued: true`; duplicate/ignored responses and API errors are displayed.
- Plex connection discovery and read-only metadata requests run concurrently; the first successful connection wins and other requests are canceled. The working connection is cached for 10 minutes in extension session storage, including across service worker restarts. Changed Plex credentials or direct addresses use a separate cache entry. Failed cached connections fall back to discovery after at most 2.5 seconds.
- Requests time out after 15 seconds. A timeout may occur after the server accepted a job: check Purifier before retrying.
- The Plex token is stored locally, not synced or sent to Purifier. Cross-origin requests run in the extension service worker. Only configured/discovered server destinations are used; content scripts cannot choose a request URL or payload.
- Plex menus use internal DOM classes that can change. If the entry is missing, provide a screenshot of the opened menu and its inspected HTML so selectors can be updated. Card selection requires a unique movie link in the card; viewing the movie's detail page also provides its identity.
- After reloading the extension, refresh Plex tabs.

## Validation

Core tests cover route parsing, path mapping, payloads, and ambiguous media. Run `node --test tests/*.test.mjs` with Node.js 20+ installed. Live integration still requires loading the extension in Brave with your Plex credentials and running Purifier. No real processing jobs are submitted by tests.

Implementation references: [Chrome cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests), [Plex server API](https://developer.plex.tv/pms/).

## Save subtitle as sidecar

A second movie menu item, **Save subtitle as sidecar**, sends a POST to
`http://192.168.0.228:5678/webhook/plex-export-downloaded-subtitles` with **no body**.
It does not fetch Plex metadata or send a movie ID, file path, or Plex token.
The webhook workflow decides which subtitles to export. JSON, text, and empty
HTTP success responses are accepted. The notice confirms the request was accepted,
not that the workflow has finished exporting. Reload the extension and refresh
Plex after updating; allow access to `192.168.0.228` if Brave prompts.

## Menu placement

Both extension actions appear in the movie poster's three-dot menu and the
movie detail page's three-dot action menu. Menus must contain Plex's native
**Get Info**, **Refresh Metadata**, and **Analyze** entries. Sort/filter menus,
library menus, subtitle selectors, and **Add to** submenus do not qualify.
These action labels match the English Plex interface shown during setup.
