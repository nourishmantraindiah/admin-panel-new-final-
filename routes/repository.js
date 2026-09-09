const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const router = express.Router();

const { readDB, writeDB, newId } = require('../lib/db');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { logAudit } = require('../lib/audit');
const { notify } = require('../lib/notify');

/**
 * Identity documents are deliberately stored OUTSIDE the folder Express
 * serves statically. Nothing here is reachable by URL guessing — every read
 * goes through the authenticated /file route below, which also audits it.
 */
const STORAGE_DIR = path.join(__dirname, '..', 'storage', 'documents');
fs.mkdirSync(STORAGE_DIR, { recursive: true });

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];
const MAX_FILE_BYTES = 8 * 1024 * 1024;

const DOC_TYPES = {
  aadhaar:       { label: 'Aadhaar Card', sensitive: true,  numberLength: 12 },
  pan:           { label: 'PAN Card', sensitive: true,  numberLength: 10 },
  dl:            { label: "Driving Licence", sensitive: true },
  passport:      { label: 'Passport', sensitive: true },
  voter_id:      { label: 'Voter ID', sensitive: true },
  student_id:    { label: 'Student ID Card', sensitive: false },
  mentor_id:     { label: 'Mentor ID Card', sensitive: false },
  employee_id:   { label: 'Employee ID Card', sensitive: false },
  photo:         { label: 'Passport Photo', sensitive: false },
  marksheet:     { label: 'Marksheet', sensitive: false },
  degree:        { label: 'Degree / Diploma', sensitive: false },
  resume:        { label: 'Resume / CV', sensitive: false },
  offer_letter:  { label: 'Offer Letter', sensitive: false },
  bank_proof:    { label: 'Bank Proof / Cancelled Cheque', sensitive: true },
  agreement:     { label: 'Signed Agreement', sensitive: false },
  other:         { label: 'Other Document', sensitive: false }
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, STORAGE_DIR),
  // Random filename: the original name never touches the filesystem, so a
  // file called "../../db.json" or "aadhaar-of-priya.jpg" can't leak either
  // a path or personal information through the folder listing.
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase().slice(0, 10);
    cb(null, `${crypto.randomBytes(20).toString('hex')}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      return cb(new Error('Only JPG, PNG, WEBP, HEIC or PDF files are accepted.'));
    }
    cb(null, true);
  }
});

router.use(requireAuth('staff'));

const nowISO = () => new Date().toISOString();

/**
 * Government ID numbers are NOT stored in full.
 *
 * For Aadhaar in particular, holding full numbers in an ordinary application
 * database creates real legal exposure under the Aadhaar Act and the DPDP
 * Act. What's kept is enough to match and verify a document — the last four
 * digits for human recognition, and a salted hash so duplicates can still be
 * detected — and nothing more. The scan itself is the record of truth.
 */
const NUMBER_SALT = process.env.DOC_NUMBER_SALT || 'byte-morphix-doc-salt-change-me';

function maskNumber(raw, docType) {
  if (!raw) return { last4: '', hash: '', masked: '' };
  const clean = String(raw).replace(/\s+/g, '');
  const last4 = clean.slice(-4);
  const hash = crypto.createHmac('sha256', NUMBER_SALT).update(docType + ':' + clean).digest('hex');
  const maskedBody = '•'.repeat(Math.max(clean.length - 4, 0));
  return { last4, hash, masked: `${maskedBody}${last4}` };
}

function ownerLookup(db, ownerType, ownerId) {
  const map = { student: db.students, mentor: db.mentors, employer: db.employers, staff: db.adminUsers };
  const list = map[ownerType];
  if (!list) return null;
  return list.find(o => o.id === ownerId) || null;
}

function publicDoc(d) {
  const { storedName, numberHash, ...safe } = d;
  return safe;
}

/* ------------------------------------------------------------ Doc metadata */

router.get('/types', (req, res) => {
  res.json(Object.entries(DOC_TYPES).map(([key, v]) => ({ key, ...v })));
});

/* ---------------------------------------------------------------- Listing */

router.get('/', requirePerm('repository.read'), (req, res) => {
  const db = readDB();
  const { ownerType, ownerId, docType, status, q } = req.query;

  let list = db.documents;
  if (ownerType) list = list.filter(d => d.ownerType === ownerType);
  if (ownerId) list = list.filter(d => d.ownerId === ownerId);
  if (docType) list = list.filter(d => d.docType === docType);
  if (status) list = list.filter(d => d.status === status);
  if (q) {
    const needle = String(q).toLowerCase();
    list = list.filter(d =>
      String(d.ownerName || '').toLowerCase().includes(needle) ||
      String(d.originalName || '').toLowerCase().includes(needle) ||
      String(d.numberLast4 || '').includes(needle)
    );
  }

  res.json(list.slice().reverse().map(publicDoc));
});

/** Everything on file for one person, grouped — the "their locker" view. */
router.get('/owner/:ownerType/:ownerId', requirePerm('repository.read'), (req, res) => {
  const db = readDB();
  const owner = ownerLookup(db, req.params.ownerType, req.params.ownerId);
  if (!owner) return res.status(404).json({ error: 'That person was not found.' });

  const docs = db.documents.filter(d => d.ownerType === req.params.ownerType && d.ownerId === req.params.ownerId);
  const required = req.params.ownerType === 'student'
    ? ['aadhaar', 'photo', 'marksheet']
    : ['aadhaar', 'pan', 'photo'];

  res.json({
    owner: { id: owner.id, name: owner.name, email: owner.email, type: req.params.ownerType },
    documents: docs.map(publicDoc),
    completeness: {
      required,
      present: required.filter(r => docs.some(d => d.docType === r)),
      missing: required.filter(r => !docs.some(d => d.docType === r)),
      verified: docs.filter(d => d.status === 'verified').length,
      pending: docs.filter(d => d.status === 'pending').length
    }
  });
});

/* ----------------------------------------------------------------- Upload */

router.post('/', requirePerm('repository.write'), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'A file is required.' });

  const db = readDB();
  const { ownerType, ownerId, docType, number, issuedOn, expiresOn, notes } = req.body;

  const cleanup = () => { try { fs.unlinkSync(req.file.path); } catch (e) { /* already gone */ } };

  if (!DOC_TYPES[docType]) { cleanup(); return res.status(400).json({ error: 'Unknown document type.' }); }
  const owner = ownerLookup(db, ownerType, ownerId);
  if (!owner) { cleanup(); return res.status(404).json({ error: 'That person was not found.' }); }

  const { last4, hash, masked } = maskNumber(number, docType);

  // Same ID number already on file against someone else — worth flagging
  // rather than silently accepting a duplicate identity.
  const clash = hash && db.documents.find(d => d.numberHash === hash && d.ownerId !== ownerId);
  if (clash) {
    cleanup();
    return res.status(409).json({
      error: `That ${DOC_TYPES[docType].label} number is already on file against a different person (${clash.ownerName}). Check for a duplicate record before uploading.`
    });
  }

  const doc = {
    id: newId('doc'),
    ownerType, ownerId,
    ownerName: owner.name,
    docType,
    docLabel: DOC_TYPES[docType].label,
    sensitive: DOC_TYPES[docType].sensitive,
    numberLast4: last4,
    numberMasked: masked,
    numberHash: hash,
    originalName: (req.file.originalname || 'document').slice(0, 120),
    storedName: req.file.filename,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
    issuedOn: issuedOn || null,
    expiresOn: expiresOn || null,
    notes: notes || '',
    status: 'pending',                // pending | verified | rejected
    verifiedBy: null, verifiedAt: null, rejectionReason: '',
    uploadedBy: req.user.id,
    uploadedByName: req.user.name,
    uploadedAt: nowISO(),
    downloadCount: 0
  };

  db.documents.push(doc);

  notify(db, {
    event: 'document_uploaded',
    title: 'Document Uploaded',
    body: `${DOC_TYPES[docType].label} uploaded for ${owner.name} — awaiting verification.`,
    link: `#repository/${doc.id}`,
    audience: { userIds: [ownerId] },
    meta: { documentId: doc.id }
  });

  logAudit(db, req, {
    action: 'upload', entity: 'document', entityId: doc.id,
    label: `${owner.name} — ${DOC_TYPES[docType].label}`,
    meta: { ownerType, ownerId, docType, sizeBytes: doc.sizeBytes }
  });
  writeDB(db);
  res.status(201).json({ ok: true, document: publicDoc(doc) });
});

/* ------------------------------------------------------------- Verification */

router.put('/:id/verify', requirePerm('repository.verify'), (req, res) => {
  const db = readDB();
  const doc = db.documents.find(d => d.id === req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });

  const { status, reason } = req.body;
  if (!['verified', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'Status must be verified, rejected or pending.' });
  }

  const before = { status: doc.status };
  doc.status = status;
  doc.verifiedBy = req.user.id;
  doc.verifiedByName = req.user.name;
  doc.verifiedAt = nowISO();
  doc.rejectionReason = status === 'rejected' ? (reason || '') : '';

  notify(db, {
    event: 'document_uploaded',
    title: status === 'verified' ? 'Document Verified' : 'Document Needs Attention',
    body: status === 'verified'
      ? `Your ${doc.docLabel} has been verified.`
      : `Your ${doc.docLabel} was rejected.${reason ? ' Reason: ' + reason : ''} Please re-upload.`,
    audience: { userIds: [doc.ownerId] },
    respectSettings: false
  });

  logAudit(db, req, {
    action: 'verify', entity: 'document', entityId: doc.id,
    label: `${doc.ownerName} — ${doc.docLabel}`, before, after: { status, reason: doc.rejectionReason }
  });
  writeDB(db);
  res.json({ ok: true, document: publicDoc(doc) });
});

/* ------------------------------------------------------- Viewing the file */

/**
 * Every single view of an identity document is logged against the staff
 * member who opened it. If a scan of someone's Aadhaar ever leaks, this is
 * the record that says who had it and when.
 */
router.get('/:id/file', requirePerm('repository.download'), (req, res) => {
  const db = readDB();
  const doc = db.documents.find(d => d.id === req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });

  const full = path.join(STORAGE_DIR, doc.storedName);
  if (!full.startsWith(STORAGE_DIR) || !fs.existsSync(full)) {
    return res.status(404).json({ error: 'The stored file is missing.' });
  }

  doc.downloadCount = (doc.downloadCount || 0) + 1;
  doc.lastAccessedAt = nowISO();
  doc.lastAccessedBy = req.user.name;
  logAudit(db, req, {
    action: 'view_document', entity: 'document', entityId: doc.id,
    label: `${doc.ownerName} — ${doc.docLabel}`,
    meta: { sensitive: doc.sensitive }
  });
  writeDB(db);

  res.setHeader('Content-Type', doc.mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${doc.docType}-${doc.ownerName.replace(/[^a-z0-9]/gi, '_')}${path.extname(doc.storedName)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  fs.createReadStream(full).pipe(res);
});

/* ----------------------------------------------------------------- Delete */

router.delete('/:id', requirePerm('repository.write'), (req, res) => {
  const db = readDB();
  const doc = db.documents.find(d => d.id === req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });

  const full = path.join(STORAGE_DIR, doc.storedName);
  if (full.startsWith(STORAGE_DIR) && fs.existsSync(full)) fs.unlinkSync(full);

  db.documents = db.documents.filter(d => d.id !== doc.id);
  logAudit(db, req, {
    action: 'delete', entity: 'document', entityId: doc.id,
    label: `${doc.ownerName} — ${doc.docLabel}`,
    meta: { reason: req.body && req.body.reason ? req.body.reason : '' }
  });
  writeDB(db);
  res.json({ ok: true });
});

/* ------------------------------------------------------------- Repo summary */

router.get('/stats/summary', requirePerm('repository.read'), (req, res) => {
  const db = readDB();
  const docs = db.documents;
  const byType = {};
  docs.forEach(d => { byType[d.docLabel] = (byType[d.docLabel] || 0) + 1; });

  const soon = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  res.json({
    total: docs.length,
    pending: docs.filter(d => d.status === 'pending').length,
    verified: docs.filter(d => d.status === 'verified').length,
    rejected: docs.filter(d => d.status === 'rejected').length,
    sensitive: docs.filter(d => d.sensitive).length,
    expiringSoon: docs.filter(d => d.expiresOn && d.expiresOn <= soon).map(publicDoc),
    byType,
    studentsWithoutId: db.students
      .filter(s => !docs.some(d => d.ownerId === s.id && ['aadhaar', 'pan', 'passport', 'dl', 'voter_id'].includes(d.docType)))
      .map(s => ({ id: s.id, name: s.name, email: s.email })),
    mentorsWithoutId: db.mentors
      .filter(m => !docs.some(d => d.ownerId === m.id && ['aadhaar', 'pan', 'passport', 'dl', 'voter_id'].includes(d.docType)))
      .map(m => ({ id: m.id, name: m.name, email: m.email }))
  });
});

// Multer rejections (file too big, wrong type) should read like a normal
// validation message rather than a 500.
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'That file is over the 8 MB limit.' });
  }
  if (err) return res.status(400).json({ error: err.message || 'Upload failed.' });
  next();
});

module.exports = router;
module.exports.DOC_TYPES = DOC_TYPES;
