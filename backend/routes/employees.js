const express = require('express');
const router = express.Router();
const { getDatabase } = require('../config/database');
const { authenticateToken, requireAdmin, requireBranchManagerOrAdmin } = require('../middleware/auth');

// GET /api/employees - List employees
router.get('/', authenticateToken, requireBranchManagerOrAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const { status, location_id, company_id, search } = req.query;

    let query = `
      SELECT e.*, c.name as company_name, l.city as location_city,
             p.name_de as profession_name, hi.name as health_insurance_name
      FROM employees e
      JOIN companies c ON e.company_id = c.id
      JOIN locations l ON e.location_id = l.id
      JOIN professions p ON e.profession_id = p.id
      LEFT JOIN health_insurances hi ON e.health_insurance_id = hi.id
      WHERE 1=1
    `;
    const params = [];

    // Branch managers can only see their location
    if (req.user.role === 'branch_manager') {
      query += ' AND e.location_id = ?';
      params.push(req.user.location_id);
    }

    if (status) { query += ' AND e.status = ?'; params.push(status); }
    if (location_id) { query += ' AND e.location_id = ?'; params.push(location_id); }
    if (company_id) { query += ' AND e.company_id = ?'; params.push(company_id); }
    if (search) {
      query += ' AND (e.first_name LIKE ? OR e.last_name LIKE ? OR e.email LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY e.last_name, e.first_name';
    const employees = db.prepare(query).all(...params);
    res.json(employees);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/employees/:id
router.get('/:id', authenticateToken, requireBranchManagerOrAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const employee = db.prepare(`
      SELECT e.*, c.name as company_name, l.city as location_city,
             p.name_de as profession_name, p.name_en as profession_name_en,
             hi.name as health_insurance_name
      FROM employees e
      JOIN companies c ON e.company_id = c.id
      JOIN locations l ON e.location_id = l.id
      JOIN professions p ON e.profession_id = p.id
      LEFT JOIN health_insurances hi ON e.health_insurance_id = hi.id
      WHERE e.id = ?
    `).get(req.params.id);

    if (!employee) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden.' });
    }

    // Check location access for branch managers
    if (req.user.role === 'branch_manager' && employee.location_id !== req.user.location_id) {
      return res.status(403).json({ error: 'Kein Zugriff auf diesen Mitarbeiter.' });
    }

    // Get children
    const children = db.prepare('SELECT * FROM children WHERE employee_id = ?').all(employee.id);

    // Get contracts
    const contracts = db.prepare('SELECT * FROM contracts WHERE employee_id = ? ORDER BY created_at DESC').all(employee.id);

    // Get documents
    const documents = db.prepare('SELECT * FROM documents WHERE employee_id = ? ORDER BY created_at DESC').all(employee.id);

    res.json({ ...employee, children, contracts, documents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/employees/:id
router.put('/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const data = req.body;
    const fields = Object.keys(data).filter(k => k !== 'id').map(k => `${k} = ?`).join(', ');
    const values = Object.keys(data).filter(k => k !== 'id').map(k => data[k]);

    if (fields.length === 0) {
      return res.status(400).json({ error: 'Keine Daten zum Aktualisieren.' });
    }

    db.prepare(`UPDATE employees SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(...values, req.params.id);

    res.json({ message: 'Mitarbeiter aktualisiert.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/employees/:id/terminate
router.post('/:id/terminate', authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);

    if (!employee) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden.' });
    }

    const { termination_date, termination_reason } = req.body;

    // Calculate notice period
    let calculatedDate = termination_date;
    if (!calculatedDate) {
      const today = new Date();
      const startDate = new Date(employee.start_date);
      const probationEnd = new Date(employee.probation_end_date);

      if (today < probationEnd) {
        // In probation: 2 weeks notice
        calculatedDate = new Date(today);
        calculatedDate.setDate(calculatedDate.getDate() + 14);
      } else {
        // After probation: legal notice period (4 weeks to end of month)
        calculatedDate = new Date(today);
        calculatedDate.setDate(calculatedDate.getDate() + 28);
        // Move to end of month
        calculatedDate.setMonth(calculatedDate.getMonth() + 1, 0);
      }
      calculatedDate = calculatedDate.toISOString().split('T')[0];
    }

    db.prepare(`
      UPDATE employees SET status = 'terminated', termination_date = ?, termination_reason = ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(calculatedDate, termination_reason, req.params.id);

    res.json({
      message: 'Mitarbeiter gekündigt.',
      termination_date: calculatedDate,
      in_probation: new Date() < new Date(employee.probation_end_date)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/employees/:id/payroll-data
router.get('/:id/payroll-data', authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const employee = db.prepare(`
      SELECT e.*, c.name as company_name, l.city as location_city,
             p.name_de as profession_name, hi.name as health_insurance_name
      FROM employees e
      JOIN companies c ON e.company_id = c.id
      JOIN locations l ON e.location_id = l.id
      JOIN professions p ON e.profession_id = p.id
      LEFT JOIN health_insurances hi ON e.health_insurance_id = hi.id
      WHERE e.id = ?
    `).get(req.params.id);

    if (!employee) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden.' });
    }

    res.json({
      employee_name: `${employee.first_name} ${employee.last_name}`,
      company: employee.company_name,
      location: employee.location_city,
      profession: employee.profession_name,
      employment_type: employee.employment_type,
      start_date: employee.start_date,
      weekly_hours: employee.weekly_hours,
      hourly_rate: employee.hourly_rate,
      monthly_salary: employee.monthly_salary,
      tax_id: employee.tax_id,
      tax_class: employee.tax_class,
      social_security_number: employee.social_security_number,
      health_insurance: employee.health_insurance_name,
      beitragsgruppenschluessel: employee.beitragsgruppenschluessel,
      personenschluessel: employee.personenschluessel,
      has_church_tax: employee.has_church_tax,
      iban: employee.iban,
      vacation_days: employee.vacation_days
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
