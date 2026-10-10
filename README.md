# Status site (`ext/`)

A dependency-free static page that renders the Stelena uptime status. There is
no build step, no framework and no server code — it is four files, so any static
host (Render Static Site, GitHub Pages, Cloudflare Pages, Netlify, S3, nginx)
can serve it as-is.

```
ext/
├── index.html   markup
├── styles.css   styling (dark + light, responsive)
├── app.js       WebSocket client, polling fallback, rendering
└── config.js    the one file most deployers edit
```

## Point it at your API

The page needs the base URL of your Stelena deployment — the same host that
serves `GET /status`. Resolution order, first match wins:

1. `?api=https://host` in the URL (saved to `localStorage`)
2. a previously saved value in `localStorage`
3. `window.STELENA_API` in [`config.js`](config.js)
4. the built-in default

So for a permanent deploy, edit [`config.js`](config.js):

```js
window.STELENA_API = "https://stelena.plutoniumnet.work";
```

Visitors can still override per-browser with `?api=…` or the **API settings**
box in the footer, which is handy when the page and the bot are on different
hosts.

**Requirements on the API side:** the status endpoint sets permissive CORS
headers, and the WebSocket stream needs no CORS at all. If your Stelena
deployment is reachable over HTTPS, the page is served over HTTPS too — mixed
content rules require that.

## Deploying

Any of these work; all of them just need to publish this directory as the site
root.

```bash
# Render Static Site: set Publish Directory to ext, no build command
# Cloudflare Pages / Netlify: build command empty, output directory ext
# GitHub Pages: commit ext/ contents to the gh-pages branch (or docs/)
```

Locally, any static file server will do:

```bash
npx serve ext
# or
python3 -m http.server 8099 --directory ext
```

Then open `http://localhost:8099/?api=https://your-stelena-host`.

## How live updating works

`app.js` connects to `<api>/status/ws` and renders three frame types:

| Frame      | What the page does                                              |
| ---------- | --------------------------------------------------------------- |
| `snapshot` | Re-renders the whole view (level, totals, target list)          |
| `tick`     | Recomputes the countdown locally                                |
| `starting` | Keeps waiting; shows "connecting" state                         |

The countdown is not just the server's number re-printed: each frame carries a
`sentAt` timestamp, so the page derives the clock offset between server and
browser and computes the remaining time from `nextCheckAt` every 200ms. That
keeps it accurate even if the tab was backgrounded or a frame was delayed.

If the socket fails, the page retries with exponential backoff and, after five
failures, falls back to polling `GET /status` every 5 seconds — reconnecting in
the background. The connection pill (top right) shows `Live`, `Polling`,
`Connecting…` or `Offline` so a viewer can tell which mode they are in.

## What it shows

- overall level, colour and note, with a next-refresh countdown and progress bar
- up / slow / down / total counts and a live "last checked" age
- a simulated-state banner when a check is being simulated
- every target grouped exactly as in the API, with status dot, HTTP code,
  response time and uptime percentage
- the target-list source and refresh interval in the footer
