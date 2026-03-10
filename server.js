require('dotenv').config();
const express = require('express');
const session = require('express-session');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');

if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'complaints.json');
const CONFIG_FILE = path.join(DATA_DIR, 'form-config.json');

const DEFAULT_CONFIG = {
  siteName: 'Complaints',
  siteName_he: '',
  heroTitle: 'Submit a Complaint',
  heroTitle_he: '',
  heroSubtitle: "We take every complaint seriously. Please fill out the form below and we'll get back to you as soon as possible.",
  heroSubtitle_he: '',
  formTitle: 'Complaint Details',
  formTitle_he: '',
  categories: ['Service', 'Product', 'Billing', 'Staff', 'Technical Issue', 'Delivery', 'Other'],
  categories_he: [],
  showPhone: true,
  privacyNote: 'Your information is kept confidential and used only to process your complaint.',
  privacyNote_he: '',
  submitLabel: 'Send Complaint',
  submitLabel_he: '',
  successTitle: 'Complaint Submitted',
  successTitle_he: '',
  successText: 'Thank you. Your complaint has been received and we will review it shortly.',
  successText_he: '',
};

// Ensure data directory and files exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify([]));
if (!fs.existsSync(CONFIG_FILE)) fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));

// --- DB helpers ---
function readComplaints() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch { return []; }
}

function writeComplaints(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function addComplaint(complaint) {
  const complaints = readComplaints();
  const entry = {
    id: crypto.randomUUID(),
    ...complaint,
    status: 'new',
    messages: [],
    createdAt: new Date().toISOString(),
  };
  complaints.unshift(entry);
  writeComplaints(complaints);
  return entry;
}

function addMessage(complaintId, from, senderName, text) {
  const complaints = readComplaints();
  const idx = complaints.findIndex(c => c.id === complaintId);
  if (idx === -1) return null;
  if (!Array.isArray(complaints[idx].messages)) complaints[idx].messages = [];
  const msg = { from, senderName, text, sentAt: new Date().toISOString() };
  complaints[idx].messages.push(msg);
  writeComplaints(complaints);
  return { complaint: complaints[idx], message: msg };
}

function getComplaint(id) {
  return readComplaints().find(c => c.id === id) || null;
}

function updateComplaintStatus(id, status) {
  const complaints = readComplaints();
  const idx = complaints.findIndex(c => c.id === id);
  if (idx !== -1) {
    complaints[idx].status = status;
    complaints[idx].updatedAt = new Date().toISOString();
    writeComplaints(complaints);
    return complaints[idx];
  }
  return null;
}

function deleteComplaint(id) {
  const complaints = readComplaints();
  const filtered = complaints.filter(c => c.id !== id);
  writeComplaints(filtered);
  return filtered.length < complaints.length;
}

// --- Form config helpers ---
function readFormConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
  } catch { return { ...DEFAULT_CONFIG }; }
}

function writeFormConfig(data) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

// --- Email transporter ---
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// Hebrew strings for complainant-facing emails
const EMAIL_HE = {
  confirmation: {
    subject: (subj) => `קיבלנו את התלונה שלך — ${subj}`,
    header: (site) => `${site} — קיבלנו את התלונה`,
    greeting: (name) => `שלום ${name},`,
    intro: 'תודה שפנית אלינו. קיבלנו את תלונתך ונסקור אותה בהקדם האפשרי.',
    sectionLabel: 'סיכום התלונה שלך',
    fields: { subject: 'נושא', category: 'קטגוריה', submitted: 'תאריך הגשה', message: 'הודעה' },
    refLabel: 'מספר הפניה:',
    footer: 'שמור את מספר ההפניה לכל תכתובת עתידית בנושא תלונה זו.',
  },
  statusUpdate: {
    subject: (label) => `התלונה שלך עודכנה — ${label}`,
    header: (site) => `${site} — עדכון תלונה`,
    greeting: (name) => `שלום ${name},`,
    intro: 'רצינו לעדכן אותך שמצב תלונתך השתנה.',
    statusLabel: 'מצב חדש',
    statusMessages: {
      'in-progress': 'אנו בוחנים את תלונתך כעת ונצור איתך קשר בהקדם.',
      'resolved': 'תלונתך נבדקה ואנו רואים אותה כמטופלת. תודה שפנית אלינו.',
      'dismissed': 'לאחר בחינה מדוקדקת, תלונתך נסגרה. אם אתה סבור שמדובר בטעות, אנא פנה אלינו שוב.',
    },
    statusLabels: { 'in-progress': 'בטיפול', 'resolved': 'נסגרה', 'dismissed': 'נדחתה' },
    fields: { subject: 'נושא', category: 'קטגוריה', submitted: 'תאריך הגשה' },
    refLabel: 'מספר הפניה:',
    footer: (site) => `זהו עדכון אוטומטי מ-${site}.`,
  },
  adminMessage: {
    subject: (subj) => `הודעה בנוגע לתלונתך — ${subj}`,
    header: (site) => `${site} — הודעה מהתמיכה`,
    greeting: (name) => `שלום ${name},`,
    regarding: (subj) => `בנוגע לתלונתך: <strong>${subj}</strong>`,
    replyBtn: 'השב להודעה',
    refLabel: 'מספר הפניה:',
  },
};

// Confirmation email to the person who submitted the complaint
async function sendConfirmationEmail(complaint) {
  const config = readFormConfig();
  const he = complaint.lang === 'he';
  const s = he ? EMAIL_HE.confirmation : null;
  const submitted = new Date(complaint.createdAt).toLocaleString(he ? 'he-IL' : undefined);
  const dir = he ? 'rtl' : 'ltr';

  const subjectLine = he ? s.subject(complaint.subject) : `Complaint received — ${complaint.subject}`;
  const headerText = he ? s.header(config.siteName) : `${config.siteName} — Complaint Received`;
  const greeting = he ? s.greeting(complaint.name) : `Hi ${escapeHtml(complaint.name)},`;
  const intro = he ? s.intro : 'Thank you for submitting your complaint. We have received it and will review it as soon as possible.';
  const sectionLabel = he ? s.sectionLabel : 'Your Complaint Summary';
  const f = he ? s.fields : { subject: 'Subject', category: 'Category', submitted: 'Submitted', message: 'Message' };
  const refLabel = he ? s.refLabel : 'Reference ID:';
  const footer = he ? s.footer : 'Please keep your Reference ID for future correspondence regarding this complaint.';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;direction:${dir};">
      <div style="background:#1f2937;color:white;padding:20px 24px;">
        <h2 style="margin:0;font-size:20px;">${escapeHtml(headerText)}</h2>
      </div>
      <div style="padding:24px;">
        <p style="font-size:15px;color:#374151;margin:0 0 16px;">${escapeHtml(greeting)}</p>
        <p style="font-size:14px;color:#374151;margin:0 0 20px;">${intro}</p>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:16px 20px;margin-bottom:20px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#9ca3af;margin-bottom:12px;">${sectionLabel}</div>
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <tr><td style="padding:5px 0;font-weight:600;color:#6b7280;width:110px;vertical-align:top;">${f.subject}</td><td style="padding:5px 0;color:#374151;">${escapeHtml(complaint.subject)}</td></tr>
            <tr><td style="padding:5px 0;font-weight:600;color:#6b7280;vertical-align:top;">${f.category}</td><td style="padding:5px 0;color:#374151;">${escapeHtml(complaint.category)}</td></tr>
            <tr><td style="padding:5px 0;font-weight:600;color:#6b7280;vertical-align:top;">${f.submitted}</td><td style="padding:5px 0;color:#374151;">${submitted}</td></tr>
            <tr><td style="padding:5px 0;font-weight:600;color:#6b7280;vertical-align:top;">${f.message}</td><td style="padding:5px 0;color:#374151;white-space:pre-wrap;">${escapeHtml(complaint.message)}</td></tr>
          </table>
        </div>
        <div style="padding:12px 16px;background:#f5f5f5;border-radius:6px;font-size:12px;color:#9ca3af;">
          ${refLabel} <code style="font-size:12px;">${complaint.id}</code>
        </div>
      </div>
      <div style="padding:16px 24px;border-top:1px solid #f3f4f6;font-size:12px;color:#9ca3af;text-align:center;">
        ${footer}
      </div>
    </div>`;

  await transporter.sendMail({
    from: `"${config.siteName}" <${process.env.SMTP_USER}>`,
    to: complaint.email,
    subject: subjectLine,
    html,
    text: `${greeting}\n\n${intro}\n\n${f.subject}: ${complaint.subject}\n${f.category}: ${complaint.category}\n${f.submitted}: ${submitted}\n\n${f.message}:\n${complaint.message}\n\n${refLabel} ${complaint.id}\n\n${footer}\n\n— ${config.siteName}`,
  });
}

// Email to admin when a new complaint arrives
async function sendComplaintEmail(complaint) {
  const config = readFormConfig();
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;">
      <div style="background:#dc2626;color:white;padding:20px 24px;">
        <h2 style="margin:0;font-size:20px;">New Complaint Received</h2>
        <p style="margin:4px 0 0;opacity:0.85;font-size:13px;">${new Date(complaint.createdAt).toLocaleString()}</p>
      </div>
      <div style="padding:24px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:8px 0;font-weight:bold;color:#555;width:130px;vertical-align:top;">Name</td><td style="padding:8px 0;">${escapeHtml(complaint.name)}</td></tr>
          <tr><td style="padding:8px 0;font-weight:bold;color:#555;vertical-align:top;">Email</td><td style="padding:8px 0;"><a href="mailto:${escapeHtml(complaint.email)}">${escapeHtml(complaint.email)}</a></td></tr>
          ${complaint.phone ? `<tr><td style="padding:8px 0;font-weight:bold;color:#555;vertical-align:top;">Phone</td><td style="padding:8px 0;">${escapeHtml(complaint.phone)}</td></tr>` : ''}
          <tr><td style="padding:8px 0;font-weight:bold;color:#555;vertical-align:top;">Category</td><td style="padding:8px 0;">${escapeHtml(complaint.category)}</td></tr>
          <tr><td style="padding:8px 0;font-weight:bold;color:#555;vertical-align:top;">Subject</td><td style="padding:8px 0;">${escapeHtml(complaint.subject)}</td></tr>
          <tr><td style="padding:8px 0;font-weight:bold;color:#555;vertical-align:top;">Message</td><td style="padding:8px 0;white-space:pre-wrap;">${escapeHtml(complaint.message)}</td></tr>
        </table>
        <div style="margin-top:20px;padding:12px 16px;background:#f5f5f5;border-radius:6px;font-size:13px;color:#666;">
          Complaint ID: <code>${complaint.id}</code>
        </div>
      </div>
    </div>`;

  await transporter.sendMail({
    from: `"${config.siteName}" <${process.env.SMTP_USER}>`,
    to: process.env.ADMIN_EMAIL,
    replyTo: complaint.email,
    subject: `[Complaint] ${complaint.subject}`,
    html,
    text: `New Complaint\n\nName: ${complaint.name}\nEmail: ${complaint.email}\nPhone: ${complaint.phone || 'N/A'}\nCategory: ${complaint.category}\nSubject: ${complaint.subject}\n\nMessage:\n${complaint.message}\n\nID: ${complaint.id}`,
  });
}

// Email to complaint creator when status changes
async function sendStatusUpdateEmail(complaint, newStatus) {
  // Don't email for 'new' — that's the default state on submission
  if (newStatus === 'new') return;

  const config = readFormConfig();
  const he = complaint.lang === 'he';
  const s = he ? EMAIL_HE.statusUpdate : null;
  const dir = he ? 'rtl' : 'ltr';

  const statusLabels = he ? EMAIL_HE.statusUpdate.statusLabels : {
    'in-progress': 'In Progress',
    'resolved': 'Resolved',
    'dismissed': 'Dismissed',
  };

  const statusMessages = he ? EMAIL_HE.statusUpdate.statusMessages : {
    'in-progress': 'We are currently reviewing your complaint and will be in touch soon.',
    'resolved': 'Your complaint has been reviewed and we consider it resolved. Thank you for bringing this to our attention.',
    'dismissed': 'After careful review, your complaint has been closed. If you believe this is in error, please resubmit or contact us directly.',
  };

  const statusColors = {
    'in-progress': '#d97706',
    'resolved': '#16a34a',
    'dismissed': '#6b7280',
  };

  const label = statusLabels[newStatus] || newStatus;
  const message = statusMessages[newStatus] || (he ? 'מצב תלונתך עודכן.' : 'Your complaint status has been updated.');
  const color = statusColors[newStatus] || '#374151';
  const locale = he ? 'he-IL' : undefined;
  const submitted = new Date(complaint.createdAt).toLocaleDateString(locale, { day: '2-digit', month: 'long', year: 'numeric' });

  const subjectLine = he ? s.subject(label) : `Your complaint has been updated — ${label}`;
  const headerText = he ? s.header(config.siteName) : `${config.siteName} — Complaint Update`;
  const greeting = he ? s.greeting(complaint.name) : `Hi ${escapeHtml(complaint.name)},`;
  const intro = he ? s.intro : 'We wanted to let you know that your complaint has been updated.';
  const statusLabelText = he ? s.statusLabel : 'New Status';
  const f = he ? s.fields : { subject: 'Subject', category: 'Category', submitted: 'Submitted' };
  const refLabel = he ? s.refLabel : 'Reference ID:';
  const footer = he ? s.footer(config.siteName) : `This is an automated update from ${escapeHtml(config.siteName)}.`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;direction:${dir};">
      <div style="background:#1f2937;color:white;padding:20px 24px;">
        <h2 style="margin:0;font-size:20px;">${escapeHtml(headerText)}</h2>
      </div>
      <div style="padding:24px;">
        <p style="font-size:15px;color:#374151;margin:0 0 20px;">${escapeHtml(greeting)}</p>
        <p style="font-size:14px;color:#374151;margin:0 0 20px;">${intro}</p>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-left:4px solid ${color};border-radius:6px;padding:16px 20px;margin-bottom:24px;">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#9ca3af;margin-bottom:6px;">${statusLabelText}</div>
          <div style="font-size:18px;font-weight:700;color:${color};">${label}</div>
          <p style="font-size:14px;color:#6b7280;margin:8px 0 0;">${message}</p>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;color:#6b7280;">
          <tr>
            <td style="padding:6px 0;width:130px;font-weight:600;">${f.subject}</td>
            <td style="padding:6px 0;">${escapeHtml(complaint.subject)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;font-weight:600;">${f.category}</td>
            <td style="padding:6px 0;">${escapeHtml(complaint.category)}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;font-weight:600;">${f.submitted}</td>
            <td style="padding:6px 0;">${submitted}</td>
          </tr>
        </table>
        <div style="margin-top:20px;padding:12px 16px;background:#f5f5f5;border-radius:6px;font-size:12px;color:#9ca3af;">
          ${refLabel} <code>${complaint.id}</code>
        </div>
      </div>
      <div style="padding:16px 24px;border-top:1px solid #f3f4f6;font-size:12px;color:#9ca3af;text-align:center;">
        ${footer}
      </div>
    </div>`;

  await transporter.sendMail({
    from: `"${config.siteName}" <${process.env.SMTP_USER}>`,
    to: complaint.email,
    subject: subjectLine,
    html,
    text: `${greeting}\n\n${intro}\n\n${statusLabelText}: ${label}\n${message}\n\n${f.subject}: ${complaint.subject}\n${f.category}: ${complaint.category}\n${f.submitted}: ${submitted}\n${refLabel} ${complaint.id}\n\n— ${config.siteName}`,
  });
}

// Email: admin sends a message to the complainant
async function sendAdminMessageEmail(complaint, messageText, host) {
  const config = readFormConfig();
  const he = complaint.lang === 'he';
  const s = he ? EMAIL_HE.adminMessage : null;
  const dir = he ? 'rtl' : 'ltr';
  const replyUrl = `${host}/reply/${complaint.id}`;

  const subjectLine = he ? s.subject(complaint.subject) : `Message regarding your complaint — ${complaint.subject}`;
  const headerText = he ? s.header(config.siteName) : `${config.siteName} — Message from Support`;
  const greeting = he ? s.greeting(complaint.name) : `Hi ${escapeHtml(complaint.name)},`;
  const regarding = he ? s.regarding(escapeHtml(complaint.subject)) : `Regarding your complaint: <strong>${escapeHtml(complaint.subject)}</strong>`;
  const replyBtn = he ? s.replyBtn : 'Reply to this message';
  const refLabel = he ? s.refLabel : 'Reference ID:';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;direction:${dir};">
      <div style="background:#1f2937;color:white;padding:20px 24px;">
        <h2 style="margin:0;font-size:20px;">${escapeHtml(headerText)}</h2>
      </div>
      <div style="padding:24px;">
        <p style="font-size:15px;color:#374151;margin:0 0 16px;">${escapeHtml(greeting)}</p>
        <p style="font-size:13px;color:#6b7280;margin:0 0 12px;">${regarding}</p>
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-left:4px solid #2563eb;border-radius:6px;padding:16px 20px;margin-bottom:20px;white-space:pre-wrap;font-size:14px;color:#374151;">${escapeHtml(messageText)}</div>
        <a href="${replyUrl}" style="display:inline-block;background:#dc2626;color:white;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:600;">${replyBtn}</a>
      </div>
      <div style="padding:16px 24px;border-top:1px solid #f3f4f6;font-size:12px;color:#9ca3af;text-align:center;">
        ${refLabel} ${complaint.id}
      </div>
    </div>`;

  await transporter.sendMail({
    from: `"${config.siteName}" <${process.env.SMTP_USER}>`,
    to: complaint.email,
    subject: subjectLine,
    html,
    text: `${greeting}\n\n${he ? `בנוגע לתלונתך: "${complaint.subject}"` : `You have a new message regarding your complaint "${complaint.subject}"`}:\n\n${messageText}\n\n${he ? 'השב כאן' : 'Reply here'}: ${replyUrl}\n\n${refLabel} ${complaint.id}\n\n— ${config.siteName}`,
  });
}

// Email: complainant replies, notifies admin
async function sendUserReplyEmail(complaint, messageText) {
  const config = readFormConfig();

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;">
      <div style="background:#dc2626;color:white;padding:20px 24px;">
        <h2 style="margin:0;font-size:20px;">Reply from ${escapeHtml(complaint.name)}</h2>
        <p style="margin:4px 0 0;opacity:0.85;font-size:13px;">${escapeHtml(complaint.subject)}</p>
      </div>
      <div style="padding:24px;">
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:16px 20px;margin-bottom:16px;white-space:pre-wrap;font-size:14px;color:#374151;">${escapeHtml(messageText)}</div>
        <table style="font-size:13px;color:#6b7280;border-collapse:collapse;">
          <tr><td style="padding:4px 12px 4px 0;font-weight:600;">From</td><td>${escapeHtml(complaint.name)} &lt;${escapeHtml(complaint.email)}&gt;</td></tr>
          <tr><td style="padding:4px 12px 4px 0;font-weight:600;">Complaint</td><td>${escapeHtml(complaint.subject)}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;font-weight:600;">Reference</td><td>${complaint.id}</td></tr>
        </table>
      </div>
    </div>`;

  await transporter.sendMail({
    from: `"${config.siteName}" <${process.env.SMTP_USER}>`,
    to: process.env.ADMIN_EMAIL,
    replyTo: complaint.email,
    subject: `[Reply] ${complaint.subject} — ${complaint.name}`,
    html,
    text: `Reply from ${complaint.name} <${complaint.email}>\n\n${messageText}\n\nComplaint: ${complaint.subject}\nReference ID: ${complaint.id}`,
  });
}

// --- Cloudflare Turnstile verification ---
async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // Not configured — skip (dev mode)
  if (!token) return false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token, remoteip: ip }),
    });
    const data = await res.json();
    return data.success === true;
  } catch (err) {
    console.error('Turnstile verify error:', err.message);
    return false;
  }
}

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 8 * 60 * 60 * 1000 },
}));

// When running behind a sub-path proxy (BASE_PATH set), rewrite absolute paths in
// HTML responses and patch res.redirect so Location headers are correct.
if (BASE_PATH) {
  app.use((req, res, next) => {
    const origSendFile = res.sendFile.bind(res);
    res.sendFile = function (filePath, options, callback) {
      if (typeof options === 'function') { callback = options; options = {}; }
      if (filePath.endsWith('.html')) {
        fs.readFile(filePath, 'utf8', (err, content) => {
          if (err) return origSendFile(filePath, options, callback);
          const ogUrl = process.env.SITE_URL
            ? process.env.SITE_URL.replace(/\/$/, '') + req.path
            : '';
          content = content
            .replace('<head>', `<head>\n  <script>window.__BASE__=${JSON.stringify(BASE_PATH)}</script>`)
            .replace(/(href|src)="\//g, `$1="${BASE_PATH}/`)
            .replace('content="__OG_URL__"', `content="${ogUrl}"`);
          res.type('html').send(content);
        });
      } else {
        origSendFile(filePath, options, callback);
      }
    };

    const origRedirect = res.redirect.bind(res);
    res.redirect = function (url, ...args) {
      if (typeof url === 'string' && url.startsWith('/')) url = BASE_PATH + url;
      return origRedirect(url, ...args);
    };

    next();
  });
}

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.redirect('/admin/login');
}

// --- Routes ---

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Public: get form config (used by the form page)
app.get('/api/form-config', (_req, res) => {
  const config = readFormConfig();
  res.json({ ...config, turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || '' });
});

// Submit complaint (public)
app.post('/api/complaint', async (req, res) => {
  const { name, email, phone, category, subject, message, lang, 'cf-turnstile-response': cfToken } = req.body;

  if (!await verifyTurnstile(cfToken, req.ip)) {
    return res.status(400).json({ error: 'CAPTCHA verification failed. Please try again.' });
  }

  if (!name || !email || !category || !subject || !message) {
    return res.status(400).json({ error: 'Please fill in all required fields.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }
  if (message.length < 10) {
    return res.status(400).json({ error: 'Message must be at least 10 characters.' });
  }

  try {
    const complaint = addComplaint({ name, email, phone: phone || '', category, subject, message, lang: lang === 'he' ? 'he' : 'en' });
    sendComplaintEmail(complaint).catch(err => console.error('Admin email failed:', err.message));
    sendConfirmationEmail(complaint).catch(err => console.error('Confirmation email failed:', err.message));
    res.json({ success: true, id: complaint.id });
  } catch (err) {
    console.error('Complaint save error:', err);
    res.status(500).json({ error: 'Failed to save complaint. Please try again.' });
  }
});

// Admin login page
app.get('/admin/login', (req, res) => {
  if (req.session.authenticated) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Admin login action
app.post('/admin/login', async (req, res) => {
  const { username, password, 'cf-turnstile-response': cfToken } = req.body;

  if (!await verifyTurnstile(cfToken, req.ip)) {
    return res.status(401).json({ error: 'CAPTCHA verification failed. Please try again.' });
  }

  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    req.session.authenticated = true;
    req.session.username = username;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid username or password.' });
  }
});

// Admin logout
app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// Admin panel (protected)
app.get('/admin', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// API: list complaints (protected)
app.get('/api/admin/complaints', requireAuth, (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  let complaints = readComplaints();
  if (status && status !== 'all') complaints = complaints.filter(c => c.status === status);
  const total = complaints.length;
  const start = (parseInt(page) - 1) * parseInt(limit);
  const items = complaints.slice(start, start + parseInt(limit));
  res.json({ complaints: items, total, page: parseInt(page), limit: parseInt(limit) });
});

// API: get single complaint (protected)
app.get('/api/admin/complaints/:id', requireAuth, (req, res) => {
  const complaint = getComplaint(req.params.id);
  if (!complaint) return res.status(404).json({ error: 'Not found' });
  res.json(complaint);
});

// API: update status (protected)
app.patch('/api/admin/complaints/:id', requireAuth, async (req, res) => {
  const { status, notify = true } = req.body;
  const validStatuses = ['new', 'in-progress', 'resolved', 'dismissed'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }
  const updated = updateComplaintStatus(req.params.id, status);
  if (!updated) return res.status(404).json({ error: 'Not found' });

  // Send status update email to the complaint creator (non-blocking)
  if (notify !== false) {
    sendStatusUpdateEmail(updated, status).catch(err =>
      console.error('Status update email failed:', err.message)
    );
  }

  res.json(updated);
});

// API: delete complaint (protected)
app.delete('/api/admin/complaints/:id', requireAuth, (req, res) => {
  const deleted = deleteComplaint(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// API: admin sends a message to the complainant (protected)
app.post('/api/admin/complaints/:id/message', requireAuth, async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Message text is required.' });

  const complaint = getComplaint(req.params.id);
  if (!complaint) return res.status(404).json({ error: 'Not found' });

  const result = addMessage(req.params.id, 'admin', 'Support', text.trim());
  if (!result) return res.status(500).json({ error: 'Failed to save message.' });

  const host = process.env.SITE_URL
    ? process.env.SITE_URL.replace(/\/$/, '')
    : `${req.protocol}://${req.get('host')}` + BASE_PATH;
  sendAdminMessageEmail(complaint, text.trim(), host).catch(err =>
    console.error('Admin message email failed:', err.message)
  );

  res.json(result.message);
});

// Public reply page
app.get('/reply/:id', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reply.html'));
});

// API: get complaint thread (public — complaint ID acts as the access token)
app.get('/api/complaint/:id/thread', (req, res) => {
  const complaint = getComplaint(req.params.id);
  if (!complaint) return res.status(404).json({ error: 'Not found' });
  res.json({
    id: complaint.id,
    name: complaint.name,
    subject: complaint.subject,
    category: complaint.category,
    status: complaint.status,
    createdAt: complaint.createdAt,
    messages: complaint.messages || [],
  });
});

// API: complainant sends a reply (public)
app.post('/api/complaint/:id/reply', async (req, res) => {
  const { text, 'cf-turnstile-response': cfToken } = req.body;

  if (!await verifyTurnstile(cfToken, req.ip)) {
    return res.status(400).json({ error: 'CAPTCHA verification failed. Please try again.' });
  }
  if (!text || !text.trim()) return res.status(400).json({ error: 'Message text is required.' });
  if (text.length > 5000) return res.status(400).json({ error: 'Message is too long.' });

  const complaint = getComplaint(req.params.id);
  if (!complaint) return res.status(404).json({ error: 'Complaint not found.' });

  const result = addMessage(req.params.id, 'user', complaint.name, text.trim());
  if (!result) return res.status(500).json({ error: 'Failed to save reply.' });

  sendUserReplyEmail(complaint, text.trim()).catch(err =>
    console.error('User reply email failed:', err.message)
  );

  res.json({ success: true, message: result.message });
});

// API: stats (protected)
app.get('/api/admin/stats', requireAuth, (req, res) => {
  const complaints = readComplaints();
  res.json({
    total: complaints.length,
    new: complaints.filter(c => c.status === 'new').length,
    inProgress: complaints.filter(c => c.status === 'in-progress').length,
    resolved: complaints.filter(c => c.status === 'resolved').length,
    dismissed: complaints.filter(c => c.status === 'dismissed').length,
  });
});

// API: get form config (admin, same data but through auth for the settings editor)
app.get('/api/admin/form-config', requireAuth, (_req, res) => {
  res.json(readFormConfig());
});

// API: save form config (protected)
app.put('/api/admin/form-config', requireAuth, (req, res) => {
  const {
    siteName, siteName_he,
    heroTitle, heroTitle_he,
    heroSubtitle, heroSubtitle_he,
    formTitle, formTitle_he,
    categories, categories_he,
    showPhone,
    privacyNote, privacyNote_he,
    submitLabel, submitLabel_he,
    successTitle, successTitle_he,
    successText, successText_he,
  } = req.body;

  // Validate categories is an array of non-empty strings
  if (!Array.isArray(categories) || categories.length === 0) {
    return res.status(400).json({ error: 'At least one category is required.' });
  }

  const config = {
    siteName: String(siteName || DEFAULT_CONFIG.siteName).trim(),
    siteName_he: String(siteName_he || '').trim(),
    heroTitle: String(heroTitle || DEFAULT_CONFIG.heroTitle).trim(),
    heroTitle_he: String(heroTitle_he || '').trim(),
    heroSubtitle: String(heroSubtitle || DEFAULT_CONFIG.heroSubtitle).trim(),
    heroSubtitle_he: String(heroSubtitle_he || '').trim(),
    formTitle: String(formTitle || DEFAULT_CONFIG.formTitle).trim(),
    formTitle_he: String(formTitle_he || '').trim(),
    categories: categories.map(c => String(c).trim()).filter(Boolean),
    categories_he: Array.isArray(categories_he) ? categories_he.map(c => String(c).trim()) : [],
    showPhone: Boolean(showPhone),
    privacyNote: String(privacyNote || DEFAULT_CONFIG.privacyNote).trim(),
    privacyNote_he: String(privacyNote_he || '').trim(),
    submitLabel: String(submitLabel || DEFAULT_CONFIG.submitLabel).trim(),
    submitLabel_he: String(submitLabel_he || '').trim(),
    successTitle: String(successTitle || DEFAULT_CONFIG.successTitle).trim(),
    successTitle_he: String(successTitle_he || '').trim(),
    successText: String(successText || DEFAULT_CONFIG.successText).trim(),
    successText_he: String(successText_he || '').trim(),
  };

  writeFormConfig(config);
  res.json({ success: true, config });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`Complaints app running at http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nError: Port ${PORT} is already in use.`);
    console.error(`  - Stop the existing process, or`);
    console.error(`  - Set a different PORT in your .env file (e.g. PORT=3001)\n`);
    process.exit(1);
  } else {
    throw err;
  }
});
