import { getQuotes } from '../../../lib/quotes.ts'

export async function GET() {
  return Response.json(await getQuotes())
}
