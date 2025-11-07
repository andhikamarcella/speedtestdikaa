export const dynamic = 'force-dynamic';

function parsePositiveNumber(value: string | null, fallback: number) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const seconds = parsePositiveNumber(searchParams.get('seconds'), 10);
  const chunkSize = Math.max(1024, parsePositiveNumber(searchParams.get('chunk'), 65536));

  const startTime = performance.now();
  const endAt = startTime + seconds * 1000;
  let closed = false;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      timeout = setTimeout(() => {
        if (closed) return;
        closed = true;
        controller.close();
      }, seconds * 1000);
    },
    pull(controller) {
      if (closed) {
        return;
      }

      if (performance.now() >= endAt) {
        closed = true;
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        controller.close();
        return;
      }

      const chunk = new Uint8Array(chunkSize);
      crypto.getRandomValues(chunk);
      controller.enqueue(chunk);
    },
    cancel() {
      closed = true;
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-store'
    }
  });
}
