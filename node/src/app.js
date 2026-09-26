'use strict';

require('dotenv').config();

const express = require('express');
const app     = express();

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));  // parse JSON bodies up to 1MB

// ── Routes ─────────────────────────────────────────────────────────────────

/**
 * GET /api/health
 * Quick liveness check — returns server status and timestamp.
 * Used by Docker health checks and monitoring tools.
 */
app.get('/api/health', (req, res) => {
  res.json({
    status:    'ok',
    service:   '3d-bin-packing',
    timestamp: new Date().toISOString(),
    python:    process.env.PYTHON_CMD || 'py',
  });
});

/**
 * POST /api/pack
 * Core endpoint — accepts bins + items, returns 3D packing layout.
 */
app.use('/api/pack', require('./routes/pack'));

// ── 404 handler ────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error:   `Route not found: ${req.method} ${req.path}`,
  });
});

// ── Global error handler ───────────────────────────────────────────────────
// Catches anything passed to next(err) — solver crashes, timeouts, etc.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);

  // Distinguish solver logic errors from unexpected crashes
  const isSolverError = err.message.includes('Solver');
  const statusCode    = isSolverError ? 422 : 500;

  res.status(statusCode).json({
    success: false,
    error:   err.message || 'Internal server error',
  });
});

module.exports = app;
