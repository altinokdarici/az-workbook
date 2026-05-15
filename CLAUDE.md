# CLAUDE.md

Project context for Claude Code. This is an **unofficial** local CLI that previews Azure Monitor / Application Insights workbook JSON files. Not affiliated with Microsoft.

## What it is

`az-workbook <file.json>` — Node CLI that:
1. Serves a bundled SPA on `http://localhost:3000`
2. Renders the workbook (parameters, markdown, queries, visualizations)
3. Executes KQL queries against Azure by shelling out to the local `az` CLI for tokens
4. Watches the JSON file and live-reloads the browser on save

## Stack

- **Runtime:** Node 18+, pure ESM (`"type": "module"` in package.json)
- **Bundler:** esbuild (single 297 KB `dist/bundle.js`, format `esm`)
- **Client deps:** `chart.js`, `chartjs-adapter-date-fns`, `date-fns`, `marked`
- **No frameworks** (no React/Vue) — plain DOM + Chart.js. Keep it that way unless asked.
- **No client-side auth** — server proxies queries through `/api/query` using `az account get-access-token`.

## File layout

```
src/
  cli.js              # Node server + auth proxy + SSE live reload
  client/
    index.html        # HTML shell with inline CSS
    main.js           # ES module entry; imports chart.js, marked
scripts/
  build.js            # esbuild + copies index.html → dist/
dist/                 # generated, gitignored, npm-published
```

Only `src/cli.js`, `dist/`, `README.md`, `package.json` ship in the npm tarball (see `files` field).

## Endpoints

- `GET /` — HTML shell (server injects an SSE reload `<script>` before `</body>`)
- `GET /bundle.js` — bundled client
- `GET /api/workbook` — current workbook JSON (read from disk on each request)
- `GET /api/config` — `{ resourceId, account, tenant }` (from `az account show`)
- `POST /api/query` — `{ query, resourceId, timespan }` → server attaches bearer token, forwards to `https://management.azure.com{resourceId}/query`
- `GET /api/events` — SSE stream; emits `reload` event when the workbook file changes

## Workbook schema coverage

Partial. Supported:
- Item types: `1` (markdown), `3` (query), `9` (parameters)
- Parameter types: `1` (text), `2` (dropdown), `4` (time range)
- Visualizations: `table`, `timechart`, `barchart`, `piechart`, `tiles`, `text`
- Misc: `conditionalVisibility`, `customWidth`, basic `formatOptions` (thresholds, column bar)

Not supported: groups, links/tabs, metrics, resource pickers, query-backed parameters, ARM/Resource Graph queries, grid heatmaps, map/graph/scatter charts. KQL Logs only.

## Parameter substitution

In `src/client/main.js::substituteParams`:
- `{TimeRange:start}` / `{TimeRange:end}` → `datetime(<ISO>)` — **must** be the `datetime(...)` literal form, not a bare string, or KQL parser errors at the `:` in the ISO timestamp.
- `{TimeRange}` → `ago(<seconds>s)`
- `{<paramName>}` → captured value (text/dropdown)

## Conventions

- **No secrets/IDs in code.** No tenant IDs, subscription IDs, resource IDs, or GUIDs ever. The user supplies the resource ID via `--resource` or the UI.
- **No external CDNs at runtime.** Everything bundled. Earlier versions loaded chart.js/marked from jsdelivr; do not regress.
- **Inline event handlers (`onclick=`) are banned** — won't work under module bundling. Use `addEventListener`.
- **`prepublishOnly` builds automatically.** Don't commit `dist/`; it's gitignored but published.

## Common tasks

- **Run locally:** `npm run build && node src/cli.js <file.json>`
- **Dev loop:** `npm run dev` (esbuild watch) in one terminal, `node src/cli.js ...` in another
- **Verify shippable:** `npm pack --dry-run`
