require('dotenv').config();
const express = require('express');
const session = require('express-session');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data', 'complaints.json');

// Ensure data directory and file exist
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'));
}
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify([]));
}

// --- DB helpers ---
function readComplaints() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return [];
  }
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
    createdAt: new Date().toISOString(),
  };
  complaints.unshift(entry);
  writeComplaints(complaints);
  return entry;
}

function getComplaint(id) {
  return readComplaints().find(c => c.id === id) || null;
}

function updateComplaintStatus(id, status) {
  const complaints = readComplaints();
  const idx = complaints.findIndex(c => c.id === id);
  if (idx !== -1) {
    complaints[idx].status = status;
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

async function sendComplaintEmail(complaint) {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden;">
      <div style="background: #dc2626; color: white; padding: 20px 24px;">
        <h2 style="margin: 0; font-size: 20px;">New Complaint Received</h2>
        <p style="margin: 4px 0 0; opacity: 0.85; font-size: 13px;">${new Date(complaint.createdAt).toLocaleString()}</p>
      </div>
      <div style="padding: 24px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; font-weight: bold; color: #555; width: 130px; vertical-align: top;">Name</td>
            <td style="padding: 8px 0;">${escapeHtml(complaint.name)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold; color: #555; vertical-align: top;">Email</td>
            <td style="padding: 8px 0;"><a href="mailto:${escapeHtml(complaint.email)}">${escapeHtml(complaint.email)}</a></td>
          </tr>
          ${complaint.phone ? `<tr>
            <td style="padding: 8px 0; font-weight: bold; color: #555; vertical-align: top;">Phone</td>
            <td style="padding: 8px 0;">${escapeHtml(complaint.phone)}</td>
          </tr>` : ''}
          <tr>
            <td style="padding: 8px 0; font-weight: bold; color: #555; vertical-align: top;">Category</td>
            <td style="padding: 8px 0;">${escapeHtml(complaint.category)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold; color: #555; vertical-align: top;">Subject</td>
            <td style="padding: 8px 0;">${escapeHtml(complaint.subject)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; font-weight: bold; color: #555; vertical-align: top;">Message</td>
            <td style="padding: 8px 0; white-space: pre-wrap;">${escapeHtml(complaint.message)}</td>
          </tr>
        </table>
        <div style="margin-top: 20px; padding: 12px 16px; background: #f5f5f5; border-radius: 6px; font-size: 13px; color: #666;">
          Complaint ID: <code>${complaint.id}</code>
        </div>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: `"Complaints System" <${process.env.SMTP_USER}>`,
    to: process.env.ADMIN_EMAIL,
    replyTo: complaint.email,
    subject: `[Complaint] ${complaint.subject}`,
    html,
    text: `New Complaint\n\nName: ${complaint.name}\nEmail: ${complaint.email}\nPhone: ${complaint.phone || 'N/A'}\nCategory: ${complaint.category}\nSubject: ${complaint.subject}\n\nMessage:\n${complaint.message}\n\nID: ${complaint.id}`,
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 8 * 60 * 60 * 1000 }, // 8 hours
}));

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.redirect('/admin/login');
}

// --- Routes ---

// Submit complaint (public)
app.post('/api/complaint', async (req, res) => {
  const { name, email, phone, category, subject, message } = req.body;

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
    const complaint = addComplaint({ name, email, phone: phone || '', category, subject, message });

    // Send email (non-blocking — don't fail submission if email fails)
    sendComplaintEmail(complaint).catch(err => {
      console.error('Email send failed:', err.message);
    });

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
app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  ) {
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
  if (status && status !== 'all') {
    complaints = complaints.filter(c => c.status === status);
  }
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
app.patch('/api/admin/complaints/:id', requireAuth, (req, res) => {
  const { status } = req.body;
  const validStatuses = ['new', 'in-progress', 'resolved', 'dismissed'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }
  const updated = updateComplaintStatus(req.params.id, status);
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(updated);
});

// API: delete complaint (protected)
app.delete('/api/admin/complaints/:id', requireAuth, (req, res) => {
  const deleted = deleteComplaint(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// API: stats (protected)
app.get('/api/admin/stats', requireAuth, (req, res) => {
  const complaints = readComplaints();
  const stats = {
    total: complaints.length,
    new: complaints.filter(c => c.status === 'new').length,
    inProgress: complaints.filter(c => c.status === 'in-progress').length,
    resolved: complaints.filter(c => c.status === 'resolved').length,
    dismissed: complaints.filter(c => c.status === 'dismissed').length,
  };
  res.json(stats);
});

// Start server
app.listen(PORT, () => {
  console.log(`Complaints app running at http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
});
