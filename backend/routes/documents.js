const express = require('express');
const router = express.Router();
const { getDatabase } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { generateTerminationPDF, generateAmendmentPDF } = require('../services/contractService');

// GET /api/documents/templates
router.get('/templates', authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const templates = db.prepare('SELECT * FROM document_templates WHERE is_active = 1 ORDER BY type, name').all();
    res.json(templates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/documents/templates
router.post('/templates', authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const { name, type, content_template, variables } = req.body;
    const result = db.prepare(
      'INSERT INTO document_templates (name, type, content_template, variables) VALUES (?, ?, ?, ?)'
    ).run(name, type, content_template, JSON.stringify(variables || []));
    res.status(201).json({ id: result.lastInsertRowid, message: 'Vorlage erstellt.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/documents/generate/termination/:employeeId
router.post('/generate/termination/:employeeId', authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const employee = db.prepare(`
      SELECT e.*, c.name as company_name, l.city as location_city
      FROM employees e
      JOIN companies c ON e.company_id = c.id
      JOIN locations l ON e.location_id = l.id
      WHERE e.id = ?
    `).get(req.params.employeeId);

    if (!employee) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden.' });
    }

    // Calculate termination date
    const today = new Date();
    const probationEnd = new Date(employee.probation_end_date);
    let terminationDate;
    let noticePeriod;

    if (req.body.termination_date) {
      terminationDate = new Date(req.body.termination_date);
      noticePeriod = 'Benutzerdefiniert';
    } else if (today < probationEnd) {
      terminationDate = new Date(today);
      terminationDate.setDate(terminationDate.getDate() + 14);
      noticePeriod = '2 Wochen (Probezeit)';
    } else {
      // Calculate based on tenure
      const startDate = new Date(employee.start_date);
      const yearsEmployed = (today - startDate) / (365.25 * 24 * 60 * 60 * 1000);

      terminationDate = new Date(today);
      if (yearsEmployed < 2) {
        terminationDate.setDate(terminationDate.getDate() + 28);
        noticePeriod = '4 Wochen zum 15. oder Monatsende';
      } else if (yearsEmployed < 5) {
        terminationDate.setMonth(terminationDate.getMonth() + 1);
        noticePeriod = '1 Monat zum Monatsende';
      } else if (yearsEmployed < 8) {
        terminationDate.setMonth(terminationDate.getMonth() + 2);
        noticePeriod = '2 Monate zum Monatsende';
      } else if (yearsEmployed < 10) {
        terminationDate.setMonth(terminationDate.getMonth() + 3);
        noticePeriod = '3 Monate zum Monatsende';
      } else {
        terminationDate.setMonth(terminationDate.getMonth() + 4);
        noticePeriod = '4 Monate zum Monatsende';
      }
      // Adjust to end of month
      terminationDate.setMonth(terminationDate.getMonth() + 1, 0);
    }

    const pdfPath = generateTerminationPDF({
      employee,
      termination_date: terminationDate.toISOString().split('T')[0],
      reason: req.body.reason || 'ordentliche Kündigung',
      notice_period: noticePeriod
    });

    const result = db.prepare(`
      INSERT INTO documents (employee_id, type, title, file_path, status, created_by)
      VALUES (?, 'termination', ?, ?, 'draft', ?)
    `).run(
      employee.id,
      `Kündigung - ${employee.first_name} ${employee.last_name}`,
      pdfPath,
      req.user.id
    );

    res.status(201).json({
      document_id: result.lastInsertRowid,
      termination_date: terminationDate.toISOString().split('T')[0],
      notice_period: noticePeriod,
      in_probation: today < probationEnd,
      pdf_path: pdfPath,
      message: 'Kündigungsschreiben erstellt.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/documents/generate/amendment/:employeeId
router.post('/generate/amendment/:employeeId', authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const employee = db.prepare(`
      SELECT e.*, c.name as company_name, l.city as location_city
      FROM employees e
      JOIN companies c ON e.company_id = c.id
      JOIN locations l ON e.location_id = l.id
      WHERE e.id = ?
    `).get(req.params.employeeId);

    if (!employee) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden.' });
    }

    const { changes, effective_date } = req.body;
    const pdfPath = generateAmendmentPDF({ employee, changes, effective_date });

    const result = db.prepare(`
      INSERT INTO documents (employee_id, type, title, file_path, status, created_by)
      VALUES (?, 'amendment', ?, ?, 'draft', ?)
    `).run(
      employee.id,
      `Nachtrag - ${employee.first_name} ${employee.last_name}`,
      pdfPath,
      req.user.id
    );

    res.status(201).json({
      document_id: result.lastInsertRowid,
      pdf_path: pdfPath,
      message: 'Nachtrag zum Arbeitsvertrag erstellt.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/documents/employee/:employeeId
router.get('/employee/:employeeId', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const documents = db.prepare(`
      SELECT d.*, u.first_name as created_by_name
      FROM documents d
      LEFT JOIN users u ON d.created_by = u.id
      WHERE d.employee_id = ?
      ORDER BY d.created_at DESC
    `).all(req.params.employeeId);
    res.json(documents);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
