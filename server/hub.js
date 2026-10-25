// Widgets on Hub, the server's home page: what this app shows on the board of the people who
// can open it. Hub asks the app on 127.0.0.1 with the viewer's own sign-in headers, so each
// widget is built for the person asking, with the same rights as on the app's pages.
// The format is in ObjimoHub's WIDGETS.md; this file answers its three requests:
//   GET  /hub                                  what the app offers
//   GET  /hub/widgets/<id>?size=…&<setting>=…   one widget's content
//   POST /hub/widgets/<id>/actions/<action>    a button pressed in a widget
//
// Describe the widgets in server/routes.js (`widgets`). No widgets: leave its list empty, and Hub
// shows the app's tile only.
import { readJson, HttpError } from './http.js';
import { requireUser } from './auth.js';

const SIZES = ['small', 'wide', 'tall'];
const ID = /^[a-z0-9][a-z0-9_-]{0,40}$/;

/** A widget's settings: a list, or a function returning one when the options change (a list of games). */
const settingsList = (w) => (typeof w.settings === 'function' ? w.settings() : w.settings) || [];

/** Whether this person may use this widget: `groups` limits it, like requireGroup. */
const allowed = (w, me) => !w.groups || w.groups.some((g) => me.groups.includes(g));

/** The settings asked for, each one of its options (the first when missing or unknown). */
function settingsOf(w, params) {
  const out = {};
  for (const s of settingsList(w)) {
    const v = params.get(s.id);
    out[s.id] = s.options.includes(v) ? v : s.options[0];
  }
  return out;
}

function widgetOf(def, id, me) {
  const w = Object.hasOwn(def.widgets, id) ? def.widgets[id] : null;
  if (!w) throw new HttpError(404, 'No such widget.');
  if (!allowed(w, me)) throw new HttpError(403, 'This widget is for another group.');
  return w;
}

/**
 * The routes for server/routes.js: `...hubRoutes(widgets)`. `def` is
 * { name, icon, summary, widgets: { <id>: { title, description, sizes, settings (a list, or a function returning one), groups,
 *   content(me, { size, settings }), actions: { <id>(me, arg, { size, settings }) } } } }.
 */
export function hubRoutes(def) {
  for (const [id, w] of Object.entries(def.widgets)) {
    if (!ID.test(id)) throw new Error(`widget id "${id}": lower case letters, digits, - and _ only`);
    if (!w.sizes?.length || w.sizes.some((s) => !SIZES.includes(s))) throw new Error(`widget ${id}: sizes are small, wide or tall`);
    if (typeof w.content !== 'function') throw new Error(`widget ${id}: content(me, { size, settings }) is missing`);
  }
  return [
    ['GET', '/hub', (req) => {
      const me = requireUser(req);
      return {
        hub: 1, name: def.name, icon: def.icon, summary: def.summary,
        widgets: Object.entries(def.widgets).filter(([, w]) => allowed(w, me)).map(([id, w]) => ({
          id, title: w.title, description: w.description || '', sizes: w.sizes,
          settings: settingsList(w).map(({ id: sid, label, options }) => ({ id: sid, label, options })),
        })),
      };
    }],

    ['GET', /^\/hub\/widgets\/([a-z0-9_-]{1,41})$/, async (req, res, url, [id]) => {
      const me = requireUser(req);
      const w = widgetOf(def, id, me);
      const size = w.sizes.includes(url.searchParams.get('size')) ? url.searchParams.get('size') : w.sizes[0];
      return w.content(me, { size, settings: settingsOf(w, url.searchParams) });
    }],

    ['POST', /^\/hub\/widgets\/([a-z0-9_-]{1,41})\/actions\/([a-z0-9_-]{1,41})$/, async (req, res, url, [id, action]) => {
      const me = requireUser(req);
      const w = widgetOf(def, id, me);
      const run = w.actions && Object.hasOwn(w.actions, action) ? w.actions[action] : null;
      if (!run) throw new HttpError(404, 'No such action.');
      const body = await readJson(req, 4096);
      const params = new URLSearchParams(Object.entries(body.settings && typeof body.settings === 'object' ? body.settings : {}).map(([k, v]) => [k, String(v)]));
      const r = await run(me, typeof body.arg === 'string' ? body.arg : null, { size: body.size, settings: settingsOf(w, params) });
      return { ok: true, message: r?.message || 'Done.' };
    }],
  ];
}
