// Route handler: served by `vuecli dev` / `vuecli start` (ignored by the terminal router).
export function GET(request: Request) {
  return Response.json({ hello: 'world', url: request.url })
}
