const { newId } = require('./db');

// web-push is optional: if it isn't installed the panel still works, it just
// falls back to the in-app bell instead of OS-level push.
let webpush = null;
try {
  webpush = require('web-push');
} catch (err) {
  webpush = null;
}

const MAX_NOTIFICATIONS = 3000;

const EVENT_META = {
  new_lead:              { icon: '🔔', title: 'New Lead' },
  new_application:       { icon: '📝', title: 'New Application' },
  enrollment:            { icon: '🎉', title: 'New Enrollment' },
  payment_received:      { icon: '💰', title: 'Payment Received' },
  payment_overdue:       { icon: '⚠️', title: 'Payment Overdue' },
  assignment_submitted:  { icon: '📤', title: 'Assignment Submitted' },
  low_attendance:        { icon: '📉', title: 'Low Attendance' },
  student_placement:     { icon: '🏆', title: 'Student Placed' },
  webinar_registration:  { icon: '🎟️', title: 'New Webinar Registration' },
  new_query:             { icon: '❓', title: 'New Query' },
  new_dispute:           { icon: '⚖️', title: 'New Dispute' },
  form_submission:       { icon: '📥', title: 'New Form Submission' },
  document_uploaded:     { icon: '📎', title: 'Document Uploaded' },
  class_scheduled:       { icon: '📅', title: 'Class Scheduled' },
  announcement:          { icon: '📣', title: 'Announcement' },
  welcome:               { icon: '👋', title: 'Welcome' }
};

function vapidReady(settings) {
  const n = settings && settings.notifications;
  return !!(webpush && n && n.webPushEnabled && n.vapidPublicKey && n.vapidPrivateKey);
}

/** Generates and stores a VAPID key pair the first time push is switched on. */
function ensureVapidKeys(db) {
  if (!webpush) return false;
  const n = db.settings.notifications;
  if (n.vapidPublicKey && n.vapidPrivateKey) return false;
  const keys = webpush.generateVAPIDKeys();
  n.vapidPublicKey = keys.publicKey;
  n.vapidPrivateKey = keys.privateKey;
  return true;
}

function configureWebPush(db) {
  if (!vapidReady(db.settings)) return false;
  const n = db.settings.notifications;
  const contact = db.settings.general.supportEmail || 'admin@example.com';
  webpush.setVapidDetails(
    contact.startsWith('http') ? contact : `mailto:${contact}`,
    n.vapidPublicKey,
    n.vapidPrivateKey
  );
  return true;
}

/**
 * Creates a notification and fans it out.
 *
 * audience: { roles: [...], userIds: [...], everyone: bool }
 *   - roles targets admin staff roles AND portal roles ('student','mentor','employer')
 *   - userIds targets specific accounts regardless of role
 *   - everyone targets every account in the system
 *
 * Mutates db (caller writes). Push delivery is fired async and never blocks
 * or fails the request that triggered it.
 */
function notify(db, { event, title, body, link, audience, meta, respectSettings = true }) {
  const cfg = db.settings.notifications || {};
  const eventCfg = (cfg.events || {})[event];

  if (respectSettings && eventCfg && eventCfg.enabled === false) return null;

  const roles = new Set(audience && audience.roles ? audience.roles : []);
  if (respectSettings && eventCfg && Array.isArray(eventCfg.roles)) {
    eventCfg.roles.forEach(r => roles.add(r));
  }

  const preset = EVENT_META[event] || { icon: '🔔', title: 'Notification' };

  const record = {
    id: newId('ntf'),
    event,
    icon: preset.icon,
    title: title || preset.title,
    body: body || '',
    link: link || null,
    createdAt: new Date().toISOString(),
    audience: {
      everyone: !!(audience && audience.everyone),
      roles: Array.from(roles),
      userIds: (audience && audience.userIds) || []
    },
    meta: meta || null,
    readBy: [],
    dismissedBy: []
  };

  db.notifications.push(record);
  if (db.notifications.length > MAX_NOTIFICATIONS) {
    db.notifications = db.notifications.slice(-MAX_NOTIFICATIONS);
  }

  sendPush(db, record);
  return record;
}

function isForUser(notification, user) {
  const a = notification.audience || {};
  if (a.everyone) return true;
  if (Array.isArray(a.userIds) && a.userIds.includes(user.id)) return true;
  if (Array.isArray(a.roles) && a.roles.includes(user.role)) return true;
  return false;
}

function listFor(db, user, { includeRead = true, limit = 100 } = {}) {
  return db.notifications
    .filter(n => isForUser(n, user))
    .filter(n => !n.dismissedBy.includes(user.id))
    .filter(n => includeRead || !n.readBy.includes(user.id))
    .slice(-limit)
    .reverse()
    .map(n => ({
      id: n.id,
      event: n.event,
      icon: n.icon,
      title: n.title,
      body: n.body,
      link: n.link,
      createdAt: n.createdAt,
      read: n.readBy.includes(user.id)
    }));
}

function unreadCount(db, user) {
  return db.notifications.filter(n =>
    isForUser(n, user) && !n.readBy.includes(user.id) && !n.dismissedBy.includes(user.id)
  ).length;
}

/**
 * Pushes to every subscribed browser in the target audience. Dead
 * subscriptions (410/404) are pruned so the list doesn't rot over time.
 */
function sendPush(db, record) {
  if (!configureWebPush(db)) return;

  const targets = db.pushSubscriptions.filter(sub =>
    isForUser(record, { id: sub.userId, role: sub.role })
  );
  if (!targets.length) return;

  const payload = JSON.stringify({
    title: `${record.icon} ${record.title}`,
    body: record.body,
    link: record.link,
    event: record.event,
    id: record.id
  });

  const stale = [];
  Promise.allSettled(targets.map(sub =>
    webpush.sendNotification(sub.subscription, payload).catch(err => {
      if (err && (err.statusCode === 410 || err.statusCode === 404)) stale.push(sub.id);
      throw err;
    })
  )).then(() => {
    if (!stale.length) return;
    // Re-read is deliberate: this runs after the request's write has landed.
    const { readDB, writeDB } = require('./db');
    const fresh = readDB();
    fresh.pushSubscriptions = fresh.pushSubscriptions.filter(s => !stale.includes(s.id));
    writeDB(fresh);
  }).catch(() => { /* push is best-effort — never surface it to the caller */ });
}

module.exports = {
  notify,
  listFor,
  unreadCount,
  isForUser,
  ensureVapidKeys,
  vapidReady,
  webPushAvailable: () => !!webpush,
  EVENT_META
};
