/**
 * Payroll Service - Calculates Beitragsgruppenschlüssel and Personenschlüssel
 *
 * Beitragsgruppenschlüssel (BGRS): KV-RV-AV-PV
 *   Vollzeit/Teilzeit: 1-1-1-1 (regulär versicherungspflichtig)
 *   Minijob (mit RV-Befreiung): 6-5-0-0
 *   Minijob (ohne RV-Befreiung): 6-1-0-0
 *   Werkstudent: TODO (Infos werden nachgereicht)
 *
 * Personenschlüssel (PGR):
 *   Vollzeit/Teilzeit: 101 (sozialversicherungspflichtig Beschäftigte)
 *   Minijob: 109 (geringfügig entlohnte Beschäftigte)
 *   Werkstudent: TODO (Infos werden nachgereicht)
 */

function calculatePayrollKeys(employmentType, rvExemption = false) {
  let beitragsgruppenschluessel;
  let personenschluessel;

  switch (employmentType) {
    case 'fulltime':
    case 'parttime':
      beitragsgruppenschluessel = '1-1-1-1';
      personenschluessel = '101';
      break;

    case 'minijob':
      if (rvExemption) {
        beitragsgruppenschluessel = '6-5-0-0';
      } else {
        beitragsgruppenschluessel = '6-1-0-0';
      }
      personenschluessel = '109';
      break;

    case 'werkstudent':
      // Placeholder - details to be provided
      beitragsgruppenschluessel = 'TBD';
      personenschluessel = 'TBD';
      break;

    default:
      beitragsgruppenschluessel = '1-1-1-1';
      personenschluessel = '101';
  }

  return {
    beitragsgruppenschluessel,
    personenschluessel,
    details: getPayrollDetails(employmentType, rvExemption)
  };
}

function getPayrollDetails(employmentType, rvExemption) {
  const details = {
    fulltime: {
      description: 'Sozialversicherungspflichtig beschäftigt (Vollzeit)',
      kv: '1 - Allgemeiner Beitrag',
      rv: '1 - Voller Beitrag',
      av: '1 - Voller Beitrag',
      pv: '1 - Voller Beitrag',
      pgr: '101 - Sozialversicherungspflichtig Beschäftigte ohne besondere Merkmale'
    },
    parttime: {
      description: 'Sozialversicherungspflichtig beschäftigt (Teilzeit)',
      kv: '1 - Allgemeiner Beitrag',
      rv: '1 - Voller Beitrag',
      av: '1 - Voller Beitrag',
      pv: '1 - Voller Beitrag',
      pgr: '101 - Sozialversicherungspflichtig Beschäftigte ohne besondere Merkmale'
    },
    minijob: {
      description: `Geringfügig entlohnte Beschäftigung${rvExemption ? ' (mit RV-Befreiung)' : ''}`,
      kv: '6 - Pauschalbeitrag',
      rv: rvExemption ? '5 - Arbeitgeberanteil' : '1 - Voller Beitrag',
      av: '0 - Kein Beitrag',
      pv: '0 - Kein Beitrag',
      pgr: '109 - Geringfügig entlohnte Beschäftigte nach § 8 Abs. 1 Nr. 1 SGB IV'
    },
    werkstudent: {
      description: 'Werkstudent (Details werden nachgereicht)',
      kv: 'TBD',
      rv: 'TBD',
      av: 'TBD',
      pv: 'TBD',
      pgr: 'TBD'
    }
  };

  return details[employmentType] || details.fulltime;
}

function calculateMonthlySalary(hourlyRate, weeklyHours) {
  return hourlyRate * weeklyHours * 4.33; // Average weeks per month
}

function calculateVacationDays(employmentType, weeklyHours, workDaysPerWeek = 5) {
  const baseVacation = 20; // Legal minimum for 5-day week
  const extraVacation = 5;  // Company extra

  switch (employmentType) {
    case 'fulltime':
      return baseVacation + extraVacation; // 25 days
    case 'parttime':
      return Math.round((workDaysPerWeek / 5) * (baseVacation + extraVacation));
    case 'minijob':
      return Math.round((workDaysPerWeek / 5) * baseVacation);
    case 'werkstudent':
      return Math.round((workDaysPerWeek / 5) * (baseVacation + extraVacation));
    default:
      return baseVacation;
  }
}

module.exports = {
  calculatePayrollKeys,
  getPayrollDetails,
  calculateMonthlySalary,
  calculateVacationDays
};
