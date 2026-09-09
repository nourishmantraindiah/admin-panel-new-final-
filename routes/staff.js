const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { readDB, writeDB, newId } = require('../lib/db');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { ROLES, permissionsFor } = require('../lib/permissions');
const { logAudit } = require('../lib/audit');
const { notify } = require('../lib/notify');

router.use(requireAuth('staff'));

const nowISO = () => new Date().toISOString();
const safe = ({ passwordHash, ...rest }) => rest;

router.get('/roles', (req, res) => {
  res.json(Object.entries(ROLES).map(([key, r]) => ({
    key, label: r.label, description: r.description, permissions: permissionsFor(key)
  })));
});

router.get('/', requirePerm('staff.read'), (req, res) => {
  const db = readDB();
  res.json(db.adminUsers.map(u => ({
    ...safe(u),
    roleLabel: (ROLES[u.role] || {}).label || u.role,
    courseNames: (u.courseIds || []).map(id => (db.courses.find(c => c.id === id) || {}).name).filter(Boolean)
  })));
});

router.post('/', requirePerm('staff.write'), (req, res) => {
  const db = readDB();
  const { name, email, password, role, courseIds, phone } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'Name, email, password and role are required.' });
  }
  if (!ROLES[role]) return res.status(400).json({ error: 'Unknown role.' });
  if (db.adminUsers.some(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: 'A staff account with that email already exists.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Use at least 8 characters for a staff password.' });
  }

  // Only a Super Admin can mint another Super Admin — otherwise any role with
  // staff.write could quietly promote itself to full access.
  if (role === 'super_admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only a Super Admin can create another Super Admin.' });
  }

  const user = {
    id: newId('adm'),
    name, email,
    phone: phone || '',
    passwordHash: bcrypt.hashSync(password, 10),
    role,
    // Empty courseIds means unrestricted. Populate it for a trainer or
    // academic manager who should only see their own course.
    courseIds: Array.isArray(courseIds) ? courseIds : [],
    active: true,
    createdBy: req.user.id,
    createdAt: nowISO(),
    lastLoginAt: null
  };
  db.adminUsers.push(user);

  notify(db, {
    event: 'welcome',
    title: 'Staff Account Created',
    body: `${name} was added as ${(ROLES[role] || {}).label || role}.`,
    audience: { userIds: [user.id], roles: ['super_admin'] },
    respectSettings: false
  });

  logAudit(db, req, {
    action: 'create', entity: 'staff', entityId: user.id, label: `${name} (${role})`,
    after: safe(user)
  });
  writeDB(db);
  res.status(201).json({ ok: true, staff: safe(user) });
});

router.put('/:id', requirePerm('staff.write'), (req, res) => {
  const db = readDB();
  const user = db.adminUsers.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Staff account not found.' });

  const before = safe({ ...user });
  const { name, email, phone, role, courseIds, active, password } = req.body;

  if (role && role !== user.role) {
    if (!ROLES[role]) return res.status(400).json({ error: 'Unknown role.' });
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only a Super Admin can change roles.' });
    }
    // Guard against removing the last Super Admin and locking everyone out.
    if (user.role === 'super_admin' && role !== 'super_admin') {
      const others = db.adminUsers.filter(u => u.role === 'super_admin' && u.id !== user.id && u.active !== false);
      if (!others.length) {
        return res.status(400).json({ error: 'This is the last Super Admin — promote someone else before changing this role.' });
      }
    }
    user.role = role;
  }

  if (name !== undefined) user.name = name;
  if (email !== undefined) user.email = email;
  if (phone !== undefined) user.phone = phone;
  if (Array.isArray(courseIds)) user.courseIds = courseIds;
  if (active !== undefined) {
    if (active === false && user.id === req.user.id) {
      return res.status(400).json({ error: "You can't disable your own account." });
    }
    user.active = active;
  }
  if (password) {
    if (password.length < 8) return res.status(400).json({ error: 'Use at least 8 characters.' });
    user.passwordHash = bcrypt.hashSync(password, 10);
  }

  logAudit(db, req, {
    action: role && role !== before.role ? 'role_change' : 'update',
    entity: 'staff', entityId: user.id, label: user.name,
    before, after: safe(user)
  });
  writeDB(db);
  res.json({ ok: true, staff: safe(user) });
});

router.delete('/:id', requirePerm('staff.write'), (req, res) => {
  const db = readDB();
  const user = db.adminUsers.find(u => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'Staff account not found.' });
  if (user.id === req.user.id) return res.status(400).json({ error: "You can't delete your own account." });

  if (user.role === 'super_admin') {
    const others = db.adminUsers.filter(u => u.role === 'super_admin' && u.id !== user.id && u.active !== false);
    if (!others.length) return res.status(400).json({ error: 'This is the last Super Admin — the panel would be unreachable.' });
  }

  db.adminUsers = db.adminUsers.filter(u => u.id !== user.id);
  logAudit(db, req, { action: 'delete', entity: 'staff', entityId: user.id, label: user.name, before: safe(user) });
  writeDB(db);
  res.json({ ok: true });
});

module.exports = router;
