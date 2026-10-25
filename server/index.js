// The app's server: health check, API routes (server/routes.js), static pages (public/).
// What Control Center expects of it: listen on 127.0.0.1 and the port in PORT, answer 200 on
// /health, write its log to stdout and stderr, and stop cleanly on SIGTERM.
import http from 'node:http';
import { PORT, HOST, DEV, APP_NAME, SIGNIN } from './config.js';
import { send, json, sameOrigin, serveStatic, HttpError } from './http.js';
import { who } from './auth.js';
import { routes } from './routes.js';

const CHANGES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function match(method, pathname) {
  for (const [m, p, handler] of routes) {
    if (m !== method) continue;
    if (typeof p === 'string' && p === pathname) return { handler, params: [] };
    if (p instanceof RegExp) { const r = pathname.match(p); if (r) return { handler, params: r.slice(1) }; }
  }
  return null;
}

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://app');
  try {
    // Control Center checks this every 30 s. Keep it cheap; add checks of what the app needs
    // (a database, a disk) only if a failure there means the app is really down.
    if (url.pathname === '/health') return send(res, 200, 'ok\n', 'text/plain', { 'Cache-Control': 'no-store' });

    // The app's API, and Hub's requests for its widgets (server/hub.js), answered the same way.
    const isApi = url.pathname.startsWith('/api/') || url.pathname === '/hub' || url.pathname.startsWith('/hub/');
    if (isApi) {
      const found = match(req.method, url.pathname);
      if (!found) {
        const known = routes.some(([, p]) => (typeof p === 'string' ? p === url.pathname : p.test(url.pathname)));
        throw new HttpError(known ? 405 : 404, known ? 'Method not allowed.' : 'No such API route.');
      }
      if (CHANGES.has(req.method) && !sameOrigin(req)) throw new HttpError(403, 'Refused: this request did not come from the app itself.');
      const result = await found.handler(req, res, url, found.params);
      if (!res.headersSent) json(res, 200, result ?? { ok: true });
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed\n');
    // Behind the sign-in, every page needs an account: without one, the sign-in did not run.
    // A public app (access: public) has no sign-in in front: it must run with SIGNIN: none.
    if (SIGNIN === 'required' && !who(req)) return send(res, 401, 'Nobody is signed in. Open this app through its address, so the sign-in runs first.\nIf this app is public (access: public), set SIGNIN: none in its settings.\n');
    if (await serveStatic(req, res, url.pathname)) return;
    return send(res, 404, 'Not found\n');
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(`[${req.method} ${url.pathname}]`, err);
    if (res.headersSent) return res.end();
    const message = status === 500 ? 'Something went wrong on the server. Its log has the details.' : err.message;
    return url.pathname.startsWith('/api/') || url.pathname.startsWith('/hub') ? json(res, status, { ok: false, message }) : send(res, status, `${message}\n`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`${APP_NAME} listening on http://${HOST}:${PORT}${SIGNIN === 'none' ? ' (public: no sign-in)' : DEV ? ' (dev: signed in as a fake user)' : ''}`);
});

// PM2 sends SIGINT on reload and stop, systemd SIGTERM: finish the requests under way, then go.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`${APP_NAME} stopping (${sig})`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
