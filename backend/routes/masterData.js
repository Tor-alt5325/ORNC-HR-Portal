const express = require('express');
const router = express.Router();
const { getDatabase } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

// GET /api/master-data/companies
router.get('/companies', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const companies = db.prepare('SELECT * FROM companies ORDER BY name').all();
    res.json(companies);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/master-data/locations
router.get('/locations', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const { company_id } = req.query;
    let query = `
      SELECT l.*, c.name as company_name, c.short_name as company_short
      FROM locations l JOIN companies c ON l.company_id = c.id
    `;
    const params = [];
    if (company_id) {
      query += ' WHERE l.company_id = ?';
      params.push(company_id);
    }
    query += ' ORDER BY c.name, l.city';
    res.json(db.prepare(query).all(...params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/master-data/professions
router.get('/professions', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    res.json(db.prepare('SELECT * FROM professions ORDER BY name_de').all());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/master-data/health-insurances
router.get('/health-insurances', (req, res) => {
  try {
    const db = getDatabase();
    res.json(db.prepare('SELECT * FROM health_insurances WHERE is_active = 1 ORDER BY name').all());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/master-data/dashboard-stats
router.get('/dashboard-stats', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const locationFilter = req.user.role === 'branch_manager' ? 'AND e.location_id = ?' : '';
    const params = req.user.role === 'branch_manager' ? [req.user.location_id] : [];

    const totalEmployees = db.prepare(`SELECT COUNT(*) as count FROM employees e WHERE e.status = 'active' ${locationFilter}`).get(...params).count;
    const pendingQuestionnaires = db.prepare(`SELECT COUNT(*) as count FROM questionnaire_invitations WHERE status IN ('sent', 'opened')`).get().count;
    const draftContracts = db.prepare(`SELECT COUNT(*) as count FROM contracts WHERE status = 'draft'`).get().count;

    const employeesByType = db.prepare(`
      SELECT employment_type, COUNT(*) as count FROM employees e
      WHERE status = 'active' ${locationFilter} GROUP BY employment_type
    `).all(...params);

    const employeesByLocation = db.prepare(`
      SELECT l.city, COUNT(*) as count FROM employees e
      JOIN locations l ON e.location_id = l.id
      WHERE e.status = 'active' ${locationFilter} GROUP BY l.city
    `).all(...params);

    res.json({
      total_employees: totalEmployees,
      pending_questionnaires: pendingQuestionnaires,
      draft_contracts: draftContracts,
      employees_by_type: employeesByType,
      employees_by_location: employeesByLocation
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
