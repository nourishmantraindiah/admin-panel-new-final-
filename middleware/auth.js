const jwt = require('jsonwebtoken');

// In a real deployment this MUST come from an environment variable / secrets manager.
// It is set here only so the demo runs out of the box.
const JWT_SECRET = process.env.JWT_SECRET || 'byte-morphix-demo-secret-change-me';

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });
}

function requireAuth(...allowedRoles) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing or invalid authorization token.' });

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (allowedRoles.length && !allowedRoles.includes(decoded.role)) {
        return res.status(403).json({ error: 'You do not have permission to access this resource.' });
      }
      req.user = decoded;
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
    }
  };
}

module.exports = { signToken, requireAuth, JWT_SECRET };
