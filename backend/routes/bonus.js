const express = require('express');
const router = express.Router();
const { getDatabase } = require('../config/database');
const { authenticateToken, requireBranchManagerOrAdmin, requireAdmin } = require('../middleware/auth');

// Bonus thresholds
const BONUS_TIERS = [
  { min: 75, max: 100, percentage: 15 },
  { min: 45, max: 74.99, percentage: 7.5 },
  { min: 0, max: 44.99, percentage: 0 }
];

// GET /api/bonus/criteria
router.get('/criteria', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const criteria = db.prepare('SELECT * FROM bonus_criteria WHERE is_active = 1 ORDER BY sort_order').all();
    res.json(criteria);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bonus/evaluate
router.post('/evaluate', authenticateToken, requireBranchManagerOrAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const { employee_id, month, year, items } = req.body;

    // Verify employee
    const employee = db.prepare('SELECT * FROM employees WHERE id = ? AND status = ?').get(employee_id, 'active');
    if (!employee) {
      return res.status(404).json({ error: 'Aktiver Mitarbeiter nicht gefunden.' });
    }

    // Check location access for branch managers
    if (req.user.role === 'branch_manager' && employee.location_id !== req.user.location_id) {
      return res.status(403).json({ error: 'Kein Zugriff auf diesen Mitarbeiter.' });
    }

    // Calculate scores
    const criteria = db.prepare('SELECT * FROM bonus_criteria WHERE is_active = 1').all();
    const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0);
    let fulfilledWeight = 0;

    for (const item of items) {
      const criterion = criteria.find(c => c.id === item.criterion_id);
      if (criterion && item.fulfilled) {
        fulfilledWeight += criterion.weight;
      }
    }

    const percentage = totalWeight > 0 ? (fulfilledWeight / totalWeight) * 100 : 0;

    // Determine bonus tier
    const tier = BONUS_TIERS.find(t => percentage >= t.min && percentage <= t.max);
    const bonusPercentage = tier ? tier.percentage : 0;
    const bonusAmount = (employee.monthly_salary || 0) * (bonusPercentage / 100);

    // Upsert evaluation
    const existing = db.prepare(
      'SELECT id FROM bonus_evaluations WHERE employee_id = ? AND month = ? AND year = ?'
    ).get(employee_id, month, year);

    let evaluationId;
    if (existing) {
      db.prepare(`
        UPDATE bonus_evaluations SET total_score = ?, percentage = ?,
        bonus_percentage = ?, bonus_amount = ?, status = 'submitted',
        evaluator_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(fulfilledWeight, percentage, bonusPercentage, bonusAmount, req.user.id, existing.id);
      evaluationId = existing.id;

      // Delete old items
      db.prepare('DELETE FROM bonus_evaluation_items WHERE evaluation_id = ?').run(evaluationId);
    } else {
      const result = db.prepare(`
        INSERT INTO bonus_evaluations (employee_id, evaluator_id, month, year,
          total_score, percentage, bonus_percentage, bonus_amount, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted')
      `).run(employee_id, req.user.id, month, year, fulfilledWeight, percentage, bonusPercentage, bonusAmount);
      evaluationId = result.lastInsertRowid;
    }

    // Insert items
    const insertItem = db.prepare(
      'INSERT INTO bonus_evaluation_items (evaluation_id, criterion_id, fulfilled, note) VALUES (?, ?, ?, ?)'
    );
    for (const item of items) {
      insertItem.run(evaluationId, item.criterion_id, item.fulfilled ? 1 : 0, item.note || null);
    }

    res.json({
      evaluation_id: evaluationId,
      percentage: Math.round(percentage * 100) / 100,
      bonus_percentage: bonusPercentage,
      bonus_amount: Math.round(bonusAmount * 100) / 100,
      monthly_salary: employee.monthly_salary,
      message: `Bonus-Bewertung: ${percentage.toFixed(1)}% erfüllt → ${bonusPercentage}% Bonus = €${bonusAmount.toFixed(2)}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bonus/evaluations
router.get('/evaluations', authenticateToken, requireBranchManagerOrAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const { location_id, month, year } = req.query;
    const locId = req.user.role === 'branch_manager' ? req.user.location_id : location_id;

    let query = `
      SELECT be.*, e.first_name, e.last_name, e.monthly_salary,
             p.name_de as profession_name, u.first_name as evaluator_name
      FROM bonus_evaluations be
      JOIN employees e ON be.employee_id = e.id
      JOIN professions p ON e.profession_id = p.id
      LEFT JOIN users u ON be.evaluator_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (locId) { query += ' AND e.location_id = ?'; params.push(locId); }
    if (month) { query += ' AND be.month = ?'; params.push(month); }
    if (year) { query += ' AND be.year = ?'; params.push(year); }

    query += ' ORDER BY e.last_name, e.first_name';
    const evaluations = db.prepare(query).all(...params);
    res.json(evaluations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bonus/evaluations/:id/details
router.get('/evaluations/:id/details', authenticateToken, requireBranchManagerOrAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const evaluation = db.prepare(`
      SELECT be.*, e.first_name, e.last_name, e.monthly_salary
      FROM bonus_evaluations be
      JOIN employees e ON be.employee_id = e.id
      WHERE be.id = ?
    `).get(req.params.id);

    if (!evaluation) {
      return res.status(404).json({ error: 'Bewertung nicht gefunden.' });
    }

    const items = db.prepare(`
      SELECT bei.*, bc.name_de, bc.name_en, bc.description_de, bc.weight
      FROM bonus_evaluation_items bei
      JOIN bonus_criteria bc ON bei.criterion_id = bc.id
      WHERE bei.evaluation_id = ?
      ORDER BY bc.sort_order
    `).all(evaluation.id);

    res.json({ ...evaluation, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bonus/evaluations/:id/approve
router.post('/evaluations/:id/approve', authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDatabase();
    db.prepare('UPDATE bonus_evaluations SET status = ? WHERE id = ?').run('approved', req.params.id);
    res.json({ message: 'Bonus-Bewertung genehmigt.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
