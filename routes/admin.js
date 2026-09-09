const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { readDB, writeDB, newId } = require('../lib/db');
const { requireAuth, requirePerm, attachCourseScope, assertCourseAccess } = require('../middleware/auth');
const { logAudit } = require('../lib/audit');
const { notify } = require('../lib/notify');
const { computeProfile } = require('./finance');
const { attendancePercent } = require('./academics');

router.use(requireAuth('staff'), attachCourseScope);

const nowISO = () => new Date().toISOString();
const stripPasswords = list => list.map(({ passwordHash, ...rest }) => rest);
const courseName = (db, id) => (db.courses.find(c => c.id === id) || {}).name || '—';

/**
 * Sent whenever someone joins the platform in any capacity. This is the
 * "push notification for everyone when they enrol" — the new joiner gets a
 * welcome, and the staff roles responsible for that kind of joiner get an
 * alert, both in the bell and as a real OS-level push if they've allowed it.
 */
function announceEnrollment(db, { role, person, extra }) {
  const label = { student: 'Student', mentor: 'Mentor', employer: 'Employer' }[role] || 'Member';

  notify(db, {
    event: 'welcome',
    title: `Welcome to ${db.settings.general.companyName}`,
    body: `Your ${label.toLowerCase()} account is active. ${extra || ''}`.trim(),
    audience: { userIds: [person.id] },
    respectSettings: false
  });

  notify(db, {
    event: 'enrollment',
    title: `New ${label} Enrolled`,
    body: `${person.name} (${person.email}) joined as a ${label.toLowerCase()}.${extra ? ' ' + extra : ''}`,
    link: `#${role}s/${person.id}`,
    audience: {},
    meta: { role, id: person.id }
  });
}

/* ==========================================================================
   OVERVIEW
   ========================================================================== */

router.get('/overview', requirePerm('overview.read'), (req, res) => {
  const db = readDB();

  const pendingCorrections = db.mentors.reduce(
    (sum, m) => sum + (m.correctionRequests || []).filter(c => c.status === 'pending').length, 0);
  const totalHiringRequests = db.employers.reduce((sum, e) => sum + (e.hiringRequests || []).length, 0);

  const profiles = db.feeProfiles.map(p => computeProfile(db, p));
  const outstanding = profiles.reduce((s, p) => s + p.amountPending, 0);

  const today = new Date().toISOString().slice(0, 10);
  const classesToday = db.classSessions.filter(c =>
    String(c.startsAt).startsWith(today) && c.status !== 'cancelled').length;

  res.json({
    leads: db.leads.length,
    newLeads: db.leads.filter(l => l.status === 'new').length,
    webinarRegistrations: db.webinarRegistrations.length,
    students: db.students.length,
    activeStudents: db.students.filter(s => s.status === 'active').length,
    mentors: db.mentors.length,
    employers: db.employers.length,
    courses: db.courses.length,
    batches: db.batches.length,
    ongoingBatches: db.batches.filter(b => b.status === 'ongoing').length,
    classesToday,
    pendingCorrections,
    totalHiringRequests,
    outstandingFees: Math.round(outstanding),
    openQueries: db.queries.filter(q => ['open', 'in_progress', 'waiting'].includes(q.status)).length,
    openDisputes: db.disputes.filter(d => !['resolved', 'rejected'].includes(d.status)).length,
    newForms: db.formSubmissions.filter(f => f.status === 'new').length,
    pendingDocuments: db.documents.filter(d => d.status === 'pending').length,
    placedStudents: db.students.filter(s => s.placementStatus === 'placed').length
  });
});

/* ==========================================================================
   SITE CONTENT
   ========================================================================== */

router.get('/content', requirePerm('content.read', 'webinar.read'), (req, res) => res.json(readDB().content));

router.put('/content', requirePerm('content.write'), (req, res) => {
  const db = readDB();
  const before = { ...db.content };
  db.content = { ...db.content, ...req.body };
  logAudit(db, req, { action: 'update', entity: 'site_content', entityId: 'content', label: 'Homepage content', before, after: db.content });
  writeDB(db);
  res.json({ ok: true, content: db.content });
});

/* ==========================================================================
   LEADS
   ========================================================================== */

router.get('/leads', requirePerm('leads.read'), (req, res) => res.json(readDB().leads));

router.delete('/leads/:id', requirePerm('leads.write'), (req, res) => {
  const db = readDB();
  const lead = db.leads.find(l => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found.' });
  db.leads = db.leads.filter(l => l.id !== req.params.id);
  logAudit(db, req, { action: 'delete', entity: 'lead', entityId: lead.id, label: lead.name, before: lead });
  writeDB(db);
  res.json({ ok: true });
});

router.put('/leads/:id', requirePerm('leads.write'), (req, res) => {
  const db = readDB();
  const lead = db.leads.find(l => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found.' });
  const before = { ...lead };
  Object.assign(lead, req.body, { id: lead.id });
  logAudit(db, req, { action: 'update', entity: 'lead', entityId: lead.id, label: lead.name, before, after: lead });
  writeDB(db);
  res.json({ ok: true, lead });
});

/* ==========================================================================
   WEBINAR
   ========================================================================== */

router.get('/webinar-registrations', requirePerm('webinar.read'), (req, res) => res.json(readDB().webinarRegistrations));

router.delete('/webinar-registrations/:id', requirePerm('webinar.write'), (req, res) => {
  const db = readDB();
  db.webinarRegistrations = db.webinarRegistrations.filter(r => r.id !== req.params.id);
  logAudit(db, req, { action: 'delete', entity: 'webinar_registration', entityId: req.params.id });
  writeDB(db);
  res.json({ ok: true });
});

router.put('/webinar-config', requirePerm('webinar.write'), (req, res) => {
  const db = readDB();
  const before = { ...db.content.webinar };
  db.content.webinar = { ...db.content.webinar, ...req.body };
  logAudit(db, req, { action: 'update', entity: 'webinar', entityId: 'webinar', label: db.content.webinar.title, before, after: db.content.webinar });
  writeDB(db);
  res.json({ ok: true, webinar: db.content.webinar });
});

/* ==========================================================================
   STUDENTS
   ========================================================================== */

router.get('/students', requirePerm('students.read'), (req, res) => {
  const db = readDB();
  const visible = db.students.filter(s =>
    req.scope.all || (s.courseIds || []).some(c => req.scope.allows(c))
  );
  res.json(stripPasswords(visible).map(s => ({
    ...s,
    courseNames: (s.courseIds || []).map(id => courseName(db, id)),
    batchName: (db.batches.find(b => b.id === s.batchId) || {}).name || null,
    attendancePercent: attendancePercent(db, s.id)
  })));
});

/**
 * The full student record in one call — everything the Student tree in the
 * brief asks for. One request instead of eleven keeps the profile drawer
 * snappy and means the tabs can never show data from different moments.
 */
router.get('/students/:id/profile', requirePerm('students.read'), (req, res) => {
  const db = readDB();
  const student = db.students.find(s => s.id === req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found.' });
  if (!req.scope.all && !(student.courseIds || []).some(c => req.scope.allows(c))) {
    return res.status(403).json({ error: "This student is not on a course you're assigned to." });
  }

  const { passwordHash, ...safe } = student;
  const batch = db.batches.find(b => b.id === student.batchId) || null;
  const attendanceRows = db.attendance.filter(a => a.studentId === student.id);
  const submissions = db.submissions.filter(s => s.studentId === student.id);
  const applications = db.applications.filter(a => a.studentId === student.id);

  res.json({
    personal: {
      ...safe,
      courseNames: (student.courseIds || []).map(id => courseName(db, id))
    },
    courses: (student.courseIds || []).map(id => db.courses.find(c => c.id === id)).filter(Boolean),
    batch: batch ? {
      ...batch,
      courseName: courseName(db, batch.courseId),
      trainerName: (db.adminUsers.find(a => a.id === batch.trainerId) || {}).name || null,
      mentorNames: (batch.mentorIds || []).map(id => (db.mentors.find(m => m.id === id) || {}).name).filter(Boolean)
    } : null,
    attendance: {
      percent: attendancePercent(db, student.id),
      present: attendanceRows.filter(a => a.status === 'present').length,
      absent: attendanceRows.filter(a => a.status === 'absent').length,
      late: attendanceRows.filter(a => a.status === 'late').length,
      total: attendanceRows.length,
      rows: attendanceRows.slice(-40).reverse().map(a => ({
        ...a,
        topic: (db.classSessions.find(c => c.id === a.sessionId) || {}).topic || '—',
        date: (db.classSessions.find(c => c.id === a.sessionId) || {}).startsAt || null
      }))
    },
    fees: db.feeProfiles.filter(p => p.studentId === student.id).map(p => computeProfile(db, p)),
    assignments: submissions.map(s => ({
      ...s,
      assignmentTitle: (db.assignments.find(a => a.id === s.assignmentId) || {}).title || '—',
      maxMarks: (db.assignments.find(a => a.id === s.assignmentId) || {}).maxMarks || null
    })),
    projects: db.projects.filter(p => p.studentId === student.id),
    assessments: db.assessmentResults.filter(r => r.studentId === student.id).map(r => ({
      ...r,
      assessmentTitle: (db.assessments.find(a => a.id === r.assessmentId) || {}).title || '—'
    })),
    certificates: db.certificates.filter(c => c.studentId === student.id),
    placement: {
      status: student.placementStatus,
      placedCompany: student.placedCompany || null,
      placedCtc: student.placedCtc || null,
      applications: applications.map(a => {
        const job = db.jobs.find(j => j.id === a.jobId) || {};
        return {
          ...a, jobTitle: job.title || '—',
          companyName: (db.companies.find(c => c.id === job.companyId) || {}).name || '—'
        };
      }),
      interviews: db.interviews.filter(i => i.studentId === student.id),
      offers: db.offers.filter(o => o.studentId === student.id)
    },
    documents: db.documents
      .filter(d => d.ownerId === student.id)
      .map(({ storedName, numberHash, ...rest }) => rest),
    communication: db.communications.filter(c => c.studentId === student.id).slice().reverse(),
    queries: db.queries.filter(q => q.raisedById === student.id),
    disputes: db.disputes.filter(d => d.raisedById === student.id)
  });
});

router.post('/students', requirePerm('students.write'), (req, res) => {
  const db = readDB();
  const { name, email, password, courseIds, track, batchId, personal } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required.' });
  }
  if (db.students.some(s => s.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: 'A student with that email already exists.' });
  }

  const ids = Array.isArray(courseIds) ? courseIds : [];
  for (const id of ids) {
    if (!assertCourseAccess(req, res, id, 'course')) return;
  }

  const student = {
    id: newId('stu'), name, email,
    passwordHash: bcrypt.hashSync(password, 10),
    courseIds: ids,
    track: track || (ids.length ? courseName(db, ids[0]) : ''),
    batchId: batchId || null,
    personal: Object.assign({
      phone: '', dob: '', gender: '', city: '', state: '', pincode: '', address: '',
      guardianName: '', guardianPhone: '', qualification: '', college: ''
    }, personal || {}),
    status: 'active',
    placementStatus: 'not_ready',
    weekProgress: 0, totalWeeks: 20, xp: 0, xpTarget: 3000, streakDays: 0,
    badges: [], courseCompletionDate: null, lectures: [], nextSession: null,
    enrolledAt: nowISO()
  };
  db.students.push(student);

  // Auto-create the fee profile so nobody is enrolled without a money record.
  if (ids.length) {
    const course = db.courses.find(c => c.id === ids[0]);
    if (course) {
      db.feeProfiles.push({
        id: newId('fee'), studentId: student.id, courseId: course.id,
        courseFee: Number(course.fee) || 0, discount: 0, scholarship: 0,
        discountReason: '', installments: [], createdAt: nowISO(), createdBy: req.user.id
      });
    }
  }

  announceEnrollment(db, {
    role: 'student', person: student,
    extra: ids.length ? `Course: ${courseName(db, ids[0])}.` : ''
  });

  logAudit(db, req, { action: 'create', entity: 'student', entityId: student.id, label: name, after: stripPasswords([student])[0] });
  writeDB(db);
  res.status(201).json({ ok: true, student: stripPasswords([student])[0] });
});

router.put('/students/:id', requirePerm('students.write'), (req, res) => {
  const db = readDB();
  const student = db.students.find(s => s.id === req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found.' });
  if (!req.scope.all && !(student.courseIds || []).some(c => req.scope.allows(c))) {
    return res.status(403).json({ error: "This student is not on a course you're assigned to." });
  }

  const before = stripPasswords([{ ...student }])[0];
  const updates = { ...req.body };
  if (updates.password) {
    updates.passwordHash = bcrypt.hashSync(updates.password, 10);
    delete updates.password;
  }
  if (updates.personal) updates.personal = { ...student.personal, ...updates.personal };

  const placedNow = updates.placementStatus === 'placed' && student.placementStatus !== 'placed';
  Object.assign(student, updates, { id: student.id });

  if (placedNow) {
    notify(db, {
      event: 'student_placement',
      title: 'Student Placed',
      body: `${student.name} has been marked as placed${student.placedCompany ? ' at ' + student.placedCompany : ''}.`,
      audience: { userIds: [student.id] },
      meta: { studentId: student.id }
    });
  }

  logAudit(db, req, { action: 'update', entity: 'student', entityId: student.id, label: student.name, before, after: stripPasswords([student])[0] });
  writeDB(db);
  res.json({ ok: true, student: stripPasswords([student])[0] });
});

router.delete('/students/:id', requirePerm('students.write'), (req, res) => {
  const db = readDB();
  const student = db.students.find(s => s.id === req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found.' });
  if (db.payments.some(p => p.studentId === student.id && p.status === 'success')) {
    return res.status(409).json({
      error: 'This student has recorded payments. Set their status to "dropped" instead — deleting would break the financial record.'
    });
  }
  db.students = db.students.filter(s => s.id !== student.id);
  logAudit(db, req, { action: 'delete', entity: 'student', entityId: student.id, label: student.name, before: stripPasswords([student])[0] });
  writeDB(db);
  res.json({ ok: true });
});

/** Communication log — calls, emails, WhatsApp, meetings, notes. */
router.post('/students/:id/communication', requirePerm('students.write'), (req, res) => {
  const db = readDB();
  const student = db.students.find(s => s.id === req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found.' });

  const entry = {
    id: newId('com'), studentId: student.id,
    channel: req.body.channel || 'note',     // call | email | whatsapp | sms | meeting | note
    direction: req.body.direction || 'outbound',
    subject: req.body.subject || '',
    summary: req.body.summary || '',
    outcome: req.body.outcome || '',
    followUpAt: req.body.followUpAt || null,
    by: req.user.id, byName: req.user.name, at: nowISO()
  };
  db.communications.push(entry);
  logAudit(db, req, { action: 'log_communication', entity: 'student', entityId: student.id, label: student.name, meta: { channel: entry.channel } });
  writeDB(db);
  res.status(201).json({ ok: true, entry });
});

/* ==========================================================================
   MENTORS
   ========================================================================== */

router.get('/mentors', requirePerm('mentors.read'), (req, res) => {
  const db = readDB();
  const visible = db.mentors.filter(m =>
    req.scope.all || (m.courseIds || []).some(c => req.scope.allows(c))
  );
  res.json(stripPasswords(visible).map(m => ({
    ...m,
    courseNames: (m.courseIds || []).map(id => courseName(db, id)),
    batchCount: db.batches.filter(b => (b.mentorIds || []).includes(m.id)).length
  })));
});

router.post('/mentors', requirePerm('mentors.write'), (req, res) => {
  const db = readDB();
  const { name, email, password, courseIds, ratePerSession, phone } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required.' });
  }
  if (!Array.isArray(courseIds) || !courseIds.length) {
    return res.status(400).json({ error: 'Assign at least one course — a mentor with no course can access nothing.' });
  }
  if (db.mentors.some(m => m.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: 'A mentor with that email already exists.' });
  }
  for (const id of courseIds) {
    if (!db.courses.some(c => c.id === id)) return res.status(400).json({ error: 'Unknown course in the list.' });
    if (!assertCourseAccess(req, res, id, 'course')) return;
  }

  const mentor = {
    id: newId('men'), name, email, phone: phone || '',
    passwordHash: bcrypt.hashSync(password, 10),
    courseIds,
    track: courseName(db, courseIds[0]),
    ratePerSession: Number(ratePerSession) || 2000,
    sessionsCompleted: 0, sessionsPaid: 0, sessionsPending: 0,
    correctionRequests: [],
    status: 'active',
    enrolledAt: nowISO()
  };
  db.mentors.push(mentor);

  announceEnrollment(db, {
    role: 'mentor', person: mentor,
    extra: `Approved for: ${courseIds.map(id => courseName(db, id)).join(', ')}.`
  });

  logAudit(db, req, { action: 'create', entity: 'mentor', entityId: mentor.id, label: name, after: stripPasswords([mentor])[0] });
  writeDB(db);
  res.status(201).json({ ok: true, mentor: stripPasswords([mentor])[0] });
});

router.put('/mentors/:id', requirePerm('mentors.write'), (req, res) => {
  const db = readDB();
  const mentor = db.mentors.find(m => m.id === req.params.id);
  if (!mentor) return res.status(404).json({ error: 'Mentor not found.' });

  const before = stripPasswords([{ ...mentor }])[0];
  const updates = { ...req.body };
  if (updates.password) {
    updates.passwordHash = bcrypt.hashSync(updates.password, 10);
    delete updates.password;
  }

  // Removing a course a mentor is actively teaching would leave a batch with
  // a mentor who can no longer open it — block that rather than half-apply it.
  if (Array.isArray(updates.courseIds)) {
    const removed = (mentor.courseIds || []).filter(id => !updates.courseIds.includes(id));
    const stranded = db.batches.filter(b =>
      (b.mentorIds || []).includes(mentor.id) &&
      removed.includes(b.courseId) &&
      b.status !== 'completed' && b.status !== 'cancelled'
    );
    if (stranded.length) {
      return res.status(409).json({
        error: `${mentor.name} is still assigned to ${stranded.map(b => b.name).join(', ')} on that course. Remove them from the batch first.`
      });
    }
    if (updates.courseIds.length) updates.track = courseName(db, updates.courseIds[0]);
  }

  Object.assign(mentor, updates, { id: mentor.id });
  logAudit(db, req, { action: 'update', entity: 'mentor', entityId: mentor.id, label: mentor.name, before, after: stripPasswords([mentor])[0] });
  writeDB(db);
  res.json({ ok: true, mentor: stripPasswords([mentor])[0] });
});

router.delete('/mentors/:id', requirePerm('mentors.write'), (req, res) => {
  const db = readDB();
  const mentor = db.mentors.find(m => m.id === req.params.id);
  if (!mentor) return res.status(404).json({ error: 'Mentor not found.' });
  db.mentors = db.mentors.filter(m => m.id !== mentor.id);
  db.batches.forEach(b => { b.mentorIds = (b.mentorIds || []).filter(id => id !== mentor.id); });
  logAudit(db, req, { action: 'delete', entity: 'mentor', entityId: mentor.id, label: mentor.name, before: stripPasswords([mentor])[0] });
  writeDB(db);
  res.json({ ok: true });
});

router.put('/mentors/:id/corrections/:reqId', requirePerm('mentors.write'), (req, res) => {
  const db = readDB();
  const mentor = db.mentors.find(m => m.id === req.params.id);
  if (!mentor) return res.status(404).json({ error: 'Mentor not found.' });
  const request = (mentor.correctionRequests || []).find(c => c.id === req.params.reqId);
  if (!request) return res.status(404).json({ error: 'Correction request not found.' });

  const before = { status: request.status };
  request.status = req.body.status || 'resolved';
  request.adminNote = req.body.adminNote || '';
  request.resolvedBy = req.user.id;
  request.resolvedAt = nowISO();

  notify(db, {
    event: 'announcement',
    title: 'Correction Request Updated',
    body: `Your correction request is now "${request.status}".${request.adminNote ? ' ' + request.adminNote : ''}`,
    audience: { userIds: [mentor.id] },
    respectSettings: false
  });

  logAudit(db, req, { action: 'resolve_correction', entity: 'mentor', entityId: mentor.id, label: mentor.name, before, after: { status: request.status } });
  writeDB(db);
  res.json({ ok: true, request });
});

/* ==========================================================================
   EMPLOYERS
   ========================================================================== */

router.get('/employers', requirePerm('employers.read'), (req, res) => res.json(stripPasswords(readDB().employers)));

router.post('/employers', requirePerm('employers.write'), (req, res) => {
  const db = readDB();
  const { name, email, password, company, phone } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
  if (db.employers.some(e => e.email.toLowerCase() === email.toLowerCase())) {
    return res.status(409).json({ error: 'An employer with that email already exists.' });
  }

  const employer = {
    id: newId('emp'), name, email, phone: phone || '',
    passwordHash: bcrypt.hashSync(password, 10),
    company: company || '', hiringRequests: [],
    status: 'active', enrolledAt: nowISO()
  };
  db.employers.push(employer);

  announceEnrollment(db, {
    role: 'employer', person: employer,
    extra: company ? `Company: ${company}.` : ''
  });

  logAudit(db, req, { action: 'create', entity: 'employer', entityId: employer.id, label: name, after: stripPasswords([employer])[0] });
  writeDB(db);
  res.status(201).json({ ok: true, employer: stripPasswords([employer])[0] });
});

router.put('/employers/:id', requirePerm('employers.write'), (req, res) => {
  const db = readDB();
  const employer = db.employers.find(e => e.id === req.params.id);
  if (!employer) return res.status(404).json({ error: 'Employer not found.' });
  const before = stripPasswords([{ ...employer }])[0];
  const updates = { ...req.body };
  if (updates.password) {
    updates.passwordHash = bcrypt.hashSync(updates.password, 10);
    delete updates.password;
  }
  Object.assign(employer, updates, { id: employer.id });
  logAudit(db, req, { action: 'update', entity: 'employer', entityId: employer.id, label: employer.name, before, after: stripPasswords([employer])[0] });
  writeDB(db);
  res.json({ ok: true, employer: stripPasswords([employer])[0] });
});

router.delete('/employers/:id', requirePerm('employers.write'), (req, res) => {
  const db = readDB();
  const employer = db.employers.find(e => e.id === req.params.id);
  if (!employer) return res.status(404).json({ error: 'Employer not found.' });
  db.employers = db.employers.filter(e => e.id !== employer.id);
  logAudit(db, req, { action: 'delete', entity: 'employer', entityId: employer.id, label: employer.name, before: stripPasswords([employer])[0] });
  writeDB(db);
  res.json({ ok: true });
});

/* ==========================================================================
   CANDIDATE POOL + ACCOUNT
   ========================================================================== */

router.get('/candidate-pool', requirePerm('placement.read', 'employers.read'), (req, res) => res.json(readDB().candidatePool));

router.put('/candidate-pool', requirePerm('placement.write', 'employers.write'), (req, res) => {
  const db = readDB();
  const before = { ...db.candidatePool };
  db.candidatePool = { ...db.candidatePool, ...req.body };
  logAudit(db, req, { action: 'update', entity: 'candidate_pool', entityId: 'pool', before, after: db.candidatePool });
  writeDB(db);
  res.json({ ok: true, candidatePool: db.candidatePool });
});

router.put('/change-password', (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password are required.' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Use at least 8 characters.' });

  const db = readDB();
  const admin = db.adminUsers.find(a => a.id === req.user.id || a.email === req.user.email);
  if (!admin || !bcrypt.compareSync(currentPassword, admin.passwordHash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  admin.passwordHash = bcrypt.hashSync(newPassword, 10);
  logAudit(db, req, { action: 'change_password', entity: 'staff', entityId: admin.id, label: admin.name });
  writeDB(db);
  res.json({ ok: true });
});

module.exports = router;
