const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const CONTRACTS_DIR = path.join(__dirname, '..', 'uploads', 'contracts');
const DOCS_DIR = path.join(__dirname, '..', 'uploads', 'documents');

// Ensure directories exist
[CONTRACTS_DIR, DOCS_DIR].forEach(dir => {
  fs.mkdirSync(dir, { recursive: true });
});

function generateContractPDF(data) {
  const { employee, contract_type } = data;
  const fileName = `Arbeitsvertrag_${employee.last_name}_${employee.first_name}_${Date.now()}.pdf`;
  const filePath = path.join(CONTRACTS_DIR, fileName);

  const doc = new PDFDocument({ size: 'A4', margin: 60 });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  // Header
  doc.fontSize(10).text(employee.company_name, { align: 'right' });
  doc.text(employee.location_city, { align: 'right' });
  doc.moveDown(2);

  // Title
  doc.fontSize(18).font('Helvetica-Bold').text('ARBEITSVERTRAG', { align: 'center' });
  doc.moveDown(0.5);

  const typeLabels = {
    fulltime: 'Vollzeit',
    parttime: 'Teilzeit',
    minijob: 'Geringfügige Beschäftigung (Minijob)',
    werkstudent: 'Werkstudent'
  };
  doc.fontSize(12).text(typeLabels[contract_type] || contract_type, { align: 'center' });
  doc.moveDown(2);

  // Parties
  doc.font('Helvetica').fontSize(10);
  doc.text('zwischen', { align: 'center' });
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').text(employee.company_name, { align: 'center' });
  doc.font('Helvetica').text(`${employee.location_city}`, { align: 'center' });
  doc.text('- nachfolgend "Arbeitgeber" genannt -', { align: 'center' });
  doc.moveDown(1);
  doc.text('und', { align: 'center' });
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').text(`${employee.first_name} ${employee.last_name}`, { align: 'center' });
  doc.font('Helvetica').text(`${employee.street || ''} ${employee.house_number || ''}`, { align: 'center' });
  doc.text(`${employee.zip_code || ''} ${employee.city || ''}`, { align: 'center' });
  doc.text('- nachfolgend "Arbeitnehmer" genannt -', { align: 'center' });
  doc.moveDown(1.5);

  doc.text('wird folgender Arbeitsvertrag geschlossen:');
  doc.moveDown(1);

  // Section helper
  const section = (num, title, content) => {
    doc.font('Helvetica-Bold').fontSize(11).text(`§ ${num} ${title}`);
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(10).text(content);
    doc.moveDown(1);
  };

  // § 1 Beginn und Dauer
  let durationText = `Das Arbeitsverhältnis beginnt am ${formatDate(employee.start_date)}.`;
  durationText += ` Es wird auf unbestimmte Zeit geschlossen.`;
  section(1, 'Beginn und Dauer des Arbeitsverhältnisses', durationText);

  // § 2 Probezeit
  section(2, 'Probezeit',
    `Die ersten 6 Monate des Arbeitsverhältnisses gelten als Probezeit. Während der Probezeit kann das Arbeitsverhältnis von beiden Seiten mit einer Frist von 2 Wochen gekündigt werden.`
  );

  // § 3 Tätigkeit
  section(3, 'Tätigkeit',
    `Der Arbeitnehmer wird als ${employee.profession_name || 'Mitarbeiter'} am Standort ${employee.location_city} eingestellt. Die nähere Beschreibung der Tätigkeit ergibt sich aus der Stellenbeschreibung.`
  );

  // § 4 Arbeitszeit
  let arbeitszeit;
  switch (contract_type) {
    case 'fulltime':
      arbeitszeit = `Die regelmäßige wöchentliche Arbeitszeit beträgt 40 Stunden. Die Verteilung der Arbeitszeit richtet sich nach dem Schichtplan des Arbeitgebers. Es werden 7 Tage die Woche in 3 Schichten gearbeitet.`;
      break;
    case 'parttime':
      arbeitszeit = `Die regelmäßige wöchentliche Arbeitszeit beträgt ${employee.weekly_hours} Stunden. Die Verteilung richtet sich nach dem Schichtplan.`;
      break;
    case 'minijob':
      arbeitszeit = `Die regelmäßige wöchentliche Arbeitszeit beträgt ${employee.weekly_hours} Stunden. Das monatliche Entgelt darf die Geringfügigkeitsgrenze von 520,00 EUR nicht überschreiten.`;
      break;
    case 'werkstudent':
      arbeitszeit = `Die regelmäßige wöchentliche Arbeitszeit beträgt ${employee.weekly_hours} Stunden. Während der Vorlesungszeit darf die Arbeitszeit 20 Stunden pro Woche nicht überschreiten.`;
      break;
  }
  section(4, 'Arbeitszeit', arbeitszeit);

  // § 5 Vergütung
  const vergütung = `Der Arbeitnehmer erhält einen Stundenlohn von ${employee.hourly_rate?.toFixed(2)} EUR brutto. Bei einer wöchentlichen Arbeitszeit von ${employee.weekly_hours} Stunden entspricht dies einem monatlichen Bruttogehalt von ca. ${employee.monthly_salary?.toFixed(2)} EUR.`;
  section(5, 'Vergütung', vergütung);

  // § 6 Urlaub
  section(6, 'Urlaub',
    `Der Arbeitnehmer hat Anspruch auf ${employee.vacation_days} Arbeitstage Urlaub pro Kalenderjahr${contract_type === 'fulltime' ? ' (20 gesetzliche + 5 zusätzliche Urlaubstage)' : ''}.`
  );

  // § 7 Kündigungsfristen
  section(7, 'Kündigungsfristen',
    `Nach Ablauf der Probezeit kann das Arbeitsverhältnis mit einer Frist von 4 Wochen zum 15. oder zum Ende eines Kalendermonats gekündigt werden. Es gelten die gesetzlichen Kündigungsfristen gemäß § 622 BGB.`
  );

  // § 8 Bonus
  section(8, 'Leistungsbonus',
    `Der Arbeitnehmer kann einen monatlichen Leistungsbonus erhalten. Die Höhe richtet sich nach der Erfüllung der Bonuskriterien: Bei 75-100% Erfüllung beträgt der Bonus 15% des Bruttogehalts, bei 45-74% beträgt er 7,5%. Unter 45% wird kein Bonus gezahlt.`
  );

  // § 9 Sonstiges
  section(9, 'Schlussbestimmungen',
    'Änderungen und Ergänzungen dieses Vertrages bedürfen der Schriftform. Sollte eine Bestimmung dieses Vertrages unwirksam sein, bleibt die Wirksamkeit der übrigen Bestimmungen unberührt.'
  );

  // Signatures
  doc.moveDown(2);
  doc.text(`${employee.location_city}, den _______________`);
  doc.moveDown(2);
  doc.text('_________________________          _________________________');
  doc.text('Arbeitgeber                                    Arbeitnehmer');

  doc.end();
  return filePath;
}

function generateRVExemptionPDF(employee) {
  const fileName = `RV_Befreiung_${employee.last_name}_${employee.first_name}_${Date.now()}.pdf`;
  const filePath = path.join(DOCS_DIR, fileName);

  const doc = new PDFDocument({ size: 'A4', margin: 60 });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  doc.fontSize(14).font('Helvetica-Bold')
    .text('Antrag auf Befreiung von der Rentenversicherungspflicht', { align: 'center' });
  doc.fontSize(10).font('Helvetica')
    .text('für geringfügig entlohnte Beschäftigte gemäß § 6 Abs. 1b SGB VI', { align: 'center' });
  doc.moveDown(2);

  doc.text('An den Arbeitgeber:');
  doc.font('Helvetica-Bold').text(employee.company_name);
  doc.font('Helvetica').text(employee.location_city);
  doc.moveDown(1.5);

  doc.text('Angaben zum Arbeitnehmer:');
  doc.moveDown(0.5);
  doc.text(`Name: ${employee.first_name} ${employee.last_name}`);
  doc.text(`Geburtsdatum: ${formatDate(employee.date_of_birth)}`);
  doc.text(`Sozialversicherungsnummer: ${employee.social_security_number || '________________'}`);
  doc.moveDown(1.5);

  doc.text('Hiermit beantrage ich die Befreiung von der Rentenversicherungspflicht in meiner geringfügig entlohnten Beschäftigung.');
  doc.moveDown(0.5);
  doc.text('Mir ist bekannt, dass ich mit der Befreiung auf den Erwerb von Pflichtbeitragszeiten und die damit verbundenen Leistungsansprüche in der gesetzlichen Rentenversicherung verzichte.');
  doc.moveDown(0.5);
  doc.text('Die Befreiung gilt für die gesamte Dauer dieser geringfügig entlohnten Beschäftigung und kann nicht widerrufen werden.');
  doc.moveDown(2);

  doc.text(`${employee.location_city}, den _______________`);
  doc.moveDown(2);
  doc.text('_________________________');
  doc.text('Unterschrift Arbeitnehmer');

  doc.end();
  return filePath;
}

function generateTerminationPDF(data) {
  const { employee, termination_date, reason, notice_period } = data;
  const fileName = `Kuendigung_${employee.last_name}_${employee.first_name}_${Date.now()}.pdf`;
  const filePath = path.join(DOCS_DIR, fileName);

  const doc = new PDFDocument({ size: 'A4', margin: 60 });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  // Header
  doc.fontSize(10).text(employee.company_name, { align: 'right' });
  doc.text(employee.location_city, { align: 'right' });
  doc.text(`Datum: ${formatDate(new Date().toISOString().split('T')[0])}`, { align: 'right' });
  doc.moveDown(2);

  // Recipient
  doc.text(`${employee.first_name} ${employee.last_name}`);
  doc.text(`${employee.street || ''} ${employee.house_number || ''}`);
  doc.text(`${employee.zip_code || ''} ${employee.city || ''}`);
  doc.moveDown(2);

  // Title
  doc.fontSize(14).font('Helvetica-Bold').text('Kündigung des Arbeitsverhältnisses');
  doc.moveDown(1);

  // Body
  doc.font('Helvetica').fontSize(11);
  doc.text(`Sehr geehrte/r Frau/Herr ${employee.last_name},`);
  doc.moveDown(0.5);
  doc.text(`hiermit kündigen wir das mit Ihnen bestehende Arbeitsverhältnis ordentlich und fristgerecht zum ${formatDate(termination_date)}.`);
  doc.moveDown(0.5);
  doc.text(`Kündigungsfrist: ${notice_period}`);
  if (reason) {
    doc.moveDown(0.5);
    doc.text(`Grund: ${reason}`);
  }
  doc.moveDown(0.5);
  doc.text('Wir bitten Sie, die Kündigung auf der beiliegenden Kopie zu bestätigen.');
  doc.moveDown(0.5);
  doc.text('Bitte denken Sie daran, sich rechtzeitig bei der Agentur für Arbeit arbeitssuchend zu melden.');
  doc.moveDown(1.5);

  doc.text('Mit freundlichen Grüßen');
  doc.moveDown(2);
  doc.text('_________________________');
  doc.text(employee.company_name);
  doc.moveDown(3);

  doc.text('Empfangsbestätigung:');
  doc.moveDown(1);
  doc.text('Die Kündigung habe ich am _______________ erhalten.');
  doc.moveDown(2);
  doc.text('_________________________');
  doc.text(`${employee.first_name} ${employee.last_name}`);

  doc.end();
  return filePath;
}

function generateAmendmentPDF(data) {
  const { employee, changes, effective_date } = data;
  const fileName = `Nachtrag_${employee.last_name}_${employee.first_name}_${Date.now()}.pdf`;
  const filePath = path.join(DOCS_DIR, fileName);

  const doc = new PDFDocument({ size: 'A4', margin: 60 });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  doc.fontSize(10).text(employee.company_name, { align: 'right' });
  doc.text(employee.location_city, { align: 'right' });
  doc.moveDown(2);

  doc.fontSize(16).font('Helvetica-Bold').text('Nachtrag zum Arbeitsvertrag', { align: 'center' });
  doc.moveDown(2);

  doc.font('Helvetica').fontSize(10);
  doc.text(`zwischen ${employee.company_name} (Arbeitgeber)`);
  doc.text(`und ${employee.first_name} ${employee.last_name} (Arbeitnehmer)`);
  doc.moveDown(1);
  doc.text(`wird der bestehende Arbeitsvertrag vom ${formatDate(employee.start_date)} wie folgt geändert:`);
  doc.moveDown(1);

  if (changes && Array.isArray(changes)) {
    changes.forEach((change, i) => {
      doc.font('Helvetica-Bold').text(`${i + 1}. ${change.field}:`);
      doc.font('Helvetica').text(`   Bisher: ${change.old_value}`);
      doc.text(`   Neu: ${change.new_value}`);
      doc.moveDown(0.5);
    });
  }

  doc.moveDown(0.5);
  doc.text(`Diese Änderungen treten zum ${formatDate(effective_date)} in Kraft.`);
  doc.text('Alle übrigen Bestimmungen des Arbeitsvertrages bleiben unberührt.');
  doc.moveDown(2);

  doc.text(`${employee.location_city}, den _______________`);
  doc.moveDown(2);
  doc.text('_________________________          _________________________');
  doc.text('Arbeitgeber                                    Arbeitnehmer');

  doc.end();
  return filePath;
}

function formatDate(dateStr) {
  if (!dateStr) return '_______________';
  const d = new Date(dateStr);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

module.exports = {
  generateContractPDF,
  generateRVExemptionPDF,
  generateTerminationPDF,
  generateAmendmentPDF
};
