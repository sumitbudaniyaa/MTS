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
├── realtime/        # socket.io gateway (live seat map + admin movie feed)
├── jobs/            # scheduler: booking-window open, open-pool, seat reclaim, hold expiry
├── utils/           # jwt, password, apiError, asyncHandler, ids, transaction (replSet-aware)
└── types/           # shared TS types, Express request augmentation
```

**Rule:** controllers are thin (HTTP in/out). All business logic + transactions live in
`*.service.ts`. Models never contain cross-aggregate logic.

### 3.3 Data Model (collections)

| Collection        | Purpose | Key fields |
|-------------------|---------|------------|
| `units`           | Army units | `name` 🔒(+`nameHash`), `loginMode` (`MOBILE`\|`USERNAME`), `active` |
| `admins`          | Admin accounts (separate collection) | `mobile` 🔒(+`mobileHash`), `passwordHash`, `role` (SUPER_ADMIN\|ADMIN), `name`, `failedLoginCount`, `lockedUntil`, `active` |
| `scanners`        | Scanner/operator accounts (separate collection) | `mobile` 🔒(+`mobileHash`), `passwordHash`, `role` (fixed SCANNER), `active` |
| `users`           | Personnel accounts only | `mobile` 🔒(+`mobileHash`), `username`, `serviceNumber`, `passwordHash`, `role` (fixed USER), `unit`, `rank` (OFFICER\|JCO\|JAWAN), `maritalStatus`, `spouseMobile` 🔒(+`spouseMobileHash`), `spouseUsername`, `numberOfKids`, `familySize` (derived) |

> 🔒 = **AES-256-GCM encrypted at rest** with a keyed HMAC blind index (`*Hash`) for lookup/uniqueness (§3.5.1).
| `movies`          | Shows | `title`, `description`, `poster` (URL or base64), `showDate`, `startTime`, `durationMinutes` (endTime = start + duration), `totalSeats`, `status`, `openToAll` (JCO→Jawan rank extension + pool release flag) |
| `settings`        | Admin-editable operational timings (singleton, fixed `_id`) | `visibilityLeadMinutes`, `noShowGraceMinutes`, `seatHoldSeconds`, `updatedBy` |
| `auditoria`       | Physical venue layout (singleton) | `name`, `rows[]` → `{ label, seats[] → { number, allowedRanks[] } }` |
| `movieseats`      | Per-movie seat inventory | `movie`, `row`, `number`, `label`, `allowedRanks[]`, `status` (FREE\|HELD\|BOOKED), `heldBy`, `holdExpiresAt`, `bookedBy`, `booking`, `ticketCode` |
| `seatallocations` | Rank-aware per-unit quota | `movie`, `unit`, `rank` (OFFICER\|JCO\|OR\|ALL), `allocated`, `booked`, `released` |
| `bookings`        | A booking = N tickets for one user/movie | `user`, `movie`, `quantity`, `source`, `idempotencyKey`, `tickets[]` |
| `tickets`         | One seat = one QR (embedded in booking) | `code`, `seatLabel`, `status`, `checkedIn`, `checkedInAt`, `checkedInBy` + `checkedInByModel` (refPath→Scanner\|Admin) |
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

**Two admin tiers (separation of duties)** — both live in the `admins` collection, and they
get **two different apps**, not one app with buttons hidden (see §4.2):
- **SUPER_ADMIN** — the desk work: units, USER personnel and admin accounts, the **auditorium
  layout** and the **operational timings**, plus reports and audit. Read-only on movies.
  Seeded by `npm run seed:admin`.
- **ADMIN** (operational, created by a super admin) — runs shows, from a phone at the venue:
  movies, scanner operators and **door check-in**. Read-only on units & USER personnel; cannot
  manage admin accounts, the auditorium or the timings.

> Venue *shape* (auditorium, timings) sits with SUPER_ADMIN rather than the operational admin:
> it is set-once policy, and the operational console is a handset. This was the reverse before
> — moving it kept the operational UI to three things without leaving the layout uneditable.
- **Reports, audit and the dashboard are SUPER_ADMIN-only.** The operational console is
  deliberately three things; attendance is visible through the door-scan result itself.
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
  A client that declares **no** audience is a frontend build from before this scheme: it can
  only ask for the legacy cookie, which no current login issues, so it 401s on every reload
  while a redeployed sibling app on the same browser works fine. Deploys drift, so the server
  falls back to the single per-app cookie in the jar when there is exactly one — and refuses
  when there are several, rather than guessing and handing one app another's session.
- Refresh tokens are **rotated**: each use revokes the old and issues a new one in the same
  `family`. Reuse of a revoked token revokes the entire family (theft detection).
- Logout revokes the active refresh family. It is authorized by **possession of the refresh
  cookie**, not by the access token (`authenticateOptional`) — requiring a live access token
  meant an idle tab whose 15-minute token had lapsed got a 401, cleared its local state, and
  left the refresh family alive server-side for its full 7-day lifetime.
- Refresh tokens are stored **hashed** (never plaintext) in `refreshtokens`.
- Cookie attributes are env-driven: `COOKIE_SECURE`, `COOKIE_DOMAIN`, and **`COOKIE_SAMESITE`**
  (`strict` for same-site / one origin; **`none` + `Secure=true`** for cross-site hosting such
  as apps on Vercel + API on Render). Boot **refuses to start** on `none` without `Secure`, or
  on `COOKIE_DOMAIN=localhost` — browsers discard both silently, which presents as "the app
  logs me out on refresh" with nothing in the logs.
- **The API is proxied through each app's own origin** (`vercel.json` rewrites `/api/v1/*` to
  the API host; `VITE_API_URL` is the relative `/api/v1`). This is not a convenience — it is
  what makes the refresh cookie **first-party**. Served cross-site, a `vercel.app` page holding
  an `onrender.com` cookie is a *third-party* cookie, and Safari/iOS block those outright: login
  succeeds, the browser then refuses to store or send it, and the session dies on every reload.
  It fails on phones while desktop Chrome works, so it looks like an app bug rather than a
  cookie-policy one. `SameSite=none` + correct CORS do **not** help — the block is unconditional.
  A side effect worth knowing: each app now owns a cookie on its own domain, so the shared
  cookie jar that forced per-app cookie *names* no longer exists (the naming stays, as the
  server still supports direct same-host deployments).
  **Sockets bypass the proxy** (`VITE_SOCKET_URL` → API host) because a Vercel rewrite does not
  carry a WebSocket upgrade. That stays cross-site safely: the handshake authenticates with the
  access token, not a cookie — which is also why the Vercel origins must stay in `CORS_ORIGINS`.
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

### 3.5.2 Audit findings & remediation (2026-08-08)

Reviewed: route auth coverage, IDOR, field exposure, secret handling, input validation, rate
limiting, dependency CVEs. Clean on all but the items below, all now **fixed** except where noted.

- **Audit trail now covers deletions and privilege changes.** `AuditAction` previously logged
  logins, creates, bookings, ticket verification and settings — so "who granted this person
  admin" and "who deleted this unit" were unanswerable, which is what an append-only trail
  exists for. Added and wired: `ADMIN_CREATE/UPDATE/DELETE`, `PASSWORD_CHANGE`, `PASSWORD_RESET`,
  `MOVIE_UPDATE/DELETE/OPEN_TO_ALL`, `UNIT_UPDATE/DELETE`, `PERSONNEL_UPDATE/DELETE`,
  `AUDITORIUM_UPDATE`, `SEAT_ALLOCATION_SET` — 24 actions recorded in total. Delete handlers read
  the target's name/title/tier **before** removing it, since an id alone tells a later reader
  nothing. Metadata never carries a password (only `passwordReset: true`) or a poster payload.
- **`POST /auth/refresh` and `/auth/logout` now check `Origin`.** Both authenticate purely by
  cookie and accept a bodyless POST, and in cross-site production the cookie is `SameSite=None` —
  so any page could fire a credentialed request. CORS stopped the attacker *reading* the new
  token (never account takeover), but the call still rotated the victim's token, and repeated
  calls trip reuse-detection into a forced logout. The Origin must now be in `CORS_ORIGINS`.
  A **missing** Origin is allowed: non-browser callers send none, and the attack needs a browser
  to attach the cookie — browsers always set Origin on a cross-origin POST.
- **Dependency CVEs: all clear.** `npm audit --omit=dev` reports **zero** for backend, admin,
  user and scanner. Cleared: `jspdf` (critical) + `jspdf-autotable` + `dompurify` via 2.x→4.x;
  **`xlsx`** (high, *no npm fix exists*) by pinning SheetJS's own CDN tarball, their documented
  remediation; `nanoid`, `socket.io-parser`, `body-parser` in place; **`node-cron` 3→4** and
  **`react-router` 6→7**, both majors that needed no source changes.
  > `node-cron` 4 was nearly reverted on false evidence: a probe waited for a `POOL_RELEASED`
  > status that no longer exists (the open-pool job was removed), so it looked like the
  > scheduler had stopped firing. Re-probed against `openBookingWindow` — which still exists —
  > it fires correctly. **Verify a scheduler upgrade against a job that is actually wired up.**
- **Previously (superseded):** Fixed: `jspdf` (critical) + `jspdf-autotable`
  + `dompurify` via a 2.x→4.x upgrade; **`xlsx`** (high, *no npm fix exists*) by pinning SheetJS's
  own CDN tarball, which is their documented remediation; `nanoid`, `socket.io-parser`,
  `body-parser` in place. **Remaining, both moderate and both needing a major upgrade:**
  `node-cron@3`'s vulnerable `uuid` (fix = node-cron 4.x) and `react-router@6` (fix = v7).
  > ⚠️ `npm audit fix --omit=dev` **prunes devDependencies from `node_modules`** — it removed
  > TypeScript and broke `npm run typecheck` until a plain `npm install` restored it. Use
  > `npm audit fix` and read the diff instead.
- **Deleting a movie cascades.** It used to remove only the movie row, orphaning its seat
  inventory (`movieseats`, one document per seat) and its `seatallocations` forever. Both are
  now deleted with it, and the create path's rollback cleans up too — seat generation can insert
  rows before it fails.
- **Still open by choice: no MFA, and no account lockout.** The login limiter (10 per 15 min,
  keyed by mobile) slows brute force but never locks. Acceptable for an internal tool; would not
  pass a formal review.

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

Three operational timings are editable by a **SUPER_ADMIN** at Settings → Timings, rather than
requiring a redeploy: `visibilityLeadMinutes` (when booking opens), `noShowGraceMinutes`
(check-in grace) and `seatHoldSeconds` (hold while booking). Both admin tiers can read them;
only SUPER_ADMIN may write, alongside the auditorium — see §3.4. The card shows the values
read-only behind an **Edit** dialog, so a keystroke is never a pending change to venue-wide
policy. Every change is validated against the same bounds in Zod and in the schema, and written
to the audit log with its before/after values.

**Clients must read these, never hardcode them.** Both once did, and both silently ignored the
setting: the admin Movies page computed its edit-lock window from a literal 60 minutes (so
raising the lead moved the server's rule while the page kept offering buttons that then 409'd),
and the user app's seat picker ran its countdown on a literal 120 s (so raising
`seatHoldSeconds` cleared the selection early and lowering it left seats looking held after the
server had freed them). The page now reads `/settings`, and the seat map ships `holdSeconds`
with every response. Anything new that depends on a timing must do the same.

They live in a single-document `settings` collection and are served by
`config/settings.ts` as a **synchronous in-memory cache** — `isMovieVisible`, seat holds and
the reconciliation jobs read them on hot paths and must not hit Mongo per call. The cache is
primed at boot, updated in-process on save, and re-read every 30 s. That last part matters
under PM2 cluster mode: a save handled by one worker reaches th### 3.6.2 Movie lifecycle (`MovieStatus`)

```
DRAFT ─allocations─> SCHEDULED ─window opens─> OPEN ───(end time)───> COMPLETED

        CLOSED / CANCELLED  <── admin, from any pre-show state
```

| Status | Set by | Meaning |
|---|---|---|
| `DRAFT` | schema default on create | Created, not yet allocated. Not listed, not bookable. |
| `SCHEDULED` | `seat.service.setAllocations` once allocations equal capacity (or set directly by an admin) | Ready, waiting for its booking window. |
| `OPEN` | `jobs/openBooking.job.ts` at `startTime − visibilityLeadMinutes` | Booking window is live. |
| `COMPLETED` | `jobs/reclaim.job.ts`, post-show sweep | Ran to its end time and has been retired. Terminal. |
| `CLOSED` / `CANCELLED` | admin, via `PATCH /movies/:id` | Ended early / called off. Terminal. |

Two rules keep this honest:

- **Status is a report, never a gate.** Bookability is decided per request by `isMovieVisible`
  against the clock; the stored status only says what the clock has already made true. This is
  why `OPEN` is safe to stamp on a one-minute tick — a movie whose window opens between ticks
  is bookable immediately regardless of what its status still says.
- **Guards that must not lag read the clock, not the status.** `setAllocations` refuses edits
  from `now >= startTime`: a started movie is no longer editable for quota allocation.

### 3.7 Scheduled Jobs (node-cron)
- **Booking-window open** (`jobs/openBooking.job.ts`): flips `SCHEDULED → OPEN` once
  `startTime − visibilityLeadMinutes` passes, so a show that is actively selling stops being
  reported as merely scheduled. Display only — see §3.6.2.
- **Seat reclaim** (`jobs/reclaim.job.ts`): each ticket is judged against **its own** deadline,
  not one deadline for the whole movie, because the two cohorts differ:
  - booked **before** the show → deadline `startTime + noShowGraceMinutes`; missing it is a
    genuine no-show → `EXPIRED`;arked `OPEN`.
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

### 3.9.1 Door check-in actors
`/attendance/verify` is open to **SCANNER and ADMIN**: an operational admin running a show can
work the door themselves without a second account. A ticket therefore records **who** scanned
it polymorphically — `checkedInBy` + `checkedInByModel` (`Scanner` | `Admin`), the same
`refPath` pattern as `auditlogs`. A hard `ref: 'Scanner'` would have stored an Admin id that
populates to `null`, silently losing the attribution.

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
- **The seat cap is the lesser of family size and unit quota**, resolved in one place
  (`seatAllowance()`) that the picker's counter, the hold check and the Confirm error all read,
  so they cannot report different numbers. A family of four facing a unit with one seat left
  sees `0/1`, not `0/4`. `unitRemaining` is `null` when quota does not apply (no allocations, or
  the pool has been released and quota is dissolved), in which case only the family limit binds.
  When a unit's allocation is spent its members get an explicit **"No seats left for your unit"**
  panel instead of a seat map where every tap is silently refused.
- **Booking refunds only what an attempt actually consumed.** `rollback` used to decrement the
  unit quota whenever the source was `UNIT_QUOTA` — including when the atomic guard had already
  *rejected* the booking and incremented nothing. A failed attempt therefore handed back the
  seat a different, successful booking was holding, and a retry then sailed through: two people
  booked against a one-seat allocation, and the counter read wrong. It now tracks `quotaTaken` /
  `poolTaken` per attempt. The same fix closed the opposite leak on the pool path, which
  decremented `poolSeats` and never refunded them on failure.
- **Family limit is enforced at HOLD time**, not only at booking. A hold is a seat nobody else
  can have, so leaving holds uncapped let one person tie up the auditorium a seat at a time and
  only discover the limit on Confirm. `seatAllowance()` counts **issued tickets + seats
  currently held**, and the seat map ships `allowance: { familySize, booked, canSelect }` so the
  picker shows `2/4 selected`, greys out further seats and never lets a doomed selection be made.
  Re-holding a seat you already hold is not a new seat and still succeeds.
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
- **Admin `openToAll`** per movie: when set, **JCO personnel may also book seats marked for
  Jawans** — a one-step-down rank extension. No other cross-rank access is granted: Officers
  cannot book Jawan/JCO seats, Jawans cannot book JCO/Officer seats.

  **Opening the pool is one-way.** The server refuses to close it (`409`). Once open, quota is
  dissolved and people book seats no unit's allocation accounted for; closing it would snap those
  quotas back over bookings they never counted, leaving units with headroom they had already
  spent. The admin UI offers no toggle back and confirms before opening, rather than promising
  something the server will reject.

  **It also dissolves unit quota, immediately — not at showtime.** Individual seats were never
  assigned to units (`movieseats` carries `allowedRanks` only), but the per-unit `seatallocations`
  quota caps how many a unit's members may take, and that cap is lifted the instant the flag is
  set: `seatAllowance` reports `unitRemaining: null` and bookings take the `OPEN_POOL` path, so
  a unit that had exhausted its allocation can book again straight away. Deferring this to the
  showtime pool release meant the button lifted rank gating at once while units stayed locked
  out for the hours in between — not what "open to all" means to anyone using it. Opening the
  pool computes unused quota immediately and credits `poolSeats` for reporting.

  **`poolSeats` is a counter, not the inventory, and never blocks a booking.** Seats are claimed
  atomically (`FREE -> BOOKED`), which is what actually prevents overselling; gating on the
  counter as well added no safety and two real outages — a movie whose allocation was skipped
  released 0 into the pool and refused every booking, and booking before a release would have
  done the same. It is decremented for reporting, floored at zero, and only what was genuinely
  decremented is refunded on failure.

  Flipping the toggle emits `movie:rules` to the
  movie's room, because `bookable` is computed server-side under the rule in force when the map
  was fetched; without it, anyone already on the seat picker keeps seeing stale locked seats
  until they reload.
- **Real-time:** a **socket.io** gateway (`realtime/gateway.ts`) attached to the HTTP server,
  with two rooms:
  - `movie:<id>` → `seats:update` on every hold / release / book / expiry, so all viewers of a
    seat map see live availability.
  - `movie:<id>` → `movie:rules` when an admin flips `openToAll`, so open seat maps re-read.
  - The **per-movie detail dialog** (`hooks/useLiveMovieDetail.ts`) joins both: `movie:<id>` for
    every hold/release/book/reclaim and `admin:movies` for job-driven counters. An admin opens
    that dialog precisely to watch a show fill up, so a snapshot frozen at open time is the wrong
    thing to show. Events are **coalesced into one refetch on a 400 ms timer** — the payload is
    the whole auditorium (seats + bookings + allocations) and a busy show emits bursts, so
    refetching per event would pull hundreds of rows repeatedly for one visible change.
  - `admin:movies` → `movie:update` carrying `{ movieId, status?, seatsBooked?, poolSeats?,
    openToAll? }`. **Joining is restricted to ADMIN/SUPER_ADMIN**, checked against the role on
    the handshake token (the seat map is fine for any signed-in user; this feed is not). It
    exists because almost every movie transition is made by a cron job rather than a person —
    the window opens, the pool releases, the show ends — so without it an admin sees a status
    frozen at page-load and reasonably concludes the system has stopped. The client patches its
    cached rows in place rather than invalidating, so one status change doesn't refetch every
    page of the table and a row can't jump pages under the reader's cursor
    (`hooks/useLiveMovies.ts`).

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
and the admin app use **socket.io-client** (live seat map / live movie list) and the
scanner uses **html5-qrcode**.
Feature-based folders; reusable `components/`, `hooks/`. Admin is desktop-first (light+dark);
user + scanner are mobile-first.

### 4.2 Two shells in the admin app
`App.tsx` picks a shell from the signed-in tier and declares **routes per tier** rather than
filtering one list — an ADMIN typing `/audit` lands back on their own home instead of reaching
a page that would 403 anyway.
- **`OpsLayout`** (ADMIN): mobile-first, a sticky header and a bottom pill with two tabs —
  Movies and Scanners. **Scan** is a button in the header (inverted, high-contrast) that opens
  a **standalone full-screen page** outside the shell — giving the camera the full viewport and
  keeping the pill bar from covering the result strip. The scan page has its own back button.
  Account actions (change password, sign out) live in a modal behind the header icon.
- **`AppLayout`** (SUPER_ADMIN): the desktop sidebar console. Below `lg` the sidebar becomes a
  **slide-in drawer** behind a hamburger icon — permanent 16rem chrome leaves a phone almost no
  room for the tables this console is made of. A scrim + auto-close-on-navigation keep it out of
  the way; the desktop layout is untouched. Dialog form grids (`grid-cols-2/3`) also stack on
  small screens.

Rendering waits for the silent re-auth to resolve before choosing: with the tier still unknown,
either shell would flash the wrong chrome and the console's catch-all would bounce an ADMIN off
`/scan` before their role arrived.

Both tiers share the movie and scanner pages, which render **cards below `md` and the table
above it** — a five-column table on a handset either scrolls sideways or crushes every column.

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

**A loading `Button` keeps its size and its colour.** The spinner is overlaid with the label
held in place but invisible, so the button cannot change width mid-action — prepending it grew
the button the instant it was pressed and pushed its neighbours around. Dimming is reserved for
genuinely disabled buttons; a busy one stays at full strength, since it is working rather than
unavailable.

Shared traits across all three apps: compact rounded controls, password-reveal toggles, and **numeric inputs with no spinner arrows that can be fully cleared while typing**
(`NumberInput`). The user app's bottom `Sheet` stays mounted for one transition after it
closes (and keeps rendering its last children) so the panel animates back down instead of
vanishing; callers pass `open={!!selection}` from **one** `Sheet` element rather than
unmounting it or returning a different element per branch. Opening waits **two** rAFs before
flipping the transform — one is not enough, since that callback still runs before the paint of
the frame the panel mounted in, landing both the open and closed positions in a single paint
and skipping the animation entirely.

**Modal scroll lock:** every `Modal` locks `overflow` + `touch-action` on `document.body`
while open and restores them on close. Without it, the page behind a dialog is scrollable on
phones (wider than the viewport), causing the dialog to drift horizontally.

**iOS input-zoom fix:** all three apps set `font-size: 16px` on form controls below `640px`.
iOS Safari zooms the viewport when a focused field is under 16px and never unzooms — the user
is left panning a magnified page.

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
**59/59 tests** (incl. throughput/contention benchmark, refresh-reuse detection, at-rest field
encryption, seat-hold family cap, rank-aware allocations, unit login modes, spouse credentials), **tsc + eslint clean**; admin/user/scanner all build + lint clean.

Backend (auth, units, personnel, movies, seats/quota, **seating**, bookings, attendance,
audit, reports, admins) + cron jobs + socket.io + security pipeline. Admin Portal, User app,
Scanner app done. **Docker removed** — deploy via PM2 + Atlas (or a local replica-set mongod).

Notable post-build changes folded in:
- **Rank-aware unit seat allocations & equal distribution**: `SeatAllocationModel` tracks quotas per unit and per rank (`${unit}:${rank}` composite key), ensuring allocations align strictly with rank allowances, with an inline "Distribute Equally Across Units" option in the Admin allocation modal.
- **Unit login modes (`MOBILE` / `USERNAME`)**: Units can specify their login authentication mode, supporting personnel logins via mobile or username/service number across User and Admin frontends.
- **Default password for personnel (`Pass@2026`)**: Personnel created manually or via Excel/CSV bulk import default to `'Pass@2026'` when a password is omitted.
- **Field encryption sparse index fix**: `fieldCrypto` sets unpopulated encrypted hashes to `undefined` rather than `null` so MongoDB sparse unique indexes disregard empty values (e.g. unpopulated spouse mobiles).
- **Super admin seed reset & unlock**: `seedSuperAdmin.ts` updates existing super admin passwords, resets failed login counters, and unlocks accounts.
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
      opens) and a per-movie **"Open to all"** toggle (allows JCO→Jawan cross-rank booking),
      plus a per-movie **Details dialog** (eye icon in the Movies table) showing the **seat layout
      with who booked each seat** (mobile / rank / unit), checked-in state, **per-unit allocation
      quota** (allocated / booked / released / remaining), and the full bookings list (`GET
      /seating/movies/:id/detail`). **Movie cards and table rows show the poster** (2:3 thumbnail
      with a film-glyph fallback). **Poster upload redesigned** into a drag-and-drop drop-target
      that becomes the preview (both create and edit forms).
- User app: browsable without login, **bottom-drawer login**, **profile page**, District-style
      movie cards, **floating pill nav**, seat-map booking (rapid double-taps de-duped via an
      in-flight guard). Movies shown early with **`bookingOpen`** flag; user sees "Booking opens
      at …" when not yet bookable, and the movie stays listed/bookable until its end time.
- Per-movie **`openToAll`** admin toggle: allows JCO to book Jawan seats (narrowed rank extension, not a full bypass).
- Scanner: movie list → live scan → result bar (auto-dismiss 3s), robust camera w/ fallback.

Deploy: Vercel (apps, each proxying `/api/v1` to the API — see §3.5) + Render (API) + Atlas;
or PM2 `ecosystem.config.cjs` for the API with apps on any static host
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
- **WebSocket**: socket.io at `/socket.io`; room `movie:<id>` → `seats:update`;
  room `admin:movies` (ADMIN only) → `movie:update`.
