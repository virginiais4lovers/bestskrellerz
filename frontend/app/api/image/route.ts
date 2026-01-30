import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');

  if (!url) {
    return new NextResponse('Missing url parameter', { status: 400 });
  }

  // Only allow proxying from trusted domains
  const allowedDomains = ['static01.nyt.com', 'storage.googleapis.com'];
  try {
    const parsedUrl = new URL(url);
    if (!allowedDomains.some(domain => parsedUrl.hostname.endsWith(domain))) {
      return new NextResponse('Domain not allowed', { status: 403 });
    }
  } catch {
    return new NextResponse('Invalid URL', { status: 400 });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; BestSkrellerz/1.0)',
      },
    });

    if (!response.ok) {
      return new NextResponse('Failed to fetch image', { status: response.status });
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = await response.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      },
    });
  } catch (error) {
    console.error('Image proxy error:', error);
    return new NextResponse('Failed to fetch image', { status: 500 });
  }
}
