import { NextResponse } from 'next/server';
import {
  buildJellyfinProxyTargetUrl,
  getJellyfinApiKey,
  getProxiedJellyfinUrl,
  verifyProxiedJellyfinUrl,
} from '../../../../lib/jellyfin';

export const dynamic = 'force-dynamic';

const REQUEST_HEADER_ALLOWLIST = [
  'accept',
  'if-modified-since',
  'if-none-match',
  'if-range',
  'range',
];

const RESPONSE_HEADER_ALLOWLIST = [
  'accept-ranges',
  'content-disposition',
  'content-length',
  'content-range',
  'content-type',
  'etag',
  'last-modified',
];

function buildRelativePathname(pathSegments = []) {
  return `/${pathSegments.map(segment => encodeURIComponent(segment)).join('/')}`;
}

function isAllowedMediaPath(relativePathname) {
  return relativePathname.toLowerCase().startsWith('/videos/');
}

function isHlsPlaylist(targetUrl, upstreamResponse) {
  const contentType = upstreamResponse.headers.get('content-type') || '';

  return targetUrl.pathname.toLowerCase().endsWith('.m3u8')
    || contentType.includes('application/vnd.apple.mpegurl')
    || contentType.includes('application/x-mpegurl');
}

function buildUpstreamHeaders(request) {
  const headers = new Headers();
  const apiKey = getJellyfinApiKey();

  for (const name of REQUEST_HEADER_ALLOWLIST) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  headers.set('accept-encoding', 'identity');
  headers.set('X-Emby-Token', apiKey);
  headers.set('X-MediaBrowser-Token', apiKey);

  return headers;
}

function buildResponseHeaders(upstreamResponse, { rewrittenPlaylist = false } = {}) {
  const headers = new Headers();

  for (const name of RESPONSE_HEADER_ALLOWLIST) {
    if (rewrittenPlaylist && name === 'content-length') continue;

    const value = upstreamResponse.headers.get(name);
    if (value) headers.set(name, value);
  }

  if (rewrittenPlaylist && !headers.has('content-type')) {
    headers.set('content-type', 'application/vnd.apple.mpegurl; charset=utf-8');
  }

  if (!rewrittenPlaylist && !headers.has('accept-ranges')) {
    headers.set('accept-ranges', 'bytes');
  }

  headers.set('cache-control', 'no-store, max-age=0');

  return headers;
}

function rewritePlaylistUri(uri, upstreamUrl) {
  const trimmed = uri.trim();
  if (!trimmed) return uri;

  try {
    const resolved = new URL(trimmed, upstreamUrl);
    const proxied = getProxiedJellyfinUrl(resolved.toString());
    return uri.replace(trimmed, proxied);
  } catch {
    return uri;
  }
}

function rewritePlaylistLine(line, upstreamUrl) {
  const withRewrittenAttributes = line.replace(/URI="([^"]+)"/g, (match, uri) => {
    const rewritten = rewritePlaylistUri(uri, upstreamUrl);
    return `URI="${rewritten}"`;
  });

  if (!withRewrittenAttributes.trim() || withRewrittenAttributes.startsWith('#')) {
    return withRewrittenAttributes;
  }

  return rewritePlaylistUri(withRewrittenAttributes, upstreamUrl);
}

async function proxyJellyfin(request, params, method = 'GET') {
  try {
    const { path } = await params;
    const relativePathname = buildRelativePathname(path);

    if (!isAllowedMediaPath(relativePathname)) {
      return NextResponse.json({ error: 'Jellyfin proxy path is not allowed' }, { status: 403 });
    }

    const verification = verifyProxiedJellyfinUrl(relativePathname, request.nextUrl.searchParams);
    if (!verification.ok) {
      return NextResponse.json({ error: verification.error }, { status: verification.status });
    }

    const targetUrl = buildJellyfinProxyTargetUrl(relativePathname, request.nextUrl.searchParams);
    const upstreamResponse = await fetch(targetUrl, {
      method,
      headers: buildUpstreamHeaders(request),
      cache: 'no-store',
      signal: request.signal,
    });

    if (method === 'HEAD' || upstreamResponse.status === 204 || upstreamResponse.status === 304) {
      return new NextResponse(null, {
        status: upstreamResponse.status,
        headers: buildResponseHeaders(upstreamResponse),
      });
    }

    if (isHlsPlaylist(targetUrl, upstreamResponse)) {
      const playlist = await upstreamResponse.text();
      const rewrittenPlaylist = playlist
        .split(/\r?\n/)
        .map(line => rewritePlaylistLine(line, targetUrl))
        .join('\n');

      return new NextResponse(rewrittenPlaylist, {
        status: upstreamResponse.status,
        headers: buildResponseHeaders(upstreamResponse, { rewrittenPlaylist: true }),
      });
    }

    return new NextResponse(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: buildResponseHeaders(upstreamResponse),
    });
  } catch (error) {
    console.error('Jellyfin proxy error:', error);
    return NextResponse.json({ error: 'Jellyfin proxy error', detail: error.message }, { status: 500 });
  }
}

export async function GET(request, { params }) {
  return proxyJellyfin(request, params);
}

export async function HEAD(request, { params }) {
  return proxyJellyfin(request, params, 'HEAD');
}
