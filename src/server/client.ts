/**
 * The network address a request came from. Fetch `Request`s don't carry it, so the
 * node adapter records it here; other runtimes leave it unknown (per-client limits
 * then fall back to the global ones).
 */
const addresses = new WeakMap<Request, string>()

export function setClientAddress(request: Request, address: string | undefined) {
  if (address) addresses.set(request, address)
}

export function clientAddress(request: Request): string | undefined {
  return addresses.get(request)
}
