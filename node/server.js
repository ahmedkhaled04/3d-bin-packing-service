'use strict';

require('dotenv').config();

const app  = require('./src/app');
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('─────────────────────────────────────────');
  console.log('  3D Bin-Packing Microservice');
  console.log(`  Listening on http://localhost:${PORT}`);
  console.log('─────────────────────────────────────────');
  console.log(`  POST /api/pack    → solve bin packing`);
  console.log(`  GET  /api/health  → liveness check`);
  console.log('─────────────────────────────────────────');
});
