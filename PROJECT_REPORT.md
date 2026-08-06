# Army Auditorium Booking Platform — Project Report & Proposal

**Version:** 1.0
**Date:** 4 July 2026
**Prepared for:** Client / Stakeholders
**Prepared by:** Development Team

> This document describes what the platform does, how each type of user uses it, the security
> measures built in, known residual risks, an indicative hosting & database cost comparison, and
> the commercial terms of engagement.

---

## 1. Executive Summary

The Army Auditorium Booking Platform is a production-grade system for managing seat bookings at
an auditorium. It replaces manual/ad-hoc seat allocation with a **live, oversell-proof, rank-aware
online booking** experience, backed by role-separated administration and QR-code door
verification.

The platform is delivered as **four applications** sharing one secure API:

| Application | Audience | Purpose |
|-------------|----------|---------|
| **Backend API** | (internal) | Business logic, database, real-time seat map, scheduled jobs |
| **Admin Portal** | Administrators | Manage auditorium, movies, personnel, units, reports |
| **User App** | Personnel & families | Browse shows, pick seats live, get QR tickets |
| **Scanner App** | Door operators | Scan QR tickets to verify entry |

All three web apps are mobile-friendly; the User and Scanner apps are mobile-first, the Admin
Portal is desktop-first with light/dark themes (light by default) and a soft-SaaS visual
language: a light neutral canvas, white rounded cards with hairline borders, and a grouped
sidebar with a breadcrumb topbar.

---

## 2. What the Platform Does

- Lets an administrator **design the auditorium** (rows and seats, with rank restrictions per row).
- Lets an administrator **schedule movie shows**, with each seat map auto-generated from the layout.
- Lets **personnel (and their spouses)** log in, view upcoming shows, and **pick specific seats on
  a live map** where availability updates in real time as others book.
- Enforces **fair, oversell-proof booking** — two people can never get the same seat, even under
  heavy simultaneous load.
- Issues a **QR ticket per seat**; door operators **scan to verify** (valid / already-used / invalid).
- Automatically **frees unclaimed seats** after the check-in grace period so walk-ins can be re-seated.
- Produces **reports** (per-movie, per-unit bookings, attendance) with PDF export.
- Keeps an **append-only audit trail** of sensitive actions (logins, bookings, verifications).

---

## 3. Feature List

### Booking & Seating
- Visual auditorium designer (rows/seats, **rank restrictions** per row: Officer / JCO / Jawan).
- Per-movie seat inventory **auto-generated** from the layout — no manual step.
- **Live seat map** (real-time) with short **seat holds** while a user completes booking.
- Creating a movie **prompts for seat allocation inline** (optional); reports unlock once a
  show ends and state exactly when that will be.
- **Rank gating** — a user may only book seats their rank is permitted, with an admin override
  (**"Open to all ranks"**) per movie.
- **Family limit** — a member may hold at most `family size` tickets per show (server-enforced).
- **Cancellation** frees the seat immediately on the live map.

### Movies & Scheduling
- Create / edit / delete shows (edit locked once booking opens).
- **Show duration** → shows stay listed and bookable until the show **ends**.
- Booking **opens 1 hour before** showtime; shows are visible earlier (with a "booking opens at…"
  indicator).
- **Unclaimed-seat reclaim**: unscanned tickets are released after the grace period and the seats
  return to the live map.

### People & Administration
- **Two administrative tiers** (see §4) with strict separation of duties.
- **Units** (organisational grouping) and **personnel** management.
- **Bulk personnel import** from an Excel/CSV spreadsheet (with per-row error reporting and a
  downloadable template).
- **Spouse dual-login** — a married member's spouse logs in with their own mobile and the member's
  password, sharing the same family booking allowance.
- **Scanner operator** account management.

### Verification & Reporting
- **QR check-in** at the door (camera-based), with duplicate-scan and invalid-code detection.
- **Reports**: overview dashboard, per-movie report, per-unit booked/checked-in counts, attendance
  summaries, **PDF download**.
- **Audit logs** with actor, action, IP, and outcome.

---

## 4. User Roles & How They Use the Platform

There are **four roles**, held in separate account stores. The same mobile number can hold
independent accounts across roles (e.g. a person can be both a scanner operator and a member).

### 4.1 Super Admin
The top account (created at setup). **Manages people and access:**
- Create / edit / delete **units** and **personnel**.
- Create / edit / delete **administrator accounts** (choosing the tier).
- Read-only view of movies and the auditorium; full access to reports and audit logs.

### 4.2 Admin (Operational)
Created by a Super Admin. **Runs the shows:**
- Design/manage the **auditorium layout**.
- Create / edit / delete **movies**, toggle "Open to all ranks", manage seat allocation.
  Editing locks once booking opens, unit allocations lock at showtime, and a movie that has
  sold even one ticket can no longer be deleted.
- Manage **scanner operators**.
- Read-only on units and personnel; full access to reports and audit logs.

> Separation of duties: the person who manages *people* is different from the person who manages
> *content*, and neither can silently do the other's job. Every rule is enforced on the server.

### 4.3 Scanner Operator
Door staff. **Verifies entry:**
- Log in on the Scanner App → select the movie → scan each QR ticket.
- Sees **Verified / Already used / Invalid** with an auto-clearing result.

### 4.4 User (Personnel & Spouse)
The service member and their family. **Book seats:**
- Browse upcoming shows (no login required to browse).
- Sign in → open a show → **pick seats on the live map** (seats lock briefly) → confirm.
- Receive **QR tickets** (one per seat) to show at the door; can cancel before showtime.

### 4.5 End-to-End Flow

```
Super Admin  →  creates Units + Personnel + Admin accounts
Admin        →  designs Auditorium  →  schedules Movies (seats auto-generated)
User/Spouse  →  browses  →  books seats on the live map  →  gets QR tickets
Reclaim job  →  frees unscanned seats after the grace period (walk-ins can rebook)
Scanner      →  scans QR at the door  →  verified / already-used / invalid
Admin/Super  →  reviews Reports + Audit logs
```

A movie moves through that flow on its own, driven by the clock rather than by anyone
remembering to press a button:

```
Draft  →  Scheduled  →  Open (booking window)  →  Pool released (showtime)  →  Completed
```

Each step is handled by a scheduled job, so the status an admin sees always matches what the
system is actually doing — a show that has finished reads *Completed*, not *still selling*.
An admin can end a show early (*Closed*) or call it off (*Cancelled*) from any point before it
starts.

---

## 5. Architecture (Overview)

- **Backend:** Node.js + Express + TypeScript, MongoDB (Mongoose), Socket.IO for the live seat
  map, scheduled jobs (node-cron) for hold expiry and unclaimed-seat reclaim.
- **Frontends:** three React (Vite) single-page apps — Admin, User, Scanner.
- **Data integrity:** bookings use **atomic conditional updates** (and transactions where the
  database supports them) so seats can never be oversold.
- **Real-time:** clients subscribe to a per-movie channel and receive seat updates instantly.

*Full technical detail is in `architecture.md`.*

---

## 6. Security Features

The platform was built to a defensive security standard and passed an internal security audit
(all High and Medium findings remediated). Implemented controls:

| Area | Control |
|------|---------|
| **Data at rest** | **Mobile numbers** (all roles + spouse) and **unit names** are **AES-256-GCM encrypted** in the database, with a keyed HMAC "blind index" enabling login/uniqueness without exposing plaintext. |
| **Passwords** | **bcrypt** hashing (cost 12); never stored or returned in plaintext; new passwords require ≥ 8 characters. |
| **Sessions** | Short-lived access tokens (in-memory on the client) + **rotating refresh tokens** stored **hashed**; **theft/reuse detection** revokes a compromised session family. |
| **Cookies** | Refresh token is an **HttpOnly, Secure, SameSite** cookie scoped to the auth path; host-only to avoid browser rejection. |
| **Tokens** | JWTs pinned to a single algorithm (no algorithm-confusion attacks). |
| **Access control** | Every route requires authentication + **explicit role authorization**; two-tier admin separation enforced server-side. |
| **Login abuse** | Rate limiting **keyed per account** (not just IP, so shared networks aren't locked out); **failed logins are audited**. |
| **Injection** | All input validated (schema-level); NoSQL operators stripped; search terms escaped to prevent regex injection / denial-of-service. |
| **Real-time** | Socket connections are **authenticated** — no anonymous access to the live seat map. |
| **Transport** | CORS restricted to whitelisted app origins; standard secure HTTP headers. |
| **Auditability** | Append-only audit log of logins, bookings, cancellations, and verifications. |
| **Oversell safety** | Atomic seat claiming — verified under load (300 concurrent users on 10 seats → exactly 10 succeed, 0 oversell). |
| **Secrets** | Sensitive config kept out of source control; encryption/JWT keys via environment only. |

---

## 7. Known Limitations & Residual Risks

In the interest of transparency, the following **lower-severity** items remain (none are critical;
recommendations included). These can be addressed as paid enhancements if required.

1. **No multi-factor authentication (MFA).** Access relies on password + rate limiting. MFA (OTP)
   can be added on request.
2. **Password strength** is length-based (≥ 8), without complexity/breach-list checks.
3. **Exact-match search** on encrypted fields (mobile, unit name) — a deliberate trade-off of
   encryption; partial/substring search on these fields is not possible.
4. **Operational admins can read personnel details** (needed for operations) even though they
   cannot modify them — a data-visibility choice, not a defect.
5. **Third-party dependency advisories** — a small number of low/moderate advisories exist in
   transitive libraries; periodic dependency updates are recommended (part of support).
6. **Poster images** are stored inline in the database; large-scale image use would be better on
   object storage (enhancement).
7. **Backups & disaster recovery** depend on the chosen database plan; automated backups are a
   provider feature (see §8) and/or a paid add-on.
8. **Key custody is critical** — if the encryption key or JWT secrets are lost, encrypted data
   and sessions cannot be recovered. Safeguarding these keys is the client's responsibility
   (see §10).
9. **Security is best-effort, not absolute** — no system can guarantee protection against all
   future threats; ongoing patching (via support) is advised.

---

## 8. Hosting & Database — Indicative Pricing Comparison

> **Note:** Prices are **indicative as of early 2026** and in **USD**; providers change pricing and
> promotional rates frequently. Please **verify current pricing** at time of purchase. VPS
> providers often show a low *promotional* first-term price that **renews higher** — both are shown
> where relevant. Figures exclude taxes.

This platform needs an **always-on** server (for the live seat map's WebSockets and the scheduled
jobs), plus static hosting for the three web apps, plus a MongoDB database.

### 8.1 Application server options

| Option | Spec (typical) | Promo / Entry | Renewal / Steady | Notes |
|--------|----------------|---------------|------------------|-------|
| **Hostinger VPS (KVM 1)** | 1 vCPU, 4 GB RAM, 50 GB NVMe | ~$5–7 / mo | ~$9–11 / mo | Full root VPS; run backend + serve all 3 apps via nginx. Best value. |
| **Hostinger VPS (KVM 2)** | 2 vCPU, 8 GB RAM, 100 GB | ~$7–10 / mo | ~$14–17 / mo | Comfortable headroom for one venue. |
| **AWS Lightsail** | 2 GB RAM, 2 vCPU, 60 GB SSD | ~$18–24 / mo | same | Simpler AWS VPS; predictable pricing. |
| **AWS EC2 (t3.small + EBS)** | 2 vCPU, 2 GB RAM | ~$18–22 / mo | same | More flexible/scalable but more setup; extra costs for storage & data transfer. |
| **Render (Starter web service)** | 0.5 CPU, 512 MB RAM | $7 / mo | $7 / mo | Managed; keeps WebSockets/cron alive; easiest ops. Free tier **sleeps** and is unsuitable for the live/cron features. |

### 8.2 Static hosting for the 3 web apps

| Option | Cost | Notes |
|--------|------|-------|
| **Vercel / Render Static / Cloudflare Pages** | **Free** tier | Ideal for the three SPA builds. |
| **Same VPS via nginx** | Included in VPS | No extra cost if using a VPS. |

### 8.3 Database — MongoDB

| Option | Cost | Notes |
|--------|------|-------|
| **MongoDB Atlas — Free (M0)** | **$0** | 512 MB shared. Fine for pilot/small use; no dedicated resources or automated backups. |
| **MongoDB Atlas — Flex** | ~$8–30 / mo (usage-based) | Small production workloads; backups available. |
| **MongoDB Atlas — Dedicated (M10)** | ~$57 / mo+ | Dedicated, backups, replica set, best for production. |
| **Self-hosted Mongo on the VPS** | Included in VPS | Lowest cost; **you** manage backups/replication/patching. Recommended only with a backup plan. |

### 8.4 Recommended stacks (total monthly, indicative)

| Scenario | Stack | Approx. total / month |
|----------|-------|-----------------------|
| **Pilot / small** | Render Starter ($7) + free static hosting + Atlas M0 (free) | **~$7** |
| **Best value production** | Hostinger KVM 2 (~$10–15) + nginx static + Atlas Flex (~$9–25) | **~$20–40** |
| **Robust production** | Hostinger/AWS VPS (~$15–24) + Atlas M10 (~$57) | **~$70–80** |
| **Lowest cost (self-managed DB)** | Hostinger KVM 2 (~$10–15) with self-hosted Mongo + backups | **~$10–15** |

**Our recommendation for a single auditorium:** a **Hostinger KVM 2 VPS** running the backend and
serving the three apps, paired with **MongoDB Atlas (Flex or M10)** for managed backups and
reliability — a strong balance of cost, performance, and safety. (Performance testing showed the
booking engine sustaining hundreds of bookings/second — far beyond a single venue's needs.)

---

## 9. Terms & Conditions of Engagement

> The following terms govern the delivery, support, and use of the platform. They are commercial
> terms; for a binding contract we recommend review by the client's legal representative.

### 9.1 Scope of Delivery
- Delivery includes the four applications as described in this document, deployed to the agreed
  hosting environment, and handover of source code and documentation.
- Any functionality **not explicitly described** in this document or the agreed specification is
  **out of scope**.

### 9.2 Support & Maintenance (Included — 1 Year)
- **12 months of support** from the date of handover is included, covering:
  - Fixing **defects** in the delivered functionality (bugs).
  - **Minor** adjustments and security/dependency patching.
  - Reasonable assistance with configuration and deployment questions.
- Support is provided during normal business hours with reasonable-effort response times.
- **Excluded** from included support: new features, scope changes, redesigns, integrations,
  third-party outages, and issues caused by client/operator actions (see 9.4).

### 9.3 Additional Features & Changes (Paid)
- Any **new feature, enhancement, integration, or change request** beyond the delivered scope will
  be **quoted and billed separately** and scheduled by mutual agreement.
- Examples of paid enhancements: MFA/OTP login, SMS/email notifications, payment integration,
  advanced/partial search over encrypted fields, object-storage for images, multi-venue support,
  data migrations, custom reports, mobile (native) apps, and SLA-backed uptime guarantees.

### 9.4 Client / Operator Responsibility & Liability
- **Correct use is the responsibility of the client and its operators.** We are **not liable** for
  losses, errors, or damages arising from:
  - Incorrect data entry, misconfiguration, or misuse by administrators, operators, or users.
  - **Sharing, weak, or compromised credentials**; unauthorized access resulting from the client's
    handling of accounts or passwords.
  - Actions taken by users with legitimately granted access (e.g. an admin deleting data).
  - **Loss of encryption keys or secrets** (see 9.6) or failure to maintain backups.
  - Downtime, data loss, or breaches originating from the **hosting/database provider** or the
    network, or from the client's own infrastructure.
- Our total liability, where applicable, is limited to the fees paid for the delivered work.

### 9.5 Hosting, Third-Party Services & Costs
- **Hosting and database costs are borne by the client** (or as separately agreed). Prices in §8
  are indicative and set by third-party providers; we do not control or guarantee them.
- Third-party services (hosting, database, CDN, etc.) are subject to **their own terms, pricing,
  and availability**. We are not responsible for changes, outages, or charges by these providers.

### 9.6 Security, Keys & Data
- The platform implements the security measures in §6 on a **best-effort, industry-standard basis**.
  **No absolute guarantee** against all security threats is made or implied.
- The client is responsible for **safeguarding secrets** (encryption key, JWT secrets, database
  credentials). **Losing the encryption key renders encrypted data unrecoverable** — this is not
  recoverable by us and is not our liability.
- The client is the **data owner and controller** and is responsible for lawful use, retention,
  consent, and compliance with applicable data-protection regulations.
- **Backups** are the client's responsibility unless a managed backup plan/add-on is contracted.

### 9.7 Warranty
- The platform is warranted to perform **substantially as described** in this document at handover.
- No warranty is made that operation will be uninterrupted or error-free, or that it will meet
  requirements not stated herein.

### 9.8 Acceptance, Payment & IP *(to be finalised)*
- Payment schedule, acceptance criteria, intellectual-property assignment/licensing, confidentiality,
  and governing law/jurisdiction to be completed per the signed agreement.

---

## 10. Assumptions & Exclusions (Summary)

- One auditorium/venue; single production environment.
- Client provides hosting/database accounts and pays their fees.
- Client safeguards all secrets and maintains backups (unless contracted otherwise).
- Included support is **12 months** for defects and minor/security maintenance; new work is paid.
- Pricing in §8 is indicative and must be verified with providers at purchase time.

---

*Prepared by the Development Team — v1.0, 4 July 2026. Figures and third-party pricing are
indicative and subject to change. This document is commercial in nature; legal review is advised
before contract signature.*
