"""Compare engine-replay ledgers with each other and with the frozen research ledger.

usage: python -I evaluate_engine.py <runs dir> <research heldout-predictions.csv.gz> <out json> [baseline=legacy_seq]
Metrics follow the research metrics.py conventions exactly: tie y=0.5 counts in
Brier/log loss; accuracy is over non-ties with exact 0.5 predictions scored as
half credit; legacy accuracy drops exact 0.5 predictions.
"""
import sys, json, gzip, csv, datetime
from pathlib import Path
import numpy as np

runs, ledger_path, out_path = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
baseline_name = sys.argv[4] if len(sys.argv) > 4 else 'legacy_seq'
Z80 = 1.2815515655446004

def load(name):
    with gzip.open(runs / f'{name}.json.gz', 'rt') as f:
        return json.load(f)

def metrics(rows, p, keep=None):
    keep = np.ones(len(rows), bool) if keep is None else keep
    y = np.array([r['y'] for r in rows])[keep]
    p = np.clip(np.asarray(p)[keep], 1e-9, 1 - 1e-9)
    nt = y != .5
    correct = (np.sign(p - .5) == np.sign(y - .5)).astype(float); correct[p == .5] = .5
    legacy = nt & (p != .5)
    res = {'matches': int(len(y)), 'non_ties': int(nt.sum()), 'exact_half_predictions': int((p == .5).sum()),
           'accuracy': float(correct[nt].mean()) if nt.any() else None,
           'legacy_accuracy': float(correct[legacy].mean()) if legacy.any() else None,
           'brier': float(np.mean((p - y) ** 2)),
           'log_loss': float(-np.mean(y * np.log(p) + (1 - y) * np.log1p(-p)))}
    ece = 0
    bins = []
    for lo in np.linspace(0, .9, 10):
        k = (p >= lo) & (p < lo + .10000000001)
        if k.any():
            ece += k.mean() * abs(p[k].mean() - y[k].mean())
            bins.append({'lo': round(float(lo), 1), 'n': int(k.sum()), 'mean_p': float(p[k].mean()), 'mean_y': float(y[k].mean())})
    res['ece10'] = float(ece); res['reliability_bins'] = bins
    mus = np.array([[r['muR'], r['muB']] for r in rows])[keep]
    acts = np.array([[r['actR'], r['actB']] for r in rows])[keep]
    sds = np.array([[r['sdR'], r['sdB']] for r in rows])[keep]
    err = acts - mus
    res.update(score_mae=float(np.abs(err).mean()), score_bias_actual_minus_predicted=float(err.mean()),
               interval80_coverage=float((np.abs(err) <= Z80 * sds).mean()))
    return res

def compare(rows, p, ref, group='event', draws=5000):
    y = np.array([r['y'] for r in rows]); nt = y != .5
    def correct(q):
        c = (np.sign(q - .5) == np.sign(y - .5)).astype(float); c[q == .5] = .5; c[~nt] = 0; return c
    dc = correct(p) - correct(ref); db = (p - y) ** 2 - (ref - y) ** 2
    keys = [r['event'] if group == 'event' else int(r['time'] // (7 * 864e5)) for r in rows]
    _, ix = np.unique(keys, return_inverse=True); n = int(ix.max()) + 1
    counts = np.bincount(ix); ntc = np.bincount(ix, weights=nt.astype(float))
    cd = np.bincount(ix, weights=dc); bd = np.bincount(ix, weights=db)
    rng = np.random.default_rng(20261016 if group == 'event' else 20261017)
    s = rng.integers(0, n, size=(draws, n))
    ad = cd[s].sum(1) / ntc[s].sum(1); bs = bd[s].sum(1) / counts[s].sum(1)
    return {'clusters': n, 'draws': draws, 'accuracy_delta': float(dc.sum() / nt.sum()),
            'accuracy_delta_95': np.quantile(ad, [.025, .975]).tolist(),
            'brier_delta': float(db.mean()), 'brier_delta_95': np.quantile(bs, [.025, .975]).tolist(),
            'extra_correct': float(dc.sum())}

names = sorted(p.name[:-8] for p in runs.glob('*.json.gz'))
data = {n: load(n) for n in names}
ids = [r['id'] for r in data[baseline_name]]
for n in names: assert [r['id'] for r in data[n]] == ids, n
rows = data[baseline_name]
P = {n: np.array([r['p'] for r in data[n]]) for n in names}

# Parity with the frozen research ledger (same ids, same order).
with gzip.open(ledger_path, 'rt') as f:
    led = list(csv.DictReader(f))
assert [r['id'] for r in led] == ids, 'cohort differs from the research ledger'
ref = {k: np.array([float(r[k]) for r in led]) for k in ('champion', 'reliability_primary')}
parity = {}
for n, k in (('legacy_seq', 'champion'), ('primary_seq', 'reliability_primary')):
    if n in P:
        d = np.abs(P[n] - ref[k])
        parity[f'{n}_vs_research_{k}'] = {'max_abs': float(d.max()), 'mean_abs': float(d.mean()), 'n_over_1e-12': int((d > 1e-12).sum()),
                                          'n_over_1e-6': int((d > 1e-6).sum()), 'n_over_1e-3': int((d > 1e-3).sum()),
                                          'winner_pick_disagreements': int((np.sign(P[n] - .5) != np.sign(ref[k] - .5)).sum())}

res = {'evaluated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'cohort': {'season': 2025, 'matches': len(rows),
       'events': len(set(r['event'] for r in rows))}, 'parity': parity, 'metrics': {}, 'vs_baseline': {}, 'subgroups': {}}
for n in names:
    res['metrics'][n] = metrics(data[n], P[n])
    if n != baseline_name:
        res['vs_baseline'][n] = {'event': compare(rows, P[n], P[baseline_name]), 'week': compare(rows, P[n], P[baseline_name], 'week')}

ph = np.array([r['level'] == 'playoff' for r in rows]); nmin = np.array([r['nMin'] for r in rows])
base = P[baseline_name]
groups = {'qualification': ~ph, 'playoff': ph, 'experience0': nmin == 0, 'experience1to3': (nmin >= 1) & (nmin <= 3),
          'experience4to9': (nmin >= 4) & (nmin <= 9), 'experience10plus': nmin >= 10, 'close_baseline_40to60': np.abs(base - .5) < .1,
          'strong_favorite_baseline80plus': np.maximum(base, 1 - base) >= .8}
months = np.array([datetime.datetime.fromtimestamp(r['time'] / 1000, datetime.timezone.utc).strftime('%Y-%m') for r in rows])
for m in sorted(set(months)): groups[f'month_{m}'] = months == m
regions = np.array([r['region'] or '' for r in rows])
for g in sorted(set(regions)):
    if (regions == g).sum() >= 500: groups[f'region_{g}'] = regions == g
for n in names:
    if n == baseline_name: continue
    res['subgroups'][n] = {}
    for g, k in groups.items():
        if not k.any(): continue
        b = metrics(rows, base, k); c = metrics(data[n], P[n], k)
        res['subgroups'][n][g] = {'matches': b['matches'], 'accuracy_delta': c['accuracy'] - b['accuracy'], 'brier_delta': c['brier'] - b['brier']}
out_path.write_text(json.dumps(res, indent=2) + '\n')
print(json.dumps({'parity': parity, 'metrics': {n: {k: v for k, v in m.items() if k != 'reliability_bins'} for n, m in res['metrics'].items()},
                  'vs_baseline': res['vs_baseline']}, indent=1))
