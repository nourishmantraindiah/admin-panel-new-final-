const express = require('express');
const router = express.Router();
const { readDB, writeDB, newId } = require('../lib/db');
const { requireAuth, requirePerm, attachCourseScope } = require('../middleware/auth');
const { logAudit } = require('../lib/audit');
const { notify } = require('../lib/notify');

router.use(requireAuth('staff'), attachCourseScope, requirePerm('placement.read'));

const nowISO = () => new Date().toISOString();

/* ---------------------------------------------------------------- Companies */

router.get('/companies', (req, res) => {
  const db = readDB();
  res.json(db.companies.map(c => ({
    ...c,
    openJobs: db.jobs.filter(j => j.companyId === c.id && j.status === 'open').length,
    hires: db.offers.filter(o => o.companyId === c.id && o.status === 'accepted').length
  })));
});

router.post('/companies', requirePerm('placement.write'), (req, res) => {
  const db = readDB();
  const { name, industry, website, hrName, hrEmail, hrPhone, city, tier, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Company name is required.' });

  const company = {
    id: newId('cmp'), name, industry: industry || '', website: website || '',
    hrName: hrName || '', hrEmail: hrEmail || '', hrPhone: hrPhone || '',
    city: city || '', tier: tier || 'standard',   // standard | preferred | strategic
    status: 'active', notes: notes || '', createdAt: nowISO()
  };
  db.companies.push(company);
  logAudit(db, req, { action: 'create', entity: 'company', entityId: company.id, label: name, after: company });
  writeDB(db);
  res.status(201).json({ ok: true, company });
});

router.put('/companies/:id', requirePerm('placement.write'), (req, res) => {
  const db = readDB();
  const c = db.companies.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Company not found.' });
  const before = { ...c };
  Object.assign(c, req.body, { id: c.id });
  logAudit(db, req, { action: 'update', entity: 'company', entityId: c.id, label: c.name, before, after: c });
  writeDB(db);
  res.json({ ok: true, company: c });
});

router.delete('/companies/:id', requirePerm('placement.write'), (req, res) => {
  const db = readDB();
  const c = db.companies.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: 'Company not found.' });
  if (db.jobs.some(j => j.companyId === c.id)) {
    return res.status(409).json({ error: 'This company has jobs attached. Mark it inactive instead.' });
  }
  db.companies = db.companies.filter(x => x.id !== c.id);
  logAudit(db, req, { action: 'delete', entity: 'company', entityId: c.id, label: c.name, before: c });
  writeDB(db);
  res.json({ ok: true });
});

/* -------------------------------------------------------------------- Jobs */

router.get('/jobs', (req, res) => {
  const db = readDB();
  res.json(db.jobs.map(j => ({
    ...j,
    companyName: (db.companies.find(c => c.id === j.companyId) || {}).name || '—',
    applicationCount: db.applications.filter(a => a.jobId === j.id).length
  })));
});

router.post('/jobs', requirePerm('placement.write'), (req, res) => {
  const db = readDB();
  const { companyId, title, courseIds, openings, ctcMin, ctcMax, location, workMode, experience, description, lastDate } = req.body;
  if (!companyId || !title) return res.status(400).json({ error: 'Company and job title are required.' });

  const job = {
    id: newId('job'), companyId, title,
    courseIds: courseIds || [],
    openings: Number(openings) || 1,
    ctcMin: Number(ctcMin) || 0,
    ctcMax: Number(ctcMax) || 0,
    location: location || '', workMode: workMode || 'onsite',
    experience: experience || 'fresher',
    description: description || '',
    lastDate: lastDate || null,
    status: 'open',                   // open | closed | on_hold
    createdAt: nowISO()
  };
  db.jobs.push(job);

  // Placement-ready students on a matching course hear about it right away.
  const eligible = db.students.filter(s =>
    ['ready', 'applying', 'interviewing'].includes(s.placementStatus) &&
    (!job.courseIds.length || (s.courseIds || []).some(c => job.courseIds.includes(c)))
  );
  notify(db, {
    event: 'announcement',
    title: 'New Opening',
    body: `${title} at ${(db.companies.find(c => c.id === companyId) || {}).name || 'a partner company'} — ${job.openings} opening(s).`,
    link: '#placement',
    audience: { userIds: eligible.map(s => s.id) },
    respectSettings: false
  });

  logAudit(db, req, { action: 'create', entity: 'job', entityId: job.id, label: title, after: job });
  writeDB(db);
  res.status(201).json({ ok: true, job });
});

router.put('/jobs/:id', requirePerm('placement.write'), (req, res) => {
  const db = readDB();
  const j = db.jobs.find(x => x.id === req.params.id);
  if (!j) return res.status(404).json({ error: 'Job not found.' });
  const before = { ...j };
  Object.assign(j, req.body, { id: j.id });
  logAudit(db, req, { action: 'update', entity: 'job', entityId: j.id, label: j.title, before, after: j });
  writeDB(db);
  res.json({ ok: true, job: j });
});

router.delete('/jobs/:id', requirePerm('placement.write'), (req, res) => {
  const db = readDB();
  const j = db.jobs.find(x => x.id === req.params.id);
  if (!j) return res.status(404).json({ error: 'Job not found.' });
  db.jobs = db.jobs.filter(x => x.id !== j.id);
  db.applications = db.applications.filter(a => a.jobId !== j.id);
  logAudit(db, req, { action: 'delete', entity: 'job', entityId: j.id, label: j.title, before: j });
  writeDB(db);
  res.json({ ok: true });
});

/* ------------------------------------------------------------ Applications */

const APPLICATION_STAGES = ['applied', 'shortlisted', 'interviewing', 'offered', 'rejected', 'withdrawn', 'placed'];

router.get('/applications', (req, res) => {
  const db = readDB();
  let list = db.applications;
  if (req.query.jobId) list = list.filter(a => a.jobId === req.query.jobId);
  if (req.query.studentId) list = list.filter(a => a.studentId === req.query.studentId);
  res.json(list.map(a => {
    const job = db.jobs.find(j => j.id === a.jobId) || {};
    return {
      ...a,
      studentName: (db.students.find(s => s.id === a.studentId) || {}).name || '—',
      jobTitle: job.title || '—',
      companyName: (db.companies.find(c => c.id === job.companyId) || {}).name || '—'
    };
  }));
});

router.post('/applications', requirePerm('placement.write'), (req, res) => {
  const db = readDB();
  const { studentId, jobId, source, note } = req.body;
  const student = db.students.find(s => s.id === studentId);
  const job = db.jobs.find(j => j.id === jobId);
  if (!student || !job) return res.status(404).json({ error: 'Student or job not found.' });
  if (db.applications.some(a => a.studentId === studentId && a.jobId === jobId)) {
    return res.status(409).json({ error: `${student.name} has already applied to this role.` });
  }

  const application = {
    id: newId('app'), studentId, jobId, companyId: job.companyId,
    stage: 'applied', source: source || 'placement_cell',
    note: note || '', timeline: [{ stage: 'applied', at: nowISO(), by: req.user.id }],
    createdAt: nowISO()
  };
  db.applications.push(application);
  if (student.placementStatus === 'ready') student.placementStatus = 'applying';

  logAudit(db, req, { action: 'create', entity: 'application', entityId: application.id, label: `${student.name} → ${job.title}`, after: application });
  writeDB(db);
  res.status(201).json({ ok: true, application });
});

router.put('/applications/:id/stage', requirePerm('placement.write'), (req, res) => {
  const db = readDB();
  const app = db.applications.find(a => a.id === req.params.id);
  if (!app) return res.status(404).json({ error: 'Application not found.' });

  const { stage, note } = req.body;
  if (!APPLICATION_STAGES.includes(stage)) {
    return res.status(400).json({ error: `Stage must be one of: ${APPLICATION_STAGES.join(', ')}.` });
  }

  const before = { stage: app.stage };
  app.stage = stage;
  app.timeline.push({ stage, at: nowISO(), by: req.user.id, note: note || '' });

  const student = db.students.find(s => s.id === app.studentId);
  if (student) {
    if (stage === 'interviewing') student.placementStatus = 'interviewing';
    if (stage === 'placed') student.placementStatus = 'placed';
  }

  logAudit(db, req, { action: 'stage_change', entity: 'application', entityId: app.id, label: student ? student.name : '', before, after: { stage } });
  writeDB(db);
  res.json({ ok: true, application: app });
});

/* -------------------------------------------------------------- Interviews */

router.get('/interviews', (req, res) => {
  const db = readDB();
  res.json(db.interviews.map(i => ({
    ...i,
    studentName: (db.students.find(s => s.id === i.studentId) || {}).name || '—',
    companyName: (db.companies.find(c => c.id === i.companyId) || {}).name || '—'
  })).sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt))));
});

router.post('/interviews', requirePerm('placement.write'), (req, res) => {
  const db = readDB();
  const { applicationId, scheduledAt, round, mode, link, panel, notes } = req.body;
  const app = db.applications.find(a => a.id === applicationId);
  if (!app) return res.status(404).json({ error: 'Application not found.' });

  const interview = {
    id: newId('int'), applicationId, studentId: app.studentId, companyId: app.companyId,
    scheduledAt: scheduledAt || null,
    round: round || 1,
    mode: mode || 'online', link: link || '', panel: panel || '',
    status: 'scheduled',              // scheduled | completed | no_show | cancelled
    result: null,                     // passed | failed | on_hold
    feedback: '', notes: notes || '', createdAt: nowISO()
  };
  db.interviews.push(interview);

  notify(db, {
    event: 'announcement',
    title: 'Interview Scheduled',
    body: `Round ${interview.round} with ${(db.companies.find(c => c.id === app.companyId) || {}).name || 'the company'} on ${scheduledAt ? new Date(scheduledAt).toLocaleString('en-IN') : 'a date to be confirmed'}.`,
    audience: { userIds: [app.studentId] },
    respectSettings: false
  });

  logAudit(db, req, { action: 'create', entity: 'interview', entityId: interview.id, after: interview });
  writeDB(db);
  res.status(201).json({ ok: true, interview });
});

router.put('/interviews/:id', requirePerm('placement.write'), (req, res) => {
  const db = readDB();
  const i = db.interviews.find(x => x.id === req.params.id);
  if (!i) return res.status(404).json({ error: 'Interview not found.' });
  const before = { ...i };
  Object.assign(i, req.body, { id: i.id });
  logAudit(db, req, { action: 'update', entity: 'interview', entityId: i.id, before, after: i });
  writeDB(db);
  res.json({ ok: true, interview: i });
});

/* ------------------------------------------------------------------ Offers */

router.get('/offers', (req, res) => {
  const db = readDB();
  res.json(db.offers.map(o => ({
    ...o,
    studentName: (db.students.find(s => s.id === o.studentId) || {}).name || '—',
    companyName: (db.companies.find(c => c.id === o.companyId) || {}).name || '—'
  })));
});

router.post('/offers', requirePerm('placement.write'), (req, res) => {
  const db = readDB();
  const { applicationId, ctc, role, joiningDate, location, letterUrl } = req.body;
  const app = db.applications.find(a => a.id === applicationId);
  if (!app) return res.status(404).json({ error: 'Application not found.' });

  const offer = {
    id: newId('ofr'), applicationId, studentId: app.studentId, companyId: app.companyId,
    ctc: Number(ctc) || 0, role: role || '', joiningDate: joiningDate || null,
    location: location || '', letterUrl: letterUrl || '',
    status: 'offered',                // offered | accepted | declined | withdrawn
    offeredAt: nowISO()
  };
  db.offers.push(offer);
  app.stage = 'offered';
  app.timeline.push({ stage: 'offered', at: nowISO(), by: req.user.id });

  logAudit(db, req, { action: 'create', entity: 'offer', entityId: offer.id, label: `₹${offer.ctc}`, after: offer });
  writeDB(db);
  res.status(201).json({ ok: true, offer });
});

router.put('/offers/:id/status', requirePerm('placement.write'), (req, res) => {
  const db = readDB();
  const offer = db.offers.find(o => o.id === req.params.id);
  if (!offer) return res.status(404).json({ error: 'Offer not found.' });

  const before = { status: offer.status };
  offer.status = req.body.status;
  offer.statusUpdatedAt = nowISO();

  const student = db.students.find(s => s.id === offer.studentId);
  const company = db.companies.find(c => c.id === offer.companyId);

  if (offer.status === 'accepted') {
    if (student) {
      student.placementStatus = 'placed';
      student.placedAt = nowISO();
      student.placedCompany = company ? company.name : '';
      student.placedCtc = offer.ctc;
    }
    const app = db.applications.find(a => a.id === offer.applicationId);
    if (app) { app.stage = 'placed'; app.timeline.push({ stage: 'placed', at: nowISO(), by: req.user.id }); }

    notify(db, {
      event: 'student_placement',
      title: 'Student Placed',
      body: `${student ? student.name : 'A student'} accepted an offer from ${company ? company.name : 'a company'} at ₹${(offer.ctc / 100000).toFixed(1)} LPA.`,
      link: '#placement',
      audience: { userIds: student ? [student.id] : [] },
      meta: { offerId: offer.id }
    });
  }

  logAudit(db, req, { action: 'offer_status', entity: 'offer', entityId: offer.id, label: student ? student.name : '', before, after: { status: offer.status } });
  writeDB(db);
  res.json({ ok: true, offer });
});

/* --------------------------------------------------------------- Dashboard */

router.get('/dashboard', (req, res) => {
  const db = readDB();
  const students = db.students.filter(s => req.scope.all || (s.courseIds || []).some(c => req.scope.allows(c)));

  const accepted = db.offers.filter(o => o.status === 'accepted');
  const ctcs = accepted.map(o => Number(o.ctc) || 0).filter(Boolean);
  const avg = ctcs.length ? Math.round(ctcs.reduce((a, b) => a + b, 0) / ctcs.length) : 0;

  const byCompany = {};
  db.jobs.filter(j => j.status === 'open').forEach(j => {
    const name = (db.companies.find(c => c.id === j.companyId) || {}).name || '—';
    byCompany[name] = (byCompany[name] || 0) + (Number(j.openings) || 0);
  });

  res.json({
    placementReady: students.filter(s => s.placementStatus === 'ready').length,
    applying: students.filter(s => s.placementStatus === 'applying').length,
    interviewing: students.filter(s => s.placementStatus === 'interviewing').length,
    placed: students.filter(s => s.placementStatus === 'placed').length,
    notReady: students.filter(s => s.placementStatus === 'not_ready').length,
    totalApplications: db.applications.length,
    interviewsScheduled: db.interviews.filter(i => i.status === 'scheduled').length,
    offersOut: db.offers.filter(o => o.status === 'offered').length,
    offersAccepted: accepted.length,
    averageSalary: avg,
    highestSalary: ctcs.length ? Math.max(...ctcs) : 0,
    lowestSalary: ctcs.length ? Math.min(...ctcs) : 0,
    companiesHiring: Object.entries(byCompany).map(([name, openings]) => ({ name, openings }))
      .sort((a, b) => b.openings - a.openings),
    placementRate: students.length ? Math.round((students.filter(s => s.placementStatus === 'placed').length / students.length) * 100) : 0
  });
});

module.exports = router;
