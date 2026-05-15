#!/usr/bin/env node
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec, execFile } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
let filePath;
let port = 3000;
let open = true;
let resourceId = '';

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--port' || a === '-p') port = Number(args[++i]);
  else if (a === '--resource' || a === '-r') resourceId = args[++i];
  else if (a === '--no-open') open = false;
  else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
  else if (!filePath) filePath = a;
}

if (!filePath) { printHelp(); process.exit(1); }

const resolvedPath = path.resolve(filePath);
if (!fs.existsSync(resolvedPath)) {
  console.error(`File not found: ${resolvedPath}`);
  process.exit(1);
}

const distDir = path.join(__dirname, '..', 'dist');
const indexPath = path.join(distDir, 'index.html');

if (!fs.existsSync(indexPath)) {
  console.error(`Build output missing at ${distDir}. Run 'npm run build' first.`);
  process.exit(1);
}

const clients = new Set();
let cachedToken = null;

function getArmToken() {
  if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) {
    return Promise.resolve(cachedToken.token);
  }
  return new Promise((resolve, reject) => {
    execFile('az', ['account', 'get-access-token', '--resource', 'https://management.azure.com', '-o', 'json'],
      { maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        try {
          const j = JSON.parse(stdout);
          cachedToken = { token: j.accessToken, expiresAt: new Date(j.expiresOn).getTime() };
          resolve(cachedToken.token);
        } catch (e) { reject(e); }
      });
  });
}

function getAzAccount() {
  return new Promise(resolve => {
    execFile('az', ['account', 'show', '-o', 'json'], (err, stdout) => {
      if (err) return resolve(null);
      try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
    });
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function armQuery(token, resourceId, query, timespan) {
  if (!resourceId.startsWith('/')) resourceId = '/' + resourceId;
  const url = new URL(`https://management.azure.com${resourceId}/query?api-version=2018-04-20`);
  const body = JSON.stringify({ query, timespan });
  return new Promise((resolve, reject) => {
    const req = https.request({
      method: 'POST',
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      }
    }, res => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => resolve({ status: res.statusCode, body: chunks }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  try {
    if (req.url === '/api/workbook') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(fs.readFileSync(resolvedPath, 'utf-8'));
    } else if (req.url === '/api/config') {
      const acct = await getAzAccount();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ resourceId, account: acct?.user?.name || null, tenant: acct?.tenantId || null }));
    } else if (req.url === '/api/query' && req.method === 'POST') {
      const { query, resourceId: rid, timespan } = await readJsonBody(req);
      const target = rid || resourceId;
      if (!target) { res.writeHead(400); res.end('resourceId required'); return; }
      const token = await getArmToken();
      const result = await armQuery(token, target, query, timespan);
      if (result.status >= 400) {
        console.error(`\n[query ${result.status}] ${target}`);
        console.error('--- query ---');
        console.error(query);
        console.error('--- response ---');
        console.error(result.body.substring(0, 500));
        console.error('');
      }
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(result.body);
    } else if (req.url === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache',
      });
      res.write('retry: 1000\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
    } else if (req.url === '/' || req.url === '/index.html') {
      const html = fs.readFileSync(indexPath, 'utf-8').replace(
        '</body>',
        `<script>
          try {
            const es = new EventSource('/api/events');
            es.addEventListener('reload', () => location.reload());
          } catch (e) {}
        </script></body>`
      );
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } else if (req.url === '/bundle.js' || req.url === '/bundle.js.map') {
      const p = path.join(distDir, req.url);
      if (!fs.existsSync(p)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': req.url.endsWith('.map') ? 'application/json' : 'application/javascript' });
      res.end(fs.readFileSync(p));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(String(e.message || e));
  }
});

let debounce;
fs.watch(resolvedPath, () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    console.log(`Changed: ${path.basename(resolvedPath)} — reloading`);
    for (const c of clients) c.write('event: reload\ndata: 1\n\n');
  }, 100);
});

server.listen(port, () => {
  const url = `http://localhost:${port}`;
  console.log(`Serving ${resolvedPath}`);
  if (resourceId) console.log(`Resource: ${resourceId}`);
  console.log(`→ ${url}`);
  if (open) {
    const cmd = process.platform === 'darwin' ? 'open'
      : process.platform === 'win32' ? 'start ""'
      : 'xdg-open';
    exec(`${cmd} ${url}`);
  }
});

function printHelp() {
  console.log(`Usage: az-workbook <path-to-workbook.json> [options]

Options:
  -p, --port <n>        Port to serve on (default 3000)
  -r, --resource <id>   Default Application Insights / Log Analytics resource ID
      --no-open         Don't auto-open the browser
  -h, --help            Show this help

Auth: uses local 'az' CLI. Run 'az login' first.`);
}
