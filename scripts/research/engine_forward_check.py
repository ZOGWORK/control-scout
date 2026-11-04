"""Research brief item 11, companion check: how much does the engine gain from its final stretch being fitted
on the seasons the MLP baseline is scored on?

Engine 3.3.0's final recalibration (sigmoid(slope * logit p), slope 1.057692) was fitted on rated matches
2024-07-26 to 2026-07-26, so it has seen both scored seasons. This rebuilds a forward-only engine: the
engine's probability BEFORE that stretch, with the slope refitted on each rolling origin (each month
Oct 2024-Jul 2026 from the 365 days before it, mirrored rows, no intercept: Part 12.5's Platt). It then
reports served minus forward-only on the same decisive matches the MLP baseline scores, with event-bootstrap
intervals. If the difference is small, the MLP comparison against the served engine stands.

  rows      DATABASE_URL=file:<copy> npm run slices -- --seasons 2023,2024,2025 --rows engine-rows.json.gz
  raw rows  DATABASE_URL=file:<copy> npm run slices -- --seasons 2023,2024,2025 --champion '{"rating":{},"recalibration":false}' --rows engine-rows-raw.json.gz
  python scripts/research/engine_forward_check.py --engine-rows engine-rows.json.gz --raw-rows engine-rows-raw.json.gz --out <file.json>
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mlp_baseline import SEASONS, WINDOW_MS, metrics, months, paired  # noqa: E402


def slope(z: np.ndarray, y: np.ndarray) -> float:
    """Max-likelihood a in sigmoid(a * z) on mirrored rows (Newton; same fit as scripts/part9/lib.ts fit with one input)."""
    Z = np.concatenate([z, -z])
    Y = np.concatenate([y, 1 - y])
    a = 1.0
    for _ in range(50):
        p = 1 / (1 + np.exp(-a * Z))
        g = np.sum((Y - p) * Z) - 1e-4 * a
        h = -np.sum(p * (1 - p) * Z * Z) - 1e-4
        step = g / h
        a -= step
        if abs(step) < 1e-10:
            break
    return float(a)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine-rows", required=True)
    ap.add_argument("--raw-rows", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    served = {r["key"]: r for r in json.load(gzip.open(args.engine_rows, "rt", encoding="utf-8"))}
    raw = json.load(gzip.open(args.raw_rows, "rt", encoding="utf-8"))
    keys = [r["key"] for r in raw if r["key"] in served]
    if len(keys) != len(raw) or len(keys) != len(served):
        sys.exit("the two row files come from different corpora")
    R = [served[k] for k in keys]
    W = {r["key"]: r for r in raw}
    y = np.array([r["y"] for r in R], dtype=float)
    t = np.array([r["time"] for r in R], dtype=float)
    season = np.array([r["season"] for r in R])
    event = np.array([r["event"] for r in R])
    ok = np.array([r["rated"] for r in R]) & (y != 0.5)
    pS = np.array([r["pred"]["champion"]["p"] for r in R])
    pR = np.clip(np.array([W[k]["pred"]["champion"]["p"] for k in keys]), 1e-6, 1 - 1e-6)
    z = np.log(pR / (1 - pR))
    pF = np.full(len(y), np.nan)
    fits = []
    M = months()
    for a0, a1 in zip(M[:-1], M[1:]):
        tr = ok & (t < a0) & (t >= a0 - WINDOW_MS)
        te = ok & (t >= a0) & (t < a1)
        if te.sum() < 50 or tr.sum() < 2000:
            continue
        a = slope(z[tr], y[tr])
        pF[te] = 1 / (1 + np.exp(-a * z[te]))
        fits.append({"origin": datetime.fromtimestamp(a0 / 1000, tz=timezone.utc).strftime("%Y-%m-%d"), "train": int(tr.sum()), "test": int(te.sum()), "slope": round(a, 4)})
    out = {"servedSlope": 1.057692, "fits": fits, "seasons": {}}
    zero = np.zeros(len(y))
    for s, label in SEASONS:
        m = ok & (season == s) & ~np.isnan(pF)
        out["seasons"][label] = {
            "served": metrics(pS[m], y[m], None, None), "forwardOnly": metrics(pF[m], y[m], None, None), "raw": metrics(pR[m], y[m], None, None),
            "servedMinusForward": {k: v for k, v in paired(event[m], y[m], pF[m], pS[m], zero[m], zero[m], zero[m]).items() if k != "marginMAE"},
        }
        d = out["seasons"][label]["servedMinusForward"]["brier"]
        print(f"{label}: n {int(m.sum())} served {out['seasons'][label]['served']['brier']:.5f} forward-only {out['seasons'][label]['forwardOnly']['brier']:.5f} served - forward {1e4 * d['delta']:+.2f}e-4 [{1e4 * d['ci95'][0]:+.2f}, {1e4 * d['ci95'][1]:+.2f}]")
    print("slopes", [f["slope"] for f in fits])
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)


if __name__ == "__main__":
    main()
