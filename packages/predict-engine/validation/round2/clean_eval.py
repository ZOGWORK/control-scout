"""Clean (forward-only) evaluation of Engine 2.1 vs 2.0.

Part A, deployed artifacts: the frozen 2.0 and 2.1 models exactly as shipped (coefficients
fitted on data before 2025-01-01, final calibration on 2025-03-01..05-31), scored only on
matches after everything either model saw: season 2024 from 2025-06-01 (988 matches, never
used for any decision) and season 2025-26 (reused: examined in 2.0 validation and used for
round-2 vetoes; reported, not proof).

Part B, the method rolled forward: at monthly origins t from 2025-01-01, both feature sets
are refitted from scratch with the research learner. Coefficients come from all matches before
t - 56 days, the final calibration from [t - 56 days, t), and the score from [t, next origin).
No fitted quantity sees any outcome at or after t. Origins run through the 2024 season and
the 2025-26 season (whose months stay labelled as reused data).

The deployed 2.1 probabilities are recomputed here from the shipped artifact
(packages/predict-engine/src/model.json, contextual = 2.1, contextual.fallback = 2.0) and
the replay rows, so nothing outside the repository is needed beyond the rows file.

When the 56 days before an origin hold fewer than 200 decided matches (the gaps between
seasons), the calibration window is widened backwards a week at a time until it does, and
the coefficient cutoff moves back with it. Each origin's actual windows are recorded.

usage (rows from exp-replay.mjs on an engine build that ships the frozen 2.0 model):
  python clean_eval.py <rows-sym.json.gz> <packages/predict-engine/src/model.json> <out.json>"""
import sys, json, datetime, numpy as np
sys.path.insert(0, '.')
from explib import load, fit_logistic, raw_prob, fit_cal, apply_cal, metrics, paired, stamp

rows = load(sys.argv[1])
model = json.load(open(sys.argv[2], encoding='utf-8'))['contextual']
y = np.array([r['y'] for r in rows]); t = np.array([r['time'] for r in rows]); season = np.array([r['season'] for r in rows])
X = np.array([r['x'] for r in rows]); pr = np.clip(np.array([r['pRaw'] for r in rows]), 1e-9, 1 - 1e-9); L = np.log(pr / (1 - pr))
C = {k: np.array([r['c'][k] for r in rows]) for k in rows[0]['c']}
X21 = np.column_stack([X, C['evForm'], L * C['evN'], C['momentum'], C['lastFail'], C['recovery']])
p20 = np.array([r['p'] for r in rows])
# Deployed 2.1: z = L + sum(coef * D / scale); raw clipped to [1e-8, 1-1e-8]; final logit calibration.
assert len(model['coefficients']) == X21.shape[1], 'model.json contextual is not the 22-input 2.1 model'
from scipy.special import expit, logit as _logit
_raw = np.clip(expit(L + (X21 / np.array(model['scale'])) @ np.array(model['coefficients'])), 1e-8, 1 - 1e-8)
p21 = expit(model['calibration']['slope'] * _logit(_raw) + model['calibration']['intercept'])
out = {}

# ---- Part A: deployed artifacts on strictly-later blocks.
JUN25 = stamp('2025-06-01')
blocksA = {'audit_2024_from_jun2025 (never used for decisions)': (season == 2024) & (t >= JUN25), 'season_2025_26 (reused)': season == 2025}
out['A_deployed'] = {}
for name, k in blocksA.items():
    out['A_deployed'][name] = {'2.0': metrics(y, p20, k), '2.1': metrics(y, p21, k), 'paired_2.1_minus_2.0': paired(rows, y, p21, p20, k, draws=5000)}

# ---- Part B: rolling origins.
def month_starts(a, b):
    d = datetime.datetime.fromisoformat(a); end = datetime.datetime.fromisoformat(b); out = []
    while d < end:
        out.append(d); d = (d.replace(day=1) + datetime.timedelta(days=32)).replace(day=1)
    return out
CAL = 56 * 864e5
origins = [o for o in month_starts('2025-01-01', '2026-08-01')]
ts = [int(o.replace(tzinfo=datetime.timezone.utc).timestamp() * 1000) for o in origins] + [int(datetime.datetime(2026, 8, 1, tzinfo=datetime.timezone.utc).timestamp() * 1000)]
pB = {'2.0': np.full(len(y), np.nan), '2.1': np.full(len(y), np.nan)}
fits = []
for i in range(len(origins)):
    t0, t1 = ts[i], ts[i + 1]
    ev = (t >= t0) & (t < t1)
    if ev.sum() < 50: continue
    fitk = t < t0 - CAL; calk = (t >= t0 - CAL) & (t < t0)
    if (calk & (y != .5)).sum() < 200:
        # Too little calibration data just before the origin (season gaps): widen the window backwards.
        lo = t0 - CAL
        while (((t >= lo) & (t < t0)) & (y != .5)).sum() < 200: lo -= 7 * 864e5
        calk = (t >= lo) & (t < t0); fitk = t < lo
    iso = lambda ms: datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).date().isoformat()
    cal_start = int(t[calk].min()) if calk.any() else t0
    rec = {'origin': origins[i].date().isoformat(), 'eval': int(ev.sum()), 'fit': int(fitk.sum()), 'calibration': int(calk.sum()),
           'calibrationWindow': [iso(cal_start), iso(t0)], 'coefficientCutoff': iso(cal_start), 'widened': bool(t0 - cal_start > CAL + 864e5)}
    for name, D in (('2.0', X), ('2.1', X21)):
        m = fit_logistic(D, L, y, fitk); raw = raw_prob(m, D, L); b = fit_cal(raw, y, calk)
        pB[name][ev] = apply_cal(raw, b)[ev]
        rec[name] = {'converged': m['converged'], 'calibration': [float(b[0]), float(b[1])], **metrics(y, pB[name], ev)}
    fits.append(rec)
    print(rec['origin'], rec['eval'], 'acc', round(rec['2.0']['accuracy'], 4), round(rec['2.1']['accuracy'], 4), 'brier', round(rec['2.0']['brier'], 5), round(rec['2.1']['brier'], 5), flush=True)
done = ~np.isnan(pB['2.0'])
segments = {'2024 season (Jan-Jul 2025; never used for decisions after this clean refit)': done & (season == 2024),
            '2025-26 season (reused)': done & (season == 2025), 'all rolled months': done}
out['B_rolling'] = {'calibration_window_days': 56, 'origins': fits, 'segments': {}}
for name, k in segments.items():
    out['B_rolling']['segments'][name] = {'2.0': metrics(y, pB['2.0'], k), '2.1': metrics(y, pB['2.1'], k), 'paired_2.1_minus_2.0': paired(rows, y, pB['2.1'], pB['2.0'], k, draws=5000)}
json.dump(out, open(sys.argv[3], 'w'), indent=1)
f = lambda m: f"acc {100*m['accuracy']:.2f} brier {m['brier']:.5f} ll {m['log_loss']:.5f} ece {100*m['ece10']:.2f}"
for part in ('A_deployed',):
    for name, r in out[part].items(): print('A', name, '| 2.0', f(r['2.0']), '| 2.1', f(r['2.1']), '|', r['paired_2.1_minus_2.0'])
for name, r in out['B_rolling']['segments'].items(): print('B', name, '| 2.0', f(r['2.0']), '| 2.1', f(r['2.1']), '|', r['paired_2.1_minus_2.0'])
