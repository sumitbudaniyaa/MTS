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
- [x] **Admin UI restyled** to the soft-SaaS reference (`uiinspo.png`): new token palette,
      `rounded-2xl` cards with `shadow-soft`, grouped sidebar with workspace + account cards,
      breadcrumb topbar. Purely visual — no route, prop or behaviour changes. Verified in a
      headless browser. Theme now defaults to **light** rather than following the OS.
- [x] **Admin Settings no longer hugs the left** — was `max-w-3xl`, then briefly a two-column
      grid (which left a hole beside the short account card); now full-width stacked sections.
- [x] **User app sheet polish**: smooth slide-up/down transition (respects
      `prefers-reduced-motion`), a close button, background scroll lock, and Change password
      now opens in that sheet instead of swapping the page content inline.
- [x] **Orphaned SUPER_ADMIN removed.** The seeded admin had been written under a *different*
      `FIELD_ENCRYPTION_KEY`, so its mobile could not be decrypted and its blind index could
      never match a login attempt — the account was unreachable and rendered as raw
      `enc:v1:…` ciphertext in the UI. Backed up to a gitignored
      `apps/backend/dead-admin-<id>.json` (the only way to recover the number if the old key
      ever resurfaces), then deleted along with its refresh tokens. Audit logs were kept —
      they are append-only by design. A working SUPER_ADMIN was seeded first and verified.
      ⚠️ `FIELD_ENCRYPTION_KEY` must never be rotated: doing so permanently orphans every
      encrypted mobile and unit name already in the database.
- [x] **Credential-leak sweep** (see `architecture.md` §3.5.1): confirmed no secrets in git
      history or tracked files, no real secrets in `.env.example`, no backend secret reachable
      in any built frontend bundle, no `passwordHash`/`tokenHash`/blind index in any live API
      response, every admin route 401s without a token, no tokens persisted client-side
      (localStorage holds only the theme), and stack traces are suppressed when
      `NODE_ENV=production`.
- [x] **Rank filter on unit personnel** — `GET /personnel?rank=` (Zod-validated against the
      `Rank` enum). Because rank is a USER-only attribute, supplying it excludes scanner
      accounts from the merge entirely, so the filter can't silently widen the result.
- [x] **Seat allocation is no longer a nav item.** It belongs to a movie, so it is reached
      from the movie: creating one opens the allocation dialog immediately, and an
      "Allocate seats" row action re-opens it afterwards. The `/allocations` route, its nav
      entry and `AllocationsPage.tsx` were deleted. Allocation stays optional ("Skip for now"
      on create, "Close" when editing); unallocated seats remain in the common pool. The
      editor lives in `features/seats/AllocateSeatsModal.tsx` and is the single place the
      "total must equal capacity" rule is enforced.
- [x] **Report shows when it will be available** — the 409 already carried the show's end time
      as `details.availableAt`; the Reports page now renders it as an absolute time plus a
      relative hint ("in 2 h") instead of a vague "come back later".
- [x] **Audit-log filter controls aligned** — the actor toggle was ~30px against a 40px
      select; both are now `h-10` / `rounded-xl`.
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
- [x] **Movie lifecycle completed end-to-end** (see `architecture.md` §3.6.2). Two statuses were
      unreachable, so a finished show sat at `POOL_RELEASED` forever and one that had opened for
      booking still read `SCHEDULED`:
      - new **`COMPLETED`** status, stamped by the reclaim job's post-show sweep alongside
        `noShowProcessedAt` — same transaction, same idempotency guard, no extra query;
      - new **booking-window job** (`jobs/openBooking.job.ts`) flips `SCHEDULED → OPEN` at
        `startTime − visibilityLeadMinutes`, finally writing the status the enum and every
        `$in` query already expected. Runs after the pool release each tick so a started movie
        is never briefly marked `OPEN`.
      Safe because status is a *report*, not a gate: bookability is decided per request by
      `isMovieVisible` against the clock, and all four `[SCHEDULED, OPEN, POOL_RELEASED]`
      queries already carried a time filter, so ended movies had been falling out by time
      anyway. `movieReport` gates on end time, so reports on finished shows are unaffected.
- [x] **Allocations freeze at showtime, by the clock rather than the status.** `setAllocations`
      checked `status === POOL_RELEASED`, but that status is stamped by a job on a one-minute
      tick — inside that gap a started movie is still `SCHEDULED`/`OPEN`, and the check waved
      the edit through, re-cutting quota the open-pool job had already handed to the pool. Now
      gated on `now >= startTime` (with `CLOSED`/`CANCELLED` still caught by status, since an
      admin can reach those before showtime). The admin mirrors it: the "Allocate seats" action
      is disabled after showtime with a tooltip saying why.
- [x] **A movie with booked tickets cannot be deleted.** `deleteMovie` only checked whether the
      booking window had opened — a proxy for the fact that actually matters. It now refuses
      outright when `seatsBooked > 0`, and the admin **hides** the delete button in that case
      rather than disabling it, since no admin action can unlock it. Delete after the window
      opens (with no bookings) stays disabled-with-tooltip, matching Edit.
- [x] **Tooltips on every icon-only admin control** (`components/ui/Tooltip.tsx`): movie row
      actions, unit/personnel/scanner/admin row actions, auditorium row duplicate+delete, and
      the pagination arrows (which had no label at all). Portals to `document.body` with fixed
      positioning — `Table` wraps rows in `overflow-hidden` + `overflow-x-auto`, which clips an
      in-flow tooltip — and listens on a wrapper span so **disabled** buttons still explain
      themselves, which is the whole point for locked controls. Replaced the native `title`
      attributes so there is no double tooltip. **33/33 tests green.**
- [x] **Bottom-sheet open animation fixed** (user app). The movie-details sheet appeared
      instantly while the change-password/login/tickets sheets slid up. Two causes, both fixed:
      `Sheet` waited a single `requestAnimationFrame` before flipping the transform, but that
      callback runs *before the paint of the frame the panel mounted in*, so both positions
      could land in one paint and the transition never ran — now a double rAF, which guarantees
      the closed position is painted first. And `MovieDetailsSheet` returned a *different*
      `Sheet` element from an early return instead of driving one element with `open={!!movie}`
      like every other caller. The poster `<img>` also got `decoding="async"`: posters are
      base64 data URLs and can be megabytes, and decoding one on the main thread stalls exactly
      the frame the slide-up needs.
- [x] **Seat map is zoomable and looks like an auditorium** (`SeatPickerPage`). Pinch-to-zoom
      (plus ctrl/⌘+wheel on desktop and a −/%/+ pill, where the % chip fits to width), 0.5×–2.4×,
      **auto-fitted on open** so a 20-seat row doesn't start half off-screen. Zoom scales the
      seat/gap/label sizes through CSS variables rather than applying a `transform: scale`, so
      the layout reflows, the scroll container's extents stay correct with no measuring, and
      seat numbers stay crisp instead of turning into blurred bitmaps. The gesture listeners are
      bound by hand with `{ passive: false }` — React registers touchmove/wheel as passive at
      the root, where `preventDefault` is a no-op, and the page itself can't pinch-zoom
      (`maximum-scale=1` in the viewport meta). Visually: a curved screen spanning the exact
      seat-block width with the light it throws fading over the front rows, seat-shaped keys
      (rounded shoulders, flat base), row letters in both gutters, and lifted/ringed selected
      seats. Taken seats went from near-black to a muted `fg/25` so the eye lands on what's
      still free.
- [x] **Open-pool release is now opt-in, tied to the "Open to all" button.** It fired at
      showtime for *every* movie, which quietly dissolved the per-unit split on every single
      show — the thing the allocations exist to express — and reported a "Common pool" figure
      for movies nobody had ever opened up. `releaseOpenPool` now requires `openToAll`, re-checked
      inside the transaction in case the admin toggles it back off mid-tick. A restricted movie
      keeps its quota for its whole run and never reaches `POOL_RELEASED`; flipping the toggle
      on later arms it for the next tick, including mid-show. The reclaim job was corrected to
      match: a no-show seat is always freed on the live map, but is only credited to `poolSeats`
      when the movie actually has a pool, so the report can't invent common-pool seats that no
      release ever created. **34/34 tests** (added: a movie never opened to all is left on its
      unit quota, then releases once the toggle flips).
- [x] **`clearCookie` never actually deleted the refresh cookie.** It passed `expires: undefined`,
      and Express merges the caller's options *over* its own `new Date(1)` default via
      utils-merge — an own property holding `undefined` still wins, so the attribute was dropped
      and the "delete" became an empty **session** cookie that lingered for the whole browser
      session. Now passes no `expires` key at all and lets Express expire it (also silences an
      Express deprecation warning that fired on every logout).
- [x] **Cookie misconfiguration can no longer fail silently.** `SameSite=None` without `Secure`
      is discarded by every browser, and a `Strict`/`Lax` cookie is never sent back from a
      cross-site frontend — both look exactly like "the app logs me out when I refresh", with
      nothing in the logs. Boot now refuses to start on `SAMESITE=none` + `SECURE=false` (and on
      `COOKIE_DOMAIN=localhost`), and login detects the cross-site case precisely from the
      request itself — comparing the caller's `Origin` against the API's own `Host` — warning
      once per process with the exact fix.
- [x] **Finished movies keep only the View action** in the admin movie list. For `COMPLETED`,
      `CLOSED` and `CANCELLED` there is nothing left to act on — quota is spent, edit and delete
      are already locked by the booking window, and "Open to all" can't change a screening that
      is over — so the row shows the eye alone.
- [x] **Movie row actions now follow the rule that actually applies to each one**, and all three
      are hidden rather than disabled, since no admin action reverses any of them:
      - **Delete** — shown for exactly as long as `seatsBooked === 0`; the first booking removes
        it for good. The server-side window check was dropped too: a show nobody booked is worth
        deleting whenever that becomes clear, including after its window opened or after it has
        been and gone. The ticket count is the only thing deletion can harm.
      - **Edit + Allocate** — hidden once the booking window opens, not merely greyed out.
        People are choosing seats against those numbers from that moment.
      - **Open to all** — stays available right through the screening (it is how an admin frees
        up a half-empty show mid-run) and disappears once the movie is `COMPLETED`/`CLOSED`/
        `CANCELLED`.
- [x] **Live movie updates in the admin console** (`admin:movies` room → `movie:update`).
      Almost every movie transition is made by a cron job rather than a person — the booking
      window opens, the pool releases at showtime, the show ends — so the list showed a status
      frozen at page load, which reads as the system having stopped. Emitted from all three jobs,
      the "Open to all" toggle, and seat booking (the first booking is what permanently removes
      the delete button, so the console has to see it). Joining the room requires ADMIN/
      SUPER_ADMIN, checked against the handshake token's role — the seat map is fine for any
      signed-in user, this feed is not. The client patches cached rows in place rather than
      invalidating, so one status change doesn't refetch every page of the table and a row can't
      jump pages under the reader's cursor. Verified end-to-end against a running server: an
      admin socket received `movie:update {status: POOL_RELEASED}` from a real scheduler tick,
      and a USER socket that emitted `admin:join` received nothing.
- [x] **Refresh survives a stale frontend deploy.** Per-app refresh cookies require the client
      to declare its app on `POST /auth/refresh`; a bundle built before that change sends no
      `role`, so the server could only offer it the legacy shared cookie — which no current
      login issues — and it 401'd on every single reload while a redeployed sibling app on the
      same browser stayed signed in. That asymmetry (admin fine, user + scanner logging out, on
      desktop as well as mobile, with correct cross-site cookie config) is the signature. The
      server now falls back to the one per-app cookie present when there is exactly one, and
      still refuses when several are — guessing there would hand one app another's session.
      **35/35 tests** (added: bodyless refresh succeeds with one app signed in, 401s with two).
- [x] **Mobile-only logout-on-refresh fixed: the API is now proxied through each app's own
      origin.** Symptom was user + scanner signing out on every reload on phones, while the
      admin app (used on desktop) was fine. Everything was correctly configured — verified
      against production: the deployed bundle sends its `role`, the API issues
      `refresh_token_user; Secure; SameSite=None`, and CORS returns
      `Access-Control-Allow-Credentials: true` for the exact origin. The browser was refusing
      the cookie anyway: `vercel.app` page + `onrender.com` cookie makes it **third-party**, and
      Safari/iOS block those by default while desktop Chrome still allows them. Each app's
      `vercel.json` now rewrites `/api/v1/*` to the API host and `VITE_API_URL` is the relative
      `/api/v1`, so the cookie is first-party to the app's own domain. Applied to all three apps,
      not just the broken two — admin only works today because Chrome hasn't finished its
      third-party cookie phase-out. Sockets keep pointing at the API host via a new
      `VITE_SOCKET_URL`, since a Vercel rewrite does not carry a WebSocket upgrade; that stays
      cross-site safely because the handshake uses the access token, not a cookie.
- [x] **The two admin tiers now get two different apps, not one app with buttons hidden.**
      - **ADMIN (operational)** gets `OpsLayout`: mobile-first, sticky header + bottom tab bar,
        three tabs — **Movies, Scanners, Scan**. No sidebar, no dashboard. Account actions
        (change password, sign out) live in a sheet behind the header icon, since those can
        never be someone else's job even though the Settings page moved away.
      - **SUPER_ADMIN** keeps the full desktop console and **gains the auditorium layout and the
        operational timings**. Those moved deliberately: shrinking ADMIN's UI to three things
        would otherwise have left the layout and timings uneditable by anyone, since SUPER_ADMIN
        was read-only on both. Venue shape is set-once policy; the operational console is a
        handset.
      - `App.tsx` declares **routes per tier** rather than filtering one list, so an ADMIN typing
        `/audit` lands back on their own home instead of a page that would 403 anyway. Shell
        choice waits for the silent re-auth: with the tier unknown, either shell would flash the
        wrong chrome and the console's catch-all would bounce an ADMIN off `/scan`.
- [x] **Door check-in from the admin console.** `/attendance/verify` now accepts **ADMIN** as
      well as SCANNER, so an operational admin running a show can work the door without a second
      account. A ticket's `checkedInBy` became **polymorphic** (`checkedInByModel`: Scanner |
      Admin, the same `refPath` pattern as `auditlogs`) — a hard `ref: 'Scanner'` would have
      stored an Admin id that populates to `null`, silently losing who checked the ticket in.
      The QR component is ported from the scanner app. **36/36 tests** (added: an ADMIN checks a
      ticket in and it is recorded against the Admin collection).
- [x] **Movies + Scanners are usable on a phone**: cards below `md`, the existing table above it
      — a five-column table on a handset either scrolls sideways or crushes every column. Row
      actions were extracted into one `actionsFor` helper shared by both layouts, so the
      visibility rules live in exactly one place. Two-column forms (new scanner, seat allocation)
      stack on small screens.
- [x] **Verified "open to all" already does everything asked, and locked it in with tests.**
      The request was: open-to-all should ignore unit *and* rank, and let a JCO take a JAWAN
      seat. All three were already true and the new tests pass against unchanged logic:
      `rankAllowed()` short-circuits on `openToAll`, and **unit never gated seat booking at
      all** — `movieseats` has no unit field, so seats are not assigned to units in the
      seat-based system. (The per-unit `seatallocations` quota is only enforced on the legacy
      `/bookings` path, which no app calls; it survives as reporting bookkeeping.) Added three
      regression tests: a JCO from an unrelated unit holds *and* books a JAWAN-only seat on an
      open-to-all movie; the same seat reads `bookable` on their seat map; and the rank gate
      still bites when the movie is not open to all — so the toggle stays meaningful.
- [x] **Toggling "open to all" now reaches open seat maps live** (`movie:rules` → room
      `movie:<id>`). `bookable` is computed server-side under whichever rule applied when the
      map was fetched, so anyone already sitting on the seat picker kept seeing seats greyed out
      until they reloaded — which looks exactly like "open to all didn't work" and is the most
      likely way to conclude the feature is broken. The user app re-reads the map on the event.
      **39/39 tests.**
- [x] **Admin mobile polish pass.**
      - **Button sizes are consistent across every dialog.** Movie/settings/unit/auditorium
        footers used `size="sm"` (32px) while the scanner form used the default (40px). Stripped
        the override from all 18 footer buttons rather than adding it to the odd one out: 32px
        is under the 44px touch guidance, and the footer is the one place every dialog agrees.
      - **The new-movie dialog no longer slides sideways.** `Modal` never locked the page behind
        it, so on a phone — where the page is often wider than the viewport — the body kept its
        own scroll and the dialog drifted under your thumb while typing. Now locks
        `overflow`/`touch-action` while open. Height also moved from `90vh` to
        `calc(100dvh-2rem)`: mobile browser chrome makes `vh` taller than the visible area, so a
        90vh dialog ran off the bottom.
      - **Movie cards and table rows show the poster** (2:3 thumbnail, film-glyph fallback so a
        row without artwork still aligns), for both tiers.
      - **Poster upload redesigned** (both create and edit forms): one large drop-target that
        becomes the preview, with Replace/Remove, drag-and-drop, and the size limit stated up
        front. It was a 12×16px thumbnail beside a text link — too small on a phone to tell one
        poster from another.
- [x] **No more zoom-on-focus in any app.** iOS Safari zooms the viewport when a focused field's
      text is under 16px and never zooms back out, leaving the user panning a magnified page.
      All three apps' `.input` was `text-sm` (14px). Form controls are now 16px below the `sm`
      breakpoint and keep the tighter type on wider, pointer-precise screens.
- [x] **The super-admin console works on a phone.** The 16rem sidebar was permanent chrome,
      leaving a handset almost no room for the tables the console is built from. Below `lg` it is
      now a slide-in drawer behind a hamburger, with a scrim, closing on navigation; the desktop
      layout is untouched. Dialog form grids (`grid-cols-2/3`) stack on small screens; stat-tile
      grids stay 2-up, which reads fine. **39/39 tests, all four apps build.**
- [x] **Seat picker shows the personal cap, and the cap is enforced where it matters.** Booking
      checked the family limit but **holding did not** — so a user could select any number of
      seats, tie them all up for the hold window where nobody else could take them, and only get
      an error on Confirm. `holdSeats` now enforces it, counting **issued tickets + seats already
      held**; re-holding a seat you already hold is not a new seat and still succeeds, and
      releasing one frees the slot again. The seat map ships
      `allowance: { familySize, booked, canSelect }`, so the picker renders a live `2/4 selected`
      chip in the header from the moment it opens (not only once the limit bites), greys out
      further free seats, and refuses the tap with an explanation instead of firing a request
      that will fail. The picker also re-adopts seats the server still holds after a reload, so
      the counter, the cap and Confirm can't disagree about what is selected. **40/40 tests.**
- [x] **Scan removed from the bottom pill, moved to the header.** The three-tab pill was tight
      on a 320px viewport and gave the camera page no more room than any other tab. Scan is now
      an inverted (high-contrast) icon button in the OpsLayout header; tapping it opens a
      **standalone full-screen page** outside the shell — the camera gets the full viewport and
      the pill bar can't cover the result strip. The scan page has its own sticky header with a
      **back button** (`navigate(-1)`). The `/scan` route is still protected but no longer nested
      inside `OpsLayout`'s `<Outlet>`. The pill is now two tabs (Movies, Scanners), which sit
      comfortably on any phone. **40/40 tests, admin builds clean.**
