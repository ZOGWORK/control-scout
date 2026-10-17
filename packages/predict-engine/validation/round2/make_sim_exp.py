"""Build the experimental simulator used by the round-2 event experiments: a copy of
the built engine (dist/) whose sim.js accepts two extra SimInput hooks.
  matchShift(red, blue, level) -> points added to red's mean and taken from blue's
                                 (probability-matched scores; winners stay coherent)
  bonusJoint: number[8][2]     -> an 8-pattern softmax on NP/100 for bonus RPs
usage: python -I make_sim_exp.py <built dist dir> <output dir>
Then: python -I make_bt_exp.py <control-point>/scripts/predict/backtest-events.mts <control-point>/scripts/predict/_bt-exp.mts <output dir>
and run _bt-exp.mts with --shift and/or --bonus-online (delete it afterwards)."""
import sys, shutil, os
src, dst = sys.argv[1:3]
if os.path.exists(dst): shutil.rmtree(dst)
shutil.copytree(src, dst)
open(os.path.join(dst, 'package.json'), 'w').write('{"type":"module"}')
p = os.path.join(dst, 'sim.js'); s = open(p, encoding='utf-8').read()
def rep(o, n):
    global s
    assert o in s, o[:60]
    s = s.replace(o, n, 1)
rep("const playScore = (own, opp) => {\n            let mean = 0, pen = 0, auto = 0, eg = 0;", "const playScore = (own, opp, shift = 0) => {\n            let mean = shift, pen = 0, auto = 0, eg = 0;")
rep("const red = playScore(m.red, m.blue), blue = playScore(m.blue, m.red);", "const sh = input.matchShift ? input.matchShift(m.red, m.blue, 'qual') : 0;\n                    const red = playScore(m.red, m.blue, sh), blue = playScore(m.blue, m.red, -sh);")
rep("const sa = playScore(strengthOf(a), strengthOf(b)), sb = playScore(strengthOf(b), strengthOf(a));", "const sh = input.matchShift ? input.matchShift(strengthOf(a), strengthOf(b), 'playoff') : 0;\n            const sa = playScore(strengthOf(a), strengthOf(b), sh), sb = playScore(strengthOf(b), strengthOf(a), -sh);")
rep("const sampleBonus = (np) => {", "const sampleBonus = (np) => {\n        if (input.season >= 2025 && input.bonusJoint) {\n            const W = input.bonusJoint, x = np / 100; let mx = -Infinity; const sc = W.map((w) => w[0] + w[1] * x); for (const v of sc) mx = Math.max(mx, v);\n            const e = sc.map((v) => Math.exp(v - mx)); const tot = e.reduce((a, b) => a + b, 0); let u = r() * tot, k = 0; while (k < 7 && (u -= e[k]) > 0) k++;\n            return ((k >> 2) & 1) + ((k >> 1) & 1) + (k & 1);\n        }")
open(p, 'w', encoding='utf-8').write(s)
print('experimental simulator in', dst)
