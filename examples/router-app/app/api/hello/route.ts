// Route handler: served by `vurses dev` / `vurses start` (ignored by the terminal router).
export function GET(request: Request) {
  return Response.json({ hello: 'world', url: request.url })
}
