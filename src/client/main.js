import Chart from 'chart.js/auto';
import 'chartjs-adapter-date-fns';
import { marked } from 'marked';

let workbookData = null;
let parameters = {};
let charts = {};
let queryResults = {};

async function loadConfig() {
  try {
    const cfg = JSON.parse(localStorage.getItem('workbook-viz-config') || '{}');
    const serverCfg = await fetch('/api/config').then(r => r.json()).catch(() => ({}));
    document.getElementById('resource-id').value = serverCfg.resourceId || cfg.resourceId || '';
    if (serverCfg.account) {
      document.getElementById('user-info').textContent = `az: ${serverCfg.account}`;
    }
  } catch {}
}

function saveConfig() {
  const resourceId = document.getElementById('resource-id').value.trim();
  localStorage.setItem('workbook-viz-config', JSON.stringify({ resourceId }));
  document.getElementById('config-status').textContent = resourceId ? 'Saved' : '';
  if (workbookData) executeAllQueries();
}

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', e => handleFile(e.target.files[0]));
document.getElementById('resource-id').addEventListener('change', saveConfig);

function handleFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      workbookData = JSON.parse(e.target.result);
      dropZone.style.display = 'none';
      document.getElementById('workbook-container').style.display = 'block';
      renderWorkbook();
    } catch (err) {
      alert('Invalid JSON: ' + err.message);
    }
  };
  reader.readAsText(file);
}

function getTimeRange() {
  const sel = document.getElementById('time-range-select');
  if (!sel) return { durationMs: 7776000000 };
  return { durationMs: parseInt(sel.value) };
}

function getTimeRangeValues() {
  const { durationMs } = getTimeRange();
  const end = new Date();
  const start = new Date(end.getTime() - durationMs);
  return { start: start.toISOString(), end: end.toISOString() };
}

function substituteParams(query) {
  const tr = getTimeRangeValues();
  let result = query
    .replace(/\{TimeRange:start\}/g, `datetime(${tr.start})`)
    .replace(/\{TimeRange:end\}/g, `datetime(${tr.end})`)
    .replace(/\{TimeRange\}/g, `ago(${getTimeRange().durationMs / 1000}s)`);
  for (const [name, value] of Object.entries(parameters)) {
    result = result.replace(new RegExp(`\\{${name}\\}`, 'g'), value);
  }
  return result;
}

const durationLabels = {
  604800000: 'Last 7 days',
  2592000000: 'Last 30 days',
  7776000000: 'Last 90 days',
  15552000000: 'Last 180 days',
  31536000000: 'Last 365 days',
};

function renderWorkbook() {
  const itemsEl = document.getElementById('items');
  itemsEl.innerHTML = '';
  Object.values(charts).forEach(c => c.destroy());
  charts = {};

  const items = workbookData.items || [];

  const paramItems = items.filter(i => i.type === 9);
  const paramBar = document.getElementById('param-bar');
  if (paramItems.length > 0) {
    paramBar.style.display = 'flex';
    paramBar.innerHTML = '';
    paramItems.forEach(item => {
      (item.content.parameters || []).forEach(p => {
        const group = document.createElement('div');
        group.className = 'param-group';
        const label = document.createElement('label');
        label.textContent = p.name + ': ';
        group.appendChild(label);

        if (p.type === 4) {
          const select = document.createElement('select');
          select.id = 'time-range-select';
          const vals = p.typeSettings?.selectableValues || [];
          vals.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.durationMs;
            opt.textContent = durationLabels[v.durationMs] || `${v.durationMs / 86400000} days`;
            if (p.value?.durationMs === v.durationMs) opt.selected = true;
            select.appendChild(opt);
          });
          select.addEventListener('change', () => { parameters[p.name] = select.value; executeAllQueries(); });
          group.appendChild(select);
        } else if (p.type === 2) {
          const select = document.createElement('select');
          select.id = `param-${p.name}`;
          if (p.typeSettings?.isMultiSelect) select.multiple = true;
          const jsonData = p.jsonData ? JSON.parse(p.jsonData) : [];
          jsonData.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.value ?? item;
            opt.textContent = item.label ?? item.value ?? item;
            if (p.value === (item.value ?? item)) opt.selected = true;
            select.appendChild(opt);
          });
          if (p.criteria) {
            p.criteria.forEach(c => {
              const opt = document.createElement('option');
              opt.value = c.value;
              opt.textContent = c.label || c.value;
              select.appendChild(opt);
            });
          }
          select.addEventListener('change', () => {
            if (select.multiple) {
              parameters[p.name] = Array.from(select.selectedOptions).map(o => o.value).join(',');
            } else {
              parameters[p.name] = select.value;
            }
            executeAllQueries();
          });
          if (p.value) parameters[p.name] = p.value;
          group.appendChild(select);
        } else if (p.type === 1) {
          const input = document.createElement('input');
          input.type = 'text';
          input.id = `param-${p.name}`;
          input.value = p.value || '';
          input.placeholder = p.name;
          parameters[p.name] = input.value;
          input.addEventListener('change', () => { parameters[p.name] = input.value; executeAllQueries(); });
          group.appendChild(input);
        }

        paramBar.appendChild(group);
      });
    });
  } else {
    paramBar.style.display = 'none';
  }

  items.forEach((item, idx) => {
    if (item.type === 9) return;

    if (item.conditionalVisibility) {
      const cv = item.conditionalVisibility;
      const paramVal = parameters[cv.parameterName] || '';
      if (cv.comparison === 'isEqualTo' && paramVal !== cv.value) return;
      if (cv.comparison === 'isNotEqualTo' && paramVal === cv.value) return;
    }

    const div = document.createElement('div');
    div.className = 'workbook-item';
    div.id = `item-${idx}`;

    if (item.customWidth) {
      const w = item.customWidth;
      div.style.width = w.includes('%') || w.includes('px') ? w : `${w}%`;
      div.style.flex = '0 0 auto';
      if (!w.includes('px')) {
        div.style.width = `calc(${div.style.width} - 8px)`;
      }
    }

    if (item.styleSettings) {
      const ss = item.styleSettings;
      if (ss.margin) div.style.margin = ss.margin;
      if (ss.padding) div.style.padding = ss.padding;
      if (ss.maxWidth) div.style.maxWidth = ss.maxWidth;
      if (ss.showBorder === false) { div.style.border = 'none'; }
    }

    if (item.type === 1) {
      div.innerHTML = marked.parse(item.content.json || '');
    } else if (item.type === 3) {
      const title = item.content.title ? `<h3 style="margin-bottom:4px;">${escapeHtml(item.content.title)}</h3>` : '';
      const desc = item.content.description ? `<p style="color:var(--text-muted);font-size:12px;margin-bottom:12px;">${escapeHtml(item.content.description)}</p>` : '';
      div.innerHTML = `${title}${desc}<div class="loading" id="loading-${idx}">Queued…</div>
        <div id="result-${idx}"></div>
        <div style="display:flex;gap:12px;">
          <div class="query-toggle" data-toggle="query" data-idx="${idx}">Show query</div>
          <div class="query-toggle" data-toggle="rawdata" data-idx="${idx}">Show raw data</div>
        </div>
        <div class="query-text" id="query-${idx}">${escapeHtml(item.content.query || '')}</div>
        <div class="query-text" id="rawdata-${idx}"></div>`;
    }

    itemsEl.appendChild(div);
  });

  itemsEl.querySelectorAll('.query-toggle').forEach(el => {
    el.addEventListener('click', () => {
      const idx = el.dataset.idx;
      if (el.dataset.toggle === 'query') toggleQuery(idx);
      else toggleRawData(idx);
    });
  });

  executeAllQueries();
}

function toggleQuery(idx) {
  const el = document.getElementById(`query-${idx}`);
  el.style.display = el.style.display === 'block' ? 'none' : 'block';
}

function toggleRawData(idx) {
  const el = document.getElementById(`rawdata-${idx}`);
  if (el.style.display === 'block') { el.style.display = 'none'; return; }
  const data = queryResults[idx];
  if (!data || !data.tables || !data.tables[0]) { el.textContent = 'No data'; el.style.display = 'block'; return; }
  const table = data.tables[0];
  const columns = table.columns.map(c => c.name);
  const rows = table.rows;
  let html = '<table><thead><tr>';
  columns.forEach(c => html += `<th>${escapeHtml(c)}</th>`);
  html += '</tr></thead><tbody>';
  rows.forEach(row => {
    html += '<tr>';
    row.forEach(cell => html += `<td>${escapeHtml(String(cell ?? ''))}</td>`);
    html += '</tr>';
  });
  html += '</tbody></table>';
  el.innerHTML = html;
  el.style.display = 'block';
}

async function executeAllQueries() {
  const items = workbookData.items || [];
  const resourceId = document.getElementById('resource-id').value.trim();

  if (!resourceId) {
    document.getElementById('status-bar').textContent = 'Set a Resource ID to execute queries';
    return;
  }

  document.getElementById('status-bar').textContent = 'Executing queries...';

  const promises = items.map(async (item, idx) => {
    if (item.type !== 3) return;
    const loadingEl = document.getElementById(`loading-${idx}`);
    const resultEl = document.getElementById(`result-${idx}`);
    if (!loadingEl || !resultEl) return;

    loadingEl.textContent = 'Executing query...';
    loadingEl.style.display = 'block';
    resultEl.innerHTML = '';

    if (charts[idx]) { charts[idx].destroy(); delete charts[idx]; }

    const query = substituteParams(item.content.query);
    try {
      const data = await executeQuery(query, resourceId);
      loadingEl.style.display = 'none';
      queryResults[idx] = data;
      renderVisualization(resultEl, idx, item.content, data);
    } catch (e) {
      loadingEl.innerHTML = `<span class="error">Query failed: ${escapeHtml(e.message)}</span>`;
    }
  });

  await Promise.all(promises);
  document.getElementById('status-bar').textContent = 'All queries executed';
}

async function executeQuery(query, resourceId) {
  const resp = await fetch('/api/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, resourceId, timespan: getTimeRangeISO() })
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`${resp.status}: ${text.substring(0, 300)}`);
  }
  return resp.json();
}

function getTimeRangeISO() {
  const tr = getTimeRangeValues();
  return `${tr.start}/${tr.end}`;
}

function renderVisualization(container, idx, content, data) {
  const viz = content.visualization || 'table';
  const tables = data.tables || [];
  if (tables.length === 0) {
    container.innerHTML = '<span class="loading">No data returned</span>';
    return;
  }
  const table = tables[0];
  const columns = table.columns.map(c => c.name);
  const rows = table.rows;
  const size = content.size ?? 1;

  if (viz === 'table') renderTable(container, columns, rows, size, content.gridSettings, content.formatOptions);
  else if (viz === 'timechart') renderTimeChart(container, idx, columns, rows, content.chartSettings, size);
  else if (viz === 'barchart') renderBarChart(container, idx, columns, rows, content.chartSettings, size);
  else if (viz === 'piechart') renderPieChart(container, idx, columns, rows, content.chartSettings, size);
  else if (viz === 'tiles') renderTiles(container, columns, rows, content.tileSettings);
  else if (viz === 'text') renderText(container, columns, rows, content.textSettings);
  else renderTable(container, columns, rows, size);
}

function getThresholdClass(value, thresholds) {
  if (!thresholds || !Array.isArray(thresholds)) return '';
  const sorted = [...thresholds].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  for (const t of sorted) {
    const tv = parseFloat(t.value ?? 0);
    const op = t.operator || '>=';
    let match = false;
    if (op === '>=' || op === 'GreaterOrEqual') match = value >= tv;
    else if (op === '>' || op === 'Greater') match = value > tv;
    else if (op === '<=' || op === 'LessOrEqual') match = value <= tv;
    else if (op === '<' || op === 'Less') match = value < tv;
    else if (op === '==' || op === 'Equal') match = value === tv;
    else match = value >= tv;
    if (match) {
      const color = (t.representation || t.color || '').toLowerCase();
      if (color.includes('green') || color === '1') return 'threshold-green';
      if (color.includes('yellow') || color === '2') return 'threshold-yellow';
      if (color.includes('orange') || color === '3') return 'threshold-orange';
      if (color.includes('red') || color === '4') return 'threshold-red';
      return '';
    }
  }
  return '';
}

function renderTable(container, columns, rows, size, gridSettings, formatOptions) {
  const fmtMap = {};
  if (formatOptions) {
    formatOptions.forEach(fo => { if (fo.columnMatch) fmtMap[fo.columnMatch] = fo; });
  }

  let html = '<table><thead><tr>';
  columns.forEach(c => {
    const label = fmtMap[c]?.customColumnLabel || c;
    html += `<th>${escapeHtml(label)}</th>`;
  });
  html += '</tr></thead><tbody>';

  const rowLimit = gridSettings?.rowLimit || rows.length;
  rows.slice(0, rowLimit).forEach(row => {
    html += '<tr>';
    row.forEach((cell, i) => {
      let val = cell;
      const fmt = fmtMap[columns[i]];
      const numVal = parseFloat(val);
      let cls = '';
      if (fmt?.thresholds && !isNaN(numVal)) cls = getThresholdClass(numVal, fmt.thresholds);
      if (typeof val === 'number') val = val.toLocaleString();
      if (columns[i]?.includes('%') && !String(val).includes('%')) val = val + '%';
      if (fmt?.formatOptions?.showColumnBarChart) {
        const pct = Math.min(100, Math.max(0, numVal));
        html += `<td class="${cls}"><div style="display:flex;align-items:center;gap:8px;"><div style="width:60px;height:8px;background:var(--border);border-radius:4px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:var(--accent);border-radius:4px;"></div></div><span>${escapeHtml(String(val ?? ''))}</span></div></td>`;
      } else {
        html += `<td class="${cls}">${escapeHtml(String(val ?? ''))}</td>`;
      }
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  container.innerHTML = html;
}

function renderTiles(container, columns, rows, tileSettings) {
  const wrapper = document.createElement('div');
  wrapper.className = 'tiles-container';

  const titleCol = tileSettings?.titleField ? columns.indexOf(tileSettings.titleField) : 0;
  const leftCol = tileSettings?.leftContent?.columnMatch ? columns.indexOf(tileSettings.leftContent.columnMatch) : (columns.length > 1 ? 1 : -1);
  const subtitleCol = tileSettings?.subtitleField ? columns.indexOf(tileSettings.subtitleField) : -1;
  const rightCol = tileSettings?.rightContent?.columnMatch ? columns.indexOf(tileSettings.rightContent.columnMatch) : -1;

  rows.forEach(row => {
    const tile = document.createElement('div');
    tile.className = 'tile';
    if (tileSettings?.showBorder === false) tile.style.border = 'none';

    let html = '';
    if (titleCol >= 0) html += `<div class="tile-title">${escapeHtml(String(row[titleCol] ?? ''))}</div>`;
    if (leftCol >= 0) {
      const val = row[leftCol];
      const numVal = parseFloat(val);
      let cls = '';
      if (tileSettings?.leftContent?.thresholds && !isNaN(numVal)) cls = getThresholdClass(numVal, tileSettings.leftContent.thresholds);
      html += `<div class="tile-value ${cls}">${escapeHtml(String(val ?? ''))}</div>`;
    }
    if (subtitleCol >= 0) html += `<div class="tile-subtitle">${escapeHtml(String(row[subtitleCol] ?? ''))}</div>`;
    if (rightCol >= 0) html += `<div class="tile-subtitle">${escapeHtml(String(row[rightCol] ?? ''))}</div>`;

    if (!tileSettings) {
      html = `<div class="tile-title">${escapeHtml(columns[0])}</div><div class="tile-value">${escapeHtml(String(row[0] ?? ''))}</div>`;
      for (let i = 1; i < columns.length; i++) {
        html += `<div class="tile-subtitle">${escapeHtml(columns[i])}: ${escapeHtml(String(row[i] ?? ''))}</div>`;
      }
    }

    tile.innerHTML = html;
    wrapper.appendChild(tile);
  });

  if (rows.length === 1 && !tileSettings) {
    wrapper.innerHTML = '';
    const row = rows[0];
    columns.forEach((col, i) => {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.innerHTML = `<div class="tile-title">${escapeHtml(col)}</div><div class="tile-value">${escapeHtml(String(row[i] ?? ''))}</div>`;
      wrapper.appendChild(tile);
    });
  }

  container.appendChild(wrapper);
}

function renderText(container, columns, rows, textSettings) {
  if (rows.length === 0) return;
  const style = textSettings?.style || 'bignumber';
  const row = rows[0];

  if (style === 'bignumber' || style === 'header') {
    let html = '<div style="display:flex;flex-wrap:wrap;gap:24px;">';
    columns.forEach((col, i) => {
      const val = row[i];
      html += `<div><div class="${style === 'bignumber' ? 'big-number' : ''}" style="${style === 'header' ? 'font-size:28px;font-weight:600;color:#e0e0e0;' : ''}">${escapeHtml(String(val ?? ''))}</div>`;
      html += `<div class="big-number-label">${escapeHtml(col)}</div></div>`;
    });
    html += '</div>';
    container.innerHTML = html;
  } else if (style === 'markdown') {
    container.innerHTML = marked.parse(String(row[0] ?? ''));
  } else {
    container.innerHTML = `<pre style="color:var(--text);font-size:13px;">${escapeHtml(String(row[0] ?? ''))}</pre>`;
  }
}

// Azure Monitor workbook named series colors → hex.
const AZURE_COLORS = {
  blue: '#0078d4', lightblue: '#5ea0ef', darkblue: '#004b87',
  green: '#107c10', lightgreen: '#6bb700', greenbright: '#5db300',
  red: '#e81123', redbright: '#e81123', darkred: '#a4262c',
  orange: '#ff8c00', orangebright: '#f7630c',
  yellow: '#fce100', gold: '#c19c00',
  purple: '#b146c2', magenta: '#e3008c', pink: '#e3008c',
  gray: '#a19f9d', grey: '#a19f9d', graybluedark: '#465f7f',
  brown: '#8e562e', turquoise: '#00b7c3',
};

function azureColor(name) {
  return name ? AZURE_COLORS[String(name).toLowerCase()] : undefined;
}

function isNumericValue(v) {
  if (typeof v === 'number') return true;
  if (typeof v === 'string') return v.trim() !== '' && !isNaN(Number(v));
  return false;
}

function renderTimeChart(container, idx, columns, rows, settings, size) {
  const wrapper = document.createElement('div');
  wrapper.className = `chart-container chart-size-${typeof size === 'number' ? size : 1}`;
  const canvas = document.createElement('canvas');
  wrapper.appendChild(canvas);
  container.appendChild(wrapper);

  const timeCol = 0;
  const colors = ['#0078d4', '#00b7c3', '#8764b8', '#e3008c', '#ff8c00', '#107c10'];

  // Classify the non-time columns into numeric (value) vs string (dimension) columns.
  const otherCols = columns.map((_, i) => i).filter(i => i !== timeCol);
  const numericCols = otherCols.filter(i =>
    rows.some(r => r[i] != null) && rows.every(r => r[i] == null || isNumericValue(r[i])));
  const stringCols = otherCols.filter(i => !numericCols.includes(i));

  let datasets;
  // Long/tall format: one numeric value column + ≥1 string dimension column
  // (e.g. `createdAt | Verdict | Share %`). Azure pivots on the dimension to
  // draw one line per distinct value; we do the same instead of plotting every
  // row as a single zigzagging series.
  if (numericCols.length === 1 && stringCols.length >= 1) {
    const valueCol = numericCols[0];
    const seriesMap = new Map();
    rows.forEach(r => {
      const key = stringCols.map(i => String(r[i] ?? '')).join(' / ');
      if (!seriesMap.has(key)) seriesMap.set(key, []);
      seriesMap.get(key).push({ x: new Date(r[timeCol]), y: r[valueCol] });
    });

    const labelSettings = settings?.seriesLabelSettings || [];
    const orderOf = name => {
      const i = labelSettings.findIndex(s => s.seriesName === name);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    const seriesNames = [...seriesMap.keys()].sort((a, b) => orderOf(a) - orderOf(b));

    datasets = seriesNames.map((name, i) => {
      const ls = labelSettings.find(s => s.seriesName === name);
      const color = azureColor(ls?.color) || colors[i % colors.length];
      const data = seriesMap.get(name);
      return {
        label: name,
        data,
        borderColor: color,
        backgroundColor: color + '20',
        fill: false,
        tension: 0.3,
        pointRadius: data.length > 40 ? 0 : 2,
      };
    });
  } else {
    // Wide format: each numeric column is its own series.
    const yColumns = settings?.yAxis || numericCols.map(i => columns[i]);
    let yIndices = yColumns.map(name => columns.indexOf(name)).filter(i => i >= 0);
    if (yIndices.length === 0) yIndices = numericCols.slice();
    datasets = yIndices.map((colIdx, i) => {
      const data = rows.map(r => ({ x: new Date(r[timeCol]), y: r[colIdx] }));
      return {
        label: columns[colIdx],
        data,
        borderColor: colors[i % colors.length],
        backgroundColor: colors[i % colors.length] + '20',
        fill: false,
        tension: 0.3,
        pointRadius: data.length > 40 ? 0 : 3,
      };
    });
  }

  charts[idx] = new Chart(canvas, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { type: 'time', time: { unit: 'week', tooltipFormat: 'MMM d, yyyy', displayFormats: { week: 'MMM d', day: 'MMM d' } }, grid: { color: '#3c3c3c' }, ticks: { color: '#888', maxRotation: 45 } },
        y: { min: settings?.ySettings?.min, max: settings?.ySettings?.max, grid: { color: '#3c3c3c' }, ticks: { color: '#888' } }
      },
      plugins: { legend: { labels: { color: '#ccc' } } }
    }
  });
}

function renderBarChart(container, idx, columns, rows, settings, size) {
  const wrapper = document.createElement('div');
  wrapper.className = 'chart-container';
  const canvas = document.createElement('canvas');
  wrapper.appendChild(canvas);
  container.appendChild(wrapper);

  const xCol = settings?.xAxis ? columns.indexOf(settings.xAxis) : 0;
  const yColNames = settings?.yAxis || columns.filter((_, i) => i !== xCol);
  const yIndices = yColNames.map(name => columns.indexOf(name)).filter(i => i >= 0);
  if (yIndices.length === 0) for (let i = 0; i < columns.length; i++) if (i !== xCol) yIndices.push(i);

  const labels = rows.map(r => r[xCol]);
  const colors = ['#0078d4', '#00b7c3', '#8764b8', '#e3008c'];
  const datasets = yIndices.map((colIdx, i) => ({
    label: columns[colIdx],
    data: rows.map(r => r[colIdx]),
    backgroundColor: colors[i % colors.length],
  }));

  charts[idx] = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { color: '#3c3c3c' }, ticks: { color: '#888' }, title: { display: !!settings?.xSettings?.label, text: settings?.xSettings?.label, color: '#888' } },
        y: { min: settings?.ySettings?.min, grid: { color: '#3c3c3c' }, ticks: { color: '#888' }, title: { display: !!settings?.ySettings?.label, text: settings?.ySettings?.label, color: '#888' } }
      },
      plugins: { legend: { labels: { color: '#ccc' } } }
    }
  });
}

function renderPieChart(container, idx, columns, rows, settings, size) {
  const wrapper = document.createElement('div');
  wrapper.className = 'chart-container';
  const canvas = document.createElement('canvas');
  wrapper.appendChild(canvas);
  container.appendChild(wrapper);

  const labels = rows.map(r => String(r[0]));
  const data = rows.map(r => r[1]);
  const colors = ['#0078d4', '#00b7c3', '#8764b8', '#e3008c', '#ff8c00', '#107c10', '#d83b01', '#5c2d91', '#008272', '#b4009e'];

  charts[idx] = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors.slice(0, labels.length),
        borderColor: '#252526',
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'right', labels: { color: '#ccc' } } }
    }
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function autoLoadWorkbook() {
  try {
    const resp = await fetch('/api/workbook');
    if (!resp.ok) return;
    workbookData = await resp.json();
    dropZone.style.display = 'none';
    document.getElementById('workbook-container').style.display = 'block';
    renderWorkbook();
  } catch {}
}

(async () => {
  await loadConfig();
  await autoLoadWorkbook();
})();
