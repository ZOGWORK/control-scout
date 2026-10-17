"""Shared helpers for the second-round experiments (chronological blocks, the
research learner, calibration, metrics, paired event bootstrap)."""
import json, gzip, datetime
import numpy as np
from scipy.special import expit, logit
from scipy.optimize import minimize

UTC = datetime.timezone.utc
def stamp(s): return int(datetime.datetime.fromisoformat(s).replace(tzinfo=UTC).timestamp() * 1000)
JAN25, MAR25, JUN25 = stamp('2025-01-01'), stamp('2025-03-01'), stamp('2025-06-01')

def load(path):
    with gzip.open(path, 'rt') as f: return json.load(f)

def blocks(rows):
    s = np.array([r['season'] for r in rows]); t = np.array([r['time'] for r in rows])
    return {
        'train': (s == 2023) | ((s == 2024) & (t < JAN25)),
        'select': (s == 2024) & (t >= JAN25) & (t < MAR25),
        'calibrate': (s == 2024) & (t >= MAR25) & (t < JUN25),
        'audit': (s == 2024) & (t >= JUN25),
        'test2025': s == 2025,
    }

def fit_logistic(D, z, y, keep, ridge=1e-3):
    """The research learner: mirrored examples, train-std scales floored at .05, ridge, BFGS."""
    k = keep & (y != .5)
    scale = np.maximum(D[k].std(axis=0), .05)
    Ds = D / scale
    Dt = np.concatenate([Ds[k], -Ds[k]]); yt = np.concatenate([y[k], 1 - y[k]]); off = np.concatenate([z[k], -z[k]])
    def obj(b):
        zz = off + Dt @ b
        return np.mean(np.logaddexp(0, zz) - yt * zz) + ridge * .5 * b @ b, Dt.T @ (expit(zz) - yt) / len(yt) + ridge * b
    opt = minimize(obj, np.zeros(D.shape[1]), jac=True, method='BFGS', options={'gtol': 1e-8, 'maxiter': 300})
    return {'coef': opt.x, 'scale': scale, 'converged': bool(opt.success)}

def raw_prob(model, D, z): return np.clip(expit(z + (D / model['scale']) @ model['coef']), 1e-8, 1 - 1e-8)

def fit_cal(p, y, keep):
    k = keep & (y != .5); x = logit(np.clip(p[k], 1e-8, 1 - 1e-8)); yy = y[k]
    X = np.column_stack([x, np.ones(len(x))]); init = np.array([1., 0.]); pen = np.array([1e-4, 1e-4])
    def obj(b):
        zz = X @ b
        return np.logaddexp(0, zz).sum() - yy @ zz + .5 * (pen * (b - init)) @ (b - init), X.T @ (expit(zz) - yy) + pen * (b - init)
    b = minimize(obj, init, jac=True, method='BFGS', options={'gtol': 1e-7, 'maxiter': 200}).x
    return b if b[0] > 0 else init

def apply_cal(p, b): return expit(b[0] * logit(np.clip(p, 1e-8, 1 - 1e-8)) + b[1])

def metrics(y, p, keep=None):
    keep = np.ones(len(y), bool) if keep is None else keep
    y = y[keep]; p = np.clip(p[keep], 1e-9, 1 - 1e-9); nt = y != .5
    c = (np.sign(p - .5) == np.sign(y - .5)).astype(float); c[p == .5] = .5
    ece = 0.
    for lo in np.linspace(0, .9, 10):
        k = (p >= lo) & (p < lo + .10000000001)
        if k.any(): ece += k.mean() * abs(p[k].mean() - y[k].mean())
    return {'n': int(len(y)), 'accuracy': float(c[nt].mean()), 'brier': float(np.mean((p - y) ** 2)),
            'log_loss': float(-np.mean(y * np.log(p) + (1 - y) * np.log1p(-p))), 'ece10': float(ece)}

def paired(rows, y, p, ref, keep, draws=2000, seed=20261017):
    idx = np.where(keep)[0]; yy = y[idx]; nt = yy != .5
    def corr(q):
        c = (np.sign(q - .5) == np.sign(yy - .5)).astype(float); c[q == .5] = .5; c[~nt] = 0; return c
    dc = corr(p[idx]) - corr(ref[idx]); db = (p[idx] - yy) ** 2 - (ref[idx] - yy) ** 2
    keys = [rows[i]['event'] for i in idx]; _, ix = np.unique(keys, return_inverse=True); n = ix.max() + 1
    cnt = np.bincount(ix); ntc = np.bincount(ix, weights=nt.astype(float)); cd = np.bincount(ix, weights=dc); bd = np.bincount(ix, weights=db)
    rng = np.random.default_rng(seed); smp = rng.integers(0, n, size=(draws, n))
    ad = cd[smp].sum(1) / ntc[smp].sum(1); bs = bd[smp].sum(1) / cnt[smp].sum(1)
    return {'acc_delta_pp': float(100 * dc.sum() / nt.sum()), 'acc95': [float(x) for x in 100 * np.quantile(ad, [.025, .975])],
            'brier_delta': float(db.mean()), 'brier95': [float(x) for x in np.quantile(bs, [.025, .975])]}
