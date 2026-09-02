const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { readDB } = require('../lib/db');
const { signToken } = require('../middleware/auth');

// POST /api/auth/login  { email, password }
// This standalone build only serves the admin panel, so the only account
// type that can log in here is an admin. (The role field is accepted but
// ignored if sent, for compatibility with the shared admin-panel front end.)
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const db = readDB();
  const admin = db.adminUsers.find(a => a.email.toLowerCase() === String(email).toLowerCase());
  if (!admin || !bcrypt.compareSync(password, admin.passwordHash)) {
    return res.status(401).json({ error: "That email/password combination isn't recognized." });
  }

  const token = signToken({ id: admin.email, role: 'admin', email: admin.email, name: 'Admin' });
  res.json({ ok: true, token, role: 'admin', name: 'Admin' });
});

module.exports = router;
