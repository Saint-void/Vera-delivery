import { NextRequest } from 'next/server'

const VELLA_URL = (process.env.VELLA_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params
  const target = new URL(`${VELLA_URL}/${path.map(encodeURIComponent).join('/')}`)
  target.search = request.nextUrl.search

  try {
    const response = await fetch(target, {
      method: request.method,
      headers: request.headers.get('content-type') ? { 'Content-Type': request.headers.get('content-type')! } : undefined,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
      cache: 'no-store',
    })
    const contentType = response.headers.get('content-type') || 'application/json'
    if (contentType.startsWith('text/event-stream')) {
      return new Response(response.body, {
        status: response.status,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      })
    }
    const body = await response.arrayBuffer()
    return new Response(body, {
      status: response.status,
      headers: { 'Content-Type': contentType },
    })
  } catch {
    return Response.json({ detail: 'Vella is unavailable. Check that the Vella API is running.' }, { status: 503 })
  }
}

export const GET = proxy
export const POST = proxy
export const DELETE = proxy
