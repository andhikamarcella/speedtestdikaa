export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      'Cache-Control': 'no-store',
      Date: new Date().toUTCString()
    }
  });
}

export const HEAD = GET;
