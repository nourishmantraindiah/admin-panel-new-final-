const express = require('express');
const router = express.Router();
const { readDB } = require('../lib/db');
const { requireAuth, requirePerm } = require('../middleware/auth');

router.use(requireAuth('staff'), requirePerm('audit.read'));

/**
 * The audit log is read-only by design. There is no edit or delete endpoint —
 * a trail somebody can quietly rewrite is worth nothing in a dispute.
 */
router.get('/', (req, res) => {
  const db = readDB();
  const { entity, action, actorId, from, to, q, limit } = req.query;

  let list = db.auditLogs.slice().reverse();
  if (entity) list = list.filter(l => l.entity === entity);
  if (action) list = list.filter(l => l.action === action);
  if (actorId) list = list.filter(l => l.actorId === actorId);
  if (from) list = list.filter(l => l.at >= from);
  if (to) list = list.filter(l => l.at <= to);
  if (q) {
    const needle = String(q).toLowerCase();
    list = list.filter(l =>
      String(l.label || '').toLowerCase().includes(needle) ||
      String(l.actorName || '').toLowerCase().includes(needle) ||
      String(l.entity || '').toLowerCase().includes(needle) ||
      String(l.action || '').toLowerCase().includes(needle)
    );
  }

  res.json({
    total: list.length,
    items: list.slice(0, Number(limit) || 200)
  });
});

/** Distinct values, so the UI filters show only what actually exists. */
router.get('/facets', (req, res) => {
  const db = readDB();
  const entities = new Set(), actions = new Set(), actors = new Map();
  db.auditLogs.forEach(l => {
    entities.add(l.entity);
    actions.add(l.action);
    if (l.actorId) actors.set(l.actorId, l.actorName);
  });
  res.json({
    entities: Array.from(entities).sort(),
    actions: Array.from(actions).sort(),
    actors: Array.from(actors, ([id, name]) => ({ id, name }))
  });
});

router.get('/login-history', (req, res) => {
  const db = readDB();
  let list = db.loginHistory.slice().reverse();
  if (req.query.email) list = list.filter(l => l.email === req.query.email);
  if (req.query.failedOnly === 'true') list = list.filter(l => !l.success);
  res.json({ total: list.length, items: list.slice(0, Number(req.query.limit) || 200) });
});

/**
 * The narrow views people actually ask for after something goes wrong:
 * what got deleted, which fees changed, who changed permissions.
 */
router.get('/sensitive', (req, res) => {
  const db = readDB();
  const logs = db.auditLogs.slice().reverse();
  res.json({
    deletions: logs.filter(l => l.action === 'delete').slice(0, 100),
    paymentChanges: logs.filter(l => ['record_payment', 'reverse_payment', 'update'].includes(l.action) &&
      ['payment', 'fee_profile', 'invoice'].includes(l.entity)).slice(0, 100),
    statusChanges: logs.filter(l => l.entity === 'student' &&
      (l.changes || []).some(c => c.field === 'status' || c.field === 'placementStatus')).slice(0, 100),
    permissionChanges: logs.filter(l => l.entity === 'staff' || l.action === 'role_change').slice(0, 100),
    documentAccess: logs.filter(l => l.action === 'view_document').slice(0, 100)
  });
});

module.exports = router;
