"""Compare two Control Scout backtest ledgers (predictions table) on identical match keys.
usage: python -I compare_ledgers.py <base.db> <cand.db> <out.json>"""
import sqlite3, sys, json, numpy as np
def load(db):
    c = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
    return {(r[0], r[1], r[2], r[3], r[4]): r[5:] for r in c.execute(
        "SELECT season, code, level, series, number, p_red, outcome, red_mean, blue_mean, red_score, blue_score, engine_version FROM predictions WHERE kind='backtest' AND outcome IS NOT NULL")}
A, B = load(sys.argv[1]), load(sys.argv[2])
keys = sorted(set(A) & set(B))
out = {'base_rows': len(A), 'cand_rows': len(B), 'common': len(keys), 'base_engine': sorted({v[-1] for v in A.values()}), 'cand_engine': sorted({v[-1] for v in B.values()}), 'seasons': {}}
def m(p, y, mu, act):
    p = np.clip(p, 1e-9, 1 - 1e-9); nt = y != .5
    c = (np.sign(p - .5) == np.sign(y - .5)).astype(float); c[p == .5] = .5
    legacy = nt & (p != .5)
    err = act - mu
    return {'n': int(len(y)), 'non_ties': int(nt.sum()), 'accuracy': float(c[nt].mean()), 'legacy_accuracy': float(c[legacy].mean()),
            'brier': float(np.mean((p - y) ** 2)), 'log_loss': float(-np.mean(y * np.log(p) + (1 - y) * np.log1p(-p))),
            'score_mae': float(np.abs(err).mean()), 'score_bias': float(err.mean())}
for s in sorted({k[0] for k in keys}):
    ks = [k for k in keys if k[0] == s]
    y = np.array([A[k][1] for k in ks], float)
    assert all(A[k][1] == B[k][1] for k in ks)
    res = {}
    for name, D in (('base', A), ('cand', B)):
        p = np.array([D[k][0] for k in ks], float)
        mu = np.array([[D[k][2], D[k][3]] for k in ks], float); act = np.array([[D[k][4], D[k][5]] for k in ks], float)
        res[name] = m(p, y, mu, act)
    res['accuracy_delta'] = res['cand']['accuracy'] - res['base']['accuracy']
    res['brier_delta'] = res['cand']['brier'] - res['base']['brier']
    out['seasons'][s] = res
open(sys.argv[3], 'w').write(json.dumps(out, indent=1))
print(json.dumps(out, indent=1))
