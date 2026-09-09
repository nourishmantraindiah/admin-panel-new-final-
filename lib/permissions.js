/**
 * Permission strings are `module.action`. Routes ask for the exact string;
 * the front end uses the same list to decide which nav items to render, so
 * a hidden tab and a blocked API call always agree with each other.
 */

const ALL_PERMISSIONS = [
  'overview.read',
  'content.read', 'content.write',
  'code.read', 'code.write',
  'leads.read', 'leads.write',
  'webinar.read', 'webinar.write',
  'students.read', 'students.write',
  'mentors.read', 'mentors.write',
  'employers.read', 'employers.write',
  'courses.read', 'courses.write',
  'batches.read', 'batches.write',
  'classes.read', 'classes.write',
  'attendance.read', 'attendance.write',
  'assignments.read', 'assignments.write',
  'assessments.read', 'assessments.write',
  'certificates.read', 'certificates.write',
  'fees.read', 'fees.write',
  'payments.read', 'payments.write',
  'invoices.read', 'invoices.write',
  'placement.read', 'placement.write',
  'repository.read', 'repository.write', 'repository.verify', 'repository.download',
  'queries.read', 'queries.write',
  'disputes.read', 'disputes.write',
  'forms.read', 'forms.write',
  'notifications.read', 'notifications.broadcast',
  'audit.read',
  'settings.read', 'settings.write',
  'staff.read', 'staff.write'
];

const ROLES = {
  super_admin: {
    label: 'Super Admin',
    description: 'Full access to every module, including staff, settings and audit logs.',
    permissions: ['*']
  },
  admissions_manager: {
    label: 'Admissions Manager',
    description: 'Leads, applications, counselling, student records and payments.',
    permissions: [
      'overview.read',
      'leads.read', 'leads.write',
      'forms.read', 'forms.write',
      'students.read', 'students.write',
      'courses.read', 'batches.read',
      'fees.read', 'payments.read', 'payments.write', 'invoices.read',
      'repository.read', 'repository.write', 'repository.download',
      'queries.read', 'queries.write',
      'webinar.read',
      'notifications.read'
    ]
  },
  counsellor: {
    label: 'Counsellor',
    description: 'Leads, follow-ups and applications only.',
    permissions: [
      'overview.read',
      'leads.read', 'leads.write',
      'forms.read', 'forms.write',
      'queries.read', 'queries.write',
      'students.read',
      'courses.read',
      'notifications.read'
    ]
  },
  academic_manager: {
    label: 'Academic Manager',
    description: 'Courses, curriculum, batches, attendance and assignments.',
    permissions: [
      'overview.read',
      'courses.read', 'courses.write',
      'batches.read', 'batches.write',
      'classes.read', 'classes.write',
      'attendance.read', 'attendance.write',
      'assignments.read', 'assignments.write',
      'assessments.read', 'assessments.write',
      'certificates.read', 'certificates.write',
      'students.read', 'students.write',
      'mentors.read', 'mentors.write',
      'disputes.read', 'disputes.write',
      'queries.read',
      'notifications.read'
    ]
  },
  trainer: {
    label: 'Trainer',
    description: 'Their own classes, attendance, assignments and assessments.',
    permissions: [
      'overview.read',
      'classes.read', 'classes.write',
      'attendance.read', 'attendance.write',
      'assignments.read', 'assignments.write',
      'assessments.read', 'assessments.write',
      'students.read',
      'batches.read', 'courses.read',
      'notifications.read'
    ]
  },
  placement_manager: {
    label: 'Placement Manager',
    description: 'Students, companies, jobs, interviews and offers.',
    permissions: [
      'overview.read',
      'students.read',
      'placement.read', 'placement.write',
      'employers.read', 'employers.write',
      'courses.read', 'batches.read',
      'repository.read', 'repository.download',
      'queries.read',
      'notifications.read'
    ]
  },
  finance: {
    label: 'Finance',
    description: 'Fees, payments, invoices and financial reports.',
    permissions: [
      'overview.read',
      'fees.read', 'fees.write',
      'payments.read', 'payments.write',
      'invoices.read', 'invoices.write',
      'students.read',
      'courses.read', 'batches.read',
      'disputes.read', 'disputes.write',
      'settings.read',
      'notifications.read'
    ]
  },
  content_manager: {
    label: 'Content Manager',
    description: 'Website content, blogs, webinars and testimonials.',
    permissions: [
      'overview.read',
      'content.read', 'content.write',
      'code.read', 'code.write',
      'webinar.read', 'webinar.write',
      'forms.read',
      'notifications.read'
    ]
  }
};

function permissionsFor(role) {
  const def = ROLES[role];
  if (!def) return [];
  if (def.permissions.includes('*')) return ALL_PERMISSIONS.slice();
  return def.permissions.slice();
}

function hasPermission(user, permission) {
  if (!user) return false;
  const list = user.permissions || permissionsFor(user.role);
  return list.includes('*') || list.includes(permission);
}

module.exports = { ROLES, ALL_PERMISSIONS, permissionsFor, hasPermission };
