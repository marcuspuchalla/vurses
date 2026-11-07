export function GET(request: Request & { nextUrl: URL }) {
  return Response.json({ hello: request.nextUrl.searchParams.get('name') ?? 'world' })
}
export async function POST(request: Request) {
  return new Response(await request.text(), { status: 201, headers: { 'content-type': 'text/plain' } })
}
