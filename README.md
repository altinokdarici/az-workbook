# az-workbook

> **Unofficial.** Not affiliated with, endorsed by, or supported by Microsoft. "Azure", "Azure Monitor", "Application Insights", and "Workbooks" are trademarks of Microsoft Corporation; used here for descriptive purposes only. This tool consumes the public workbook JSON schema and the public Azure ARM / Log Analytics query APIs.

Local CLI to preview Azure Monitor / Application Insights **workbook JSON** files in your browser with live reload. Useful for the inner-loop while editing a workbook checked into source control.

Auth uses your local **`az` CLI** — no app registration, tenant ID, or client ID required.

## Install

```bash
npm install -g az-workbook
# or
npx az-workbook ./my-workbook.json
```

## Usage

```bash
az login                              # once
az-workbook ./my-workbook.json \
  --resource /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Insights/components/<ai>
```

Opens `http://localhost:3000`. Editing the JSON in your editor reloads the browser automatically.

### Options

```
-p, --port <n>        Port (default 3000)
-r, --resource <id>   Default Log Analytics / App Insights resource ID
    --no-open         Don't auto-open the browser
-h, --help            Show help
```

You can also paste the resource ID in the UI (saved to `localStorage`).

## What's supported

A subset of the workbook schema (good enough for many real workbooks, not everything):

- **Item types:** text/markdown (1), query (3), parameters (9)
- **Parameters:** text (1), dropdown (2), time range (4)
- **Visualizations:** table, timechart, barchart, piechart, tiles, text
- **Other:** conditional visibility, custom width, basic format options (thresholds, column bar)

Not supported: groups, links/tabs, metrics, resource pickers, query-backed parameters, grid heatmaps, map/graph/scatter charts, ARM/Resource Graph queries (KQL Logs only).

## How it works

- Node server serves a bundled SPA.
- Browser POSTs queries to `/api/query`.
- Server runs `az account get-access-token` and forwards the query to ARM (`management.azure.com/.../query`).
- Token is cached in-memory until expiry.

## Development

```bash
npm install
npm run dev      # esbuild watch + html copy
# in another shell:
node src/cli.js ./some-workbook.json
```

## License

MIT
