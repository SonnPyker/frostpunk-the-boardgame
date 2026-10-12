# Deployment guide

Step-by-step deployment of the three hosted parts:

* **Supabase**: Postgres database for saved games and snapshots.
* **Render**: the realtime game server (`apps/server`), a Node web service.
* **Vercel**: the static web client (`apps/web`).

Deploy in this order: Supabase, then Render, then Vercel. Vercel needs the Render URL, and Render needs the Vercel URL for CORS. Doing it in this order means you only do the CORS step once more.

Nothing here runs automatically from your machine. You do each step in the dashboards.

Before you start, make sure `main` on GitHub has the code you want to deploy and that the CI workflow (`.github/workflows/ci.yml`) is green.

---

## 0. Check locally (optional, recommended)

```bash
npm ci
npm run typecheck
npm test -w packages/engine
npm run build:web
npm run build:server
```

All commands should finish without errors.

---

## 1. Supabase

### 1.1 Create the project

1. Go to https://supabase.com/dashboard and choose **New project**.
2. Fields:
   * **Organization**: your organisation.
   * **Name**: `frostpunk` (any name).
   * **Database password**: generate one and store it in your password manager. You need it only for direct database access.
   * **Region**: the same region you chose for Render, to reduce latency.
3. Click **Create new project** and wait for provisioning to finish.

### 1.2 Note the keys

1. Open **Project Settings > API**.
2. Copy these values somewhere safe for the next steps:
   * **Project URL** (`https://<project-ref>.supabase.co`). Used as `SUPABASE_URL` (server only).
   * **anon public** key. Not needed: the web client never talks to Supabase directly, only the server does.
   * **service_role** key. Used as `SUPABASE_SERVICE_ROLE_KEY`. **Secret.** It bypasses Row Level Security. Set it only on the Render service. Never put it in Vercel's `VITE_*` variables or in the repo.

### 1.3 Apply the migrations

The schema lives in `supabase/migrations/`. Use one of the two methods below.

**Method A, Supabase CLI (recommended, repeatable):**

1. Install the CLI on your machine. Follow https://supabase.com/docs/guides/cli for your OS. (This is a manual step, not run by this repository.)
2. In the repository root:

   ```bash
   supabase login
   supabase link --project-ref <project-ref>     # the ref part of the Project URL
   supabase db push                              # applies every file in supabase/migrations in order
   ```

3. When asked, enter the database password from step 1.1.

**Method B, SQL editor (no CLI):**

1. Open **SQL Editor** in the Supabase dashboard and choose **New query**.
2. Open each file in `supabase/migrations/` in filename order: `0001_init.sql`, then `0002_service_role_grants.sql` (the numeric prefix sets the order).
3. Paste the full contents of one file, click **Run**, and check it reports success before moving to the next file.

`supabase/seed.sql` adds one sample finished game for local development. `supabase db push` does not load it, and you should not paste it into the production project.

### 1.4 Verify

In **Table Editor**, confirm the tables that the migrations created are present. If none appear, the migrations did not run (see the troubleshooting table in the README).

---

## 2. Render (game server)

### 2.1 Create the service from the Blueprint

1. Go to https://dashboard.render.com and sign in with GitHub.
2. Click **New > Blueprint**.
3. Connect the GitHub repository for this project and select the branch to deploy (usually `main`).
4. Render reads `render.yaml` and shows one service: `frostpunk-server`. Check these values on the preview:
   * **Runtime**: Node
   * **Region**: as set in `render.yaml` (change it in the dashboard if you need another region)
   * **Root directory**: `.` (repository root)
   * **Build command**: `npm ci && npm run build:server`
   * **Start command**: `node apps/server/dist/server.mjs`
   * **Health check path**: `/health`
   * **Plan**: `free` for testing. See 2.4.
5. Fill in the three secret or environment values that Render marks as **sync: false**. Enter them when the Blueprint asks, or later under the service's **Environment** tab:

   | Key | Value |
   | --- | --- |
   | `CORS_ORIGIN` | Your Vercel production URL, for example `https://frostpunk-web.vercel.app`. If you also test locally, add `http://localhost:5173` separated by a comma. An origin only: no path (a trailing slash is accepted). A malformed entry stops the server at start-up, so check the logs after every change. You can set a placeholder now and correct it in step 4. |
   | `SUPABASE_URL` | The Project URL from 1.2, for example `https://abcd1234.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | The service_role key from 1.2. Mark it as secret in the dashboard. |

   The pre-filled values are `NODE_VERSION=22`, `PORT=10000` and `PERSIST_SNAPSHOT_EVERY=10`. Leave them unless you have a reason to change them.

  Optional capacity settings (the defaults suit a small free-tier instance; the server reads them at start):

  | Variable | Default | Meaning |
  |---|---|---|
  | `MAX_ROOMS` | `200` | Rooms held in memory. Creating a room beyond this is refused with an `internal` error. |
  | `MAX_CONNECTIONS` | `1000` | Open WebSockets. Extra connections get HTTP 503. |
  | `MAX_CONN_PER_IP` | `20` | Open WebSockets per client address. A connection beyond this is accepted and then closed with code 1008 (`too many connections from this address`). Allowed 1 to 1000000. |
  | `TRUST_PROXY` | `1` on Render (set in `render.yaml`) | `1`: the client address is the first entry of `X-Forwarded-For`, which is what the Render proxy forwards. `0` or unset: the socket's own address is used and the header is ignored. Any other value stops the server at start-up. Caveat: the first entry is set by the client, so a client that sends its own header can pick any address and get around `MAX_CONN_PER_IP`. |
  | `ABANDON_GAME_MINUTES` | `1440` | A live game with no player connected for this long is saved as `abandoned` and unloaded. |
  | `PERSIST_ATTEMPTS` | `10` | Tries per database write (exponential backoff, 0.5 s to 30 s). After the last try the write is dropped and logged, and the game keeps running. |
  | `SHUTDOWN_GRACE_MS` | `20000` | On SIGTERM (a deploy or restart), how long pending database writes may take to finish before the process exits. Allowed 1000 to 120000. Keep it below the platform's kill timeout (see 2.5). |

6. Click **Apply** (or **Create resources**). The first build starts.

### 2.2 Check the deploy

1. Watch **Logs** on the service page until the build and start succeed.
2. Open `https://<service-name>.onrender.com/health` in a browser. It should return a success response (HTTP 200).
3. Note the service URL. For the web client you need the WebSocket form: replace `https://` with `wss://`, for example `wss://frostpunk-server.onrender.com`.

### 2.3 Auto deploy

`autoDeploy: true` in `render.yaml` means every push to the chosen branch redeploys the server. To turn it off, open the service, go to **Settings > Build & Deploy**, and set **Auto-Deploy** to **No**.

### 2.4 Plan note

* **Free**: spins down after about 15 minutes with no traffic. The next request waits 30 to 60 seconds. Live co-op games and the snapshot timer stop while the service sleeps. Fine for testing.
* **Starter** (paid, always on): use this for real co-op play. To change it: service page > **Settings > Instance type**, then pick **Starter**. It also updates `plan:` in `render.yaml` on the next sync if you edit that file.

### 2.5 Restarts, shutdown and recovery

* **Start-up**: the server loads every unfinished game (status `playing`) from Supabase: the latest snapshot plus the command log after it, or the whole log when no snapshot exists. Players reconnect with their saved token (`resume`), and the view they see is the one they saw before the restart. If Supabase cannot be read at start-up, the server exits with an error rather than running without those games, and Render restarts it.
* **Deploy or restart (SIGTERM)**: the server tells every connected player to reconnect after a delay of up to 10 seconds (`shutdown` message), waits up to `SHUTDOWN_GRACE_MS` for queued database writes to finish, then closes the sockets and exits. Writes still pending at that point are lost. The log then says how many. Render sends SIGTERM and later SIGKILL; keep `SHUTDOWN_GRACE_MS` comfortably below Render's current kill timeout (check the Render docs for the value at the time you deploy).
* **Health**: `GET /health` returns 200 while the process is up. Check `persistPending` (writes waiting or retrying) and `persistFailed` (writes given up). A `persistFailed` that goes up is a database problem to fix: those rows are missing from the database.

---

## 3. Vercel (web client)

### 3.1 Import the project

1. Go to https://vercel.com/new and sign in with GitHub.
2. Choose **Import** next to this repository.
3. On the configuration screen:
   * **Project name**: `frostpunk-web` (this sets the default URL `frostpunk-web.vercel.app`).
   * **Framework Preset**: leave as detected or choose **Other**. The build and output settings below come from `vercel.json` and override the preset.
   * **Root Directory**: leave as **`./`** (repository root). Do not select `apps/web`. The install must run at the root so the npm workspaces resolve.
   * **Build and Output Settings**: leave the fields empty. `vercel.json` provides:
     * Install command: `npm ci`
     * Build command: `npm run build:web`
     * Output directory: `apps/web/dist`
     * SPA rewrite: every path goes to `/index.html`.
4. Expand **Environment Variables** and add the client variable. Set **Environment** to **Production** (and **Preview** if you want preview deployments to talk to the server):

   | Name | Value |
   | --- | --- |
   | `VITE_SERVER_URL` | The WebSocket URL from 2.2, for example `wss://frostpunk-server.onrender.com` |

5. Click **Deploy**.

### 3.2 Check the deploy

1. When the build finishes, open the production URL.
2. Start a solo game. This needs no server, so it confirms the static build and assets work.
3. Start a co-op game. This needs the server and confirms `VITE_SERVER_URL`, CORS and Supabase.

### 3.3 Headers and caching

`vercel.json` sets:

* `Cache-Control: public, max-age=31536000, immutable` on `/assets/*`. This covers the card images, boards, tokens, tiles, models, audio and PDFs.
* Security headers on every path: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security` and a `Content-Security-Policy`.

If a feature stops working after a deploy (for example, a blocked script, font or connection), check the browser console for a CSP message and adjust `Content-Security-Policy` in `vercel.json`. The `connect-src` directive allows `https:` and `wss:` so that Supabase and the game server can be reached.

---

## 4. Connect the two services (CORS)

Vercel gives the production URL only after the first deploy. Render needs it in `CORS_ORIGIN`.

1. Copy the production URL from Vercel, for example `https://frostpunk-web.vercel.app`. Use the exact URL with no trailing slash.
2. Open the Render service > **Environment**.
3. Set `CORS_ORIGIN` to that URL. Add other origins with commas if needed, for example `https://frostpunk-web.vercel.app,http://localhost:5173`.
4. Click **Save, rebuild and deploy**. Wait for the deploy to finish, then check `/health` again.

If you later add a custom domain on Vercel, add that origin to `CORS_ORIGIN` as well.

---

## 5. Custom domains (optional)

* **Vercel**: project > **Settings > Domains** > add the domain and follow the DNS instructions.
* **Render**: service > **Settings > Custom Domains** > add the domain and follow the DNS instructions.
* After either change, update `CORS_ORIGIN` (Render) or `VITE_SERVER_URL` (Vercel, then redeploy).

---

## 6. Updating later

* **Code changes**: push to the deployment branch. Render and Vercel both redeploy automatically (Vercel builds every push to the production branch).
* **Database changes**: add a new file to `supabase/migrations/`, then apply it with `supabase db push` or the SQL editor. Do not edit migrations that have already been applied.
* **Changing `VITE_*` values**: update them in Vercel, then trigger a redeploy. The values are baked in at build time.
* **Changing server environment values**: update them in Render. The service restarts with the new values.

---

## 7. Quick reference

| Where | Setting | Value |
| --- | --- | --- |
| Vercel | Root Directory | `./` |
| Vercel | Install command | `npm ci` (from `vercel.json`) |
| Vercel | Build command | `npm run build:web` (from `vercel.json`) |
| Vercel | Output directory | `apps/web/dist` (from `vercel.json`) |
| Vercel | Env | `VITE_SERVER_URL` |
| Render | Runtime | Node |
| Render | Root directory | `.` |
| Render | Build command | `npm ci && npm run build:server` |
| Render | Start command | `node apps/server/dist/server.mjs` |
| Render | Health check path | `/health` |
| Render | Env | `CORS_ORIGIN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (secret), `PORT`, `PERSIST_SNAPSHOT_EVERY`, `NODE_VERSION`; optional `MAX_ROOMS`, `MAX_CONNECTIONS`, `MAX_CONN_PER_IP`, `TRUST_PROXY`, `ABANDON_GAME_MINUTES`, `PERSIST_ATTEMPTS`, `SHUTDOWN_GRACE_MS` |
| Supabase | Migrations | `supabase db push` or SQL editor, in filename order |
