#!/usr/bin/env python3
"""
ORNC HR Portal - Backend API Server
Built with Tornado web framework
"""

import os
import sys
import json
import sqlite3
import hashlib
import uuid
import datetime
import re
import tornado.ioloop
import tornado.web
import tornado.escape
import jwt
from pathlib import Path

# Configuration
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = BASE_DIR / "uploads"
INDEX_HTML_PATH = BASE_DIR / "index.html"
DATA_DIR.mkdir(exist_ok=True)
UPLOAD_DIR.mkdir(exist_ok=True)
(UPLOAD_DIR / "contracts").mkdir(exist_ok=True)
(UPLOAD_DIR / "documents").mkdir(exist_ok=True)
(UPLOAD_DIR / "questionnaire").mkdir(exist_ok=True)

DB_PATH = str(DATA_DIR / "hr_portal.db")
JWT_SECRET = os.environ.get("JWT_SECRET", "ornc-hr-portal-dev-secret-2024")
PORT = int(os.environ.get("PORT", 3001))

# ============================================================
# DATABASE
# ============================================================
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    c.executescript("""
    CREATE TABLE IF NOT EXISTS companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        short_name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS locations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        city TEXT NOT NULL,
        address TEXT,
        FOREIGN KEY (company_id) REFERENCES companies(id)
    );
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'branch_manager')),
        location_id INTEGER,
        is_active INTEGER DEFAULT 1,
        FOREIGN KEY (location_id) REFERENCES locations(id)
    );
    CREATE TABLE IF NOT EXISTS professions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name_de TEXT NOT NULL,
        name_en TEXT NOT NULL,
        hourly_rate REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS health_insurances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        short_name TEXT,
        type TEXT CHECK(type IN ('GKV', 'PKV')),
        is_active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS questionnaire_invitations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT UNIQUE NOT NULL,
        email TEXT NOT NULL,
        first_name TEXT,
        last_name TEXT,
        company_id INTEGER NOT NULL,
        location_id INTEGER NOT NULL,
        profession_id INTEGER NOT NULL,
        employment_type TEXT NOT NULL,
        language TEXT DEFAULT 'de',
        status TEXT DEFAULT 'pending',
        sent_at DATETIME,
        completed_at DATETIME,
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (location_id) REFERENCES locations(id),
        FOREIGN KEY (profession_id) REFERENCES professions(id)
    );
    CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invitation_id INTEGER UNIQUE,
        salutation TEXT, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
        birth_name TEXT, date_of_birth DATE, place_of_birth TEXT,
        nationality TEXT, gender TEXT, marital_status TEXT,
        street TEXT, house_number TEXT, zip_code TEXT, city TEXT, country TEXT DEFAULT 'Deutschland',
        phone TEXT, email TEXT NOT NULL,
        emergency_contact_name TEXT, emergency_contact_phone TEXT,
        tax_id TEXT, social_security_number TEXT, health_insurance_id INTEGER,
        tax_class TEXT, has_church_tax INTEGER DEFAULT 0, church_tax_denomination TEXT,
        iban TEXT, bic TEXT, bank_name TEXT, account_holder TEXT,
        company_id INTEGER NOT NULL, location_id INTEGER NOT NULL,
        profession_id INTEGER NOT NULL, employment_type TEXT NOT NULL,
        start_date DATE, weekly_hours REAL, hourly_rate REAL,
        monthly_salary REAL, vacation_days INTEGER,
        is_probation INTEGER DEFAULT 1, probation_end_date DATE,
        university_name TEXT, enrollment_status TEXT, immatriculation_doc_path TEXT,
        rv_exemption_requested INTEGER DEFAULT 0,
        beitragsgruppenschluessel TEXT, personenschluessel TEXT,
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'terminated')),
        termination_date DATE, termination_reason TEXT,
        personio_id TEXT, personio_synced_at DATETIME,
        gdrive_folder_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id),
        FOREIGN KEY (location_id) REFERENCES locations(id),
        FOREIGN KEY (profession_id) REFERENCES professions(id)
    );
    CREATE TABLE IF NOT EXISTS children (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        first_name TEXT NOT NULL, last_name TEXT NOT NULL,
        date_of_birth DATE NOT NULL,
        birth_certificate_path TEXT,
        FOREIGN KEY (employee_id) REFERENCES employees(id)
    );
    CREATE TABLE IF NOT EXISTS contracts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        contract_type TEXT NOT NULL,
        start_date DATE NOT NULL,
        weekly_hours REAL, hourly_rate REAL, monthly_salary REAL,
        vacation_days INTEGER, probation_months INTEGER DEFAULT 6,
        pdf_path TEXT,
        status TEXT DEFAULT 'draft',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (employee_id) REFERENCES employees(id)
    );
    CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        file_path TEXT,
        status TEXT DEFAULT 'draft',
        created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (employee_id) REFERENCES employees(id)
    );
    CREATE TABLE IF NOT EXISTS document_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        content_template TEXT NOT NULL,
        is_active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS shifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location_id INTEGER NOT NULL,
        date DATE NOT NULL,
        shift_type TEXT NOT NULL CHECK(shift_type IN ('morning', 'afternoon', 'evening')),
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        FOREIGN KEY (location_id) REFERENCES locations(id)
    );
    CREATE TABLE IF NOT EXISTS shift_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shift_id INTEGER NOT NULL,
        employee_id INTEGER NOT NULL,
        status TEXT DEFAULT 'assigned',
        FOREIGN KEY (shift_id) REFERENCES shifts(id),
        FOREIGN KEY (employee_id) REFERENCES employees(id),
        UNIQUE(shift_id, employee_id)
    );
    CREATE TABLE IF NOT EXISTS wish_days (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        date DATE NOT NULL,
        type TEXT DEFAULT 'off',
        month_year TEXT NOT NULL,
        FOREIGN KEY (employee_id) REFERENCES employees(id)
    );
    CREATE TABLE IF NOT EXISTS bonus_criteria (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name_de TEXT NOT NULL, name_en TEXT NOT NULL,
        description_de TEXT, description_en TEXT,
        weight REAL DEFAULT 1.0,
        is_active INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS bonus_evaluations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        evaluator_id INTEGER NOT NULL,
        month INTEGER NOT NULL, year INTEGER NOT NULL,
        total_score REAL, percentage REAL,
        bonus_percentage REAL, bonus_amount REAL,
        status TEXT DEFAULT 'draft',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (employee_id) REFERENCES employees(id),
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
    """)
    conn.commit()
    conn.close()

def seed_db():
    conn = get_db()
    c = conn.cursor()
    # Check if already seeded
    if c.execute("SELECT COUNT(*) FROM companies").fetchone()[0] > 0:
        conn.close()
        return
    # Companies
    c.execute("INSERT INTO companies (id,name,short_name) VALUES (1,'ORNC GmbH','ORNC')")
    c.execute("INSERT INTO companies (id,name,short_name) VALUES (2,'ORNC II GmbH','ORNC II')")
    c.execute("INSERT INTO companies (id,name,short_name) VALUES (3,'ORNC III GmbH','ORNC III')")
    # Locations
    for id_, cid, city in [(1,1,'Magdeburg'),(2,1,'Berlin'),(3,2,'Köln'),(4,2,'Bonn'),(5,3,'Nürnberg'),(6,3,'Augsburg')]:
        c.execute("INSERT INTO locations (id,company_id,city) VALUES (?,?,?)", (id_, cid, city))
    # Professions
    c.execute("INSERT INTO professions (id,name_de,name_en,hourly_rate) VALUES (1,'Koch','Cook',20.0)")
    c.execute("INSERT INTO professions (id,name_de,name_en,hourly_rate) VALUES (2,'Bäcker','Baker',25.0)")
    # Health Insurances
    insurances = [
        ('AOK Baden-Württemberg','AOK BW','GKV'),('AOK Bayern','AOK BY','GKV'),
        ('AOK Niedersachsen','AOK NI','GKV'),('AOK Nordost','AOK NO','GKV'),
        ('AOK Nordwest','AOK NW','GKV'),('AOK Plus','AOK Plus','GKV'),
        ('AOK Rheinland/Hamburg','AOK RH','GKV'),('AOK Sachsen-Anhalt','AOK ST','GKV'),
        ('BARMER','BARMER','GKV'),('BIG direkt gesund','BIG','GKV'),
        ('BKK firmus','BKK firmus','GKV'),('BKK Mobil Oil','BKK Mobil','GKV'),
        ('BKK VBU','BKK VBU','GKV'),('DAK-Gesundheit','DAK','GKV'),
        ('Die Techniker (TK)','TK','GKV'),('HEK Hanseatische','HEK','GKV'),
        ('hkk Krankenkasse','hkk','GKV'),('IKK classic','IKK classic','GKV'),
        ('IKK gesund plus','IKK gesund+','GKV'),('IKK Südwest','IKK SW','GKV'),
        ('KKH Kaufmännische','KKH','GKV'),('Knappschaft','Knappschaft','GKV'),
        ('mhplus BKK','mhplus','GKV'),('pronova BKK','pronova','GKV'),
        ('SBK Siemens-BKK','SBK','GKV'),('VIACTIV','VIACTIV','GKV'),
        ('Allianz PKV','Allianz PKV','PKV'),('AXA PKV','AXA PKV','PKV'),
        ('Debeka PKV','Debeka PKV','PKV'),('DKV','DKV','PKV'),
        ('HanseMerkur PKV','HanseMerkur','PKV'),('SIGNAL IDUNA PKV','SIGNAL PKV','PKV'),
    ]
    for name, short, typ in insurances:
        c.execute("INSERT INTO health_insurances (name,short_name,type) VALUES (?,?,?)", (name, short, typ))
    # Bonus Criteria
    criteria = [
        ('Pünktlich zur Arbeit erschienen','Arrived at work on time','Regelmäßig pünktlich','Regularly on time',1.0,1),
        ('Fristgerechte Krankmeldung','Timely sick leave notification','Vor Schichtbeginn','Before shift start',1.0,2),
        ('Saubere Arbeitskleidung','Wore clean work clothing','Ordnungsgemäße Kleidung','Proper clothing',1.0,3),
        ('Hygienevorschriften eingehalten','Hygiene standards met','Konsequent eingehalten','Consistently followed',1.0,4),
        ('Teamarbeit und Kollegialität','Teamwork and collegiality','Gute Zusammenarbeit','Good cooperation',1.0,5),
    ]
    for row in criteria:
        c.execute("INSERT INTO bonus_criteria (name_de,name_en,description_de,description_en,weight,sort_order) VALUES (?,?,?,?,?,?)", row)
    # Admin user (password: admin123)
    pw_hash = hashlib.sha256("admin123".encode()).hexdigest()
    c.execute("INSERT INTO users (id,email,password_hash,first_name,last_name,role) VALUES (1,'admin@ornc.de',?,'Admin','ORNC','admin')", (pw_hash,))
    # Branch managers
    uid = 2
    for loc_id, city in [(1,'Magdeburg'),(2,'Berlin'),(3,'Köln'),(4,'Bonn'),(5,'Nürnberg'),(6,'Augsburg')]:
        pw = hashlib.sha256("manager123".encode()).hexdigest()
        c.execute("INSERT INTO users (id,email,password_hash,first_name,last_name,role,location_id) VALUES (?,?,?,?,?,?,?)",
                  (uid, f"fl1.{city.lower()}@ornc.de", pw, 'Filialleiter 1', city, 'branch_manager', loc_id))
        uid += 1
        c.execute("INSERT INTO users (id,email,password_hash,first_name,last_name,role,location_id) VALUES (?,?,?,?,?,?,?)",
                  (uid, f"fl2.{city.lower()}@ornc.de", pw, 'Filialleiter 2', city, 'branch_manager', loc_id))
        uid += 1
    conn.commit()
    conn.close()
    print("Database seeded! Admin: admin@ornc.de / admin123")

# ============================================================
# PAYROLL SERVICE
# ============================================================
def calculate_payroll_keys(employment_type, rv_exemption=False):
    if employment_type in ('fulltime', 'parttime'):
        return {'beitragsgruppenschluessel': '1-1-1-1', 'personenschluessel': '101'}
    elif employment_type == 'minijob':
        bgrs = '6-5-0-0' if rv_exemption else '6-1-0-0'
        return {'beitragsgruppenschluessel': bgrs, 'personenschluessel': '109'}
    elif employment_type == 'werkstudent':
        return {'beitragsgruppenschluessel': 'TBD', 'personenschluessel': 'TBD'}
    return {'beitragsgruppenschluessel': '1-1-1-1', 'personenschluessel': '101'}

# ============================================================
# PDF SERVICE
# ============================================================
def generate_contract_pdf(employee, contract_type):
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    fname = f"Arbeitsvertrag_{employee['last_name']}_{employee['first_name']}_{int(datetime.datetime.now().timestamp())}.pdf"
    fpath = str(UPLOAD_DIR / "contracts" / fname)

    doc = SimpleDocTemplate(fpath, pagesize=A4, leftMargin=2*cm, rightMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm)
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle('Title2', parent=styles['Title'], fontSize=18, spaceAfter=6)
    heading_style = ParagraphStyle('Heading', parent=styles['Heading2'], fontSize=12, spaceBefore=12, spaceAfter=6)
    body_style = ParagraphStyle('Body2', parent=styles['Normal'], fontSize=10, spaceAfter=8, leading=14)

    type_labels = {'fulltime': 'Vollzeit', 'parttime': 'Teilzeit', 'minijob': 'Geringfügige Beschäftigung (Minijob)', 'werkstudent': 'Werkstudent'}
    elements = []
    elements.append(Paragraph(f"{employee.get('company_name','ORNC GmbH')} - {employee.get('location_city','')}", body_style))
    elements.append(Spacer(1, 20))
    elements.append(Paragraph("ARBEITSVERTRAG", title_style))
    elements.append(Paragraph(type_labels.get(contract_type, contract_type), ParagraphStyle('Sub', parent=styles['Normal'], fontSize=12, alignment=1)))
    elements.append(Spacer(1, 20))
    elements.append(Paragraph(f"zwischen <b>{employee.get('company_name','')}</b>, {employee.get('location_city','')} (Arbeitgeber)", body_style))
    elements.append(Paragraph(f"und <b>{employee['first_name']} {employee['last_name']}</b>, {employee.get('street','')} {employee.get('house_number','')}, {employee.get('zip_code','')} {employee.get('city','')} (Arbeitnehmer)", body_style))
    elements.append(Spacer(1, 15))

    sections = [
        ("§ 1 Beginn und Dauer", f"Das Arbeitsverhältnis beginnt am {employee.get('start_date','__________')}. Es wird auf unbestimmte Zeit geschlossen."),
        ("§ 2 Probezeit", "Die ersten 6 Monate gelten als Probezeit. Während dieser kann mit 2 Wochen Frist gekündigt werden."),
        ("§ 3 Tätigkeit", f"Der Arbeitnehmer wird als {employee.get('profession_name','Mitarbeiter')} am Standort {employee.get('location_city','')} eingestellt."),
        ("§ 4 Arbeitszeit", f"Die regelmäßige wöchentliche Arbeitszeit beträgt {employee.get('weekly_hours',40)} Stunden."),
        ("§ 5 Vergütung", f"Stundenlohn: {employee.get('hourly_rate',0):.2f} EUR brutto. Monatliches Bruttogehalt: ca. {employee.get('monthly_salary',0):.2f} EUR."),
        ("§ 6 Urlaub", f"Urlaubsanspruch: {employee.get('vacation_days',25)} Arbeitstage pro Kalenderjahr."),
        ("§ 7 Kündigungsfristen", "Nach der Probezeit: 4 Wochen zum 15. oder Monatsende gemäß § 622 BGB."),
        ("§ 8 Leistungsbonus", "Bei 75-100% Erfüllung der Bonuskriterien: 15% Bonus, bei 45-74%: 7,5%, unter 45%: kein Bonus."),
        ("§ 9 Schlussbestimmungen", "Änderungen bedürfen der Schriftform. Unwirksame Klauseln berühren den Rest nicht."),
    ]

    for heading, text in sections:
        elements.append(Paragraph(heading, heading_style))
        elements.append(Paragraph(text, body_style))

    elements.append(Spacer(1, 40))
    elements.append(Paragraph(f"{employee.get('location_city','')}, den _______________", body_style))
    elements.append(Spacer(1, 30))
    elements.append(Paragraph("_________________________&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;_________________________", body_style))
    elements.append(Paragraph("Arbeitgeber&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Arbeitnehmer", body_style))

    doc.build(elements)
    return fpath

def generate_termination_pdf(employee, termination_date, notice_period, reason="ordentliche Kündigung"):
    from reportlab.lib.pagesizes import A4
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import cm

    fname = f"Kuendigung_{employee['last_name']}_{employee['first_name']}_{int(datetime.datetime.now().timestamp())}.pdf"
    fpath = str(UPLOAD_DIR / "documents" / fname)
    doc = SimpleDocTemplate(fpath, pagesize=A4, leftMargin=2*cm, rightMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm)
    styles = getSampleStyleSheet()
    body = ParagraphStyle('Body', parent=styles['Normal'], fontSize=10, leading=14, spaceAfter=8)
    title = ParagraphStyle('Title2', parent=styles['Title'], fontSize=16, spaceAfter=20)

    elements = []
    elements.append(Paragraph(f"{employee.get('company_name','')} - {employee.get('location_city','')}", body))
    elements.append(Paragraph(f"Datum: {datetime.date.today().strftime('%d.%m.%Y')}", body))
    elements.append(Spacer(1, 20))
    elements.append(Paragraph(f"{employee['first_name']} {employee['last_name']}", body))
    elements.append(Paragraph(f"{employee.get('street','')} {employee.get('house_number','')}", body))
    elements.append(Paragraph(f"{employee.get('zip_code','')} {employee.get('city','')}", body))
    elements.append(Spacer(1, 20))
    elements.append(Paragraph("Kündigung des Arbeitsverhältnisses", title))
    elements.append(Paragraph(f"Sehr geehrte/r Frau/Herr {employee['last_name']},", body))
    elements.append(Paragraph(f"hiermit kündigen wir das mit Ihnen bestehende Arbeitsverhältnis ordentlich und fristgerecht zum <b>{termination_date}</b>.", body))
    elements.append(Paragraph(f"Kündigungsfrist: {notice_period}", body))
    elements.append(Spacer(1, 20))
    elements.append(Paragraph("Mit freundlichen Grüßen", body))
    elements.append(Spacer(1, 30))
    elements.append(Paragraph(f"_________________________<br/>{employee.get('company_name','')}", body))

    doc.build(elements)
    return fpath

# ============================================================
# BASE HANDLER
# ============================================================
class BaseHandler(tornado.web.RequestHandler):
    def set_default_headers(self):
        self.set_header("Access-Control-Allow-Origin", "*")
        self.set_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.set_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")

    def options(self, *args, **kwargs):
        self.set_status(204)
        self.finish()

    def get_json(self):
        try:
            return json.loads(self.request.body)
        except:
            return {}

    def get_current_user_from_token(self):
        auth = self.request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return None
        try:
            token = auth.split(" ")[1]
            return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        except:
            return None

    def require_auth(self):
        user = self.get_current_user_from_token()
        if not user:
            self.set_status(401)
            self.write({"error": "Nicht autorisiert"})
            return None
        return user

    def require_admin(self):
        user = self.require_auth()
        if user and user.get('role') != 'admin':
            self.set_status(403)
            self.write({"error": "Nur für Administratoren"})
            return None
        return user

    def dict_from_row(self, row):
        if row is None:
            return None
        return dict(row)

    def rows_to_list(self, rows):
        return [dict(r) for r in rows]

# ============================================================
# AUTH HANDLERS
# ============================================================
class LoginHandler(BaseHandler):
    def post(self):
        data = self.get_json()
        email = data.get('email', '')
        password = data.get('password', '')
        pw_hash = hashlib.sha256(password.encode()).hexdigest()

        conn = get_db()
        user = conn.execute("""
            SELECT u.*, l.city as location_city, c.name as company_name
            FROM users u LEFT JOIN locations l ON u.location_id = l.id
            LEFT JOIN companies c ON l.company_id = c.id
            WHERE u.email = ? AND u.password_hash = ? AND u.is_active = 1
        """, (email, pw_hash)).fetchone()
        conn.close()

        if not user:
            self.set_status(401)
            self.write({"error": "Ungültige Anmeldedaten"})
            return

        token = jwt.encode({
            'id': user['id'], 'email': user['email'], 'role': user['role'],
            'location_id': user['location_id'],
            'exp': datetime.datetime.utcnow() + datetime.timedelta(hours=8)
        }, JWT_SECRET, algorithm="HS256")

        self.write({
            "token": token,
            "user": {
                "id": user['id'], "email": user['email'],
                "first_name": user['first_name'], "last_name": user['last_name'],
                "role": user['role'], "location_id": user['location_id'],
                "location_city": user['location_city'], "company_name": user['company_name']
            }
        })

class MeHandler(BaseHandler):
    def get(self):
        user = self.require_auth()
        if not user:
            return
        conn = get_db()
        u = conn.execute("""
            SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.location_id,
                   l.city as location_city, c.name as company_name
            FROM users u LEFT JOIN locations l ON u.location_id = l.id
            LEFT JOIN companies c ON l.company_id = c.id WHERE u.id = ?
        """, (user['id'],)).fetchone()
        conn.close()
        self.write(self.dict_from_row(u) or {})

class UsersHandler(BaseHandler):
    def get(self):
        user = self.require_admin()
        if not user:
            return
        conn = get_db()
        users = conn.execute("""
            SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.location_id, u.is_active,
                   l.city as location_city, c.name as company_name
            FROM users u LEFT JOIN locations l ON u.location_id = l.id
            LEFT JOIN companies c ON l.company_id = c.id ORDER BY u.role, u.last_name
        """).fetchall()
        conn.close()
        self.write(json.dumps(self.rows_to_list(users)))

    def post(self):
        user = self.require_admin()
        if not user:
            return
        data = self.get_json()
        pw_hash = hashlib.sha256(data.get('password', 'default123').encode()).hexdigest()
        conn = get_db()
        try:
            c = conn.execute(
                "INSERT INTO users (email,password_hash,first_name,last_name,role,location_id) VALUES (?,?,?,?,?,?)",
                (data['email'], pw_hash, data['first_name'], data['last_name'], data['role'], data.get('location_id'))
            )
            conn.commit()
            self.write({"id": c.lastrowid, "message": "Benutzer erstellt"})
        except Exception as e:
            self.set_status(400)
            self.write({"error": str(e)})
        finally:
            conn.close()

# ============================================================
# MASTER DATA
# ============================================================
class CompaniesHandler(BaseHandler):
    def get(self):
        conn = get_db()
        rows = conn.execute("SELECT * FROM companies ORDER BY name").fetchall()
        conn.close()
        self.write(json.dumps(self.rows_to_list(rows)))

class LocationsHandler(BaseHandler):
    def get(self):
        company_id = self.get_argument('company_id', None)
        conn = get_db()
        if company_id:
            rows = conn.execute("SELECT l.*, c.name as company_name FROM locations l JOIN companies c ON l.company_id = c.id WHERE l.company_id = ? ORDER BY l.city", (company_id,)).fetchall()
        else:
            rows = conn.execute("SELECT l.*, c.name as company_name FROM locations l JOIN companies c ON l.company_id = c.id ORDER BY c.name, l.city").fetchall()
        conn.close()
        self.write(json.dumps(self.rows_to_list(rows)))

class ProfessionsHandler(BaseHandler):
    def get(self):
        conn = get_db()
        rows = conn.execute("SELECT * FROM professions ORDER BY name_de").fetchall()
        conn.close()
        self.write(json.dumps(self.rows_to_list(rows)))

class HealthInsurancesHandler(BaseHandler):
    def get(self):
        conn = get_db()
        rows = conn.execute("SELECT * FROM health_insurances WHERE is_active = 1 ORDER BY name").fetchall()
        conn.close()
        self.write(json.dumps(self.rows_to_list(rows)))

class DashboardStatsHandler(BaseHandler):
    def get(self):
        user = self.require_auth()
        if not user:
            return
        conn = get_db()
        loc_filter = "AND e.location_id = ?" if user['role'] == 'branch_manager' else ""
        params = [user['location_id']] if user['role'] == 'branch_manager' else []

        total = conn.execute(f"SELECT COUNT(*) as c FROM employees e WHERE status='active' {loc_filter}", params).fetchone()['c']
        pending = conn.execute("SELECT COUNT(*) as c FROM questionnaire_invitations WHERE status IN ('sent','opened')").fetchone()['c']
        drafts = conn.execute("SELECT COUNT(*) as c FROM contracts WHERE status='draft'").fetchone()['c']

        by_type = conn.execute(f"SELECT employment_type, COUNT(*) as count FROM employees e WHERE status='active' {loc_filter} GROUP BY employment_type", params).fetchall()
        by_location = conn.execute(f"SELECT l.city, COUNT(*) as count FROM employees e JOIN locations l ON e.location_id = l.id WHERE e.status='active' {loc_filter} GROUP BY l.city", params).fetchall()

        conn.close()
        self.write(json.dumps({
            "total_employees": total,
            "pending_questionnaires": pending,
            "draft_contracts": drafts,
            "employees_by_type": self.rows_to_list(by_type),
            "employees_by_location": self.rows_to_list(by_location)
        }))

# ============================================================
# QUESTIONNAIRE
# ============================================================
class QuestionnaireInviteHandler(BaseHandler):
    def get(self):
        user = self.require_admin()
        if not user:
            return
        conn = get_db()
        rows = conn.execute("""
            SELECT qi.*, c.name as company_name, l.city as location_city, p.name_de as profession_name
            FROM questionnaire_invitations qi
            JOIN companies c ON qi.company_id = c.id
            JOIN locations l ON qi.location_id = l.id
            JOIN professions p ON qi.profession_id = p.id
            ORDER BY qi.created_at DESC
        """).fetchall()
        conn.close()
        self.write(json.dumps(self.rows_to_list(rows)))

    def post(self):
        user = self.require_admin()
        if not user:
            return
        data = self.get_json()
        inv_uuid = str(uuid.uuid4())
        conn = get_db()
        try:
            c = conn.execute("""
                INSERT INTO questionnaire_invitations (uuid,email,first_name,last_name,company_id,location_id,profession_id,employment_type,language,status,created_by,sent_at)
                VALUES (?,?,?,?,?,?,?,?,?,'sent',?,CURRENT_TIMESTAMP)
            """, (inv_uuid, data['email'], data.get('first_name'), data.get('last_name'),
                  data['company_id'], data['location_id'], data['profession_id'],
                  data['employment_type'], data.get('language', 'de'), user['id']))
            conn.commit()
            self.write({
                "id": c.lastrowid, "uuid": inv_uuid,
                "questionnaire_url": f"/questionnaire/{inv_uuid}",
                "message": "Fragebogen-Einladung erstellt"
            })
        except Exception as e:
            self.set_status(400)
            self.write({"error": str(e)})
        finally:
            conn.close()

class QuestionnaireDetailHandler(BaseHandler):
    def get(self, q_uuid):
        conn = get_db()
        inv = conn.execute("""
            SELECT qi.*, c.name as company_name, l.city as location_city,
                   p.name_de as profession_name, p.hourly_rate
            FROM questionnaire_invitations qi
            JOIN companies c ON qi.company_id = c.id JOIN locations l ON qi.location_id = l.id
            JOIN professions p ON qi.profession_id = p.id WHERE qi.uuid = ?
        """, (q_uuid,)).fetchone()

        if not inv:
            conn.close()
            self.set_status(404)
            self.write({"error": "Fragebogen nicht gefunden"})
            return

        insurances = conn.execute("SELECT id, name, short_name, type FROM health_insurances WHERE is_active = 1 ORDER BY name").fetchall()

        if inv['status'] == 'sent':
            conn.execute("UPDATE questionnaire_invitations SET status='opened' WHERE uuid=?", (q_uuid,))
            conn.commit()

        conn.close()
        self.write(json.dumps({
            "invitation": {
                "uuid": inv['uuid'], "first_name": inv['first_name'], "last_name": inv['last_name'],
                "company_name": inv['company_name'], "location_city": inv['location_city'],
                "profession_name": inv['profession_name'], "employment_type": inv['employment_type'],
                "hourly_rate": inv['hourly_rate'], "language": inv['language']
            },
            "health_insurances": self.rows_to_list(insurances)
        }))

class QuestionnaireSubmitHandler(BaseHandler):
    def post(self, q_uuid):
        conn = get_db()
        inv = conn.execute("SELECT * FROM questionnaire_invitations WHERE uuid=?", (q_uuid,)).fetchone()
        if not inv:
            conn.close()
            self.set_status(404)
            self.write({"error": "Nicht gefunden"})
            return
        if inv['status'] in ('completed', 'contract_created'):
            conn.close()
            self.set_status(400)
            self.write({"error": "Bereits ausgefüllt"})
            return

        data = self.get_json()
        prof = conn.execute("SELECT * FROM professions WHERE id=?", (inv['profession_id'],)).fetchone()

        # Calculate employment details
        weekly_hours = data.get('weekly_hours', 40 if inv['employment_type'] == 'fulltime' else 20)
        hourly_rate = prof['hourly_rate']
        monthly_salary = hourly_rate * weekly_hours * 4.33

        if inv['employment_type'] == 'minijob':
            monthly_salary = min(monthly_salary, 520)
            weekly_hours = data.get('weekly_hours', 10)

        vacation_days = 25 if inv['employment_type'] == 'fulltime' else max(10, int(weekly_hours / 40 * 25))

        payroll = calculate_payroll_keys(inv['employment_type'], data.get('rv_exemption_requested', False))

        start_date = data.get('start_date', datetime.date.today().isoformat())
        prob_end = (datetime.datetime.strptime(start_date, '%Y-%m-%d') + datetime.timedelta(days=180)).strftime('%Y-%m-%d')

        try:
            c = conn.execute("""
                INSERT INTO employees (invitation_id, salutation, first_name, last_name, birth_name,
                    date_of_birth, place_of_birth, nationality, gender, marital_status,
                    street, house_number, zip_code, city, country,
                    phone, email, emergency_contact_name, emergency_contact_phone,
                    tax_id, social_security_number, health_insurance_id, tax_class,
                    has_church_tax, church_tax_denomination, iban, bic, bank_name, account_holder,
                    company_id, location_id, profession_id, employment_type,
                    start_date, weekly_hours, hourly_rate, monthly_salary, vacation_days,
                    is_probation, probation_end_date,
                    university_name, enrollment_status, rv_exemption_requested,
                    beitragsgruppenschluessel, personenschluessel)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, (
                inv['id'], data.get('salutation'), data.get('first_name', inv['first_name']),
                data.get('last_name', inv['last_name']), data.get('birth_name'),
                data.get('date_of_birth'), data.get('place_of_birth'), data.get('nationality'),
                data.get('gender'), data.get('marital_status'),
                data.get('street'), data.get('house_number'), data.get('zip_code'),
                data.get('city'), data.get('country', 'Deutschland'),
                data.get('phone'), inv['email'],
                data.get('emergency_contact_name'), data.get('emergency_contact_phone'),
                data.get('tax_id'), data.get('social_security_number'),
                data.get('health_insurance_id'), data.get('tax_class'),
                1 if data.get('has_church_tax') else 0, data.get('church_tax_denomination'),
                data.get('iban'), data.get('bic'), data.get('bank_name'), data.get('account_holder'),
                inv['company_id'], inv['location_id'], inv['profession_id'], inv['employment_type'],
                start_date, weekly_hours, hourly_rate, monthly_salary, vacation_days,
                1, prob_end,
                data.get('university_name'), data.get('enrollment_status'),
                1 if data.get('rv_exemption_requested') else 0,
                payroll['beitragsgruppenschluessel'], payroll['personenschluessel']
            ))
            emp_id = c.lastrowid

            # Children
            for child in data.get('children', []):
                conn.execute("INSERT INTO children (employee_id,first_name,last_name,date_of_birth) VALUES (?,?,?,?)",
                           (emp_id, child.get('first_name',''), child.get('last_name',''), child.get('date_of_birth','')))

            conn.execute("UPDATE questionnaire_invitations SET status='completed', completed_at=CURRENT_TIMESTAMP WHERE uuid=?", (q_uuid,))
            conn.commit()

            self.write({"employee_id": emp_id, "message": "Fragebogen erfolgreich eingereicht", "payroll_keys": payroll})
        except Exception as e:
            self.set_status(500)
            self.write({"error": str(e)})
        finally:
            conn.close()

# ============================================================
# EMPLOYEES
# ============================================================
class EmployeesHandler(BaseHandler):
    def get(self):
        user = self.require_auth()
        if not user:
            return
        conn = get_db()
        query = """SELECT e.*, c.name as company_name, l.city as location_city,
                   p.name_de as profession_name, hi.name as health_insurance_name
                   FROM employees e JOIN companies c ON e.company_id = c.id
                   JOIN locations l ON e.location_id = l.id JOIN professions p ON e.profession_id = p.id
                   LEFT JOIN health_insurances hi ON e.health_insurance_id = hi.id WHERE 1=1"""
        params = []
        if user['role'] == 'branch_manager':
            query += " AND e.location_id = ?"
            params.append(user['location_id'])
        status = self.get_argument('status', None)
        if status:
            query += " AND e.status = ?"
            params.append(status)
        search = self.get_argument('search', None)
        if search:
            query += " AND (e.first_name LIKE ? OR e.last_name LIKE ?)"
            params.extend([f"%{search}%", f"%{search}%"])
        query += " ORDER BY e.last_name, e.first_name"
        rows = conn.execute(query, params).fetchall()
        conn.close()
        self.write(json.dumps(self.rows_to_list(rows)))

class EmployeeDetailHandler(BaseHandler):
    def get(self, emp_id):
        user = self.require_auth()
        if not user:
            return
        conn = get_db()
        emp = conn.execute("""
            SELECT e.*, c.name as company_name, l.city as location_city,
                   p.name_de as profession_name, hi.name as health_insurance_name
            FROM employees e JOIN companies c ON e.company_id = c.id
            JOIN locations l ON e.location_id = l.id JOIN professions p ON e.profession_id = p.id
            LEFT JOIN health_insurances hi ON e.health_insurance_id = hi.id WHERE e.id = ?
        """, (emp_id,)).fetchone()
        if not emp:
            conn.close()
            self.set_status(404)
            self.write({"error": "Nicht gefunden"})
            return

        children = conn.execute("SELECT * FROM children WHERE employee_id=?", (emp_id,)).fetchall()
        contracts = conn.execute("SELECT * FROM contracts WHERE employee_id=? ORDER BY created_at DESC", (emp_id,)).fetchall()
        documents = conn.execute("SELECT * FROM documents WHERE employee_id=? ORDER BY created_at DESC", (emp_id,)).fetchall()
        conn.close()

        result = self.dict_from_row(emp)
        result['children'] = self.rows_to_list(children)
        result['contracts'] = self.rows_to_list(contracts)
        result['documents'] = self.rows_to_list(documents)
        self.write(json.dumps(result))

    def put(self, emp_id):
        user = self.require_admin()
        if not user:
            return
        data = self.get_json()
        conn = get_db()
        fields = [f"{k}=?" for k in data.keys() if k != 'id']
        values = [v for k, v in data.items() if k != 'id']
        if fields:
            conn.execute(f"UPDATE employees SET {','.join(fields)}, updated_at=CURRENT_TIMESTAMP WHERE id=?", values + [emp_id])
            conn.commit()
        conn.close()
        self.write({"message": "Aktualisiert"})

# ============================================================
# CONTRACTS
# ============================================================
class ContractsHandler(BaseHandler):
    def get(self):
        user = self.require_auth()
        if not user:
            return
        conn = get_db()
        rows = conn.execute("""
            SELECT ct.*, e.first_name, e.last_name, c.name as company_name, l.city as location_city
            FROM contracts ct JOIN employees e ON ct.employee_id = e.id
            JOIN companies c ON e.company_id = c.id JOIN locations l ON e.location_id = l.id
            ORDER BY ct.created_at DESC
        """).fetchall()
        conn.close()
        self.write(json.dumps(self.rows_to_list(rows)))

class GenerateContractHandler(BaseHandler):
    def post(self, emp_id):
        user = self.require_admin()
        if not user:
            return
        conn = get_db()
        emp = conn.execute("""
            SELECT e.*, c.name as company_name, l.city as location_city, p.name_de as profession_name
            FROM employees e JOIN companies c ON e.company_id = c.id
            JOIN locations l ON e.location_id = l.id JOIN professions p ON e.profession_id = p.id
            WHERE e.id = ?
        """, (emp_id,)).fetchone()
        if not emp:
            conn.close()
            self.set_status(404)
            self.write({"error": "Nicht gefunden"})
            return

        emp_dict = self.dict_from_row(emp)
        pdf_path = generate_contract_pdf(emp_dict, emp['employment_type'])

        c = conn.execute("""
            INSERT INTO contracts (employee_id,contract_type,start_date,weekly_hours,hourly_rate,monthly_salary,vacation_days,pdf_path,status)
            VALUES (?,?,?,?,?,?,?,?,'draft')
        """, (emp['id'], emp['employment_type'], emp['start_date'], emp['weekly_hours'],
              emp['hourly_rate'], emp['monthly_salary'], emp['vacation_days'], pdf_path))

        if emp['invitation_id']:
            conn.execute("UPDATE questionnaire_invitations SET status='contract_created' WHERE id=?", (emp['invitation_id'],))
        conn.commit()
        conn.close()

        self.write({"contract_id": c.lastrowid, "pdf_path": pdf_path, "message": "Arbeitsvertrag erstellt"})

# ============================================================
# DOCUMENTS / TEMPLATES
# ============================================================
class TerminationHandler(BaseHandler):
    def post(self, emp_id):
        user = self.require_admin()
        if not user:
            return
        conn = get_db()
        emp = conn.execute("""
            SELECT e.*, c.name as company_name, l.city as location_city
            FROM employees e JOIN companies c ON e.company_id = c.id
            JOIN locations l ON e.location_id = l.id WHERE e.id = ?
        """, (emp_id,)).fetchone()
        if not emp:
            conn.close()
            self.set_status(404)
            self.write({"error": "Nicht gefunden"})
            return

        data = self.get_json()
        today = datetime.date.today()
        prob_end = datetime.datetime.strptime(emp['probation_end_date'], '%Y-%m-%d').date() if emp['probation_end_date'] else today

        if data.get('termination_date'):
            term_date = data['termination_date']
            notice = 'Benutzerdefiniert'
        elif today < prob_end:
            term_date = (today + datetime.timedelta(days=14)).isoformat()
            notice = '2 Wochen (Probezeit)'
        else:
            term_date = (today + datetime.timedelta(days=28))
            term_date = term_date.replace(day=1) + datetime.timedelta(days=32)
            term_date = term_date.replace(day=1) - datetime.timedelta(days=1)
            term_date = term_date.isoformat()
            notice = '4 Wochen zum Monatsende'

        emp_dict = self.dict_from_row(emp)
        pdf_path = generate_termination_pdf(emp_dict, term_date, notice)

        c = conn.execute("""
            INSERT INTO documents (employee_id,type,title,file_path,status,created_by)
            VALUES (?,'termination',?,?,'draft',?)
        """, (emp['id'], f"Kündigung - {emp['first_name']} {emp['last_name']}", pdf_path, user['id']))

        conn.execute("UPDATE employees SET status='terminated', termination_date=? WHERE id=?", (term_date, emp['id']))
        conn.commit()
        conn.close()

        self.write({"document_id": c.lastrowid, "termination_date": term_date, "notice_period": notice,
                     "in_probation": today < prob_end, "message": "Kündigungsschreiben erstellt"})

# ============================================================
# SHIFTS
# ============================================================
SHIFT_TYPES = {
    'morning': {'start': '08:30', 'end': '14:00', 'label': 'Frühschicht'},
    'afternoon': {'start': '13:00', 'end': '20:00', 'label': 'Mittagsschicht'},
    'evening': {'start': '17:00', 'end': '00:30', 'label': 'Spätschicht'}
}

class ShiftsHandler(BaseHandler):
    def get(self):
        user = self.require_auth()
        if not user:
            return
        loc_id = self.get_argument('location_id', user.get('location_id'))
        start = self.get_argument('start_date', '')
        end = self.get_argument('end_date', '')
        if not loc_id or not start or not end:
            self.set_status(400)
            self.write({"error": "location_id, start_date, end_date erforderlich"})
            return
        conn = get_db()
        shifts = conn.execute("""
            SELECT s.* FROM shifts s WHERE s.location_id=? AND s.date BETWEEN ? AND ? ORDER BY s.date, s.shift_type
        """, (loc_id, start, end)).fetchall()

        result = []
        for s in shifts:
            assignments = conn.execute("""
                SELECT sa.*, e.first_name, e.last_name, e.profession_id, p.name_de as profession_name
                FROM shift_assignments sa JOIN employees e ON sa.employee_id = e.id
                JOIN professions p ON e.profession_id = p.id WHERE sa.shift_id = ?
            """, (s['id'],)).fetchall()

            cooks = len([a for a in assignments if a['profession_id'] == 1])
            bakers = len([a for a in assignments if a['profession_id'] == 2])
            result.append({
                **self.dict_from_row(s),
                'assignments': self.rows_to_list(assignments),
                'shift_info': SHIFT_TYPES.get(s['shift_type'], {}),
                'staffing': {
                    'cooks': cooks, 'bakers': bakers,
                    'required_cooks': 2, 'required_bakers': 2,
                    'is_complete': cooks >= 2 and bakers >= 2
                }
            })
        conn.close()
        self.write(json.dumps(result))

class ShiftGenerateHandler(BaseHandler):
    def post(self):
        user = self.require_auth()
        if not user:
            return
        data = self.get_json()
        loc_id = data.get('location_id', user.get('location_id'))
        year = data['year']
        month = data['month']
        import calendar
        days = calendar.monthrange(year, month)[1]
        conn = get_db()
        for day in range(1, days + 1):
            date = f"{year}-{month:02d}-{day:02d}"
            for stype, times in SHIFT_TYPES.items():
                conn.execute("INSERT OR IGNORE INTO shifts (location_id,date,shift_type,start_time,end_time) VALUES (?,?,?,?,?)",
                           (loc_id, date, stype, times['start'], times['end']))
        conn.commit()
        conn.close()
        self.write({"message": f"Schichten für {month}/{year} generiert"})

class ShiftAssignHandler(BaseHandler):
    def post(self, shift_id):
        user = self.require_auth()
        if not user:
            return
        data = self.get_json()
        conn = get_db()
        try:
            conn.execute("INSERT INTO shift_assignments (shift_id,employee_id) VALUES (?,?)", (shift_id, data['employee_id']))
            conn.commit()
            self.write({"message": "Zugewiesen"})
        except Exception as e:
            self.set_status(400)
            self.write({"error": str(e)})
        finally:
            conn.close()

    def delete(self, shift_id):
        user = self.require_auth()
        if not user:
            return
        emp_id = self.get_argument('employee_id')
        conn = get_db()
        conn.execute("DELETE FROM shift_assignments WHERE shift_id=? AND employee_id=?", (shift_id, emp_id))
        conn.commit()
        conn.close()
        self.write({"message": "Entfernt"})

class WishDaysHandler(BaseHandler):
    def get(self):
        user = self.require_auth()
        if not user:
            return
        loc_id = self.get_argument('location_id', user.get('location_id'))
        month_year = self.get_argument('month_year', '')
        conn = get_db()
        rows = conn.execute("""
            SELECT wd.*, e.first_name, e.last_name FROM wish_days wd
            JOIN employees e ON wd.employee_id = e.id
            WHERE e.location_id = ? AND wd.month_year = ?
        """, (loc_id, month_year)).fetchall()
        conn.close()
        self.write(json.dumps(self.rows_to_list(rows)))

    def post(self):
        data = self.get_json()
        conn = get_db()
        conn.execute("DELETE FROM wish_days WHERE employee_id=? AND month_year=?", (data['employee_id'], data['month_year']))
        for day in data.get('days', []):
            conn.execute("INSERT INTO wish_days (employee_id,date,type,month_year) VALUES (?,?,?,?)",
                       (data['employee_id'], day['date'], day.get('type', 'off'), data['month_year']))
        conn.commit()
        conn.close()
        self.write({"message": "Wunschtage gespeichert"})

# ============================================================
# BONUS
# ============================================================
class BonusCriteriaHandler(BaseHandler):
    def get(self):
        conn = get_db()
        rows = conn.execute("SELECT * FROM bonus_criteria WHERE is_active=1 ORDER BY sort_order").fetchall()
        conn.close()
        self.write(json.dumps(self.rows_to_list(rows)))

class BonusEvaluateHandler(BaseHandler):
    def post(self):
        user = self.require_auth()
        if not user:
            return
        data = self.get_json()
        emp_id = data['employee_id']
        month = data['month']
        year = data['year']
        items = data.get('items', [])

        conn = get_db()
        emp = conn.execute("SELECT * FROM employees WHERE id=? AND status='active'", (emp_id,)).fetchone()
        if not emp:
            conn.close()
            self.set_status(404)
            self.write({"error": "Nicht gefunden"})
            return

        criteria = conn.execute("SELECT * FROM bonus_criteria WHERE is_active=1").fetchall()
        total_weight = sum(c['weight'] for c in criteria)
        fulfilled_weight = 0
        for item in items:
            crit = next((c for c in criteria if c['id'] == item['criterion_id']), None)
            if crit and item.get('fulfilled'):
                fulfilled_weight += crit['weight']

        percentage = (fulfilled_weight / total_weight * 100) if total_weight > 0 else 0
        bonus_pct = 15 if percentage >= 75 else (7.5 if percentage >= 45 else 0)
        bonus_amount = (emp['monthly_salary'] or 0) * bonus_pct / 100

        # Upsert
        existing = conn.execute("SELECT id FROM bonus_evaluations WHERE employee_id=? AND month=? AND year=?", (emp_id, month, year)).fetchone()
        if existing:
            conn.execute("UPDATE bonus_evaluations SET total_score=?,percentage=?,bonus_percentage=?,bonus_amount=?,evaluator_id=?,status='submitted' WHERE id=?",
                       (fulfilled_weight, percentage, bonus_pct, bonus_amount, user['id'], existing['id']))
            eval_id = existing['id']
            conn.execute("DELETE FROM bonus_evaluation_items WHERE evaluation_id=?", (eval_id,))
        else:
            c = conn.execute("INSERT INTO bonus_evaluations (employee_id,evaluator_id,month,year,total_score,percentage,bonus_percentage,bonus_amount,status) VALUES (?,?,?,?,?,?,?,?,'submitted')",
                           (emp_id, user['id'], month, year, fulfilled_weight, percentage, bonus_pct, bonus_amount))
            eval_id = c.lastrowid

        for item in items:
            conn.execute("INSERT INTO bonus_evaluation_items (evaluation_id,criterion_id,fulfilled,note) VALUES (?,?,?,?)",
                       (eval_id, item['criterion_id'], 1 if item.get('fulfilled') else 0, item.get('note')))
        conn.commit()
        conn.close()

        self.write({
            "evaluation_id": eval_id,
            "percentage": round(percentage, 2),
            "bonus_percentage": bonus_pct,
            "bonus_amount": round(bonus_amount, 2),
            "monthly_salary": emp['monthly_salary'],
            "message": f"Bonus: {percentage:.1f}% erfüllt -> {bonus_pct}% = {bonus_amount:.2f} EUR"
        })

class BonusEvaluationsHandler(BaseHandler):
    def get(self):
        user = self.require_auth()
        if not user:
            return
        month = self.get_argument('month', None)
        year = self.get_argument('year', None)
        loc_id = self.get_argument('location_id', user.get('location_id') if user['role'] == 'branch_manager' else None)

        conn = get_db()
        query = """SELECT be.*, e.first_name, e.last_name, e.monthly_salary, p.name_de as profession_name
                   FROM bonus_evaluations be JOIN employees e ON be.employee_id = e.id
                   JOIN professions p ON e.profession_id = p.id WHERE 1=1"""
        params = []
        if loc_id:
            query += " AND e.location_id=?"
            params.append(loc_id)
        if month:
            query += " AND be.month=?"
            params.append(month)
        if year:
            query += " AND be.year=?"
            params.append(year)
        query += " ORDER BY e.last_name"
        rows = conn.execute(query, params).fetchall()
        conn.close()
        self.write(json.dumps(self.rows_to_list(rows)))

# ============================================================
# PERSONIO (Mock Interface)
# ============================================================
class PersonioPushHandler(BaseHandler):
    def post(self, emp_id):
        user = self.require_admin()
        if not user:
            return
        conn = get_db()
        emp = conn.execute("SELECT e.*, c.name as company_name, l.city as location_city FROM employees e JOIN companies c ON e.company_id = c.id JOIN locations l ON e.location_id = l.id WHERE e.id=?", (emp_id,)).fetchone()
        conn.close()
        if not emp:
            self.set_status(404)
            self.write({"error": "Nicht gefunden"})
            return
        self.write({
            "message": "Personio-Integration vorbereitet (Mock)",
            "mock": True,
            "data": {"name": f"{emp['first_name']} {emp['last_name']}", "company": emp['company_name'], "location": emp['location_city']}
        })

class PersonioSyncHandler(BaseHandler):
    def post(self):
        user = self.require_admin()
        if not user:
            return
        self.write({"message": "Personio-Sync vorbereitet (API-Credentials benötigt)", "mock": True})

# ============================================================
# SHIFT TYPES INFO
# ============================================================
class ShiftTypesHandler(BaseHandler):
    def get(self):
        self.write(json.dumps(SHIFT_TYPES))

# ============================================================
# TRANSLATIONS
# ============================================================
class TranslationsHandler(BaseHandler):
    def get(self):
        trans_file = BASE_DIR / "translations" / "questionnaire.json"
        if trans_file.exists():
            self.set_header("Content-Type", "application/json")
            self.write(trans_file.read_text())
        else:
            self.write("{}")

# ============================================================
# APPLICATION
# ============================================================
class RootHandler(BaseHandler):
    def get(self):
        try:
            with open(INDEX_HTML_PATH, 'r', encoding='utf-8') as f:
                self.set_header("Content-Type", "text/html; charset=utf-8")
                self.write(f.read())
        except Exception as e:
            self.set_header("Content-Type", "text/html; charset=utf-8")
            self.write(f"<h1>ERROR</h1><p>{str(e)}</p>")

def make_app():
    return tornado.web.Application([
        # WICHTIG: Root MUSS ERSTE sein!
        (r"^/$", RootHandler),
        # Auth
        (r"/api/auth/login", LoginHandler),
        (r"/api/auth/me", MeHandler),
        (r"/api/auth/users", UsersHandler),
        # Master data
        (r"/api/master-data/companies", CompaniesHandler),
        (r"/api/master-data/locations", LocationsHandler),
        (r"/api/master-data/professions", ProfessionsHandler),
        (r"/api/master-data/health-insurances", HealthInsurancesHandler),
        (r"/api/master-data/dashboard-stats", DashboardStatsHandler),
        # Questionnaire
        (r"/api/questionnaire/invite", QuestionnaireInviteHandler),
        (r"/api/questionnaire/([a-f0-9-]+)", QuestionnaireDetailHandler),
        (r"/api/questionnaire/([a-f0-9-]+)/submit", QuestionnaireSubmitHandler),
        # Employees
        (r"/api/employees", EmployeesHandler),
        (r"/api/employees/(\d+)", EmployeeDetailHandler),
        # Contracts
        (r"/api/contracts", ContractsHandler),
        (r"/api/contracts/generate/(\d+)", GenerateContractHandler),
        # Documents
        (r"/api/documents/generate/termination/(\d+)", TerminationHandler),
        # Shifts
        (r"/api/shifts", ShiftsHandler),
        (r"/api/shifts/generate", ShiftGenerateHandler),
        (r"/api/shifts/(\d+)/assign", ShiftAssignHandler),
        (r"/api/shifts/wish-days", WishDaysHandler),
        (r"/api/shifts/types", ShiftTypesHandler),
        # Bonus
        (r"/api/bonus/criteria", BonusCriteriaHandler),
        (r"/api/bonus/evaluate", BonusEvaluateHandler),
        (r"/api/bonus/evaluations", BonusEvaluationsHandler),
        # Personio
        (r"/api/personio/push-employee/(\d+)", PersonioPushHandler),
        (r"/api/personio/sync", PersonioSyncHandler),
        # Translations
        (r"/api/translations", TranslationsHandler),
        # Health
        (r"/api/health", type('Health', (BaseHandler,), {'get': lambda self: self.write({"status": "ok"})})),
    ], debug=True)

if __name__ == "__main__":
    print("Initializing database...")
    init_db()
    seed_db()
    app = make_app()
    app.listen(PORT, address="0.0.0.0")
    print(f"\n{'='*50}")
    print(f"  ORNC HR Portal running on 0.0.0.0:{PORT}")
    print(f"  Admin Login: admin@ornc.de / admin123")
    print(f"{'='*50}\n")
    tornado.ioloop.IOLoop.current().start()
