// Small HTTP helpers: answers, JSON bodies, the same-origin check for changes, static files.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT } from './config.js';

const PUBLIC = path.join(ROOT, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

// Sent with every answer. Fonts and their stylesheet come from Google Fonts; everything else
// from the app itself. Add a host here before loading anything from elsewhere.
export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; style-src-attr 'unsafe-inline'; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

export function send(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, ...SECURITY_HEADERS, ...extra });
  res.end(body);
}

export function json(res, status, body) {
  send(res, status, JSON.stringify(body), 'application/json', { 'Cache-Control': 'no-store' });
}

/** An error the routes can throw: answered with its status and message. */
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/**
 * At most `limit` calls per `ms` milliseconds, counted for the whole app (behind nginx every
 * request comes from 127.0.0.1, so there is no visitor to count by). Call the returned function
 * in a route: past the limit it throws a 429. Meant for what anyone can do on a public app.
 */
export function rateLimit(limit, ms) {
  const times = [];
  return () => {
    const now = Date.now();
    while (times.length && now - times[0] >= ms) times.shift();
    if (times.length >= limit) throw new HttpError(429, 'Too many requests for now. Try again in a minute.');
    times.push(now);
  };
}

/** A JSON object from the request body, at most `limit` bytes. */
export function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'The request is too large.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try {
        const v = JSON.parse(text);
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
      } catch { reject(new HttpError(400, 'The request is not valid JSON.')); }
    });
    req.on('error', reject);
  });
}

/**
 * Changes (POST, PUT, DELETE) must come from the app's own pages: they send the header
 * X-Requested-By (public/common.js does), which another site cannot send without a CORS
 * preflight this app never answers, and the Origin, when present, must be this host.
 */
export function sameOrigin(req) {
  if (!req.headers['x-requested-by']) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

/** A file from public/, with an ETag so browsers check cheaply and never run stale scripts. */
export async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return false;
  let data;
  try { data = await fs.readFile(file); } catch { return false; }
  const type = TYPES[path.extname(file)] || 'application/octet-stream';
  const etag = `"${crypto.createHash('sha1').update(data).digest('base64url').slice(0, 16)}"`;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' }); res.end(); return true; }
  send(res, 200, req.method === 'HEAD' ? '' : data, type, { 'Cache-Control': 'no-cache', ETag: etag });
  return true;
}
