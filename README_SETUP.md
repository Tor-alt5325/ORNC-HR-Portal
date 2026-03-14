# ORNC HR Portal - Setup & Anleitung

## Schnellstart

### Voraussetzungen
- Python 3.8+ (mit pip)
- Folgende Python-Pakete: `tornado`, `PyJWT`, `reportlab`, `pdfkit`

### Installation

```bash
# In das Projektverzeichnis wechseln
cd hr-portal/backend

# Optional: fehlende Pakete installieren
pip install tornado PyJWT reportlab pdfkit

# Server starten
python3 app.py
```

### Zugang
- **URL**: http://localhost:3001
- **Admin Login**: admin@ornc.de / admin123
- **Filialleiter**: fl1.magdeburg@ornc.de / manager123 (analog für andere Standorte)

## Architektur

```
hr-portal/
├── backend/
│   ├── app.py                 # Hauptserver (Tornado)
│   ├── translations/          # Mehrsprachige Übersetzungen
│   │   └── questionnaire.json # DE, EN, BG, TR, FA, HR
│   ├── data/                  # SQLite Datenbank (automatisch erstellt)
│   └── uploads/               # Hochgeladene & generierte Dateien
│       ├── contracts/         # Arbeitsverträge (PDF)
│       ├── documents/         # Kündigungen, Nachträge (PDF)
│       └── questionnaire/     # Bewerberdokumente
└── frontend/
    └── public/
        └── index.html         # React SPA (Single Page Application)
```

## Module

### 1. Personalfragebogen (6 Sprachen + Vorlesen)
- HR wählt Gesellschaft, Standort, Beruf, Beschäftigungsart
- Fragebogen-Link wird per E-Mail an Bewerber gesendet
- Unterstützt: Deutsch, Englisch, Bulgarisch, Türkisch, Farsi (RTL), Kroatisch
- Text-to-Speech Vorlese-Funktion für jedes Feld

### 2. Automatische Vertragserstellung
- **Vollzeit**: 40h/Woche, 25 Urlaubstage (20 gesetzlich + 5 extra)
- **Teilzeit**: Stunden nach Vereinbarung
- **Minijob**: Max. 520€/Monat + RV-Befreiungsantrag
- **Werkstudent**: Immatrikulationsbescheinigung erforderlich

### 3. Lohnabrechnung (automatisch)
| Typ | BGRS | PGR |
|-----|------|-----|
| Vollzeit/Teilzeit | 1-1-1-1 | 101 |
| Minijob (mit RV-Befreiung) | 6-5-0-0 | 109 |
| Minijob (ohne RV-Befreiung) | 6-1-0-0 | 109 |
| Werkstudent | TBD | TBD |

### 4. Vorlagenverwaltung
- Kündigung mit automatischer Fristberechnung
- Nachtrag zum Arbeitsvertrag

### 5. Schichtplanung
- 3 Schichten: 08:30-14:00, 13:00-20:00, 17:00-00:30
- Je Schicht: 2 Köche + 2 Bäcker erforderlich
- Wunschtage bis 15. des Vormonats

### 6. Bonus-Checkliste
- 75-100% erfüllt → 15% Bonus
- 45-74% erfüllt → 7,5% Bonus
- Unter 45% → kein Bonus

### 7. Benutzerrollen
- **Admin/HR**: Vollzugriff auf alle Module
- **Filialleiter**: Schichtplanung + Bonus (nur eigener Standort)

### 8. Schnittstellen (vorbereitet)
- **Personio**: Push/Pull Mitarbeiterdaten, Bonus-Sync
- **Google Drive**: Dokumentenablage (aktive Mitarbeiter)

## Gesellschaften & Standorte

| Gesellschaft | Standort 1 | Standort 2 |
|---|---|---|
| ORNC GmbH | Magdeburg | Berlin |
| ORNC II GmbH | Köln | Bonn |
| ORNC III GmbH | Nürnberg | Augsburg |

## Berufe

| Beruf | Stundenlohn |
|---|---|
| Koch | 20,00 € |
| Bäcker | 25,00 € |

## SMTP-Konfiguration (für E-Mail-Versand)
Erstelle eine `.env` Datei im backend/ Ordner:
```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=hr@ornc.de
SMTP_PASS=dein-passwort
SMTP_FROM=HR Portal <hr@ornc.de>
```

## Personio-Konfiguration (wenn bereit)
```
PERSONIO_CLIENT_ID=dein-client-id
PERSONIO_CLIENT_SECRET=dein-secret
```
