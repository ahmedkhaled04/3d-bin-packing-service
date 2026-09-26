#!/usr/bin/env python3
"""
3D Bin-Packing Solver Bridge
============================
Two-mode solver:

  MODE 1 — GRID (fast, milliseconds)
    Triggered when: all items share identical dimensions (homogeneous load)
    OR total item count exceeds GRID_THRESHOLD.
    Computes exact x,y,z positions mathematically by building a 3-D grid.
    Tries all 6 item orientations, picks the one that fits the most.
    Runs in O(n) — handles 10,000+ items instantly.

  MODE 2 — py3dbp (exact placement, mixed sizes)
    Triggered when: items have different dimensions AND count <= GRID_THRESHOLD.
    Uses the py3dbp Best-Fit-Decreasing algorithm.
    Slower for large counts (O(n²)) but handles irregular mixed loads.

The solver auto-selects the mode — no config needed from the caller.

stdin  → JSON payload (bins + items + options)
stdout → JSON result  (positions, dimensions, summary)
"""

import sys
import json
import math
from py3dbp import Packer, Bin, Item

# ---------------------------------------------------------------------------
# Thresholds & config
# ---------------------------------------------------------------------------
# When total items exceed this, switch to grid mode regardless of homogeneity
GRID_THRESHOLD = 150

ITEM_COLORS = [
    "#4A90D9", "#E67E22", "#2ECC71", "#9B59B6", "#E74C3C",
    "#1ABC9C", "#F39C12", "#3498DB", "#D35400", "#27AE60",
]

# All 6 orientations of a box (w, h, d) — same as py3dbp RotationType
ROTATIONS = [
    (0, lambda w, h, d: (w, h, d)),   # RT_WHD — original
    (1, lambda w, h, d: (h, w, d)),   # RT_HWD
    (2, lambda w, h, d: (h, d, w)),   # RT_HDW
    (3, lambda w, h, d: (d, h, w)),   # RT_DHW
    (4, lambda w, h, d: (d, w, h)),   # RT_DWH
    (5, lambda w, h, d: (w, d, h)),   # RT_WDH
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def parse_payload(raw: str) -> dict:
    payload = json.loads(raw)
    if not payload.get("bins"):
        raise ValueError("'bins' array is required and must not be empty.")
    if not payload.get("items"):
        raise ValueError("'items' array is required and must not be empty.")
    for b in payload["bins"]:
        for f in ("name", "width", "height", "depth"):
            if f not in b:
                raise ValueError(f"Bin missing required field: '{f}'")
    for it in payload["items"]:
        for f in ("name", "width", "height", "depth"):
            if f not in it:
                raise ValueError(f"Item missing required field: '{f}'")
    return payload


def build_color_map(item_defs: list) -> dict:
    unique = list(dict.fromkeys(d["name"] for d in item_defs))
    return {n: ITEM_COLORS[i % len(ITEM_COLORS)] for i, n in enumerate(unique)}


def is_homogeneous(item_defs: list) -> bool:
    """True if every item type has the same W × H × D."""
    if not item_defs:
        return True
    dims = set()
    for d in item_defs:
        dims.add((float(d["width"]), float(d["height"]), float(d["depth"])))
    return len(dims) == 1


def total_quantity(item_defs: list) -> int:
    return sum(int(d.get("quantity", 1)) for d in item_defs)


def make_bin_result(name, bw, bh, bd, max_weight, packed_items, num_decimals):
    vol_total = bw * bh * bd
    vol_used  = sum(i["dimensions"]["w"] * i["dimensions"]["h"] * i["dimensions"]["d"]
                    for i in packed_items)
    w_used    = sum(i["weight"] for i in packed_items)
    util      = round(vol_used / vol_total * 100, 2) if vol_total > 0 else 0.0
    return {
        "name"           : name,
        "dimensions"     : {"w": round(bw, num_decimals),
                            "h": round(bh, num_decimals),
                            "d": round(bd, num_decimals)},
        "max_weight"     : float(max_weight),
        "items"          : packed_items,
        "weight_used"    : round(w_used, 2),
        "volume_used"    : round(vol_used, 2),
        "volume_total"   : round(vol_total, 2),
        "utilization_pct": util,
    }


# ---------------------------------------------------------------------------
# MODE 1 — Grid packer (fast, mathematical)
# ---------------------------------------------------------------------------

def best_rotation_for_bin(iw, ih, id_, bw, bh, bd):
    """
    Try all 6 orientations, return the one that packs the most items.
    Returns (rotation_type, rw, rh, rd, count_x, count_y, count_z, total)
    """
    best = None
    for rot_type, fn in ROTATIONS:
        rw, rh, rd = fn(iw, ih, id_)
        if rw <= 0 or rh <= 0 or rd <= 0:
            continue
        cx = max(1, math.floor(bw / rw))
        cy = max(1, math.floor(bh / rh))
        cz = max(1, math.floor(bd / rd))
        # Make sure at least one actually fits
        if rw * cx > bw or rh * cy > bh or rd * cz > bd:
            cx = math.floor(bw / rw)
            cy = math.floor(bh / rh)
            cz = math.floor(bd / rd)
        total = cx * cy * cz
        if best is None or total > best[-1]:
            best = (rot_type, rw, rh, rd, cx, cy, cz, total)
    return best


def grid_pack(payload: dict) -> dict:
    """
    Fast O(n) grid packer for homogeneous or large loads.
    Assigns items to bins in sequence; any overflow is unfitted.
    """
    options      = payload.get("options", {})
    num_decimals = int(options.get("number_of_decimals", 0))
    color_map    = build_color_map(payload["items"])

    # Flatten all item instances into a queue
    item_queue = []
    for item_def in payload["items"]:
        qty       = int(item_def.get("quantity", 1))
        base_name = item_def["name"]
        weight    = float(item_def.get("weight", 0))
        iw = float(item_def["width"])
        ih = float(item_def["height"])
        id_ = float(item_def["depth"])
        color = color_map[base_name]
        for i in range(qty):
            unique = f"{base_name}-{i + 1}" if qty > 1 else base_name
            item_queue.append({
                "name"  : unique,
                "w"     : iw,
                "h"     : ih,
                "d"     : id_,
                "weight": weight,
                "color" : color,
            })

    result_bins  = []
    total_fitted = 0
    cursor       = 0   # index into item_queue

    for bin_def in payload["bins"]:
        if cursor >= len(item_queue):
            break

        bw  = float(bin_def["width"])
        bh  = float(bin_def["height"])
        bd  = float(bin_def["depth"])
        mw  = float(bin_def.get("max_weight", 999999))

        # Find best rotation using the first item's dimensions
        first = item_queue[cursor]
        rot   = best_rotation_for_bin(first["w"], first["h"], first["d"], bw, bh, bd)
        if rot is None or rot[-1] == 0:
            continue  # item doesn't fit at all in this bin

        rot_type, rw, rh, rd, cx, cy, cz, capacity = rot
        packed_items = []
        weight_so_far = 0.0

        for iz in range(cz):
            for iy in range(cy):
                for ix in range(cx):
                    if cursor >= len(item_queue):
                        break
                    item = item_queue[cursor]
                    w_after = weight_so_far + item["weight"]
                    if w_after > mw:
                        break  # weight limit reached
                    px = round(ix * rw, num_decimals)
                    py = round(iy * rh, num_decimals)
                    pz = round(iz * rd, num_decimals)
                    packed_items.append({
                        "name"         : item["name"],
                        "position"     : {"x": px, "y": py, "z": pz},
                        "center"       : {
                            "x": round(px + rw / 2, num_decimals),
                            "y": round(py + rh / 2, num_decimals),
                            "z": round(pz + rd / 2, num_decimals),
                        },
                        "dimensions"   : {
                            "w": round(rw, num_decimals),
                            "h": round(rh, num_decimals),
                            "d": round(rd, num_decimals),
                        },
                        "weight"       : item["weight"],
                        "rotation_type": rot_type,
                        "color"        : item["color"],
                    })
                    weight_so_far = w_after
                    cursor += 1

        total_fitted += len(packed_items)
        result_bins.append(
            make_bin_result(bin_def["name"], bw, bh, bd, mw, packed_items, num_decimals)
        )

    # Remaining items are unfitted
    unfitted = [
        {
            "name"      : it["name"],
            "dimensions": {"w": it["w"], "h": it["h"], "d": it["d"]},
            "weight"    : it["weight"],
        }
        for it in item_queue[cursor:]
    ]

    total_items = len(item_queue)
    return {
        "success"       : True,
        "mode"          : "grid",
        "bins"          : result_bins,
        "unfitted_items": unfitted,
        "summary"       : {
            "total_items"   : total_items,
            "fitted_items"  : total_fitted,
            "unfitted_items": len(unfitted),
            "bins_used"     : len(result_bins),
        },
    }


# ---------------------------------------------------------------------------
# MODE 2 — py3dbp packer (exact, mixed sizes)
# ---------------------------------------------------------------------------

def py3dbp_pack(payload: dict) -> dict:
    """
    Uses py3dbp for small mixed-size loads.
    """
    options      = payload.get("options", {})
    bigger_first = options.get("bigger_first", True)
    distribute   = options.get("distribute_items", False)
    num_decimals = int(options.get("number_of_decimals", 0))
    color_map    = build_color_map(payload["items"])

    packer   = Packer()
    item_meta = {}

    for bin_def in payload["bins"]:
        packer.add_bin(Bin(
            name       = bin_def["name"],
            width      = float(bin_def["width"]),
            height     = float(bin_def["height"]),
            depth      = float(bin_def["depth"]),
            max_weight = float(bin_def.get("max_weight", 999999)),
        ))

    for item_def in payload["items"]:
        qty       = int(item_def.get("quantity", 1))
        weight    = float(item_def.get("weight", 0))
        base_name = item_def["name"]
        color     = color_map[base_name]
        base_dims = {"w": float(item_def["width"]),
                     "h": float(item_def["height"]),
                     "d": float(item_def["depth"])}
        for i in range(qty):
            unique = f"{base_name}-{i + 1}" if qty > 1 else base_name
            item_meta[unique] = {"weight": weight, "color": color, "base_dims": base_dims}
            packer.add_item(Item(
                name   = unique,
                width  = float(item_def["width"]),
                height = float(item_def["height"]),
                depth  = float(item_def["depth"]),
                weight = weight,
            ))

    packer.pack(
        bigger_first       = bigger_first,
        distribute_items   = distribute,
        number_of_decimals = num_decimals,
    )

    result_bins  = []
    total_fitted = 0

    for b in packer.bins:
        bw, bh, bd = float(b.width), float(b.height), float(b.depth)
        packed_items = []
        for it in b.items:
            meta = item_meta.get(it.name, {})
            pos  = it.position
            dims = it.get_dimension()
            x = round(float(pos[0]),  num_decimals)
            y = round(float(pos[1]),  num_decimals)
            z = round(float(pos[2]),  num_decimals)
            w = round(float(dims[0]), num_decimals)
            h = round(float(dims[1]), num_decimals)
            d = round(float(dims[2]), num_decimals)
            packed_items.append({
                "name"         : it.name,
                "position"     : {"x": x, "y": y, "z": z},
                "center"       : {
                    "x": round(x + w / 2, num_decimals),
                    "y": round(y + h / 2, num_decimals),
                    "z": round(z + d / 2, num_decimals),
                },
                "dimensions"   : {"w": w, "h": h, "d": d},
                "weight"       : meta.get("weight", 0),
                "rotation_type": int(it.rotation_type),
                "color"        : meta.get("color", "#CCCCCC"),
            })
        total_fitted += len(packed_items)
        result_bins.append(
            make_bin_result(b.name, bw, bh, bd, float(b.max_weight), packed_items, num_decimals)
        )

    unfitted = []
    for it in packer.unfit_items:
        meta = item_meta.get(it.name, {})
        unfitted.append({
            "name"      : it.name,
            "dimensions": meta.get("base_dims", {}),
            "weight"    : meta.get("weight", 0),
        })

    total_items = sum(int(i.get("quantity", 1)) for i in payload["items"])
    return {
        "success"       : True,
        "mode"          : "py3dbp",
        "bins"          : result_bins,
        "unfitted_items": unfitted,
        "summary"       : {
            "total_items"   : total_items,
            "fitted_items"  : total_fitted,
            "unfitted_items": len(unfitted),
            "bins_used"     : len(result_bins),
        },
    }


# ---------------------------------------------------------------------------
# Auto-select mode and run
# ---------------------------------------------------------------------------

def run_packer(payload: dict) -> dict:
    qty        = total_quantity(payload["items"])
    homogenous = is_homogeneous(payload["items"])

    use_grid = homogenous or qty > GRID_THRESHOLD

    if use_grid:
        return grid_pack(payload)
    else:
        return py3dbp_pack(payload)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    raw_input = sys.stdin.read().strip()
    if not raw_input:
        output = {"success": False, "error": "No input received on stdin."}
    else:
        try:
            payload = parse_payload(raw_input)
            output  = run_packer(payload)
        except json.JSONDecodeError as exc:
            output = {"success": False, "error": f"Invalid JSON input: {exc}"}
        except ValueError as exc:
            output = {"success": False, "error": str(exc)}
        except Exception as exc:
            output = {"success": False, "error": f"Solver error: {exc}"}

    sys.stdout.write(json.dumps(output, separators=(",", ":")))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
