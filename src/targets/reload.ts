/**
 * Dev live reload client: listens to the dev server's `/_vuecli/reload` SSE
 * endpoint and reloads the page when a new build id appears (the dev server
 * restarts on file changes; EventSource reconnects by itself).
 */
export function liveReload(url: string): () => void {
  const ES = (globalThis as any).EventSource
  if (!ES) return () => {}
  let id: string | null = null
  const es = new ES(url)
  es.addEventListener('hello', (e: MessageEvent) => {
    const next = JSON.parse(e.data).id as string
    if (id !== null && next !== id) location.reload()
    id = next
  })
  return () => es.close()
}
