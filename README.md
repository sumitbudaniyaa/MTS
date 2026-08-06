# Auditorium Booking System

Production-grade internal **Army Auditorium Booking Platform** — a backend API plus three
web apps (Admin Portal, User App, Scanner App). See [architecture.md](architecture.md) for
the full design and [todo.md](todo.md) for status.

## Apps

| Path           | What                                   | Status |
|----------------|----------------------------------------|--------|
| `apps/backend` | Node + Express + TS + Mongoose + socket.io | ✅ complete (23 tests) |
| `apps/admin`   | React 19 Admin Portal (web, desktop, light/dark) | ✅ complete |
| `apps/user`    | React 19 User app (web, mobile-first, live seat picker) | ✅ complete |
| `apps/scanner` | React 19 Scanner app (web, mobile, QR camera) | ✅ complete |

> All three frontends are standard web apps (not PWAs). Deployment uses **PM2 + MongoDB
> Atlas (or a local mongod)** — there is no Docker.

### Highlights
- **Rank-based seat structure** — admin designs the auditorium (rows/seats, allowed ranks per
  row); users pick seats on a **live seat map** (socket.io) with short **seat holds**.
- Three separate account collections (`admins` / `scanners` / `users`); spouse logs in with
  their own mobile + the member's password (shared family account).
- Oversell-proof booking, refresh-token rotation, append-only audit, QR check-in.

## Data Model — Separate Account Collections

Accounts are physically split into three MongoDB collections:

| Collection | Model | Purpose |
|------------|-------|---------|
| `admins`   | `AdminModel`   | Admin accounts — two tiers: **SUPER_ADMIN** and **ADMIN** |
| `scanners` | `ScannerModel` | Door-scanner operator accounts |
| `users`    | `UserModel`    | Personnel (USER) accounts with unit/family fields |

### Admin tiers (separation of duties)

The `admins` collection holds two roles:

| Capability | SUPER_ADMIN | ADMIN (operational) |
|------------|:----------:|:-------------------:|
| Units — create/edit/delete | ✅ | ❌ (read-only) |
| Personnel (USER) — create/edit/delete/bulk | ✅ | ❌ (read-only) |
| Admin accounts — create/edit/delete | ✅ | ❌ |
| Scanner operators — manage | ✅ | ✅ |
| Movies — create/edit/delete | ❌ (read-only) | ✅ |
| Auditorium layout — manage | ❌ (read-only) | ✅ |
| Movie seat allocation | ❌ | ✅ |
| Reports · Audit · Attendance · Dashboard | ✅ | ✅ |

The **seed creates a SUPER_ADMIN**; super admins create operational ADMINs from **Settings →
Administrators** (pick the tier). The backend enforces every rule via route authorization; the
admin UI merely hides controls the current tier can't use.

### Field encryption at rest

**Mobile numbers** (across admins/scanners/users, including spouse mobiles) and **unit names**
are stored **AES-256-GCM encrypted**. Each encrypted field has a companion keyed **HMAC blind
index** (`mobileHash` / `nameHash`) that keeps login, uniqueness and spouse-login working; the
ciphertext is decrypted transparently on read. Set a stable, secret **`FIELD_ENCRYPTION_KEY`**
(≥ 32 chars) — losing/rotating it makes existing data unreadable. Trade-off: admin **search on
mobile / unit name is exact-match** (you can't substring-search ciphertext).

`mobile` uniqueness is **per-collection**, so the same number can hold a separate admin,
scanner **and** user account (one person may be all three). Each app sends its `role` on
login, so the lookup is scoped to the right collection (e.g. the scanner app authenticates
only against `scanners`). Token refresh resolves by id + role. Audit logs use polymorphic
`refPath` to reference actors across collections.

## Local development — interactive launcher

From the repo root, pick which apps to run together with an arrow-key menu:

```bash
npm install            # one-time: installs the launcher (zero deps)
npm run install:all    # one-time: install each app's dependencies
npm run dev            # ↑/↓ to choose, Enter to start, Ctrl+C to stop
```

```
🎬 Auditorium — dev launcher
Use ↑/↓ to choose, Enter to start, q to quit.

❯  All apps  (backend + admin + user + scanner)
   Admin + Backend
   User + Backend
   Scanner + Backend
   Backend only
```

Each app's output is colour-prefixed and interleaved; Ctrl+C stops them all. You can also
skip the menu: `npm run dev all` (or `admin` / `user` / `scanner` / `backend`).

> The launcher auto-creates `apps/backend/.env` on first run. Set `MONGO_URI` to Atlas or a
> local `mongod`. Dev ports: backend `4000`, admin `5173`, user `5174`, scanner `5175`.

> **MongoDB:** a **replica set** (Atlas, or `mongod --replSet rs0` + `rs.initiate()`) gives
> full multi-doc transactions. A plain standalone `mongod` also works for local dev — the
> backend auto-detects it and runs non-transactionally (atomic conditional updates still
> prevent overselling).

## Backend — local quickstart

Requires Node 20+ and MongoDB (Atlas or local). A replica set is recommended for production.

```bash
cd apps/backend
cp .env.example .env            # then edit MONGO_URI + secrets
npm install
npm run seed:admin              # create the first SUPER_ADMIN (in `admins` collection)
npm run dev                     # starts on :4000
```

Verify: `curl localhost:4000/health`

> The seed creates a **SUPER_ADMIN** directly, so a fresh install needs no promotion step.
> Note that `mobile` is **encrypted at rest** (see below) — you can't query admins by a
> plaintext mobile in `mongosh`; match by the plaintext `name` or `_id` instead, e.g.
> `db.admins.updateOne({ name: "System Administrator" }, { $set: { role: "SUPER_ADMIN" } })`.

For production, run the API under PM2: `cd apps/backend && npm run build &&
pm2 start ecosystem.config.cjs` (cluster mode). See `apps/backend/ecosystem.config.cjs`.

### Scripts
- `npm run dev` — watch-mode dev server
- `npm run build` / `npm start` — compile + run
- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — ESLint (no `any`, strict)
- `npm test` — Vitest (spins up in-memory Mongo replica set)
- `npm run seed:admin` — bootstrap the first SUPER_ADMIN from `SEED_ADMIN_*` env vars
- `npm run seed:superadmin -- <mobile> <password> ["Name"]` — create a SUPER_ADMIN with custom
  credentials (mobile is encrypted + hashed correctly by the app; a raw `mongosh` insert cannot)

### API
Base path `/api/v1`. Full surface in [architecture.md](architecture.md#71-api-surface-apiv1).

| Area | Endpoints |
|------|-----------|
| auth | `login` · `refresh` · `logout` · `me` · `change-password` |
| accounts | `units` CRUD · `personnel` CRUD · `admins` (list/create) |
| movies | CRUD · `/movies/available` (public) · `/movies/scanner` |
| **seating** | `GET/PUT /seating/auditorium` · `POST /seating/movies/:id/generate` · `GET …/:id/detail` (admin: layout + who booked) · `/seats` · `/hold` · `/release` · `/book` |
| bookings | create/list/get/cancel · `/bookings/allowance/:movieId` |
| attendance | `/attendance/verify` · `/attendance/movies/:id/summary` |
| reports/audit | `/reports/overview` · `/reports/movies/:id` · `/audit-logs` |
| realtime | socket.io at `/socket.io`, room `movie:<id>`, event `seats:update` |

### End-to-end flow
1. Admin → **Auditorium**: design rows/seats + allowed ranks → Save.
2. Admin → **Movies**: create a movie (seats are auto-generated from the auditorium; total
   seats come from the layout). Set the **duration** — booking stays open until the show's
   end time (`startTime + duration`). Movies are shown to users early; **booking opens a
   configurable lead time before** showtime (default 1 h — Admin → Settings → Timings).
   Optional per-movie **"Open to all ranks"**. Saving a movie **immediately asks you to split
   its seats across units** — allocation is part of creating a movie, not a separate page. You
   can skip it (unallocated seats stay in the common pool) and re-open it later from the
   **Allocate seats** action on the movie's row.
3. User app → open the movie → pick seats on the **live map** (open two browsers to see
   seats lock in real time) → **Confirm** → QR tickets show the seat label. Cancelling frees
   the seat live.
4. **Unclaimed seats auto-free**: a ticket holder has the **check-in grace period** (default
   15 min) to scan in, counted from showtime — or from their own booking, for a walk-in who
   took a seat after the show started. Miss it and the seat is released back onto the live map
   so someone else can grab it, right up until the show ends. Seats reclaimed from walk-ins are
   recorded separately and never counted as no-shows.
5. **Reports** are available **once a show has ended** — mid-screening an unscanned ticket just
   means someone hasn't reached the door yet.
6. Scanner app → pick the movie → scan the QR → verified / already-used / invalid.

## Deployment (free tier: Vercel + Render + Atlas)

No Docker. Host the **API on Render** (free web service — keeps WebSockets + cron jobs alive;
ping `/health` with UptimeRobot so the free dyno doesn't sleep), the **three apps on Vercel**
(static), and **MongoDB on Atlas** (free M0).

**Render — API** (`apps/backend`):
- Build: `npm install --include=dev && npm run build` · Start: `npm start`
- Env: `NODE_ENV=production`, `MONGO_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
  **`FIELD_ENCRYPTION_KEY`** (≥ 32 chars, stable & secret), `COOKIE_SECURE=true`,
  `COOKIE_SAMESITE=none` (cross-site), `COOKIE_DOMAIN=` (blank),
  `CORS_ORIGINS=https://<admin>.vercel.app,https://<user>.vercel.app,https://<scanner>.vercel.app`

**Vercel — each app** (one project per app, root dir `apps/admin` / `apps/user` / `apps/scanner`):
- Build: `npm install && npm run build` · Output: `dist` · Framework: Vite
- Env: `VITE_API_URL=https://<api>.onrender.com/api/v1` (the `/api/v1` is auto-appended if
  you omit it). SPA routing is handled by each app's `vercel.json`.
- ⚠️ Vercel bakes env vars at **build time** — set the var, then trigger a fresh deploy.

**Gotchas:** devDependencies are needed to compile the API, so the build command uses
`--include=dev`. For cross-site cookies you MUST use `COOKIE_SAMESITE=none` + `COOKIE_SECURE=true`.
Seed the first SUPER_ADMIN with `npm run seed:admin` (env-based) or `npm run seed:superadmin --
<mobile> <password>`. A raw `mongosh` insert won't work — mobiles are encrypted with a blind
index and passwords are bcrypt-hashed, which only the app can produce.

Self-hosting alternative: run the API under **PM2** (`pm2 start ecosystem.config.cjs`) and
serve the built apps from any static host / nginx; if everything is one origin or same-site,
`COOKIE_SAMESITE=strict` is fine and `VITE_API_URL=/api/v1`.

> ⚠️ **`FIELD_ENCRYPTION_KEY` must never be rotated once data exists.** Mobiles and unit names
> are encrypted with it and looked up via a keyed blind index, so changing it silently orphans
> every existing record: affected accounts can no longer log in (the index can't match) and
> their mobile renders as raw `enc:v1:…` ciphertext. Treat it like the JWT secrets — set once,
> back it up, never change it.

> **Operational timings** (`VISIBILITY_LEAD_MINUTES`, `NO_SHOW_GRACE_MINUTES`,
> `SEAT_HOLD_SECONDS`) are only **seed values used on the very first boot**. After that they
> live in the database and are edited at **Admin → Settings → Timings**; changing the env vars
> on an existing deployment does nothing.
