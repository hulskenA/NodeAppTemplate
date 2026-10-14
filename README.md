# My app

Started from the **app template**: a Node app with no dependencies, in the house style, made to
be created and deployed from Control Center.

What it already does:

- **The sign-in.** Every page and API call knows who is signed in (account, name, email, groups),
  and `requireGroup(req, 'admins')` limits a route to a group. A **Sign out** link sits in the header.
- **The charter.** Tokens, fonts, cards, fields, buttons and the duck: pages look like the panel.
- **A small API** with the usual guards: JSON bodies with a size limit, changes accepted only from
  the app's own pages, clear error messages, security headers on every answer.
- **What the panel expects:** listens on `127.0.0.1` and `PORT`, answers `/health`, logs to the
  console, stops cleanly when PM2 restarts it.
- **Tests** (`npm test`) and a **local mode** (`npm run dev`) with a fake signed-in user.
- **A guide** (`docs/`): the app's page on the documentation site, updated by each deploy.

The home page is an example (a message board kept in memory): replace it.

## Starting a new app from the template

1. On GitHub, open the template repository and press **Use this template**, then
   **Create a new repository**. Give it the app's name, private.
2. Add the new repository to the server's GitHub token (the same token the panel uses), so the
   server can read it.
3. Clone it on your PC and change the name in four places:
   - `package.json`: `"name"`
   - `control-center.yml`: `name`, `address`, `access` and `group`, and `APP_NAME`
   - `public/index.html`: the `<title>` (the page fills in the rest from `APP_NAME`)
   - `docs/index.md`: its `# title`, the name people see on the documentation site
4. Commit and push.
5. In the panel, **Add an app**, type the repository: the form fills itself from
   `control-center.yml`. It starts on the construction page; **Launch** it from its page when
   it is ready.

## Working on it

```bash
npm run dev        # http://127.0.0.1:3001, signed in as "dev" in the admins group; restarts on save
npm test           # the tests in test/
```

Another fake account: `DEV_USER=lea DEV_GROUPS=friends,qa npm run dev` (in PowerShell:
`$env:DEV_USER="lea"; $env:DEV_GROUPS="friends,qa"; npm run dev`).

Then push, and press **Deploy** on the app's page in the panel.

## Where things go

| Path | What |
|---|---|
| `server/routes.js` | The app's API: add routes here. Each returns a value (sent as JSON) or throws `HttpError` |
| `server/auth.js` | `who`, `requireUser`, `requireGroup`: who is signed in |
| `server/config.js` | Everything read from the environment |
| `server/http.js` | Answers, JSON bodies, the same-origin check, static files, security headers |
| `server/index.js` | The server itself: `/health`, the API, the pages |
| `public/` | The pages: `index.html`, `app.js`, `common.js` (`api()`, `toast()`, `esc()`), `style.css` |
| `public/ds/` | The charter: `tokens.css` and `bundle.css`. Update both from the panel when the charter changes |
| `docs/` | The app's guide, shown on the documentation site: see below |
| `test/` | Tests, run by `npm test` and worth running before each push |
| `control-center.yml` | How the panel creates and deploys the app |

## The guide

`docs/` is what people read about the app on the documentation site, under **Apps**. There is
nothing to set up: the site reads the folder from the app's live build, so each **Deploy**
updates the guide, and it is shown to the people who can open the app and to nobody else.

- `docs/index.md` is the first page. Its `# title` is the app's name in the list of apps.
- Each other `.md` file is another page. Pictures go in the folder too: `![The list](img/list.png)`.
- Write links as on GitHub, relative to the file: `[sharing](sharing.md)`.
- Markdown only: HTML typed in a page is shown as text.
- To order the pages, or to shorten a title in the menu, start a file with settings between two
  `---` lines: `title`, `nav`, `order`, `summary`, and `access` (a group, to limit one page).

The page in `docs/` is an example: replace it. `npm test` checks that each page has a title and
that every link and picture of the guide leads to a file. The documentation site explains the
rest, under Building an app, "Document your app".

## Settings and secrets

Plain settings go in `control-center.yml` under `env:` (they are on GitHub), or on the app's page
under **Edit settings**. API keys, passwords and tokens go under **Secrets** on the app's page:
they stay on the server and reach the app as environment variables. Read both in
`server/config.js`, with a default for `npm run dev`.

| Variable | Default | Meaning |
|---|---|---|
| `APP_NAME` | `My app` | Shown in the header and the title |
| `SIGNIN` | `required` | `required` behind the sign-in; `none` for a public app |
| `SIGNIN_URL` | `https://auth.<the app's domain>` | The sign-in's address, for **Sign out** |
| `PORT` | `3001` | Set by the panel |

**Public apps:** with `access: public`, set `SIGNIN: none`. Change both together if you change the
access later from the panel: a public app left on `SIGNIN: required` answers every page with a 401.
With `SIGNIN: none`:

- Nobody is signed in: `who(req)` is `null`, there is no **Sign out**, and the sign-in's headers
  are never believed, since without the sign-in in front anyone could send them.
- `requireUser` and `requireGroup` refuse everyone (401). Keep them on what only an account may do;
  write the routes anyone may use without them (the example board lets anyone read and post, as
  *Anonymous*).
- Cap what anyone can do with `rateLimit(limit, ms)` from `server/http.js` (the board: 20 posts a
  minute). Changes still need the app's own pages (`api()`), as behind the sign-in.
- Try it locally with `SIGNIN=none npm run dev` (in PowerShell: `$env:SIGNIN="none"; npm run dev`).

## Rules worth keeping

- Escape what you put in a page (`esc()` in `public/common.js`); never build HTML from raw input.
- Calls that change something go through `api()`, which sends the header the server checks.
- Data in memory is gone at each deploy and restart. For data to keep, add a database or files
  outside the app's folder (each deploy is a new folder).
- Keep `/health` cheap: the panel calls it every 30 seconds.
- Adding an npm package: `npm install <name>`, then commit `package.json` and `package-lock.json`
  (the server installs with `npm ci`).

## Tests and deploys on GitHub

`.github/workflows/ci.yml` runs the tests on every push and pull request. It can also deploy
once they pass (Control Center 0.19), and does nothing of the kind until you set it up:

1. On the app's page in the panel, **Deploy from CI** > **Make a deploy link**. Copy the token.
2. In the repository on GitHub, Settings > Secrets and variables > Actions: the variable
   `CC_DEPLOY_URL` (the link shown in the panel) and the secret `CC_DEPLOY_TOKEN` (the token).
3. Push to `main`: when the tests pass, the panel deploys that commit, with its usual check and
   automatic rollback. A commit is deployed only while it is still the latest on `main`.

For a staging copy, do the same on the copy's page with `CC_STAGING_URL` and `CC_STAGING_TOKEN`:
pushes to other branches are sent, and the copy deploys only the branch it follows. If the app
deploys from another branch than `main`, change `refs/heads/main` in the workflow too.
