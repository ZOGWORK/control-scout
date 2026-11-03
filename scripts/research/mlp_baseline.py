"""Research brief item 11: an offline MLP baseline (the WPI FRC paper's style), comparison only.

Trains a scikit-learn multilayer perceptron on per-alliance skill-category features under the SAME
rolling origins the engine program uses (Part 9 / Part 12.5, scripts/part12/isotonic.ts): each month
from October 2024 to July 2026 gets a model fitted on the 365 days before it and is scored on that
month only. It scores the very rows the served engine (3.3.0) is judged on, joined by match key from
`engine-slices --rows`, so both models are compared on identical matches.

Inputs (both made on a COPY of the decompressed data/snapshot.db.br):
  engine rows   DATABASE_URL=file:<copy> npm run slices -- --seasons 2023,2024,2025 --out <tmp> --rows engine-rows.json.gz
  match export  DATABASE_URL=file:<copy> npx tsx scripts/research/mlp-export.ts --out matches.json.gz

Run (Python 3.14, scripts/research/requirements.txt in a venv):
  python scripts/research/mlp_baseline.py --matches matches.json.gz --engine-rows engine-rows.json.gz \
      --out docs/engine/research-2026-11/mlp-baseline-<date>.json [--jobs 15] [--seeds 5]
  About four hours on 16 cores: the paper's 4 x 50 tanh net takes about 11 minutes per fit.

Steps: (1) the grid's small nets on the tuning season (2024-25) only, seed 0; (2) the paper's exact
config, every seed on the paper features and seed 0 on the other variants (seed 0 also enters the grid);
(3) each variant's grid pick (lowest 2024-25 Brier) on every seed, both seasons. Each run fits a
classifier (win) and a regressor (margin) per origin. Seeds fix sklearn's initialisation and batch order.

Features (strictly pre-match: every value is computed from matches that started BEFORE the match
being predicted; matches that share a start time are featurised before any of them is folded in):
  paper           per team per category (auto, TeleOp, endgame, fouls = penalty points given away) the mean
                  of its alliances' scores over its earlier qualification matches this season, at rated
                  events. Normalised per season against the season-to-date maximum alliance score in that
                  category; fouls inverted (1 - x). Alliance value = mean of its two robots. 4 x 2 = 8.
                  A robot with no earlier qualification match takes the season-to-date mean.
  paper+n         paper, plus each alliance's fewest earlier qualification matches (log1p): 10 features.
  engine-ratings  the engine's own pre-match per-phase ratings (auto, TeleOp, endgame, penalties) summed per
                  alliance, each divided by the season-to-date mean alliance score in that phase: 8 features.
Every model is colour-symmetric: trained on each match and its mirror (red and blue swapped), and
p = (f(red, blue) + 1 - f(blue, red)) / 2, as the engine is.
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import os
import sys
import time
import warnings
from collections import defaultdict
from datetime import datetime, timezone

import numpy as np

os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
os.environ.setdefault("MKL_NUM_THREADS", "1")

WINDOW_MS = 365 * 864e5
CATS = ["auto", "teleop", "endgame", "fouls"]
PAPER = {"hidden_layer_sizes": (50, 50, 50, 50), "activation": "tanh", "solver": "adam", "alpha": 1e-4, "learning_rate": "constant"}
# The paper's config is one grid member; the rest are smaller nets (the paper's 4 x 50 net takes about
# 11 minutes per fit here, so its alpha / early-stopping neighbours were not searched). Early stopping
# was dropped after a probe stopped a 16-unit net at 14 epochs, far under-fitted.
GRID = [{"hidden_layer_sizes": h, "alpha": a} for h in [(16,), (32, 16)] for a in [1e-4, 1e-2, 1.0]]
VARIANTS = ["paper", "paper+n", "engine-ratings"]


def months() -> list[int]:
    out, y, m = [], 2024, 10
    while (y, m) <= (2026, 8):
        out.append(int(datetime(y, m, 1, tzinfo=timezone.utc).timestamp() * 1000))
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def load(matches_path: str, engine_path: str):
    with gzip.open(matches_path, "rt", encoding="utf-8") as f:
        mx = json.load(f)
    with gzip.open(engine_path, "rt", encoding="utf-8") as f:
        er = json.load(f)
    eng = {r["key"]: r for r in er}
    return mx["rows"], eng


def features(rows):
    """Pre-match feature rows for every exported match (all three variants)."""
    order = sorted(range(len(rows)), key=lambda i: rows[i][4])  # stable: export order within a start time
    feats = {v: [None] * len(rows) for v in VARIANTS}
    # Per season (seasons can overlap in time at off-season events): team sums, category max, population sums.
    state = defaultdict(lambda: {"team": {}, "max": np.zeros(4), "sum": np.zeros(4), "n": 0})
    i = 0
    while i < len(order):
        j = i
        while j < len(order) and rows[order[j]][4] == rows[order[i]][4]:
            j += 1
        group = order[i:j]
        for k in group:
            key, s, ev, level, t, rated, red, blue, rph, bph, ratings = rows[k]
            st_s = state[s]
            team, smax = st_s["team"], st_s["max"]
            pop = st_s["sum"] / st_s["n"] if st_s["n"] else np.zeros(4)

            def skill(tm):
                st = team.get(tm)
                mean = st[:4] / st[4] if st is not None and st[4] > 0 else pop
                x = np.where(smax > 0, mean / np.where(smax > 0, smax, 1), 0.0)
                x[3] = 1.0 - x[3]  # fouls are a negative quantity: invert
                return x, (st[4] if st is not None else 0)

            al = []
            ns = []
            for side in (red, blue):
                sk = [skill(tm) for tm in side]
                al.append(np.mean([x for x, _ in sk], axis=0))
                ns.append(math.log1p(min(n for _, n in sk)))
            feats["paper"][k] = np.concatenate(al)
            feats["paper+n"][k] = np.concatenate([al[0], [ns[0]], al[1], [ns[1]]])
            # Engine ratings: robots 0-1 red, 2-3 blue; fields auto, teleop, endgame, pen, n.
            r = np.array(ratings, dtype=float)
            scale = np.where(pop > 0, pop, 1.0)
            er = (r[0, :4] + r[1, :4]) / scale
            eb = (r[2, :4] + r[3, :4]) / scale
            feats["engine-ratings"][k] = np.concatenate([er, eb])
        for k in group:
            key, s, ev, level, t, rated, red, blue, rph, bph, ratings = rows[k]
            if level != "qual" or not rated:
                continue
            st_s = state[s]
            for side, ph in ((red, rph), (blue, bph)):
                v = np.array(ph[:4], dtype=float)
                st_s["max"] = np.maximum(st_s["max"], v)
                st_s["sum"] = st_s["sum"] + v
                st_s["n"] += 1
                for tm in side:
                    st = st_s["team"].setdefault(tm, np.zeros(5))
                    st[:4] += v
                    st[4] += 1
        i = j
    return {v: np.array(feats[v]) for v in VARIANTS}


def mirror(X: np.ndarray) -> np.ndarray:
    h = X.shape[1] // 2
    return np.concatenate([X[:, h:], X[:, :h]], axis=1)



def fit_one(task):
    """Fit one model (classifier for the win, regressor for the margin) on one origin's window and predict."""
    from sklearn.exceptions import ConvergenceWarning
    from sklearn.neural_network import MLPClassifier, MLPRegressor
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    warnings.filterwarnings("ignore", category=ConvergenceWarning)
    Xtr, target, Xte, kind, cfg, seed = task
    params = {**PAPER, **cfg, "random_state": seed, "max_iter": 200}
    Xa = np.concatenate([Xtr, mirror(Xtr)])
    if kind == "clf":
        model = make_pipeline(StandardScaler(), MLPClassifier(**params)).fit(Xa, np.concatenate([target, 1 - target]))

        def f(X):
            return 0.5 * (model.predict_proba(X)[:, 1] + 1 - model.predict_proba(mirror(X))[:, 1])
    else:
        sd = float(np.std(target)) or 1.0
        model = make_pipeline(StandardScaler(), MLPRegressor(**params)).fit(Xa, np.concatenate([target, -target]) / sd)

        def f(X):
            return 0.5 * (model.predict(X) - model.predict(mirror(X))) * sd
    return {"test": f(Xte), "train": f(Xtr), "iters": int(model[-1].n_iter_)}


def run(X, data, cfg, seeds, jobs, with_margin, test_season=None):
    """Rolling origins for every seed at once: {seed: (p, m, origins)} with test-month predictions per row."""
    from joblib import Parallel, delayed

    X = X.astype(np.float32)
    M = months()
    slots = []
    for a, b in zip(M[:-1], M[1:]):
        tr = np.where((data["t"] < a) & (data["t"] >= a - WINDOW_MS) & data["train_ok"])[0]
        te = np.where((data["t"] >= a) & (data["t"] < b) & data["score"])[0]
        if test_season is not None:
            te = te[data["season"][te] == test_season]
        if len(te) < 50 or len(tr) < 2000:
            continue
        slots.append((a, tr, te))
    kinds = ["clf", "reg"] if with_margin else ["clf"]
    jobs_list = [(seed, i, kind) for seed in seeds for i in range(len(slots)) for kind in kinds]
    tasks = [(X[slots[i][1]], data["y" if kind == "clf" else "margin"][slots[i][1]], X[slots[i][2]], kind, cfg, seed) for seed, i, kind in jobs_list]
    res = dict(zip(jobs_list, Parallel(n_jobs=jobs)(delayed(fit_one)(t) for t in tasks)))
    out = {}
    for seed in seeds:
        p = np.full(len(data["y"]), np.nan)
        m = np.full(len(data["y"]), np.nan)
        origins = []
        for i, (a, tr, te) in enumerate(slots):
            c = res[(seed, i, "clf")]
            p[te] = c["test"]
            yt, ye = data["y"][tr], data["y"][te]
            o = {
                "origin": datetime.fromtimestamp(a / 1000, tz=timezone.utc).strftime("%Y-%m-%d"), "train": int(len(tr)), "test": int(len(te)), "iters": c["iters"],
                "trainBrier": float(np.mean((c["train"] - yt) ** 2)), "testBrier": float(np.mean((c["test"] - ye) ** 2)),
                "trainAccuracy": float(np.mean(correct(c["train"], yt))), "testAccuracy": float(np.mean(correct(c["test"], ye))),
            }
            if with_margin:
                r = res[(seed, i, "reg")]
                m[te] = r["test"]
                o.update({"trainMarginMAE": float(np.mean(np.abs(r["train"] - data["margin"][tr]))), "testMarginMAE": float(np.mean(np.abs(r["test"] - data["margin"][te]))), "regIters": r["iters"]})
            origins.append(o)
        out[seed] = (p, m, origins)
    return out


SEASONS = [(2024, "2024-25 (tuning)"), (2025, "2025-26 (reused)")]


def score(data, p, m):
    """Both models on the rows the MLP predicted (every scored row: the engine's served call and the MLP's)."""
    y = data["y"]
    out = {}
    for s, label in SEASONS:
        ok = data["score"] & (data["season"] == s) & ~np.isnan(p)
        q = ok & (data["level"] == "qual")
        out[label] = {
            "engine": metrics(data["pEngine"][ok], y[ok], data["mEngine"][ok], data["margin"][ok]),
            "mlp": metrics(p[ok], y[ok], m[ok], data["margin"][ok]),
            "mlpMinusEngine": paired(data["event"][ok], y[ok], data["pEngine"][ok], p[ok], data["mEngine"][ok], m[ok], data["margin"][ok]),
            "qualsOnly": {"engine": metrics(data["pEngine"][q], y[q], data["mEngine"][q], data["margin"][q]), "mlp": metrics(p[q], y[q], m[q], data["margin"][q]),
                          "mlpMinusEngine": paired(data["event"][q], y[q], data["pEngine"][q], p[q], data["mEngine"][q], m[q], data["margin"][q])},
        }
    return out


def summary(seeds_out):
    """Seed variance: mean, sd, min, max over seeds of each MLP metric and of each difference."""
    out = {}
    for _, label in SEASONS:
        vals = defaultdict(list)
        for sr in seeds_out.values():
            S = sr["seasons"][label]
            for k, v in S["mlp"].items():
                vals[f"mlp.{k}"].append(v)
            for k, v in S["mlpMinusEngine"].items():
                vals[f"delta.{k}"].append(v["delta"])
            o = [x for x in sr["origins"] if x["origin"] >= ("2025-09" if label.startswith("2025") else "2024-10") and x["origin"] < ("2026-08" if label.startswith("2025") else "2025-09")]
            for k in ["trainBrier", "testBrier", "trainAccuracy", "testAccuracy", "trainMarginMAE", "testMarginMAE"]:
                if o and k in o[0]:
                    vals[f"origins.{k}"].append(float(np.average([x[k] for x in o], weights=[x["test"] for x in o])))
        out[label] = {k: {"mean": float(np.mean(v)), "sd": float(np.std(v, ddof=1)) if len(v) > 1 else 0.0, "min": float(np.min(v)), "max": float(np.max(v))} for k, v in vals.items()}
    return out


def clip(p):
    return np.clip(p, 1e-6, 1 - 1e-6)


def correct(p, y):
    return np.where(p == 0.5, 0.5, ((p > 0.5) == (y == 1)).astype(float))


def metrics(p, y, m, margin):
    return {
        "n": int(len(y)), "brier": float(np.mean((p - y) ** 2)), "accuracy": float(np.mean(correct(p, y))),
        "logLoss": float(-np.mean(y * np.log(clip(p)) + (1 - y) * np.log(1 - clip(p)))),
        **({"marginMAE": float(np.mean(np.abs(m - margin)))} if m is not None else {}),
    }


def paired(ev, y, pa, pb, ma, mb, margin, draws=2000, seed=20261022):
    """B minus A with event-bootstrap 95% intervals (whole events resampled, ratio of sums, as pairedMetrics)."""
    d = (pb - y) ** 2 - (pa - y) ** 2
    ll = -(y * np.log(clip(pb)) + (1 - y) * np.log(1 - clip(pb))) + (y * np.log(clip(pa)) + (1 - y) * np.log(1 - clip(pa)))
    ac = correct(pb, y) - correct(pa, y)
    mae = np.abs(mb - margin) - np.abs(ma - margin)
    codes, inv = np.unique(ev, return_inverse=True)
    E = len(codes)
    S = np.zeros((E, 5))
    for c, v in enumerate([np.ones_like(d), d, ll, ac, mae]):
        S[:, c] = np.bincount(inv, weights=v, minlength=E)
    rng = np.random.default_rng(seed)
    bs = []
    for _ in range(draws):
        T = S[rng.integers(0, E, E)].sum(axis=0)
        bs.append(T[1:] / T[0])
    bs = np.sort(np.array(bs), axis=0)
    lo, hi = bs[int(0.025 * draws)], bs[min(draws - 1, int(0.975 * draws))]
    T = S.sum(axis=0)
    point = T[1:] / T[0]
    names = ["brier", "logLoss", "accuracy", "marginMAE"]
    return {k: {"delta": float(point[i]), "ci95": [float(lo[i]), float(hi[i])]} for i, k in enumerate(names)}


def cfg_name(cfg):
    c = {**PAPER, **cfg}
    return f"h{'x'.join(map(str, c['hidden_layer_sizes']))}-a{c['alpha']:g}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--matches", required=True)
    ap.add_argument("--engine-rows", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    ap.add_argument("--seeds", type=int, default=5)
    ap.add_argument("--variants", default=",".join(VARIANTS))
    args = ap.parse_args()
    t0 = time.time()
    rows, eng = load(args.matches, args.engine_rows)
    F = features(rows)
    keys = [r[0] for r in rows]
    missing = sum(1 for k in keys if k not in eng)
    if missing:
        sys.exit(f"{missing} exported matches have no engine row: the two inputs come from different corpora")
    E = [eng[k] for k in keys]
    y = np.array([e["y"] for e in E], dtype=float)
    data = {
        "y": y, "t": np.array([r[4] for r in rows], dtype=float), "season": np.array([r[1] for r in rows]),
        "event": np.array([r[2] for r in rows]), "level": np.array([r[3] for r in rows]),
        "margin": np.array([r[8][4] - r[9][4] for r in rows], dtype=float),
        "pEngine": np.array([e["pred"]["champion"]["p"] for e in E], dtype=float),
        "mEngine": np.array([e["pred"]["champion"]["muR"] - e["pred"]["champion"]["muB"] for e in E], dtype=float),
    }
    rated = np.array([e["rated"] for e in E])
    decisive = y != 0.5
    data["train_ok"] = rated & decisive
    data["score"] = rated & decisive & np.isin(data["season"], [2024, 2025])
    print(f"{len(rows)} matches; features built in {time.time() - t0:.0f}s", flush=True)

    variants = args.variants.split(",")
    seeds = list(range(args.seeds))
    result = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "engine": "3.3.0",
        "protocol": "rolling origins: each month Oct 2024-Jul 2026 scored by a model fitted on the 365 days before it; decisive matches at rated events; engine = its served pre-match call from engine-slices --rows",
        "paperConfig": {**PAPER, "hidden_layer_sizes": list(PAPER["hidden_layer_sizes"])}, "grid": {}, "chosen": {}, "runs": {},
    }

    def save():
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=1)

    def full(v, cfg, run_seeds, name):
        out = run(F[v], data, cfg, run_seeds, args.jobs, True)
        rs = {}
        for seed, (p, m, origins) in out.items():
            rs[str(seed)] = {"origins": origins, "seasons": score(data, p, m)}
            for label, S in rs[str(seed)]["seasons"].items():
                d = S["mlpMinusEngine"]["brier"]
                print(f"{name} seed {seed} {label}: n {S['mlp']['n']} engine {S['engine']['brier']:.4f} mlp {S['mlp']['brier']:.4f} d {1e4 * d['delta']:+.1f}e-4 [{1e4 * d['ci95'][0]:+.1f}, {1e4 * d['ci95'][1]:+.1f}] acc {100 * S['engine']['accuracy']:.2f}/{100 * S['mlp']['accuracy']:.2f} mae {S['engine']['marginMAE']:.2f}/{S['mlp']['marginMAE']:.2f} ({time.time() - t0:.0f}s)", flush=True)
        c = {**PAPER, **cfg}
        result["runs"][name] = {"config": {**c, "hidden_layer_sizes": list(c["hidden_layer_sizes"])}, "seeds": rs, "seedSummary": summary(rs)}
        save()
        return rs

    # 1) The grid's small nets on the tuning season only (2024-25 test months), seed 0, classifier only.
    for v in variants:
        for cfg in GRID:
            p = run(F[v], data, cfg, [0], args.jobs, False, test_season=2024)[0][0]
            ok = ~np.isnan(p) & (data["season"] == 2024) & data["score"]
            b = float(np.mean((p[ok] - y[ok]) ** 2))
            result["grid"].setdefault(v, {})[cfg_name(cfg)] = {"brier2024": b, "n": int(ok.sum())}
            print(f"grid {v} {cfg_name(cfg)}: Brier 2024-25 {b:.5f} ({time.time() - t0:.0f}s)", flush=True)
    save()

    # 2) The paper's config (5 seeds on the paper features; seed 0 on the other variants: about 11 minutes a fit).
    for v in variants:
        rs = full(v, {}, seeds if v == "paper" else [0], f"{v}/paper-config")
        result["grid"][v][cfg_name({})] = {"brier2024": rs["0"]["seasons"]["2024-25 (tuning)"]["mlp"]["brier"], "n": rs["0"]["seasons"]["2024-25 (tuning)"]["mlp"]["n"]}
        save()

    # 3) The grid's pick per variant (lowest 2024-25 Brier, seed 0), every seed, both seasons.
    for v in variants:
        name, _ = min(result["grid"][v].items(), key=lambda kv: kv[1]["brier2024"])
        result["chosen"][v] = name
        if name == cfg_name({}):
            if v == "paper":
                continue  # already run on every seed
            cfg = {}
        else:
            cfg = next(c for c in GRID if cfg_name(c) == name)
        full(v, cfg, seeds, f"{v}/grid-pick")
    save()
    print(f"wrote {args.out} ({time.time() - t0:.0f}s)")


if __name__ == "__main__":
    main()
