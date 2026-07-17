export async function POST() {
  return new Response(null, {
    headers: { 'cache-control': 'no-store' },
    status: 204,
  });
}
