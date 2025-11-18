'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type TestResult = {
  mbps: number;
  bytes: number;
  durationMs: number;
  timestamp: number;
};

type ProgressState = {
  percent: number;
  instantaneousMbps: number;
};

type PingStats = {
  avg: number;
  min: number;
  max: number;
  stdDev: number;
};

type PingResult = PingStats & {
  samples: number[];
  timestamp: number;
};

type StoredResults = {
  download?: TestResult;
  upload?: TestResult;
  ping?: PingResult;
};

type PingProgress = {
  percent: number;
  lastRtt: number | null;
};

const STORAGE_KEY = 'speedtest-vercel-results-v1';
const DURATION_OPTIONS = [5, 10, 15] as const;
const DEFAULT_PING_ITERATIONS = 15;
const STREAM_CHUNK_SIZE = 65536;

const formatMbps = (value: number) => `${value.toFixed(2)} Mbps`;
const formatBytes = (value: number) => {
  if (value === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / Math.pow(1024, exponent);
  return `${scaled.toFixed(exponent === 0 ? 0 : 2)} ${units[exponent]}`;
};

const formatDuration = (ms: number) => `${(ms / 1000).toFixed(2)} s`;
const formatRtt = (ms: number) => `${ms.toFixed(2)} ms`;

const calculateStats = (values: number[]): PingStats | null => {
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const sum = values.reduce((acc, value) => acc + value, 0);
  const avg = sum / values.length;
  const variance =
    values.reduce((acc, value) => acc + Math.pow(value - avg, 2), 0) / values.length;
  return {
    min,
    max,
    avg,
    stdDev: Math.sqrt(variance)
  };
};

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isAbortError = (error: unknown): boolean => {
  return error instanceof DOMException && error.name === 'AbortError';
};

export default function HomePage() {
  const [duration, setDuration] = useState<(typeof DURATION_OPTIONS)[number]>(DURATION_OPTIONS[1]);

  const [downloadResult, setDownloadResult] = useState<TestResult | null>(null);
  const [uploadResult, setUploadResult] = useState<TestResult | null>(null);
  const [pingResult, setPingResult] = useState<PingResult | null>(null);

  const [downloadProgress, setDownloadProgress] = useState<ProgressState | null>(null);
  const [uploadProgress, setUploadProgress] = useState<ProgressState | null>(null);
  const [pingProgress, setPingProgress] = useState<PingProgress | null>(null);

  const [downloadRunning, setDownloadRunning] = useState(false);
  const [uploadRunning, setUploadRunning] = useState(false);
  const [pingRunning, setPingRunning] = useState(false);

  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pingError, setPingError] = useState<string | null>(null);

  const downloadAbortRef = useRef<AbortController | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const pingAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return;
      const parsed: StoredResults = JSON.parse(stored);
      if (parsed.download) setDownloadResult(parsed.download);
      if (parsed.upload) setUploadResult(parsed.upload);
      if (parsed.ping) setPingResult(parsed.ping);
    } catch (error) {
      console.warn('Failed to parse stored results', error);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const payload: StoredResults = {};
    if (downloadResult) payload.download = downloadResult;
    if (uploadResult) payload.upload = uploadResult;
    if (pingResult) payload.ping = pingResult;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [downloadResult, uploadResult, pingResult]);

  const resetAbortControllers = () => {
    downloadAbortRef.current = null;
    uploadAbortRef.current = null;
    pingAbortRef.current = null;
  };

  const stopAll = useCallback(() => {
    downloadAbortRef.current?.abort();
    uploadAbortRef.current?.abort();
    pingAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    return () => {
      stopAll();
      resetAbortControllers();
    };
  }, [stopAll]);

  const runDownloadTest = useCallback(async () => {
    if (downloadRunning) {
      downloadAbortRef.current?.abort();
      return;
    }

    setDownloadError(null);
    setDownloadProgress({ percent: 0, instantaneousMbps: 0 });
    setDownloadRunning(true);

    const controller = new AbortController();
    downloadAbortRef.current = controller;

    try {
      const startedAt = performance.now();
      const response = await fetch(`/api/download?seconds=${duration}&chunk=${STREAM_CHUNK_SIZE}`, {
        signal: controller.signal,
        cache: 'no-store'
      });

      if (!response.ok) {
        throw new Error(`Server responded with status ${response.status}`);
      }

      if (!response.body) {
        throw new Error('Streaming not supported in this browser.');
      }

      const reader = response.body.getReader();
      let totalBytes = 0;
      let lastChunkTime = startedAt;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;

        totalBytes += value.byteLength;
        const now = performance.now();
        const elapsed = now - startedAt;
        const chunkElapsed = Math.max(now - lastChunkTime, 1);
        const instantaneousMbps = (value.byteLength * 8) / (chunkElapsed / 1000) / 1e6;
        lastChunkTime = now;

        setDownloadProgress({
          percent: Math.min(100, (elapsed / (duration * 1000)) * 100),
          instantaneousMbps
        });
      }

      const finishedAt = performance.now();
      const durationMs = finishedAt - startedAt;
      const mbps = totalBytes > 0 && durationMs > 0 ? (totalBytes * 8) / (durationMs / 1000) / 1e6 : 0;

      setDownloadResult({
        mbps,
        bytes: totalBytes,
        durationMs,
        timestamp: Date.now()
      });

      setDownloadProgress({ percent: 100, instantaneousMbps: 0 });
    } catch (error) {
      if (isAbortError(error)) {
        setDownloadError('Download test aborted.');
      } else {
        setDownloadError((error as Error).message ?? 'Download test failed.');
      }
    } finally {
      downloadAbortRef.current = null;
      setDownloadRunning(false);
    }
  }, [downloadRunning, duration]);

  const runUploadTest = useCallback(async () => {
    if (uploadRunning) {
      uploadAbortRef.current?.abort();
      return;
    }

    setUploadError(null);
    setUploadProgress({ percent: 0, instantaneousMbps: 0 });
    setUploadRunning(true);

    const controller = new AbortController();
    uploadAbortRef.current = controller;

    try {
      const startedAt = performance.now();
      let totalBytes = 0;
      let lastChunkTime = startedAt;
      const endAt = startedAt + duration * 1000;

      const stream = new ReadableStream<Uint8Array>({
        pull(streamController) {
          if (controller.signal.aborted) {
            streamController.error(new DOMException('Upload aborted', 'AbortError'));
            return;
          }
          const now = performance.now();
          if (now >= endAt) {
            streamController.close();
            return;
          }
          const chunk = new Uint8Array(STREAM_CHUNK_SIZE);
          crypto.getRandomValues(chunk);
          totalBytes += chunk.byteLength;

          const elapsed = now - startedAt;
          const chunkElapsed = Math.max(now - lastChunkTime, 1);
          const instantaneousMbps = (chunk.byteLength * 8) / (chunkElapsed / 1000) / 1e6;
          lastChunkTime = now;

          setUploadProgress({
            percent: Math.min(100, (elapsed / (duration * 1000)) * 100),
            instantaneousMbps
          });

          streamController.enqueue(chunk);
        }
      });

      const requestInit: RequestInit & { duplex: 'half' } = {
        method: 'POST',
        body: stream,
        signal: controller.signal,
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/octet-stream'
        },
        duplex: 'half'
      };

      const response = await fetch('/api/upload', requestInit);

      if (!response.ok) {
        throw new Error(`Server responded with status ${response.status}`);
      }

      const payload = (await response.json()) as { bytes?: number };
      const serverBytes = typeof payload.bytes === 'number' ? payload.bytes : totalBytes;
      const finishedAt = performance.now();
      const durationMs = finishedAt - startedAt;
      const mbps = serverBytes > 0 && durationMs > 0 ? (serverBytes * 8) / (durationMs / 1000) / 1e6 : 0;

      setUploadResult({
        mbps,
        bytes: serverBytes,
        durationMs,
        timestamp: Date.now()
      });

      setUploadProgress({ percent: 100, instantaneousMbps: 0 });
    } catch (error) {
      if (isAbortError(error)) {
        setUploadError('Upload test aborted.');
      } else {
        setUploadError((error as Error).message ?? 'Upload test failed.');
      }
    } finally {
      uploadAbortRef.current = null;
      setUploadRunning(false);
    }
  }, [duration, uploadRunning]);

  const runPingTest = useCallback(async () => {
    if (pingRunning) {
      pingAbortRef.current?.abort();
      return;
    }

    setPingError(null);
    setPingProgress({ percent: 0, lastRtt: null });
    setPingRunning(true);

    const controller = new AbortController();
    pingAbortRef.current = controller;

    try {
      const samples: number[] = [];

      for (let index = 0; index < DEFAULT_PING_ITERATIONS; index += 1) {
        if (controller.signal.aborted) {
          throw new DOMException('Ping aborted', 'AbortError');
        }

        const startedAt = performance.now();
        const response = await fetch('/api/ping', {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal
        });

        if (!response.ok && response.status !== 204) {
          throw new Error(`Ping failed with status ${response.status}`);
        }

        const finishedAt = performance.now();
        const rtt = finishedAt - startedAt;
        samples.push(rtt);

        setPingProgress({
          percent: ((index + 1) / DEFAULT_PING_ITERATIONS) * 100,
          lastRtt: rtt
        });

        await delay(150);
      }

      const stats = calculateStats(samples);
      if (stats) {
        setPingResult({
          ...stats,
          samples,
          timestamp: Date.now()
        });
      }
      setPingProgress({ percent: 100, lastRtt: samples.at(-1) ?? null });
    } catch (error) {
      if (isAbortError(error)) {
        setPingError('Ping test aborted.');
      } else {
        setPingError((error as Error).message ?? 'Ping test failed.');
      }
    } finally {
      pingAbortRef.current = null;
      setPingRunning(false);
    }
  }, [pingRunning]);

  const latestResultsSummary = useMemo(() => {
    return [
      downloadResult && {
        label: 'Download',
        formatted: formatMbps(downloadResult.mbps)
      },
      uploadResult && {
        label: 'Upload',
        formatted: formatMbps(uploadResult.mbps)
      },
      pingResult && {
        label: 'Ping (avg)',
        formatted: formatRtt(pingResult.avg)
      }
    ].filter(Boolean) as { label: string; formatted: string }[];
  }, [downloadResult, pingResult, uploadResult]);

  const heroStats = useMemo(
    () => [
      {
        key: 'download',
        label: 'Download',
        value: downloadResult ? formatMbps(downloadResult.mbps) : '—',
        caption: downloadResult
          ? `${formatBytes(downloadResult.bytes)} • ${formatDuration(downloadResult.durationMs)}`
          : 'Awaiting measurement',
        tone: 'blue'
      },
      {
        key: 'upload',
        label: 'Upload',
        value: uploadResult ? formatMbps(uploadResult.mbps) : '—',
        caption: uploadResult
          ? `${formatBytes(uploadResult.bytes)} • ${formatDuration(uploadResult.durationMs)}`
          : 'Run the upload test to capture data',
        tone: 'purple'
      },
      {
        key: 'ping',
        label: 'HTTP Ping',
        value: pingResult ? formatRtt(pingResult.avg) : '—',
        caption: pingResult
          ? `Min ${formatRtt(pingResult.min)} • Max ${formatRtt(pingResult.max)}`
          : `${DEFAULT_PING_ITERATIONS} sample average`,
        tone: 'green'
      }
    ], [downloadResult, uploadResult, pingResult]
  );

  const statusTags = [
    {
      key: 'download',
      label: 'Download',
      status: downloadRunning ? 'Running' : 'Idle',
      tone: downloadRunning ? 'active' : downloadResult ? 'ready' : 'muted'
    },
    {
      key: 'upload',
      label: 'Upload',
      status: uploadRunning ? 'Running' : 'Idle',
      tone: uploadRunning ? 'active' : uploadResult ? 'ready' : 'muted'
    },
    {
      key: 'ping',
      label: 'HTTP Ping',
      status: pingRunning ? 'Running' : 'Idle',
      tone: pingRunning ? 'active' : pingResult ? 'ready' : 'muted'
    }
  ];

  const anyRunning = downloadRunning || uploadRunning || pingRunning;

  return (
    <main className="page">
      <div className="page__glow" aria-hidden="true" />
      <div className="page__container">
        <header className="hero" role="banner">
          <div className="hero__content">
            <span className="hero__badge">Vercel Ready</span>
            <h1>Internet Speed Intelligence Dashboard</h1>
            <p>
              Stream-aligned diagnostics for download, upload, and HTTP latency — engineered for
              Vercel&apos;s serverless platform. Every reading relies on <code>performance.now()</code>
              and cache-safe API routes for accuracy.
            </p>

            <div className="hero__controls" role="group" aria-label="Global test controls">
              <label className="field">
                <span>Test duration</span>
                <select
                  className="select"
                  aria-label="Select test duration"
                  value={duration}
                  onChange={(event) => setDuration(Number(event.target.value) as typeof duration)}
                >
                  {DURATION_OPTIONS.map((option) => (
                    <option key={option} value={option}>{`${option} seconds`}</option>
                  ))}
                </select>
              </label>
              <button
                className="btn btn--ghost"
                type="button"
                onClick={stopAll}
                disabled={!anyRunning}
              >
                Stop All Tests
              </button>
            </div>

            <div className="hero__statuses" role="list" aria-label="Test status indicators">
              {statusTags.map((tag) => (
                <span key={tag.key} className={`status status--${tag.tone}`} role="listitem">
                  <span className="status__dot" aria-hidden="true" />
                  {tag.label}: {tag.status}
                </span>
              ))}
            </div>
          </div>

          <div className="hero__stats" role="list" aria-label="Latest measurement highlights">
            {heroStats.map((stat) => (
              <div key={stat.key} className={`stat-card stat-card--${stat.tone}`} role="listitem">
                <span className="stat-card__label">{stat.label}</span>
                <span className="stat-card__value">{stat.value}</span>
                <span className="stat-card__caption">{stat.caption}</span>
              </div>
            ))}
          </div>
        </header>

        <div className="dashboard">
          <div className="dashboard__grid" role="list">
            <section
              className="panel panel--download"
              role="listitem"
              aria-labelledby="download-heading"
            >
              <div className="panel__header">
                <div>
                  <h2 id="download-heading">Download Speed</h2>
                  <p className="panel__description">
                    Streams random bytes from the server for the selected duration and reports the
                    sustained throughput.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={runDownloadTest}
                  aria-label={downloadRunning ? 'Stop download test' : 'Start download test'}
                  disabled={uploadRunning}
                >
                  {downloadRunning ? 'Stop Download' : 'Start Download'}
                </button>
              </div>

              {downloadProgress && (
                <div className="progress" aria-live="polite">
                  <div className="progress__bar" aria-hidden="true">
                    <span style={{ width: `${downloadProgress.percent.toFixed(1)}%` }} />
                  </div>
                  <div className="progress__meta">
                    <span>Progress: {downloadProgress.percent.toFixed(1)}%</span>
                    <span>Instant: {formatMbps(downloadProgress.instantaneousMbps)}</span>
                  </div>
                </div>
              )}

              {downloadResult && (
                <div className="result" aria-label="Download result summary">
                  <div className="result__value">{formatMbps(downloadResult.mbps)}</div>
                  <div className="result__meta">
                    <span>{formatBytes(downloadResult.bytes)}</span>
                    <span>{formatDuration(downloadResult.durationMs)}</span>
                  </div>
                </div>
              )}

              {downloadError && <small className="error">{downloadError}</small>}
            </section>

            <section
              className="panel panel--upload"
              role="listitem"
              aria-labelledby="upload-heading"
            >
              <div className="panel__header">
                <div>
                  <h2 id="upload-heading">Upload Speed</h2>
                  <p className="panel__description">
                    Generates random data in the browser and streams it to the API until time runs
                    out, mirroring real throughput conditions.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={runUploadTest}
                  aria-label={uploadRunning ? 'Stop upload test' : 'Start upload test'}
                  disabled={downloadRunning}
                >
                  {uploadRunning ? 'Stop Upload' : 'Start Upload'}
                </button>
              </div>

              {uploadProgress && (
                <div className="progress" aria-live="polite">
                  <div className="progress__bar" aria-hidden="true">
                    <span style={{ width: `${uploadProgress.percent.toFixed(1)}%` }} />
                  </div>
                  <div className="progress__meta">
                    <span>Progress: {uploadProgress.percent.toFixed(1)}%</span>
                    <span>Instant: {formatMbps(uploadProgress.instantaneousMbps)}</span>
                  </div>
                </div>
              )}

              {uploadResult && (
                <div className="result" aria-label="Upload result summary">
                  <div className="result__value">{formatMbps(uploadResult.mbps)}</div>
                  <div className="result__meta">
                    <span>{formatBytes(uploadResult.bytes)}</span>
                    <span>{formatDuration(uploadResult.durationMs)}</span>
                  </div>
                </div>
              )}

              {uploadError && <small className="error">{uploadError}</small>}
            </section>

            <section
              className="panel panel--ping panel--wide"
              role="listitem"
              aria-labelledby="ping-heading"
            >
              <div className="panel__header">
                <div>
                  <h2 id="ping-heading">HTTP Ping</h2>
                  <p className="panel__description">
                    Calls the lightweight <code>/api/ping</code> endpoint {DEFAULT_PING_ITERATIONS}{' '}
                    times and records round-trip timings.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={runPingTest}
                  aria-label={pingRunning ? 'Stop ping test' : 'Start ping test'}
                >
                  {pingRunning ? 'Stop Ping' : 'Start Ping'}
                </button>
              </div>

              {pingProgress && (
                <div className="progress" aria-live="polite">
                  <div className="progress__bar" aria-hidden="true">
                    <span style={{ width: `${pingProgress.percent.toFixed(1)}%` }} />
                  </div>
                  <div className="progress__meta">
                    <span>Progress: {pingProgress.percent.toFixed(1)}%</span>
                    {typeof pingProgress.lastRtt === 'number' && (
                      <span>Last RTT: {formatRtt(pingProgress.lastRtt)}</span>
                    )}
                  </div>
                </div>
              )}

              {pingResult && (
                <div className="ping-results">
                  <div className="result" aria-label="Ping result summary">
                    <div className="result__value">{formatRtt(pingResult.avg)}</div>
                    <div className="result__meta">
                      <span>Min: {formatRtt(pingResult.min)}</span>
                      <span>Max: {formatRtt(pingResult.max)}</span>
                      <span>Std Dev: {formatRtt(pingResult.stdDev)}</span>
                    </div>
                  </div>
                  <div className="table-wrapper" role="region" aria-label="Ping samples">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">Sample</th>
                          <th scope="col">RTT</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pingResult.samples.map((sample, index) => (
                          <tr key={`ping-${index}`}>
                            <td>{index + 1}</td>
                            <td>{formatRtt(sample)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {pingError && <small className="error">{pingError}</small>}
            </section>
          </div>

          {latestResultsSummary.length > 0 && (
            <section className="panel panel--summary" aria-live="polite">
              <div className="panel__header">
                <div>
                  <h2>Latest Measurements</h2>
                  <p className="panel__description">
                    Stored locally so you can compare with your next run.
                  </p>
                </div>
              </div>
              <ul className="summary-list">
                {latestResultsSummary.map((entry) => (
                  <li key={entry.label}>
                    <span>{entry.label}</span>
                    <strong>{entry.formatted}</strong>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <footer className="page__footer">
          <p>
            These metrics capture HTTP-based throughput and latency — expect variance versus ICMP
            utilities. Deploy instantly on Vercel without maintaining a custom server.
          </p>
        </footer>
      </div>
    </main>
  );
}
