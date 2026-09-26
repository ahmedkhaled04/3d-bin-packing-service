'use strict';

const { spawn } = require('child_process');
const path      = require('path');

/**
 * solverBridge.js
 * ───────────────
 * Spawns the Python solver as a child process, pipes the JSON payload
 * into its stdin, collects stdout, and resolves with the parsed result.
 *
 * Node.js  ──stdin──►  solver.py  ──stdout──►  Node.js
 *
 * @param {Object} payload  - Validated pack request (bins + items + options)
 * @returns {Promise<Object>} Parsed JSON response from the solver
 */
function callSolver(payload) {
  return new Promise((resolve, reject) => {

    // ── Config from environment ──────────────────────────────────────────
    const pythonCmd  = process.env.PYTHON_CMD   || 'py';
    const solverPath = process.env.SOLVER_PATH
      ? path.resolve(__dirname, '..', '..', process.env.SOLVER_PATH)
      : path.resolve(__dirname, '..', '..', '..', 'python', 'solver.py');
    const timeoutMs  = parseInt(process.env.SOLVER_TIMEOUT_MS || '30000', 10);

    // ── Spawn child process ──────────────────────────────────────────────
    const child = spawn(pythonCmd, [solverPath], {
      env: { ...process.env, PYTHONUTF8: '1' },  // force UTF-8 on Windows
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    // ── Timeout guard ────────────────────────────────────────────────────
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      reject(new Error(`Solver timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    // ── Collect stdout (JSON result from solver) ─────────────────────────
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    // ── Collect stderr (Python tracebacks / warnings) ────────────────────
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    // ── Write payload JSON to solver's stdin then close ──────────────────
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();

    // ── Handle process exit ──────────────────────────────────────────────
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return; // already rejected above

      if (code !== 0) {
        return reject(
          new Error(`Solver process exited with code ${code}.\nstderr: ${stderr}`)
        );
      }

      if (!stdout.trim()) {
        return reject(new Error('Solver returned empty output.'));
      }

      // ── Parse and validate the JSON response ─────────────────────────
      let result;
      try {
        result = JSON.parse(stdout);
      } catch (e) {
        return reject(new Error(`Failed to parse solver output as JSON: ${e.message}\nRaw: ${stdout.slice(0, 200)}`));
      }

      if (!result.success) {
        return reject(new Error(`Solver reported failure: ${result.error}`));
      }

      resolve(result);
    });

    // ── Handle spawn errors (e.g. Python not found) ──────────────────────
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn solver process: ${err.message}`));
    });
  });
}

module.exports = { callSolver };
