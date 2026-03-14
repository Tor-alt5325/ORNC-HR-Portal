const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDatabase } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { sendQuestionnaireEmail } = require('../services/emailService');
const { calculatePayrollKeys } = require('../services/payrollService');

// File upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads', 'questionnaire');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// POST /api/questionnaire/invite - Send questionnaire to applicant (Admin only)
router.post('/invite', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { email, first_name, last_name, company_id, location_id, profession_id, employment_type, language } = req.body;
    const db = getDatabase();
    const uuid = uuidv4();

    const result = db.prepare(`
      INSERT INTO questionnaire_invitations
      (uuid, email, first_name, last_name, company_id, location_id, profession_id, employment_type, language, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?)
    `).run(uuid, email, first_name, last_name, company_id, location_id, profession_id, employment_type, language || 'de', req.user.id);

    // Send email
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const questionnaireUrl = `${frontendUrl}/questionnaire/${uuid}`;

    sendQuestionnaireEmail(email, first_name, questionnaireUrl, language || 'de')
      .then(() => {
        db.prepare('UPDATE questionnaire_invitations SET sent_at = CURRENT_TIMESTAMP WHERE id = ?')
          .run(result.lastInsertRowid);
      })
      .catch(err => console.error('Email send error:', err));

    res.status(201).json({
      id: result.lastInsertRowid,
      uuid,
      questionnaire_url: questionnaireUrl,
      message: 'Fragebogen-Einladung erstellt und E-Mail gesendet.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/questionnaire/:uuid - Get questionnaire data (public - for applicants)
router.get('/:uuid', (req, res) => {
  try {
    const db = getDatabase();
    const invitation = db.prepare(`
      SELECT qi.*, c.name as company_name, l.city as location_city,
             p.name_de as profession_name, p.hourly_rate
      FROM questionnaire_invitations qi
      JOIN companies c ON qi.company_id = c.id
      JOIN locations l ON qi.location_id = l.id
      JOIN professions p ON qi.profession_id = p.id
      WHERE qi.uuid = ?
    `).get(req.params.uuid);

    if (!invitation) {
      return res.status(404).json({ error: 'Fragebogen nicht gefunden.' });
    }

    if (invitation.status === 'completed' || invitation.status === 'contract_created') {
      return res.status(400).json({ error: 'Dieser Fragebogen wurde bereits ausgefüllt.' });
    }

    // Mark as opened
    if (invitation.status === 'sent') {
      db.prepare('UPDATE questionnaire_invitations SET status = ? WHERE uuid = ?')
        .run('opened', req.params.uuid);
    }

    // Get health insurances
    const insurances = db.prepare('SELECT id, name, short_name, type FROM health_insurances WHERE is_active = 1 ORDER BY name').all();

    res.json({
      invitation: {
        uuid: invitation.uuid,
        first_name: invitation.first_name,
        last_name: invitation.last_name,
        company_name: invitation.company_name,
        location_city: invitation.location_city,
        profession_name: invitation.profession_name,
        employment_type: invitation.employment_type,
        hourly_rate: invitation.hourly_rate,
        language: invitation.language
      },
      health_insurances: insurances
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/questionnaire/:uuid/submit - Submit filled questionnaire
router.post('/:uuid/submit', upload.fields([
  { name: 'birth_certificates', maxCount: 10 },
  { name: 'immatriculation_doc', maxCount: 1 }
]), (req, res) => {
  try {
    const db = getDatabase();
    const invitation = db.prepare('SELECT * FROM questionnaire_invitations WHERE uuid = ?').get(req.params.uuid);

    if (!invitation) {
      return res.status(404).json({ error: 'Fragebogen nicht gefunden.' });
    }
    if (invitation.status === 'completed' || invitation.status === 'contract_created') {
      return res.status(400).json({ error: 'Bereits ausgefüllt.' });
    }

    const data = JSON.parse(req.body.data || '{}');

    // Calculate employment details
    let weeklyHours, monthlySalary, vacationDays;
    const profession = db.prepare('SELECT * FROM professions WHERE id = ?').get(invitation.profession_id);

    switch (invitation.employment_type) {
      case 'fulltime':
        weeklyHours = 40;
        monthlySalary = profession.hourly_rate * 40 * 4.33;
        vacationDays = 25; // 20 legal + 5 extra
        break;
      case 'parttime':
        weeklyHours = data.weekly_hours || 20;
        monthlySalary = profession.hourly_rate * weeklyHours * 4.33;
        vacationDays = Math.round((weeklyHours / 40) * 25);
        break;
      case 'minijob':
        weeklyHours = data.weekly_hours || 10;
        monthlySalary = Math.min(profession.hourly_rate * weeklyHours * 4.33, 520);
        vacationDays = Math.round((data.work_days_per_week || 2) / 5 * 20);
        break;
      case 'werkstudent':
        weeklyHours = data.weekly_hours || 20;
        monthlySalary = profession.hourly_rate * weeklyHours * 4.33;
        vacationDays = Math.round((weeklyHours / 40) * 25);
        break;
    }

    // Calculate payroll keys
    const payrollKeys = calculatePayrollKeys(invitation.employment_type, data.rv_exemption_requested);

    // Calculate probation end
    const startDate = data.start_date || new Date().toISOString().split('T')[0];
    const probationEnd = new Date(startDate);
    probationEnd.setMonth(probationEnd.getMonth() + 6);

    // Insert employee
    const employeeResult = db.prepare(`
      INSERT INTO employees (
        invitation_id, salutation, first_name, last_name, birth_name,
        date_of_birth, place_of_birth, nationality, gender, marital_status,
        street, house_number, zip_code, city, country,
        phone, email, emergency_contact_name, emergency_contact_phone,
        tax_id, social_security_number, health_insurance_id, tax_class,
        has_church_tax, church_tax_denomination,
        iban, bic, bank_name, account_holder,
        company_id, location_id, profession_id, employment_type,
        start_date, weekly_hours, hourly_rate, monthly_salary, vacation_days,
        is_probation, probation_end_date,
        university_name, enrollment_status, immatriculation_doc_path,
        rv_exemption_requested, rv_exemption_doc_path,
        beitragsgruppenschluessel, personenschluessel
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?
      )
    `).run(
      invitation.id, data.salutation, data.first_name, data.last_name, data.birth_name,
      data.date_of_birth, data.place_of_birth, data.nationality, data.gender, data.marital_status,
      data.street, data.house_number, data.zip_code, data.city, data.country || 'Deutschland',
      data.phone, invitation.email, data.emergency_contact_name, data.emergency_contact_phone,
      data.tax_id, data.social_security_number, data.health_insurance_id, data.tax_class,
      data.has_church_tax ? 1 : 0, data.church_tax_denomination,
      data.iban, data.bic, data.bank_name, data.account_holder,
      invitation.company_id, invitation.location_id, invitation.profession_id, invitation.employment_type,
      startDate, weeklyHours, profession.hourly_rate, monthlySalary, vacationDays,
      1, probationEnd.toISOString().split('T')[0],
      data.university_name, data.enrollment_status,
      req.files?.immatriculation_doc?.[0]?.path || null,
      data.rv_exemption_requested ? 1 : 0, null,
      payrollKeys.beitragsgruppenschluessel, payrollKeys.personenschluessel
    );

    const employeeId = employeeResult.lastInsertRowid;

    // Insert children
    if (data.children && Array.isArray(data.children)) {
      const insertChild = db.prepare(
        'INSERT INTO children (employee_id, first_name, last_name, date_of_birth, birth_certificate_path) VALUES (?, ?, ?, ?, ?)'
      );
      data.children.forEach((child, index) => {
        const certPath = req.files?.birth_certificates?.[index]?.path || null;
        insertChild.run(employeeId, child.first_name, child.last_name, child.date_of_birth, certPath);
      });
    }

    // Update invitation status
    db.prepare('UPDATE questionnaire_invitations SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE uuid = ?')
      .run('completed', req.params.uuid);

    res.status(201).json({
      employee_id: employeeId,
      message: 'Fragebogen erfolgreich eingereicht. Arbeitsvertrag wird erstellt.',
      payroll_keys: payrollKeys
    });
  } catch (err) {
    console.error('Questionnaire submit error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/questionnaire/invitations - List all invitations (Admin)
router.get('/', authenticateToken, requireAdmin, (req, res) => {
  try {
    const db = getDatabase();
    const invitations = db.prepare(`
      SELECT qi.*, c.name as company_name, l.city as location_city,
             p.name_de as profession_name, u.first_name as created_by_name
      FROM questionnaire_invitations qi
      JOIN companies c ON qi.company_id = c.id
      JOIN locations l ON qi.location_id = l.id
      JOIN professions p ON qi.profession_id = p.id
      LEFT JOIN users u ON qi.created_by = u.id
      ORDER BY qi.created_at DESC
    `).all();
    res.json(invitations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
