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
