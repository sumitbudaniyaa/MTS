# Auditorium Booking System — Task Tracker

> Mandatory living doc. On every completed task: mark it `[x]`, add newly discovered tasks,
> keep in sync with `architecture.md`. Multiple AI agents rely on this being accurate.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done

## M0 — Scaffold & Docs
- [x] Inspect environment (Node 24, npm 11; Docker/Mongo not local yet)
- [x] `architecture.md` created
- [x] `todo.md` created
- [x] Decision: frontends are plain web apps, NOT PWAs (admin desktop-first; user+scanner mobile-first)
- [~] Backend project scaffold (`apps/backend`)

## M1 — Backend Foundation ✅
- [x] `package.json`, `tsconfig.json`, strict TS, ESLint, `.env.example`, `.gitignore`
- [x] `config/env.ts` (Zod-validated env, exit on invalid)
- [x] `config/db.ts` (Mongoose connect + events)
- [x] `config/logger.ts`
- [x] `app.ts` security pipeline (helmet, cors whitelist, compression, sanitize, rate limit)
- [x] `server.ts` bootstrap + graceful shutdown
- [x] error / notFound middleware, `ApiError`, `asyncHandler`
- [x] Health endpoint + verify boot (smoke: /health 200, 404 envelope OK, typecheck clean)

## M2 — Data Models ✅
- [x] `unit.model.ts`
- [x] `user.model.ts` (personnel/admin/scanner; derived familySize via pre-validate hook)
- [x] `movie.model.ts` (status enum, `isVisible()`, seatsBooked/poolSeats, job bookkeeping)
- [x] `seatAllocation.model.ts` (allocated/booked/released, unique movie+unit)
- [x] `booking.model.ts` + embedded ticket subdoc (states, unique QR code, idempotency index)
- [x] `auditLog.model.ts` (append-only, createdAt-only)
- [x] `refreshToken.model.ts` (hashed token, family, rotation fields, TTL purge)
- [x] `constants/enums.ts` (MovieStatus, TicketStatus, BookingSource, MaritalStatus, AuditAction)
- [x] Typecheck clean

## M3 — Auth & Validation ✅
- [x] `utils/password.ts` (bcrypt), `utils/jwt.ts` (access JWT + opaque rotating refresh)
- [x] `middleware/validate.ts` (Zod), `middleware/auth.ts` (authenticate + authorize roles)
- [x] `modules/auth` login / refresh (rotation + reuse detection) / logout / me
- [x] Audit hooks for login/logout (`modules/audit/audit.service.ts`)
- [x] Login rate limiter
- [x] Seed script for first ADMIN (`npm run seed:admin`)
- [x] Test harness (vitest + mongodb-memory-server **replica set** for txns)
- [x] Auth integration tests green (login, /me, rotation, reuse detection, authz) — 3/3

## M4 — Core Domain APIs ✅
- [x] Units CRUD (ADMIN) + referential-integrity delete guard
- [x] Personnel CRUD (ADMIN) — server-computed familySize, USER/SCANNER, never leaks hash
- [x] Movies CRUD (ADMIN) + `GET /movies/available` visibility window (`startTime - 1h`) for USER
- [x] Seat allocation (transactional bulk set) + validation: sum(allocations) == totalSeats
- [x] Shared `id` serialization transform (drops `_id`/`__v`, strips secrets)
- [x] Domain tests green (familySize derivation, allocation sum, visibility+bookingOpen) — 3/3

## M5 — Booking Engine (critical concurrency) ✅
- [x] Booking service with MongoDB transaction (`withTransaction`)
- [x] Atomic conditional quota guard + movie-seat capacity guard (no oversell)
- [x] Open-pool path (atomic `poolSeats` decrement) when movie is POOL_RELEASED
- [x] Idempotent booking creation (unique user+idempotencyKey; concurrent dup resolves to winner)
- [x] Server-side validation: family limit, unit quota, visibility, status, availability
- [x] Booking history + get-one + cancellation (releases seats to quota/pool, pre-showtime)
- [x] Booking rate limiter + audit (create/cancel)
- [x] Concurrency tests: 10 users/2 seats → exactly 2; idempotency; family limit — 3/3 ✅

## M6 — Jobs & Attendance ✅
- [x] Open-pool release job at startTime (idempotent, transactional, `poolReleasedAt` guard)
- [x] No-show expiry job at startTime+grace (idempotent, releases seats to pool)
- [x] node-cron scheduler (every minute, serialized, started in bootstrap, stopped on shutdown)
- [x] Scanner ticket verification → atomic CHECKED_IN (race-safe, no double check-in)
- [x] Attendance summary endpoint + scanner rate limiter + audit (TICKET_VERIFY)
- [x] Audit-log viewer endpoint (ADMIN, paginated/filterable)
- [x] Reports: dashboard overview + per-movie report (ADMIN)
- [x] Jobs/attendance tests (pool release, no-show expiry, verify+re-scan+unknown) — 3/3 ✅

## M7 — Tests (critical coverage complete; expand over time)
- [x] Test harness (vitest + mongodb-memory-server replica set)
- [x] Auth tests (login, rotation, reuse detection, authz)
- [x] Booking concurrency / oversell tests (10 users / 2 seats, idempotency, family limit)
- [x] Seat allocation validation tests (sum == capacity)
- [x] Ticket verification tests (check-in, re-scan reject, unknown)
- [x] Open-pool tests (release + idempotency)
- [x] No-show expiry tests (expiry + seat return + idempotency)
- [ ] (future) cancellation, open-pool booking path, audit-log/report endpoint tests
- [ ] (future) CI workflow + coverage thresholds

## M8 — Admin Portal (web, desktop-first, light/dark) ✅
- [x] Scaffold (Vite + React 19 + TS + Tailwind) + minimalist black/white design system
- [x] CSS-variable light/dark theming + toggle; Inter font; soft blue/green/amber accents
- [x] API client (axios) with in-memory access token + transparent refresh-on-401 (shared)
- [x] Zustand auth + theme stores; TanStack Query; Sonner toasts on every mutation
- [x] Silent re-auth on load (refresh cookie); ADMIN-only guard; protected routes + layout
- [x] Login page (RHF validation)
- [x] Dashboard (overview stats), Units CRUD, Personnel CRUD (family fields), Movies CRUD
- [x] Seat Allocation editor (live sum-vs-capacity), Reports (per-movie + **PDF download**), Audit Logs (filter)
- [x] **Settings page**: my-account edit dialog (name + change password) + administrators list with create/edit/delete dialogs
- [x] Reusable UI kit: Button, Input/Select, Modal/ConfirmDialog, Table/Pagination, Badge,
      Card, Loading/Empty/Error states; search + debounce + pagination
- [x] Verified: tsc clean, `vite build` succeeds, eslint clean
- [ ] (pending) live end-to-end run against API — comes with M11 docker-compose (needs Mongo)

## M9 — User App (web, mobile-first) ✅
- [x] Scaffold (Vite+React19+TS+Tailwind), mobile-first single-column + bottom nav
- [x] Auth (USER-only guard), silent re-auth, login page
- [x] Available movies list (only visible movies; NO unit/family/internal fields shown)
- [x] Booking flow (bottom sheet, quantity stepper, idempotency key via crypto.randomUUID)
- [x] My Tickets: booking history + per-ticket QR (qrcode.react) + status + cancel
- [x] Verified: tsc clean, vite build (120 KB gz), eslint clean

## M10 — Scanner App (web, mobile-first) ✅
- [x] Scaffold (Vite+React19+TS+Tailwind), high-contrast dark theme, large touch targets
- [x] Auth (SCANNER-only guard), silent re-auth, login page
- [x] Camera QR scanner (html5-qrcode) with big scan area + pause-after-hit
- [x] Verification -> large success/fail result screen + "Scan next"
- [x] Manual code-entry fallback + online/offline indicator (offline-friendly UI)
- [x] Verified: tsc clean, vite build, eslint clean

## M11 — Infra ✅  ⚠️ SUPERSEDED — Docker was later REMOVED (see "Post-build change requests").
## Deploy is now PM2 + Atlas / local mongod. The Docker items below are historical only.
- [x] Backend Dockerfile (multi-stage, non-root, prod-only deps)
- [x] Web app Dockerfiles (vite build -> nginx) + SPA fallback + `/api` reverse proxy
- [x] docker-compose: Mongo single-node **replica set** (auto-initiated via healthcheck),
      backend (healthcheck), one-shot `seed` service, admin/user/scanner
- [x] Env-based config + root `.env.example`; CORS whitelist wired for app origins
- [x] PM2 `ecosystem.config.cjs` (cluster mode) for non-Docker production
- [x] README full-stack quickstart; compose validated as YAML
- [ ] (pending host with Docker) live `docker compose up` smoke run

## Post-build change requests (done)
- [x] **Accounts split into separate collections**: `admins`, `scanners`, `users` (personnel).
      Cross-collection login via `account.service`; refresh tokens store `role`; audit uses
      `refPath` (`userModel`); reports/personnel/attendance updated. Seed -> `admins`.
- [x] **Docker removed** (compose, Dockerfiles, nginx, dockerignore, root compose .env). Atlas
      / local Mongo only. `runInTransaction` helper degrades gracefully on standalone Mongo.
- [x] Backend: movie **poster upload** (base64 data URL, 8mb body limit), **inline allocations**
      on movie create, **change-password** endpoint, **scanner movie list** (`GET /movies/scanner`).
- [x] **Design overhaul** across all apps: compact rounded minimal buttons/inputs, brand logos removed.
- [x] **User app**: browsable without login; **bottom-drawer login**; header = single account
      button -> profile drawer (details + change password + sign out).
- [x] **Scanner app**: movie list -> tap -> continuous scan with result bar at bottom
      (Verified / Already used / Expired / Invalid).
- [x] **Admin**: movie create modal with poster file upload + inline per-unit seat allocation.
- [x] Verified: backend tsc+lint+12 tests; all three apps build + lint clean.

## Developer Experience
- [x] Root `npm run dev` interactive arrow-key launcher (presets: all / admin / user /
      scanner / backend) — colour-prefixed interleaved output, Ctrl+C stops all
- [x] Backend loads `.env` via dotenv; launcher auto-creates it on first run + Mongo hint
- [x] Root `package.json` with `install:all` helper

## Newly Discovered
- [x] Seed script for an initial ADMIN user (needed to bootstrap the system)

## Future Epic — Seat structure + live seat booking (#12/#13) [DESIGN LOCKED]
Decisions (from user):
- **Rank-only permissions**: admin lays out auditorium rows/seats and assigns allowed RANKS
  (Officer/JCO/Jawan) per row/section. Any user of an allowed rank may book those seats.
  Units remain an org label only — NO per-unit seat quotas in the new model.
- **Real-time live seat map**: seats update instantly across users (websockets/SSE). A seat
  selected mid-booking is locked for 2 minutes, auto-released if not confirmed.
Implications: replace SeatAllocation(count-based) with an AuditoriumLayout (rows→seats, each
seat -> allowedRanks) + per-movie seat inventory (status: FREE/HELD/BOOKED, heldBy, holdExpiresAt).
Booking becomes seat-id based. Add WS gateway for seat events. No-show/open-pool logic recast
to seat level. Large, multi-milestone effort — build after quick wins (#1,#2,#10).

## Epic BUILT — Rank-based seat structure + live seat booking ✅
- [x] Models: `Auditorium` (rows/seats + allowedRanks), `MovieSeat` (per-movie inventory,
      FREE/HELD/BOOKED, heldBy/holdExpiresAt, ticketCode). Ticket carries `seatLabel`.
- [x] Seating service: layout CRUD, generateMovieSeats, rank-gated atomic hold/release/book
      (no double-claim), 2-min holds, expired-hold reclaim job (every 20s).
- [x] Real-time: socket.io gateway; clients join `movie:<id>`, receive `seats:update` on
      hold/release/book/expire.
- [x] Routes under `/seating`: GET/PUT auditorium, generate, seat map, hold, release, book,
      **toggle open-to-all** (admin).
- [x] Admin: **visual** Auditorium Designer (screen + rank-tinted seat rows, bulk "add N
      identical rows", click-to-edit/duplicate/delete) + "Generate seats" on movies.
- [x] Admin: per-movie **"Open to all ranks"** toggle on the Movies list (bypasses rank gate).
- [x] User: full seat-map picker (screen + rows), rank-restricted seats greyed, tap-to-hold
      with live updates + 2-min countdown, confirm booking; seat label on QR ticket.
- [x] 5 seat-engine tests (generate, no double-hold, rank gate, book, hold reclaim). 18 total.
- [ ] (future) recast no-show/open-pool to seat level; cancel-frees-seat; admin live seat view.

## Latest session — admin features & visibility rework
- [x] Backend: admin **PATCH** (edit name/active/password) + **DELETE** endpoints with guards
      (cannot self-delete, cannot remove last admin).
- [x] Admin Settings page: my-account edit dialog (name + change password) + administrators
      list with create / edit / delete dialogs + confirmation.
- [x] Reports **PDF download** (jsPDF + jspdf-autotable): seat summary, attendance, per-unit
      allocation tables → auto-downloads `report-<title>.pdf`.
- [x] Movie visibility rework: movies shown early (any upcoming SCHEDULED show), but
      **bookingOpen** flag gates seat booking to `VISIBILITY_LEAD` minutes before start.
      User UI shows a "Booking opens at …" pill when not yet bookable.
- [x] Per-movie **openToAll** flag (Movie model boolean, admin toggle, seating service
      rank-bypass): when true, all ranks may book any seat regardless of `allowedRanks`.
- [x] Updated domain test for new visibility/bookingOpen semantics. **18/18 tests green.**
- [x] All four apps verified: tsc clean, eslint clean, vite build succeeds.

## Latest session — booking window, auth hardening, movie detail, two-tier admin
- [x] User seat picker: **rapid double-tap de-dupe** (in-flight `pendingRef` + idempotent
      select) so double-tapping a seat can't register it twice.
- [x] Movies carry **`durationMinutes`** (endTime = start + duration); **booking stays open
      until the show ends** (`isMovieVisible` upper bound; `listVisibleMovies` keeps a movie
      listed until endTime). Admin movie form has a Duration field.
- [x] **No-show expiry frees the actual seats** (MovieSeat BOOKED→FREE + live broadcast) at
      `startTime + NO_SHOW_GRACE_MINUTES`, so walk-ins can re-book freed seats mid-show.
- [x] **Per-collection mobile uniqueness** + **role-scoped login** (each app sends its role):
      the same mobile can be an admin, a scanner AND a user independently.
- [x] **Logout-on-refresh fixed (all 3 apps):** root cause was `Domain=localhost` on the
      refresh cookie (browsers reject it). Cookie is now **host-only**; env default blanked.
      Hardening: shared deduped `refreshSession()` across bootstrap + 401 interceptor.
- [x] **Logout-on-refresh, second root cause (user + scanner apps):** all three SPAs shared a
      single `refresh_token` cookie — cookies are keyed by (name, domain, path) and ignore the
      port, so signing into one app overwrote the others' cookie; reloading then rotated the
      wrong app's token, got back the wrong role and the client logged itself out. Each app now
      owns a cookie (`refresh_token_user` / `_scanner` / `_admin`), declares its audience on
      `POST /auth/refresh`, and `rotateRefresh` rejects a token belonging to another app.
- [x] **Per-ticket seat reclaim** (`jobs/reclaim.job.ts`, replaces the one-shot no-show sweep):
      each ticket has its own deadline — `startTime + grace` for advance bookings (→ `EXPIRED`,
      a real no-show) and `bookedAt + grace` for walk-ins who took a seat after the show started
      (→ new `RELEASED` status, deliberately not counted as a no-show). Every deadline is capped
      at the show's end time. Previously the sweep ran once at `start + 15m` and never again, so
      a walk-in's unused seat was never reclaimed and permanently inflated attendance.
- [x] **Reports gated until the show ends** — mid-screening an unscanned ticket only means
      someone hasn't reached the door yet, so the numbers were misleading.
- [x] **Admin-editable timings** (`settings` singleton + `config/settings.ts` sync cache):
      booking lead, check-in grace and seat-hold duration are edited at Admin → Settings →
      Timings instead of via env + redeploy. Env vars are now first-boot seeds only. Cache is
      primed at boot, updated on save, and re-read every 30 s so PM2 cluster workers converge.
- [x] **"No-show" wording removed from every UI** (now "Not checked in" / "Released"); the
      underlying distinction is kept in the data so reports stay meaningful.
- [x] **User app movie grid**: 2-column poster cards without description; tapping one opens a
      bottom sheet with the details and the book action. `bookingOpensAt` is now sent by the API
      rather than derived from a hardcoded 60 minutes (the lead is configurable).
- [x] **Logout now actually revokes** (security): `/auth/logout` required an unexpired access
      token, so logging out from an idle tab 401'd — the UI cleared but the refresh family
      survived for 7 days and the app silently re-authenticated on reopen. Logout is now
      authorized by the refresh cookie via `authenticateOptional`.
- [x] **Test-suite flake fixed**: `test/setup.ts` now awaits every model's index build, so
      uniqueness assertions can't race a half-built index.
- [x] Admin **per-movie Details dialog** (eye icon) — seat layout with who booked each seat
      (mobile/rank/unit) + checked-in state + bookings list (`GET /seating/movies/:id/detail`).
- [x] **Booking throughput/contention benchmark** (`test/loadtest.test.ts`): ~467 bookings/sec
      no-contention, 300-user stampede on 10 seats → exactly 10 win, 0 oversell.
- [x] **Two-tier admin (separation of duties):** `SUPER_ADMIN` (units/personnel/admins; read-only
      movies/auditorium) vs `ADMIN` (movies/auditorium/ops + scanner operators; read-only
      units/USER-personnel). Personnel writes enforced by target role (USER=super only,
      SCANNER=both). Seed = SUPER_ADMIN; admins created with a tier selector. Role-aware admin
      UI hides controls (`lib/role.ts`). **20/20 tests, all apps build + lint clean.**
- [x] **Security hardening** (all High/Medium from the audit): log redaction (no tokens/cookies),
      refresh-token **reuse detection** (30 s grace → revoke family), rate limits keyed by
      mobile/user (shared-NAT safe), regex-escaped search, **authenticated socket handshake**,
      failed-login audit + 8-char password minimum, HS256-pinned JWTs, root `.gitignore`.
- [x] **At-rest field encryption** (`utils/fieldCrypto.ts`): mobiles (admins/scanners/users +
      spouse) and unit names stored **AES-256-GCM** + keyed **HMAC blind index** for lookup/
      uniqueness; Mongoose getter decrypts on read, save/insertMany hook seals on write; login,
      spouse login and uniqueness work via `*Hash`; search on those fields is exact-match. New
      `FIELD_ENCRYPTION_KEY` env var. **23/23 tests** (added at-rest encryption + reuse tests).
