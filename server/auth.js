// Who is asking. The sign-in (Authelia) checks every request before nginx passes it on, then
// nginx adds the account in Remote-User, its groups in Remote-Groups, its name and email. The
// app only listens on 127.0.0.1, so nothing reaches it without going through nginx.
import { DEV, DEV_USER, DEV_GROUPS, SIGNIN, SIGNIN_URL } from './config.js';
import { HttpError } from './http.js';

/** { user, name, email, groups } or null when nobody is signed in. */
export function who(req) {
  if (SIGNIN === 'none') return null;
  if (DEV) return { user: DEV_USER, name: DEV_USER.charAt(0).toUpperCase() + DEV_USER.slice(1), email: `${DEV_USER}@example.com`, groups: DEV_GROUPS };
  const user = req.headers['remote-user'];
  if (!user) return null;
  return {
    user: String(user),
    name: String(req.headers['remote-name'] || user),
    email: String(req.headers['remote-email'] || ''),
    groups: String(req.headers['remote-groups'] || '').split(',').map((g) => g.trim()).filter(Boolean),
  };
}

/** The signed-in person, or a 401 when the app expects the sign-in and there is none. */
export function requireUser(req) {
  const me = who(req);
  if (!me) throw new HttpError(401, SIGNIN === 'none' ? 'This app has no sign-in.' : 'Nobody is signed in. Open the app through its address, so the sign-in runs first.');
  return me;
}

/** The signed-in person, if they are in one of these groups; a 403 otherwise. */
export function requireGroup(req, ...groups) {
  const me = requireUser(req);
  if (!groups.some((g) => me.groups.includes(g))) throw new HttpError(403, `This needs the group ${groups.join(' or ')}.`);
  return me;
}

/** The sign-in's sign-out address, for the page's link. */
export function signOutUrl(req) {
  if (DEV || SIGNIN === 'none') return null;
  if (SIGNIN_URL) return `${SIGNIN_URL.replace(/\/$/, '')}/logout`;
  const host = String(req.headers.host || '').split(':')[0];
  const parts = host.split('.');
  if (/^[\d.]+$/.test(host) || parts.length < 3) return null;
  return `https://auth.${parts.slice(1).join('.')}/logout`;
}
