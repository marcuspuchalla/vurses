import { revalidatePath, revalidateTag } from 'vuecli'

/** POST /api/revalidate?tag=quotes  or  ?path=/stats */
export function POST(request: Request) {
  const url = new URL(request.url)
  const tag = url.searchParams.get('tag')
  const path = url.searchParams.get('path')
  if (tag) revalidateTag(tag)
  if (path) revalidatePath(path)
  return Response.json({ revalidated: true, tag, path, now: Date.now() })
}
