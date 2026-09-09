const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'db.json');

/**
 * Every collection the panel expects, with the default used when an older
 * db.json is loaded. Adding a key here is all that's needed to ship a new
 * module — ensureSchema() back-fills it on the next read.
 */
const SCHEMA = {
  content: {},
  settings: {},
  leads: [],
  webinarRegistrations: [],
  students: [],
  mentors: [],
  employers: [],
  candidatePool: {},
  adminUsers: [],

  // Academics
  courses: [],
  batches: [],
  classSessions: [],
  attendance: [],
  assignments: [],
  submissions: [],
  projects: [],
  assessments: [],
  assessmentResults: [],
  certificates: [],

  // Finance
  feeProfiles: [],
  payments: [],
  invoices: [],

  // Placement
  companies: [],
  jobs: [],
  applications: [],
  interviews: [],
  offers: [],

  // Document repository
  documents: [],

  // Support desk
  queries: [],
  disputes: [],
  formSubmissions: [],
  communications: [],

  // Platform
  notifications: [],
  pushSubscriptions: [],
  auditLogs: [],
  loginHistory: []
};

const DEFAULT_SETTINGS = {
  general: {
    companyName: 'Byte Morphix',
    legalName: '',
    logoUrl: '',
    supportEmail: 'support@bytemorphix.com',
    supportPhone: '',
    address: '',
    website: '',
    timezone: 'Asia/Kolkata',
    currency: 'INR'
  },
  payments: {
    gateway: 'razorpay',
    keyId: '',
    keySecretSet: false,
    bankName: '',
    accountName: '',
    accountNumberLast4: '',
    ifsc: '',
    upiId: '',
    gstin: '',
    gstPercent: 18,
    invoicePrefix: 'BM',
    nextInvoiceNumber: 1001,
    invoiceTerms: 'Fees once paid are non-refundable except as per the published refund policy.'
  },
  integrations: {
    metaLeadAds: { enabled: false, pageId: '', formIds: '', verifyToken: '' },
    googleAds: { enabled: false, customerId: '', conversionLabel: '' },
    googleAnalytics: { enabled: false, measurementId: '' },
    whatsapp: { enabled: false, provider: 'meta_cloud', phoneNumberId: '', tokenSet: false },
    email: { enabled: false, provider: 'smtp', host: '', port: 587, user: '', fromName: '', fromEmail: '', passwordSet: false },
    meeting: { enabled: false, provider: 'google_meet', accountEmail: '', tokenSet: false },
    crm: { enabled: false, provider: '', apiKeySet: false },
    sms: { enabled: false, provider: '', senderId: '', apiKeySet: false }
  },
  notifications: {
    emailEnabled: true,
    whatsappEnabled: false,
    smsEnabled: false,
    webPushEnabled: true,
    vapidPublicKey: '',
    vapidPrivateKey: '',
    // Which events fire a notification, and which roles receive them.
    events: {
      new_lead: { enabled: true, roles: ['super_admin', 'admissions_manager', 'counsellor'] },
      new_application: { enabled: true, roles: ['super_admin', 'admissions_manager', 'counsellor'] },
      enrollment: { enabled: true, roles: ['super_admin', 'admissions_manager', 'academic_manager'] },
      payment_received: { enabled: true, roles: ['super_admin', 'finance', 'admissions_manager'] },
      payment_overdue: { enabled: true, roles: ['super_admin', 'finance'] },
      assignment_submitted: { enabled: true, roles: ['super_admin', 'academic_manager', 'trainer'] },
      low_attendance: { enabled: true, roles: ['super_admin', 'academic_manager', 'trainer'] },
      student_placement: { enabled: true, roles: ['super_admin', 'placement_manager'] },
      webinar_registration: { enabled: true, roles: ['super_admin', 'content_manager', 'counsellor'] },
      new_query: { enabled: true, roles: ['super_admin', 'admissions_manager', 'counsellor'] },
      new_dispute: { enabled: true, roles: ['super_admin', 'finance', 'academic_manager'] },
      form_submission: { enabled: true, roles: ['super_admin', 'admissions_manager'] },
      document_uploaded: { enabled: true, roles: ['super_admin', 'admissions_manager'] },
      class_scheduled: { enabled: true, roles: ['super_admin', 'academic_manager'] }
    },
    lowAttendanceThreshold: 75,
    overdueGraceDays: 3
  }
};

function deepDefaults(target, defaults) {
  const out = target && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
  for (const [key, val] of Object.entries(defaults)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      out[key] = deepDefaults(out[key], val);
    } else if (out[key] === undefined) {
      out[key] = Array.isArray(val) ? val.slice() : val;
    }
  }
  return out;
}

function newId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

/**
 * Back-fill anything missing so an existing db.json keeps working after this
 * upgrade. Returns { db, changed } so the caller only writes when needed.
 */
function ensureSchema(db) {
  let changed = false;

  for (const [key, def] of Object.entries(SCHEMA)) {
    if (db[key] === undefined) {
      db[key] = Array.isArray(def) ? [] : {};
      changed = true;
    }
  }

  const withDefaults = deepDefaults(db.settings, DEFAULT_SETTINGS);
  if (JSON.stringify(withDefaults) !== JSON.stringify(db.settings)) {
    db.settings = withDefaults;
    changed = true;
  }

  // Existing admin accounts predate roles — promote them to super_admin so
  // nobody gets locked out of their own panel by the permissions upgrade.
  db.adminUsers.forEach(a => {
    if (!a.id) { a.id = newId('adm'); changed = true; }
    if (!a.role) { a.role = 'super_admin'; changed = true; }
    if (!a.name) { a.name = 'Admin'; changed = true; }
    if (a.active === undefined) { a.active = true; changed = true; }
    if (!Array.isArray(a.courseIds)) { a.courseIds = []; changed = true; }
  });

  // Seed the course catalogue from the marketing content the panel already
  // manages, so batches/fees/scoping have real course IDs on day one.
  if (!db.courses.length && Array.isArray(db.content && db.content.courses)) {
    db.courses = db.content.courses.map(c => ({
      id: c.id || newId('crs'),
      code: String(c.id || '').toUpperCase(),
      name: c.title || c.tag,
      description: c.blurb || '',
      fee: Number(c.fee) || 0,
      durationLabel: c.duration || '',
      totalWeeks: 20,
      curriculum: [],
      active: true,
      createdAt: new Date().toISOString()
    }));
    changed = true;
  }

  const courseIdFor = value => {
    if (!value) return null;
    const match = db.courses.find(c => c.id === value || c.name === value || c.code === value);
    return match ? match.id : null;
  };

  // Mentors used to carry a single `track` string. Course-level access control
  // needs a list, so mirror the track into courseIds on first load.
  db.mentors.forEach(m => {
    if (!Array.isArray(m.courseIds)) {
      const id = courseIdFor(m.track);
      m.courseIds = id ? [id] : [];
      changed = true;
    }
    if (m.status === undefined) { m.status = 'active'; changed = true; }
  });

  db.students.forEach(s => {
    if (!Array.isArray(s.courseIds)) {
      const id = courseIdFor(s.track);
      s.courseIds = id ? [id] : [];
      changed = true;
    }
    if (!s.personal) {
      s.personal = {
        phone: '', dob: '', gender: '', city: '', state: '', pincode: '', address: '',
        guardianName: '', guardianPhone: '', qualification: '', college: ''
      };
      changed = true;
    }
    if (s.status === undefined) { s.status = 'active'; changed = true; }
    if (s.batchId === undefined) { s.batchId = null; changed = true; }
    if (s.placementStatus === undefined) { s.placementStatus = 'not_ready'; changed = true; }
    if (!s.enrolledAt) { s.enrolledAt = new Date().toISOString(); changed = true; }
  });

  db.employers.forEach(e => {
    if (e.status === undefined) { e.status = 'active'; changed = true; }
  });

  return { db, changed };
}

function readDB() {
  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  const parsed = JSON.parse(raw);
  const { db, changed } = ensureSchema(parsed);
  if (changed) writeDB(db);
  return db;
}

function writeDB(data) {
  // Write to a temp file and rename — a crash mid-write would otherwise leave
  // a truncated db.json and take the whole panel down.
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, DB_PATH);
}

module.exports = { readDB, writeDB, newId, ensureSchema, DEFAULT_SETTINGS, DB_PATH };
