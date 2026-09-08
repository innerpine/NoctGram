import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const cookieName = '__sites_local_auth';
const route = '/__dev/accounts';
const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
const localPeers = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function localUrl(req: IncomingMessage, secure: boolean) {
  try {
    const origin = new URL(
      `${secure ? 'https' : 'http'}://${req.headers.host}`,
    );
    const url = new URL(req.url || '/', origin);
    if (
      !localHosts.has(origin.hostname.replace(/^\[|\]$/g, '')) ||
      !localPeers.has(req.socket.remoteAddress || '') ||
      url.origin !== origin.origin
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

function privateResponse(res: ServerResponse, status: number, body = '') {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'private, no-store');
  // HTML form navigation uses this policy for Origin too: no-referrer turns
  // same-origin POST into Origin: null, which the dev server correctly rejects.
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(body);
}

const page = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Тестовые аккаунты · Noctgram</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#080808;color:#eee;font:16px/1.6 system-ui,sans-serif;padding:24px}
main{width:min(100%,460px);padding:32px;border:1px solid #ffffff20;border-radius:26px;background:#111;box-shadow:0 32px 100px #0008;animation:enter .3s ease-out}
.brand{letter-spacing:.15em;text-transform:uppercase;font-size:13px;color:#adbfb5}h1{font-size:26px;line-height:1.25;margin:18px 0 12px}p{color:#aaa;margin:0 0 24px}form{display:grid;gap:12px}
button{font:inherit;text-align:left;background:#1b1b1b;color:#eee;border:1px solid #ffffff18;border-radius:16px;padding:16px 20px;cursor:pointer;transition:background .2s,transform .2s}button:hover{background:#262626;transform:translateY(-2px)}button:focus-visible{outline:2px solid #bddfce;outline-offset:4px}button strong,button span{display:block}button span{font-size:14px;color:#aaa;margin-top:3px}.friend{background:#dceae2;color:#101712}.friend:hover{background:#ecf8f0}.friend span{color:#46564e}footer{margin-top:24px;color:#888;font-size:14px}
@keyframes enter{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}@media(prefers-reduced-motion:reduce){main{animation:none}button{transition:none}}
</style></head><body><main><div class="brand">Noctgram · localhost</div>
<h1>Два аккаунта для проверки</h1>
<p>Оставь основной аккаунт в Codex. В другом браузере выбери «Тестовый друг» — вы сможете слушать общий плейлист.</p>
<form method="post" action="${route}">
<button class="friend" name="account" value="friend"><strong>Тестовый друг</strong><span>Второй участник на этом компьютере</span></button>
<button name="account" value="main"><strong>Основной аккаунт</strong><span>Твой существующий профиль разработчика</span></button>
</form><footer>Выбор действует только в этом браузере. Эти входы доступны только на локальном сервере разработки.</footer>
</main></body></html>`;

async function selectAccount(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  secure: boolean,
) {
  if (
    req.headers.origin !== url.origin ||
    req.headers['sec-fetch-site'] === 'cross-site'
  ) {
    privateResponse(res, 403);
    return;
  }
  if (
    req.headers['content-type']?.split(';')[0].trim() !==
    'application/x-www-form-urlencoded'
  ) {
    privateResponse(res, 415);
    return;
  }
  let body = '';
  for await (const chunk of req) {
    body += chunk.toString();
    if (body.length > 1024) {
      privateResponse(res, 413);
      return;
    }
  }
  const accounts = new URLSearchParams(body).getAll('account');
  if (accounts.length !== 1 || !['main', 'friend'].includes(accounts[0])) {
    privateResponse(res, 400);
    return;
  }
  const options = `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
  // Use the existing local cookie so the standard Sites sign-out also logs out
  // the friend. Clear only this browser's competing email session cookies.
  res.setHeader('Set-Cookie', [
    `${cookieName}=${accounts[0] === 'main' ? '1' : 'friend'}; ${options}`,
    `noct_session=; Max-Age=0; ${options}`,
    `noct_email_challenge=; Max-Age=0; ${options}`,
  ]);
  res.setHeader('Location', '/music?tab=playlists');
  privateResponse(res, 303);
}

function trustedHeader(req: IncomingMessage, name: string, value: string) {
  delete req.headers[name];
  for (let index = req.rawHeaders.length - 2; index >= 0; index -= 2) {
    if (req.rawHeaders[index].toLowerCase() === name)
      req.rawHeaders.splice(index, 2);
  }
  req.headers[name] = value;
  req.rawHeaders.push(name, value);
}

// These plugins run only in Vite dev. The production Worker has no test login.
// Capture before Sites removes its cookie, then identify after it has stripped
// all incoming authenticated-user headers. Never accept an arbitrary user ID.
export function localTestAccounts(sitesPlugin: Plugin): Plugin[] {
  const friends = new WeakSet<IncomingMessage>();
  return [
    {
      name: 'noctgram-local-account-choice',
      apply: 'serve',
      configureServer(server) {
        const secure = Boolean(server.config.server.https);
        server.middlewares.use((req, res, next) => {
          const url = localUrl(req, secure);
          const isAccountRoute = (req.url || '').split('?')[0] === route;
          if (!url) {
            if (isAccountRoute) privateResponse(res, 403);
            else next();
            return;
          }
          const cookies = (req.headers.cookie || '')
            .split(';')
            .map((v) => v.trim());
          const selected = cookies.filter((v) =>
            v.startsWith(cookieName + '='),
          );
          if (selected.length === 1 && selected[0] === cookieName + '=friend')
            friends.add(req);
          if (url.pathname !== route) {
            next();
            return;
          }
          const externalNavigation =
            req.method === 'GET' &&
            req.headers['sec-fetch-mode'] === 'navigate' &&
            req.headers['sec-fetch-dest'] === 'document';
          if (
            req.headers['sec-fetch-site'] === 'cross-site' &&
            !externalNavigation
          ) {
            privateResponse(res, 403);
          } else if (req.method === 'GET') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader(
              'Content-Security-Policy',
              "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
            );
            privateResponse(res, 200, page);
          } else if (req.method === 'POST') {
            void selectAccount(req, res, url, secure).catch(() => {
              if (!res.headersSent) privateResponse(res, 400);
            });
          } else {
            res.setHeader('Allow', 'GET, POST');
            privateResponse(res, 405);
          }
        });
      },
    },
    sitesPlugin,
    {
      name: 'noctgram-local-friend-identity',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (friends.delete(req)) {
            trustedHeader(
              req,
              'oai-authenticated-user-id',
              'local_music_friend',
            );
            trustedHeader(
              req,
              'oai-authenticated-user-email',
              'music-friend@sites.test',
            );
            trustedHeader(
              req,
              'oai-authenticated-user-full-name',
              encodeURIComponent('Тестовый друг'),
            );
            trustedHeader(
              req,
              'oai-authenticated-user-full-name-encoding',
              'percent-encoded-utf-8',
            );
          }
          next();
        });
      },
    },
  ];
}
