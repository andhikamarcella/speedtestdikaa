export const runtime = 'edge';
export const preferredRegion = ['sin1'];
export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  const { searchParams } = new URL(request.url);
  const server = searchParams.get('server') ?? 'sin';

  return new Response(
    JSON.stringify({ now: Date.now() }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Speedtest-Server': server
      }
    }
  );
}

export function HEAD(request: Request): Response {
  const { searchParams } = new URL(request.url);
  const server = searchParams.get('server') ?? 'sin';

  return new Response(null, {
    status: 204,
    headers: {
      'Cache-Control': 'no-store',
      'X-Speedtest-Server': server
    }
  });
}
