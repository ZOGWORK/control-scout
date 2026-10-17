// Predict — the fitted model (rating settings, score noise, pick, bonus-RP,
// award and calibration parameters) plus its back-test accuracy.
//
// Generated from model.json (fitted by Control Point's scripts/predict
// research pipeline: tuned on 2024–25, tested on 2025–26). Kept as a module so
// it bundles into the browser with no JSON loader. Edit model.json and run
// scripts/gen-model.mjs; a test checks the two never drift.
import type { PredictModel } from "./forecast.js";

// Same as Control Point's runtime JSON.parse cast: `rating` holds only the
// tuned fields; RatingBook fills the rest from DEFAULT_RATING_PARAMS.
export const FITTED_MODEL = {
 "version": 3,
 "fittedOn": "2024–25 (settings), tested on 2025–26",
 "rating": {
  "k0": 0.65,
  "n0": 10,
  "kMin": 0.33,
  "playoffWeight": 0.5,
  "rho1": 0.6,
  "rho2": 0.2,
  "rookieZ": -0.7,
  "uncKnown": 150,
  "uncRookie": 350,
  "uncDecay": 0.45,
  "uncMin": 10,
  "baseAlpha": 0.002,
  "growthPerWeek": 0.05,
  "growthMaxWeeks": 8
 },
 "noise": {
  "a": 14,
  "b": 0.2,
  "preExtra": 500
 },
 "pick": {
  "tau": 18,
  "rankWeight": 3
 },
 "bonus": {
  "2025": {
   "movement": [
    -1.7057392636101876,
    0.028573128470855545
   ],
   "goal": [
    -25.697264648149673,
    0.18652263117782306
   ],
   "pattern": [
    -3.3047492740472624,
    0.0286526553477257
   ]
  }
 },
 "awards": {
  "decay": 0.4,
  "inspire": [
   1.7387322912685947,
   0.8965486109909682,
   -0.1639496322812036,
   -0.16526530208720122,
   0.4248386060930159
  ],
  "judged": [
   -0.2623452167857783,
   0.7249404516054273,
   1.6052994322595928,
   0.7779838995930317,
   0.2796122104084902
  ]
 },
 "accuracy": {
  "testSeason": "2025–26",
  "matches": {
   "count": 37395,
   "liveAccuracy": 0.7274,
   "liveBrier": 0.1789,
   "preEventAccuracy": 0.6878,
   "oprAccuracy": 0.6565,
   "oprBrier": 0.208,
   "scoreRange80Coverage": 0.82
  },
  "advancement": {
   "events": 508,
   "pre": {
    "brier": 0.1286,
    "calibrationError": 0.016
   },
   "quals": {
    "brier": 0.0855,
    "calibrationError": 0.0122
   },
   "selected": {
    "brier": 0.0639,
    "calibrationError": 0.0104
   },
   "matchesOnlyPre": {
    "brier": 0.1333,
    "calibrationError": 0.0171
   },
   "naiveTopRanked": {
    "brier": 0.1515
   },
   "calibrationPre": [
    {
     "predicted": 0.053,
     "actual": 0.044,
     "n": 3358
    },
    {
     "predicted": 0.145,
     "actual": 0.135,
     "n": 2522
    },
    {
     "predicted": 0.246,
     "actual": 0.23,
     "n": 1561
    },
    {
     "predicted": 0.345,
     "actual": 0.35,
     "n": 999
    },
    {
     "predicted": 0.449,
     "actual": 0.496,
     "n": 693
    },
    {
     "predicted": 0.548,
     "actual": 0.572,
     "n": 512
    },
    {
     "predicted": 0.645,
     "actual": 0.733,
     "n": 371
    },
    {
     "predicted": 0.751,
     "actual": 0.782,
     "n": 284
    },
    {
     "predicted": 0.849,
     "actual": 0.844,
     "n": 243
    },
    {
     "predicted": 0.968,
     "actual": 0.964,
     "n": 357
    }
   ]
  },
  "partners": {
   "allianceWin": {
    "n": 2550,
    "brier": 0.0719,
    "logLoss": 0.2365,
    "ece": 0.0255,
    "baseRate": 0.1839
   },
   "allianceWinGeneral": {
    "n": 2550,
    "brier": 0.0855,
    "logLoss": 0.2793,
    "ece": 0.0576,
    "baseRate": 0.1839
   }
  },
  "pickTop3": 0.696911196911197,
  "engine2": {
   "note": "Prediction Engine 2.0 vs 1.1.0 on identical matches: chronological replay of the whole 2025-26 season from finalized results (every match predicted from earlier results only; predictions inside a timestamp group made before any of its results). Held out from fitting, selection and calibration; not a prospective live result.",
   "testSeason": "2025–26",
   "matches": 37414,
   "nonTies": 37140,
   "events": 1219,
   "accuracy": 0.7465266558966074,
   "baselineAccuracy": 0.7267635971997846,
   "accuracyGain95": [
    0.016240263496237535,
    0.02320379242903288
   ],
   "brier": 0.1684208840478484,
   "baselineBrier": 0.17894028134421489,
   "brierChange95": [
    -0.011542020453554068,
    -0.009546734743146252
   ],
   "logLoss": 0.5101965279762287,
   "baselineLogLoss": 0.537493869431886,
   "ece": 0.012626480793802138,
   "baselineEce": 0.010231376042926356,
   "scoreMae": 27.86355509152421,
   "baselineScoreMae": 27.873933259113603,
   "scoreRange80Coverage": 0.8204682739081627,
   "baselineScoreRange80Coverage": 0.8202277222430107
  },
  "engine21": {
   "note": "Prediction Engine 2.1 vs 2.0 on identical matches. select = season 2024, Jan-Feb 2025 (the decision block, never used for fitting); test2025 = the 2025-26 season, secondary and diagnostic only (already examined in 2.0 validation). Chronological replay from finalized results; not a prospective live result.",
   "select": {
    "matches": 15870,
    "accuracy": 0.7734449305687655,
    "baselineAccuracy": 0.7712256673641494,
    "accuracyGain95": [
     0.00012857974659451416,
     0.004209606506047943
    ],
    "brier": 0.15313298876233183,
    "baselineBrier": 0.15357844962530778,
    "ece": 0.011600723390184073,
    "baselineEce": 0.010121924796423133
   },
   "test2025": {
    "matches": 37414,
    "accuracy": 0.7484652665589661,
    "baselineAccuracy": 0.7465266558966074,
    "accuracyGain95": [
     0.00046830629347256964,
     0.0033231597049812817
    ],
    "brier": 0.16803757861035704,
    "baselineBrier": 0.1684208840478484,
    "logLoss": 0.5092763546683517,
    "baselineLogLoss": 0.5101965279762287,
    "ece": 0.01669480810856577,
    "baselineEce": 0.012626480793802138
   }
  }
 },
 "calibration": {
  "a": 0.936632910767947,
  "b": 0.019772447704615496
 },
 "contextual": {
  "kind": "contextual-logistic-reliability",
  "id": "ctx-rel-form-2026-10-17-1fdd2958",
  "coefficients": [
   -0.02979355924122389,
   -0.10724713448833693,
   -0.29034068996868156,
   0.16985250466227006,
   0.11427833410558544,
   -0.015530904107533492,
   -0.030636059797961725,
   0.06768351292041846,
   -0.0875338401599225,
   -0.041468255349220946,
   -0.048905443815756754,
   0.00708928076183189,
   -0.07861268185492395,
   0.027477977441074285,
   0.031539437065105015,
   -0.09210487902173818,
   -0.14834987793658208,
   0.17136751769354003,
   0.2583717503845097,
   0.004075978565896892,
   -0.009122437857913274,
   0.029244049742679988
  ],
  "scale": [
   0.3533651995760248,
   0.31371395400982427,
   0.1739744453902609,
   0.20381896963076404,
   0.7712669125046528,
   0.12953288779826855,
   0.2206443887447818,
   0.5193927137976148,
   0.8722379449857252,
   0.42042536809241937,
   0.20560471238136863,
   0.8207177029454361,
   0.2754757056066459,
   0.3269772490676501,
   0.05,
   0.3851254365644167,
   0.2178215178826598,
   0.29846367870186313,
   2.1998921279625967,
   0.29032690503922237,
   0.21805493983127958,
   0.6269215837103216
  ],
  "calibration": {
   "slope": 0.9121022734834242,
   "intercept": 0.004330102620411243
  },
  "provenance": {
   "fitBlock": "season 2023 + season 2024 before 2025-01-01 (42,226 matches)",
   "calibrationBlock": "season 2024, 2025-03-01..2025-05-31",
   "selectBlock": "season 2024, 2025-01-01..2025-02-28",
   "protocolSha256": "4f9ce7f84b40d10edd9636476e3599e547ccf1a8d31f0ef9523e5e47165ac5cd",
   "ratings": "engine 2.0 symmetric population",
   "inputs": "D1..D17 (2.0) + in-event form, L*log1p(min event matches), momentum, last-match collapse, recovery",
   "fittedAt": "2026-10-17"
  },
  "fallback": {
   "kind": "contextual-logistic-reliability",
   "id": "ctx-rel-2026-10-16-1a36820c",
   "coefficients": [
    0.005801933001845236,
    -0.08734261949534072,
    -0.2752969871497752,
    0.17246351491080336,
    0.11297044872108032,
    -0.01330313757721049,
    -0.02127053149025523,
    0.12811691450081228,
    0.029428048029559607,
    -0.14639294646372977,
    -0.08698623405706282,
    0.032605348306557196,
    0.07322025788054136,
    0.032803481814515464,
    -0.004147131685170887,
    -0.11638253003834045,
    -0.07750155048087558
   ],
   "scale": [
    0.35333704832605023,
    0.31372614065484583,
    0.17391673864238053,
    0.2032090968797187,
    0.7712669125046528,
    0.12953288779826855,
    0.2206443887447818,
    0.5193982183787053,
    0.8719412785775297,
    0.4204285612101274,
    0.2052876923360014,
    0.8188773892408825,
    0.2753660004257903,
    0.3258990415752877,
    0.05,
    0.38546414225065545,
    0.2182609369162325
   ],
   "calibration": {
    "slope": 0.9414911747184092,
    "intercept": 0.004591262950340726
   },
   "provenance": {
    "fitSeasons": [
     2023,
     2024
    ],
    "frozenSelectionSha256": "1a36820cc616dbc2f36c0cdb19f041b2cbb913f46d765663b08bdc7c70386e14",
    "frozenAt": "2026-10-16T18:19:37.995889+00:00",
    "baseEngineVersion": "1.1.0"
   }
  }
 }
} as unknown as PredictModel;
