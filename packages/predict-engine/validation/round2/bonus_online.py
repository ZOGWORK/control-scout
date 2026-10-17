"""Causal (online) bonus-RP models for 2025-26: refit weekly on every earlier qualification alliance
result; evaluated on the results after the first 20% (same test rows as the static comparison).
usage: python bonus_online.py <events.json.gz> <out.json>"""
import sys, json, gzip, numpy as np
from scipy.special import expit, logsumexp
from scipy.optimize import minimize
evs = json.loads(gzip.open(sys.argv[1], 'rt').read())
al = []
for e in evs:
    if e['season'] != 2025: continue
    for m in e['matches']:
        if m['level'] != 'qual': continue
        for s in ('red', 'blue'):
            bf = m[s].get('bonusRp')
            if bf: al.append((m['time'], m[s]['np'], int(bf['movement']), int(bf['goal']), int(bf['pattern'])))
al.sort(); A = np.array(al, float); cut = int(.2 * len(A))
pats = np.array([[(k >> 2) & 1, (k >> 1) & 1, k & 1] for k in range(8)]); cnt = pats.sum(1)
x = A[:, 1] / 100; K = (A[:, 2] * 4 + A[:, 3] * 2 + A[:, 4]).astype(int); C = A[:, 2:].sum(1).astype(int)
def fit_ind(idx):
    out = []
    for j in (2, 3, 4):
        yv = A[idx, j]; xv = x[idx]
        def obj(c):
            zz = c[0] + c[1] * xv
            return np.mean(np.logaddexp(0, zz) - yv * zz) + 1e-4 * .5 * c @ c, np.array([np.mean(expit(zz) - yv), np.mean((expit(zz) - yv) * xv)]) + 1e-4 * c
        out.append(minimize(obj, np.zeros(2), jac=True, method='BFGS').x)
    return out
def fit_joint(idx):
    xv = x[idx]; k = K[idx]
    def obj(th):
        W = th.reshape(8, 2); S = W[:, 0][None] + W[:, 1][None] * xv[:, None]
        return -(S - logsumexp(S, 1, keepdims=True))[np.arange(len(k)), k].mean() + 1e-3 * .5 * th @ th
    return minimize(obj, np.zeros(16), method='L-BFGS-B').x.reshape(8, 2)
def P_ind(c, xv):
    P = np.column_stack([expit(cc[0] + cc[1] * xv) for cc in c])
    return np.prod(np.where(pats[None] == 1, P[:, None, :], 1 - P[:, None, :]), axis=2)
def P_joint(W, xv):
    S = W[:, 0][None] + W[:, 1][None] * xv[:, None]; return np.exp(S - logsumexp(S, 1, keepdims=True))
WEEK = 7 * 864e5
test = np.arange(cut, len(A))
res = {}
static_i, static_j = fit_ind(np.arange(cut)), fit_joint(np.arange(cut))
Pi_s = P_ind(static_i, x[test]); Pj_s = P_joint(static_j, x[test])
# Online: refit at each week boundary on everything before it (strictly earlier results).
Pi_o = np.zeros((len(test), 8)); Pj_o = np.zeros((len(test), 8))
t0 = A[cut, 0]; bounds = np.arange(t0, A[-1, 0] + WEEK, WEEK)
for b0 in bounds:
    sel = np.where((A[test, 0] >= b0) & (A[test, 0] < b0 + WEEK))[0]
    if not len(sel): continue
    past = np.where(A[:, 0] < b0)[0]
    ci, wj = fit_ind(past), fit_joint(past)
    Pi_o[sel] = P_ind(ci, x[test[sel]]); Pj_o[sel] = P_joint(wj, x[test[sel]])
def score(P):
    kk, cc = K[test], C[test]
    Q = np.column_stack([P[:, cnt == c].sum(1) for c in range(4)])
    exp_rp = Q @ np.arange(4)
    return {'pattern_ll': float(np.mean(np.log(np.clip(P[np.arange(len(kk)), kk], 1e-12, 1)))),
            'count_ll': float(np.mean(np.log(np.clip(Q[np.arange(len(cc)), cc], 1e-12, 1)))),
            'count_mae': float(np.mean(np.abs(exp_rp - cc))), 'mean_pred_count': float(exp_rp.mean()), 'mean_obs_count': float(cc.mean())}
for name, P in (('static_independent(current form)', Pi_s), ('static_joint', Pj_s), ('online_independent', Pi_o), ('online_joint', Pj_o)):
    res[name] = score(P); print(f"{name:34s}", {k: round(v, 4) for k, v in res[name].items()})
json.dump({'train_first20pct': int(cut), 'test': int(len(test)), 'results': res}, open(sys.argv[2], 'w'), indent=1)
