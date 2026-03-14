const jwt = require('jsonwebtoken');
const { getDatabase } = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'ornc-hr-portal-dev-secret';

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, location_id: user.location_id },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Zugang verweigert. Kein Token vorhanden.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Ungültiges oder abgelaufenes Token.' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Nur Administratoren haben Zugriff auf diese Funktion.' });
  }
  next();
}

function requireBranchManagerOrAdmin(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'branch_manager') {
    return res.status(403).json({ error: 'Zugriff verweigert.' });
  }
  next();
}

// Check if branch manager has access to specific location
function requireLocationAccess(req, res, next) {
  if (req.user.role === 'admin') return next();

  const locationId = parseInt(req.params.locationId || req.body.location_id || req.query.location_id);
  if (locationId && req.user.location_id !== locationId) {
    return res.status(403).json({ error: 'Kein Zugriff auf diesen Standort.' });
  }
  next();
}

module.exports = {
  generateToken,
  authenticateToken,
  requireAdmin,
  requireBranchManagerOrAdmin,
  requireLocationAccess,
  JWT_SECRET
};
