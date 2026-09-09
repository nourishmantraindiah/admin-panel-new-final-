const express = require('express');
const router = express.Router();
const { readDB, writeDB, newId } = require('../lib/db');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { logAudit } = require('../lib/audit');
const { notify } = require('../lib/notify');

router.use(requireAuth('staff'));

const nowISO = () => new Date().toISOString();

const QUERY_CATEGORIES = ['admission', 'course', 'fees', 'technical', 'certificate', 'placement', 'mentor', 'general'];
const DISPUTE_TYPES = ['payment', 'refund', 'attendance', 'assessment', 'mentor_payout', 'placement', 'conduct', 'other'];

/* ==========================================================================
   QUERIES
   ========================================================================== */

function slaState(q) {
  if (q.status === 'resolved' || q.status === 'closed') return 'met';
  const hours = (Date.now() - new Date(q.createdAt).getTime()) / 3600000;
  const target = { urgent: 4, high: 12, normal: 24, low: 72 }[q.priority] || 24;
  if (hours > target) return 'breached';
  if (hours > target * 0.75) return 'at_risk';
  return 'ok';
}

router.get('/queries', requirePerm('queries.read'), (req, res) => {
  const db = readDB();
  let list = db.queries;
  if (req.query.status) list = list.filter(q => q.status === req.query.status);
  if (req.query.category) list = list.filter(q => q.category === req.query.category);
  if (req.query.assignedTo) list = list.filter(q => q.assignedTo === req.query.assignedTo);

  res.json(list.slice().reverse().map(q => ({
    ...q,
    sla: slaState(q),
    assigneeName: (db.adminUsers.find(a => a.id === q.assignedTo) || {}).name || null,
    replyCount: (q.thread || []).length
  })));
});

router.get('/queries/:id', requirePerm('queries.read'), (req, res) => {
  const db = readDB();
  const q = db.queries.find(x => x.id === req.params.id);
  if (!q) return res.status(404).json({ error: 'Query not found.' });
  res.json({ ...q, sla: slaState(q) });
});

/** Staff can also raise a query on someone's behalf (phone call, walk-in). */
router.post('/queries', requirePerm('queries.write'), (req, res) => {
  const db = readDB();
  const { name, email, phone, category, subject, message, priority, raisedByType, raisedById, channel } = req.body;
  if (!subject || !message) return res.status(400).json({ error: 'Subject and message are required.' });

  const query = {
    id: newId('qry'),
    ticketNo: `QRY-${String(db.queries.length + 1).padStart(5, '0')}`,
    name: name || '', email: email || '', phone: phone || '',
    raisedByType: raisedByType || 'visitor',   // student | mentor | employer | visitor
    raisedById: raisedById || null,
    category: QUERY_CATEGORIES.includes(category) ? category : 'general',
    subject, message,
    priority: priority || 'normal',            // low | normal | high | urgent
    status: 'open',                            // open | in_progress | waiting | resolved | closed
    channel: channel || 'admin',               // website | email | whatsapp | phone | admin
    assignedTo: null,
    thread: [],
    createdAt: nowISO(),
    resolvedAt: null
  };
  db.queries.push(query);

  logAudit(db, req, { action: 'create', entity: 'query', entityId: query.id, label: query.ticketNo, after: query });
  writeDB(db);
  res.status(201).json({ ok: true, query });
});

router.put('/queries/:id', requirePerm('queries.write'), (req, res) => {
  const db = readDB();
  const q = db.queries.find(x => x.id === req.params.id);
  if (!q) return res.status(404).json({ error: 'Query not found.' });

  const before = { status: q.status, priority: q.priority, assignedTo: q.assignedTo, category: q.category };
  const allowed = ['status', 'priority', 'assignedTo', 'category', 'subject'];
  allowed.forEach(k => { if (req.body[k] !== undefined) q[k] = req.body[k]; });
  if (q.status === 'resolved' && !q.resolvedAt) q.resolvedAt = nowISO();
  if (q.status !== 'resolved') q.resolvedAt = null;

  logAudit(db, req, { action: 'update', entity: 'query', entityId: q.id, label: q.ticketNo, before, after: q });
  writeDB(db);
  res.json({ ok: true, query: q });
});

router.post('/queries/:id/reply', requirePerm('queries.write'), (req, res) => {
  const db = readDB();
  const q = db.queries.find(x => x.id === req.params.id);
  if (!q) return res.status(404).json({ error: 'Query not found.' });
  const { message, internal } = req.body;
  if (!message) return res.status(400).json({ error: 'A message is required.' });

  q.thread.push({
    id: newId('msg'), by: req.user.id, byName: req.user.name,
    internal: !!internal,               // internal notes are never shown to the requester
    message, at: nowISO()
  });
  if (q.status === 'open') q.status = 'in_progress';

  if (!internal && q.raisedById) {
    notify(db, {
      event: 'announcement',
      title: `Reply on ${q.ticketNo}`,
      body: message.slice(0, 140),
      audience: { userIds: [q.raisedById] },
      respectSettings: false
    });
  }

  logAudit(db, req, { action: 'reply', entity: 'query', entityId: q.id, label: q.ticketNo, meta: { internal: !!internal } });
  writeDB(db);
  res.json({ ok: true, query: q });
});

router.delete('/queries/:id', requirePerm('queries.write'), (req, res) => {
  const db = readDB();
  const q = db.queries.find(x => x.id === req.params.id);
  if (!q) return res.status(404).json({ error: 'Query not found.' });
  db.queries = db.queries.filter(x => x.id !== q.id);
  logAudit(db, req, { action: 'delete', entity: 'query', entityId: q.id, label: q.ticketNo, before: q });
  writeDB(db);
  res.json({ ok: true });
});

/* ==========================================================================
   DISPUTES
   ========================================================================== */

router.get('/disputes', requirePerm('disputes.read'), (req, res) => {
  const db = readDB();
  let list = db.disputes;
  if (req.query.status) list = list.filter(d => d.status === req.query.status);
  if (req.query.type) list = list.filter(d => d.type === req.query.type);
  res.json(list.slice().reverse().map(d => ({
    ...d,
    assigneeName: (db.adminUsers.find(a => a.id === d.assignedTo) || {}).name || null,
    ageDays: Math.floor((Date.now() - new Date(d.createdAt).getTime()) / 86400000)
  })));
});

router.post('/disputes', requirePerm('disputes.write'), (req, res) => {
  const db = readDB();
  const { type, raisedByType, raisedById, raisedByName, againstType, againstId, subject, description, amount, severity } = req.body;
  if (!subject || !description) return res.status(400).json({ error: 'Subject and description are required.' });

  const dispute = {
    id: newId('dsp'),
    caseNo: `DSP-${String(db.disputes.length + 1).padStart(5, '0')}`,
    type: DISPUTE_TYPES.includes(type) ? type : 'other',
    raisedByType: raisedByType || 'student',
    raisedById: raisedById || null,
    raisedByName: raisedByName || '',
    againstType: againstType || null,
    againstId: againstId || null,
    subject, description,
    amount: Number(amount) || 0,
    severity: severity || 'medium',      // low | medium | high | critical
    status: 'open',                      // open | investigating | awaiting_response | resolved | rejected | escalated
    assignedTo: null,
    resolution: '',
    thread: [],
    evidence: [],
    createdAt: nowISO(),
    resolvedAt: null
  };
  db.disputes.push(dispute);

  notify(db, {
    event: 'new_dispute',
    title: 'New Dispute',
    body: `${dispute.caseNo} — ${subject}${dispute.amount ? ` (₹${dispute.amount.toLocaleString('en-IN')})` : ''}`,
    link: `#disputes/${dispute.id}`,
    audience: {},
    meta: { disputeId: dispute.id }
  });

  logAudit(db, req, { action: 'create', entity: 'dispute', entityId: dispute.id, label: dispute.caseNo, after: dispute });
  writeDB(db);
  res.status(201).json({ ok: true, dispute });
});

router.put('/disputes/:id', requirePerm('disputes.write'), (req, res) => {
  const db = readDB();
  const d = db.disputes.find(x => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: 'Dispute not found.' });

  const before = { status: d.status, severity: d.severity, assignedTo: d.assignedTo, resolution: d.resolution };
  ['status', 'severity', 'assignedTo', 'resolution', 'type', 'amount'].forEach(k => {
    if (req.body[k] !== undefined) d[k] = req.body[k];
  });
  if (['resolved', 'rejected'].includes(d.status) && !d.resolvedAt) d.resolvedAt = nowISO();

  if (['resolved', 'rejected'].includes(d.status) && d.raisedById) {
    notify(db, {
      event: 'announcement',
      title: `Dispute ${d.status === 'resolved' ? 'Resolved' : 'Closed'}`,
      body: `${d.caseNo}: ${d.resolution || 'See the case for details.'}`,
      audience: { userIds: [d.raisedById] },
      respectSettings: false
    });
  }

  logAudit(db, req, { action: 'update', entity: 'dispute', entityId: d.id, label: d.caseNo, before, after: d });
  writeDB(db);
  res.json({ ok: true, dispute: d });
});

router.post('/disputes/:id/note', requirePerm('disputes.write'), (req, res) => {
  const db = readDB();
  const d = db.disputes.find(x => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: 'Dispute not found.' });
  if (!req.body.message) return res.status(400).json({ error: 'A message is required.' });

  d.thread.push({
    id: newId('msg'), by: req.user.id, byName: req.user.name,
    internal: req.body.internal !== false, message: req.body.message, at: nowISO()
  });
  logAudit(db, req, { action: 'note', entity: 'dispute', entityId: d.id, label: d.caseNo });
  writeDB(db);
  res.json({ ok: true, dispute: d });
});

/* ==========================================================================
   FORM SUBMISSIONS — every form on the public website lands here
   ========================================================================== */

router.get('/forms', requirePerm('forms.read'), (req, res) => {
  const db = readDB();
  let list = db.formSubmissions;
  if (req.query.formKey) list = list.filter(f => f.formKey === req.query.formKey);
  if (req.query.status) list = list.filter(f => f.status === req.query.status);
  res.json(list.slice().reverse());
});

/** The distinct form types that have actually been received, for the filter. */
router.get('/forms/keys', requirePerm('forms.read'), (req, res) => {
  const db = readDB();
  const counts = {};
  db.formSubmissions.forEach(f => {
    counts[f.formKey] = counts[f.formKey] || { formKey: f.formKey, formName: f.formName, total: 0, unread: 0 };
    counts[f.formKey].total++;
    if (f.status === 'new') counts[f.formKey].unread++;
  });
  res.json(Object.values(counts));
});

router.put('/forms/:id', requirePerm('forms.write'), (req, res) => {
  const db = readDB();
  const f = db.formSubmissions.find(x => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: 'Submission not found.' });
  const before = { status: f.status, note: f.note };
  if (req.body.status) f.status = req.body.status;      // new | read | actioned | spam | archived
  if (req.body.note !== undefined) f.note = req.body.note;
  f.handledBy = req.user.id;
  f.handledAt = nowISO();
  logAudit(db, req, { action: 'update', entity: 'form_submission', entityId: f.id, label: f.formName, before, after: f });
  writeDB(db);
  res.json({ ok: true, submission: f });
});

/** Turn any form submission into a proper lead without retyping it. */
router.post('/forms/:id/convert-to-lead', requirePerm('forms.write'), (req, res) => {
  const db = readDB();
  const f = db.formSubmissions.find(x => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: 'Submission not found.' });

  const lead = {
    id: newId('led'),
    name: f.fields.name || f.fields.fullName || '',
    email: f.fields.email || '',
    phone: f.fields.phone || f.fields.mobile || '',
    track: f.fields.track || f.fields.course || '',
    message: f.fields.message || '',
    status: 'new',
    source: `form:${f.formKey}`,
    createdAt: nowISO()
  };
  db.leads.push(lead);
  f.status = 'actioned';
  f.convertedLeadId = lead.id;

  logAudit(db, req, { action: 'convert', entity: 'form_submission', entityId: f.id, label: f.formName, meta: { leadId: lead.id } });
  writeDB(db);
  res.json({ ok: true, lead });
});

router.delete('/forms/:id', requirePerm('forms.write'), (req, res) => {
  const db = readDB();
  const f = db.formSubmissions.find(x => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: 'Submission not found.' });
  db.formSubmissions = db.formSubmissions.filter(x => x.id !== f.id);
  logAudit(db, req, { action: 'delete', entity: 'form_submission', entityId: f.id, label: f.formName, before: f });
  writeDB(db);
  res.json({ ok: true });
});

/* ------------------------------------------------------------- Desk summary */

router.get('/summary', (req, res) => {
  const db = readDB();
  res.json({
    queriesOpen: db.queries.filter(q => ['open', 'in_progress', 'waiting'].includes(q.status)).length,
    queriesBreached: db.queries.filter(q => slaState(q) === 'breached').length,
    disputesOpen: db.disputes.filter(d => ['open', 'investigating', 'awaiting_response', 'escalated'].includes(d.status)).length,
    disputeValue: db.disputes.filter(d => d.status !== 'resolved' && d.status !== 'rejected')
      .reduce((s, d) => s + (Number(d.amount) || 0), 0),
    formsNew: db.formSubmissions.filter(f => f.status === 'new').length
  });
});

module.exports = router;
module.exports.QUERY_CATEGORIES = QUERY_CATEGORIES;
module.exports.DISPUTE_TYPES = DISPUTE_TYPES;
