const DEFAULT_SIZE_BYTES = 25 * 1024 * 1024;
const MAX_SIZE_BYTES = 100 * 1024 * 1024;
const CHUNK_SIZE_BYTES = 64 * 1024;

export const runtime = 'edge';
export const preferredRegion = ['sin1'];
export const dynamic = 'force-dynamic';

function parseSizeParam(value: string | null): number {
  if (!value) {
    return DEFAULT_SIZE_BYTES;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SIZE_BYTES;
  }
  return Math.min(MAX_SIZE_BYTES, Math.floor(parsed));
}

export function GET(request: Request): Response {
  const { searchParams } = new URL(request.url);
  const requestedSize = parseSizeParam(searchParams.get('size'));
  const server = searchParams.get('server') ?? 'sin';
  let transmitted = 0;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (transmitted >= requestedSize) {
        controller.close();
        return;
      }

      const remaining = requestedSize - transmitted;
      const chunkLength = Math.min(CHUNK_SIZE_BYTES, remaining);
      const chunk = new Uint8Array(chunkLength);
      crypto.getRandomValues(chunk);
      transmitted += chunkLength;
      controller.enqueue(chunk);
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Content-Length': String(requestedSize),
      'X-Speedtest-Server': server
    }
  });
}
