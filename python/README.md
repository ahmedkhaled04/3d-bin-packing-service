# 3D Bin-Packing Solver — Python Layer

Standalone `py3dbp` bridge. Reads a JSON payload from **stdin**, packs items into bins, writes a structured JSON result to **stdout**.

## Requirements

- Python 3.10+
- `py3dbp` v1.1.2

```bash
pip install -r python/requirements.txt
# or
py -m pip install -r python/requirements.txt
```

## Running the Smoke Test

```bash
# Windows PowerShell
$env:PYTHONUTF8=1; py python/test_solver.py
```

Expected output:
```
[PASS] Exactly 42 cartons fitted (expected 42)
[PASS] All items have valid X, Y, Z coordinates
[PASS] Zero item overlaps detected
```

## Calling the Solver Directly

Pipe a JSON payload into `solver.py`:

```bash
echo '{"bins":[{"name":"pallet","width":120,"height":162,"depth":100,"max_weight":1000}],"items":[{"name":"carton","width":51,"height":21,"depth":27,"weight":10,"quantity":50,"allow_rotation":true}],"options":{"bigger_first":true}}' | py python/solver.py
```

## Input Schema

```json
{
  "bins": [
    {
      "name": "euro-pallet",
      "width": 120,
      "height": 162,
      "depth": 100,
      "max_weight": 1000
    }
  ],
  "items": [
    {
      "name": "master-carton",
      "width": 51,
      "height": 21,
      "depth": 27,
      "weight": 10,
      "quantity": 100,
      "allow_rotation": true
    }
  ],
  "options": {
    "bigger_first": true,
    "distribute_items": false,
    "number_of_decimals": 0
  }
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `bins[].name` | string | ✅ | — | Bin identifier |
| `bins[].width` | number | ✅ | — | cm |
| `bins[].height` | number | ✅ | — | cm |
| `bins[].depth` | number | ✅ | — | cm |
| `bins[].max_weight` | number | ⬜ | 999999 | kg |
| `items[].name` | string | ✅ | — | Item identifier |
| `items[].width/height/depth` | number | ✅ | — | cm |
| `items[].weight` | number | ⬜ | 0 | kg |
| `items[].quantity` | integer | ⬜ | 1 | How many copies |
| `items[].allow_rotation` | boolean | ⬜ | true | Reserved for future use |
| `options.bigger_first` | boolean | ⬜ | true | Pack larger items first |
| `options.distribute_items` | boolean | ⬜ | false | Spread across bins |
| `options.number_of_decimals` | integer | ⬜ | 0 | Coordinate precision |

## Output Schema

```json
{
  "success": true,
  "bins": [
    {
      "name": "euro-pallet",
      "dimensions": { "w": 120, "h": 162, "d": 100 },
      "max_weight": 1000,
      "items": [
        {
          "name": "master-carton-1",
          "position": { "x": 0, "y": 0, "z": 0 },
          "dimensions": { "w": 51, "h": 21, "d": 27 },
          "weight": 10,
          "rotation_type": 0,
          "color": "#4A90D9"
        }
      ],
      "weight_used": 420,
      "volume_used": 1214214,
      "volume_total": 1944000,
      "utilization_pct": 62.48
    }
  ],
  "unfitted_items": [],
  "summary": {
    "total_items": 100,
    "fitted_items": 42,
    "unfitted_items": 58,
    "bins_used": 1
  }
}
```

## Three.js Integration

Each `item` in the response gives you everything needed to render a 3D box:

```js
const geometry = new THREE.BoxGeometry(item.dimensions.w, item.dimensions.h, item.dimensions.d);
const material = new THREE.MeshPhongMaterial({ color: item.color });
const mesh = new THREE.Mesh(geometry, material);
mesh.position.set(
  item.position.x + item.dimensions.w / 2,
  item.position.y + item.dimensions.h / 2,
  item.position.z + item.dimensions.d / 2
);
scene.add(mesh);
```

> **Note**: `position` is the bottom-left-front corner. Add half-dimensions to center the Three.js mesh correctly.
