export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const server = searchParams.get('server') ?? 'auto';
  let total = 0;

  if (!req.body) {
    return new Response(JSON.stringify({ bytes: 0 }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Speedtest-Server': server
      }
    });
  }

  const reader = req.body.getReader();

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    total += value?.byteLength ?? 0;
  }

  return new Response(JSON.stringify({ bytes: total }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Speedtest-Server': server
    }
  });
}
