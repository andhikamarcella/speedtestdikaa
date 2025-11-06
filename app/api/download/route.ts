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

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (performance.now() >= endAt) {
        controller.close();
        return;
      }
      const chunk = new Uint8Array(chunkSize);
      crypto.getRandomValues(chunk);
      controller.enqueue(chunk);
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-store'
    }
  });
}
