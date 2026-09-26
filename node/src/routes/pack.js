'use strict';

const express    = require('express');
const router     = express.Router();
const packSchema = require('../validators/packSchema');
const { callSolver } = require('../services/solverBridge');

/**
 * POST /api/pack
 * ──────────────
 * Accepts a dynamic bin-packing request, validates it with Joi,
 * passes it to the Python solver, and returns the 3D layout.
 *
 * Request body:
 *   { bins: [...], items: [...], options: {...} }
 *
 * Success response (200):
 *   {
 *     success: true,
 *     data: {
 *       bins: [ { name, dimensions, items: [ { name, position, dimensions, color, ... } ] } ],
 *       unfitted_items: [...],
 *       summary: { total_items, fitted_items, unfitted_items, bins_used }
 *     }
 *   }
 *
 * Error responses:
 *   400 — validation error (bad input)
 *   422 — solver returned a logical error
 *   500 — unexpected server / solver crash
 */
router.post('/', async (req, res, next) => {
  // ── Step 1: Validate input ─────────────────────────────────────────────
  const { error, value: payload } = packSchema.validate(req.body, {
    abortEarly: false,      // collect ALL validation errors, not just the first
    stripUnknown: true,     // silently drop any extra fields the client sends
    convert: true,          // coerce strings to numbers where schema expects numbers
  });

  if (error) {
    return res.status(400).json({
      success: false,
      error:   'Validation failed',
      details: error.details.map((d) => ({
        field:   d.path.join('.'),
        message: d.message,
      })),
    });
  }

  // ── Step 2: Call Python solver ─────────────────────────────────────────
  try {
    const result = await callSolver(payload);

    return res.status(200).json({
      success: true,
      data:    result,
    });

  } catch (err) {
    // Pass solver errors to the global error handler (app.js)
    next(err);
  }
});

module.exports = router;
