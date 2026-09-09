const express = require('express');
const router = express.Router();
const { readDB, writeDB } = require('../lib/db');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { logAudit } = require('../lib/audit');
const { ensureVapidKeys, webPushAvailable } = require('../lib/notify');

router.use(requireAuth('staff'));

/**
 * Secrets are never sent back to the browser. Each one is stored under a
 * private key and exposed only as a boolean "…Set" flag, so the UI can show
 * "configured" without ever putting the value in a page someone could read
 * over a shoulder or pull out of devtools.
 */
const SECRET_FIELDS = [
  ['payments', 'keySecret'],
  ['integrations.whatsapp', 'token'],
  ['integrations.email', 'password'],
  ['integrations.meeting', 'token'],
  ['integrations.crm', 'apiKey'],
  ['integrations.sms', 'apiKey'],
  ['integrations.metaLeadAds', 'appSecret'],
  ['notifications', 'vapidPrivateKey']
];

function getPath(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o || {})[k], obj);
}

function redact(settings) {
  const clone = JSON.parse(JSON.stringify(settings));
  SECRET_FIELDS.forEach(([section, field]) => {
    const node = getPath(clone, section);
    if (!node) return;
    delete node[field];
    delete node[`_${field}`];
  });
  return clone;
}

router.get('/', requirePerm('settings.read'), (req, res) => {
  const db = readDB();
  res.json({
    settings: redact(db.settings),
    webPushAvailable: webPushAvailable()
  });
});

/**
 * PUT /api/admin/settings/:section  — section is general | payments |
 * integrations | notifications. Secrets arrive under their plain name and are
 * moved to the private key; sending an empty string leaves the stored secret
 * untouched, so saving the form doesn't wipe credentials you didn't retype.
 */
router.put('/:section', requirePerm('settings.write'), (req, res) => {
  const db = readDB();
  const section = req.params.section;
  if (!['general', 'payments', 'integrations', 'notifications'].includes(section)) {
    return res.status(400).json({ error: 'Unknown settings section.' });
  }

  const before = redact({ [section]: db.settings[section] })[section];
  db.settings[section] = mergeSection(db.settings[section], req.body, section);

  // Turning push on for the first time mints the key pair automatically.
  if (section === 'notifications' && db.settings.notifications.webPushEnabled) {
    ensureVapidKeys(db);
  }

  logAudit(db, req, {
    action: 'update', entity: 'settings', entityId: section, label: `${section} settings`,
    before, after: redact({ [section]: db.settings[section] })[section]
  });
  writeDB(db);
  res.json({ ok: true, settings: redact(db.settings) });
});

function mergeSection(current, incoming, sectionName) {
  const out = JSON.parse(JSON.stringify(current || {}));

  const applySecrets = (node, patch, pathKey) => {
    SECRET_FIELDS.forEach(([section, field]) => {
      const shortSection = section.split('.').pop();
      if (shortSection !== pathKey && section !== sectionName) return;
      if (patch[field] === undefined) return;
      if (patch[field] === '') { delete patch[field]; return; }   // blank = keep existing
      node[`_${field}`] = patch[field];
      node[`${field}Set`] = true;
      delete patch[field];
    });
  };

  const walk = (target, patch, key) => {
    applySecrets(target, patch, key);
    Object.entries(patch).forEach(([k, v]) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        target[k] = target[k] && typeof target[k] === 'object' ? target[k] : {};
        walk(target[k], v, k);
      } else {
        target[k] = v;
      }
    });
  };

  walk(out, JSON.parse(JSON.stringify(incoming || {})), sectionName);
  return out;
}

/**
 * Marks an integration as "connected" without a real OAuth round-trip. The
 * panel stores the credentials and flips the flag; the actual API calls to
 * Meta / Google / WhatsApp are left for you to wire up, since each needs its
 * own app review and callback URL that can't be faked from here.
 */
router.post('/integrations/:key/test', requirePerm('settings.write'), (req, res) => {
  const db = readDB();
  const key = req.params.key;
  const node = db.settings.integrations[key];
  if (!node) return res.status(404).json({ error: 'Unknown integration.' });

  const missing = [];
  const checks = {
    metaLeadAds: ['pageId', 'verifyToken'],
    googleAds: ['customerId'],
    googleAnalytics: ['measurementId'],
    whatsapp: ['phoneNumberId'],
    email: ['host', 'fromEmail'],
    meeting: ['accountEmail'],
    crm: ['provider'],
    sms: ['senderId']
  };
  (checks[key] || []).forEach(f => { if (!node[f]) missing.push(f); });

  if (missing.length) {
    return res.status(400).json({ ok: false, error: `Still missing: ${missing.join(', ')}.` });
  }

  node.lastTestedAt = new Date().toISOString();
  node.lastTestResult = 'config_ok';
  logAudit(db, req, { action: 'test_integration', entity: 'settings', entityId: key, label: key });
  writeDB(db);
  res.json({
    ok: true,
    message: `${key} configuration looks complete. Live delivery still needs the provider SDK wired up in lib/ — see the README.`
  });
});

module.exports = router;
