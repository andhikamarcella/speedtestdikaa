# Speed Test Web (MVP)

A production-ready Internet speed test built with Node.js, Express, and vanilla JavaScript. It measures download and upload throughput, WebSocket latency, and HTTP latency to popular game services such as Roblox, Steam, and Valorant.

## Features

- **Download test**: Streams random bytes from the server with chunked responses (64 KB chunks) and reports average throughput in Mbps.
- **Upload test**: Generates random binary payloads in the browser and measures upload throughput to the server.
- **WebSocket ping**: Collects 20 echo round-trip samples over a single persistent WebSocket connection and reports min/avg/max/σ statistics.
- **HTTP latency**: Performs server-side `HEAD` requests (8 s timeout) to selectable endpoints (Roblox, Steam, Valorant, plus custom URLs) and presents sortable latency results.
- **Responsive UI**: Simple, accessible single-page interface with live result cards and persistent custom target list.

## Getting Started

```bash
npm install
npm start
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
/
├─ package.json
├─ server.mjs
└─ public/
   ├─ index.html
   └─ script.js
```

- `server.mjs` – Express server that serves static assets, exposes REST APIs for download/upload/HTTP ping, and hosts a WebSocket echo endpoint.
- `public/index.html` – Responsive UI with minimal inline styles and accessible controls.
- `public/script.js` – Client-side logic for running tests, rendering results, and managing WebSocket state.

## Notes

- Throughput measurements rely on HTTP streaming rather than ICMP. Actual ping times may differ from `ping`/`traceroute` due to protocol differences and CDN routing.
- Upload payloads are generated in-memory. Running large uploads consumes client RAM; stick to the built-in presets (2–50 MB) for most browsers.
- To add more game endpoints, use the "Add target" field in the UI. Custom targets persist locally via `localStorage`.
- The server caps download streams at 1 GB per request to protect against abuse.

## License

This project is released under the [MIT License](LICENSE).
