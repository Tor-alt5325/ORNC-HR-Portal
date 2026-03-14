const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { getDatabase } = require('../config/database');
const { generateToken, authenticateToken, requireAdmin } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;
    const db = getDatabase();

    const user = db.prepare(`
      SELECT u.*, l.city as location_city, c.name as company_name
      FROM users u
      LEFT JOIN locations l ON u.location_id = l.id
      LEFT JOIN companies c ON l.company_id = c.id
      WHERE u.email = ? AND u.is_active = 1
    `).get(email);

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'Ungültige Anmeldedaten.' });
    }

    const token = generateToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role,
        location_id: user.location_id,
        location_city: user.location_city,
        company_name: user.company_name
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get('/me', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const user = db.prepare(`
      SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.location_id,
             l.city as location_city, c.name as company_name
      FROM users u
      LEFT JOIN locations l ON u.location_id = l.id
      LEFT JOIN companies c ON l.company_id = c.id
      WHERE u.id = ?
    `).get(req.user.id);
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/users - Create user (admin only)
router.post('/users', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { email, password, first_name, last_name, role, location_id } = req.body;
    const db = getDatabase();
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare(
      'INSERT INTO users (email, password_hash, first_name, last_name, role, location_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(email, hash, first_name, last_name, role, location_id || null);
    res.status(201).json({ id: result.lastInsertRowid, message: 'Benutzer erstellt.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/users - List users (admin only)
router.get('/users', authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const users = db.prepare(`
      SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.location_id, u.is_active,
             l.city as location_city, c.name as company_name
      FROM users u
      LEFT JOIN locations l ON u.location_id = l.id
      LEFT JOIN companies c ON l.company_id = c.id
      ORDER BY u.role, u.last_name
    `).all();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
