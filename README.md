# SpeedTest Vercel

A Vercel-friendly internet speed test that measures download throughput, upload throughput, and HTTP latency using the Next.js App Router and TypeScript.

## Features

- ⚡️ Streaming download test that runs for a configurable duration
- 🚀 Streaming upload test that generates random data in the browser
- 📡 Lightweight HTTP ping that records min/avg/max/standard deviation
- 💾 Results stored locally in the browser for quick reference
- 🌓 Responsive, dark-mode-friendly UI built with plain CSS
- ☁️ Ready to deploy on Vercel without any custom server code

## Getting Started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the development server:

   ```bash
   npm run dev
   ```

3. Visit [http://localhost:3000](http://localhost:3000) to run the tests.

## Available Scripts

- `npm run dev` – Start Next.js in development mode
- `npm run build` – Create an optimized production build
- `npm run start` – Serve the production build locally on port 3000

## API Routes

| Route | Method | Description |
| ----- | ------ | ----------- |
| `/api/download` | GET | Streams random bytes for a configurable duration. Query params: `seconds` (default 10), `chunk` (default 65536). |
| `/api/upload` | POST | Accepts a streamed request body and returns `{ bytes }` to report the total payload size. |
| `/api/ping` | GET/HEAD | Returns a 204 with a fresh `Date` header for precise round-trip timing. |

All routes set `Cache-Control: no-store` to ensure accurate measurements and support cross-origin usage when proxied through Vercel.

## Deployment

Deploying to Vercel requires no additional configuration:

1. Push this repository to GitHub.
2. In the Vercel dashboard choose **New Project** → **Import**.
3. Select the repository and keep the default Next.js settings.
4. Deploy – the included `vercel.json` already disables caching for API routes.

## Notes

- Measurements rely on HTTP and fetch streaming APIs, so results may differ from ICMP-based utilities.
- Upload testing depends on browsers that support streaming request bodies (Chrome 105+, Edge 105+, etc.).
- Adjust the duration selector to balance accuracy and total runtime.
