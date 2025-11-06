const downloadBtn = document.getElementById('download-btn');
const uploadBtn = document.getElementById('upload-btn');
const wsBtn = document.getElementById('ws-btn');
const httpBtn = document.getElementById('http-btn');
const wsReconnectBtn = document.getElementById('ws-reconnect');
const resetBtn = document.getElementById('reset-btn');
const downloadSizeSelect = document.getElementById('download-size');
const uploadSizeSelect = document.getElementById('upload-size');
const targetsSelect = document.getElementById('targets');
const addTargetBtn = document.getElementById('add-target');
const customTargetInput = document.getElementById('custom-target');
const serverUrlEl = document.getElementById('server-url');
const wsStatusEl = document.getElementById('ws-status');

const downloadMbpsEl = document.getElementById('download-mbps');
const downloadMetaEl = document.getElementById('download-meta');
const downloadErrorEl = document.getElementById('download-error');

const uploadMbpsEl = document.getElementById('upload-mbps');
const uploadMetaEl = document.getElementById('upload-meta');
const uploadErrorEl = document.getElementById('upload-error');

const wsSummaryEl = document.getElementById('ws-summary');
const wsMetaEl = document.getElementById('ws-meta');
const wsListEl = document.getElementById('ws-list');
const wsErrorEl = document.getElementById('ws-error');

const httpErrorEl = document.getElementById('http-error');
const httpBodyEl = document.getElementById('http-body');
const httpTableHeaders = Array.from(document.querySelectorAll('th[data-key]'));

const DEFAULT_TARGETS = [
  'https://games.roblox.com/',
  'https://api.roblox.com/',
  'https://store.steampowered.com/',
  'https://valorant-api.com/',
];

const LOCAL_STORAGE_KEY = 'speedtest-custom-targets';
const ABORT_CONTROLLERS = new Set();

let ws;
const pendingWsPings = new Map();
let wsConnectPromise;
let isWsIntentionalClose = false;
let wsTestCancelled = false;

const baseHttpUrl = window.location.origin;
const baseWsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`;
serverUrlEl.textContent = `Server: ${baseHttpUrl}`;

function registerAbortController(controller) {
  ABORT_CONTROLLERS.add(controller);
  controller.signal.addEventListener(
    'abort',
    () => {
      ABORT_CONTROLLERS.delete(controller);
    },
    { once: true },
  );
  return controller;
}

function abortAllControllers() {
  for (const controller of Array.from(ABORT_CONTROLLERS)) {
    controller.abort();
  }
  ABORT_CONTROLLERS.clear();
}

function setButtonsDisabled(disabled) {
  [downloadBtn, uploadBtn, wsBtn, httpBtn, wsReconnectBtn].forEach((btn) => {
    btn.disabled = disabled;
  });
  downloadSizeSelect.disabled = disabled;
  uploadSizeSelect.disabled = disabled;
  targetsSelect.disabled = disabled;
}

function resetErrors() {
  [downloadErrorEl, uploadErrorEl, wsErrorEl, httpErrorEl].forEach((el) => {
    el.hidden = true;
    el.textContent = '';
  });
}

function showError(el, message) {
  el.hidden = false;
  el.textContent = message;
}

function formatMbps(bytes, milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return '0.00 Mbps';
  }
  const bits = bytes * 8;
  const megabitsPerSecond = bits / (milliseconds / 1000) / 1_000_000;
  return `${megabitsPerSecond.toFixed(2)} Mbps`;
}

function formatDuration(milliseconds) {
  return `${(milliseconds / 1000).toFixed(2)} s`;
}

function stats(values) {
  if (!values.length) {
    return {
      min: 0,
      max: 0,
      avg: 0,
      stddev: 0,
    };
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const sum = values.reduce((acc, value) => acc + value, 0);
  const avg = sum / values.length;
  const variance = values.reduce((acc, value) => acc + (value - avg) ** 2, 0) / values.length;
  const stddev = Math.sqrt(variance);
  return { min, max, avg, stddev };
}

function renderWsStatus(status, className = '') {
  wsStatusEl.textContent = `WebSocket: ${status}`;
  wsStatusEl.className = className;
}

function ensureWebSocket(forceReconnect = false) {
  if (!forceReconnect && ws && ws.readyState === WebSocket.OPEN) {
    return Promise.resolve(ws);
  }

  if (wsConnectPromise && !forceReconnect) {
    return wsConnectPromise;
  }

  if (ws) {
    isWsIntentionalClose = true;
    try {
      ws.close();
    } catch (error) {
      console.error('Failed to close WebSocket before reconnect', error);
    }
    ws = undefined;
  }

  renderWsStatus('Connecting...');

  wsConnectPromise = new Promise((resolve, reject) => {
    let settled = false;
    try {
      ws = new WebSocket(baseWsUrl);
    } catch (error) {
      reject(error);
      return;
    }

    const cleanup = () => {
      wsConnectPromise = undefined;
    };

    ws.addEventListener(
      'open',
      () => {
        settled = true;
        renderWsStatus('Connected', 'success');
        cleanup();
        resolve(ws);
      },
      { once: true },
    );

    ws.addEventListener(
      'error',
      (event) => {
        console.error('WebSocket error', event);
        renderWsStatus('Error');
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error('WebSocket connection error'));
        }
      },
      { once: true },
    );

    ws.addEventListener('close', () => {
      renderWsStatus('Disconnected');
      if (!isWsIntentionalClose) {
        for (const [id, pending] of pendingWsPings) {
          pending.reject(new Error('WebSocket closed'));
          pendingWsPings.delete(id);
        }
      }
      isWsIntentionalClose = false;
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error('WebSocket closed before opening'));
      } else {
        cleanup();
      }
    });

    ws.addEventListener('message', (event) => {
      const { data } = event;
      if (typeof data !== 'string') {
        return;
      }
      try {
        const parsed = JSON.parse(data);
        if (!parsed || !parsed.id) {
          return;
        }
        const pending = pendingWsPings.get(parsed.id);
        if (!pending) {
          return;
        }
        pendingWsPings.delete(parsed.id);
        const rtt = performance.now() - parsed.t;
        pending.resolve(rtt);
      } catch (error) {
        // Ignore parse errors; the echo might not be JSON
      }
    });
  });

  return wsConnectPromise;
}

async function runDownloadTest() {
  resetErrors();
  setButtonsDisabled(true);
  const sizeMb = Number.parseInt(downloadSizeSelect.value, 10);
  const controller = registerAbortController(new AbortController());
  const url = `/api/download?mb=${sizeMb}`;
  const startedAt = performance.now();
  let firstByteTime = null;
  let downloaded = 0;

  downloadMetaEl.innerHTML = '<span class="spinner" aria-hidden="true"></span> Running download test...';
  downloadMbpsEl.textContent = '…';

  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }

    if (!response.body) {
      throw new Error('Readable stream not supported');
    }

    const reader = response.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (!firstByteTime) {
        firstByteTime = performance.now();
      }
      downloaded += value.byteLength;
    }

    const finishedAt = performance.now();
    const referenceTime = firstByteTime ?? startedAt;
    const durationMs = finishedAt - referenceTime;
    downloadMbpsEl.textContent = formatMbps(downloaded, durationMs);
    downloadMetaEl.textContent = `${(downloaded / (1024 * 1024)).toFixed(2)} MB in ${formatDuration(durationMs)}`;
  } catch (error) {
    console.error('Download test failed', error);
    downloadMbpsEl.textContent = '–';
    downloadMetaEl.textContent = 'Download test failed.';
    showError(downloadErrorEl, error.message || 'Download failed');
  } finally {
    ABORT_CONTROLLERS.delete(controller);
    setButtonsDisabled(false);
  }
}

async function runUploadTest() {
  resetErrors();
  setButtonsDisabled(true);
  const sizeMb = Number.parseInt(uploadSizeSelect.value, 10);
  const bytes = sizeMb * 1024 * 1024;
  const payload = new Uint8Array(bytes);
  crypto.getRandomValues(payload);
  const controller = registerAbortController(new AbortController());

  uploadMetaEl.innerHTML = '<span class="spinner" aria-hidden="true"></span> Running upload test...';
  uploadMbpsEl.textContent = '…';

  const startedAt = performance.now();
  try {
    const response = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: payload,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }
    const data = await response.json();
    const finishedAt = performance.now();
    const durationMs = finishedAt - startedAt;
    const uploadedBytes = data?.bytes ?? bytes;
    uploadMbpsEl.textContent = formatMbps(uploadedBytes, durationMs);
    uploadMetaEl.textContent = `${(uploadedBytes / (1024 * 1024)).toFixed(2)} MB in ${formatDuration(durationMs)}`;
  } catch (error) {
    console.error('Upload test failed', error);
    uploadMbpsEl.textContent = '–';
    uploadMetaEl.textContent = 'Upload test failed.';
    showError(uploadErrorEl, error.message || 'Upload failed');
  } finally {
    ABORT_CONTROLLERS.delete(controller);
    setButtonsDisabled(false);
  }
}

function sendWsPing(sampleIndex) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      reject(new Error('WebSocket is not connected'));
      return;
    }
    if (wsTestCancelled) {
      reject(new Error('WebSocket test cancelled'));
      return;
    }

    const id = `ping-${Date.now()}-${sampleIndex}-${Math.random().toString(16).slice(2)}`;
    const timestamp = performance.now();
    const payload = JSON.stringify({ id, t: timestamp });
    const timeout = setTimeout(() => {
      pendingWsPings.delete(id);
      reject(new Error('Ping timed out'));
    }, 5000);

    pendingWsPings.set(id, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (err) => {
        clearTimeout(timeout);
        reject(err);
      },
    });

    try {
      ws.send(payload);
    } catch (error) {
      clearTimeout(timeout);
      pendingWsPings.delete(id);
      reject(error);
    }
  });
}

async function runWsTest() {
  resetErrors();
  setButtonsDisabled(true);
  wsMetaEl.innerHTML = '<span class="spinner" aria-hidden="true"></span> Running WebSocket ping...';
  wsSummaryEl.textContent = '…';
  wsListEl.innerHTML = '';
  wsTestCancelled = false;

  try {
    await ensureWebSocket();
    const samples = [];
    for (let i = 0; i < 20; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const rtt = await sendWsPing(i);
      if (wsTestCancelled) {
        throw new Error('WebSocket test cancelled');
      }
      samples.push(rtt);
      const item = document.createElement('li');
      item.textContent = `#${i + 1}: ${rtt.toFixed(2)} ms`;
      wsListEl.appendChild(item);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const { min, max, avg, stddev } = stats(samples);
    wsSummaryEl.textContent = `min ${min.toFixed(2)} ms · avg ${avg.toFixed(2)} ms · max ${max.toFixed(2)} ms · σ ${stddev.toFixed(2)} ms`;
    wsMetaEl.textContent = 'Latency statistics over 20 echoes.';
  } catch (error) {
    console.error('WebSocket ping failed', error);
    wsSummaryEl.textContent = '–';
    if (error.message === 'WebSocket test cancelled') {
      wsMetaEl.textContent = 'WebSocket test cancelled.';
    } else {
      wsMetaEl.textContent = 'WebSocket test failed.';
      showError(wsErrorEl, error.message || 'WebSocket error');
    }
  } finally {
    setButtonsDisabled(false);
  }
}

async function runHttpPing() {
  resetErrors();
  setButtonsDisabled(true);
  httpErrorEl.hidden = true;
  httpBodyEl.innerHTML = '';

  const selectedTargets = Array.from(targetsSelect.selectedOptions).map((option) => option.value);
  if (selectedTargets.length === 0) {
    showError(httpErrorEl, 'Select at least one target.');
    setButtonsDisabled(false);
    return;
  }

  httpErrorEl.hidden = true;
  const controller = registerAbortController(new AbortController());

  try {
    const response = await fetch('/api/http-ping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targets: selectedTargets }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Server responded with ${response.status}`);
    }
    const data = await response.json();
    renderHttpResults(data);
  } catch (error) {
    console.error('HTTP ping failed', error);
    showError(httpErrorEl, error.message || 'HTTP ping failed');
  } finally {
    ABORT_CONTROLLERS.delete(controller);
    setButtonsDisabled(false);
  }
}

function renderHttpResults(resultMap) {
  const entries = Object.entries(resultMap).map(([target, info]) => ({
    target,
    status: info?.status ?? info?.error ?? 'n/a',
    ms: Number.isFinite(info?.ms) ? info.ms : null,
  }));
  const sorted = sortResults(entries);
  updateHeaderSortIndicators();
  populateHttpTable(sorted);
}

let currentSort = { key: 'ms', direction: 'ascending' };

function sortResults(entries) {
  if (!entries.length) {
    return entries;
  }
  const { key, direction } = currentSort;
  const multiplier = direction === 'ascending' ? 1 : -1;
  return [...entries].sort((a, b) => {
    const valueA = a[key];
    const valueB = b[key];
    if (valueA === valueB) {
      return 0;
    }
    if (valueA == null) {
      return 1;
    }
    if (valueB == null) {
      return -1;
    }
    if (typeof valueA === 'number' && typeof valueB === 'number') {
      return (valueA - valueB) * multiplier;
    }
    return valueA.toString().localeCompare(valueB.toString()) * multiplier;
  });
}

function updateHeaderSortIndicators() {
  for (const header of httpTableHeaders) {
    if (header.dataset.key === currentSort.key) {
      header.setAttribute('aria-sort', currentSort.direction);
    } else {
      header.setAttribute('aria-sort', 'none');
    }
  }
}

function populateHttpTable(entries) {
  httpBodyEl.innerHTML = '';
  for (const entry of entries) {
    const row = document.createElement('tr');
    const targetCell = document.createElement('td');
    targetCell.textContent = entry.target;
    const statusCell = document.createElement('td');
    statusCell.textContent = entry.status;
    const msCell = document.createElement('td');
    msCell.textContent = entry.ms != null ? entry.ms.toString() : '—';
    row.appendChild(targetCell);
    row.appendChild(statusCell);
    row.appendChild(msCell);
    httpBodyEl.appendChild(row);
  }
}

function handleHeaderClick(event) {
  const key = event.currentTarget.dataset.key;
  if (!key) {
    return;
  }
  const newDirection = currentSort.key === key && currentSort.direction === 'ascending' ? 'descending' : 'ascending';
  currentSort = { key, direction: newDirection };
  updateHeaderSortIndicators();
  const currentEntries = Array.from(httpBodyEl.querySelectorAll('tr')).map((row) => {
    const [targetCell, statusCell, msCell] = row.children;
    const ms = Number.parseFloat(msCell.textContent);
    return {
      target: targetCell.textContent,
      status: statusCell.textContent,
      ms: Number.isNaN(ms) ? null : ms,
    };
  });
  const sorted = sortResults(currentEntries);
  populateHttpTable(sorted);
}

function restoreCustomTargets() {
  try {
    const stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || '[]');
    if (Array.isArray(stored)) {
      for (const url of stored) {
        appendTargetOption(url, true);
      }
    }
  } catch (error) {
    console.warn('Failed to restore custom targets', error);
  }
}

function appendTargetOption(url, isCustom = false) {
  if ([...targetsSelect.options].some((option) => option.value === url)) {
    return;
  }
  const option = new Option(url, url, false, false);
  if (isCustom) {
    option.dataset.custom = 'true';
  }
  option.selected = true;
  targetsSelect.appendChild(option);
}

function syncCustomTargetsStorage() {
  const customOptions = Array.from(targetsSelect.options)
    .filter((option) => option.dataset.custom === 'true')
    .map((option) => option.value);
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(customOptions));
}

function handleAddTarget(event) {
  event.preventDefault();
  const url = customTargetInput.value.trim();
  if (!url) {
    return;
  }
  appendTargetOption(url, true);
  syncCustomTargetsStorage();
  customTargetInput.value = '';
}

function populateDefaultTargets() {
  for (const target of DEFAULT_TARGETS) {
    appendTargetOption(target, false);
  }
  restoreCustomTargets();
  for (const option of targetsSelect.options) {
    option.selected = true;
  }
}

function resetUi() {
  abortAllControllers();
  resetErrors();
  wsTestCancelled = true;
  for (const [id, pending] of Array.from(pendingWsPings.entries())) {
    pending.reject(new Error('WebSocket test cancelled'));
    pendingWsPings.delete(id);
  }
  setButtonsDisabled(false);
  downloadMbpsEl.textContent = '–';
  downloadMetaEl.textContent = 'Select a size and run the test.';
  uploadMbpsEl.textContent = '–';
  uploadMetaEl.textContent = 'Select a size and run the test.';
  wsSummaryEl.textContent = '–';
  wsMetaEl.textContent = 'Latency samples will appear here.';
  wsListEl.innerHTML = '';
  httpBodyEl.innerHTML = '';
}

function initEventListeners() {
  downloadBtn.addEventListener('click', () => {
    if (!downloadBtn.disabled) {
      runDownloadTest();
    }
  });
  uploadBtn.addEventListener('click', () => {
    if (!uploadBtn.disabled) {
      runUploadTest();
    }
  });
  wsBtn.addEventListener('click', () => {
    if (!wsBtn.disabled) {
      runWsTest();
    }
  });
  httpBtn.addEventListener('click', () => {
    if (!httpBtn.disabled) {
      runHttpPing();
    }
  });
  addTargetBtn.addEventListener('click', handleAddTarget);
  customTargetInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleAddTarget(event);
    }
  });
  resetBtn.addEventListener('click', () => {
    resetUi();
  });
  wsReconnectBtn.addEventListener('click', async () => {
    try {
      setButtonsDisabled(true);
      await ensureWebSocket(true);
    } catch (error) {
      showError(wsErrorEl, error.message || 'Failed to reconnect WebSocket');
    } finally {
      setButtonsDisabled(false);
    }
  });

  httpTableHeaders.forEach((header) => {
    header.addEventListener('click', handleHeaderClick);
    header.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleHeaderClick(event);
      }
    });
  });
}

function init() {
  populateDefaultTargets();
  initEventListeners();
  updateHeaderSortIndicators();
  ensureWebSocket().catch((error) => {
    console.error('Failed to establish WebSocket on load', error);
    showError(wsErrorEl, error.message || 'WebSocket connection failed');
  });
}

window.addEventListener('beforeunload', () => {
  isWsIntentionalClose = true;
  if (ws) {
    ws.close();
  }
});

init();
