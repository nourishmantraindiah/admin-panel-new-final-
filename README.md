# Byte Morphix — Admin Control Panel

Admissions, academics, finance, placement, a document repository, a support
desk and full audit logging, behind a role-based permission system.

## Running it

```bash
npm install
npm start
```

Open **http://localhost:4001/** and log in with:

- Email: `admin@bytemorphix.com`
- Password: `admin123`

Change that password from **My Account** before this goes anywhere near the
internet, and set `JWT_SECRET` and `DOC_NUMBER_SALT` as environment variables
rather than leaving the built-in demo values in place.

Your existing `db.json` is upgraded automatically on first boot — new
collections are back-filled, existing admins are promoted to Super Admin so
nobody gets locked out, and the four marketing courses become real course
records that batches and fees can point at.

---

## Modules

| Section | What it covers |
|---|---|
| **Overview** | Live counts across every module, with alert tiles for anything needing attention |
| **Leads / Forms** | Every website form submission, convertible to a lead in one click |
| **Queries** | Ticketed support desk with SLA tracking, assignment and threaded replies |
| **Disputes** | Case management for payment, refund, attendance, assessment and conduct disputes |
| **Students** | Full 360 profile — personal, course, batch, attendance, fees, coursework, certificates, placement, documents, communication |
| **Mentors** | Course-locked mentor accounts, payout tracking, correction requests |
| **Employers** | Hiring partner accounts and their requests |
| **Repository** | Identity and document vault for students, mentors, employers and staff |
| **Courses / Batches / Classes** | Catalogue, curriculum, batch rosters, live session scheduling, attendance |
| **Coursework** | Assignments, submissions, grading, projects, assessments and results |
| **Certificates** | Serial-numbered issuance with revocation |
| **Finance / Invoices** | Fee profiles, discounts, scholarships, installments, payments, GST invoices |
| **Placement** | Companies, jobs, applications, interviews, offers and the placement dashboard |
| **Staff & Roles** | Staff accounts, role assignment, per-course restrictions |
| **Audit** | Read-only change history, login history and sensitive-action views |
| **Settings** | Company details, payment gateway, integrations, notification rules |

---

## Course-level access control

A mentor assigned to Digital Marketing cannot reach any other course. This is
enforced in three places, not just hidden in the UI:

1. **Mentor profiles carry `courseIds`**, not a single `track` string.
2. **Batch assignment validates it.** Putting a Digital Marketing mentor on an
   AI batch returns `400` with an explanation naming both the mentor and the
   course.
3. **Removing a course is blocked** while the mentor still runs an active
   batch on it, so a batch can never end up with a mentor who can't open it.

The same mechanism scopes **staff**. Give a Trainer or Academic Manager a
`courseIds` list and every list they load — courses, batches, classes,
students, assignments — is filtered to those courses. Leave it empty for
unrestricted access. Super Admin is always unrestricted.

Permissions are separate from course scope and use `module.action` strings.
The front end hides nav items the role can't use; the server independently
rejects the request. A Trainer hitting `/api/admin/finance/dashboard` gets a
`403` naming the permission they're missing.

---

## Notifications

Two layers, both live:

- **In-app bell** — polls every 30 seconds, groups by event, marks read.
- **Web Push** — real OS-level notifications through the service worker in
  `admin-panel/sw.js`. VAPID keys generate themselves the first time push is
  enabled in Settings; there's no CLI step. Dead subscriptions are pruned
  automatically.

Enrolling anyone as a student, mentor or employer sends a welcome push to
them and an enrollment alert to the staff roles responsible for that kind of
joiner. Every alert type from the brief is wired: new lead, new application,
payment received, payment overdue, assignment submitted, low attendance,
student placement, webinar registration, plus queries, disputes, form
submissions, document uploads and class scheduling.

Two fire on their own without anyone opening a page:

- **Low attendance** is computed when a register is saved and compares against
  the threshold in Settings.
- **Payment overdue** runs on an hourly sweep in `server.js`. Each installment
  raises exactly one alert, so it never spams.

Which roles receive which event is configurable per event in
**Settings → Notifications**.

---

## Document repository

Identity documents are stored in `storage/documents/`, which is deliberately
**not** served statically. Files get random filenames — the original name
never touches the filesystem — and the only way to read one is the
authenticated route, which audit-logs every single view against the staff
member who opened it. If a scan ever leaks, that log is the record of who had
it and when.

Uploading the same ID number against a different person is blocked and names
the existing holder, which catches duplicate records.

### On Aadhaar numbers

**Full ID numbers are not stored.** Only the last four digits (for human
recognition) and a salted HMAC (so duplicates can still be detected) are kept.
The scan itself is the record of truth.

This is deliberate. Holding full Aadhaar numbers in an ordinary application
database creates real legal exposure under the Aadhaar Act and the DPDP Act,
and nothing in this panel needs the full number to function. If your
compliance advisor decides otherwise, `maskNumber()` in
`routes/repository.js` is the single place to change — but get that advice in
writing first, and set `DOC_NUMBER_SALT` to a real secret either way.

---

## Website forms

Every form on the marketing site posts to one public endpoint:

```
POST /api/forms/<formKey>
```

Whatever fields you send land in the **Forms** inbox tagged with the form's
name, so adding a new form to the website needs **no backend change** — it
appears in the panel on its first submission.

Known keys additionally create the right record:

| Key | Also creates |
|---|---|
| `apply`, `callback`, `brochure`, `contact`, `corporate-training`, `hire-from-us` | A lead |
| `webinar` | A webinar registration |
| `query` | A support ticket |
| `dispute` | A dispute case |

Example:

```html
<form id="applyForm">
  <input name="name"><input name="email"><input name="phone">
  <!-- bots fill this; humans never see it -->
  <input name="honeypot" style="display:none" tabindex="-1" autocomplete="off">
</form>
<script>
document.querySelector('#applyForm').addEventListener('submit', async e => {
  e.preventDefault();
  await fetch('https://your-panel-host/api/forms/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.fromEntries(new FormData(e.target)))
  });
});
</script>
```

Submissions are rate-limited per IP, honeypot-filtered and spam-scored.

---

## Audit logging

Every create, update, delete, payment, document view, permission change and
login is recorded with actor, role, IP, timestamp and a field-level diff:

> **Admin Rahul** changed `courseFee` from `80000` → `75000`
> on fee profile for Test Student · 08 Sep 2026, 4:32 PM

There is **no edit or delete endpoint** for the audit log. A trail someone can
quietly rewrite is worth nothing in a dispute. Passwords, tokens and API keys
appear as `•••• (changed)` rather than values.

`GET /api/admin/audit/sensitive` returns the narrow views people actually ask
for after something goes wrong: deletions, payment modifications, student
status changes, permission changes and document access.

---

## What still needs real credentials

The Settings → Integrations tab stores configuration and validates that the
required fields are present, but **does not yet deliver through the
providers**. Meta Lead Ads, Google Ads, GA4, WhatsApp, email, Zoom/Meet, SMS
and CRM each need their own app review, OAuth callback and SDK call, which
can't be faked from inside the panel. Secrets are stored under private keys
and never sent back to the browser — the UI only ever sees a "configured"
flag.

The payment gateway is the same: fee profiles, payments, invoices and GST are
fully modelled, but recording a payment is currently a manual entry. Wiring
Razorpay's webhook to `POST /api/admin/finance/payments` is the remaining
step.

---

## A note on deployment

This repo has **its own copy of `db.json`**. If you run it alongside the main
`Byte-Morphix-Backend-2-` backend as two separate deployments, they will not
stay in sync — each server reads and writes its own file.

Before this carries real student records, replace `lib/db.js` with a real
database client (Postgres or MongoDB) pointed at one shared instance. The
whole data layer goes through `readDB()` / `writeDB()`, so that swap is
contained to one file. The JSON store also rewrites the entire file on every
write, which is fine for a demo and will not hold up under concurrent use.
