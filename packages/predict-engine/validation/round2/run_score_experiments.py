"""Round-2 track C (score side): score-mean recalibration, complementary-model blends, correlated bonus RPs.
usage: python run_score_experiments.py <rows-sym> <ridge-dev.json.gz> <ridge-test.json.gz> <events.json.gz> <out.json>"""
import sys, json, gzip, numpy as np
from scipy.special import expit, logsumexp
from scipy.optimize import minimize
sys.path.insert(0, '.')
from explib import load, blocks, metrics, paired

Z80 = 1.2815515655446004
rows = load(sys.argv[1]); B = blocks(rows); y = np.array([r['y'] for r in rows])
ridge = load(sys.argv[2]) + load(sys.argv[3])
assert [r['id'] for r in ridge] == [r['id'] for r in rows], 'row order differs'
g = lambda rs, k: np.array([r[k] for r in rs], float)
mu = np.column_stack([g(rows, 'muR'), g(rows, 'muB')]); sd = np.column_stack([g(rows, 'sdR'), g(rows, 'sdB')]); act = np.column_stack([g(rows, 'actR'), g(rows, 'actB')])
muK = np.column_stack([g(ridge, 'muR'), g(ridge, 'muB')]); pK = g(ridge, 'p'); p20 = g(rows, 'p')

def score_metrics(m, s, keep):
    e = act[keep] - m[keep]
    return {'mae': float(np.abs(e).mean()), 'bias_actual_minus_pred': float(e.mean()), 'cov80': float((np.abs(e) <= Z80 * s[keep]).mean()),
            'mean_width80': float((2 * Z80 * s[keep]).mean())}
out = {'baseline_2.0': {b: score_metrics(mu, sd, B[b]) for b in ('select', 'audit', 'test2025')}}

# C1: score-mean recalibration actual = a + b * predicted (alliance level), fitted on train; then a
# multiplicative sd scale fitted on train for 80% coverage of the recalibrated means.
tr = B['train']; xs = mu[tr].ravel(); ys = act[tr].ravel()
b, a = np.polyfit(xs, ys, 1)
mu1 = a + b * mu
res_tr = np.abs(act[tr] - mu1[tr]) / sd[tr]; s_scale = float(np.quantile(res_tr.ravel(), .8) / Z80)
out['C1_score_recal'] = {'a': float(a), 'b': float(b), 'sd_scale': s_scale,
                         **{b_: score_metrics(mu1, sd, B[b_]) for b_ in ('select', 'audit', 'test2025')},
                         'with_sd_scale': {b_: score_metrics(mu1, sd * s_scale, B[b_]) for b_ in ('select', 'test2025')}}

# C3: complementary model (event-local covariance ratings) blends; weights chosen on select only.
best_v = min(np.linspace(0, 1, 21), key=lambda v: np.abs(act[B['select']] - ((1 - v) * mu + v * muK)[B['select']]).mean())
muB_ = (1 - best_v) * mu + best_v * muK
out['C3_score_blend'] = {'weight_complementary': float(best_v), **{b_: score_metrics(muB_, sd, B[b_]) for b_ in ('select', 'test2025')},
                         'complementary_alone': {b_: score_metrics(muK, sd, B[b_]) for b_ in ('select', 'test2025')}}
best_w = min(np.linspace(0, 1, 21), key=lambda w: np.mean((((1 - w) * p20 + w * pK) - y)[B['select']] ** 2))
pB_ = (1 - best_w) * p20 + best_w * pK
out['C3_prob_blend'] = {'weight_complementary': float(best_w), **{b_: metrics(y, pB_, B[b_]) for b_ in ('select', 'test2025')},
                        'vs_2.0_select': paired(rows, y, pB_, p20, B['select']), 'vs_2.0_test2025': paired(rows, y, pB_, p20, B['test2025'])}

# C4: correlated bonus RPs (2025 is the only season with them): fit on the earliest 20% of qual alliance
# results (the existing model's protocol), test on the later 80%. Independent per-flag logistics vs a
# joint 8-pattern softmax in NP.
evs = json.loads(gzip.open(sys.argv[4], 'rt').read())
al = []
for e in evs:
    if e['season'] != 2025: continue
    for m in e['matches']:
        if m['level'] != 'qual': continue
        for s in ('red', 'blue'):
            bf = m[s].get('bonusRp')
            if bf: al.append((m['time'], m[s]['np'], int(bf['movement']), int(bf['goal']), int(bf['pattern'])))
al.sort(); A = np.array(al, float); cut = int(.2 * len(A)); trA, teA = A[:cut], A[cut:]
npv = lambda Z: Z[:, 1] / 100
def fit1(Z, j):
    x = npv(Z); yv = Z[:, j]
    def obj(c):
        zz = c[0] + c[1] * x
        return np.mean(np.logaddexp(0, zz) - yv * zz), np.array([np.mean(expit(zz) - yv), np.mean((expit(zz) - yv) * x)])
    return minimize(obj, np.zeros(2), jac=True, method='BFGS').x
ind = [fit1(trA, j) for j in (2, 3, 4)]
def ind_probs(Z):
    x = npv(Z); P = np.column_stack([expit(c[0] + c[1] * x) for c in ind])
    pats = np.array([[(k >> 2) & 1, (k >> 1) & 1, k & 1] for k in range(8)])
    return np.prod(np.where(pats[None, :, :] == 1, P[:, None, :], 1 - P[:, None, :]), axis=2), pats
def pattern_idx(Z): return (Z[:, 2] * 4 + Z[:, 3] * 2 + Z[:, 4]).astype(int)
def fit_joint(Z):
    x = npv(Z); k = pattern_idx(Z)
    def obj(th):
        W = th.reshape(8, 2); S = W[:, 0][None, :] + W[:, 1][None, :] * x[:, None]
        lp = S - logsumexp(S, axis=1, keepdims=True)
        return -lp[np.arange(len(k)), k].mean() + 1e-3 * .5 * th @ th
    return minimize(obj, np.zeros(16), method='L-BFGS-B').x.reshape(8, 2)
J = fit_joint(trA)
def joint_probs(Z):
    x = npv(Z); S = J[:, 0][None, :] + J[:, 1][None, :] * x[:, None]
    return np.exp(S - logsumexp(S, axis=1, keepdims=True))
Pi, pats = ind_probs(teA); Pj = joint_probs(teA); k = pattern_idx(teA); cnt = pats.sum(1); kc = teA[:, 2:].sum(1).astype(int)
def count_ll(P): Q = np.column_stack([P[:, cnt == c].sum(1) for c in range(4)]); return float(np.mean(np.log(np.clip(Q[np.arange(len(kc)), kc], 1e-12, 1))))
out['C4_bonus_correlation'] = {
    'train_alliances': int(cut), 'test_alliances': int(len(teA)),
    'pattern_loglik_independent': float(np.mean(np.log(Pi[np.arange(len(k)), k]))), 'pattern_loglik_joint': float(np.mean(np.log(Pj[np.arange(len(k)), k]))),
    'count_loglik_independent': count_ll(Pi), 'count_loglik_joint': count_ll(Pj),
    'test_residual_corr_given_np': np.corrcoef((teA[:, 2:] - np.column_stack([expit(c[0] + c[1] * npv(teA)) for c in ind])).T).tolist(),
}
json.dump(out, open(sys.argv[5], 'w'), indent=1)
pr = lambda d: {k: (round(v, 4) if isinstance(v, float) else v) for k, v in d.items()}
for k in ('select', 'test2025'): print('2.0', k, pr(out['baseline_2.0'][k]))
c1 = out['C1_score_recal']; print('C1 a,b,s', round(c1['a'], 3), round(c1['b'], 4), round(c1['sd_scale'], 4))
for k in ('select', 'test2025'): print('C1', k, pr(c1[k]), 'sd-scaled', pr(c1['with_sd_scale'][k]))
c3 = out['C3_score_blend']; print('C3 score w', c3['weight_complementary'], {k: pr(c3[k]) for k in ('select', 'test2025')}, 'ridge alone', {k: pr(c3['complementary_alone'][k]) for k in ('select', 'test2025')})
c3p = out['C3_prob_blend']; print('C3 prob w', c3p['weight_complementary'], pr(c3p['select']), pr(c3p['test2025']), c3p['vs_2.0_select'], c3p['vs_2.0_test2025'])
print('C4', pr({k: v for k, v in out['C4_bonus_correlation'].items() if k != 'test_residual_corr_given_np'}), np.round(out['C4_bonus_correlation']['test_residual_corr_given_np'], 3).tolist())

# Where does the joint model's gain come from? Per-flag marginal log loss (test) and the
# independent model with its own refit on the same train slice vs the shipped 2025 coefficients.
marg_i = np.column_stack([expit(c[0] + c[1] * npv(teA)) for c in ind])
marg_j = np.column_stack([Pj[:, pats[:, f] == 1].sum(1) for f in range(3)])
ll = lambda P, Y: float(-np.mean(Y * np.log(np.clip(P, 1e-12, 1)) + (1 - Y) * np.log(np.clip(1 - P, 1e-12, 1))))
print('marginal logloss indep', [round(ll(marg_i[:, f], teA[:, 2 + f]), 4) for f in range(3)], 'joint', [round(ll(marg_j[:, f], teA[:, 2 + f]), 4) for f in range(3)])
print('base rates train', trA[:, 2:].mean(0).round(3), 'test', teA[:, 2:].mean(0).round(3))
obs = np.bincount(kc, minlength=4) / len(kc)
Qi = np.column_stack([Pi[:, cnt == c].sum(1) for c in range(4)]).mean(0); Qj = np.column_stack([Pj[:, cnt == c].sum(1) for c in range(4)]).mean(0)
print('count dist observed', obs.round(3), 'indep', Qi.round(3), 'joint', Qj.round(3))
