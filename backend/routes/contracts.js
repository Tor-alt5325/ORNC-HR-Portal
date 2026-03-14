const express = require('express');
const router = express.Router();
const { getDatabase } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { generateContractPDF } = require('../services/contractService');

// POST /api/contracts/generate/:employeeId
router.post('/generate/:employeeId', authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const employee = db.prepare(`
      SELECT e.*, c.name as company_name, c.short_name as company_short,
             l.city as location_city, l.address as location_address,
             p.name_de as profession_name, p.hourly_rate as base_hourly_rate
      FROM employees e
      JOIN companies c ON e.company_id = c.id
      JOIN locations l ON e.location_id = l.id
      JOIN professions p ON e.profession_id = p.id
      WHERE e.id = ?
    `).get(req.params.employeeId);

    if (!employee) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden.' });
    }

    // Generate contract
    const contractData = {
      employee,
      contract_type: employee.employment_type,
      start_date: employee.start_date,
      weekly_hours: employee.weekly_hours,
      hourly_rate: employee.hourly_rate,
      monthly_salary: employee.monthly_salary,
      vacation_days: employee.vacation_days,
      probation_months: 6
    };

    const pdfPath = generateContractPDF(contractData);

    // Save contract to DB
    const result = db.prepare(`
      INSERT INTO contracts (employee_id, contract_type, template_name, start_date,
        weekly_hours, hourly_rate, monthly_salary, vacation_days, probation_months,
        notice_period, pdf_path, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
    `).run(
      employee.id, employee.employment_type,
      `Arbeitsvertrag_${employee.employment_type}`,
      employee.start_date, employee.weekly_hours, employee.hourly_rate,
      employee.monthly_salary, employee.vacation_days, 6,
      employee.employment_type === 'minijob' ? '4 Wochen' : '4 Wochen zum Monatsende',
      pdfPath
    );

    // Update invitation status if exists
    if (employee.invitation_id) {
      db.prepare('UPDATE questionnaire_invitations SET status = ? WHERE id = ?')
        .run('contract_created', employee.invitation_id);
    }

    // If minijob, create RV exemption document
    if (employee.employment_type === 'minijob') {
      const { generateRVExemptionPDF } = require('../services/contractService');
      const rvPath = generateRVExemptionPDF(employee);
      db.prepare(`
        INSERT INTO documents (employee_id, type, title, file_path, status, created_by)
        VALUES (?, 'rv_exemption', 'Antrag auf Befreiung von der Rentenversicherungspflicht', ?, 'draft', ?)
      `).run(employee.id, rvPath, req.user.id);
    }

    res.status(201).json({
      contract_id: result.lastInsertRowid,
      pdf_path: pdfPath,
      message: 'Arbeitsvertrag erstellt.'
    });
  } catch (err) {
    console.error('Contract generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/contracts
router.get('/', authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const contracts = db.prepare(`
      SELECT ct.*, e.first_name, e.last_name, e.email,
             c.name as company_name, l.city as location_city
      FROM contracts ct
      JOIN employees e ON ct.employee_id = e.id
      JOIN companies c ON e.company_id = c.id
      JOIN locations l ON e.location_id = l.id
      ORDER BY ct.created_at DESC
    `).all();
    res.json(contracts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/contracts/:id/status
router.put('/:id/status', authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const { status } = req.body;
    db.prepare('UPDATE contracts SET status = ? WHERE id = ?').run(status, req.params.id);
    if (status === 'signed') {
      db.prepare('UPDATE contracts SET signed_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
    }
    res.json({ message: 'Vertragsstatus aktualisiert.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
