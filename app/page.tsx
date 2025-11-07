'use client';

import { useCallback, useMemo, useState } from 'react';

type ServerOption = {
  id: string;
  label: string;
};

type SpeedSample = {
  mbps: number;
  bytes: number;
  durationMs: number;
};

type NumberStats = {
  average: number;
  min: number;
  max: number;
};

const SERVERS: ServerOption[] = [
  { id: 'sin', label: 'Singapore' },
  { id: 'tyo', label: 'Tokyo' },
  { id: 'iad', label: 'Virginia' }
];

const DOWNLOAD_SAMPLE_COUNT = 3;
const UPLOAD_SAMPLE_COUNT = 3;
const PING_SAMPLE_COUNT = 15;
const DOWNLOAD_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB per sample
const UPLOAD_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB per sample
const STREAM_CHUNK_SIZE = 64 * 1024;

function formatMbps(value: number | null): string {
  if (value == null || Number.isNaN(value)) {
    return '—';
  }
  return `${value.toFixed(2)} Mbps`;
}

function formatLatency(value: number | null): string {
  if (value == null || Number.isNaN(value)) {
    return '—';
  }
  return `${value.toFixed(2)} ms`;
}

function formatProgress(value: number): string {
  const safe = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
  return `${safe.toFixed(0)}%`;
}

function computeStats(values: number[]): NumberStats | null {
  if (!values.length) {
    return null;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const sum = values.reduce((acc, value) => acc + value, 0);
  return {
    average: sum / values.length,
    min,
    max
  };
}

export default function HomePage(): JSX.Element {
  const [selectedServer, setSelectedServer] = useState<string>(SERVERS[0]!.id);

  const [downloadSamples, setDownloadSamples] = useState<SpeedSample[]>([]);
  const [uploadSamples, setUploadSamples] = useState<SpeedSample[]>([]);
  const [pingSamples, setPingSamples] = useState<number[]>([]);

  const [downloadProgress, setDownloadProgress] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [pingProgress, setPingProgress] = useState(0);

  const [downloadInstant, setDownloadInstant] = useState<number | null>(null);
  const [uploadInstant, setUploadInstant] = useState<number | null>(null);
  const [pingInstant, setPingInstant] = useState<number | null>(null);

  const [downloadRunning, setDownloadRunning] = useState(false);
  const [uploadRunning, setUploadRunning] = useState(false);
  const [pingRunning, setPingRunning] = useState(false);

  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pingError, setPingError] = useState<string | null>(null);

  const downloadStats = useMemo(() => computeStats(downloadSamples.map((sample) => sample.mbps)), [
    downloadSamples
  ]);
  const uploadStats = useMemo(() => computeStats(uploadSamples.map((sample) => sample.mbps)), [
    uploadSamples
  ]);
  const pingStats = useMemo(() => computeStats(pingSamples), [pingSamples]);

  const latestDownload = downloadSamples.at(-1)?.mbps ?? null;
  const latestUpload = uploadSamples.at(-1)?.mbps ?? null;
  const latestPing = pingSamples.at(-1) ?? null;

  const disableServerSelection = downloadRunning || uploadRunning || pingRunning;

  const runDownloadTest = useCallback(async () => {
    if (downloadRunning) {
      return;
    }

    setDownloadRunning(true);
    setDownloadError(null);
    setDownloadSamples([]);
    setDownloadProgress(0);
    setDownloadInstant(null);

    try {
      for (let sampleIndex = 0; sampleIndex < DOWNLOAD_SAMPLE_COUNT; sampleIndex += 1) {
        const response = await fetch(
          `/api/download?server=${encodeURIComponent(selectedServer)}&size=${DOWNLOAD_SIZE_BYTES}`,
          {
            cache: 'no-store'
          }
        );

        if (!response.ok || !response.body) {
          throw new Error('Download stream is unavailable.');
        }

        const reader = response.body.getReader();
        let received = 0;
        const startedAt = performance.now();

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          if (value) {
            received += value.byteLength;
            const elapsed = performance.now() - startedAt;
            if (elapsed > 0) {
              setDownloadInstant((received * 8) / elapsed / 1000);
            }
            const partial = (received / DOWNLOAD_SIZE_BYTES) * (100 / DOWNLOAD_SAMPLE_COUNT);
            setDownloadProgress(sampleIndex * (100 / DOWNLOAD_SAMPLE_COUNT) + partial);
          }
        }

        const finishedAt = performance.now();
        const durationMs = finishedAt - startedAt;
        const mbps = durationMs > 0 ? (received * 8) / durationMs / 1000 : 0;

        setDownloadInstant(mbps);
        setDownloadSamples((prev) => [...prev, { mbps, bytes: received, durationMs }]);
        setDownloadProgress(((sampleIndex + 1) / DOWNLOAD_SAMPLE_COUNT) * 100);
      }
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'Download test failed.');
    } finally {
      setDownloadRunning(false);
    }
  }, [downloadRunning, selectedServer]);

  const runUploadTest = useCallback(async () => {
    if (uploadRunning) {
      return;
    }

    setUploadRunning(true);
    setUploadError(null);
    setUploadSamples([]);
    setUploadProgress(0);
    setUploadInstant(null);

    try {
      for (let sampleIndex = 0; sampleIndex < UPLOAD_SAMPLE_COUNT; sampleIndex += 1) {
        let sent = 0;
        const startedAt = performance.now();

        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (sent >= UPLOAD_SIZE_BYTES) {
              controller.close();
              return;
            }

            const chunkLength = Math.min(STREAM_CHUNK_SIZE, UPLOAD_SIZE_BYTES - sent);
            const chunk = new Uint8Array(chunkLength);
            crypto.getRandomValues(chunk);
            sent += chunkLength;
            controller.enqueue(chunk);

            const elapsed = performance.now() - startedAt;
            if (elapsed > 0) {
              setUploadInstant((sent * 8) / elapsed / 1000);
            }

            const partial = (sent / UPLOAD_SIZE_BYTES) * (100 / UPLOAD_SAMPLE_COUNT);
            setUploadProgress(sampleIndex * (100 / UPLOAD_SAMPLE_COUNT) + partial);
          }
        });

        const response = await fetch(`/api/upload?server=${encodeURIComponent(selectedServer)}`, {
          method: 'POST',
          body: stream,
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/octet-stream'
          },
          duplex: 'half'
        });

        if (!response.ok) {
          throw new Error('Upload endpoint responded with an error.');
        }

        const payload = (await response.json().catch(() => null)) as
          | { bytes?: number }
          | null;
        const confirmedBytes = typeof payload?.bytes === 'number' && payload.bytes > 0 ? payload.bytes : sent;
        const finishedAt = performance.now();
        const durationMs = finishedAt - startedAt;
        const mbps = durationMs > 0 ? (confirmedBytes * 8) / durationMs / 1000 : 0;

        setUploadInstant(mbps);
        setUploadSamples((prev) => [...prev, { mbps, bytes: confirmedBytes, durationMs }]);
        setUploadProgress(((sampleIndex + 1) / UPLOAD_SAMPLE_COUNT) * 100);
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Upload test failed.');
    } finally {
      setUploadRunning(false);
    }
  }, [selectedServer, uploadRunning]);

  const runPingTest = useCallback(async () => {
    if (pingRunning) {
      return;
    }

    setPingRunning(true);
    setPingError(null);
    setPingSamples([]);
    setPingProgress(0);
    setPingInstant(null);

    try {
      for (let sampleIndex = 0; sampleIndex < PING_SAMPLE_COUNT; sampleIndex += 1) {
        const startedAt = performance.now();
        const response = await fetch(`/api/ping?server=${encodeURIComponent(selectedServer)}`, {
          cache: 'no-store'
        });

        if (!response.ok) {
          throw new Error('Ping endpoint responded with an error.');
        }

        await response.json().catch(() => null);

        const finishedAt = performance.now();
        const durationMs = finishedAt - startedAt;

        setPingInstant(durationMs);
        setPingSamples((prev) => [...prev, durationMs]);
        setPingProgress(((sampleIndex + 1) / PING_SAMPLE_COUNT) * 100);

        if (sampleIndex < PING_SAMPLE_COUNT - 1) {
          await new Promise((resolve) => setTimeout(resolve, 120));
        }
      }
    } catch (error) {
      setPingError(error instanceof Error ? error.message : 'Ping test failed.');
    } finally {
      setPingRunning(false);
    }
  }, [pingRunning, selectedServer]);

  return (
    <main className="page">
      <div className="page__inner">
        <header className="page__header">
          <div className="page__heading">
            <p className="page__eyebrow">Vercel Edge</p>
            <h1 className="page__title">Internet Speed Test</h1>
            <p className="page__subtitle">
              Measure download, upload, and latency with serverless functions running in the Singapore
              edge region.
            </p>
          </div>
          <div className="server-select">
            <label>
              <span>Select Server</span>
              <select
                className="server-select__input"
                value={selectedServer}
                onChange={(event) => setSelectedServer(event.target.value)}
                disabled={disableServerSelection}
              >
                {SERVERS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        <section className="cards" aria-label="Speed test results">
          <article className="card">
            <div className="card__header">
              <div>
                <h2 className="card__title">Download</h2>
                <p className="card__description">Stream random data from the selected edge server.</p>
              </div>
              <button
                type="button"
                className="card__button"
                onClick={runDownloadTest}
                disabled={downloadRunning}
              >
                {downloadRunning ? 'Running…' : 'Start'}
              </button>
            </div>

            <div className="metric">
              <span className="metric__label">Current</span>
              <span className="metric__value">{formatMbps(downloadInstant ?? latestDownload)}</span>
            </div>

            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(downloadProgress)}>
              <div className="progress__bar" style={{ width: `${Math.min(100, downloadProgress)}%` }} />
            </div>
            <p className="progress__label">{formatProgress(downloadProgress)}</p>

            <div className="stats">
              <div className="stats__item">
                <span className="stats__label">Average</span>
                <span className="stats__value">{formatMbps(downloadStats?.average ?? null)}</span>
              </div>
              <div className="stats__item">
                <span className="stats__label">Min</span>
                <span className="stats__value">{formatMbps(downloadStats?.min ?? null)}</span>
              </div>
              <div className="stats__item">
                <span className="stats__label">Max</span>
                <span className="stats__value">{formatMbps(downloadStats?.max ?? null)}</span>
              </div>
            </div>

            {downloadError ? (
              <p className="status status--error">{downloadError}</p>
            ) : downloadSamples.length > 0 ? (
              <p className="status status--success">Completed {downloadSamples.length} samples.</p>
            ) : (
              <p className="status status--muted">No samples yet.</p>
            )}
          </article>

          <article className="card">
            <div className="card__header">
              <div>
                <h2 className="card__title">Upload</h2>
                <p className="card__description">Push generated payloads to the edge upload endpoint.</p>
              </div>
              <button
                type="button"
                className="card__button"
                onClick={runUploadTest}
                disabled={uploadRunning}
              >
                {uploadRunning ? 'Running…' : 'Start'}
              </button>
            </div>

            <div className="metric">
              <span className="metric__label">Current</span>
              <span className="metric__value">{formatMbps(uploadInstant ?? latestUpload)}</span>
            </div>

            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(uploadProgress)}>
              <div className="progress__bar" style={{ width: `${Math.min(100, uploadProgress)}%` }} />
            </div>
            <p className="progress__label">{formatProgress(uploadProgress)}</p>

            <div className="stats">
              <div className="stats__item">
                <span className="stats__label">Average</span>
                <span className="stats__value">{formatMbps(uploadStats?.average ?? null)}</span>
              </div>
              <div className="stats__item">
                <span className="stats__label">Min</span>
                <span className="stats__value">{formatMbps(uploadStats?.min ?? null)}</span>
              </div>
              <div className="stats__item">
                <span className="stats__label">Max</span>
                <span className="stats__value">{formatMbps(uploadStats?.max ?? null)}</span>
              </div>
            </div>

            {uploadError ? (
              <p className="status status--error">{uploadError}</p>
            ) : uploadSamples.length > 0 ? (
              <p className="status status--success">Completed {uploadSamples.length} samples.</p>
            ) : (
              <p className="status status--muted">No samples yet.</p>
            )}
          </article>

          <article className="card">
            <div className="card__header">
              <div>
                <h2 className="card__title">Ping</h2>
                <p className="card__description">Check HTTP round-trip latency from this browser.</p>
              </div>
              <button
                type="button"
                className="card__button"
                onClick={runPingTest}
                disabled={pingRunning}
              >
                {pingRunning ? 'Running…' : 'Start'}
              </button>
            </div>

            <div className="metric">
              <span className="metric__label">Current</span>
              <span className="metric__value">{formatLatency(pingInstant ?? latestPing)}</span>
            </div>

            <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pingProgress)}>
              <div className="progress__bar" style={{ width: `${Math.min(100, pingProgress)}%` }} />
            </div>
            <p className="progress__label">{formatProgress(pingProgress)}</p>

            <div className="stats">
              <div className="stats__item">
                <span className="stats__label">Average</span>
                <span className="stats__value">{formatLatency(pingStats?.average ?? null)}</span>
              </div>
              <div className="stats__item">
                <span className="stats__label">Min</span>
                <span className="stats__value">{formatLatency(pingStats?.min ?? null)}</span>
              </div>
              <div className="stats__item">
                <span className="stats__label">Max</span>
                <span className="stats__value">{formatLatency(pingStats?.max ?? null)}</span>
              </div>
            </div>

            {pingError ? (
              <p className="status status--error">{pingError}</p>
            ) : pingSamples.length > 0 ? (
              <p className="status status--success">Completed {pingSamples.length} samples.</p>
            ) : (
              <p className="status status--muted">No samples yet.</p>
            )}
          </article>
        </section>
      </div>
    </main>
  );
}
