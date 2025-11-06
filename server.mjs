import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import express from 'express';
import { WebSocketServer } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PUBLIC_DIR = path.join(__dirname, 'public');

app.use(express.json({ limit: '1mb' }));

app.use(
  express.static(PUBLIC_DIR, {
    setHeaders(res) {
      res.setHeader('Cache-Control', 'public, max-age=60');
    },
  }),
);

function parseMegabytes(value, defaultMb) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return defaultMb;
  }
  return Math.min(parsed, 1024); // Hard cap to 1 GB per request
}

app.get('/api/download', (req, res) => {
  const megabytes = parseMegabytes(req.query.mb, 25);
  const totalBytes = megabytes * 1024 * 1024;
  const chunkSize = 64 * 1024;

  res.status(200);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');

  let sent = 0;
  let aborted = false;

  req.on('close', () => {
    aborted = true;
  });

  const writeChunk = () => {
    if (aborted) {
      return;
    }
    if (sent >= totalBytes) {
      res.end();
      return;
    }

    const remaining = totalBytes - sent;
    const size = Math.min(chunkSize, remaining);
    const chunk = randomBytes(size);
    sent += size;

    const canContinue = res.write(chunk);
    if (canContinue) {
      setImmediate(writeChunk);
    } else {
      res.once('drain', writeChunk);
    }
  };

  writeChunk();
});

app.post(
  '/api/upload',
  express.raw({ type: ['application/octet-stream', 'application/x-binary', 'application/octetstream'], limit: '1gb' }),
  (req, res) => {
    if (!Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: 'Expected binary payload' });
      return;
    }

    res.json({ bytes: req.body.length });
  },
);

app.post('/api/http-ping', async (req, res) => {
  const { targets } = req.body ?? {};
  if (!Array.isArray(targets) || targets.length === 0) {
    res.status(400).json({ error: 'targets must be a non-empty array of URLs' });
    return;
  }

  const results = await Promise.all(
    targets.map(async (target) => {
      if (typeof target !== 'string' || target.trim().length === 0) {
        return [target, { ms: null, error: 'Invalid URL' }];
      }

      const url = target.trim();
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), 8000);
      const start = performance.now();

      try {
        const response = await fetch(url, {
          method: 'HEAD',
          redirect: 'follow',
          signal: abortController.signal,
        });
        const duration = performance.now() - start;
        clearTimeout(timeout);
        return [url, { ms: Math.round(duration), status: response.status }];
      } catch (error) {
        clearTimeout(timeout);
        const duration = performance.now() - start;
        return [url, { ms: Math.round(duration), error: error.message }];
      }
    }),
  );

  res.json(Object.fromEntries(results));
});

app.use((req, res, next) => {
  if (req.method === 'GET' && req.accepts('html')) {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  } else {
    next();
  }
});

const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (socket) => {
  socket.on('message', (data) => {
    socket.send(data);
  });
});

const PORT = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000;

server.listen(PORT, () => {
  console.log(`Speed test server listening on http://localhost:${PORT}`);
});
