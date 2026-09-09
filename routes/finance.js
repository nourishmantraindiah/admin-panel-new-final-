const express = require('express');
const router = express.Router();
const { readDB, writeDB, newId } = require('../lib/db');
const { requireAuth, requirePerm, attachCourseScope } = require('../middleware/auth');
const { logAudit } = require('../lib/audit');
const { notify } = require('../lib/notify');

router.use(requireAuth('staff'), attachCourseScope);

const nowISO = () => new Date().toISOString();
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

/**
 * A fee profile is the single source of truth for one student's money:
 * course fee, discounts, scholarship, the installment plan, and everything
 * paid against it. Totals are always derived, never stored — that way a
 * payment recorded anywhere can't leave the balance stale.
 */
function computeProfile(db, profile) {
  const payments = db.payments.filter(p => p.feeProfileId === profile.id && p.status === 'success');
  const paid = round2(payments.reduce((s, p) => s + Number(p.amount || 0), 0));

  const gross = round2(profile.courseFee);
  const discount = round2(profile.discount);
  const scholarship = round2(profile.scholarship);
  const net = round2(Math.max(gross - discount - scholarship, 0));
  const pending = round2(Math.max(net - paid, 0));

  const graceDays = db.settings.notifications.overdueGraceDays || 0;
  const today = new Date();

  // Payments recorded without an installment tag are spread across the plan
  // oldest-due-first, the way a front desk actually applies a walk-in
  // payment. Without this, paying the exact amount of installment 1 would
  // still leave it showing as overdue.
  const ordered = (profile.installments || [])
    .slice()
    .sort((a, b) => String(a.dueDate || '').localeCompare(String(b.dueDate || '')));

  let floating = round2(
    payments.filter(p => !p.installmentId).reduce((s, p) => s + Number(p.amount || 0), 0)
  );
  const autoApplied = {};
  ordered.forEach(inst => {
    if (floating <= 0) return;
    const tagged = round2(payments.filter(p => p.installmentId === inst.id).reduce((s, p) => s + Number(p.amount || 0), 0));
    const room = round2(Math.max(inst.amount - tagged, 0));
    const use = round2(Math.min(room, floating));
    autoApplied[inst.id] = use;
    floating = round2(floating - use);
  });

  const installments = (profile.installments || []).map(inst => {
    const against = payments.filter(p => p.installmentId === inst.id);
    const instPaid = round2(
      against.reduce((s, p) => s + Number(p.amount || 0), 0) + (autoApplied[inst.id] || 0)
    );
    const due = new Date(inst.dueDate);
    const graceDue = new Date(due.getTime() + graceDays * 86400000);
    let status = 'pending';
    if (instPaid >= round2(inst.amount)) status = 'paid';
    else if (instPaid > 0) status = 'partial';
    if (status !== 'paid' && inst.dueDate && today > graceDue) status = 'overdue';
    return {
      ...inst,
      paid: instPaid,
      balance: round2(Math.max(inst.amount - instPaid, 0)),
      status,
      daysOverdue: status === 'overdue' ? Math.floor((today - due) / 86400000) : 0
    };
  });

  const student = db.students.find(s => s.id === profile.studentId) || {};
  const course = db.courses.find(c => c.id === profile.courseId) || {};

  return {
    ...profile,
    studentName: student.name || '—',
    studentEmail: student.email || '',
    courseName: course.name || '—',
    netPayable: net,
    amountPaid: paid,
    amountPending: pending,
    installments,
    overdueCount: installments.filter(i => i.status === 'overdue').length,
    status: pending === 0 && net > 0 ? 'cleared' : (installments.some(i => i.status === 'overdue') ? 'overdue' : 'active'),
    payments: payments.map(p => ({
      id: p.id, amount: p.amount, method: p.method, reference: p.reference,
      paidAt: p.paidAt, installmentId: p.installmentId, invoiceId: p.invoiceId, note: p.note
    }))
  };
}

/* ==========================================================================
   FEE PROFILES
   ========================================================================== */

router.get('/fee-profiles', requirePerm('fees.read'), (req, res) => {
  const db = readDB();
  const list = db.feeProfiles
    .filter(p => req.scope.allows(p.courseId))
    .filter(p => !req.query.studentId || p.studentId === req.query.studentId)
    .map(p => computeProfile(db, p));
  res.json(list);
});

router.post('/fee-profiles', requirePerm('fees.write'), (req, res) => {
  const db = readDB();
  const { studentId, courseId, courseFee, discount, scholarship, discountReason, installments } = req.body;

  const student = db.students.find(s => s.id === studentId);
  if (!student) return res.status(404).json({ error: 'Student not found.' });
  if (db.feeProfiles.some(p => p.studentId === studentId && p.courseId === courseId)) {
    return res.status(409).json({ error: 'This student already has a fee profile for that course.' });
  }

  const course = db.courses.find(c => c.id === courseId);
  const profile = {
    id: newId('fee'),
    studentId,
    courseId: courseId || null,
    courseFee: round2(courseFee != null ? courseFee : (course ? course.fee : 0)),
    discount: round2(discount),
    scholarship: round2(scholarship),
    discountReason: discountReason || '',
    installments: (installments || []).map(i => ({
      id: newId('ins'),
      label: i.label || 'Installment',
      amount: round2(i.amount),
      dueDate: i.dueDate || null
    })),
    createdAt: nowISO(),
    createdBy: req.user.id
  };

  db.feeProfiles.push(profile);
  logAudit(db, req, { action: 'create', entity: 'fee_profile', entityId: profile.id, label: student.name, after: profile });
  writeDB(db);
  res.status(201).json({ ok: true, feeProfile: computeProfile(db, profile) });
});

router.put('/fee-profiles/:id', requirePerm('fees.write'), (req, res) => {
  const db = readDB();
  const profile = db.feeProfiles.find(p => p.id === req.params.id);
  if (!profile) return res.status(404).json({ error: 'Fee profile not found.' });

  const before = { ...profile };
  const { courseFee, discount, scholarship, discountReason, installments } = req.body;
  if (courseFee != null) profile.courseFee = round2(courseFee);
  if (discount != null) profile.discount = round2(discount);
  if (scholarship != null) profile.scholarship = round2(scholarship);
  if (discountReason != null) profile.discountReason = discountReason;
  if (Array.isArray(installments)) {
    profile.installments = installments.map(i => ({
      id: i.id || newId('ins'),
      label: i.label || 'Installment',
      amount: round2(i.amount),
      dueDate: i.dueDate || null
    }));
  }

  // Fee changes are exactly the kind of edit the audit log exists for.
  logAudit(db, req, {
    action: 'update', entity: 'fee_profile', entityId: profile.id,
    label: (db.students.find(s => s.id === profile.studentId) || {}).name || profile.studentId,
    before, after: profile
  });
  writeDB(db);
  res.json({ ok: true, feeProfile: computeProfile(db, profile) });
});

router.delete('/fee-profiles/:id', requirePerm('fees.write'), (req, res) => {
  const db = readDB();
  const profile = db.feeProfiles.find(p => p.id === req.params.id);
  if (!profile) return res.status(404).json({ error: 'Fee profile not found.' });
  if (db.payments.some(p => p.feeProfileId === profile.id)) {
    return res.status(409).json({ error: 'Payments exist against this profile — it cannot be deleted, only edited.' });
  }
  db.feeProfiles = db.feeProfiles.filter(p => p.id !== profile.id);
  logAudit(db, req, { action: 'delete', entity: 'fee_profile', entityId: profile.id, before: profile });
  writeDB(db);
  res.json({ ok: true });
});

/* ==========================================================================
   PAYMENTS
   ========================================================================== */

router.get('/payments', requirePerm('payments.read'), (req, res) => {
  const db = readDB();
  let list = db.payments;
  if (req.query.studentId) list = list.filter(p => p.studentId === req.query.studentId);
  if (req.query.from) list = list.filter(p => p.paidAt >= req.query.from);
  if (req.query.to) list = list.filter(p => p.paidAt <= req.query.to);
  res.json(list.slice().reverse().map(p => ({
    ...p,
    studentName: (db.students.find(s => s.id === p.studentId) || {}).name || '—'
  })));
});

router.post('/payments', requirePerm('payments.write'), (req, res) => {
  const db = readDB();
  const { feeProfileId, installmentId, amount, method, reference, paidAt, note } = req.body;

  const profile = db.feeProfiles.find(p => p.id === feeProfileId);
  if (!profile) return res.status(404).json({ error: 'Fee profile not found.' });
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'A positive amount is required.' });

  const computed = computeProfile(db, profile);
  if (round2(amount) > computed.amountPending + 0.01) {
    return res.status(400).json({
      error: `That's more than the outstanding balance (₹${computed.amountPending}). Record an adjustment instead if this is intentional.`
    });
  }

  const payment = {
    id: newId('pay'),
    feeProfileId,
    studentId: profile.studentId,
    installmentId: installmentId || null,
    amount: round2(amount),
    method: method || 'upi',        // upi | card | netbanking | cash | cheque | neft | gateway
    reference: reference || '',
    status: 'success',
    paidAt: paidAt || nowISO(),
    note: note || '',
    recordedBy: req.user.id,
    recordedAt: nowISO()
  };

  const invoice = createInvoice(db, profile, payment);
  payment.invoiceId = invoice.id;
  db.payments.push(payment);

  const student = db.students.find(s => s.id === profile.studentId);
  notify(db, {
    event: 'payment_received',
    title: 'Payment Received',
    body: `₹${payment.amount.toLocaleString('en-IN')} received from ${student ? student.name : 'a student'} via ${payment.method}. Invoice ${invoice.number}.`,
    link: `#finance/${feeProfileId}`,
    audience: { userIds: [profile.studentId] },
    meta: { paymentId: payment.id, invoiceId: invoice.id }
  });

  logAudit(db, req, {
    action: 'record_payment', entity: 'payment', entityId: payment.id,
    label: `${student ? student.name : ''} ₹${payment.amount}`, after: payment
  });
  writeDB(db);
  res.status(201).json({ ok: true, payment, invoice, feeProfile: computeProfile(db, profile) });
});

/** Refunds and reversals are recorded, never deleted — the trail has to hold. */
router.post('/payments/:id/reverse', requirePerm('payments.write'), (req, res) => {
  const db = readDB();
  const payment = db.payments.find(p => p.id === req.params.id);
  if (!payment) return res.status(404).json({ error: 'Payment not found.' });
  if (payment.status !== 'success') return res.status(400).json({ error: 'This payment is not in a reversible state.' });

  const before = { status: payment.status };
  payment.status = 'reversed';
  payment.reversedReason = req.body.reason || '';
  payment.reversedBy = req.user.id;
  payment.reversedAt = nowISO();

  logAudit(db, req, {
    action: 'reverse_payment', entity: 'payment', entityId: payment.id,
    label: `₹${payment.amount}`, before, after: { status: 'reversed', reason: payment.reversedReason }
  });
  writeDB(db);
  res.json({ ok: true, payment });
});

/* ==========================================================================
   INVOICES
   ========================================================================== */

function createInvoice(db, profile, payment) {
  const settings = db.settings.payments;
  const number = `${settings.invoicePrefix || 'BM'}-${settings.nextInvoiceNumber || 1001}`;
  settings.nextInvoiceNumber = (settings.nextInvoiceNumber || 1001) + 1;

  const gstPercent = Number(settings.gstPercent) || 0;
  // Fee collected is treated as GST-inclusive, which is how most institutes
  // quote it. Flip this if your accountant wants tax added on top.
  const taxable = round2(payment.amount / (1 + gstPercent / 100));
  const tax = round2(payment.amount - taxable);

  const student = db.students.find(s => s.id === profile.studentId) || {};
  const course = db.courses.find(c => c.id === profile.courseId) || {};

  const invoice = {
    id: newId('inv'),
    number,
    feeProfileId: profile.id,
    studentId: profile.studentId,
    studentName: student.name || '',
    studentEmail: student.email || '',
    courseName: course.name || '',
    lineItems: [{ description: `${course.name || 'Course'} fee`, amount: round2(payment.amount) }],
    taxableValue: taxable,
    gstPercent,
    gstAmount: tax,
    total: round2(payment.amount),
    gstin: settings.gstin || '',
    issuedAt: nowISO(),
    paymentId: payment.id,
    status: 'paid'
  };
  db.invoices.push(invoice);
  return invoice;
}

router.get('/invoices', requirePerm('invoices.read'), (req, res) => {
  const db = readDB();
  let list = db.invoices;
  if (req.query.studentId) list = list.filter(i => i.studentId === req.query.studentId);
  res.json(list.slice().reverse());
});

router.get('/invoices/:id', requirePerm('invoices.read'), (req, res) => {
  const db = readDB();
  const invoice = db.invoices.find(i => i.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found.' });
  res.json({ invoice, company: db.settings.general, payments: db.settings.payments });
});

/* ==========================================================================
   OVERDUE SWEEP + FINANCE DASHBOARD
   ========================================================================== */

/**
 * Fires "Payment Overdue" alerts for anything past its grace period. Called
 * on demand from the dashboard and on an interval from server.js, so the
 * alert appears without anyone having to open the page.
 */
function sweepOverdue(db, req) {
  let raised = 0;
  db.feeProfiles.forEach(profile => {
    const computed = computeProfile(db, profile);
    computed.installments.filter(i => i.status === 'overdue').forEach(inst => {
      const already = db.notifications.some(n =>
        n.event === 'payment_overdue' && n.meta && n.meta.installmentId === inst.id
      );
      if (already) return;
      const student = db.students.find(s => s.id === profile.studentId);
      notify(db, {
        event: 'payment_overdue',
        title: 'Payment Overdue',
        body: `${student ? student.name : 'A student'} — ${inst.label} of ₹${inst.balance.toLocaleString('en-IN')} is ${inst.daysOverdue} day(s) overdue.`,
        link: `#finance/${profile.id}`,
        audience: { userIds: [profile.studentId] },
        meta: { installmentId: inst.id, feeProfileId: profile.id }
      });
      raised++;
    });
  });
  return raised;
}

router.post('/sweep-overdue', requirePerm('payments.write'), (req, res) => {
  const db = readDB();
  const raised = sweepOverdue(db, req);
  writeDB(db);
  res.json({ ok: true, alertsRaised: raised });
});

router.get('/dashboard', requirePerm('fees.read'), (req, res) => {
  const db = readDB();
  const profiles = db.feeProfiles.map(p => computeProfile(db, p));

  const collected = round2(profiles.reduce((s, p) => s + p.amountPaid, 0));
  const outstanding = round2(profiles.reduce((s, p) => s + p.amountPending, 0));
  const discounted = round2(profiles.reduce((s, p) => s + p.discount + p.scholarship, 0));

  const thisMonth = new Date().toISOString().slice(0, 7);
  const collectedThisMonth = round2(
    db.payments.filter(p => p.status === 'success' && String(p.paidAt).startsWith(thisMonth))
      .reduce((s, p) => s + Number(p.amount), 0)
  );

  const byMethod = {};
  db.payments.filter(p => p.status === 'success').forEach(p => {
    byMethod[p.method] = round2((byMethod[p.method] || 0) + Number(p.amount));
  });

  res.json({
    totalBilled: round2(profiles.reduce((s, p) => s + p.netPayable, 0)),
    collected,
    outstanding,
    discounted,
    collectedThisMonth,
    overdueStudents: profiles.filter(p => p.overdueCount > 0).length,
    clearedStudents: profiles.filter(p => p.status === 'cleared').length,
    byMethod,
    overdueList: profiles.filter(p => p.overdueCount > 0).map(p => ({
      feeProfileId: p.id, studentId: p.studentId, studentName: p.studentName,
      courseName: p.courseName, amountPending: p.amountPending, overdueCount: p.overdueCount
    }))
  });
});

module.exports = router;
module.exports.computeProfile = computeProfile;
module.exports.sweepOverdue = sweepOverdue;
