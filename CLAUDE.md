# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start the server
node server.js

# Start with auto-reload (development)
npm run dev
```

There are no tests or linting configured. No build step — the app runs directly with Node.js.

## Architecture

Single-file Express backend (`server.js`) with static HTML/CSS/JS frontend (`public/`). No framework, no bundler, no TypeScript.

**Data storage** is plain JSON files in `data/` (no database binary required):
- `data/complaints.json` — all complaints, newest first
- `data/form-config.json` — editable form settings (categories, labels, phone toggle, etc.)

Both files are auto-created on first run if missing.

**Email** is sent via Nodemailer using custom SMTP credentials from `.env`. Three email functions in `server.js`:
- `sendComplaintEmail` — notifies the admin when a complaint is submitted
- `sendConfirmationEmail` — notifies the complainant that their submission was received
- `sendStatusUpdateEmail` — notifies the complainant when their complaint status changes (skips `new` status); the admin can suppress this per-complaint via a checkbox in the modal

**Session auth** (`express-session`) protects all `/admin` and `/api/admin/*` routes via the `requireAuth` middleware. Credentials are set in `.env` as `ADMIN_USERNAME` / `ADMIN_PASSWORD`. Sessions last 8 hours.

**Form config** (`/api/form-config`) is a public endpoint — the form page fetches it on load to populate categories, show/hide the phone field, and apply text labels. The admin settings panel (`⚙ Form Settings` in the sidebar) edits the same config via `PUT /api/admin/form-config`.

## Key files

| File | Purpose |
|---|---|
| `server.js` | All backend logic: routes, email, file I/O, auth |
| `public/index.html` | Public complaint form — loads config dynamically on page load |
| `public/admin.html` | Admin dashboard — complaints table + Form Settings panel (single-page, view switching via JS) |
| `public/login.html` | Admin login page |
| `public/style.css` | Shared styles used by all pages |
| `data/form-config.json` | Editable form configuration (safe to edit directly) |
| `.env` | SMTP credentials, admin password, session secret, port |

## Important patterns

**No native modules** — `better-sqlite3` was intentionally avoided because it requires Windows SDK compilation. Keep dependencies pure-JS only.

**Non-blocking emails** — all three email functions are called with `.catch(err => console.error(...))` so email failures never fail the HTTP response.

**Admin panel view switching** — `admin.html` has two views (`#view-complaints`, `#view-settings`) toggled by `showComplaints()` / `showSettings()`. There is only one `setFilter` function — do not add a second declaration, as JS hoisting will cause both to point to the same function (this was a past bug).

**Port conflict handling** — `server.on('error')` catches `EADDRINUSE` and prints a clear message before exiting instead of crashing with an unhandled event.
