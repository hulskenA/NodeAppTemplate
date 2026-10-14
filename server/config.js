// Everything the app reads from its environment, in one place. On the server, Control Center
// sets PORT, NODE_ENV and the variables of control-center.yml's `env:`, plus the secrets added on
// the app's page. Locally, `npm run dev` fills in what is missing.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** `npm run dev`: a fake signed-in user, no sign-in in front (none with SIGNIN=none). Never on the server. */
export const DEV = process.argv.includes('--dev') || process.env.DEV === '1';

export const PORT = Number(process.env.PORT) || 3001;
// Only ever 127.0.0.1: nginx is the one door in, and it is nginx that asks for the sign-in.
export const HOST = '127.0.0.1';

export const APP_NAME = process.env.APP_NAME || 'My app';

/**
 * How the app knows who is signed in.
 *   required  the sign-in is in front (access: account, group or admins). The account comes
 *             from the headers nginx sets after the sign-in; a request without them is refused.
 *   none      a public app (access: public). Nobody is signed in, and those headers are never
 *             believed, since anyone could send them.
 * Change it together with the app's access in the panel.
 */
export const SIGNIN = (process.env.SIGNIN || 'required').toLowerCase() === 'none' ? 'none' : 'required';

/** The sign-in's address, for the "Sign out" link. Default: auth.<the app's domain>. */
export const SIGNIN_URL = process.env.SIGNIN_URL || '';

/** The fake account of `npm run dev`: DEV_USER=lea DEV_GROUPS=friends,qa npm run dev */
export const DEV_USER = process.env.DEV_USER || 'dev';
export const DEV_GROUPS = (process.env.DEV_GROUPS || 'admins').split(',').map((g) => g.trim()).filter(Boolean);
