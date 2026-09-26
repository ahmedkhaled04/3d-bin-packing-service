# 3D Bin-Packing Microservice

A self-hosted, open-source microservice that solves **3D spatial bin-packing** for supply chain logistics. Built for dynamic, real-world container configurations — Euro pallets, local distribution vans, 40ft shipping containers, and any custom bin.

```
POST /api/pack  →  { bins: [...], items: [...] }  →  exact x,y,z per item
```

## Architecture

```
Client (Postman / Three.js frontend)
        │
        ▼  HTTP JSON
┌───────────────────────┐
│  Node.js (Express)    │  Port 3000
│  • Input validation   │  Joi schema
│  • Route handling     │  /api/pack
│  • Error handling     │  400 / 422 / 500
└────────┬──────────────┘
         │  stdin / stdout (child_process.spawn)
         ▼
┌───────────────────────┐
│  Python solver.py     │
│  • Grid mode (fast)   │  O(n) — homogeneous / large loads
│  • py3dbp mode        │  exact — mixed sizes < 150 items
└───────────────────────┘
```

## Quick Start

**Prerequisites**: Node.js 18+, Python 3.10+

```bash
# 1. Install Python solver dependency
py -m pip install -r python/requirements.txt

# 2. Install Node.js dependencies
cd node && npm install

# 3. Start the server
npm start
```

Server is live at `http://localhost:3000`

---

## API Reference

### `GET /api/health`

Liveness check.

```json
{
  "status": "ok",
  "service": "3d-bin-packing",
  "timestamp": "2026-09-23T20:00:00.000Z",
  "python": "py"
}
```

---

### `POST /api/pack`

Solve a 3D bin-packing problem.

#### Request Body

```json
{
  "bins": [
    {
      "name":       "euro-pallet",
      "width":      120,
      "height":     162,
      "depth":      100,
      "max_weight": 1000
    }
  ],
  "items": [
    {
      "name":           "master-carton",
      "width":          51,
      "height":         21,
      "depth":          27,
      "weight":         10,
      "quantity":       100,
      "allow_rotation": true
    }
  ],
  "options": {
    "bigger_first":       true,
    "distribute_items":   false,
    "number_of_decimals": 0
  }
}
```

| Field | Type | Required | Default | Notes |
|-------|------|:--------:|---------|-------|
| `bins[].name` | string | Yes | — | Unique bin identifier |
| `bins[].width` | number | Yes | — | Inner width (cm) |
| `bins[].height` | number | Yes | — | Inner height (cm) |
| `bins[].depth` | number | Yes | — | Inner depth (cm) |
| `bins[].max_weight` | number | No | 999999 | Max load (kg) |
| `items[].name` | string | Yes | — | Item type name |
| `items[].width/height/depth` | number | Yes | — | Dimensions (cm) |
| `items[].weight` | number | No | 0 | Weight per unit (kg) |
| `items[].quantity` | integer | No | 1 | Number of copies |
| `items[].allow_rotation` | boolean | No | true | Allow 3D rotation |
| `options.bigger_first` | boolean | No | true | Pack larger items first |
| `options.distribute_items` | boolean | No | false | Spread items across bins |
| `options.number_of_decimals` | integer | No | 0 | Coordinate precision |

#### Success Response `200`

```json
{
  "success": true,
  "data": {
    "mode": "grid",
    "bins": [
      {
        "name": "euro-pallet",
        "dimensions": { "w": 120, "h": 162, "d": 100 },
        "max_weight": 1000,
        "weight_used": 480,
        "volume_used": 1388448,
        "volume_total": 1944000,
        "utilization_pct": 71.4,
        "items": [
          {
            "name":          "master-carton-1",
            "position":      { "x": 0,    "y": 0,    "z": 0    },
            "center":        { "x": 13.5, "y": 25.5, "z": 10.5 },
            "dimensions":    { "w": 27,   "h": 51,   "d": 21   },
            "weight":        10,
            "rotation_type": 4,
            "color":         "#4A90D9"
          }
        ]
      }
    ],
    "unfitted_items": [],
    "summary": {
      "total_items":    100,
      "fitted_items":   48,
      "unfitted_items": 52,
      "bins_used":      1
    }
  }
}
```

#### Error Response `400` — Validation Failed

```json
{
  "success": false,
  "error": "Validation failed",
  "details": [
    { "field": "bins",          "message": "\"bins\" must contain at least 1 items" },
    { "field": "items.0.width", "message": "\"items[0].width\" must be a positive number" }
  ]
}
```

---

## Three.js Integration

Each item in the response has everything needed to render a 3D box:

```js
import * as THREE from 'three';

function renderPacking(data) {
  const scene = new THREE.Scene();

  for (const bin of data.bins) {
    // Draw bin wireframe
    const binGeo = new THREE.BoxGeometry(bin.dimensions.w, bin.dimensions.h, bin.dimensions.d);
    const binMat = new THREE.MeshBasicMaterial({ color: 0xcccccc, wireframe: true });
    const binMesh = new THREE.Mesh(binGeo, binMat);
    binMesh.position.set(bin.dimensions.w / 2, bin.dimensions.h / 2, bin.dimensions.d / 2);
    scene.add(binMesh);

    // Draw each packed item
    for (const item of bin.items) {
      const geo = new THREE.BoxGeometry(item.dimensions.w, item.dimensions.h, item.dimensions.d);
      const mat = new THREE.MeshPhongMaterial({
        color:       item.color,
        transparent: true,
        opacity:     0.85,
      });
      const mesh = new THREE.Mesh(geo, mat);

      // Use `center` directly — no offset math needed
      mesh.position.set(item.center.x, item.center.y, item.center.z);
      mesh.name = item.name;
      scene.add(mesh);
    }
  }
  return scene;
}
```

> **`position`** = bottom-left-front corner of the box
> **`center`** = geometric center — use this directly as `mesh.position`
> **`rotation_type`** = which of 6 orientations was applied (0 = original)

---

## Solver Modes

The solver automatically picks the best engine:

| Mode | Triggers when | Speed | Algorithm |
|------|--------------|-------|-----------|
| **Grid** | All items same size, OR quantity > 150 | ~150ms for 500 items | Mathematical grid — tries all 6 rotations, picks best |
| **py3dbp** | Mixed sizes AND quantity <= 150 | ~6s for 100 items | Best-Fit Decreasing — exact corner placement |

---

## Real-World Scenarios

### Euro Pallet (120x100x162 cm)
```powershell
# PowerShell
$body = @{ bins=@(@{name="euro-pallet";width=120;height=162;depth=100;max_weight=1000}); items=@(@{name="master-carton";width=51;height=21;depth=27;weight=10;quantity=100;allow_rotation=$true}) } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri http://localhost:3000/api/pack -Method POST -Body $body -ContentType "application/json"
```

### 40ft Shipping Container (1200x239x235 cm)
```powershell
$body = @{ bins=@(@{name="40ft-container";width=1200;height=239;depth=235;max_weight=28000}); items=@(@{name="master-carton";width=51;height=21;depth=27;weight=10;quantity=500;allow_rotation=$true}) } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri http://localhost:3000/api/pack -Method POST -Body $body -ContentType "application/json"
```

---

## Running Tests

```bash
cd node
npm test
```

Expected output:
```
Tests: 28 passed, 28 total
```

Test suite covers: health check, canonical pallet, multi-bin overflow,
40ft container speed, weight constraints, validation errors, and 404 handling.

---

## Project Structure

```
3d-bin-packing-service/
├── python/
│   ├── solver.py          # Two-mode packing engine (grid + py3dbp)
│   ├── test_solver.py     # Standalone Python smoke tests
│   ├── requirements.txt   # py3dbp dependency
│   └── README.md          # Python layer docs
├── node/
│   ├── server.js          # HTTP server entry point
│   ├── src/
│   │   ├── app.js         # Express app + middleware + error handler
│   │   ├── routes/
│   │   │   └── pack.js    # POST /api/pack route
│   │   ├── services/
│   │   │   └── solverBridge.js  # Node → Python IPC (stdin/stdout)
│   │   └── validators/
│   │       └── packSchema.js    # Joi input validation schema
│   ├── tests/
│   │   └── integration.test.js  # Jest integration tests (28 assertions)
│   ├── package.json
│   └── .env
├── .gitignore
└── README.md              # This file
```

---

## Environment Variables

Configure in `node/.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port |
| `PYTHON_CMD` | `py` | Python executable |
| `SOLVER_PATH` | `../python/solver.py` | Path to solver script |
| `SOLVER_TIMEOUT_MS` | `30000` | Max solver runtime (ms) |

---

## License

MIT — free to use, modify, and self-host.
