export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> & { id: string } }) {
  const { id } = await ctx.params
  return Response.json({ id, sync: ctx.params.id })
}
export function DELETE() {
  return new Response(null, { status: 204 })
}
