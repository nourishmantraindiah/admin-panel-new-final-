const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { readDB, writeDB, newId } = require('../lib/db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth('admin'));

function stripPasswords(list) {
  return list.map(({ passwordHash, ...rest }) => rest);
}

// ---------- Overview ----------
router.get('/overview', (req, res) => {
  const db = readDB();
  const pendingCorrections = db.mentors.reduce(
    (sum, m) => sum + m.correctionRequests.filter(c => c.status === 'pending').length, 0
  );
  const totalHiringRequests = db.employers.reduce((sum, e) => sum + e.hiringRequests.length, 0);
  res.json({
    leads: db.leads.length,
    webinarRegistrations: db.webinarRegistrations.length,
    students: db.students.length,
    mentors: db.mentors.length,
    employers: db.employers.length,
    pendingCorrections,
    totalHiringRequests
  });
});

// ---------- Site content ----------
router.get('/content', (req, res) => res.json(readDB().content));

router.put('/content', (req, res) => {
  const db = readDB();
  db.content = { ...db.content, ...req.body };
  writeDB(db);
  res.json({ ok: true, content: db.content });
});

// ---------- Leads ----------
router.get('/leads', (req, res) => res.json(readDB().leads));

router.delete('/leads/:id', (req, res) => {
  const db = readDB();
  db.leads = db.leads.filter(l => l.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

router.put('/leads/:id', (req, res) => {
  const db = readDB();
  const lead = db.leads.find(l => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found.' });
  Object.assign(lead, req.body);
  writeDB(db);
  res.json({ ok: true, lead });
});

// ---------- Webinar ----------
router.get('/webinar-registrations', (req, res) => res.json(readDB().webinarRegistrations));

router.delete('/webinar-registrations/:id', (req, res) => {
  const db = readDB();
  db.webinarRegistrations = db.webinarRegistrations.filter(r => r.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

router.put('/webinar-config', (req, res) => {
  const db = readDB();
  db.content.webinar = { ...db.content.webinar, ...req.body };
  writeDB(db);
  res.json({ ok: true, webinar: db.content.webinar });
});

// ---------- Students ----------
router.get('/students', (req, res) => res.json(stripPasswords(readDB().students)));

router.post('/students', (req, res) => {
  const db = readDB();
  const { name, email, password, track } = req.body;
  if (!name || !email || !password || !track) return res.status(400).json({ error: 'Name, email, password and track are required.' });
  const student = {
    id: newId('stu'), name, email, passwordHash: bcrypt.hashSync(password, 10),
    track, weekProgress: 0, totalWeeks: 20, xp: 0, xpTarget: 3000, streakDays: 0,
    badges: [], courseCompletionDate: null, lectures: [], nextSession: null
  };
  db.students.push(student);
  writeDB(db);
  const { passwordHash, ...safe } = student;
  res.status(201).json({ ok: true, student: safe });
});

router.put('/students/:id', (req, res) => {
  const db = readDB();
  const student = db.students.find(s => s.id === req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found.' });
  const updates = { ...req.body };
  if (updates.password) {
    updates.passwordHash = bcrypt.hashSync(updates.password, 10);
    delete updates.password;
  }
  Object.assign(student, updates);
  writeDB(db);
  const { passwordHash, ...safe } = student;
  res.json({ ok: true, student: safe });
});

router.delete('/students/:id', (req, res) => {
  const db = readDB();
  db.students = db.students.filter(s => s.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

// ---------- Mentors ----------
router.get('/mentors', (req, res) => res.json(stripPasswords(readDB().mentors)));

router.post('/mentors', (req, res) => {
  const db = readDB();
  const { name, email, password, track, ratePerSession } = req.body;
  if (!name || !email || !password || !track) return res.status(400).json({ error: 'Name, email, password and track are required.' });
  const mentor = {
    id: newId('men'), name, email, passwordHash: bcrypt.hashSync(password, 10),
    track, ratePerSession: ratePerSession || 2000, sessionsCompleted: 0, sessionsPaid: 0,
    sessionsPending: 0, correctionRequests: []
  };
  db.mentors.push(mentor);
  writeDB(db);
  const { passwordHash, ...safe } = mentor;
  res.status(201).json({ ok: true, mentor: safe });
});

router.put('/mentors/:id', (req, res) => {
  const db = readDB();
  const mentor = db.mentors.find(m => m.id === req.params.id);
  if (!mentor) return res.status(404).json({ error: 'Mentor not found.' });
  const updates = { ...req.body };
  if (updates.password) {
    updates.passwordHash = bcrypt.hashSync(updates.password, 10);
    delete updates.password;
  }
  Object.assign(mentor, updates);
  writeDB(db);
  const { passwordHash, ...safe } = mentor;
  res.json({ ok: true, mentor: safe });
});

router.delete('/mentors/:id', (req, res) => {
  const db = readDB();
  db.mentors = db.mentors.filter(m => m.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

router.put('/mentors/:id/corrections/:reqId', (req, res) => {
  const db = readDB();
  const mentor = db.mentors.find(m => m.id === req.params.id);
  if (!mentor) return res.status(404).json({ error: 'Mentor not found.' });
  const request = mentor.correctionRequests.find(c => c.id === req.params.reqId);
  if (!request) return res.status(404).json({ error: 'Correction request not found.' });
  request.status = req.body.status || 'resolved';
  request.adminNote = req.body.adminNote || '';
  writeDB(db);
  res.json({ ok: true, request });
});

// ---------- Employers ----------
router.get('/employers', (req, res) => res.json(stripPasswords(readDB().employers)));

router.post('/employers', (req, res) => {
  const db = readDB();
  const { name, email, password, company } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
  const employer = {
    id: newId('emp'), name, email, passwordHash: bcrypt.hashSync(password, 10),
    company: company || '', hiringRequests: []
  };
  db.employers.push(employer);
  writeDB(db);
  const { passwordHash, ...safe } = employer;
  res.status(201).json({ ok: true, employer: safe });
});

router.put('/employers/:id', (req, res) => {
  const db = readDB();
  const employer = db.employers.find(e => e.id === req.params.id);
  if (!employer) return res.status(404).json({ error: 'Employer not found.' });
  const updates = { ...req.body };
  if (updates.password) {
    updates.passwordHash = bcrypt.hashSync(updates.password, 10);
    delete updates.password;
  }
  Object.assign(employer, updates);
  writeDB(db);
  const { passwordHash, ...safe } = employer;
  res.json({ ok: true, employer: safe });
});

router.delete('/employers/:id', (req, res) => {
  const db = readDB();
  db.employers = db.employers.filter(e => e.id !== req.params.id);
  writeDB(db);
  res.json({ ok: true });
});

// ---------- Candidate pool (used to match employer hiring requests) ----------
router.get('/candidate-pool', (req, res) => res.json(readDB().candidatePool));

router.put('/candidate-pool', (req, res) => {
  const db = readDB();
  db.candidatePool = { ...db.candidatePool, ...req.body };
  writeDB(db);
  res.json({ ok: true, candidatePool: db.candidatePool });
});

// ---------- Admin account ----------
router.put('/change-password', (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password are required.' });

  const db = readDB();
  const admin = db.adminUsers.find(a => a.email === req.user.email);
  if (!admin || !bcrypt.compareSync(currentPassword, admin.passwordHash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  admin.passwordHash = bcrypt.hashSync(newPassword, 10);
  writeDB(db);
  res.json({ ok: true });
});

module.exports = router;
