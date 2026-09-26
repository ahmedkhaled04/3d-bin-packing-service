'use strict';

/**
 * integration.test.js
 * ====================
 * Full end-to-end integration tests for POST /api/pack and GET /api/health.
 * Uses supertest to fire real HTTP requests against the Express app,
 * which in turn spawns the Python solver as a child process.
 *
 * Run: npm test
 *
 * Test suite:
 *   1. Health check                    → GET /api/health returns 200 + status ok
 *   2. Canonical pallet (42 cartons)   → POST /api/pack fits 40-50 cartons per pallet
 *   3. Multi-bin overflow              → 150 cartons distributed across 2 pallets
 *   4. Large container (40ft, 500 qty) → all 500 fit in under 5 seconds
 *   5. Weight constraint               → heavy items stop packing at max_weight
 *   6. Invalid payload — empty bins    → 400 with field-level error
 *   7. Invalid payload — neg dimension → 400 with items.0.width error
 *   8. Unknown route                   → 404
 */

require('dotenv').config();
const request = require('supertest');
const app     = require('../src/app');

// Increase timeout for tests that call the Python solver
jest.setTimeout(30000);

// ---------------------------------------------------------------------------
// Shared payloads
// ---------------------------------------------------------------------------

const EURO_PALLET = { name: 'euro-pallet', width: 120, height: 162, depth: 100, max_weight: 1000 };
const MASTER_CARTON = { name: 'master-carton', width: 51, height: 21, depth: 27, weight: 10 };
const DEFAULT_OPTIONS = { bigger_first: true, distribute_items: false, number_of_decimals: 0 };

// ---------------------------------------------------------------------------
// Helper — assert every item in every bin has valid x,y,z coordinates
// ---------------------------------------------------------------------------
function assertAllItemsHaveCoords(bins) {
  for (const bin of bins) {
    for (const item of bin.items) {
      expect(item.position).toHaveProperty('x');
      expect(item.position).toHaveProperty('y');
      expect(item.position).toHaveProperty('z');
      expect(typeof item.position.x).toBe('number');
      expect(typeof item.position.y).toBe('number');
      expect(typeof item.position.z).toBe('number');
    }
  }
}

// ---------------------------------------------------------------------------
// Helper — assert no two items overlap (AABB bounding-box check)
// ---------------------------------------------------------------------------
function assertNoOverlaps(items) {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const ax1 = a.position.x, ax2 = ax1 + a.dimensions.w;
      const ay1 = a.position.y, ay2 = ay1 + a.dimensions.h;
      const az1 = a.position.z, az2 = az1 + a.dimensions.d;
      const bx1 = b.position.x, bx2 = bx1 + b.dimensions.w;
      const by1 = b.position.y, by2 = by1 + b.dimensions.h;
      const bz1 = b.position.z, bz2 = bz1 + b.dimensions.d;

      const overlap =
        ax1 < bx2 && ax2 > bx1 &&
        ay1 < by2 && ay2 > by1 &&
        az1 < bz2 && az2 > bz1;

      expect(overlap).toBe(false);
    }
  }
}

// ---------------------------------------------------------------------------
// TEST 1 — Health check
// ---------------------------------------------------------------------------
describe('GET /api/health', () => {
  test('returns 200 with status ok', async () => {
    const res = await request(app).get('/api/health');

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('3d-bin-packing');
    expect(res.body.timestamp).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// TEST 2 — Canonical pallet: 51×27×21 cm carton, 120×100×162 cm pallet
// ---------------------------------------------------------------------------
describe('POST /api/pack — canonical pallet scenario', () => {
  let res;

  beforeAll(async () => {
    res = await request(app)
      .post('/api/pack')
      .send({
        bins:    [EURO_PALLET],
        items:   [{ ...MASTER_CARTON, quantity: 100 }],
        options: DEFAULT_OPTIONS,
      });
  });

  test('returns HTTP 200', () => {
    expect(res.statusCode).toBe(200);
  });

  test('response shape is correct', () => {
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('bins');
    expect(res.body.data).toHaveProperty('unfitted_items');
    expect(res.body.data).toHaveProperty('summary');
  });

  test('uses exactly 1 bin', () => {
    expect(res.body.data.summary.bins_used).toBe(1);
  });

  test('fits between 40 and 50 cartons (real-world range)', () => {
    const fitted = res.body.data.summary.fitted_items;
    expect(fitted).toBeGreaterThanOrEqual(40);
    expect(fitted).toBeLessThanOrEqual(50);
  });

  test('all fitted items have valid X, Y, Z coordinates', () => {
    assertAllItemsHaveCoords(res.body.data.bins);
  });

  test('all fitted items have positive dimensions', () => {
    for (const item of res.body.data.bins[0].items) {
      expect(item.dimensions.w).toBeGreaterThan(0);
      expect(item.dimensions.h).toBeGreaterThan(0);
      expect(item.dimensions.d).toBeGreaterThan(0);
    }
  });

  test('no two items overlap inside the bin', () => {
    assertNoOverlaps(res.body.data.bins[0].items);
  });

  test('all items fit within bin boundaries', () => {
    const bin = res.body.data.bins[0];
    for (const item of bin.items) {
      expect(item.position.x + item.dimensions.w).toBeLessThanOrEqual(bin.dimensions.w + 0.01);
      expect(item.position.y + item.dimensions.h).toBeLessThanOrEqual(bin.dimensions.h + 0.01);
      expect(item.position.z + item.dimensions.d).toBeLessThanOrEqual(bin.dimensions.d + 0.01);
    }
  });

  test('each item has a hex color for Three.js', () => {
    for (const item of res.body.data.bins[0].items) {
      expect(item.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  test('utilization_pct is between 1 and 100', () => {
    const util = res.body.data.bins[0].utilization_pct;
    expect(util).toBeGreaterThan(1);
    expect(util).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// TEST 3 — Multi-bin overflow: 150 cartons across 2 pallets
// ---------------------------------------------------------------------------
describe('POST /api/pack — multi-bin overflow', () => {
  let res;

  beforeAll(async () => {
    res = await request(app)
      .post('/api/pack')
      .send({
        bins: [
          { ...EURO_PALLET, name: 'pallet-A' },
          { ...EURO_PALLET, name: 'pallet-B' },
        ],
        items:   [{ ...MASTER_CARTON, quantity: 150 }],
        options: DEFAULT_OPTIONS,
      });
  });

  test('returns HTTP 200', () => {
    expect(res.statusCode).toBe(200);
  });

  test('uses both bins', () => {
    expect(res.body.data.summary.bins_used).toBe(2);
  });

  test('both bins contain items', () => {
    for (const bin of res.body.data.bins) {
      expect(bin.items.length).toBeGreaterThan(0);
    }
  });

  test('total fitted + unfitted = 150', () => {
    const { fitted_items, unfitted_items } = res.body.data.summary;
    expect(fitted_items + unfitted_items).toBe(150);
  });

  test('all fitted items have valid coordinates', () => {
    assertAllItemsHaveCoords(res.body.data.bins);
  });
});

// ---------------------------------------------------------------------------
// TEST 4 — Large container: 500 cartons in a 40ft container (speed test)
// ---------------------------------------------------------------------------
describe('POST /api/pack — 40ft container, 500 items (speed test)', () => {
  let res;
  let elapsed;

  beforeAll(async () => {
    const start = Date.now();
    res = await request(app)
      .post('/api/pack')
      .send({
        bins: [{
          name: '40ft-container',
          width: 1200, height: 239, depth: 235,
          max_weight: 28000,
        }],
        items:   [{ ...MASTER_CARTON, quantity: 500 }],
        options: DEFAULT_OPTIONS,
      });
    elapsed = Date.now() - start;
  });

  test('returns HTTP 200', () => {
    expect(res.statusCode).toBe(200);
  });

  test('all 500 cartons fit in the container', () => {
    expect(res.body.data.summary.fitted_items).toBe(500);
    expect(res.body.data.summary.unfitted_items).toBe(0);
  });

  test('completes in under 5 seconds (grid mode performance)', () => {
    expect(elapsed).toBeLessThan(5000);
    console.log(`      ⏱  40ft container packed 500 items in ${elapsed}ms`);
  });

  test('all 500 items have valid coordinates', () => {
    assertAllItemsHaveCoords(res.body.data.bins);
  });

  test('no items exceed container boundaries', () => {
    const bin = res.body.data.bins[0];
    for (const item of bin.items) {
      expect(item.position.x + item.dimensions.w).toBeLessThanOrEqual(bin.dimensions.w + 0.01);
      expect(item.position.y + item.dimensions.h).toBeLessThanOrEqual(bin.dimensions.h + 0.01);
      expect(item.position.z + item.dimensions.d).toBeLessThanOrEqual(bin.dimensions.d + 0.01);
    }
  });
});

// ---------------------------------------------------------------------------
// TEST 5 — Weight constraint enforcement
// ---------------------------------------------------------------------------
describe('POST /api/pack — weight constraint', () => {
  test('stops packing when max_weight is reached', async () => {
    // Each carton = 10kg. Bin max = 100kg → at most 10 cartons should fit
    const res = await request(app)
      .post('/api/pack')
      .send({
        bins:  [{ ...EURO_PALLET, max_weight: 100 }],
        items: [{ ...MASTER_CARTON, quantity: 50 }],
        options: DEFAULT_OPTIONS,
      });

    expect(res.statusCode).toBe(200);
    const fitted = res.body.data.summary.fitted_items;
    expect(fitted).toBeLessThanOrEqual(10);
    expect(fitted).toBeGreaterThan(0);

    const weightUsed = res.body.data.bins[0].weight_used;
    expect(weightUsed).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// TEST 6 — Invalid payload: empty bins array
// ---------------------------------------------------------------------------
describe('POST /api/pack — validation errors', () => {
  test('rejects empty bins array with 400', async () => {
    const res = await request(app)
      .post('/api/pack')
      .send({
        bins:  [],
        items: [{ ...MASTER_CARTON, quantity: 10 }],
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Validation failed');
    const fields = res.body.details.map((d) => d.field);
    expect(fields).toContain('bins');
  });

  test('rejects negative dimension with 400', async () => {
    const res = await request(app)
      .post('/api/pack')
      .send({
        bins:  [EURO_PALLET],
        items: [{ ...MASTER_CARTON, width: -5 }],
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    const fields = res.body.details.map((d) => d.field);
    expect(fields).toContain('items.0.width');
  });

  test('rejects missing required bin fields with 400', async () => {
    const res = await request(app)
      .post('/api/pack')
      .send({
        bins:  [{ name: 'incomplete-bin' }],   // missing width, height, depth
        items: [{ ...MASTER_CARTON }],
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('rejects completely empty body with 400', async () => {
    const res = await request(app)
      .post('/api/pack')
      .send({});

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TEST 7 — Unknown route
// ---------------------------------------------------------------------------
describe('Unknown routes', () => {
  test('GET /api/unknown returns 404', async () => {
    const res = await request(app).get('/api/unknown');
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test('GET /api/pack returns 404 (only POST is valid)', async () => {
    const res = await request(app).get('/api/pack');
    expect(res.statusCode).toBe(404);
  });
});
