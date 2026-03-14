const express = require('express');
const router = express.Router();
const { getDatabase } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

/*
 * PERSONIO API INTEGRATION (Prepared Interface)
 *
 * This module prepares the bidirectional integration with Personio.
 * Once API credentials are configured, these endpoints will:
 * 1. Push employee data TO Personio (create/update)
 * 2. Pull employee data FROM Personio (sync)
 * 3. Push bonus data TO Personio
 *
 * Personio API Docs: https://developer.personio.de/reference
 */

// Mock Personio service (replace with actual API calls)
const PersonioService = {
  async pushEmployee(employee) {
    // TODO: Implement actual Personio API call
    // POST https://api.personio.de/v1/company/employees
    console.log('[Personio] Would push employee:', employee.first_name, employee.last_name);
    return { personio_id: `mock-${employee.id}`, success: true };
  },

  async pullEmployee(personioId) {
    // TODO: Implement actual Personio API call
    // GET https://api.personio.de/v1/company/employees/{id}
    console.log('[Personio] Would pull employee:', personioId);
    return null;
  },

  async pushBonus(employeePersonioId, bonusData) {
    // TODO: Implement actual Personio API call
    console.log('[Personio] Would push bonus for:', employeePersonioId, bonusData);
    return { success: true };
  },

  async syncAll() {
    // TODO: Full bidirectional sync
    console.log('[Personio] Would perform full sync');
    return { synced: 0, errors: [] };
  }
};

// POST /api/personio/push-employee/:employeeId
router.post('/push-employee/:employeeId', authenticateToken, requireAdmin, async (req, res) => {
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
    `).get(req.params.employeeId);

    if (!employee) {
      return res.status(404).json({ error: 'Mitarbeiter nicht gefunden.' });
    }

    if (!process.env.PERSONIO_CLIENT_ID) {
      return res.json({
        message: 'Personio-Integration ist vorbereitet, aber noch nicht konfiguriert. Bitte API-Credentials in .env eintragen.',
        mock: true,
        employee_data: {
          first_name: employee.first_name,
          last_name: employee.last_name,
          email: employee.email,
          position: employee.profession_name,
          department: employee.company_name,
          office: employee.location_city,
          hire_date: employee.start_date,
          weekly_hours: employee.weekly_hours
        }
      });
    }

    const result = await PersonioService.pushEmployee(employee);
    db.prepare('UPDATE employees SET personio_id = ?, personio_synced_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(result.personio_id, employee.id);

    res.json({ message: 'Mitarbeiter an Personio übertragen.', personio_id: result.personio_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/personio/push-bonus/:evaluationId
router.post('/push-bonus/:evaluationId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const db = getDatabase();
    const evaluation = db.prepare(`
      SELECT be.*, e.personio_id, e.first_name, e.last_name
      FROM bonus_evaluations be
      JOIN employees e ON be.employee_id = e.id
      WHERE be.id = ? AND be.status = 'approved'
    `).get(req.params.evaluationId);

    if (!evaluation) {
      return res.status(404).json({ error: 'Genehmigte Bewertung nicht gefunden.' });
    }

    if (!process.env.PERSONIO_CLIENT_ID) {
      return res.json({
        message: 'Personio-Integration vorbereitet, aber noch nicht konfiguriert.',
        mock: true,
        bonus_data: {
          employee: `${evaluation.first_name} ${evaluation.last_name}`,
          month: evaluation.month,
          year: evaluation.year,
          bonus_amount: evaluation.bonus_amount
        }
      });
    }

    await PersonioService.pushBonus(evaluation.personio_id, {
      amount: evaluation.bonus_amount,
      month: evaluation.month,
      year: evaluation.year,
      type: 'performance_bonus'
    });

    db.prepare('UPDATE bonus_evaluations SET status = ?, personio_synced_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('synced_personio', req.params.evaluationId);

    res.json({ message: 'Bonus an Personio übertragen.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/personio/sync
router.post('/sync', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!process.env.PERSONIO_CLIENT_ID) {
      return res.json({
        message: 'Personio-Integration vorbereitet. Bitte API-Credentials konfigurieren.',
        mock: true
      });
    }

    const result = await PersonioService.syncAll();
    res.json({ message: 'Synchronisation abgeschlossen.', ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
