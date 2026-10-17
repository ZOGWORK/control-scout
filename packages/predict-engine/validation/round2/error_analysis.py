"""Where Engine 2.0 still goes wrong. Diagnostics only (no fitting).
usage: python error_analysis.py <rows.json.gz> <out.json>"""
import sys, json, numpy as np
sys.path.insert(0, '.')
from explib import load, blocks, metrics

rows = load(sys.argv[1]); y = np.array([r['y'] for r in rows]); p = np.array([r['p'] for r in rows]); B = blocks(rows)
nmin = np.array([r['nMin'] for r in rows]); gap = np.array([r['maxGap'] for r in rows]); po = np.array([r['level'] == 'playoff' for r in rows])
unk = np.array([r['unknown'] for r in rows]); C = {k: np.array([r['c'][k] for r in rows]) for k in rows[0]['c']}
muR = np.array([r['muR'] for r in rows]); muB = np.array([r['muB'] for r in rows]); actR = np.array([r['actR'] for r in rows]); actB = np.array([r['actB'] for r in rows])
npR = np.array([r['npR'] for r in rows]); npB = np.array([r['npB'] for r in rows])
fav = np.maximum(p, 1 - p); favRed = p >= .5
upset = (y != .5) & ((p > .5) != (y == 1))
# Favourite side's own collapse: its actual score under half its predicted mean.
favMu = np.where(favRed, muR, muB); favAct = np.where(favRed, actR, actB); dogMu = np.where(favRed, muB, muR); dogAct = np.where(favRed, actB, actR)
favCollapse = favAct < .5 * favMu
dogSurge = dogAct > 1.5 * dogMu
evN = C['evN']

out = {}
for blk in ('select', 'calibrate', 'audit', 'test2025'):
    K = B[blk]; tot = np.sum((p[K] - y[K]) ** 2)
    def grp(mask):
        k = K & mask
        if not k.any(): return None
        m = metrics(y, p, k)
        m['share_of_matches'] = float(k.sum() / K.sum()); m['share_of_brier'] = float(np.sum((p[k] - y[k]) ** 2) / tot)
        m['mean_p_fav'] = float(fav[k].mean()); m['fav_win_rate'] = float(1 - (upset[k].sum() / max(1, (k & (y != .5)).sum())))
        return m
    g = {
        'all': grp(np.ones(len(y), bool)),
        'close_40_60': grp(fav < .6), 'lean_60_80': grp((fav >= .6) & (fav < .8)), 'strong_80_95': grp((fav >= .8) & (fav < .95)), 'heavy_95plus': grp(fav >= .95),
        'qual': grp(~po), 'playoff': grp(po),
        'nmin_0': grp(nmin == 0), 'nmin_1_3': grp((nmin >= 1) & (nmin <= 3)), 'nmin_4_9': grp((nmin >= 4) & (nmin <= 9)), 'nmin_10plus': grp(nmin >= 10),
        'event_first_match_any': grp(evN == 0), 'event_has_history': grp(evN > 0),
        'gap_le_7d': grp(gap <= 7), 'gap_8_28d': grp((gap > 7) & (gap <= 28)), 'gap_gt_28d': grp(gap > 28),
        'unknown_robot': grp(unk > 0),
    }
    # Strong-favourite upsets: what happened?
    su = K & upset & (fav >= .8)
    g['strong_fav_upsets'] = {'n': int(su.sum()), 'rate_among_strong': float(su.sum() / max(1, (K & (fav >= .8) & (y != .5)).sum())),
                              'fav_collapsed_lt_half': float(favCollapse[su].mean()) if su.any() else None,
                              'underdog_surged_gt_1_5x': float(dogSurge[su].mean()) if su.any() else None,
                              'playoff_share': float(po[su].mean()) if su.any() else None,
                              'mean_nmin': float(nmin[su].mean()) if su.any() else None}
    # Base rates of collapse among all strong favourites (wins and losses) for comparison.
    sf = K & (fav >= .8)
    g['strong_fav_collapse_base_rate'] = float(favCollapse[sf].mean())
    # Score model: bias by predicted strength.
    mus = np.concatenate([muR[K], muB[K]]); acts = np.concatenate([actR[K], actB[K]])
    q = np.quantile(mus, [0, .2, .4, .6, .8, 1])
    g['score_bias_by_pred_quintile'] = [{'lo': float(q[i]), 'hi': float(q[i + 1]), 'bias_actual_minus_pred': float((acts - mus)[(mus >= q[i]) & (mus <= q[i + 1])].mean())} for i in range(5)]
    # Does the candidate signal carry information 2.0 misses? Correlate residual (y - p) with each candidate (non-ties).
    nt = K & (y != .5); res = (y - p)[nt]
    g['residual_corr'] = {k: float(np.corrcoef(v[nt], res)[0, 1]) for k, v in C.items() if v[nt].std() > 0}
    out[blk] = g
json.dump(out, open(sys.argv[2], 'w'), indent=1)
for blk in ('select', 'test2025'):
    g = out[blk]
    print('=====', blk, {k: round(v, 4) for k, v in g['all'].items() if isinstance(v, float)})
    for k in ('close_40_60', 'lean_60_80', 'strong_80_95', 'heavy_95plus', 'qual', 'playoff', 'nmin_0', 'nmin_1_3', 'nmin_4_9', 'nmin_10plus', 'event_first_match_any', 'event_has_history', 'gap_le_7d', 'gap_8_28d', 'gap_gt_28d', 'unknown_robot'):
        v = g[k]
        if v: print(f"{k:24s} n={v['n']:6d} matches%={100*v['share_of_matches']:5.1f} brier%={100*v['share_of_brier']:5.1f} acc={100*v['accuracy']:5.2f} brier={v['brier']:.4f} meanFavP={v['mean_p_fav']:.3f} favWin={v['fav_win_rate']:.3f}")
    print('strong fav upsets', g['strong_fav_upsets'], 'collapse base rate', round(g['strong_fav_collapse_base_rate'], 4))
    print('score bias by predicted quintile', [(round(b['lo']), round(b['hi']), round(b['bias_actual_minus_pred'], 2)) for b in g['score_bias_by_pred_quintile']])
    print('residual corr', {k: round(v, 4) for k, v in g['residual_corr'].items()})
