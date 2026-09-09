const express = require('express');
const router = express.Router();
const { readDB, writeDB, newId } = require('../lib/db');
const { requireAuth, requirePerm, attachCourseScope, assertCourseAccess } = require('../middleware/auth');
const { logAudit } = require('../lib/audit');
const { notify } = require('../lib/notify');

router.use(requireAuth('staff'), attachCourseScope);

const nowISO = () => new Date().toISOString();

function courseName(db, id) {
  const c = db.courses.find(x => x.id === id);
  return c ? c.name : '—';
}

/* ==========================================================================
   COURSES
   ========================================================================== */

router.get('/courses', requirePerm('courses.read'), (req, res) => {
  const db = readDB();
  // A trainer scoped to Digital Marketing sees only Digital Marketing here —
  // which is what stops them wandering into another course's batches.
  const list = db.courses.filter(c => req.scope.allows(c.id));
  res.json(list);
});

router.post('/courses', requirePerm('courses.write'), (req, res) => {
  const db = readDB();
  const { name, code, description, fee, durationLabel, totalWeeks } = req.body;
  if (!name) return res.status(400).json({ error: 'Course name is required.' });

  const course = {
    id: newId('crs'),
    code: code || name.split(' ').map(w => w[0]).join('').toUpperCase(),
    name,
    description: description || '',
    fee: Number(fee) || 0,
    durationLabel: durationLabel || '',
    totalWeeks: Number(totalWeeks) || 20,
    curriculum: [],
    active: true,
    createdAt: nowISO()
  };
  db.courses.push(course);
  logAudit(db, req, { action: 'create', entity: 'course', entityId: course.id, label: course.name, after: course });
  writeDB(db);
  res.status(201).json({ ok: true, course });
});

router.put('/courses/:id', requirePerm('courses.write'), (req, res) => {
  const db = readDB();
  const course = db.courses.find(c => c.id === req.params.id);
  if (!course) return res.status(404).json({ error: 'Course not found.' });
  if (!assertCourseAccess(req, res, course.id, 'course')) return;

  const before = { ...course };
  Object.assign(course, req.body, { id: course.id });
  logAudit(db, req, { action: 'update', entity: 'course', entityId: course.id, label: course.name, before, after: course });
  writeDB(db);
  res.json({ ok: true, course });
});

router.delete('/courses/:id', requirePerm('courses.write'), (req, res) => {
  const db = readDB();
  const course = db.courses.find(c => c.id === req.params.id);
  if (!course) return res.status(404).json({ error: 'Course not found.' });

  const inUse = db.batches.filter(b => b.courseId === course.id).length;
  if (inUse) {
    return res.status(409).json({ error: `${inUse} batch(es) still reference this course. Archive it instead of deleting.` });
  }
  db.courses = db.courses.filter(c => c.id !== course.id);
  logAudit(db, req, { action: 'delete', entity: 'course', entityId: course.id, label: course.name, before: course });
  writeDB(db);
  res.json({ ok: true });
});

/** Curriculum modules for a course. */
router.put('/courses/:id/curriculum', requirePerm('courses.write'), (req, res) => {
  const db = readDB();
  const course = db.courses.find(c => c.id === req.params.id);
  if (!course) return res.status(404).json({ error: 'Course not found.' });
  if (!assertCourseAccess(req, res, course.id, 'course')) return;

  const before = { curriculum: course.curriculum };
  course.curriculum = Array.isArray(req.body.curriculum) ? req.body.curriculum : [];
  logAudit(db, req, { action: 'update', entity: 'curriculum', entityId: course.id, label: course.name, before, after: { curriculum: course.curriculum } });
  writeDB(db);
  res.json({ ok: true, curriculum: course.curriculum });
});

/* ==========================================================================
   BATCHES
   ========================================================================== */

function decorateBatch(db, b) {
  const students = db.students.filter(s => s.batchId === b.id);
  const sessions = db.classSessions.filter(c => c.batchId === b.id);
  return {
    ...b,
    courseName: courseName(db, b.courseId),
    trainerName: (db.adminUsers.find(a => a.id === b.trainerId) || {}).name || null,
    mentorNames: (b.mentorIds || []).map(id => (db.mentors.find(m => m.id === id) || {}).name).filter(Boolean),
    studentCount: students.length,
    sessionCount: sessions.length
  };
}

router.get('/batches', requirePerm('batches.read'), (req, res) => {
  const db = readDB();
  const list = db.batches
    .filter(b => req.scope.allows(b.courseId))
    .map(b => decorateBatch(db, b));
  res.json(list);
});

router.get('/batches/:id', requirePerm('batches.read'), (req, res) => {
  const db = readDB();
  const batch = db.batches.find(b => b.id === req.params.id);
  if (!batch) return res.status(404).json({ error: 'Batch not found.' });
  if (!assertCourseAccess(req, res, batch.courseId, 'batch')) return;

  res.json({
    ...decorateBatch(db, batch),
    students: db.students.filter(s => s.batchId === batch.id).map(({ passwordHash, ...s }) => s),
    sessions: db.classSessions.filter(c => c.batchId === batch.id)
  });
});

/**
 * Mentors can only be attached to a batch whose course they're approved for.
 * This is the enforcement point for "a Digital Marketing mentor must not
 * reach any other course".
 */
function validateMentorAssignment(db, mentorIds, courseId) {
  const problems = [];
  (mentorIds || []).forEach(id => {
    const mentor = db.mentors.find(m => m.id === id);
    if (!mentor) { problems.push(`Mentor ${id} does not exist.`); return; }
    if (!Array.isArray(mentor.courseIds) || !mentor.courseIds.includes(courseId)) {
      problems.push(`${mentor.name} is not approved for ${courseName(db, courseId)}. Add that course to their mentor profile first.`);
    }
  });
  return problems;
}

router.post('/batches', requirePerm('batches.write'), (req, res) => {
  const db = readDB();
  const { name, courseId, startDate, endDate, trainerId, mentorIds, classTiming, days, mode, classroom, capacity } = req.body;
  if (!name || !courseId) return res.status(400).json({ error: 'Batch name and course are required.' });
  if (!assertCourseAccess(req, res, courseId, 'course')) return;

  const problems = validateMentorAssignment(db, mentorIds, courseId);
  if (problems.length) return res.status(400).json({ error: problems.join(' ') });

  const batch = {
    id: newId('bat'),
    name,
    courseId,
    startDate: startDate || null,
    endDate: endDate || null,
    trainerId: trainerId || null,
    mentorIds: mentorIds || [],
    classTiming: classTiming || '',
    days: Array.isArray(days) ? days : (days ? String(days).split(',').map(d => d.trim()) : []),
    mode: mode || 'online',            // online | classroom | hybrid
    classroom: classroom || '',
    capacity: Number(capacity) || 30,
    status: 'upcoming',                // upcoming | ongoing | completed | cancelled
    createdAt: nowISO()
  };
  db.batches.push(batch);
  logAudit(db, req, { action: 'create', entity: 'batch', entityId: batch.id, label: batch.name, after: batch });
  writeDB(db);
  res.status(201).json({ ok: true, batch: decorateBatch(db, batch) });
});

router.put('/batches/:id', requirePerm('batches.write'), (req, res) => {
  const db = readDB();
  const batch = db.batches.find(b => b.id === req.params.id);
  if (!batch) return res.status(404).json({ error: 'Batch not found.' });
  if (!assertCourseAccess(req, res, batch.courseId, 'batch')) return;

  const targetCourse = req.body.courseId || batch.courseId;
  if (req.body.mentorIds) {
    const problems = validateMentorAssignment(db, req.body.mentorIds, targetCourse);
    if (problems.length) return res.status(400).json({ error: problems.join(' ') });
  }

  const before = { ...batch };
  Object.assign(batch, req.body, { id: batch.id });
  logAudit(db, req, { action: 'update', entity: 'batch', entityId: batch.id, label: batch.name, before, after: batch });
  writeDB(db);
  res.json({ ok: true, batch: decorateBatch(db, batch) });
});

router.delete('/batches/:id', requirePerm('batches.write'), (req, res) => {
  const db = readDB();
  const batch = db.batches.find(b => b.id === req.params.id);
  if (!batch) return res.status(404).json({ error: 'Batch not found.' });
  if (!assertCourseAccess(req, res, batch.courseId, 'batch')) return;

  db.students.forEach(s => { if (s.batchId === batch.id) s.batchId = null; });
  db.batches = db.batches.filter(b => b.id !== batch.id);
  logAudit(db, req, { action: 'delete', entity: 'batch', entityId: batch.id, label: batch.name, before: batch });
  writeDB(db);
  res.json({ ok: true });
});

/** Add / remove students on a batch. */
router.put('/batches/:id/students', requirePerm('batches.write'), (req, res) => {
  const db = readDB();
  const batch = db.batches.find(b => b.id === req.params.id);
  if (!batch) return res.status(404).json({ error: 'Batch not found.' });
  if (!assertCourseAccess(req, res, batch.courseId, 'batch')) return;

  const ids = Array.isArray(req.body.studentIds) ? req.body.studentIds : [];
  if (ids.length > batch.capacity) {
    return res.status(400).json({ error: `That's ${ids.length} students for a batch with capacity ${batch.capacity}. Raise the capacity first.` });
  }

  const before = { students: db.students.filter(s => s.batchId === batch.id).map(s => s.id) };
  db.students.forEach(s => {
    if (ids.includes(s.id)) {
      s.batchId = batch.id;
      if (!s.courseIds.includes(batch.courseId)) s.courseIds.push(batch.courseId);
    } else if (s.batchId === batch.id) {
      s.batchId = null;
    }
  });
  logAudit(db, req, { action: 'update', entity: 'batch_roster', entityId: batch.id, label: batch.name, before, after: { students: ids } });
  writeDB(db);
  res.json({ ok: true, studentIds: ids });
});

/* ==========================================================================
   CLASS / LIVE SESSION MANAGEMENT
   ========================================================================== */

router.get('/classes', requirePerm('classes.read'), (req, res) => {
  const db = readDB();
  const { batchId, from, to, status } = req.query;

  let list = db.classSessions.filter(c => {
    const batch = db.batches.find(b => b.id === c.batchId);
    return req.scope.allows(batch ? batch.courseId : null);
  });

  if (batchId) list = list.filter(c => c.batchId === batchId);
  if (status) list = list.filter(c => c.status === status);
  if (from) list = list.filter(c => c.startsAt >= from);
  if (to) list = list.filter(c => c.startsAt <= to);

  res.json(list.map(c => {
    const batch = db.batches.find(b => b.id === c.batchId);
    return {
      ...c,
      batchName: batch ? batch.name : '—',
      courseName: batch ? courseName(db, batch.courseId) : '—',
      trainerName: (db.adminUsers.find(a => a.id === c.trainerId) || {}).name || null,
      attendanceMarked: db.attendance.some(a => a.sessionId === c.id)
    };
  }).sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt))));
});

router.post('/classes', requirePerm('classes.write'), (req, res) => {
  const db = readDB();
  const { batchId, topic, startsAt, endsAt, trainerId, meetingLink, mode, room } = req.body;
  if (!batchId || !startsAt) return res.status(400).json({ error: 'Batch and start time are required.' });

  const batch = db.batches.find(b => b.id === batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found.' });
  if (!assertCourseAccess(req, res, batch.courseId, 'batch')) return;

  const session = {
    id: newId('cls'),
    batchId,
    topic: topic || 'Live session',
    startsAt,
    endsAt: endsAt || null,
    trainerId: trainerId || batch.trainerId || null,
    meetingLink: meetingLink || '',
    recordingUrl: '',
    mode: mode || batch.mode || 'online',
    room: room || batch.classroom || '',
    status: 'scheduled',              // scheduled | completed | cancelled | rescheduled
    remindersSentAt: null,
    cancelReason: '',
    createdAt: nowISO()
  };
  db.classSessions.push(session);

  notify(db, {
    event: 'class_scheduled',
    title: 'Class Scheduled',
    body: `${session.topic} for ${batch.name} on ${new Date(startsAt).toLocaleString('en-IN')}.`,
    link: `#classes/${session.id}`,
    audience: { userIds: db.students.filter(s => s.batchId === batchId).map(s => s.id).concat(batch.mentorIds || []) },
    meta: { sessionId: session.id, batchId }
  });

  logAudit(db, req, { action: 'create', entity: 'class', entityId: session.id, label: `${batch.name} — ${session.topic}`, after: session });
  writeDB(db);
  res.status(201).json({ ok: true, session });
});

router.put('/classes/:id', requirePerm('classes.write'), (req, res) => {
  const db = readDB();
  const session = db.classSessions.find(c => c.id === req.params.id);
  if (!session) return res.status(404).json({ error: 'Class not found.' });
  const batch = db.batches.find(b => b.id === session.batchId);
  if (!assertCourseAccess(req, res, batch ? batch.courseId : null, 'class')) return;

  const before = { ...session };
  Object.assign(session, req.body, { id: session.id });
  logAudit(db, req, { action: 'update', entity: 'class', entityId: session.id, label: session.topic, before, after: session });
  writeDB(db);
  res.json({ ok: true, session });
});

/** Reschedule keeps a trail of the original slot rather than silently moving it. */
router.post('/classes/:id/reschedule', requirePerm('classes.write'), (req, res) => {
  const db = readDB();
  const session = db.classSessions.find(c => c.id === req.params.id);
  if (!session) return res.status(404).json({ error: 'Class not found.' });
  const batch = db.batches.find(b => b.id === session.batchId);
  if (!assertCourseAccess(req, res, batch ? batch.courseId : null, 'class')) return;

  const { startsAt, endsAt, reason } = req.body;
  if (!startsAt) return res.status(400).json({ error: 'A new start time is required.' });

  const before = { startsAt: session.startsAt, endsAt: session.endsAt };
  session.rescheduledFrom = session.rescheduledFrom || [];
  session.rescheduledFrom.push({ startsAt: session.startsAt, endsAt: session.endsAt, movedAt: nowISO(), reason: reason || '' });
  session.startsAt = startsAt;
  session.endsAt = endsAt || null;
  session.status = 'rescheduled';

  notify(db, {
    event: 'class_scheduled',
    title: 'Class Rescheduled',
    body: `${session.topic} moved to ${new Date(startsAt).toLocaleString('en-IN')}.${reason ? ' Reason: ' + reason : ''}`,
    audience: { userIds: db.students.filter(s => s.batchId === session.batchId).map(s => s.id).concat(batch ? batch.mentorIds || [] : []) }
  });

  logAudit(db, req, { action: 'reschedule', entity: 'class', entityId: session.id, label: session.topic, before, after: { startsAt, endsAt } });
  writeDB(db);
  res.json({ ok: true, session });
});

router.post('/classes/:id/cancel', requirePerm('classes.write'), (req, res) => {
  const db = readDB();
  const session = db.classSessions.find(c => c.id === req.params.id);
  if (!session) return res.status(404).json({ error: 'Class not found.' });
  const batch = db.batches.find(b => b.id === session.batchId);
  if (!assertCourseAccess(req, res, batch ? batch.courseId : null, 'class')) return;

  const before = { status: session.status };
  session.status = 'cancelled';
  session.cancelReason = req.body.reason || '';

  notify(db, {
    event: 'class_scheduled',
    title: 'Class Cancelled',
    body: `${session.topic} on ${new Date(session.startsAt).toLocaleString('en-IN')} was cancelled.${session.cancelReason ? ' ' + session.cancelReason : ''}`,
    audience: { userIds: db.students.filter(s => s.batchId === session.batchId).map(s => s.id) }
  });

  logAudit(db, req, { action: 'cancel', entity: 'class', entityId: session.id, label: session.topic, before, after: { status: 'cancelled' } });
  writeDB(db);
  res.json({ ok: true, session });
});

router.post('/classes/:id/reminders', requirePerm('classes.write'), (req, res) => {
  const db = readDB();
  const session = db.classSessions.find(c => c.id === req.params.id);
  if (!session) return res.status(404).json({ error: 'Class not found.' });

  const students = db.students.filter(s => s.batchId === session.batchId);
  notify(db, {
    event: 'class_scheduled',
    title: 'Class Reminder',
    body: `${session.topic} starts ${new Date(session.startsAt).toLocaleString('en-IN')}.${session.meetingLink ? ' Join link is on your dashboard.' : ''}`,
    link: session.meetingLink || null,
    audience: { userIds: students.map(s => s.id) },
    respectSettings: false
  });

  session.remindersSentAt = nowISO();
  logAudit(db, req, { action: 'send_reminder', entity: 'class', entityId: session.id, label: session.topic, meta: { recipients: students.length } });
  writeDB(db);
  res.json({ ok: true, sent: students.length });
});

/* ==========================================================================
   ATTENDANCE
   ========================================================================== */

router.get('/attendance', requirePerm('attendance.read'), (req, res) => {
  const db = readDB();
  const { sessionId, studentId, batchId } = req.query;
  let list = db.attendance;
  if (sessionId) list = list.filter(a => a.sessionId === sessionId);
  if (studentId) list = list.filter(a => a.studentId === studentId);
  if (batchId) {
    const sessionIds = db.classSessions.filter(c => c.batchId === batchId).map(c => c.id);
    list = list.filter(a => sessionIds.includes(a.sessionId));
  }
  res.json(list);
});

/** Bulk marking — the register is saved as one action, not one row at a time. */
router.post('/attendance', requirePerm('attendance.write'), (req, res) => {
  const db = readDB();
  const { sessionId, records } = req.body;
  const session = db.classSessions.find(c => c.id === sessionId);
  if (!session) return res.status(404).json({ error: 'Class not found.' });

  const batch = db.batches.find(b => b.id === session.batchId);
  if (!assertCourseAccess(req, res, batch ? batch.courseId : null, 'class')) return;
  if (!Array.isArray(records)) return res.status(400).json({ error: 'records[] is required.' });

  db.attendance = db.attendance.filter(a => a.sessionId !== sessionId);
  records.forEach(r => {
    db.attendance.push({
      id: newId('att'),
      sessionId,
      batchId: session.batchId,
      studentId: r.studentId,
      status: r.status || 'present',    // present | absent | late | excused
      minutesAttended: Number(r.minutesAttended) || null,
      note: r.note || '',
      markedBy: req.user.id,
      markedAt: nowISO()
    });
  });

  if (session.status === 'scheduled') session.status = 'completed';

  // Anyone who has now dipped under the threshold gets flagged immediately —
  // that's the "Low Attendance" alert, computed rather than manually raised.
  const threshold = db.settings.notifications.lowAttendanceThreshold || 75;
  records.forEach(r => {
    const pct = attendancePercent(db, r.studentId);
    if (pct !== null && pct < threshold) {
      const student = db.students.find(s => s.id === r.studentId);
      notify(db, {
        event: 'low_attendance',
        title: 'Low Attendance',
        body: `${student ? student.name : 'A student'} is at ${pct}% attendance (threshold ${threshold}%).`,
        link: `#students/${r.studentId}`,
        audience: { userIds: [r.studentId] },
        meta: { studentId: r.studentId, percent: pct }
      });
    }
  });

  logAudit(db, req, {
    action: 'mark_attendance', entity: 'class', entityId: sessionId, label: session.topic,
    meta: { present: records.filter(r => r.status === 'present').length, total: records.length }
  });
  writeDB(db);
  res.json({ ok: true, marked: records.length });
});

function attendancePercent(db, studentId) {
  const rows = db.attendance.filter(a => a.studentId === studentId);
  if (!rows.length) return null;
  const present = rows.filter(a => a.status === 'present' || a.status === 'late').length;
  return Math.round((present / rows.length) * 100);
}

/* ==========================================================================
   ASSIGNMENTS & SUBMISSIONS
   ========================================================================== */

router.get('/assignments', requirePerm('assignments.read'), (req, res) => {
  const db = readDB();
  let list = db.assignments.filter(a => req.scope.allows(a.courseId));
  if (req.query.batchId) list = list.filter(a => a.batchId === req.query.batchId);
  res.json(list.map(a => ({
    ...a,
    courseName: courseName(db, a.courseId),
    submissionCount: db.submissions.filter(s => s.assignmentId === a.id).length,
    gradedCount: db.submissions.filter(s => s.assignmentId === a.id && s.grade != null).length
  })));
});

router.post('/assignments', requirePerm('assignments.write'), (req, res) => {
  const db = readDB();
  const { title, courseId, batchId, description, dueDate, maxMarks, week } = req.body;
  if (!title || !courseId) return res.status(400).json({ error: 'Title and course are required.' });
  if (!assertCourseAccess(req, res, courseId, 'course')) return;

  const assignment = {
    id: newId('asg'), title, courseId, batchId: batchId || null,
    description: description || '', dueDate: dueDate || null,
    maxMarks: Number(maxMarks) || 100, week: Number(week) || null,
    createdBy: req.user.id, createdAt: nowISO()
  };
  db.assignments.push(assignment);

  const targets = batchId
    ? db.students.filter(s => s.batchId === batchId)
    : db.students.filter(s => (s.courseIds || []).includes(courseId));
  notify(db, {
    event: 'assignment_submitted',
    title: 'New Assignment',
    body: `${title}${dueDate ? ' — due ' + new Date(dueDate).toLocaleDateString('en-IN') : ''}`,
    audience: { userIds: targets.map(s => s.id) },
    respectSettings: false
  });

  logAudit(db, req, { action: 'create', entity: 'assignment', entityId: assignment.id, label: title, after: assignment });
  writeDB(db);
  res.status(201).json({ ok: true, assignment });
});

router.put('/assignments/:id', requirePerm('assignments.write'), (req, res) => {
  const db = readDB();
  const a = db.assignments.find(x => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'Assignment not found.' });
  if (!assertCourseAccess(req, res, a.courseId, 'assignment')) return;
  const before = { ...a };
  Object.assign(a, req.body, { id: a.id });
  logAudit(db, req, { action: 'update', entity: 'assignment', entityId: a.id, label: a.title, before, after: a });
  writeDB(db);
  res.json({ ok: true, assignment: a });
});

router.delete('/assignments/:id', requirePerm('assignments.write'), (req, res) => {
  const db = readDB();
  const a = db.assignments.find(x => x.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'Assignment not found.' });
  if (!assertCourseAccess(req, res, a.courseId, 'assignment')) return;
  db.assignments = db.assignments.filter(x => x.id !== a.id);
  db.submissions = db.submissions.filter(s => s.assignmentId !== a.id);
  logAudit(db, req, { action: 'delete', entity: 'assignment', entityId: a.id, label: a.title, before: a });
  writeDB(db);
  res.json({ ok: true });
});

router.get('/submissions', requirePerm('assignments.read'), (req, res) => {
  const db = readDB();
  let list = db.submissions;
  if (req.query.assignmentId) list = list.filter(s => s.assignmentId === req.query.assignmentId);
  if (req.query.studentId) list = list.filter(s => s.studentId === req.query.studentId);
  res.json(list.map(s => ({
    ...s,
    studentName: (db.students.find(st => st.id === s.studentId) || {}).name || '—',
    assignmentTitle: (db.assignments.find(a => a.id === s.assignmentId) || {}).title || '—'
  })));
});

router.put('/submissions/:id/grade', requirePerm('assignments.write'), (req, res) => {
  const db = readDB();
  const sub = db.submissions.find(s => s.id === req.params.id);
  if (!sub) return res.status(404).json({ error: 'Submission not found.' });
  const before = { grade: sub.grade, feedback: sub.feedback };
  sub.grade = Number(req.body.grade);
  sub.feedback = req.body.feedback || '';
  sub.gradedBy = req.user.id;
  sub.gradedAt = nowISO();

  notify(db, {
    event: 'assignment_submitted',
    title: 'Assignment Graded',
    body: `Your submission scored ${sub.grade}.`,
    audience: { userIds: [sub.studentId] },
    respectSettings: false
  });

  logAudit(db, req, { action: 'grade', entity: 'submission', entityId: sub.id, before, after: { grade: sub.grade, feedback: sub.feedback } });
  writeDB(db);
  res.json({ ok: true, submission: sub });
});

/* ==========================================================================
   PROJECTS
   ========================================================================== */

router.get('/projects', requirePerm('assignments.read'), (req, res) => {
  const db = readDB();
  let list = db.projects.filter(p => req.scope.allows(p.courseId));
  if (req.query.studentId) list = list.filter(p => p.studentId === req.query.studentId);
  res.json(list.map(p => ({ ...p, studentName: (db.students.find(s => s.id === p.studentId) || {}).name || '—' })));
});

router.post('/projects', requirePerm('assignments.write'), (req, res) => {
  const db = readDB();
  const { title, studentId, courseId, description, repoUrl, liveUrl, dueDate } = req.body;
  if (!title || !studentId) return res.status(400).json({ error: 'Title and student are required.' });

  const project = {
    id: newId('prj'), title, studentId, courseId: courseId || null,
    description: description || '', repoUrl: repoUrl || '', liveUrl: liveUrl || '',
    dueDate: dueDate || null, status: 'in_progress',   // in_progress | submitted | reviewed | approved
    score: null, feedback: '', createdAt: nowISO()
  };
  db.projects.push(project);
  logAudit(db, req, { action: 'create', entity: 'project', entityId: project.id, label: title, after: project });
  writeDB(db);
  res.status(201).json({ ok: true, project });
});

router.put('/projects/:id', requirePerm('assignments.write'), (req, res) => {
  const db = readDB();
  const p = db.projects.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found.' });
  const before = { ...p };
  Object.assign(p, req.body, { id: p.id });
  logAudit(db, req, { action: 'update', entity: 'project', entityId: p.id, label: p.title, before, after: p });
  writeDB(db);
  res.json({ ok: true, project: p });
});

router.delete('/projects/:id', requirePerm('assignments.write'), (req, res) => {
  const db = readDB();
  const p = db.projects.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Project not found.' });
  db.projects = db.projects.filter(x => x.id !== p.id);
  logAudit(db, req, { action: 'delete', entity: 'project', entityId: p.id, label: p.title, before: p });
  writeDB(db);
  res.json({ ok: true });
});

/* ==========================================================================
   ASSESSMENTS
   ========================================================================== */

router.get('/assessments', requirePerm('assessments.read'), (req, res) => {
  const db = readDB();
  const list = db.assessments.filter(a => req.scope.allows(a.courseId));
  res.json(list.map(a => ({
    ...a,
    courseName: courseName(db, a.courseId),
    attempts: db.assessmentResults.filter(r => r.assessmentId === a.id).length
  })));
});

router.post('/assessments', requirePerm('assessments.write'), (req, res) => {
  const db = readDB();
  const { title, courseId, batchId, type, scheduledAt, maxMarks, passMarks, durationMinutes } = req.body;
  if (!title || !courseId) return res.status(400).json({ error: 'Title and course are required.' });
  if (!assertCourseAccess(req, res, courseId, 'course')) return;

  const assessment = {
    id: newId('ass'), title, courseId, batchId: batchId || null,
    type: type || 'quiz',            // quiz | midterm | final | mock_interview | practical
    scheduledAt: scheduledAt || null,
    maxMarks: Number(maxMarks) || 100,
    passMarks: Number(passMarks) || 40,
    durationMinutes: Number(durationMinutes) || 60,
    createdAt: nowISO()
  };
  db.assessments.push(assessment);
  logAudit(db, req, { action: 'create', entity: 'assessment', entityId: assessment.id, label: title, after: assessment });
  writeDB(db);
  res.status(201).json({ ok: true, assessment });
});

router.get('/assessment-results', requirePerm('assessments.read'), (req, res) => {
  const db = readDB();
  let list = db.assessmentResults;
  if (req.query.assessmentId) list = list.filter(r => r.assessmentId === req.query.assessmentId);
  if (req.query.studentId) list = list.filter(r => r.studentId === req.query.studentId);
  res.json(list.map(r => ({
    ...r,
    studentName: (db.students.find(s => s.id === r.studentId) || {}).name || '—',
    assessmentTitle: (db.assessments.find(a => a.id === r.assessmentId) || {}).title || '—'
  })));
});

router.post('/assessment-results', requirePerm('assessments.write'), (req, res) => {
  const db = readDB();
  const { assessmentId, results } = req.body;
  const assessment = db.assessments.find(a => a.id === assessmentId);
  if (!assessment) return res.status(404).json({ error: 'Assessment not found.' });
  if (!Array.isArray(results)) return res.status(400).json({ error: 'results[] is required.' });

  db.assessmentResults = db.assessmentResults.filter(r => r.assessmentId !== assessmentId);
  results.forEach(r => {
    const marks = Number(r.marks) || 0;
    db.assessmentResults.push({
      id: newId('res'), assessmentId, studentId: r.studentId, marks,
      maxMarks: assessment.maxMarks,
      passed: marks >= assessment.passMarks,
      remarks: r.remarks || '',
      recordedBy: req.user.id, recordedAt: nowISO()
    });
  });

  logAudit(db, req, { action: 'record_results', entity: 'assessment', entityId: assessmentId, label: assessment.title, meta: { count: results.length } });
  writeDB(db);
  res.json({ ok: true, recorded: results.length });
});

/* ==========================================================================
   CERTIFICATES
   ========================================================================== */

router.get('/certificates', requirePerm('certificates.read'), (req, res) => {
  const db = readDB();
  let list = db.certificates;
  if (req.query.studentId) list = list.filter(c => c.studentId === req.query.studentId);
  res.json(list.map(c => ({
    ...c,
    studentName: (db.students.find(s => s.id === c.studentId) || {}).name || '—',
    courseName: courseName(db, c.courseId)
  })));
});

router.post('/certificates', requirePerm('certificates.write'), (req, res) => {
  const db = readDB();
  const { studentId, courseId, type, grade, fileUrl } = req.body;
  const student = db.students.find(s => s.id === studentId);
  if (!student) return res.status(404).json({ error: 'Student not found.' });

  const serial = `${(db.settings.payments.invoicePrefix || 'BM')}-CERT-${String(db.certificates.length + 1).padStart(5, '0')}`;
  const cert = {
    id: newId('cer'), studentId, courseId: courseId || null,
    type: type || 'completion',        // completion | excellence | participation | internship
    serial,
    grade: grade || '',
    fileUrl: fileUrl || '',
    issuedBy: req.user.id,
    issuedAt: nowISO(),
    revoked: false
  };
  db.certificates.push(cert);

  notify(db, {
    event: 'announcement',
    title: 'Certificate Issued',
    body: `Your ${cert.type} certificate (${serial}) has been issued.`,
    audience: { userIds: [studentId] },
    respectSettings: false
  });

  logAudit(db, req, { action: 'issue', entity: 'certificate', entityId: cert.id, label: `${student.name} — ${serial}`, after: cert });
  writeDB(db);
  res.status(201).json({ ok: true, certificate: cert });
});

router.post('/certificates/:id/revoke', requirePerm('certificates.write'), (req, res) => {
  const db = readDB();
  const cert = db.certificates.find(c => c.id === req.params.id);
  if (!cert) return res.status(404).json({ error: 'Certificate not found.' });
  cert.revoked = true;
  cert.revokedReason = req.body.reason || '';
  cert.revokedAt = nowISO();
  logAudit(db, req, { action: 'revoke', entity: 'certificate', entityId: cert.id, label: cert.serial, after: { revoked: true, reason: cert.revokedReason } });
  writeDB(db);
  res.json({ ok: true, certificate: cert });
});

module.exports = router;
module.exports.attendancePercent = attendancePercent;
