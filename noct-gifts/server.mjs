import http from 'node:http';
import https from 'node:https';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const STATIC_FILES = new Set([
  '/index.html', '/Noct Gifts App.dc.html',
  '/motion.css', '/effects.js', '/account-bridge.js', '/support.js',
]);
const API_ROUTES = new Set(['/api/noct-gifts/account', '/api/noct-gifts/topup', '/api/noct-gifts/case', '/api/noct-gifts/upgrade']);
const LOCAL_ASSET_EXTENSIONS = new Set(['.png', '.svg', '.webp', '.json', '.js']);
const REMOTE_ASSET_EXTENSIONS = new Set(['.png', '.svg', '.webp', '.json', '.tgs']);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.tgs': 'application/x-tgsticker',
};

class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function sendError(res, status, message) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-store',
  });
  res.end(JSON.stringify({ error: message }));
}

function pathnameOf(target) {
  // Validate before URL normalization: dot segments must never become a public route.
  // Reject control bytes before URL normalization and filesystem access.
  // eslint-disable-next-line no-control-regex
  if (!target?.startsWith('/') || target.startsWith('//') || /[\u0000-\u0020\u007f\\]/.test(target)) return null;
  let pathname;
  try { pathname = decodeURIComponent(target.split('?')[0]); } catch { return null; }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\%:#]/.test(pathname)) return null;
  if (pathname === '/') return pathname;
  const segments = pathname.slice(1).split('/');
  if (segments.some((segment) => !segment || segment.startsWith('.') || /[. ]$/.test(segment))) return null;
  return pathname;
}

function safeAssetPath(pathname, prefix, extensions) {
  if (!pathname.startsWith(prefix)) return false;
  const segments = pathname.slice(prefix.length).split('/');
  if (segments.some((segment) => !/^[a-zA-Z0-9][a-zA-Z0-9_. -]*$/.test(segment)
    || /^(?:env|scripts?|tests?|source|src|db|node_modules)$/i.test(segment)
    || /(?:^|\.)(?:test|spec)\./i.test(segment))) return false;
  return extensions.has(path.posix.extname(pathname).toLowerCase());
}

function staticPathAllowed(pathname) {
  return STATIC_FILES.has(pathname) || safeAssetPath(pathname, '/assets/', LOCAL_ASSET_EXTENSIONS);
}

function normalizedOrigin(value, label = 'NOCTGRAM_API_ORIGIN') {
  let origin;
  try { origin = new URL(value); }
  catch { throw new TypeError(label + ' must be an HTTP(S) origin.'); }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password
    || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new TypeError(label + ' must be an HTTP(S) origin.');
  }
  return origin.origin;
}

function localHostAllowed(req, server, configuredHost, publicOrigin) {
  if (publicOrigin && req.headers.host?.toLowerCase() === new URL(publicOrigin).host.toLowerCase()) return true;
  let local;
  try { local = new URL('http://' + req.headers.host); } catch { return false; }
  if (local.username || local.password || local.pathname !== '/' || local.search || local.hash
    || local.host.toLowerCase() !== req.headers.host?.toLowerCase()) return false;
  const allowed = new Set(['localhost', '127.0.0.1', '[::1]', configuredHost.toLowerCase()]);
  const address = server.address();
  return typeof address === 'object' && address !== null
    && Number(local.port || 80) === address.port && allowed.has(local.hostname.toLowerCase());
}

function sameOrigin(req, publicOrigin) {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || origin === 'null') return false;
  const expectedOrigin = publicOrigin && req.headers.host?.toLowerCase() === new URL(publicOrigin).host.toLowerCase()
    ? publicOrigin : new URL('http://' + req.headers.host).origin;
  try { return new URL(origin).origin === origin && origin === expectedOrigin; }
  catch { return false; }
}

function readJsonBody(req, limit, timeoutMs) {
  return new Promise((resolve, reject) => {
    const length = req.headers['content-length'];
    if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > limit)) {
      req.resume();
      reject(new RequestError(413, 'Request is too large.'));
      return;
    }
    let size = 0, complete = false;
    const chunks = [];
    const finish = (error, value) => {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      req.off('data', onData); req.off('end', onEnd); req.off('aborted', onAborted); req.off('error', onError);
      if (error) { req.resume(); reject(error); } else resolve(value);
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > limit) finish(new RequestError(413, 'Request is too large.'));
      else chunks.push(chunk);
    };
    const onEnd = () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        const value = JSON.parse(body);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
        finish(null, Buffer.from(JSON.stringify(value)));
      } catch { finish(new RequestError(400, 'A JSON object is required.')); }
    };
    const onAborted = () => finish(new RequestError(400, 'Request was interrupted.'));
    const onError = () => finish(new RequestError(400, 'Request was interrupted.'));
    const timer = setTimeout(() => finish(new RequestError(408, 'Request timed out.')), timeoutMs);
    req.on('data', onData); req.once('end', onEnd); req.once('aborted', onAborted); req.once('error', onError);
  });
}

function upstreamRequest(origin, pathname, { method, body, timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, origin);
    const transport = url.protocol === 'https:' ? https : http;
    const headers = { Accept: body ? 'application/json' : '*/*' };
    if (body) Object.assign(headers, {
      'Content-Type': 'application/json', 'Content-Length': body.length, Origin: origin,
    });
    let completed = false;
    const finish = (error, value) => {
      if (completed) return;
      completed = true; clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const upstream = transport.request(url, { method, headers }, (response) => {
      const chunks = []; let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          finish(new RequestError(502, 'NoctGram is temporarily unavailable.'));
          upstream.destroy(); response.destroy();
        } else chunks.push(chunk);
      });
      response.once('end', () => finish(null, {
        status: response.statusCode || 502,
        contentType: response.headers['content-type'] || '',
        body: Buffer.concat(chunks),
      }));
      response.once('error', () => finish(new RequestError(502, 'NoctGram is temporarily unavailable.')));
      response.once('aborted', () => finish(new RequestError(502, 'NoctGram is temporarily unavailable.')));
    });
    const timer = setTimeout(() => {
      finish(new RequestError(504, 'NoctGram request timed out.'));
      upstream.destroy();
    }, timeoutMs);
    upstream.once('error', () => finish(new RequestError(502, 'NoctGram is temporarily unavailable.')));
    upstream.end(body);
  });
}

export function createNoctGiftsServer({
  rootDir = DEFAULT_ROOT,
  upstreamOrigin = process.env.NOCTGRAM_API_ORIGIN || 'https://noctgram.com',
  publicOrigin = process.env.PUBLIC_ORIGIN || null,
  host = process.env.HOST || '127.0.0.1',
  maxBodyBytes = 32768,
  bodyTimeoutMs = 5000,
  upstreamTimeoutMs = 8000,
} = {}) {
  const origin = normalizedOrigin(upstreamOrigin);
  const publicSite = publicOrigin ? normalizedOrigin(publicOrigin, 'PUBLIC_ORIGIN') : null;
  if (publicSite && !publicSite.startsWith('https://')) throw new TypeError('PUBLIC_ORIGIN must use HTTPS.');
  const root = path.resolve(rootDir);
  const server = http.createServer({ maxHeaderSize: 16384 }, async (req, res) => {
    // An interrupted browser upload must not leave an unhandled stream error.
    req.on('error', () => {});
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    try {
      if (!localHostAllowed(req, server, host, publicSite)) throw new RequestError(403, 'Host is not allowed.');
      const pathname = pathnameOf(req.url);
      if (!pathname) throw new RequestError(404, 'Not found.');
      if (pathname.startsWith('/api/')) {
        if (!API_ROUTES.has(pathname) || req.url.includes('?')) throw new RequestError(404, 'Not found.');
        res.setHeader('Cache-Control', 'private, no-store');
        if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); throw new RequestError(405, 'Method is not allowed.'); }
        if (!sameOrigin(req, publicSite)) throw new RequestError(403, 'Same-origin requests are required.');
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')
          || (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')) {
          throw new RequestError(415, 'JSON content is required.');
        }
        const body = await readJsonBody(req, maxBodyBytes, bodyTimeoutMs);
        const result = await upstreamRequest(origin, pathname, {
          method: 'POST', body, timeoutMs: upstreamTimeoutMs, maxBytes: 1024 * 1024,
        });
        if (result.status < 200 || result.status >= 300) {
          const status = result.status >= 400 && result.status < 500 ? result.status : 502;
          throw new RequestError(status, status === 429 ? 'Too many requests. Please try again later.' : 'NoctGram could not complete this request.');
        }
        if (!/^application\/json(?:\s*;|$)/i.test(result.contentType)) throw new RequestError(502, 'NoctGram returned an invalid response.');
        let data;
        try { data = JSON.stringify(JSON.parse(result.body.toString('utf8'))); }
        catch { throw new RequestError(502, 'NoctGram returned an invalid response.'); }
        res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(data);
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); throw new RequestError(405, 'Method is not allowed.'); }
      if (pathname.startsWith('/noctgram-assets/')) {
        if (!safeAssetPath(pathname, '/noctgram-assets/', REMOTE_ASSET_EXTENSIONS) || req.url.includes('?')) throw new RequestError(404, 'Not found.');
        const upstreamPath = '/assets/' + pathname.slice('/noctgram-assets/'.length).split('/').map(encodeURIComponent).join('/');
        const result = await upstreamRequest(origin, upstreamPath, {
          method: req.method, timeoutMs: upstreamTimeoutMs, maxBytes: 16 * 1024 * 1024,
        });
        if (result.status !== 200) throw new RequestError(result.status === 404 ? 404 : 502, 'Asset is unavailable.');
        res.writeHead(200, { 'Content-Type': MIME[path.posix.extname(pathname).toLowerCase()], 'Cache-Control': 'public, max-age=3600' });
        res.end(req.method === 'HEAD' ? undefined : result.body);
        return;
      }
      const publicPath = pathname === '/' ? '/index.html' : pathname;
      if (!staticPathAllowed(publicPath)) throw new RequestError(404, 'Not found.');
      let content;
      try {
        const actualRoot = await realpath(root);
        const candidate = path.resolve(actualRoot, '.' + publicPath);
        const actualFile = await realpath(candidate);
        const equalPath = process.platform === 'win32'
          ? actualFile.toLowerCase() === candidate.toLowerCase() : actualFile === candidate;
        if (!equalPath || !(await stat(actualFile)).isFile()) throw new Error();
        if (req.method !== 'HEAD') content = await readFile(actualFile);
      } catch { throw new RequestError(404, 'Not found.'); }
      res.writeHead(200, { 'Content-Type': MIME[path.posix.extname(publicPath).toLowerCase()], 'Cache-Control': 'no-cache' });
      res.end(content);
    } catch (error) {
      if (error instanceof RequestError) {
        if ([408, 413].includes(error.status)) res.setHeader('Connection', 'close');
        sendError(res, error.status, error.message);
      } else sendError(res, 500, 'Request could not be completed.');
    }
  });
  server.requestTimeout = bodyTimeoutMs + upstreamTimeoutMs + 1000;
  server.headersTimeout = Math.min(server.requestTimeout, 10000);
  server.keepAliveTimeout = 1000;
  return server;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT || 4186);
  const host = process.env.HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('PORT must be a valid port number.');
  const server = createNoctGiftsServer({ host });
  server.listen(port, host, () => {
    console.log(`Noct Gifts is available on http://${host}:${server.address().port}`);
  });
}
