const jwt = require('jsonwebtoken');
const { permissionsFor, hasPermission } = require('../lib/permissions');

// In a real deployment this MUST come from an environment variable / secrets
// manager. It is set here only so the demo runs out of the box.
const JWT_SECRET = process.env.JWT_SECRET || 'byte-morphix-demo-secret-change-me';

const STAFF_ROLES = [
  'super_admin', 'admissions_manager', 'counsellor', 'academic_manager',
  'trainer', 'placement_manager', 'finance', 'content_manager'
];

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });
}

function decode(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

/**
 * Attaches req.user for any valid token. Roles listed as arguments are
 * allowed through; passing none allows any authenticated user.
 * `'staff'` is shorthand for "any admin-panel role".
 */
function requireAuth(...allowedRoles) {
  return (req, res, next) => {
    const decoded = decode(req);
    if (!decoded) {
      return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
    }

    const expanded = [];
    allowedRoles.forEach(r => {
      if (r === 'staff') expanded.push(...STAFF_ROLES);
      else if (r === 'admin') expanded.push(...STAFF_ROLES); // legacy callers
      else expanded.push(r);
    });

    if (expanded.length && !expanded.includes(decoded.role)) {
      return res.status(403).json({ error: 'You do not have permission to access this resource.' });
    }

    decoded.permissions = decoded.permissions || permissionsFor(decoded.role);
    req.user = decoded;
    next();
  };
}

/**
 * Fine-grained gate. A Counsellor hitting a Finance endpoint gets a 403 here
 * even though both are valid staff logins.
 */
function requirePerm(...permissions) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    const ok = permissions.some(p => hasPermission(req.user, p));
    if (!ok) {
      return res.status(403).json({
        error: `Your role (${req.user.role}) does not have access to this section.`,
        requiredPermission: permissions[0]
      });
    }
    next();
  };
}

/**
 * Course-level scoping.
 *
 * A mentor or trainer attached to Digital Marketing must not be able to read
 * or touch anything belonging to another course. Super Admin and any staff
 * account with no course restriction (courseIds empty) see everything.
 *
 * Sets req.scope = { all: bool, courseIds: [...] } for routes to filter with.
 */
function attachCourseScope(req, res, next) {
  const user = req.user || {};
  const courseIds = Array.isArray(user.courseIds) ? user.courseIds : [];
  const unrestricted = user.role === 'super_admin' || courseIds.length === 0;

  req.scope = {
    all: unrestricted,
    courseIds,
    // Convenience predicate used all over the academics/finance routes.
    allows(courseId) {
      if (this.all) return true;
      if (!courseId) return false;
      return this.courseIds.includes(courseId);
    }
  };
  next();
}

/** 403s a write that targets a course outside the user's scope. */
function assertCourseAccess(req, res, courseId, thing = 'record') {
  if (req.scope && req.scope.allows(courseId)) return true;
  res.status(403).json({
    error: `You are only assigned to specific courses, so you can't access this ${thing}.`,
    scopedCourseIds: req.scope ? req.scope.courseIds : []
  });
  return false;
}

module.exports = {
  signToken,
  requireAuth,
  requirePerm,
  attachCourseScope,
  assertCourseAccess,
  JWT_SECRET,
  STAFF_ROLES
};
