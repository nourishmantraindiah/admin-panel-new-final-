const express = require('express');
const router = express.Router();
const { readDB, writeDB, newId } = require('../lib/db');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { logAudit } = require('../lib/audit');
const notifyLib = require('../lib/notify');

// Portal accounts read their own feed here too, so this isn't staff-only.
router.use(requireAuth());

router.get('/', (req, res) => {
  const db = readDB();
  res.json({
    unread: notifyLib.unreadCount(db, req.user),
    items: notifyLib.listFor(db, req.user, {
      includeRead: req.query.unreadOnly !== 'true',
      limit: Number(req.query.limit) || 60
    })
  });
});

router.post('/read', (req, res) => {
  const db = readDB();
  const ids = Array.isArray(req.body.ids) ? req.body.ids : null;
  db.notifications.forEach(n => {
    if (ids && !ids.includes(n.id)) return;
    if (!notifyLib.isForUser(n, req.user)) return;
    if (!n.readBy.includes(req.user.id)) n.readBy.push(req.user.id);
  });
  writeDB(db);
  res.json({ ok: true, unread: notifyLib.unreadCount(db, req.user) });
});

router.post('/dismiss/:id', (req, res) => {
  const db = readDB();
  const n = db.notifications.find(x => x.id === req.params.id);
  if (!n) return res.status(404).json({ error: 'Notification not found.' });
  if (!n.dismissedBy.includes(req.user.id)) n.dismissedBy.push(req.user.id);
  writeDB(db);
  res.json({ ok: true });
});

/* ------------------------------------------------------- Web Push plumbing */

/**
 * The browser needs the VAPID public key before it can subscribe. Keys are
 * generated on first request so nobody has to run a CLI tool to turn push on.
 */
router.get('/vapid-key', (req, res) => {
  const db = readDB();
  if (!notifyLib.webPushAvailable()) {
    return res.json({ available: false, reason: 'The web-push package is not installed — run npm install.' });
  }
  if (notifyLib.ensureVapidKeys(db)) writeDB(db);
  res.json({
    available: !!db.settings.notifications.webPushEnabled,
    publicKey: db.settings.notifications.vapidPublicKey
  });
});

router.post('/subscribe', (req, res) => {
  const db = readDB();
  const { subscription } = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'A push subscription object is required.' });
  }

  // One row per browser endpoint — re-subscribing from the same browser
  // updates rather than duplicating.
  const existing = db.pushSubscriptions.find(s => s.subscription.endpoint === subscription.endpoint);
  if (existing) {
    existing.userId = req.user.id;
    existing.role = req.user.role;
    existing.subscription = subscription;
    existing.updatedAt = new Date().toISOString();
  } else {
    db.pushSubscriptions.push({
      id: newId('sub'),
      userId: req.user.id,
      role: req.user.role,
      name: req.user.name,
      subscription,
      userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
      createdAt: new Date().toISOString()
    });
  }
  writeDB(db);
  res.json({ ok: true });
});

router.post('/unsubscribe', (req, res) => {
  const db = readDB();
  const endpoint = req.body.endpoint;
  db.pushSubscriptions = db.pushSubscriptions.filter(s =>
    !(s.userId === req.user.id && (!endpoint || s.subscription.endpoint === endpoint))
  );
  writeDB(db);
  res.json({ ok: true });
});

/** Fires a push to the caller's own devices so they can confirm it works. */
router.post('/test', (req, res) => {
  const db = readDB();
  notifyLib.notify(db, {
    event: 'announcement',
    title: 'Test Notification',
    body: 'If you can see this outside the browser tab, push is working.',
    audience: { userIds: [req.user.id] },
    respectSettings: false
  });
  writeDB(db);
  res.json({
    ok: true,
    subscribedDevices: db.pushSubscriptions.filter(s => s.userId === req.user.id).length
  });
});

/* ------------------------------------------------------------- Broadcasting */

router.post('/broadcast', requirePerm('notifications.broadcast'), (req, res) => {
  const db = readDB();
  const { title, body, link, roles, everyone } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'Title and body are required.' });

  const record = notifyLib.notify(db, {
    event: 'announcement',
    title, body, link: link || null,
    audience: { everyone: !!everyone, roles: roles || [] },
    respectSettings: false
  });

  logAudit(db, req, {
    action: 'broadcast', entity: 'notification', entityId: record.id, label: title,
    meta: { everyone: !!everyone, roles: roles || [] }
  });
  writeDB(db);
  res.json({ ok: true, notification: record });
});

module.exports = router;
