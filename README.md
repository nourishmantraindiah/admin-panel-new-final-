# Byte Morphix — Admin Panel (Standalone Backend)

This is a **trimmed-down build** containing only the admin control panel and
the API it needs — not the public marketing site, and not the student/mentor/
employer portals. Those live in the main `Byte-Morphix-Backend-2-` repo.

## Running it

```bash
npm install
npm start
```

Then open **http://localhost:4001/** and log in with:

- Email: `admin@bytemorphix.com`
- Password: `admin123`

(Change this immediately from the Settings tab if this goes anywhere near
the internet — see the security notes in the main repo's README, they all
apply here too.)

## What's different from the full backend

- **No public site.** There's no homepage, courses page, webinar page, or
  login/dashboard pages for students, mentors, or employers.
- **Login only supports the admin role.** `POST /api/auth/login` here checks
  the `adminUsers` collection only.
- **The code editor edits this repo's own `admin-panel/` files**, not a
  website's source. Since there's no `site/` folder in this build, the
  editor's target directory was pointed at `admin-panel/` instead — so the
  admin can tweak the panel's own HTML/CSS/JS, with the same automatic
  backups and path-traversal protection as before.
- Every other admin capability is unchanged: site content management, leads,
  webinar config + registrations, full CRUD on students/mentors/employers,
  correction-request resolution, and the candidate pool.

## ⚠️ Important: this does NOT share data with the main site backend

This repo has **its own copy of `db.json`**, seeded with the same demo data.
If you run this admin panel and the main `Byte-Morphix-Backend-2-` backend
as two separate deployments, they will **not** stay in sync — a lead
submitted on the live public site (served by the other repo) will not show
up here, because each server reads and writes its own local `db.json` file.

For a real deployment, you have two reasonable paths:

1. **Point both backends at the same database.** Swap `lib/db.js` in both
   repos for a real database client (Postgres, MongoDB, etc.) pointed at one
   shared instance, so both servers read/write the same data.
2. **Don't split them at all** — deploy the main backend (which already
   serves `/admin` alongside the public site) as a single service, and treat
   this standalone repo purely as a design/code reference or for local
   admin-only development, not a second production deployment.

Splitting the admin panel into its own always-on service only makes sense
once you've made that database change — otherwise you end up managing two
sources of truth that silently drift apart.
