# EventFlow — Deployment Guide

## Quick-start (Docker, recommended)

### Prerequisites
- Docker Desktop (or Docker Engine + Compose v2)
- A domain or server IP
- Microsoft 365 SMTP credentials for email (or use Mailpit for testing)

### 1. Clone and prepare
```bash
git clone <your-repo-url> eventflow
cd eventflow
cp .env.example .env
```

### 2. Set required env vars in `.env`
```env
POSTGRES_PASSWORD=<generate with: openssl rand -base64 32>
APP_URL=https://eventflow.yourdomain.com
HUBSPOT_ENCRYPT_KEY=<generate with: openssl rand -base64 32 | tr -d '=' | cut -c1-32>

# Production email (Microsoft 365):
MAIL_TRANSPORT=smtp
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=eventflow@yourdomain.com
SMTP_PASSWORD=<your M365 app password>
MAIL_FROM=EventFlow <eventflow@yourdomain.com>
```

### 3. Start
```bash
docker compose up -d --build
```

The app runs on port 3000. Point a reverse proxy (nginx, Caddy, Azure Application Gateway) at it.

### 4. Seed the first admin user
```bash
docker compose exec app node -e "
const { PrismaClient } = require('@prisma/client');
const { hashPassword } = require('./node_modules/@/server/auth/password');
// See prisma/seed.ts for the full seeder — run it from inside the container:
"
# Or run the seed directly:
docker compose exec app node -r tsconfig-paths/register -e \
  "require('./prisma/seed.ts')"
```

The easier way: run the seed script from your local machine after setting `DATABASE_URL` in your shell to point at the container's postgres (exposed on 127.0.0.1:5432).

```bash
DATABASE_URL="postgresql://eventflow:<POSTGRES_PASSWORD>@127.0.0.1:5432/eventflow" \
  npx tsx prisma/seed.ts
```

Log in with the admin account from seed.ts, then create real users via Settings → Users.

---

## Environment variable reference

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `APP_URL` | ✅ | Public URL, no trailing slash. Used in email links |
| `POSTGRES_PASSWORD` | ✅ (compose) | Postgres password, passed into `DATABASE_URL` |
| `HUBSPOT_ENCRYPT_KEY` | ✅ (if HubSpot used) | 32+ char key for AES-256-GCM token encryption |
| `MAIL_TRANSPORT` | ✅ | `outbox` (dev) or `smtp` (production) |
| `MAIL_FROM` | ✅ | Sender address shown on all emails |
| `SMTP_HOST` | When `MAIL_TRANSPORT=smtp` | SMTP server hostname |
| `SMTP_PORT` | When `MAIL_TRANSPORT=smtp` | Default 587 (STARTTLS) |
| `SMTP_USER` | When `MAIL_TRANSPORT=smtp` | SMTP username / M365 mailbox |
| `SMTP_PASSWORD` | When `MAIL_TRANSPORT=smtp` | SMTP password / M365 app password |
| `SMTP_SECURE` | When `MAIL_TRANSPORT=smtp` | `true` for TLS port 465, `false` for STARTTLS |
| `STORAGE_DIR` | Optional | Absolute path for file uploads. Defaults to `./storage` |
| `NODE_ENV` | Auto | Set to `production` by the Dockerfile |
| `COOKIE_SECURE` | Optional | Defaults to `NODE_ENV === "production"`. Set to `"false"` for a production build served over **plain HTTP** (an internal deployment with no reverse-proxy TLS in front of it) — `__Host-`-prefixed and `Secure` cookies are silently dropped by the browser over HTTP, which otherwise breaks sign-in with no error. Set to `"true"` to force Secure cookies in a non-production build. |

---

## Reverse proxy (nginx example)

```nginx
server {
    listen 443 ssl http2;
    server_name eventflow.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/eventflow.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/eventflow.yourdomain.com/privkey.pem;

    client_max_body_size 30M;   # Must be >= MAX_UPLOAD_BYTES (25 MB) in storage.ts

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

---

## Upgrades

```bash
git pull
docker compose up -d --build
```

Migrations run automatically on container start (`prisma migrate deploy`).

---

## Vercel

Vercel has no lasting disk, so EventFlow needs two add-ons there: a PostgreSQL database and Vercel
Blob for uploads. The app switches to Blob on its own when `BLOB_READ_WRITE_TOKEN` is set; nothing
else changes, and Docker / local development keep using the disk.

1. **Import the repo** in Vercel (Add New → Project). The framework preset is Next.js; leave the
   build settings as they are.
2. **Add a database:** Storage → Create → Neon (Postgres), connect it to the project. This sets
   `DATABASE_URL`.
3. **Add file storage:** Storage → Create → Blob, connect it to the project. This sets
   `BLOB_READ_WRITE_TOKEN`. Uploads are stored as private blobs and are only served through
   `/api/attachments/[id]`, which checks the viewer may see the event.
4. **Set environment variables:** `APP_URL` (the Vercel URL or custom domain, no trailing slash),
   `HUBSPOT_ENCRYPT_KEY`, and the mail settings. Use `MAIL_TRANSPORT=smtp` with real SMTP settings;
   the `outbox` transport writes to disk and won't work on Vercel. Never set `DEV_SEED_PASSWORD`.
5. **Create the tables and the first admin** from your machine, pointing at the Neon database.
   Use its **unpooled** connection string (`DATABASE_URL_UNPOOLED` in the Vercel dashboard):
   migrations need a direct connection, while the app itself uses the pooled `DATABASE_URL`.
   ```bash
   DATABASE_URL="<neon unpooled connection string>" npx prisma migrate deploy
   DATABASE_URL="<neon unpooled connection string>" npx tsx scripts/seed-config.ts
   DATABASE_URL="<neon unpooled connection string>" APP_URL="<the site URL>" \
     npx tsx scripts/create-admin.ts --email name@motadata.com --name "Full Name"
   DATABASE_URL="<neon unpooled connection string>" npx tsx scripts/seed-stock-dashboards.ts
   ```
   `create-admin` prints a link where the admin sets their own password. Run it before
   `seed-stock-dashboards`, which needs an administrator. Don't run
   `seed-dev-users` against a public deployment: its test logins share one password.
6. **Redeploy** so the new variables take effect.

**Limits on Vercel:**
- Vercel caps a request body at 4.5 MB, so uploads larger than that fail even though the app
  allows 25 MB. Larger files would need direct-to-Blob client uploads.
- The HubSpot sync and Excel import routes are allowed up to 5 minutes (`maxDuration`).
- Migrations don't run on deploy: after pulling a change that adds one, run
  `npx prisma migrate deploy` against the unpooled URL before (or right after) deploying.
- Approval reminders (`npm run approvals:remind`) need a scheduled job, e.g. a Vercel Cron calling
  a protected API route. Not set up yet.

---

## Microsoft 365 mail setup

1. In Microsoft 365 admin, create or designate a shared mailbox (e.g. `eventflow@motadata.com`).
2. Enable SMTP AUTH for that mailbox: Admin → Settings → Org settings → Modern authentication → enable per-user basic auth, or create an App Password.
3. Set in `.env`:
   ```
   MAIL_TRANSPORT=smtp
   SMTP_HOST=smtp.office365.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=eventflow@motadata.com
   SMTP_PASSWORD=<app password>
   MAIL_FROM=EventFlow <eventflow@motadata.com>
   ```
4. Restart: `docker compose up -d app`

---

## HubSpot setup

1. In HubSpot, go to Settings → Integrations → Private Apps → Create a private app.
2. Required scopes: `crm.objects.companies.read`, `crm.objects.companies.write`, `crm.objects.contacts.read`, `crm.objects.contacts.write`, `engagements.read`, `engagements.write`.
3. Copy the generated token.
4. In EventFlow: Settings → Integrations → HubSpot → paste the token → Connect.
5. Adjust field mappings and enable "Push event engagements" if desired.
6. Click "Sync now" for the first full import.

---

## Backup

Back up the PostgreSQL volume and the uploads volume:
```bash
# Database
docker compose exec postgres pg_dump -U eventflow eventflow | gzip > backup-$(date +%F).sql.gz

# Files
docker run --rm -v eventflow_uploads:/data -v $(pwd):/out alpine \
  tar czf /out/uploads-$(date +%F).tar.gz -C /data .
```

---

## Health check

`GET /api/health` returns `{"status":"ok","database":"ok","latencyMs":N}` when healthy, or `503` if the database is unreachable. Wire this into your load balancer or uptime monitor.

---

## Security checklist (pre-launch)

- [ ] `POSTGRES_PASSWORD` is strong and unique
- [ ] `HUBSPOT_ENCRYPT_KEY` is set (32+ chars, random)
- [ ] `APP_URL` matches the actual domain (affects cookie scope and email links)
- [ ] `MAIL_TRANSPORT=smtp` and M365 credentials are set
- [ ] TLS certificate is valid; HSTS is enabled (the app sets it automatically in production)
- [ ] Reverse proxy sets `X-Forwarded-Proto` so the `__Host-` session cookie is issued correctly
- [ ] PostgreSQL port 5432 is NOT exposed to the internet (docker-compose binds to 127.0.0.1 only)
- [ ] Storage volume is included in backups
- [ ] First admin password is changed after seeding
- [ ] `DEV_SEED_PASSWORD` is empty or unset in production

---

## Offline deployment (no Docker, no internet on the target)

Used once already (a server reachable only on the office LAN, no outbound internet at all — not
even DNS). No Docker, no `apt` package, no `next/font/google` fetch and no Prisma CLI engine
download can reach anything from that box, so everything has to be fetched on a machine that
*does* have internet and pushed over as files. None of this needs the target OS to match the dev
machine's OS — only the dependencies that ship native binaries do.

1. **Node.js**: download the official linux-x64 tarball from nodejs.org (a plain binary archive,
   no package manager involved) and extract it on the server, e.g. to `/opt/node`.
2. **App dependencies, cross-platform**: `npm ci --os=linux --cpu=x64 --libc=glibc` in a clean
   copy of `package.json`/`package-lock.json`/`prisma/` — even run from Windows or macOS, npm
   downloads the *Linux* builds of every platform-specific optional dependency (Prisma's query
   engine, `@next/swc-linux-x64-gnu`, `@node-rs/argon2-linux-x64-gnu`, `sharp`'s linux binaries,
   `embedded-postgres`'s linux Postgres distribution — see next point). Tar up the resulting
   `node_modules` and transfer it; `npm ci` itself never has to run on the offline box.
   - **Executable bits don't survive a Windows → Linux transfer.** After extracting on the
     server, `chmod +x` everything under `node_modules/.bin/`, every `*/bin/*` directory, and
     `@embedded-postgres/*/native/`, or you'll see `EACCES` the first time anything tries to run
     one.
3. **PostgreSQL, without a system install**: this project already depends on `embedded-postgres`
   for local dev (`scripts/dev-db.ts`, "no Docker needed"), and its Linux binary distribution is
   already sitting in the `node_modules` from step 2 — so point a systemd unit at
   `scripts/dev-db.ts` instead of installing PostgreSQL from `apt` at all. Two things it needs
   that a normal install would have handled:
   - The package ships `.so.N.M` library files but not the plain `.so`/`.so.N` symlinks loaders
     look for (`libpq.so.5` etc.) — read `native/pg-symlinks.json` inside the package and create
     them yourself (one `fs.symlinkSync` per entry); otherwise `initdb` fails with
     `error while loading shared libraries: libpq.so.5: cannot open shared object file`.
   - `node_modules/.bin/tsx` is a shell-script shim; a systemd `ExecStart=` that runs it via
     `node node_modules/.bin/tsx …` fails with a syntax error, because that invokes the *shell
     script* as if it were JavaScript. Call the real entry point instead:
     `node node_modules/tsx/dist/cli.mjs …`.
4. **Prisma's CLI engines**: `prisma generate` only needs what step 2 already fetched (add the
   target to `binaryTargets` in `schema.prisma` — see the comment there), but `prisma migrate
   deploy` additionally downloads a *schema-engine* and a second copy of the *query-engine* for
   its own use, straight from `binaries.prisma.sh`, outside npm entirely. On the internet-having
   machine, point `DATABASE_URL` at anything (even a wrong password — the engine download happens
   before the connection attempt) and run `PRISMA_CLI_BINARY_TARGETS=debian-openssl-3.0.x prisma
   migrate deploy`; harvest the two new files it leaves in `node_modules/@prisma/engines/` and
   copy them to the same path on the server.
5. **Fonts**: `next/font/google` fetches at *build* time, which fails outright with no internet.
   Download the font file once and switch to `next/font/local` (see `src/app/layout.tsx` and
   `src/app/fonts/`) — a one-time, permanent fix, not specific to this deployment.
6. **Build on the target itself**, not on the dev machine: `next build` needs to execute the
   platform's own SWC binary, so a build done on Windows can't be transferred even if the rest of
   `node_modules` is Linux-targeted. Standard `output: "standalone"` steps apply after that: copy
   `public/` and `.next/static/` into `.next/standalone/`, and a copy of `.env` too — the
   standalone server loads it from its own working directory at runtime, not the repo root.
7. **No TLS**: an internal-LAN deployment with no reverse proxy means no HTTPS, which means
   `COOKIE_SECURE=false` is required (see the env var reference above) or sign-in fails silently.
8. **Clock**: a VM that has been stopped for a while and never had internet to NTP-sync against
   can be months off. Check `date` before relying on anything timestamp-sensitive (session
   expiry, audit log, certs) and set it by hand if needed — `sudo date -s "<UTC time>"`.
9. **systemd**, two units — `eventflow-db.service` running `scripts/dev-db.ts` as above, and
   `eventflow-app.service` running `node server.js` from `.next/standalone/` with `Requires=` and
   `After=` pointing at the db unit, `PORT`/`HOSTNAME` set via `Environment=`. `systemctl enable
   --now` both.
