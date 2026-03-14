require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const { getDatabase } = require('./config/database');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Static files for uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Initialize DB
getDatabase();

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/questionnaire', require('./routes/questionnaire'));
app.use('/api/contracts', require('./routes/contracts'));
app.use('/api/documents', require('./routes/documents'));
app.use('/api/shifts', require('./routes/shifts'));
app.use('/api/bonus', require('./routes/bonus'));
app.use('/api/master-data', require('./routes/masterData'));
app.use('/api/personio', require('./routes/personio'));
app.use('/api/gdrive', require('./routes/gdrive'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Interner Serverfehler', details: err.message });
});

app.listen(PORT, () => {
  console.log(`ORNC HR Portal Backend running on port ${PORT}`);
});

module.exports = app;
