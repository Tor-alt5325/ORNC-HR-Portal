const express = require('express');
const router = express.Router();
const { getDatabase } = require('../config/database');
const { authenticateToken, requireBranchManagerOrAdmin } = require('../middleware/auth');

const SHIFT_TYPES = {
  morning: { start: '08:30', end: '14:00', label: 'Frühschicht' },
  afternoon: { start: '13:00', end: '20:00', label: 'Mittagsschicht' },
  evening: { start: '17:00', end: '00:30', label: 'Spätschicht' }
};

// Required staff per shift: 2 Bäcker + 2 Köche
const REQUIRED_PER_SHIFT = { baker: 2, cook: 2 };

// GET /api/shifts - Get shifts for a location and date range
router.get('/', authenticateToken, requireBranchManagerOrAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const { location_id, start_date, end_date } = req.query;
    const locId = req.user.role === 'branch_manager' ? req.user.location_id : location_id;

    if (!locId || !start_date || !end_date) {
      return res.status(400).json({ error: 'location_id, start_date und end_date sind erforderlich.' });
    }

    const shifts = db.prepare(`
      SELECT s.*,
        GROUP_CONCAT(sa.employee_id) as assigned_employee_ids
      FROM shifts s
      LEFT JOIN shift_assignments sa ON s.id = sa.shift_id
      WHERE s.location_id = ? AND s.date BETWEEN ? AND ?
      GROUP BY s.id
      ORDER BY s.date, s.shift_type
    `).all(locId, start_date, end_date);

    // Get assignments with employee details
    const shiftsWithDetails = shifts.map(shift => {
      const assignments = db.prepare(`
        SELECT sa.*, e.first_name, e.last_name, e.profession_id,
               p.name_de as profession_name
        FROM shift_assignments sa
        JOIN employees e ON sa.employee_id = e.id
        JOIN professions p ON e.profession_id = p.id
        WHERE sa.shift_id = ?
      `).all(shift.id);

      return {
        ...shift,
        assignments,
        shift_info: SHIFT_TYPES[shift.shift_type],
        staffing: {
          cooks: assignments.filter(a => a.profession_id === 1).length,
          bakers: assignments.filter(a => a.profession_id === 2).length,
          required_cooks: REQUIRED_PER_SHIFT.cook,
          required_bakers: REQUIRED_PER_SHIFT.baker,
          is_complete: assignments.filter(a => a.profession_id === 1).length >= REQUIRED_PER_SHIFT.cook &&
                      assignments.filter(a => a.profession_id === 2).length >= REQUIRED_PER_SHIFT.baker
        }
      };
    });

    res.json(shiftsWithDetails);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shifts/generate - Generate shifts for a month
router.post('/generate', authenticateToken, requireBranchManagerOrAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const { location_id, year, month } = req.body;
    const locId = req.user.role === 'branch_manager' ? req.user.location_id : location_id;

    // Generate shifts for every day of the month
    const daysInMonth = new Date(year, month, 0).getDate();
    const insertShift = db.prepare(
      'INSERT OR IGNORE INTO shifts (location_id, date, shift_type, start_time, end_time) VALUES (?, ?, ?, ?, ?)'
    );

    const insertMany = db.transaction(() => {
      for (let day = 1; day <= daysInMonth; day++) {
        const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        for (const [type, times] of Object.entries(SHIFT_TYPES)) {
          insertShift.run(locId, date, type, times.start, times.end);
        }
      }
    });

    insertMany();
    res.json({ message: `Schichten für ${month}/${year} generiert.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shifts/:shiftId/assign
router.post('/:shiftId/assign', authenticateToken, requireBranchManagerOrAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const { employee_id } = req.body;

    // Verify employee exists and is active
    const employee = db.prepare('SELECT * FROM employees WHERE id = ? AND status = ?').get(employee_id, 'active');
    if (!employee) {
      return res.status(404).json({ error: 'Aktiver Mitarbeiter nicht gefunden.' });
    }

    // Check if already assigned
    const existing = db.prepare('SELECT * FROM shift_assignments WHERE shift_id = ? AND employee_id = ?')
      .get(req.params.shiftId, employee_id);
    if (existing) {
      return res.status(400).json({ error: 'Mitarbeiter ist bereits dieser Schicht zugewiesen.' });
    }

    db.prepare('INSERT INTO shift_assignments (shift_id, employee_id) VALUES (?, ?)')
      .run(req.params.shiftId, employee_id);

    res.status(201).json({ message: 'Mitarbeiter zur Schicht zugewiesen.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/shifts/:shiftId/unassign/:employeeId
router.delete('/:shiftId/unassign/:employeeId', authenticateToken, requireBranchManagerOrAdmin, (req, res) => {
  try {
    const db = getDatabase();
    db.prepare('DELETE FROM shift_assignments WHERE shift_id = ? AND employee_id = ?')
      .run(req.params.shiftId, req.params.employeeId);
    res.json({ message: 'Zuweisung entfernt.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shifts/wish-days - Employee submits wish days
router.post('/wish-days', authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const { employee_id, month_year, days } = req.body;

    // Check deadline (15th of previous month)
    const [year, month] = month_year.split('-').map(Number);
    const deadline = new Date(year, month - 2, 15); // month-2 because month is 1-indexed and we want previous month
    if (new Date() > deadline) {
      return res.status(400).json({ error: `Frist abgelaufen. Wunschtage müssen bis zum 15. des Vormonats eingereicht werden.` });
    }

    // Delete existing wishes for this month
    db.prepare('DELETE FROM wish_days WHERE employee_id = ? AND month_year = ?').run(employee_id, month_year);

    // Insert new wishes
    const insertWish = db.prepare(
      'INSERT INTO wish_days (employee_id, date, type, month_year) VALUES (?, ?, ?, ?)'
    );
    const insertMany = db.transaction(() => {
      for (const day of days) {
        insertWish.run(employee_id, day.date, day.type || 'off', month_year);
      }
    });
    insertMany();

    res.json({ message: 'Wunschtage gespeichert.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/shifts/wish-days
router.get('/wish-days', authenticateToken, requireBranchManagerOrAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const { location_id, month_year } = req.query;
    const locId = req.user.role === 'branch_manager' ? req.user.location_id : location_id;

    const wishes = db.prepare(`
      SELECT wd.*, e.first_name, e.last_name, e.profession_id,
             p.name_de as profession_name
      FROM wish_days wd
      JOIN employees e ON wd.employee_id = e.id
      JOIN professions p ON e.profession_id = p.id
      WHERE e.location_id = ? AND wd.month_year = ?
      ORDER BY e.last_name, wd.date
    `).all(locId, month_year);

    res.json(wishes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/shifts/types
router.get('/types', (req, res) => {
  res.json(SHIFT_TYPES);
});

module.exports = router;
