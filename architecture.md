# Auditorium Booking System — Architecture

> Living document. Update on every completed task. Assume multiple AI agents read this
> before touching the code. Never let it go stale.

## 1. Overview

Production-grade internal **Army Auditorium Booking Platform**. Personnel (grouped into
units) book auditorium movie tickets subject to per-unit seat quotas and per-person family
limits. Unused quota is released into a common pool at showtime; unclaimed seats are reclaimed and
their seats released. Tickets carry QR codes verified at the door by a scanner app.

The system is split into **one backend API** and **three frontend applications**.

## 2. Repository Layout (monorepo, decoupled apps)

```
50k/
├── architecture.md            # this file
├── todo.md                    # milestone + task tracker (mandatory, kept current)
├── README.md                  # quickstart
├── apps/
│   ├── backend/               # Node + Express + TS + Mongoose API
│   ├── admin/                 # React 19 Admin Portal web app (desktop-first)  (M8)
│   ├── user/                  # React 19 User web app (mobile-first)           (M9)
│   └── scanner/               # React 19 Scanner web app (mobile-first)        (M10)
```

Each app is self-contained (own `package.json`, `tsconfig`) so it can be built and deployed
independently. Shared contracts (Zod schemas / DTO types) are duplicated intentionally
per-app boundary; the canonical source of truth for validation is the **backend**.

## 3. Backend Architecture

### 3.1 Stack
Node.js 24 · Express · TypeScript (strict) · MongoDB · Mongoose · Zod · JWT · bcrypt.

### 3.2 Layering (feature-based)

```
src/
├── server.ts        # process bootstrap: connect DB, start HTTP, graceful shutdown
├── app.ts           # Express app: security middleware, routes, error handling
├── config/          # env (zod-validated), runtime settings cache, db connection, logger
├── middleware/      # auth (authenticate/authorize), validate, error, rateLimit, audit
├── models/          # Mongoose schemas (single source of persistence shape)
├── modules/         # feature slices: auth, units, personnel, admins, movies, seats,
│                    #   seating, bookings, attendance, audit, reports, settings
│                    #   each = { *.routes.ts, *.controller.ts, *.service.ts, *.schema.ts }
├── realtime/        # socket.io gateway (live seat map)
├── jobs/            # scheduler: booking-window open, open-pool, seat reclaim, hold expiry
├── utils/           # jwt, password, apiError, asyncHandler, ids, transaction (replSet-aware)
└── types/           # shared TS types, Express request augmentation
```

**Rule:** controllers are thin (HTTP in/out). All business logic + transactions live in
`*.service.ts`. Models never contain cross-aggregate logic.

### 3.3 Data Model (collections)

| Collection        | Purpose | Key fields |
|-------------------|---------|------------|
| `units`           | Army units (org label only; no seat quotas) | `name` 🔒(+`nameHash`), `active` |
| `admins`          | Admin accounts (separate collection) | `mobile` 🔒(+`mobileHash`), `passwordHash`, `role` (SUPER_ADMIN\|ADMIN), `name`, `active` |
| `scanners`        | Scanner/operator accounts (separate collection) | `mobile` 🔒(+`mobileHash`), `passwordHash`, `role` (fixed SCANNER), `active` |
| `users`           | Personnel accounts only | `mobile` 🔒(+`mobileHash`), `passwordHash`, `role` (fixed USER), `unit`, `rank` (OFFICER\|JCO\|JAWAN), `maritalStatus`, `spouseMobile` 🔒(+`spouseMobileHash`), `numberOfKids`, `familySize` (derived) |

> 🔒 = **AES-256-GCM encrypted at rest** with a keyed HMAC blind index (`*Hash`) for lookup/uniqueness (§3.5.1).
| `movies`          | Shows | `title`, `description`, `poster` (URL or base64), `showDate`, `startTime`, `durationMinutes` (endTime = start + duration), `totalSeats`, `status`, `openToAll` (rank bypass) |
| `settings`        | Admin-editable operational timings (singleton, fixed `_id`) | `visibilityLeadMinutes`, `noShowGraceMinutes`, `seatHoldSeconds`, `updatedBy` |
| `auditoria`       | Physical venue layout (singleton) | `name`, `rows[]` → `{ label, seats[] → { number, allowedRanks[] } }` |
| `movieseats`      | Per-movie seat inventory | `movie`, `row`, `number`, `label`, `allowedRanks[]`, `status` (FREE\|HELD\|BOOKED), `heldBy`, `holdExpiresAt`, `bookedBy`, `booking`, `ticketCode` |
| `seatallocations` | Legacy per-unit quota (superseded by seats; endpoints retained) | `movie`, `unit`, `allocated`, `booked`, `released` |
| `bookings`        | A booking = N tickets for one user/movie | `user`, `movie`, `quantity`, `source`, `idempotencyKey`, `tickets[]` |
| `tickets`         | One seat = one QR (embedded in booking) | `code`, `seatLabel`, `status`, `checkedIn`, `checkedInAt`, `checkedInBy` (→Scanner) |
| `auditlogs`       | Append-only audit trail | `user` (refPath→Admin/Scanner/User), `userModel`, `action`, `ip`, `metadata`, `createdAt` |
| `refreshtokens`   | Rotating refresh tokens | `user`, `role`, `tokenHash`, `family`, `expiresAt`, `revokedAt`, `replacedBy` |

Accounts are physically separated into three collections by role. The `account.service.ts`
resolves accounts by mobile (scoped to the app's `role` on login) and by id+role (token
refresh). `mobile` uniqueness is **per-collection**: the same number may exist independently
as an admin, a scanner **and** a user, so one person can be all three (e.g. a scanner who is
also a member). Within the `users` collection a spouse's `spouseMobile` also counts as taken.
Each app passes its `role` on `POST /auth/login` so the lookup hits the correct collection.
A married member's spouse logs in with their own `spouseMobile` + the member's password and
resolves to the **same** family account (shared tickets/quota).

`familySize = 1 + (married ? 1 : 0) + numberOfKids`, **always** recomputed server-side on
write; the client-supplied value is ignored.

Personnel **ranks** (OFFICER/JCO/JAWAN) gate seat booking — see §3.10.

### 3.4 Roles & AuthZ
`SUPER_ADMIN` · `ADMIN` · `USER` · `SCANNER`. Every route is wrapped by `authenticate` then
`authorize(...roles)`. No route is public except `POST /auth/login` and `POST /auth/refresh`.

**Two admin tiers (separation of duties)** — both live in the `admins` collection:
- **SUPER_ADMIN**: units, USER personnel and admin accounts (create/edit/delete). Read-only on
  movies & auditorium. Seeded by `npm run seed:admin`.
- **ADMIN** (operational, created by a super admin): movies, auditorium, seat allocation and
  scanner operators. Read-only on units & USER personnel; cannot manage admin accounts.
- **Both** see reports, audit, attendance and the dashboard.
- Personnel writes are enforced by *target* role in the controller: USER personnel are
  SUPER_ADMIN-only, while SCANNER operators may be managed by either tier. The admin frontend
  (`lib/role.ts` → `useRole()`) hides controls to match, but the server is the source of truth.

### 3.5 Auth Flow
- Login → bcrypt verify → issue short-lived **access JWT** (in-memory on client) + **refresh
  token** set as `HttpOnly` `Secure` `SameSite` cookie.
- **Each app gets its OWN refresh cookie** — `refresh_token_admin` / `_user` / `_scanner`.
  Cookies are keyed by (name, domain, path) and **ignore the port**, and in production all
  three SPAs talk to the same API host, so a single shared name meant one slot: signing into
  one app overwrote the others' cookie, and reloading then rotated the wrong app's token,
  returned the wrong role and made the client log itself out. Each app declares its audience on
  `POST /auth/refresh`, and `rotateRefresh` **rejects a token belonging to another app**.
- Refresh tokens are **rotated**: each use revokes the old and issues a new one in the same
  `family`. Reuse of a revoked token revokes the entire family (theft detection).
- Logout revokes the active refresh family. It is authorized by **possession of the refresh
  cookie**, not by the access token (`authenticateOptional`) — requiring a live access token
  meant an idle tab whose 15-minute token had lapsed got a 401, cleared its local state, and
  left the refresh family alive server-side for its full 7-day lifetime.
- Refresh tokens are stored **hashed** (never plaintext) in `refreshtokens`.
- Cookie attributes are env-driven: `COOKIE_SECURE`, `COOKIE_DOMAIN`, and **`COOKIE_SAMESITE`**
  (`strict` for same-site / one origin; **`none` + `Secure=true`** for cross-site hosting such
  as apps on Vercel + API on Render).
- Rotation is **resilient to the reload / two-tab race**: a just-rotated token is accepted only
  within a **30 s grace window** and re-issues a fresh token, so legitimate sessions are never
  spuriously logged out. Presenting a rotated token **after** the grace window is treated as
  **reuse of a leaked token → the whole family is revoked**. A token revoked without a successor
  (logout) or an unknown/expired token is rejected outright.

### 3.5.1 Security hardening
> **Note on the login limiter:** `loginLimiter` allows **10 attempts per 15 minutes keyed by
> mobile number** (not by IP, so one person can't lock out a shared gateway). Automated scripts
> that log in repeatedly will hit it and receive a `LOGIN_RATE_LIMITED` 429 whose body has no
> `accessToken` — that is the limiter working, not a bad credential.
>
> **Verified by probe, not just by reading the code:** no `passwordHash` / `tokenHash` /
> blind-index field appears in any live API response; every admin route 401s without a token;
> no backend secret is present in any built frontend bundle; the only client-side storage is
> the theme preference (access tokens stay in memory, refresh tokens in an HttpOnly cookie);
> and error stack traces are returned **only** when `NODE_ENV !== 'production'`.

- **Field encryption at rest** (`utils/fieldCrypto.ts`): **mobile numbers** (admins/scanners/
  users + spouse mobiles) and **unit names** are stored **AES-256-GCM** encrypted. Each field
  carries a keyed **HMAC blind index** (`mobileHash`/`spouseMobileHash`/`nameHash`, added by the
  `applyFieldEncryption` plugin) for equality lookups (login, spouse login) and uniqueness. A
  Mongoose **getter decrypts on read** and a save/insertMany hook **seals on write**, so services
  and the API see plaintext while the DB only holds ciphertext. Keys derive from
  **`FIELD_ENCRYPTION_KEY`** (scrypt → separate AES + HMAC keys). Trade-off: mobile/unit-name
  search is **exact-match** (blind index), not substring.
- **JWT** access tokens are pinned to **HS256** on sign and verify (no algorithm confusion).
- **Logs** never contain secrets: request logging is reduced to method/url/status in every
  environment, and the base logger redacts `authorization`/`cookie`/`set-cookie` + token fields.
- **Rate limits are per-identity where it matters**: login is keyed by **mobile** and booking/
  scan by **user id** (not IP), so a shared-NAT network can't lock everyone out and IP rotation
  can't bypass; a global per-IP baseline still applies. Failed logins are audited (`LOGIN_FAILED`).
- **Search** input is escaped before use in Mongo `$regex` (no regex injection / ReDoS);
  `express-mongo-sanitize` strips `$`/`.` operators; all input is Zod-validated.
- **Socket.io** authenticates the handshake (access token in `auth.token`) — no anonymous
  subscribers to the live seat map.
- **Passwords**: new passwords require ≥ 8 chars (login still accepts existing 6-char ones);
  bcrypt(12); stored `select:false`; access tokens live only in memory on the client.

### 3.6 Concurrency & Anti-Oversell (critical)
Seat issuance must never oversell. Strategy:
1. Booking creation runs inside a **MongoDB transaction** (`session`).
2. Quota decrement uses an **atomic conditional update**:
   `findOneAndUpdate({ _id, $expr: { allocated - booked >= qty } }, { $inc: { booked: qty } })`.
   If it matches 0 docs → no capacity → abort. This is the guard against the
   "2 seats left, 10 concurrent clicks" race.
3. Movie-level `seatsBooked` guarded the same way.
4. **Idempotency:** every booking carries a client `idempotencyKey`; a unique index on
   `(user, idempotencyKey)` makes retries safe (duplicate insert → return existing booking).
5. Optimistic concurrency via Mongoose `versionKey` on mutable aggregates.

Standalone-Mongo note: multi-doc transactions need a replica set. `utils/transaction.ts`
detects support via the server `hello` command and **falls back to non-transactional
execution** on a standalone `mongod` (fine for local dev; the atomic conditional updates
still prevent oversell). Use a replica set / Atlas in production for full atomicity.

### 3.6.1 Runtime Settings

Three operational timings are editable by an **operational ADMIN** at Admin → Settings →
Timings, rather than requiring a redeploy: `visibilityLeadMinutes` (when booking opens),
`noShowGraceMinutes` (check-in grace) and `seatHoldSeconds` (hold while booking). Both admin
tiers can read them; only ADMIN may write, mirroring the movies/auditorium split. Every change
is validated against the same bounds in Zod and in the schema, and written to the audit log
with its before/after values.

They live in a single-document `settings` collection and are served by
`config/settings.ts` as a **synchronous in-memory cache** — `isMovieVisible`, seat holds and
the reconciliation jobs read them on hot paths and must not hit Mongo per call. The cache is
primed at boot, updated in-process on save, and re-read every 30 s. That last part matters
under PM2 cluster mode: a save handled by one worker reaches the others on their next re-read,
so a change is fleet-wide **within ~30 s**. The `*_MINUTES` / `SEAT_HOLD_SECONDS` env vars are
only **seed values** for the very first boot; changing them later has no effect on an existing
deployment.

### 3.6.2 Movie lifecycle (`MovieStatus`)

```
DRAFT ──allocations complete──> SCHEDULED ──window opens──> OPEN ──startTime──> POOL_RELEASED
                                                                                     │
                                                                                  end time
                                                                                     ↓
                                                                                 COMPLETED
        CLOSED / CANCELLED  ←── admin, from any pre-show state ──┘
```

| Status | Set by | Meaning |
|---|---|---|
| `DRAFT` | schema default on create | Created, not yet allocated. Not listed, not bookable. |
| `SCHEDULED` | `seat.service.setAllocations` once allocations equal capacity (or set directly by an admin) | Ready, waiting for its booking window. |
| `OPEN` | `jobs/openBooking.job.ts` at `startTime − visibilityLeadMinutes` | Booking window is live. |
| `POOL_RELEASED` | `jobs/openPool.job.ts` at `startTime` | Unused unit quota has moved to the common pool; anyone may book what's left. |
| `COMPLETED` | `jobs/reclaim.job.ts`, post-show sweep | Ran to its end time and has been retired. Terminal. |
| `CLOSED` / `CANCELLED` | admin, via `PATCH /movies/:id` | Ended early / called off. Terminal. |

Two rules keep this honest:

- **Status is a report, never a gate.** Bookability is decided per request by `isMovieVisible`
  against the clock; the stored status only says what the clock has already made true. This is
  why `OPEN` is safe to stamp on a one-minute tick — a movie whose window opens between ticks
  is bookable immediately regardless of what its status still says.
- **Guards that must not lag read the clock, not the status.** `setAllocations` refuses edits
  from `now >= startTime`, not from `status === POOL_RELEASED`: the pool-release job runs on a
  one-minute tick, and inside that gap a started movie is still `SCHEDULED`/`OPEN`, so a status
  check would wave the edit through and re-cut quota that has already been given away.

### 3.7 Scheduled Jobs (node-cron)
- **Open-pool release:** at `movie.startTime`, move each unit's unbooked quota into `poolSeats`.
- **Booking-window open** (`jobs/openBooking.job.ts`): flips `SCHEDULED → OPEN` once
  `startTime − visibilityLeadMinutes` passes, so a show that is actively selling stops being
  reported as merely scheduled. Display only — see §3.6.2. Runs *after* the pool release on each
  tick, so an already-started movie is never briefly marked `OPEN`.
- **Seat reclaim** (`jobs/reclaim.job.ts`): each ticket is judged against **its own** deadline,
  not one deadline for the whole movie, because the two cohorts differ:
  - booked **before** the show → deadline `startTime + noShowGraceMinutes`; missing it is a
    genuine no-show → `EXPIRED`;
  - booked **after** the show started (a walk-in taking a seat this job just freed) → deadline
    `bookedAt + noShowGraceMinutes`, so they get the same grace measured from their booking
    rather than being reclaimed on the next tick. Missing it is `RELEASED`, deliberately **not**
    a no-show — the holder was already in the building, and counting them would corrupt the
    only figure that means anything.

  Every deadline is **capped at the show's end time**, so no ticket is still awaiting check-in
  once the movie is over and the report becomes available. Reclaimed `MovieSeat` rows are freed
  (BOOKED → FREE) and **broadcast live**, so walk-ins can immediately re-grab them. A running
  movie is re-examined every tick; `noShowProcessedAt` is stamped only by the final post-show
  sweep, which also moves the movie to `COMPLETED` so a finished show stops presenting itself
  as still selling seats.
- **Seat-hold expiry (every 20s):** `MovieSeat` rows whose hold elapsed (`seatHoldSeconds`,
  default 120) → `FREE`, broadcast live (see §3.10).
Jobs are idempotent (safe to re-run); a missed tick reconciles on the next run.

### 3.10 Seat structure, rank gating & real-time (epic)
- **Auditorium layout** (singleton `auditoria` doc): the admin page **shows** the visual
  layout (screen + rank-tinted seat rows) read-only; an **Edit** button opens a **dialog** to
  modify it — **bulk add** N identical rows, plus per-row edit / duplicate / delete and add
  single row, saved together. Each row carries `allowedRanks` (empty = open to all). Units are
  no longer used for seat quotas.
- **Per-movie inventory:** a movie's seats are **auto-generated from the auditorium layout on
  create** (one `MovieSeat` per seat, `FREE`/`HELD`/`BOOKED`) — no manual step. A movie's
  **`totalSeats` is derived from the layout** (single source of truth; the create form shows it
  read-only; a manual value is only a fallback when no layout exists yet). `POST
  /seating/movies/:id/generate` still exists for an explicit rebuild before any seat is booked.
- **Rank gate:** a user may only hold/book a seat if their `rank` ∈ the seat's `allowedRanks`.
- **Allocation belongs to a movie, not to the nav.** There is no Seat Allocation page or route:
  saving a new movie opens its allocation dialog immediately, and an "Allocate seats" action on
  each movie row re-opens it later. Both use `features/seats/AllocateSeatsModal.tsx`, so the
  "total must equal capacity" rule lives in exactly one place. Allocation is **optional** —
  skipping leaves every seat in the common pool, which the dialog states explicitly.
- **Holds & concurrency:** selecting a seat issues a hold (`seatHoldSeconds`) via atomic
  `findOneAndUpdate` (FREE → HELD by user); booking flips own-HELD/FREE → BOOKED, also
  atomic, so two users can never claim the same seat. Booking creates the usual Booking +
  QR tickets (each carrying `seatLabel`). Idempotent on `(user, idempotencyKey)`.
- **Cancellation** frees the booked seats (BOOKED → FREE) and broadcasts the change live.
- **Booking window:** each movie has a `durationMinutes` (admin-set, default 180); its end
  time is `startTime + durationMinutes`. Movies are **shown to users early** (any upcoming
  show) but seats are only bookable **from `visibilityLeadMinutes` before start until the show's
  end time** (`isMovieVisible` / `bookingOpen` flag). The public payload also carries
  `bookingOpensAt`, since the lead is admin-configurable and a client must not derive it from a
  hardcoded constant. Combined with seat reclaim, seats that open up mid-show remain claimable
  until the end.
- **Admin `openToAll`** per movie: when set, any rank may book any seat (free-for-all),
  ignoring per-seat rank restrictions.
- **Real-time:** a **socket.io** gateway (`realtime/gateway.ts`) attached to the HTTP server;
  clients join room `movie:<id>` and receive `seats:update` events on every hold / release /
  book / expiry, so all viewers see live availability.

### 3.8 Audit Logging
`audit(action, metadata)` middleware/helper writes append-only entries for: login, logout,
movie/unit/personnel creation, booking creation/cancellation, ticket verification. Captures
user, action, timestamp, IP, metadata.

### 3.9 Security Middleware Pipeline
`helmet` → `cors(whitelist)` → `compression` → body parser (size-limited) →
`mongo-sanitize` → per-route `rateLimit` (login/booking/scanner buckets) → `validate(zod)`
→ `authenticate` → `authorize`.

## 4. Frontend Architecture
Three standard **web apps** (not PWAs). React 19 + Vite + TS + Tailwind + React Router +
Zustand + TanStack Query + React Hook Form + Zod + Axios + Sonner + Lucide. The user app
also uses **socket.io-client** (live seat map) and the scanner uses **html5-qrcode**.
Feature-based folders; reusable `components/`, `hooks/`. Admin is desktop-first (light+dark);
user + scanner are mobile-first.

### 4.1 Admin design system
A soft-SaaS look: a light neutral canvas (`--bg`) with white cards floating on it, hairline
borders, `rounded-2xl` cards / `rounded-xl` controls, and a `shadow-soft` lift rather than a
visible drop shadow. Every colour is a CSS variable in `index.css`, so **dark mode is a token
swap** — no component carries a per-theme branch. The theme defaults to **light** and does not
follow the OS preference; an admin who toggles it has that choice persisted
(`localStorage.admin-theme`). The shell is a grouped sidebar (workspace mark, section labels,
account card) plus a breadcrumb topbar. Cards are uniform throughout, dashboard KPI tiles
included — one card treatment, no per-section decoration.

**Icon-only controls always carry a `Tooltip`** (`components/ui/Tooltip.tsx`) — row actions,
pagination arrows, layout-editor buttons. It portals to `document.body` with fixed positioning
rather than rendering an absolutely-positioned child, because `Table` wraps its rows in
`overflow-hidden` + `overflow-x-auto`, which clips an in-flow tooltip; and its listeners sit on
a wrapper span so the label still appears for a **disabled** button, which fires no pointer
events of its own. That last part is the point of the pattern: every locked control (edit after
booking opens, allocate after showtime, delete-your-own-account) explains *why* it is locked.

Shared traits across all three apps: compact rounded controls, password-reveal toggles, and **numeric inputs with no spinner arrows that can be fully cleared while typing**
(`NumberInput`). The user app's bottom `Sheet` stays mounted for one transition after it
closes (and keeps rendering its last children) so the panel animates back down instead of
vanishing; callers pass `open={!!selection}` from **one** `Sheet` element rather than
unmounting it or returning a different element per branch. Opening waits **two** rAFs before
flipping the transform — one is not enough, since that callback still runs before the paint of
the frame the panel mounted in, landing both the open and closed positions in a single paint
and skipping the animation entirely.
**No React.StrictMode** in the web apps (its dev double-mount broke
refresh-token rotation and the camera). Access token in memory; silent re-auth via cookie.
Only one frontend env var: **`VITE_API_URL`** (build-time). It's normalized to **tolerate
being set with or without the `/api/v1` suffix** (auto-appended if missing). Every mobile-
number input is **strictly digits-only, capped at 10** (`onlyDigits10` / `mobileField`).

## 5. Environment & Config
All config via env, validated by Zod at boot (`config/env.ts`) — process exits on invalid
config. See `apps/backend/.env.example`.

## 6. Build / Verify Gates (per milestone)
1. App runs · 2. `tsc --noEmit` clean · 3. lint clean · 4. tests green · then update docs.

## 7. Current Status
**All milestones + change requests + the seat epic are complete and verified** — backend
**23/23 tests** (incl. throughput/contention benchmark, refresh-reuse detection, at-rest field
encryption), **tsc + eslint clean**; admin/user/scanner all build + lint clean.

Backend (auth, units, personnel, movies, seats/quota, **seating**, bookings, attendance,
audit, reports, admins) + cron jobs + socket.io + security pipeline. Admin Portal, User app,
Scanner app done. **Docker removed** — deploy via PM2 + Atlas (or a local replica-set mongod).

Notable post-build changes folded in:
- **Account collections split** (`admins`/`scanners`/`users`) with **per-collection mobile
  uniqueness** — the same mobile can be an admin, scanner **and** user; login is **role-scoped**
  (each app sends its `role`). Refresh tokens carry `role`; audit uses polymorphic `refPath`.
- **Movie duration / booking window**: movies carry `durationMinutes`; booking stays open until
  the show's end time. **No-shows** (unscanned 15 min after start) are expired and their seats
  **freed live** so walk-ins can re-book mid-show.
- **No logout on refresh.** Root cause was the refresh cookie being set with `Domain=localhost`
  — browsers reject `Domain=localhost`, so the cookie was never stored and never sent back on
  reload (all three apps logged out on every refresh). Fixed by emitting a **host-only cookie**
  (the cookie's `Domain` is omitted for a blank or `localhost` `COOKIE_DOMAIN`). Hardening on top:
  **resilient refresh rotation**, **no StrictMode** in the web apps, and the 401 interceptor +
  app-load bootstrap share **one deduped `refreshSession()`** so a protected-page reload can't
  fire two concurrent `/auth/refresh` calls.
- **Spouse dual-credential login** (shared family account, same password).
- **Personnel ranks** (Officer/JCO/JAWAN); **unit `code`/`description` removed**.
- **Movie lifecycle** (§3.6.2): edit/delete locked once booking opens (`start − 1h`), unit
  allocations frozen at showtime, and a movie with any booked ticket cannot be deleted at all
  (the admin hides the button rather than disabling it — no admin action can unlock it).
- **Booking quantity capped** to remaining family allowance; **password reveal** toggles.
- **Rank-based seat structure + live seat booking** (§3.10): auditorium designer, per-movie
  seat generation, rank-gated holds, 2-min hold expiry, socket.io live map, seat-picker UI.
- Admin: **Settings** page (my-account edit + change password, **admins list** with
      create/edit/delete dialogs), **card-click dialogs** on reports & allocation, **PDF report
      download** (jsPDF), **dashboard** with upcoming movies + recent bookings, a **visual
      Auditorium page** (shows the centred layout; **Edit** opens a dialog showing the layout
      where you click a row to edit/duplicate/delete, plus bulk add), **personnel editing**
      (rank / marital / spouse / kids / active / reset password) and **bulk personnel import
      from an Excel/CSV upload** (parsed client-side via SheetJS → `POST /personnel/bulk`,
      per-row error report + downloadable template), **movie editing** (locked once booking
      opens) and a per-movie **"Open to all ranks"** toggle, plus a per-movie **Details dialog**
      (eye icon in the Movies table) showing the **seat layout with who booked each seat**
      (mobile / rank / unit), checked-in state, and the full bookings list (`GET
      /seating/movies/:id/detail`).
- User app: browsable without login, **bottom-drawer login**, **profile page**, District-style
      movie cards, **floating pill nav**, seat-map booking (rapid double-taps de-duped via an
      in-flight guard). Movies shown early with **`bookingOpen`** flag; user sees "Booking opens
      at …" when not yet bookable, and the movie stays listed/bookable until its end time.
- Per-movie **`openToAll`** admin toggle bypasses rank-gating on seat booking.
- Scanner: movie list → live scan → result bar (auto-dismiss 3s), robust camera w/ fallback.

Deploy: PM2 `ecosystem.config.cjs` (cluster mode) for the API; apps served by any static host
(Vite build output). Dev: root `npm run dev` interactive launcher. See README.

### 7.1 API surface (`/api/v1`)
- `auth`: login / refresh / logout / me / **change-password**
- `units` reads (both tiers) / writes (**SUPER_ADMIN**) · `personnel` reads (both) / USER writes
  (SUPER_ADMIN) / SCANNER writes (both) · `admins` list/create/edit/delete (**SUPER_ADMIN**, create
  takes a `role` of ADMIN\|SUPER_ADMIN)
- `movies` reads (both admin tiers) / writes create-edit-delete (**ADMIN** only) + `/movies/available`
  (public, returns `bookingOpen`) + `/movies/scanner` (SCANNER)
- `seat-allocations` (legacy quota, PUT/GET per movie — ADMIN)
- **`seating`**: `GET /seating/auditorium` (both) · `PUT /seating/auditorium` (**ADMIN**) ·
  `POST /seating/movies/:id/generate` (ADMIN) · `PATCH /seating/movies/:id/open-to-all` (ADMIN) ·
  `GET /seating/movies/:id/detail` (both admin tiers — layout + per-seat booker + bookings list) ·
  `GET /seating/movies/:id/seats` · `POST …/hold` · `…/release` · `…/book` (USER)
- `bookings` (create/list/get/cancel + `/bookings/allowance/:movieId`, USER)
- `attendance/verify` (SCANNER) + `/attendance/movies/:id/summary`
- `audit-logs` (ADMIN, staff-only + actor filter) · `reports/overview` + `reports/movies/:id`
  (per-unit numbers are computed from actual bookings → `unitBookings: [{ unit, booked,
  checkedIn }]`, since the legacy quota table is unused in the seat-based model)
- `personnel/bulk` (Excel/CSV import) · `seating/movies/:id/open-all` (ADMIN)
- **WebSocket**: socket.io at `/socket.io`; room `movie:<id>`; event `seats:update`.
