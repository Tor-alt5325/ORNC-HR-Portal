const { getDatabase } = require('./database');
const bcrypt = require('bcryptjs');

function seed() {
  const db = getDatabase();

  // Companies
  const insertCompany = db.prepare('INSERT OR IGNORE INTO companies (id, name, short_name) VALUES (?, ?, ?)');
  insertCompany.run(1, 'ORNC GmbH', 'ORNC');
  insertCompany.run(2, 'ORNC II GmbH', 'ORNC II');
  insertCompany.run(3, 'ORNC III GmbH', 'ORNC III');

  // Locations
  const insertLocation = db.prepare('INSERT OR IGNORE INTO locations (id, company_id, city) VALUES (?, ?, ?)');
  insertLocation.run(1, 1, 'Magdeburg');
  insertLocation.run(2, 1, 'Berlin');
  insertLocation.run(3, 2, 'Köln');
  insertLocation.run(4, 2, 'Bonn');
  insertLocation.run(5, 3, 'Nürnberg');
  insertLocation.run(6, 3, 'Augsburg');

  // Professions
  const insertProfession = db.prepare('INSERT OR IGNORE INTO professions (id, name_de, name_en, hourly_rate) VALUES (?, ?, ?, ?)');
  insertProfession.run(1, 'Koch', 'Cook', 20.00);
  insertProfession.run(2, 'Bäcker', 'Baker', 25.00);

  // Health Insurances (all major German ones)
  const insurances = [
    ['AOK Baden-Württemberg', 'AOK BW', 'GKV'],
    ['AOK Bayern', 'AOK BY', 'GKV'],
    ['AOK Bremen/Bremerhaven', 'AOK HB', 'GKV'],
    ['AOK Hessen', 'AOK HE', 'GKV'],
    ['AOK Niedersachsen', 'AOK NI', 'GKV'],
    ['AOK Nordost', 'AOK NO', 'GKV'],
    ['AOK Nordwest', 'AOK NW', 'GKV'],
    ['AOK Plus', 'AOK Plus', 'GKV'],
    ['AOK Rheinland/Hamburg', 'AOK RH', 'GKV'],
    ['AOK Rheinland-Pfalz/Saarland', 'AOK RPS', 'GKV'],
    ['AOK Sachsen-Anhalt', 'AOK ST', 'GKV'],
    ['BARMER', 'BARMER', 'GKV'],
    ['BIG direkt gesund', 'BIG', 'GKV'],
    ['BKK firmus', 'BKK firmus', 'GKV'],
    ['BKK Linde', 'BKK Linde', 'GKV'],
    ['BKK Mobil Oil', 'BKK Mobil', 'GKV'],
    ['BKK ProVita', 'BKK ProVita', 'GKV'],
    ['BKK VBU', 'BKK VBU', 'GKV'],
    ['Bosch BKK', 'Bosch BKK', 'GKV'],
    ['Continentale BKK', 'Cont. BKK', 'GKV'],
    ['DAK-Gesundheit', 'DAK', 'GKV'],
    ['Debeka BKK', 'Debeka BKK', 'GKV'],
    ['Die Techniker (TK)', 'TK', 'GKV'],
    ['energie-BKK', 'energie-BKK', 'GKV'],
    ['HEK - Hanseatische Krankenkasse', 'HEK', 'GKV'],
    ['hkk Krankenkasse', 'hkk', 'GKV'],
    ['IKK Brandenburg und Berlin', 'IKK BB', 'GKV'],
    ['IKK classic', 'IKK classic', 'GKV'],
    ['IKK gesund plus', 'IKK gesund+', 'GKV'],
    ['IKK Südwest', 'IKK SW', 'GKV'],
    ['Kaufmännische Krankenkasse (KKH)', 'KKH', 'GKV'],
    ['Knappschaft', 'Knappschaft', 'GKV'],
    ['mhplus BKK', 'mhplus', 'GKV'],
    ['Novitas BKK', 'Novitas', 'GKV'],
    ['pronova BKK', 'pronova', 'GKV'],
    ['R+V BKK', 'R+V BKK', 'GKV'],
    ['Salus BKK', 'Salus BKK', 'GKV'],
    ['SBK (Siemens-Betriebskrankenkasse)', 'SBK', 'GKV'],
    ['SECURVITA Krankenkasse', 'SECURVITA', 'GKV'],
    ['SVLFG', 'SVLFG', 'GKV'],
    ['Techniker Krankenkasse', 'TK', 'GKV'],
    ['VIACTIV Krankenkasse', 'VIACTIV', 'GKV'],
    ['vivida bkk', 'vivida', 'GKV'],
    // Private
    ['Allianz Private Krankenversicherung', 'Allianz PKV', 'PKV'],
    ['AXA Krankenversicherung', 'AXA PKV', 'PKV'],
    ['Barmenia Krankenversicherung', 'Barmenia PKV', 'PKV'],
    ['Continentale Krankenversicherung', 'Cont. PKV', 'PKV'],
    ['Debeka Krankenversicherung', 'Debeka PKV', 'PKV'],
    ['DKV Deutsche Krankenversicherung', 'DKV', 'PKV'],
    ['Gothaer Krankenversicherung', 'Gothaer PKV', 'PKV'],
    ['HanseMerkur Krankenversicherung', 'HanseMerkur', 'PKV'],
    ['HUK-COBURG Krankenversicherung', 'HUK PKV', 'PKV'],
    ['Inter Krankenversicherung', 'Inter PKV', 'PKV'],
    ['LVM Krankenversicherung', 'LVM PKV', 'PKV'],
    ['Münchener Verein Krankenversicherung', 'Münch. Verein', 'PKV'],
    ['SIGNAL IDUNA Krankenversicherung', 'SIGNAL PKV', 'PKV'],
    ['Württembergische Krankenversicherung', 'Württemb. PKV', 'PKV'],
  ];

  const insertInsurance = db.prepare('INSERT OR IGNORE INTO health_insurances (name, short_name, type) VALUES (?, ?, ?)');
  for (const ins of insurances) {
    insertInsurance.run(...ins);
  }

  // Bonus Criteria
  const criteria = [
    ['Pünktlich zur Arbeit erschienen', 'Arrived at work on time', 'Mitarbeiter erscheint regelmäßig pünktlich zum Schichtbeginn', 'Employee regularly arrives on time for shift start', 1.0, 1],
    ['Fristgerechte Krankmeldung', 'Timely sick leave notification', 'Bei Krankheit wird fristgerecht (vor Schichtbeginn) gemeldet', 'Sick leave is reported in a timely manner (before shift start)', 1.0, 2],
    ['Saubere Arbeitskleidung getragen', 'Wore clean work clothing', 'Mitarbeiter trägt stets saubere und ordnungsgemäße Arbeitskleidung', 'Employee always wears clean and proper work clothing', 1.0, 3],
    ['Hygienevorschriften eingehalten', 'Hygiene standards maintained', 'Alle Hygienevorschriften werden konsequent eingehalten', 'All hygiene regulations are consistently followed', 1.0, 4],
    ['Teamarbeit und Kollegialität', 'Teamwork and collegiality', 'Gute Zusammenarbeit mit Kollegen', 'Good cooperation with colleagues', 1.0, 5],
  ];

  const insertCriterion = db.prepare('INSERT OR IGNORE INTO bonus_criteria (name_de, name_en, description_de, description_en, weight, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
  for (const c of criteria) {
    insertCriterion.run(...c);
  }

  // Default Admin User
  const passwordHash = bcrypt.hashSync('admin123', 10);
  const insertUser = db.prepare('INSERT OR IGNORE INTO users (id, email, password_hash, first_name, last_name, role) VALUES (?, ?, ?, ?, ?, ?)');
  insertUser.run(1, 'admin@ornc.de', passwordHash, 'Admin', 'ORNC', 'admin');

  // Branch Managers (2 per location)
  const bmHash = bcrypt.hashSync('manager123', 10);
  let userId = 2;
  const locations = [
    [1, 'Magdeburg'], [2, 'Berlin'], [3, 'Köln'],
    [4, 'Bonn'], [5, 'Nürnberg'], [6, 'Augsburg']
  ];
  for (const [locId, city] of locations) {
    insertUser.run(userId++, `fl1.${city.toLowerCase()}@ornc.de`, bmHash, 'Filialleiter 1', city, 'branch_manager');
    insertUser.run(userId++, `fl2.${city.toLowerCase()}@ornc.de`, bmHash, 'Filialleiter 2', city, 'branch_manager');
    // Update location_id
    db.prepare('UPDATE users SET location_id = ? WHERE id = ? OR id = ?').run(locId, userId - 2, userId - 1);
  }

  console.log('Database seeded successfully!');
  console.log('Admin login: admin@ornc.de / admin123');
  console.log('Branch manager logins: fl1.<city>@ornc.de / manager123');
}

seed();
