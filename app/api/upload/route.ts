export const runtime = 'edge';
export const preferredRegion = ['sin1'];
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const server = searchParams.get('server') ?? 'sin';
  let total = 0;

  if (request.body) {
    const reader = request.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        total += value.byteLength;
      }
    }
  }

  return new Response(
    JSON.stringify({ bytes: total, receivedAt: Date.now() }),
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
