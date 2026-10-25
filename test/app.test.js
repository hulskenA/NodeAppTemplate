// The app as the server runs it: started on a free port, called like nginx calls it.
// `npm test` runs every *.test.js file in this folder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });

/** Starts the app with these environment variables; resolves once it answers /health. */
async function start(env = {}, args = []) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js'), ...args], { env: { ...process.env, PORT: String(port), DEV: '', ...env }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${base}/health`)).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { child, base };
}

// What nginx adds after the sign-in.
const as = (user, groups) => ({ 'Remote-User': user, 'Remote-Name': user.toUpperCase(), 'Remote-Email': `${user}@example.com`, 'Remote-Groups': groups.join(',') });
const change = { 'X-Requested-By': 'app', 'Content-Type': 'application/json' };

let app; let pub;
before(async () => {
  app = await start({ APP_NAME: 'Test app' });
  pub = await start({ SIGNIN: 'none' });
});
after(() => { app.child.kill(); pub.child.kill(); });

test('health answers without a sign-in', async () => {
  const r = await fetch(`${app.base}/health`);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'ok\n');
});

test('behind the sign-in: who is signed in, and nothing without it', async () => {
  let r = await fetch(`${app.base}/api/me`, { headers: as('lea', ['friends', 'qa']) });
  const me = await r.json();
  assert.equal(me.app, 'Test app');
  assert.deepEqual(me.me, { user: 'lea', name: 'LEA', email: 'lea@example.com', groups: ['friends', 'qa'] });
  r = await fetch(`${app.base}/`);
  assert.equal(r.status, 401, 'pages need the sign-in');
  r = await fetch(`${app.base}/`, { headers: as('lea', []) });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  r = await fetch(`${app.base}/api/messages`);
  assert.equal(r.status, 401);
});

test('posting needs the app\'s own header; deleting needs the admins group', async () => {
  let r = await fetch(`${app.base}/api/messages`, { method: 'POST', headers: { ...as('lea', []), 'Content-Type': 'application/json' }, body: '{"text":"hi"}' });
  assert.equal(r.status, 403, 'a request from another site is refused');
  r = await fetch(`${app.base}/api/messages`, { method: 'POST', headers: { ...as('lea', []), ...change, Origin: 'https://evil.example' }, body: '{"text":"hi"}' });
  assert.equal(r.status, 403, 'a foreign Origin is refused');
  r = await fetch(`${app.base}/api/messages`, { method: 'POST', headers: { ...as('lea', []), ...change }, body: '{"text":"  "}' });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).message, 'Write something first.');
  r = await fetch(`${app.base}/api/messages`, { method: 'POST', headers: { ...as('lea', []), ...change }, body: '{"text":"Hello <b>"}' });
  const { item } = await r.json();
  assert.equal(item.by, 'LEA');
  r = await fetch(`${app.base}/api/messages/${item.id}`, { method: 'DELETE', headers: { ...as('lea', ['friends']), ...change } });
  assert.equal(r.status, 403);
  r = await fetch(`${app.base}/api/messages/${item.id}`, { method: 'DELETE', headers: { ...as('marc', ['admins']), ...change } });
  assert.equal(r.status, 200);
  r = await fetch(`${app.base}/api/messages`, { method: 'PUT', headers: { ...as('marc', ['admins']), ...change } });
  assert.equal(r.status, 405);
  r = await fetch(`${app.base}/api/nothing`, { headers: as('marc', []) });
  assert.equal(r.status, 404);
});

test('a public app never believes the sign-in headers', async () => {
  let r = await fetch(`${pub.base}/api/me`, { headers: as('forged', ['admins']) });
  assert.equal((await r.json()).me, null);
  r = await fetch(`${pub.base}/`);
  assert.equal(r.status, 200, 'pages open without a sign-in');
  r = await fetch(`${pub.base}/api/messages`, { method: 'POST', headers: { ...as('forged', ['admins']), ...change }, body: '{"text":"hi"}' });
  const { item } = await r.json();
  assert.equal(item.by, 'Anonymous', 'posts are anonymous, whatever the headers say');
  r = await fetch(`${pub.base}/api/messages/${item.id}`, { method: 'DELETE', headers: { ...as('forged', ['admins']), ...change } });
  assert.equal(r.status, 401, 'a forged admin cannot delete');
});

test('a public app: anyone reads and posts, within a limit', async () => {
  let r = await fetch(`${pub.base}/api/me`);
  const me = await r.json();
  assert.equal(me.signin, 'none');
  assert.equal(me.signOut, null);
  r = await fetch(`${pub.base}/api/messages`);
  assert.equal(r.status, 200, 'reading needs no sign-in');
  r = await fetch(`${pub.base}/api/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"text":"hi"}' });
  assert.equal(r.status, 403, 'changes still need the app\'s own header');
  let status = 200;
  for (let i = 0; i < 25 && status === 200; i++) {
    r = await fetch(`${pub.base}/api/messages`, { method: 'POST', headers: change, body: '{"text":"spam"}' });
    status = r.status;
  }
  assert.equal(status, 429, 'posting is capped');
});

test('dev mode with SIGNIN=none runs as the public app', async () => {
  const dev = await start({ SIGNIN: 'none' }, ['--dev']);
  try {
    assert.equal((await (await fetch(`${dev.base}/api/me`)).json()).me, null);
  } finally { dev.child.kill(); }
});

test('dev mode cannot be switched on by a variable, nor on the server', async () => {
  for (const [env, args] of [[{ DEV: '1' }, []], [{ NODE_ENV: 'production' }, ['--dev']]]) {
    const app = await start({ SIGNIN: 'required', ...env }, args);
    try {
      assert.equal((await fetch(`${app.base}/api/me`, { headers: { 'Remote-User': 'ann', 'Remote-Groups': 'friends' } }).then((r) => r.json())).me.user, 'ann');
    } finally { app.child.kill(); }
  }
});

test('a malformed address gets a plain answer, not a crash', async () => {
  const app = await start({ SIGNIN: 'none' });
  try { assert.ok([400, 404].includes((await fetch(`${app.base}/%`)).status)); } finally { app.child.kill(); }
});

test('dev mode signs in a fake user, with the groups asked for', async () => {
  const dev = await start({ DEV_USER: 'sam', DEV_GROUPS: 'devs,qa' }, ['--dev']);
  try {
    const me = (await (await fetch(`${dev.base}/api/me`)).json()).me;
    assert.equal(me.user, 'sam');
    assert.deepEqual(me.groups, ['devs', 'qa']);
  } finally { dev.child.kill(); }
});

test('Hub: the app offers its widget to the person asking', async () => {
  let r = await fetch(`${app.base}/hub`);
  assert.equal(r.status, 401, 'only behind the sign-in');
  r = await fetch(`${app.base}/hub`, { headers: as('lea', ['friends']) });
  const offer = await r.json();
  assert.equal(offer.hub, 1);
  assert.equal(offer.name, 'Test app');
  assert.deepEqual(offer.widgets.map((w) => w.id), ['latest']);
  assert.deepEqual(offer.widgets[0].settings[0].options, ['Everyone\'s', 'Mine']);
});

test('Hub: a widget is built for the viewer, and its button acts as them', async () => {
  let r = await fetch(`${app.base}/hub/widgets/latest/actions/hello`, { method: 'POST', headers: { ...as('zoe', []), 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403, 'buttons need the header Hub sends');
  r = await fetch(`${app.base}/hub/widgets/latest/actions/hello`, { method: 'POST', headers: { ...as('zoe', []), 'X-Requested-By': 'hub', 'Content-Type': 'application/json' }, body: '{}' });
  assert.deepEqual(await r.json(), { ok: true, message: 'Posted.' });
  r = await fetch(`${app.base}/hub/widgets/latest?size=tall&show=Mine`, { headers: as('zoe', []) });
  const mine = await r.json();
  assert.ok(mine.blocks[0].items.length >= 1);
  assert.ok(mine.blocks[0].items.every((i) => i.meta === 'ZOE'), 'Mine: only the viewer\'s messages');
  r = await fetch(`${app.base}/hub/widgets/nope`, { headers: as('zoe', []) });
  assert.equal(r.status, 404);
  r = await fetch(`${app.base}/hub/widgets/latest/actions/nope`, { method: 'POST', headers: { ...as('zoe', []), 'X-Requested-By': 'hub' } });
  assert.equal(r.status, 404);
});

test('Hub: a public app offers no widget', async () => {
  const r = await fetch(`${pub.base}/hub`, { headers: as('forged', ['admins']) });
  assert.equal(r.status, 404);
});
