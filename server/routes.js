// The app's own API: this is the file to grow. Each route gets the request, the answer and the
// URL, and returns a value (sent as JSON) or throws an HttpError. The example below is a small
// message board, kept in memory so the template needs nothing else: replace it.
import { readJson, rateLimit, HttpError } from './http.js';
import { who, requireUser, requireGroup, signOutUrl } from './auth.js';
import { APP_NAME, SIGNIN } from './config.js';
import { hubRoutes } from './hub.js';

const messages = []; // { id, text, by, at } — gone at each restart; use a database or a file for real data.
let nextId = 1;

// On a public app anyone may read and post, as "Anonymous". With no account to answer for it,
// posting is capped for the whole app so a script cannot flood the board.
const PUBLIC = SIGNIN === 'none';
const postLimit = rateLimit(20, 60_000);

// What the app shows on Hub, the server's home page (server/hub.js has the format): one widget,
// built for the person asking, with a button that does what the page's own button does. Replace
// it with your app's, or leave `widgets` empty for no widget. Hub only knows who is asking behind
// the sign-in: a public app (SIGNIN: none) offers no widget.
const widgets = {
  name: APP_NAME,
  icon: 'forum',
  summary: 'An example message board.',
  widgets: {
    latest: {
      title: 'Latest messages',
      description: 'The newest messages on the board, and a button to say hello.',
      sizes: ['small', 'wide', 'tall'],
      settings: [{ id: 'show', label: 'Show', options: ['Everyone\'s', 'Mine'] }],
      content(me, { size, settings }) {
        const list = messages.filter((m) => settings.show !== 'Mine' || m.by === me.name).slice().reverse();
        return {
          footer: `${messages.length} on the board`,
          refresh: 60,
          blocks: [
            { type: 'list', empty: 'No message yet.', items: list.slice(0, size === 'tall' ? 8 : 3).map((m) => ({ text: m.text, meta: m.by })) },
            { type: 'buttons', buttons: [{ label: 'Say hello', icon: 'waving_hand', action: { id: 'hello' } }] },
          ],
        };
      },
      actions: {
        hello(me) {
          messages.push({ id: nextId++, text: 'Hello from Hub', by: me.name, at: Date.now() });
          if (messages.length > 500) messages.shift();
          return { message: 'Posted.' };
        },
      },
    },
  },
};

/** [method, path (a string, or a RegExp whose groups become params), handler] */
export const routes = [
  // Who is signed in, for the page's header.
  ['GET', '/api/me', (req) => ({ app: APP_NAME, signin: SIGNIN, me: who(req), signOut: signOutUrl(req) })],

  ['GET', '/api/messages', (req) => {
    if (!PUBLIC) requireUser(req);
    return { messages: messages.slice(-50).reverse() };
  }],

  ['POST', '/api/messages', async (req) => {
    const me = PUBLIC ? { name: 'Anonymous' } : requireUser(req);
    if (PUBLIC) postLimit();
    const body = await readJson(req);
    const text = String(body.text ?? '').trim();
    if (!text) throw new HttpError(400, 'Write something first.');
    if (text.length > 500) throw new HttpError(400, 'Keep it under 500 characters.');
    const m = { id: nextId++, text, by: me.name, at: Date.now() };
    messages.push(m);
    if (messages.length > 500) messages.shift();
    return { ok: true, message: 'Posted.', item: m };
  }],

  // Deleting is for the admins group only: requireGroup refuses everyone else with a 403 (with a
  // 401 on a public app, where nobody is signed in).
  ['DELETE', /^\/api\/messages\/(\d+)$/, (req, res, url, [id]) => {
    requireGroup(req, 'admins');
    const i = messages.findIndex((m) => m.id === Number(id));
    if (i < 0) throw new HttpError(404, 'No such message.');
    messages.splice(i, 1);
    return { ok: true, message: 'Deleted.' };
  }],

  // Hub's three requests: /hub, /hub/widgets/<id>, /hub/widgets/<id>/actions/<action>.
  ...(PUBLIC ? [] : hubRoutes(widgets)),
];
