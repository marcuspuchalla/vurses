export async function GET() {
  return Response.json({ hello: 'world' })
}
export const POST = async (req: Request) => new Response(await req.text())
