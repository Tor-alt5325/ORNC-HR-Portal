const express = require('express');
const router = express.Router();
const { getDatabase } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

/*
 * GOOGLE DRIVE INTEGRATION (Prepared Interface)
 *
 * This module prepares the Google Drive integration for document storage.
 * Employee documents will be stored in Google Drive while the employee is active.
 *
 * Structure:
 * /HR Portal
 *   /ORNC GmbH
 *     /Magdeburg
 *       /Nachname_Vorname
 *         - Arbeitsvertrag.pdf
 *         - Personalfragebogen.pdf
 *         - Bonus-Bewertungen/
 *         - Sonstige Dokumente/
 */

const GDriveService = {
  async createEmployeeFolder(employee) {
    // TODO: Implement Google Drive API
    // Use googleapis npm package
    console.log('[GDrive] Would create folder for:', employee.first_name, employee.last_name);
    return { folder_id: `mock-folder-${employee.id}` };
  },

  async uploadDocument(folderId, filePath, fileName) {
    console.log('[GDrive] Would upload:', fileName, 'to folder:', folderId);
    return { file_id: `mock-file-${Date.now()}` };
  },

  async archiveEmployee(folderId) {
    console.log('[GDrive] Would archive folder:', folderId);
    return { success: true };
  }
};

// POST /api/gdrive/create-folder/:employeeId
router.post('/create-folder/:employeeId', authenticateToken, requireAdmin, async (req, res) => {
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

    if (!process.env.GOOGLE_DRIVE_CLIENT_ID) {
      return res.json({
        message: 'Google Drive Integration vorbereitet, aber noch nicht konfiguriert.',
        mock: true,
        folder_structure: {
          root: 'HR Portal',
          company: employee.company_name,
          location: employee.location_city,
          employee: `${employee.last_name}_${employee.first_name}`,
          subfolders: ['Arbeitsvertrag', 'Personalfragebogen', 'Bonus-Bewertungen', 'Sonstige Dokumente']
        }
      });
    }

    const result = await GDriveService.createEmployeeFolder(employee);
    db.prepare('UPDATE employees SET gdrive_folder_id = ? WHERE id = ?')
      .run(result.folder_id, employee.id);

    res.json({ message: 'Google Drive Ordner erstellt.', folder_id: result.folder_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/gdrive/upload/:employeeId
router.post('/upload/:employeeId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!process.env.GOOGLE_DRIVE_CLIENT_ID) {
      return res.json({
        message: 'Google Drive Integration vorbereitet, aber noch nicht konfiguriert.',
        mock: true
      });
    }

    const db = getDatabase();
    const employee = db.prepare('SELECT gdrive_folder_id FROM employees WHERE id = ?').get(req.params.employeeId);

    if (!employee?.gdrive_folder_id) {
      return res.status(400).json({ error: 'Kein Google Drive Ordner für diesen Mitarbeiter.' });
    }

    const { file_path, file_name } = req.body;
    const result = await GDriveService.uploadDocument(employee.gdrive_folder_id, file_path, file_name);
    res.json({ message: 'Dokument hochgeladen.', file_id: result.file_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
