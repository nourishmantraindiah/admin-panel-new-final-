const { newId } = require('./db');

const MAX_LOGS = 5000;

/**
 * Records a change against the acting user. Mutates the passed-in db object;
 * the caller is expected to writeDB() afterwards, so a change and its audit
 * entry are saved in the same write and can't drift apart.
 *
 * `before`/`after` are trimmed to the fields that actually differ — storing
 * whole records would balloon db.json and bury the useful signal.
 */
function logAudit(db, req, { action, entity, entityId, label, before, after, meta }) {
  const changes = diff(before, after);

  const entry = {
    id: newId('log'),
    at: new Date().toISOString(),
    actorId: req && req.user ? req.user.id : 'system',
    actorName: req && req.user ? req.user.name : 'System',
    actorEmail: req && req.user ? req.user.email : '',
    actorRole: req && req.user ? req.user.role : 'system',
    ip: req ? (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim() : '',
    action,
    entity,
    entityId: entityId || null,
    label: label || '',
    changes,
    meta: meta || null
  };

  db.auditLogs.push(entry);
  if (db.auditLogs.length > MAX_LOGS) {
    db.auditLogs = db.auditLogs.slice(-MAX_LOGS);
  }
  return entry;
}

const REDACTED_KEYS = ['passwordHash', 'password', 'token', 'apiKey', 'keySecret', 'vapidPrivateKey'];

function diff(before, after) {
  if (!before && !after) return [];
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const out = [];
  for (const key of keys) {
    if (REDACTED_KEYS.includes(key)) {
      const b = before ? before[key] : undefined;
      const a = after ? after[key] : undefined;
      if (JSON.stringify(b) !== JSON.stringify(a)) out.push({ field: key, from: '••••', to: '•••• (changed)' });
      continue;
    }
    const b = before ? before[key] : undefined;
    const a = after ? after[key] : undefined;
    if (JSON.stringify(b) === JSON.stringify(a)) continue;
    out.push({ field: key, from: summarise(b), to: summarise(a) });
  }
  return out;
}

function summarise(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 120);
  return String(value).slice(0, 200);
}

function logLogin(db, { email, name, role, ok, reason, req }) {
  db.loginHistory.push({
    id: newId('lgn'),
    at: new Date().toISOString(),
    email,
    name: name || '',
    role: role || '',
    success: !!ok,
    reason: reason || '',
    ip: req ? (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim() : '',
    userAgent: req ? String(req.headers['user-agent'] || '').slice(0, 200) : ''
  });
  if (db.loginHistory.length > 2000) db.loginHistory = db.loginHistory.slice(-2000);
}

module.exports = { logAudit, logLogin };
