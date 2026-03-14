const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'hr_portal.db');

let db;

function getDatabase() {
  if (!db) {
    const fs = require('fs');
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initializeDatabase(db);
  }
  return db;
}

function initializeDatabase(db) {
  db.exec(`
    -- Companies and Locations
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      short_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      city TEXT NOT NULL,
      address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (company_id) REFERENCES companies(id)
    );

    -- Users (HR Admin + Branch Managers)
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'branch_manager')),
      location_id INTEGER,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (location_id) REFERENCES locations(id)
    );

    -- Professions
    CREATE TABLE IF NOT EXISTS professions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name_de TEXT NOT NULL,
      name_en TEXT NOT NULL,
      hourly_rate REAL NOT NULL
    );

    -- Questionnaire Invitations
    CREATE TABLE IF NOT EXISTS questionnaire_invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      company_id INTEGER NOT NULL,
      location_id INTEGER NOT NULL,
      profession_id INTEGER NOT NULL,
      employment_type TEXT NOT NULL CHECK(employment_type IN ('fulltime', 'parttime', 'minijob', 'werkstudent')),
      language TEXT DEFAULT 'de',
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'opened', 'completed', 'contract_created')),
      sent_at DATETIME,
      completed_at DATETIME,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (company_id) REFERENCES companies(id),
      FOREIGN KEY (location_id) REFERENCES locations(id),
      FOREIGN KEY (profession_id) REFERENCES professions(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    -- Employee Data (from questionnaire)
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invitation_id INTEGER UNIQUE,
      -- Personal Data
      salutation TEXT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      birth_name TEXT,
      date_of_birth DATE,
      place_of_birth TEXT,
      nationality TEXT,
      gender TEXT,
      marital_status TEXT,
      -- Address
      street TEXT,
      house_number TEXT,
      zip_code TEXT,
      city TEXT,
      country TEXT DEFAULT 'Deutschland',
      -- Contact
      phone TEXT,
      email TEXT NOT NULL,
      emergency_contact_name TEXT,
      emergency_contact_phone TEXT,
      -- Tax & Social
      tax_id TEXT,
      social_security_number TEXT,
      health_insurance_id INTEGER,
      tax_class TEXT,
      has_church_tax INTEGER DEFAULT 0,
      church_tax_denomination TEXT,
      -- Bank
      iban TEXT,
      bic TEXT,
      bank_name TEXT,
      account_holder TEXT,
      -- Employment
      company_id INTEGER NOT NULL,
      location_id INTEGER NOT NULL,
      profession_id INTEGER NOT NULL,
      employment_type TEXT NOT NULL,
      start_date DATE,
      weekly_hours REAL,
      hourly_rate REAL,
      monthly_salary REAL,
      vacation_days INTEGER,
      is_probation INTEGER DEFAULT 1,
      probation_end_date DATE,
      -- Werkstudent specific
      university_name TEXT,
      enrollment_status TEXT,
      immatriculation_doc_path TEXT,
      -- Minijob specific
      rv_exemption_requested INTEGER DEFAULT 0,
      rv_exemption_doc_path TEXT,
      -- Payroll keys
      beitragsgruppenschluessel TEXT,
      personenschluessel TEXT,
      -- Status
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'terminated')),
      termination_date DATE,
      termination_reason TEXT,
      -- Personio
      personio_id TEXT,
      personio_synced_at DATETIME,
      -- Google Drive
      gdrive_folder_id TEXT,
      -- Metadata
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (invitation_id) REFERENCES questionnaire_invitations(id),
      FOREIGN KEY (company_id) REFERENCES companies(id),
      FOREIGN KEY (location_id) REFERENCES locations(id),
      FOREIGN KEY (profession_id) REFERENCES professions(id),
      FOREIGN KEY (health_insurance_id) REFERENCES health_insurances(id)
    );

    -- Children
    CREATE TABLE IF NOT EXISTS children (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      date_of_birth DATE NOT NULL,
      birth_certificate_path TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    );

    -- German Health Insurances
    CREATE TABLE IF NOT EXISTS health_insurances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      short_name TEXT,
      type TEXT CHECK(type IN ('GKV', 'PKV')),
      is_active INTEGER DEFAULT 1
    );

    -- Contracts
    CREATE TABLE IF NOT EXISTS contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      contract_type TEXT NOT NULL CHECK(contract_type IN ('fulltime', 'parttime', 'minijob', 'werkstudent')),
      template_name TEXT,
      start_date DATE NOT NULL,
      end_date DATE,
      weekly_hours REAL,
      hourly_rate REAL,
      monthly_salary REAL,
      vacation_days INTEGER,
      probation_months INTEGER DEFAULT 6,
      notice_period TEXT,
      pdf_path TEXT,
      status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'sent', 'signed', 'active', 'terminated')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      signed_at DATETIME,
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    );

    -- Document Templates
    CREATE TABLE IF NOT EXISTS document_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('contract', 'termination', 'amendment', 'rv_exemption', 'other')),
      content_template TEXT NOT NULL,
      variables TEXT, -- JSON array of template variables
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Generated Documents
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      template_id INTEGER,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      file_path TEXT,
      status TEXT DEFAULT 'draft',
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      FOREIGN KEY (template_id) REFERENCES document_templates(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    -- Shift Planning
    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location_id INTEGER NOT NULL,
      date DATE NOT NULL,
      shift_type TEXT NOT NULL CHECK(shift_type IN ('morning', 'afternoon', 'evening')),
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (location_id) REFERENCES locations(id)
    );

    CREATE TABLE IF NOT EXISTS shift_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      status TEXT DEFAULT 'assigned' CHECK(status IN ('assigned', 'confirmed', 'swap_requested', 'absent')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (shift_id) REFERENCES shifts(id),
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      UNIQUE(shift_id, employee_id)
    );

    -- Employee Wish Days (for shift planning)
    CREATE TABLE IF NOT EXISTS wish_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      date DATE NOT NULL,
      type TEXT DEFAULT 'off' CHECK(type IN ('off', 'preferred')),
      month_year TEXT NOT NULL, -- Format: YYYY-MM
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    );

    -- Bonus Checklist
    CREATE TABLE IF NOT EXISTS bonus_criteria (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name_de TEXT NOT NULL,
      name_en TEXT NOT NULL,
      description_de TEXT,
      description_en TEXT,
      weight REAL DEFAULT 1.0,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS bonus_evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      evaluator_id INTEGER NOT NULL,
      month INTEGER NOT NULL,
      year INTEGER NOT NULL,
      total_score REAL,
      percentage REAL,
      bonus_percentage REAL,
      bonus_amount REAL,
      status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'submitted', 'approved', 'synced_personio')),
      personio_synced_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      FOREIGN KEY (evaluator_id) REFERENCES users(id),
      UNIQUE(employee_id, month, year)
    );

    CREATE TABLE IF NOT EXISTS bonus_evaluation_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      evaluation_id INTEGER NOT NULL,
      criterion_id INTEGER NOT NULL,
      fulfilled INTEGER DEFAULT 0,
      note TEXT,
      FOREIGN KEY (evaluation_id) REFERENCES bonus_evaluations(id),
      FOREIGN KEY (criterion_id) REFERENCES bonus_criteria(id)
    );

    -- Audit Log
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      details TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id);
    CREATE INDEX IF NOT EXISTS idx_employees_location ON employees(location_id);
    CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
    CREATE INDEX IF NOT EXISTS idx_shifts_location_date ON shifts(location_id, date);
    CREATE INDEX IF NOT EXISTS idx_shift_assignments_employee ON shift_assignments(employee_id);
    CREATE INDEX IF NOT EXISTS idx_bonus_evaluations_employee ON bonus_evaluations(employee_id, year, month);
    CREATE INDEX IF NOT EXISTS idx_questionnaire_uuid ON questionnaire_invitations(uuid);
  `);
}

module.exports = { getDatabase };
