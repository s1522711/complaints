# Complaints App

A self-hosted complaints form with email forwarding, two-way messaging, dark mode, and an admin panel. Built with Node.js, Express, and plain HTML/CSS/JS. No database binary required — complaints are stored in a local JSON file.

## Features

- **Public complaint form** — name, email, phone, category, subject, and message with client-side validation
- **Email forwarding** — each submission is emailed to you via your SMTP server
- **Two-way messaging** — admin can reply to complainants; complainants get a private link to continue the conversation
- **Admin panel** — view, filter, search, update status, delete, and message complainants
- **Session-based auth** — admin panel is protected by username/password login
- **Dark mode** — all pages support dark/light toggle with `localStorage` persistence and `prefers-color-scheme` fallback
- **Cloudflare Turnstile CAPTCHA** — optional bot protection on the complaint form, login page, and reply page
- **No native dependencies** — runs on any Node.js environment without compilation

## Project Structure

```
complaints/
├── server.js           Express backend + API routes
├── package.json
├── .env                Your configuration (not committed)
├── .env.example        Configuration template
├── data/
│   └── complaints.json Auto-created on first run
└── public/
    ├── index.html      Public complaint form
    ├── reply.html      Complainant reply page (private link)
    ├── login.html      Admin login page
    ├── admin.html      Admin dashboard
    ├── style.css       Shared styles
    └── theme.js        Dark mode IIFE + toggleTheme()
```

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- An SMTP server (any provider: custom, Outlook, Mailgun, etc.)

## Setup

**1. Install dependencies:**

```bash
npm install
```

**2. Create your `.env` file:**

```bash
cp .env.example .env
```

Then edit `.env` with your values:

| Variable | Description |
|---|---|
| `PORT` | Port to run the server on (default: `3000`) |
| `SMTP_HOST` | SMTP server hostname |
| `SMTP_PORT` | SMTP port — usually `587` (STARTTLS) or `465` (SSL) |
| `SMTP_SECURE` | Set to `true` for port 465, `false` for 587 |
| `SMTP_USER` | SMTP login username |
| `SMTP_PASS` | SMTP password |
| `ADMIN_EMAIL` | Your email address — complaints are forwarded here |
| `ADMIN_USERNAME` | Admin panel login username |
| `ADMIN_PASSWORD` | Admin panel login password |
| `SESSION_SECRET` | A long random string used to sign session cookies |
| `TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key (leave blank to disable) |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret key (leave blank to disable) |

**3. Start the server:**

```bash
node server.js
```

For development with auto-reload:

```bash
npm run dev
```

## Usage

| Page | URL |
|---|---|
| Complaint form (public) | `http://localhost:3000` |
| Admin login | `http://localhost:3000/admin/login` |
| Admin dashboard | `http://localhost:3000/admin` |
| Complainant reply page | `http://localhost:3000/reply/:id` (linked in notification email) |

### Submitting a complaint

Anyone can visit the root URL and fill out the form. On submission:
1. The complaint is saved to `data/complaints.json`
2. An HTML email is sent to `ADMIN_EMAIL` via SMTP
3. A reference ID is shown to the submitter

If the email fails to send, the complaint is still saved and the error is logged to the console.

### Two-way messaging

After a complaint is submitted, the admin can open the complaint in the admin panel and click **Messages** to open the thread modal. From there:

1. Admin sends a message — the complainant receives an email with a private reply link (`/reply/:id`)
2. The complainant visits their link, sees the full message thread, and can send a reply
3. Admin receives an email notification; new messages appear in the thread modal

The complaint UUID serves as the access token — no login required for the complainant.

### Admin panel

Log in at `/admin/login` with your configured credentials. The dashboard lets you:

- View all complaints with subject, sender, category, status, and date
- Filter by status (New / In Progress / Resolved / Dismissed) using the sidebar
- Search by name, email, subject, or message content
- Click any row's **View** button to see the full complaint in a detail modal
- Change the status of a complaint from the detail modal
- Click **Messages** in the detail modal to open the thread modal and send/view messages
- Delete complaints permanently
- Stats cards show totals at a glance
- The page auto-refreshes every 60 seconds

### Complaint statuses

| Status | Meaning |
|---|---|
| **New** | Just received, not yet reviewed |
| **In Progress** | Being looked into |
| **Resolved** | Issue addressed |
| **Dismissed** | Closed without action |

## API Endpoints

All `/api/admin/*` routes require an active admin session.

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/form-config` | Public | Returns `turnstileSiteKey` for CAPTCHA rendering |
| `POST` | `/api/complaint` | Public | Submit a new complaint |
| `GET` | `/api/complaint/:id/thread` | Public (by UUID) | Get thread messages for a complaint |
| `POST` | `/api/complaint/:id/reply` | Public (by UUID) | Submit a reply from the complainant |
| `GET` | `/api/admin/complaints` | Admin | List complaints (`?status=`, `?page=`, `?limit=`) |
| `GET` | `/api/admin/complaints/:id` | Admin | Get a single complaint |
| `PATCH` | `/api/admin/complaints/:id` | Admin | Update status |
| `DELETE` | `/api/admin/complaints/:id` | Admin | Delete a complaint |
| `GET` | `/api/admin/stats` | Admin | Get status counts |
| `POST` | `/api/admin/complaints/:id/message` | Admin | Send an admin message to a complainant |

## Cloudflare Turnstile (CAPTCHA)

Turnstile is optional. Leave `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` blank to disable it (all requests pass through unchecked — useful for local development).

To enable:
1. Go to [dash.cloudflare.com](https://dash.cloudflare.com/?to=/:account/turnstile) and create a Turnstile widget
2. Copy the **Site Key** to `TURNSTILE_SITE_KEY` and the **Secret Key** to `TURNSTILE_SECRET_KEY`
3. Restart the server

CAPTCHA is enforced on:
- New complaint form (`/`)
- Admin login (`/admin/login`)
- Complainant reply page (`/reply/:id`)

## SMTP Examples

**Outlook / Microsoft 365:**
```env
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
```

**Gmail (requires an App Password):**
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
```
> For Gmail, generate an App Password at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) — your normal Gmail password will not work.

**Mailgun:**
```env
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_SECURE=false
```

## Security Notes

- Never commit your `.env` file — it contains secrets. It is already listed in `.gitignore` if you add one.
- Change `ADMIN_PASSWORD` to a strong, unique password before deploying.
- Set `SESSION_SECRET` to a randomly generated string (e.g. run `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
- The complaint UUID is the only access control for the reply page — treat reply links as private.
- If running behind a reverse proxy (Nginx, Caddy), set `app.set('trust proxy', 1)` in `server.js` and use HTTPS.
