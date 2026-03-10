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
- `data/complaints.json` — all complaints, newest first. Each complaint has a `messages: []` array for the two-way thread.
- `data/form-config.json` — editable form settings (categories, labels, phone toggle, etc.)

Both files are auto-created on first run if missing.

**Email** is sent via Nodemailer using custom SMTP credentials from `.env`. Five email functions in `server.js`:
- `sendComplaintEmail` — notifies the admin when a complaint is submitted
- `sendConfirmationEmail` — notifies the complainant that their submission was received
- `sendStatusUpdateEmail` — notifies the complainant when their complaint status changes (skips `new` status)
- `sendAdminMessageEmail` — emails the complainant when the admin sends a message; includes a reply link button to `/reply/:id`
- `sendUserReplyEmail` — emails the admin when a complainant replies via the reply page

All email calls use `.catch(err => console.error(...))` so failures never fail the HTTP response.

**Session auth** (`express-session`) protects all `/admin` and `/api/admin/*` routes via the `requireAuth` middleware. Credentials are set in `.env` as `ADMIN_USERNAME` / `ADMIN_PASSWORD`. Sessions last 8 hours.

**Cloudflare Turnstile** (optional CAPTCHA) — set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` in `.env`. If the secret key is not set, verification is skipped (dev mode). The site key is exposed to the frontend via `/api/form-config` as `turnstileSiteKey`. Protected endpoints: `POST /api/complaint`, `POST /admin/login`, `POST /api/complaint/:id/reply`.

**Dark mode** — all pages load `theme.js` in `<head>` which immediately applies the saved theme from `localStorage` (prevents flash). Preference is also seeded from `prefers-color-scheme`. Dark mode CSS lives in `style.css` under `[data-theme="dark"]`. Each page's `<style>` block adds rules for page-specific white-background elements.

**Two-way messaging** — admin can message complainants from the thread modal in the admin panel. Complainants reply via `/reply/:id` (the UUID is the access token — no login required). Messages are stored on the complaint object as `messages: [{ from, senderName, text, sentAt }]`.

**Form config** (`/api/form-config`) is a public endpoint — the form page fetches it on load to populate categories, show/hide the phone field, apply text labels, and get the Turnstile site key. The admin settings panel (`⚙ Form Settings` in the sidebar) edits the same config via `PUT /api/admin/form-config`.

## Key files

| File | Purpose |
|---|---|
| `server.js` | All backend logic: routes, email, file I/O, auth, Turnstile |
| `public/index.html` | Public complaint form — loads config dynamically on page load |
| `public/admin.html` | Admin dashboard — complaints table, detail modal, thread modal, Form Settings |
| `public/login.html` | Admin login page |
| `public/reply.html` | Public reply page — complainants view thread and send replies |
| `public/style.css` | Shared styles; dark mode at the bottom under `[data-theme="dark"]` |
| `public/theme.js` | Dark mode toggle — runs immediately in `<head>` to avoid flash; exposes `toggleTheme()` globally |
| `data/form-config.json` | Editable form configuration (safe to edit directly) |
| `.env` | SMTP credentials, admin password, session secret, Turnstile keys, port |

## Important patterns

**No native modules** — `better-sqlite3` was intentionally avoided because it requires Windows SDK compilation. Keep dependencies pure-JS only.

**Admin panel view switching** — `admin.html` has two views (`#view-complaints`, `#view-settings`) toggled by `showComplaints()` / `showSettings()`. There is only one `setFilter` function — do not add a second declaration, as JS hoisting will cause both to point to the same function (this was a past bug that caused infinite recursion).

**Thread modal vs detail modal** — the admin detail modal shows complaint info and status controls. The separate thread modal (`#thread-modal`) is opened via the "Messages" button and handles the chat UI + send form. `currentModalId` is shared between both modals.

**Port conflict handling** — `server.on('error')` catches `EADDRINUSE` and prints a clear message before exiting instead of crashing with an unhandled event.

**Turnstile widget rendering** — uses `?render=explicit&onload=_onTurnstileLoad` so the widget only renders after the site key is known (fetched async from `/api/form-config`). The `_onTurnstileLoad` and `_renderTurnstile` pattern is duplicated across `index.html`, `login.html`, and `reply.html` — this is intentional to keep pages self-contained.
