"""Round-2 match-probability experiments against Engine 2.0 (PROTOCOL-round2.md).
usage: python run_prob_experiments.py <rows-sym> <rows-rebuild> <rows-gapunc> <out.json>"""
import sys, json, numpy as np
sys.path.insert(0, '.')
from explib import load, blocks, fit_logistic, raw_prob, fit_cal, apply_cal, metrics, paired

def prep(path):
    rows = load(path)
    y = np.array([r['y'] for r in rows]); X = np.array([r['x'] for r in rows])
    pr = np.clip(np.array([r['pRaw'] for r in rows]), 1e-9, 1 - 1e-9); L = np.log(pr / (1 - pr))
    C = {k: np.array([r['c'][k] for r in rows]) for k in rows[0]['c']}
    return rows, y, X, L, C, np.array([r['p'] for r in rows]), blocks(rows)

rows, y, X, L, C, p20, B = prep(sys.argv[1])
# Symmetric inputs enter as interactions with L (so red/blue mirroring stays exact).
C['L_evN'] = L * C['evN']
GROUPS = {
    'A_evForm': ['evForm', 'L_evN'], 'A_momentum': ['momentum'], 'A_failure': ['lastFail', 'recovery'], 'A_longGap': ['longGap'], 'A_lastNp': ['lastNp'],
    'B_compat': ['autoMin', 'egMin'], 'B_roleComp': ['roleComp'], 'B_congestion': ['congestion'], 'B_defense': ['defense'], 'B_familiarity': ['familiarity'],
}

def evaluate(name, D, LL, yy, BB, rr, ref_sel, ref_test, extra=None):
    m = fit_logistic(D, LL, yy, BB['train'])
    raw = raw_prob(m, D, LL); cal = fit_cal(raw, yy, BB['calibrate']); p = apply_cal(raw, cal)
    res = {'converged': m['converged'], 'n_inputs': D.shape[1], 'calibration': [float(cal[0]), float(cal[1])]}
    for b in ('select', 'audit', 'test2025'): res[b] = metrics(yy, p, BB[b])
    res['vs_refit_select'] = paired(rr, yy, p, ref_sel, BB['select'])
    res['vs_refit_test2025'] = paired(rr, yy, p, ref_test, BB['test2025'])
    if extra: res.update(extra)
    return p, res

out = {'protocol_sha256': open(sys.argv[1].replace('rows-sym.json.gz', 'PROTOCOL-round2.sha256')).read().split()[0]}
# Baselines.
mb = fit_logistic(X, L, y, B['train']); rawb = raw_prob(mb, X, L); calb = fit_cal(rawb, y, B['calibrate']); pref = apply_cal(rawb, calb)
out['refit_2.0'] = {b: metrics(y, pref, B[b]) for b in ('select', 'audit', 'test2025')}
out['refit_2.0']['calibration'] = [float(calb[0]), float(calb[1])]
out['shipped_2.0'] = {b: metrics(y, p20, B[b]) for b in ('select', 'audit', 'test2025')}
out['refit_vs_shipped_test2025'] = paired(rows, y, pref, p20, B['test2025'])

def verdict(r):
    s = r['vs_refit_select']; t = r['vs_refit_test2025']
    ok = s['brier95'][1] < 0 and r['select']['log_loss'] < out['refit_2.0']['select']['log_loss']
    veto = t['brier95'][0] > 0
    return 'PASS' if ok and not veto else ('VETO(test2025)' if ok else 'REJECT')

results = {}
for g, cols in GROUPS.items():
    D = np.column_stack([X] + [C[c] for c in cols])
    _, r = evaluate(g, D, L, y, B, rows, pref, pref); r['verdict'] = verdict(r); results[g] = r
# Rating-dynamics variants (track A): different ratings -> refit the 17 inputs on them.
for name, path in (('A_rebuild_gap4w_n4_unc200', sys.argv[2]), ('A_gapUncertainty_gap4w_unc200', sys.argv[3])):
    rows2, y2, X2, L2, C2, p202, B2 = prep(path)
    assert [r['id'] for r in rows2] == [r['id'] for r in rows]
    _, r = evaluate(name, X2, L2, y2, B2, rows, pref, pref)
    sm = lambda rr, blk: float(np.mean(np.abs(np.concatenate([[x['actR'] - x['muR'] for x, k in zip(rr, B[blk]) if k], [x['actB'] - x['muB'] for x, k in zip(rr, B[blk]) if k]]))))
    r['score_mae_select'] = {'variant': sm(rows2, 'select'), 'base': sm(rows, 'select')}
    r['score_mae_test2025'] = {'variant': sm(rows2, 'test2025'), 'base': sm(rows, 'test2025')}
    r['verdict'] = verdict(r); results[name] = r

# Track combinations: only individually passing groups (protocol).
for track in ('A', 'B'):
    passing = [g for g in GROUPS if g.startswith(track + '_') and results[g]['verdict'] == 'PASS']
    if len(passing) >= 1:
        cols = sum((GROUPS[g] for g in passing), [])
        D = np.column_stack([X] + [C[c] for c in cols])
        _, r = evaluate(f'{track}_combined', D, L, y, B, rows, pref, pref, {'groups': passing}); r['verdict'] = verdict(r); results[f'{track}_combined'] = r
passing_all = [g for g in GROUPS if results[g]['verdict'] == 'PASS']
if len(passing_all) >= 2:
    cols = sum((GROUPS[g] for g in passing_all), [])
    D = np.column_stack([X] + [C[c] for c in cols])
    _, r = evaluate('AB_combined', D, L, y, B, rows, pref, pref, {'groups': passing_all}); r['verdict'] = verdict(r); results['AB_combined'] = r
out['candidates'] = results
json.dump(out, open(sys.argv[4], 'w'), indent=1)
f = lambda m: f"acc {100*m['accuracy']:.2f} brier {m['brier']:.5f} ll {m['log_loss']:.5f} ece {100*m['ece10']:.2f}"
print('shipped 2.0  select', f(out['shipped_2.0']['select']), '| test2025', f(out['shipped_2.0']['test2025']))
print('refit 2.0    select', f(out['refit_2.0']['select']), '| test2025', f(out['refit_2.0']['test2025']))
for k, r in results.items():
    s, t = r['vs_refit_select'], r['vs_refit_test2025']
    print(f"{k:32s} {r['verdict']:15s} select dBrier {s['brier_delta']:+.5f} [{s['brier95'][0]:+.5f},{s['brier95'][1]:+.5f}] dAcc {s['acc_delta_pp']:+.2f} | test dBrier {t['brier_delta']:+.5f} [{t['brier95'][0]:+.5f},{t['brier95'][1]:+.5f}] dAcc {t['acc_delta_pp']:+.2f}")
