const express = require('express');
const router = express.Router();
const { readDB, writeDB, newId } = require('../lib/db');
const { notify } = require('../lib/notify');

/**
 * PUBLIC. No auth — the marketing site posts here directly.
 *
 * One endpoint for every form on the website:
 *   POST /api/forms/contact
 *   POST /api/forms/apply
 *   POST /api/forms/callback
 *   POST /api/forms/brochure
 *   POST /api/forms/corporate-training
 *   POST /api/forms/<anything-you-add-later>
 *
 * Whatever fields you send land in the Forms inbox with the form's name on
 * them, so a new form on the site shows up in the panel without any backend
 * change. Known form keys additionally create the right record (a lead, a
 * query, a webinar registration).
 */

const nowISO = () => new Date().toISOString();

// Rough in-memory throttle. Enough to stop a bot hammering the endpoint;
// swap for express-rate-limit or a WAF rule before this faces real traffic.
const hits = new Map();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;

function throttle(req, res, next) {
  const ip = (req.headers['x-forwarded-for'] || req.ip || 'unknown').toString().split(',')[0].trim();
  const now = Date.now();
  const record = hits.get(ip) || { count: 0, resetAt: now + WINDOW_MS };
  if (now > record.resetAt) { record.count = 0; record.resetAt = now + WINDOW_MS; }
  record.count++;
  hits.set(ip, record);
  if (record.count > MAX_PER_WINDOW) {
    return res.status(429).json({ error: 'Too many submissions. Please try again in a minute.' });
  }
  next();
}

const FORM_NAMES = {
  contact: 'Contact Us',
  apply: 'Apply Now',
  callback: 'Request a Callback',
  brochure: 'Download Brochure',
  webinar: 'Webinar Registration',
  'corporate-training': 'Corporate Training Enquiry',
  'hire-from-us': 'Hire From Us',
  'become-a-mentor': 'Become a Mentor',
  query: 'Raise a Query',
  dispute: 'Raise a Dispute',
  newsletter: 'Newsletter Signup',
  feedback: 'Feedback'
};

const SPAM_HINTS = [/\bhttps?:\/\/\S+\b.*\bhttps?:\/\/\S+/i, /\b(casino|crypto giveaway|seo services|backlink)\b/i];

function looksLikeSpam(fields) {
  const blob = JSON.stringify(fields || {});
  return SPAM_HINTS.some(rx => rx.test(blob));
}

function sanitise(fields) {
  const out = {};
  Object.entries(fields || {}).forEach(([k, v]) => {
    if (k === 'honeypot' || k === '_gotcha') return;
    const key = String(k).slice(0, 60);
    if (v == null) return;
    out[key] = typeof v === 'object' ? JSON.stringify(v).slice(0, 2000) : String(v).slice(0, 2000);
  });
  return out;
}

router.post('/:formKey', throttle, (req, res) => {
  const formKey = String(req.params.formKey).toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(0, 50);
  if (!formKey) return res.status(400).json({ error: 'A form key is required.' });

  // Honeypot: a real person never fills a hidden field. Accept silently so
  // the bot doesn't learn it was caught.
  if (req.body && (req.body.honeypot || req.body._gotcha)) {
    return res.json({ ok: true });
  }

  const db = readDB();
  const fields = sanitise(req.body);
  const spam = looksLikeSpam(fields);

  const submission = {
    id: newId('frm'),
    formKey,
    formName: FORM_NAMES[formKey] || formKey.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    fields,
    pageUrl: (req.headers.referer || '').slice(0, 300),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 200),
    ip: (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim(),
    status: spam ? 'spam' : 'new',
    note: '',
    submittedAt: nowISO()
  };
  db.formSubmissions.push(submission);

  if (!spam) {
    routeSubmission(db, formKey, fields, submission);
    notify(db, {
      event: 'form_submission',
      title: `New: ${submission.formName}`,
      body: `${fields.name || fields.email || 'Someone'} submitted the ${submission.formName} form.`,
      link: `#forms/${submission.id}`,
      audience: {},
      meta: { submissionId: submission.id, formKey }
    });
  }

  writeDB(db);
  res.status(201).json({ ok: true, id: submission.id, message: 'Thanks — we have your details and will be in touch.' });
});

/** Known forms also create the record the team actually works from. */
function routeSubmission(db, formKey, f, submission) {
  const name = f.name || f.fullName || '';
  const email = f.email || '';
  const phone = f.phone || f.mobile || '';

  if (['apply', 'callback', 'brochure', 'contact', 'corporate-training', 'hire-from-us'].includes(formKey)) {
    const lead = {
      id: newId('led'),
      name, email, phone,
      track: f.track || f.course || '',
      message: f.message || f.enquiry || '',
      status: 'new',
      source: `form:${formKey}`,
      createdAt: nowISO()
    };
    db.leads.push(lead);
    submission.convertedLeadId = lead.id;

    notify(db, {
      event: formKey === 'apply' ? 'new_application' : 'new_lead',
      title: formKey === 'apply' ? 'New Application' : 'New Lead',
      body: `${name || email || 'Someone'}${lead.track ? ' — ' + lead.track : ''}${phone ? ' · ' + phone : ''}`,
      link: '#leads',
      audience: {},
      meta: { leadId: lead.id }
    });
  }

  if (formKey === 'webinar') {
    const reg = {
      id: newId('reg'), name, email, phone,
      track: f.track || '', guests: Number(f.guests) || 0,
      registeredAt: nowISO()
    };
    db.webinarRegistrations.push(reg);
    notify(db, {
      event: 'webinar_registration',
      title: 'New Webinar Registration',
      body: `${name || email} registered${reg.guests ? ` with ${reg.guests} guest(s)` : ''}.`,
      link: '#webinar',
      audience: {},
      meta: { registrationId: reg.id }
    });
  }

  if (formKey === 'query') {
    const query = {
      id: newId('qry'),
      ticketNo: `QRY-${String(db.queries.length + 1).padStart(5, '0')}`,
      name, email, phone,
      raisedByType: f.role || 'visitor',
      raisedById: f.userId || null,
      category: f.category || 'general',
      subject: f.subject || 'Website query',
      message: f.message || '',
      priority: 'normal',
      status: 'open',
      channel: 'website',
      assignedTo: null,
      thread: [],
      createdAt: nowISO(),
      resolvedAt: null
    };
    db.queries.push(query);
    submission.convertedQueryId = query.id;
    notify(db, {
      event: 'new_query',
      title: 'New Query',
      body: `${query.ticketNo} — ${query.subject}`,
      link: `#queries/${query.id}`,
      audience: {},
      meta: { queryId: query.id }
    });
  }

  if (formKey === 'dispute') {
    const dispute = {
      id: newId('dsp'),
      caseNo: `DSP-${String(db.disputes.length + 1).padStart(5, '0')}`,
      type: f.type || 'other',
      raisedByType: f.role || 'student',
      raisedById: f.userId || null,
      raisedByName: name,
      againstType: null, againstId: null,
      subject: f.subject || 'Website dispute',
      description: f.description || f.message || '',
      amount: Number(f.amount) || 0,
      severity: 'medium',
      status: 'open',
      assignedTo: null,
      resolution: '', thread: [], evidence: [],
      createdAt: nowISO(), resolvedAt: null
    };
    db.disputes.push(dispute);
    submission.convertedDisputeId = dispute.id;
    notify(db, {
      event: 'new_dispute',
      title: 'New Dispute',
      body: `${dispute.caseNo} — ${dispute.subject}`,
      link: `#disputes/${dispute.id}`,
      audience: {},
      meta: { disputeId: dispute.id }
    });
  }
}

module.exports = router;
