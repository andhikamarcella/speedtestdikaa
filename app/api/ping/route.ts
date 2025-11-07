export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url);
  const server = searchParams.get('server') ?? 'auto';
  return new Response(null, {
    status: 204,
    headers: {
      'Cache-Control': 'no-store',
      Date: new Date().toUTCString(),
      'X-Speedtest-Server': server
    }
  });
}

export const HEAD = GET;
