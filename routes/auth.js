const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { readDB, writeDB } = require('../lib/db');
const { signToken } = require('../middleware/auth');
const { permissionsFor, ROLES } = require('../lib/permissions');
const { logLogin } = require('../lib/audit');

/**
 * POST /api/auth/login { email, password }
 *
 * Staff accounts live in `adminUsers` and carry a role (super_admin,
 * finance, trainer, …). Mentors, students and employers can also sign in —
 * they get heavily scoped tokens and are only used by the portals, but
 * issuing them here keeps one login surface instead of four.
 */
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const db = readDB();
  const lower = String(email).toLowerCase();

  const staff = db.adminUsers.find(a => a.email.toLowerCase() === lower);
  if (staff) {
    if (staff.active === false) {
      logLogin(db, { email: lower, role: staff.role, ok: false, reason: 'account disabled', req });
      writeDB(db);
      return res.status(403).json({ error: 'This account has been disabled. Contact your Super Admin.' });
    }
    if (!bcrypt.compareSync(password, staff.passwordHash)) {
      logLogin(db, { email: lower, name: staff.name, role: staff.role, ok: false, reason: 'bad password', req });
      writeDB(db);
      return res.status(401).json({ error: "That email/password combination isn't recognized." });
    }

    const permissions = permissionsFor(staff.role);
    const token = signToken({
      id: staff.id,
      role: staff.role,
      email: staff.email,
      name: staff.name || 'Admin',
      courseIds: staff.courseIds || [],
      permissions
    });

    staff.lastLoginAt = new Date().toISOString();
    logLogin(db, { email: staff.email, name: staff.name, role: staff.role, ok: true, req });
    writeDB(db);

    return res.json({
      ok: true,
      token,
      role: staff.role,
      roleLabel: (ROLES[staff.role] || {}).label || staff.role,
      name: staff.name || 'Admin',
      permissions,
      courseIds: staff.courseIds || []
    });
  }

  // Portal accounts — scoped tokens, no admin permissions.
  const portals = [
    { list: db.mentors, role: 'mentor' },
    { list: db.students, role: 'student' },
    { list: db.employers, role: 'employer' }
  ];

  for (const { list, role } of portals) {
    const account = list.find(u => u.email && u.email.toLowerCase() === lower);
    if (!account) continue;

    if (account.status === 'suspended' || account.active === false) {
      logLogin(db, { email: lower, role, ok: false, reason: 'account suspended', req });
      writeDB(db);
      return res.status(403).json({ error: 'This account is suspended. Please contact support.' });
    }
    if (!bcrypt.compareSync(password, account.passwordHash)) {
      logLogin(db, { email: lower, name: account.name, role, ok: false, reason: 'bad password', req });
      writeDB(db);
      return res.status(401).json({ error: "That email/password combination isn't recognized." });
    }

    const token = signToken({
      id: account.id,
      role,
      email: account.email,
      name: account.name,
      courseIds: account.courseIds || [],
      permissions: []
    });

    account.lastLoginAt = new Date().toISOString();
    logLogin(db, { email: account.email, name: account.name, role, ok: true, req });
    writeDB(db);

    return res.json({
      ok: true,
      token,
      role,
      roleLabel: role.charAt(0).toUpperCase() + role.slice(1),
      name: account.name,
      permissions: [],
      courseIds: account.courseIds || []
    });
  }

  logLogin(db, { email: lower, ok: false, reason: 'unknown account', req });
  writeDB(db);
  res.status(401).json({ error: "That email/password combination isn't recognized." });
});

/** Lets the front end restore role/permission state without a fresh login. */
router.get('/me', (req, res) => {
  const { requireAuth } = require('../middleware/auth');
  requireAuth()(req, res, () => {
    res.json({
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      roleLabel: (ROLES[req.user.role] || {}).label || req.user.role,
      permissions: req.user.permissions,
      courseIds: req.user.courseIds || []
    });
  });
});

module.exports = router;
