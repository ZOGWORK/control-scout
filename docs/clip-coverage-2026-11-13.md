# Clip coverage audit

Run 2026-11-14T01:13:55.020Z on a copy of the live database (VACUUM INTO), with `scripts/clip-coverage.ts`. The full per-match list with teams is the CSV it writes (6 MB, not committed).

| | Count |
|---|---:|
| Events checked (a linked recording or FIRST match videos) | 1037 |
| Recording videos checked | 1225 |
| Played matches checked | 35897 |
| With a clip | 24525 |
| Without a clip | 11372 |

## Events by coverage

| State | Events |
|---|---:|
| full | 578 |
| unplaced | 249 |
| partial | 167 |
| pending | 43 |

## Why matches have no clip

| Reason | Matches |
|---|---:|
| Video shorter than its broadcast, missing time can't be placed | 6468 |
| An early start would open on the match before | 1898 |
| Video unavailable or private | 771 |
| No recording for that day | 588 |
| Video has no broadcast clock | 497 |
| Past the part of the video its chapters confirm | 424 |
| Played before the broadcast started | 375 |
| Played after the broadcast ended | 185 |
| No real start time from FIRST | 163 |
| After the video ends | 2 |
| FIRST posted no video for this match | 1 |

## What clips stand on

| Basis | Clips |
|---|---:|
| clock, video length matches its broadcast | 21443 |
| clock, tail of the stream cut after the event | 1049 |
| clock only, started up to 15 min early (gap can't be placed) | 885 |
| clock + YouTube chapters | 617 |
| FIRST's match video | 476 |
| clock + frames checked by eye | 55 |

## Clips on one signal only (885)

Started early by the whole gap because the missing time can't be placed: nothing but the clock places them. Withheld once Step 3's second-signal check lands.

- 2026 USAZFLQ · ITK-Rc5LvT4 (High Country - Flagstaff Qualifier): Q1–Q2, Q4, Q7, Q10–Q12, Q14, Q16–Q18, M1, M3, M5–M6
- 2026 USMIROQ · FGiUuys_-BE (Royal Oak Qualifier): Q1, Q13, M1–M3, M9–M10
- 2026 USMISOQ · s47802Jj5uk (Southgate Qualifier): Q1–Q4, Q6–Q7, Q9–Q10, Q15–Q19, Q24, Q26–Q30, Q32, M1–M3, M7–M11
- 2026 USPAKSN · qfOtpwmt9OY (Longhorn Roundup Scrimmage): Q1, Q5, Q7, Q9, Q21
- 2025 AUSYQ2 · 55kdH9j4oKk (Sydney North Qualifier): Q2, Q5, Q12
- 2025 CABCVIQ1 · 2LaRYh3rdo4 (Esquimalt Qualifier): Q1–Q11, Q13, Q16, M1, M3–M6, M6-2, M7
- 2025 DESTQ · Cg6mn3kNrtE (Germany Championship): Q1, M1, M5, M9–M10
- 2025 FPERR · 8OelOORV5oc (Run for the Robots Premier Event): F1–F3
- 2025 FPEWE · mfEK4qhAC8c (Western Edge Premier Event): F1–F2
- 2025 KZCMP · wbAPxGO-cYY (Kazakhstan Central Asia Championship): F1–F2
- 2025 ROCMPCND · pvmxbH8YW-k (Romania Championship - COANDA Division): Q1, Q3, Q6–Q7, Q17
- 2025 ROCMPVLC · upv_j3SsqIc (Romania Championship - VLAICU Division): M1, M9–M14
- 2025 TRTUQ2 · ISUifIkmsuw (2. Piri Reis Turnuvası): Q1, Q3–Q11, Q13, Q18–Q19, Q21–Q22, M1–M6
- 2025 TRTUQ4 · fO-jhJzz4O8 (4. Piri Reis Turnuvası): Q1, M1, M9–M10
- 2025 USAZPHQ3 · Xbd9LafZOJQ (Painted Desert - Phoenix Qualifier): Q1, Q4, Q8, Q11–Q12, Q14–Q19, Q21, M1, M3–M6
- 2025 USCALACALAM2 · Ec8eZNzaGJY (SoCal FTC Group H - Scrimmage 2): Q1–Q2, Q5, Q8–Q9, Q11–Q12, Q14–Q16, Q18, Q21–Q22
- 2025 USCHSCMPBLCR · Z2ArRHRiwh0 (Chesapeake Championship - Blue Crab Division): Q1, Q15, Q22, Q25–Q26, Q28–Q29, Q37–Q38, Q44
- 2025 USCHSCMPRDCA · DxFBMhu8nn4 (Chesapeake Championship - Red Cardinal Division): Q1, Q12, Q27, Q29, Q35, Q38, Q43, Q48
- 2025 USFCTKAQ · inTg2y3YymA (Monument Valley - Kayenta Qualifier): Q1, Q13, M1, M6
- 2025 USIAACPSM1 · hMO7b_FGIgg (Acropolis #1): Q1–Q3, Q5–Q8, Q11–Q15, Q17–Q21, Q24–Q25, Q27, Q29–Q31, Q33–Q34
- 2025 USIAESTRM2 · 8C221vcaRik (Easter Island OrangeCity): Q1, Q14
- 2025 USIAESTRM3 · AOD-3A_Vw1k (EasterIsland SiouxCity): Q1–Q13, Q15–Q26
- 2025 USIAMPM1 · jUmXfbtaokA (MachuPicchu Solon): Q1–Q18
- 2025 USIAMPM5 · NBGA4UiNndk (MachuPicchu Williamburg): Q3–Q9, Q15, Q18–Q20
- 2025 USIAPOMPM11 · ufVIXyeHAjk (Pompeii Regis): Q1, Q3
- 2025 USIAWESTLT · 8kHuOPUmM2E (Easter Island & Chichen Itza): Q1, Q12, Q16, Q15, M1, M3, M9–M11
- 2025 USILCCLT1 · PjwXTjGAkpo (Chicago League Tournament A): Q1–Q2, Q4, Q7, Q9, Q11, Q13–Q14, Q17, Q19–Q21, Q25, M1, M3–M10
- 2025 USMABRQ1 · Oe-pETJ5zjI (Brookline Robo Rally 1): Q1–Q2, Q4, Q7–Q9, Q13–Q19, Q21–Q22, Q25, Q29, M1–M10
- 2025 USMISCLT · LozxQh22O7A (South Central League Tournament): Q1, Q5, Q16, Q19, M1, M9–M10
- 2025 USMNCMPGLXY · kzo5SBlOhVs (Minnesota FTC State Championship - Galaxy Division): Q1, Q34, M1, M10
- 2025 USNCCMP · cFia2BHJXZ4 (North Carolina Championship): Q10, M1, M9–M10
- 2025 USNMCMP · awgTySwJx-Y (New Mexico Championship): Q1, Q8, Q10, M1, M5
- 2025 USNYEXCMP · pCbOYH7Htf4 (MVCC New York - Excelsior Championship): Q1, Q3–Q4, Q8
- 2025 USNYEXCOQ · 2gUfXLDd9vA (Corning Qualifier): Q1, Q4, Q14, Q17, Q21, Q32, M1, M3, M5, M8–M11
- 2025 USORCMPPUR1 · -_vByPV-npI (Oregon Championship - Purple Division): Q1–Q2, Q4, Q6–Q8, Q11
- 2025 USORPHQ · LNoHfnyab6s (Spark Invitational): Q1, Q9, Q13, Q15, Q18, Q22, Q24, Q26, Q29, Q33, M1, M5, M7, M9–M10
- 2025 USTNCMP · UxEbw2_MSck (Tennessee Championship): Q2, Q9, M1, M9–M10
- 2025 USTXDAQ2 · eKFwME2gVAc (FiT-North Winter Charger Qualifier): Q1, Q6, Q13
- 2025 USTXDAQ2 · JxIKaTysWYc (FiT-North Winter Charger Qualifier): Q3–Q5
- 2025 USTXNDM2 · eKFwME2gVAc (FiT-North D-League Meet 2): Q1, Q6, Q12
- 2025 USTXNTM2 · JxIKaTysWYc (FiT-North T-League Meet 2): Q1–Q10, Q12–Q24
- 2025 USTXSASQ · DgrBhJC2TIk (FiT-Central San Antonio Semi-Regional): Q1, Q9
- 2025 USTXWAS2 · 3NF2rp0qZZ0 (FIRST in Texas UIL State Championship Division 6A): Q1, Q9, M1, M9–M10
- 2025 USWICMP · 0bOFvjFD1DM (Wisconsin Championship): Q1, Q25, M1, M9–M10
- 2024 FPEEUESCH · qoRpJm2UPvU (European Premier Event - Escher Division): Q1, Q4, Q41–Q42, Q56
- 2024 LTCMP · CsNRxpRpGMw (Lithuania Championship): Q1
- 2024 ROSLT · Opr0k4kNnzs (South Romania League Tournament): Q16–Q18, Q20, Q32–Q33, Q36, Q46, Q49, Q52, Q56, Q58–Q59, Q68, Q70, Q72
- 2024 TRISQ1 · Iah9yGJMsZA (Uluslararasi FIRST Tech Challenge 1. Uskudar Turnuvasi): Q1, Q7–Q8, Q20, Q37
- 2024 USALCMP · ZHTmO6gyqdE (Alabama Championship): Q1–Q2, Q7, Q13, Q20, Q22, Q27–Q30, Q34, M1, M9–M10
- 2024 USALHUQ1 · k5bzKFMBGto (HCMS Qualifier): Q1–Q6, Q8–Q14, Q16–Q19, Q21–Q27, M1–M3, M5–M6
- 2024 USCALADM1 · 59byMzgTa-s (SoCal FTC League D - Meet 1): Q1–Q3, Q5, Q8–Q9, Q11–Q12, Q20
- 2024 USCHSCHQ · mMdn3A0kjxY (Charlottesville VA Qualifier): Q1, Q19, M1, M9–M11
- 2024 USCHSGAQ1 · p3TvzUn-B0U (Glen Allen VA #1 Qualifier): Q1, Q21, M1, M9–M10
- 2024 USIAADRM1 · BfLhRcM2-j8 (Adriatic_2024-11-23): Q1–Q7, Q9–Q10, Q12–Q15, Q17
- 2024 USIACASM5 · y-y14blHETg (Caspian_2024-11-01): Q1
- 2024 USIACORM4 · LhY2xCME8yQ (Coral_2024-11-09): Q1–Q2, Q4, Q6, Q11, Q14, Q19, Q22, Q27–Q28
- 2024 USIACORM5 · h6F9khoZXUA (Coral_2024-11-23): Q4–Q9, Q11–Q14, Q16, Q19, Q23–Q24, Q26
- 2024 USIATASM6 · FWvSIbzgX2o (Tasman_2025-01-04): Q1, Q13, Q16
- 2024 USILCSNWLT · Fb6gOS1chO4 (Suburban Northwest League Tournament): Q1, Q10, M1, M9–M10
- 2024 USMOKSSLSQ · 6XmwpbY--0Y (Missouri Kansas East Super Qualifier): Q1, Q8, M1, M3, M9–M10
- 2024 USMSMEQ · NXDKSE8IqlU (Meridian Qualifier): Q1, Q11, Q16, Q19, Q22, M1–M3, M5–M6
- 2024 USMSTUQ · XUELHF0b_54 (Tupelo Qualifier): Q1–Q7, Q9–Q23, M1–M7
- 2024 USNYEXCOQ · GToFNJ0Egac (Corning Qualifier): Q1, Q3, Q6–Q9, Q17, M1, M3–M4, M4-2, M5–M7
- 2024 USOHNEOHLT · F2OE_HsHA1Q (NEOH Aurora League Tournament): Q1, Q9, Q11, M1, M3, M5–M6
- 2024 USOHNEOHM3 · Q8cSB2k5g6M (NEOH Meet 3): Q1–Q12
- 2024 USORSOM1 · iW3dh6qGaSE (SOAR League Meet 1): Q1–Q4, Q6, Q9–Q12, Q14–Q16, Q19–Q20, Q23
- 2024 USORSOM2 · neHlobPVL6U (SOAR League Meet 2): Q1–Q2, Q5, Q7, Q9, Q11, Q14, Q16, Q18–Q19, Q22
- 2024 USPACMP · Z5MjxPQa8gg (Pennsylvania Championship): Q1, Q3, Q5–Q6
- 2024 USTXCALT1 · qBEw661kTGw (FiT-Central North San Antonio & Hill Country League Tournament): Q1
- 2024 USTXNSM2 · zZ36AlutIyg (FiT-North S-League Meet 2): Q1–Q9, Q12–Q15, Q17–Q24
- 2024 USTXTBSQJB · hxWqkLAuVAY (FiT-Central Regional Championship - Jocelyn Burnell Division): Q1, Q6, Q8, Q11, Q14, Q16, Q22, Q30, M1
- 2023 CABCCMP · qKPNWgTD16E (British Columbia FTC Championships): Q1, Q11, Q23, M1, F1–F2
- 2023 ROCMP · E4mACwlmdeM (Romania Campionatul National FTC 070000): Q21, Q24, Q26, Q28, Q32–Q33, Q41, Q51, Q55, Q61, Q64, Q68–Q69
- 2023 RONR1LT · bH0EUgKtuJM (RO #1BUCURESTI 070000): Q1, Q7–Q8, Q10, Q12, Q14, Q17–Q18, Q23–Q24, Q27, Q30, Q33–Q34, Q40, Q43, Q46, Q52, Q54, Q56, Q60–Q61
- 2023 RONR4LT · jDzVQgJdEpc (RO #4 IASI 070000): Q1–Q2, Q4, Q6–Q8, Q10, Q12–Q16, Q18–Q19, Q21, Q24, Q29, Q35, Q37–Q38, Q44, Q46, Q48, Q50, Q52–Q56, Q59
- 2023 USIACMPBLAC · 5aKb-Qz8b7Y (Iowa Championship - Black Division): Q10, Q25, Q36, Q43–Q44, Q54, M1, F1–F2
- 2023 USIAESM2 · 5TUvwmkfFNs (IA Savage_2023-11-11): Q1, Q9
- 2023 USIAJPM4 · FHBsDuKApcU (IA Pollock_2023-12-02): Q1, Q16
- 2023 USILCMP · PCVpMiLnefY (Illinois State Championship): F1–F2
- 2023 USMSWEQ · 0Jz0DDaRoYQ (MS Wesson Qualifier): Q1–Q4, Q6–Q8, Q11, Q16–Q17, Q19, M1, F1–F2
- 2023 USNYEXCMP · 6FYgFdWOp-I (New York-Excelsior MVCC Utica Championship): Q1–Q3, Q6, Q8–Q9, Q15–Q16, Q19–Q21, Q23–Q26
- 2023 USWIHAQ · _hIEhqBKKnI (WI Knack Attack): Q1, Q3, Q9, M1, F1–F3
- 2022 ROBUQ1 · JXi2ZKTiZ4c (RO BUCHAREST #1 - FTC Romania Qualifying Tournament): Q96, Q111, M1, M1-2, M2-3, F1–F3
- 2022 ROBUQ2 · ksvPRJRbu3s (RO BUCHAREST #2 - FTC ROMANIA QUALIFYING TOURNAMENT): Q25, Q31, Q47, Q57, Q60, Q67, Q70, Q73, Q76, Q79–Q80, Q88, Q101
- 2022 ROBUQ2 · DCr1GSWOzEI (RO BUCHAREST #2 - FTC ROMANIA QUALIFYING TOURNAMENT): Q104, M1, F1–F2
- 2022 USIASOM2 · ym7HUlwd76k (IA Solar_Meet_2022-12-17): Q1–Q2, Q9, Q14–Q15
- 2022 USIAWIM7 · 4DIpuVlm0hY (IA Wind_Meet_2022-11-19): Q1–Q11, Q14–Q18, Q20–Q24
- 2021 USNYNYBRQ1 · l7HXo2KWJ_4 (NY-NYC Qualifier 1): Q1, Q3, Q5, Q11, M1, F1–F2

## Every event with a match missing a clip

Per event, per video (day · part), per reason: the matches. Every match's teams are in clip-coverage.csv.

### 2026 USAZFLQ — High Country - Flagstaff Qualifier: 15 of 26 (partial)
- Saturday `ITK-Rc5LvT4`: 15 of 26 held
  - Q3, Q5–Q6, Q8–Q9, Q13, Q15, Q19–Q20, M2, M4 · ITK-Rc5LvT4: An early start would open on the match before (starts up to 5 min early)
### 2026 USAZGLQ1 — Quail - Glendale Qualifier #1: 0 of 42 (unplaced)
- Day `tLK-tRpZSTA`: 0 of 42 held — Video unavailable or private
  - Q1–Q32, M1–M10 · tLK-tRpZSTA: Video unavailable or private
### 2026 USCALAESS2 — SoCal - H - Scrimmage 1: 0 of 17 (unplaced)
- Saturday `a_lZVsHGLx8`: 0 of 0 held
- Saturday 2026-11-07: no recording (17 played)
  - Q1–Q17 · no video: No recording for Saturday
### 2026 USIALAVM1 — Lavender Hazel Point: 0 of 18 (unplaced)
- Thursday `fvUrGXQ3MNw`: 0 of 18 held — Video 25 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q18 · fvUrGXQ3MNw: Video 25 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2026 USIALAVM9 — Lavender Xavier Middle: 0 of 14 (unplaced)
- Saturday `lUN72WQucFM`: 0 of 14 held — Video 20 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q14 · lUN72WQucFM: Video 20 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2026 USIANON — Daisy Norwalk: 0 of 25 (unplaced)
- Saturday `TornxXkc3vY`: 0 of 25 held — Video 15 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q25 · TornxXkc3vY: Video 15 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2026 USMIHOQ — Hartland Qualifier: 0 of 48 (unplaced)
- Saturday `A5n0Xamahk8`: 0 of 48 held — Video 27 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q38, M1–M10 · A5n0Xamahk8: Video 27 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2026 USMIROQ — Royal Oak Qualifier: 7 of 45 (partial)
- Saturday `FGiUuys_-BE`: 7 of 45 held
  - Q2–Q12, Q14–Q35, M4–M8 · FGiUuys_-BE: An early start would open on the match before (starts up to 14 min early)
### 2026 USMISOQ — Southgate Qualifier: 28 of 48 (partial)
- Saturday `s47802Jj5uk`: 28 of 48 held
  - Q5, Q8, Q11–Q14, Q20–Q23, Q25, Q31, Q33–Q37, M4–M6 · s47802Jj5uk: An early start would open on the match before (starts up to 4 min early)
### 2026 USMIWMM3 — West Michigan Meet 3: 0 of 8 (unplaced)
- Saturday `8sBg4gdx62g`: 0 of 8 held — Video 34 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q8 · 8sBg4gdx62g: Video 34 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2026 USMIWMM4 — West Michigan Meet 4: 14 of 15 (partial)
- Friday `RG6gzxaC1OU`: 14 of 15 held
  - Q1 · RG6gzxaC1OU: Played before the broadcast started
### 2026 USOHCOHM1 — Central Ohio League Meet 1: 0 of 20 (unplaced)
- Day `07z482i0RiM`: 0 of 20 held — Video has no broadcast clock (an upload, not a live stream)
  - Q1–Q20 · 07z482i0RiM: Video has no broadcast clock (an upload, not a live stream)
### 2026 USOHCON — Central Ohio League Scrimmage: 0 of 20 (unplaced)
- Day `WpFqMhd65EM`: 0 of 20 held — Video has no broadcast clock (an upload, not a live stream)
  - Q1–Q20 · WpFqMhd65EM: Video has no broadcast clock (an upload, not a live stream)
### 2026 USOHSON — NEOH League Scrimmage: 0 of 15 (unplaced)
- Day `lG9PpwTA-P8`: 0 of 15 held — Video has no broadcast clock (an upload, not a live stream)
  - Q1–Q15 · lG9PpwTA-P8: Video has no broadcast clock (an upload, not a live stream)
### 2026 USORWIN — Iron Mountain Scrimmage: 0 of 13 (unplaced)
- Saturday `0UQdsgZR9_k`: 0 of 13 held — Video 2 h 46 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q13 · 0UQdsgZR9_k: Video 2 h 46 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2026 USPAKSN — Longhorn Roundup Scrimmage: 5 of 26 (partial)
- Saturday `qfOtpwmt9OY`: 5 of 26 held
  - Q2–Q4, Q6, Q8, Q10–Q20, Q22–Q26 · qfOtpwmt9OY: An early start would open on the match before (starts up to 9 min early)
### 2026 USWALAM1 — Lamarr League Meet 1: 0 of 23 (unplaced)
- Saturday `sTIfwAaLPzk`: 0 of 23 held — Video 24 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q23 · sTIfwAaLPzk: Video 24 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2026 USWARIM2 — Ritchie League Meet 2: 0 of 21 (unplaced)
- Sunday `3BVN2x1HPK0`: 0 of 21 held — Video 1 h 41 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q21 · 3BVN2x1HPK0: Video 1 h 41 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 AUSYOS — APOC: 50 of 71 (partial)
- Friday `7bTejVfIN2M`: 10 of 10 held
- Saturday · Part 1 `fBZOzjZr-60`: 0 of 21 held — Video 4 h 17 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
- Saturday · Part 2 `YhyTMxV91sc`: 5 of 5 held
- Sunday `kR0hDZqlHM8`: 35 of 35 held
  - Q11–Q31 · fBZOzjZr-60: Video 4 h 17 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2025 AUSYQ1 — Sydney South Qualifier: 0 of 30 (unplaced)
- Sunday `1NcywjWLfu8`: 0 of 30 held — Video 6 h 6 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q24, M1–M6 · 1NcywjWLfu8: Video 6 h 6 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 AUSYQ2 — Sydney North Qualifier: 42 of 53 (partial)
- Saturday `55kdH9j4oKk`: 3 of 14 held
- Sunday `TA1tHFlvTVQ`: 39 of 39 held
  - Q1 · 55kdH9j4oKk: Played before the broadcast started
  - Q3–Q4, Q6–Q11, Q13–Q14 · 55kdH9j4oKk: An early start would open on the match before (starts up to 8 min early)
### 2025 BRGOQ — Torneio SESI de Robótica - Regional Goiás: 0 of 15 (unplaced)
- Day `-u34Y-4mEoQ`: 0 of 15 held — Video unavailable or private
  - Q1–Q12, F1–F3 · -u34Y-4mEoQ: Video unavailable or private
### 2025 BRPIQ — Festival Regional Sesi de Educação: 33 of 50 (partial)
- Thursday `FVGgr7s8cC8`: 33 of 33 held
- Wednesday 2025-11-05: no recording (17 played)
  - Q1–Q17 · no video: No recording for Wednesday
### 2025 CABCVIQ1 — Esquimalt Qualifier: 20 of 27 (partial)
- Saturday `2LaRYh3rdo4`: 20 of 27 held
  - Q12, Q14–Q15, Q17–Q19, M2 · 2LaRYh3rdo4: An early start would open on the match before (starts up to 5 min early)
### 2025 CABCVIQ2 — St. Margaret's Qualifier: 25 of 29 (partial)
- Saturday `_eblj5-6VnA`: 25 of 29 held
  - Q1–Q4 · _eblj5-6VnA: Played before the broadcast started
### 2025 CAONBUQ — Burlington Qualifier: 0 of 39 (unplaced)
- Saturday `Y0kALAfm3EM`: 0 of 39 held — Video 2 h 52 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q29, M1–M10 · Y0kALAfm3EM: Video 2 h 52 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 CAONKAQ — Ottawa Qualifier: 0 of 40 (unplaced)
- Saturday `1hPowweJI_g`: 0 of 40 held — Video 6 h 32 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q29, M1–M4, M6, M5, M7–M11 · 1hPowweJI_g: Video 6 h 32 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 CAONKIQ — Kingston Qualifier: 0 of 32 (unplaced)
- Saturday `8BYKMDcW9gw`: 0 of 32 held — Video 27 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q26, M1–M6 · 8BYKMDcW9gw: Video 27 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 CAONMIQ — Mississauga Qualifier: 7 of 44 (partial)
- Saturday `FHaZsGfUE68`: 7 of 44 held
  - Q8–Q33, M1–M11 · FHaZsGfUE68: Past the part of the video its chapters confirm (to 1 h 25 min into the broadcast)
### 2025 CAONNYQ — North York Qualifier: 0 of 28 (unplaced)
- Saturday `MSGDqgEYdDc`: 0 of 28 held — Video 1 h 30 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q22, M1–M6 · MSGDqgEYdDc: Video 1 h 30 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 CAONSCQ2 — North Scarborough Qualifier: 0 of 55 (unplaced)
- Saturday `njnIs0quK88`: 0 of 55 held — Video 7 h 5 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q45, M1–M10 · njnIs0quK88: Video 7 h 5 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2025 CAONTOQ3 — Central Toronto Qualifier: 0 of 41 (unplaced)
- Day `CTLyQoAnV5E`: 0 of 41 held — Video unavailable or private
  - Q1–Q30, M1–M11 · CTLyQoAnV5E: Video unavailable or private
### 2025 CAONWAQ — Waterloo Qualifier: 0 of 29 (unplaced)
- Sunday `NXBIW_EdBgE`: 0 of 29 held — Video 7 h 3 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q23, M1–M6 · NXBIW_EdBgE: Video 7 h 3 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2025 DESTQ — Germany Championship: 5 of 37 (partial)
- Saturday `Cg6mn3kNrtE`: 5 of 37 held
  - Q2–Q27, M2–M4, M6–M8 · Cg6mn3kNrtE: An early start would open on the match before (starts up to 11 min early)
### 2025 FPECAR — Carolinas Premier Event: 115 of 116 (partial)
- Day `QnGro_I1BG0`: 0 of 1 held — Video unavailable or private
  - M3 · QnGro_I1BG0: Video unavailable or private
### 2025 FPECCNSCIE — Canada Cup - Niagara Premier Event - Science Division: 91 of 92 (partial)
  - Q47 · no video: FIRST posted no video for this match
### 2025 FPEISTRDIV — İstanbul Premier Event - Rumeli Division: 0 of 84 (unplaced)
- Sunday `cmh8-a6q1ck`: 0 of 33 held
- Saturday 2026-06-27: no recording (51 played)
  - Q1–Q51 · no video: No recording for Saturday
  - Q52–Q74, M1–M10 · cmh8-a6q1ck: Played before the broadcast started
### 2025 FPEISTVDIV — İstanbul Premier Event - Valens Division: 0 of 84 (unplaced)
- Sunday `cmh8-a6q1ck`: 0 of 33 held
- Saturday 2026-06-27: no recording (51 played)
  - Q1–Q8, Q10–Q26, Q9, Q27–Q51 · no video: No recording for Saturday
  - Q52–Q74, M1–M10 · cmh8-a6q1ck: Played before the broadcast started
### 2025 FPEROC — Canadian Rockies Premier Event @ KDays: 0 of 110 (unplaced)
- Day `SXVDvK3XiOM`: 0 of 110 held — Video unavailable or private
  - Q1–Q96, M1–M14 · SXVDvK3XiOM: Video unavailable or private
### 2025 FPEWESEA — Western Edge Premier Event - Sea Division: 0 of 124 (unplaced)
- Saturday `KjjznpzWGmo`: 0 of 82 held — Video 1 h 11 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
- Friday 2026-05-29: no recording (28 played)
- Sunday 2026-05-31: no recording (14 played)
  - Q1–Q28 · no video: No recording for Friday
  - Q29–Q110 · KjjznpzWGmo: Video 1 h 11 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - M1–M14 · no video: No recording for Sunday
### 2025 FPEWESND — Western Edge Premier Event - Sand Division: 0 of 125 (unplaced)
- Saturday `9i15Y3g5BqQ`: 0 of 82 held — Video 1 h 39 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
- Friday 2026-05-29: no recording (28 played)
- Sunday 2026-05-31: no recording (15 played)
  - Q1–Q28 · no video: No recording for Friday
  - Q29–Q110 · 9i15Y3g5BqQ: Video 1 h 39 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - M1–M15 · no video: No recording for Sunday
### 2025 FRCMP — France Championship: 0 of 55 (unplaced)
- Saturday `-fyKHoLKOLs`: 0 of 55 held — Video 8 h 8 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q45, M1–M10 · -fyKHoLKOLs: Video 8 h 8 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 NLBRQ — Qualifier Breda: 0 of 26 (unplaced)
- Saturday `99XH5iBAQXI`: 0 of 26 held — Video 6 h 8 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q20, M1–M6 · 99XH5iBAQXI: Video 6 h 8 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2025 NLHAQ — Qualifier Hasselt: 7 of 25 (partial)
- Saturday `u-Ih3_XWYg0`: 0 of 18 held — Video 36 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
- Saturday · Part 2 `pk-G3ORxxZ0`: 7 of 7 held
  - Q1–Q18 · u-Ih3_XWYg0: Video 36 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2025 NLTHQ — Qualifier The Hague: 15 of 24 (partial)
- Saturday `StRSgbVJLJ4`: 15 of 24 held
  - Q16–Q18, M1–M6 · StRSgbVJLJ4: Past the part of the video its chapters confirm (to 2 h 38 min into the broadcast)
### 2025 NLZEQ — Qualifier Zeist: 44 of 48 (partial)
- Saturday `CbN-84sc-TA`: 44 of 48 held
  - M7–M10 · CbN-84sc-TA: Past the part of the video its chapters confirm (to 5 h 34 min into the broadcast)
### 2025 ROCMPCND — Romania Championship - COANDA Division: 73 of 87 (partial)
- Friday `pvmxbH8YW-k`: 5 of 18 held
- Saturday `zG45zl5pcDw`: 53 of 54 held
- Sunday `AMgGg3Hfzxs`: 15 of 15 held
  - Q2, Q4, Q8–Q16, Q18, Q5 · pvmxbH8YW-k: An early start would open on the match before (starts up to 6 min early)
  - Q19 · zG45zl5pcDw: Played before the broadcast started
### 2025 ROCMPVLC — Romania Championship - VLAICU Division: 61 of 86 (partial)
- Friday `0FwLO2mIQCY`: 0 of 18 held — Video 15 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
- Saturday `pUppOCjAGZw`: 54 of 54 held
- Sunday `upv_j3SsqIc`: 7 of 14 held
  - Q1–Q18 · 0FwLO2mIQCY: Video 15 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - M2–M8 · upv_j3SsqIc: An early start would open on the match before (starts up to 8 min early)
### 2025 ROEM2 — SnowBot Showdown: 0 of 12 (unplaced)
- Saturday `n8vNZKBdgzw`: 0 of 12 held — Video 1 h 44 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q12 · n8vNZKBdgzw: Video 1 h 44 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 ROSVLT — Romania South-West League Tournament: 29 of 57 (partial)
- Saturday `WPhnM2lDg3c`: 29 of 29 held
- Sunday 2026-03-01: no recording (28 played)
  - Q30–Q47, M1–M10 · no video: No recording for Sunday
### 2025 TRTUQ2 — 2. Piri Reis Turnuvası: 21 of 28 (partial)
- Sunday `ISUifIkmsuw`: 21 of 28 held
  - Q2, Q12, Q14–Q17, Q20 · ISUifIkmsuw: An early start would open on the match before (starts up to 4 min early)
### 2025 TRTUQ4 — 4. Piri Reis Turnuvası: 4 of 38 (partial)
- Sunday `fO-jhJzz4O8`: 4 of 38 held
  - Q2–Q28, M2–M8 · fO-jhJzz4O8: An early start would open on the match before (starts up to 12 min early)
### 2025 USALCMP — Alabama Championship: 0 of 40 (unplaced)
- Saturday `jOod-UoRGuE`: 0 of 40 held — Video 6 h 22 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q30, M1–M10 · jOod-UoRGuE: Video 6 h 22 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2025 USALHUQ1 — Qualifier #1: 0 of 17 (unplaced)
- Saturday `naRG_0BOSUc`: 0 of 17 held — Video 6 h 26 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q4, Q6–Q9, Q11–Q15, Q5, Q10, F1–F2 · naRG_0BOSUc: Video 6 h 26 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USARBEQ2 — Arkansas Battle at Benton: 26 of 30 (partial)
- Saturday `1WingSKwfNs`: 18 of 22 held
- Saturday `vTjVQKJ81Fs`: 4 of 4 held
- Saturday `XZODpgKAa_4`: 4 of 4 held
  - Q19–Q22 · 1WingSKwfNs: Played after the broadcast ended
### 2025 USARLCMP — Adventist Robotics Championship: 0 of 38 (unplaced)
- Day `uMzQvutiZAQ`: 0 of 38 held — Video unavailable or private
  - Q1–Q27, M1–M11 · uMzQvutiZAQ: Video unavailable or private
### 2025 USAZGLQ — Ironwood - Glendale Qualifier: 40 of 41 (partial)
- Saturday `Tme1X1P6cOk`: 40 of 41 held
  - Q1 · Tme1X1P6cOk: Played before the broadcast started
### 2025 USAZPHQ3 — Painted Desert - Phoenix Qualifier: 17 of 29 (partial)
- Saturday `Xbd9LafZOJQ`: 17 of 29 held
  - Q2–Q3, Q5–Q7, Q9–Q10, Q13, Q20, Q22–Q23, M2 · Xbd9LafZOJQ: An early start would open on the match before (starts up to 7 min early)
### 2025 USAZTEQ — Turquoise - Tempe Qualifier: 26 of 29 (partial)
- Saturday `WdaBlqpdouQ`: 26 of 29 held
  - Q1–Q3 · WdaBlqpdouQ: Played before the broadcast started
### 2025 USCALACALAM2 — SoCal FTC Group H - Scrimmage 2: 13 of 23 (partial)
- Saturday `Ec8eZNzaGJY`: 13 of 23 held
  - Q3–Q4, Q6–Q7, Q10, Q13, Q17, Q19–Q20, Q23 · Ec8eZNzaGJY: An early start would open on the match before (starts up to 6 min early)
### 2025 USCASDCMP — California - San Diego Championship: 0 of 70 (unplaced)
- Day `a4I6SZ1t8vM`: 0 of 70 held — Video unavailable or private
  - Q1–Q60, M1–M10 · a4I6SZ1t8vM: Video unavailable or private
### 2025 USCHSCMP — Chesapeake Championship: 0 of 2 (unplaced)
- Saturday `Z2ArRHRiwh0`: 0 of 0 held
- Sunday 2026-02-08: no recording (2 played)
  - F1–F2 · no video: No recording for Sunday
### 2025 USCHSCMPBLCR — Chesapeake Championship - Blue Crab Division: 59 of 99 (partial)
- Saturday `Z2ArRHRiwh0`: 10 of 50 held
- Sunday `8rY8ovql18I`: 49 of 49 held
  - Q2–Q14, Q16–Q21, Q23–Q24, Q27, Q30–Q36, Q39–Q43, Q45–Q50 · Z2ArRHRiwh0: An early start would open on the match before (starts up to 4 min early)
### 2025 USCHSCMPRDCA — Chesapeake Championship - Red Cardinal Division: 56 of 98 (partial)
- Saturday `DxFBMhu8nn4`: 8 of 50 held
- Sunday `axQJIjWRXg0`: 48 of 48 held
  - Q2–Q11, Q13–Q26, Q28, Q30–Q34, Q36–Q37, Q39–Q42, Q44–Q47, Q49–Q50 · DxFBMhu8nn4: An early start would open on the match before (starts up to 6 min early)
### 2025 USCOBRQ — Prospect Ridge Academy Qualifier: 0 of 46 (unplaced)
- Saturday `Q3jDNorn_Ck`: 0 of 46 held — Video 1 h 51 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q36, M1–M10 · Q3jDNorn_Ck: Video 1 h 51 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2025 USCODEQ1 — Mullen High School Qualifier: 10 of 35 (partial)
- Saturday `LNVMIxjg9d8`: 10 of 35 held
  - Q11–Q29, M1–M6 · LNVMIxjg9d8: Past the part of the video its chapters confirm (to 2 h 25 min into the broadcast)
### 2025 USCODEQ2 — Southern Qualifier: 0 of 36 (unplaced)
- Saturday `aZ6UuRVLcXE`: 0 of 36 held — Video 3 h 56 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q30, M1–M6 · aZ6UuRVLcXE: Video 3 h 56 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USCOFRQ — Mountain Qualifier: 0 of 24 (unplaced)
- Saturday `w36Zw_uqfms`: 0 of 24 held — Video 6 h 31 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q18, M1–M6 · w36Zw_uqfms: Video 6 h 31 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USCOLIQ — SW Metro Qualifier: 14 of 35 (partial)
- Saturday `W9fnbtAc6Z8`: 14 of 35 held
  - Q16–Q29, Q13, M1–M6 · W9fnbtAc6Z8: Past the part of the video its chapters confirm (to 3 h 37 min into the broadcast)
### 2025 USCOSEQ — Northern Qualifier: 0 of 43 (unplaced)
- Saturday `pUraXxR5-fI`: 0 of 43 held — Video 1 h 47 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q8, Q10–Q33, Q9, M1–M10 · pUraXxR5-fI: Video 1 h 47 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2025 USFCTKAQ — Monument Valley - Kayenta Qualifier: 4 of 26 (partial)
- Saturday `inTg2y3YymA`: 4 of 26 held
  - Q2–Q12, Q14–Q19, M2–M5, M7 · inTg2y3YymA: An early start would open on the match before (starts up to 13 min early)
### 2025 USFLFNLT — FUN League Tournament: 41 of 44 (partial)
- Saturday `afaqqytUvDU`: 0 of 3 held
- Saturday `nm-LnMVtCJM`: 41 of 41 held
  - Q1–Q3 · afaqqytUvDU: Played after the broadcast ended
### 2025 USFLORLT — Orlando Robotics League Tournament: 21 of 48 (partial)
- Saturday `Ze9nb5PfHZE`: 21 of 48 held
  - Q22–Q32, Q34–Q38, Q33, M1–M10 · Ze9nb5PfHZE: Past the part of the video its chapters confirm (to 3 h 43 min into the broadcast)
### 2025 USFLORM2 — Orlando Robotics League Meet 2: 0 of 47 (unplaced)
- Saturday `OBaOrZgzmI0`: 0 of 47 held — Video 4 h 57 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q47 · OBaOrZgzmI0: Video 4 h 57 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USGANWLT — Northwest League Tournament: 0 of 40 (unplaced)
- Day `JRoX9LbFF6E`: 0 of 40 held — Video unavailable or private
  - Q1–Q29, M1–M11 · JRoX9LbFF6E: Video unavailable or private
### 2025 USIAACPSM1 — Acropolis #1: 25 of 35 (partial)
- Saturday `hMO7b_FGIgg`: 25 of 35 held
  - Q4, Q9–Q10, Q16, Q22–Q23, Q26, Q28, Q32, Q35 · hMO7b_FGIgg: An early start would open on the match before (starts up to 4 min early)
### 2025 USIACMPGOLD — Iowa Championship - Gold Division: 63 of 65 (partial)
- Friday `obOIbpgpsHE`: 18 of 18 held
- Saturday `8LrfOpKcxkU`: 45 of 47 held
  - M10 · 8LrfOpKcxkU: After the video ends (the video stops 2 min before it)
  - M11 · 8LrfOpKcxkU: Played after the broadcast ended
### 2025 USIAESTRM2 — Easter Island OrangeCity: 2 of 23 (partial)
- Saturday `8C221vcaRik`: 2 of 23 held
  - Q2–Q13, Q15–Q23 · 8C221vcaRik: An early start would open on the match before (starts up to 9 min early)
### 2025 USIAESTRM3 — EasterIsland SiouxCity: 25 of 26 (partial)
- Saturday `AOD-3A_Vw1k`: 25 of 26 held
  - Q14 · AOD-3A_Vw1k: An early start would open on the match before (starts up to 4 min early)
### 2025 USIAESTRM6 — EasterIsland Hinton: 0 of 9 (unplaced)
- Saturday `3p0V96xBZpQ`: 0 of 0 held
- Saturday 2025-12-13: no recording (9 played)
  - Q1–Q9 · no video: No recording for Saturday
### 2025 USIAMPM11 — MachuPicchu Bettendorf BHS: 7 of 32 (partial)
- Saturday `JEd0jbOTU8I`: 7 of 32 held
  - Q8–Q32 · JEd0jbOTU8I: Past the part of the video its chapters confirm (to 44 min into the broadcast)
### 2025 USIAMPM4 — MachuPicchu Iowa City November: 0 of 21 (unplaced)
- Thursday `viU29uFZQGw`: 0 of 0 held
- Saturday 2025-11-22: no recording (21 played)
  - Q1–Q21 · no video: No recording for Saturday
### 2025 USIAMPM5 — MachuPicchu Williamburg: 11 of 20 (partial)
- Thursday `NBGA4UiNndk`: 11 of 20 held
  - Q1–Q2 · NBGA4UiNndk: Played before the broadcast started
  - Q10–Q14, Q16–Q17 · NBGA4UiNndk: An early start would open on the match before (starts up to 6 min early)
### 2025 USIAMPM8 — MachuPicchu Iowa City December: 0 of 11 (unplaced)
- Saturday `APwWuLQovRA`: 0 of 0 held
- Saturday 2025-12-13: no recording (11 played)
  - Q1–Q11 · no video: No recording for Saturday
### 2025 USIAPOMPLT — Pompeii: 0 of 45 (unplaced)
- Saturday `QyKaGG_E_po`: 0 of 45 held — Video 17 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q34, M1–M2, M1-2, M4, M3, M6, M5, M7–M10 · QyKaGG_E_po: Video 17 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USIAPOMPM11 — Pompeii Regis: 2 of 18 (partial)
- Saturday `ufVIXyeHAjk`: 2 of 18 held
  - Q2, Q4–Q18 · ufVIXyeHAjk: An early start would open on the match before (starts up to 14 min early)
### 2025 USIASTNGLT — Stonehenge: 0 of 53 (unplaced)
- Saturday `ECyOBSeQgG4`: 0 of 53 held — Video 6 h 32 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q42, M1–M11 · ECyOBSeQgG4: Video 6 h 32 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2025 USIASTNGM7 — Stonehenge Peet: 39 of 41 (partial)
- Saturday `-gW8W6TUu8M`: 39 of 41 held
  - Q1–Q2 · -gW8W6TUu8M: Played before the broadcast started
### 2025 USIAWESTLT — Easter Island & Chichen Itza: 9 of 48 (partial)
- Saturday `8kHuOPUmM2E`: 9 of 48 held
  - Q2–Q11, Q13–Q14, Q17–Q37, M2, M4–M8 · 8kHuOPUmM2E: An early start would open on the match before (starts up to 9 min early)
### 2025 USIDKIQ — Magic Valley Qualifying Event: 22 of 23 (partial)
- Saturday `pfPvAsmwDWE`: 22 of 23 held
  - Q1 · pfPvAsmwDWE: Played before the broadcast started
### 2025 USILCCLT1 — Chicago League Tournament A: 22 of 38 (partial)
- Saturday `PjwXTjGAkpo`: 22 of 38 held
  - Q3, Q5–Q6, Q8, Q10, Q12, Q15–Q16, Q18, Q22–Q24, Q26–Q28, M2 · PjwXTjGAkpo: An early start would open on the match before (starts up to 4 min early)
### 2025 USILCSNELT — Suburban Northeast League Tournament: 0 of 39 (unplaced)
- Saturday `UGahoaflRn0`: 0 of 39 held — Video 36 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q29, M1–M10 · UGahoaflRn0: Video 36 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2025 USILSCLT — Southern Central League Tournament: 43 of 49 (partial)
- Saturday `do_F0Y4vRzI`: 43 of 49 held
  - M5–M10 · do_F0Y4vRzI: Past the part of the video its chapters confirm (to 5 h 44 min into the broadcast)
### 2025 USMABRQ1 — Brookline Robo Rally 1: 27 of 40 (partial)
- Saturday `Oe-pETJ5zjI`: 27 of 40 held
  - Q3, Q5–Q6, Q10–Q12, Q20, Q23–Q24, Q26–Q28, Q30 · Oe-pETJ5zjI: An early start would open on the match before (starts up to 5 min early)
### 2025 USMASHQ — Ryken Robobowl: 0 of 41 (unplaced)
- Sunday `kwfzcjeaCGo`: 0 of 41 held — Video 6 h 28 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q30, M1–M11 · kwfzcjeaCGo: Video 6 h 28 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USMASPQ — WNEU Qualifier: 21 of 28 (partial)
- Saturday `SWPvRL2jUUY`: 21 of 28 held
  - Q1–Q2 · SWPvRL2jUUY: Played before the broadcast started
  - M2–M6 · SWPvRL2jUUY: Played after the broadcast ended
### 2025 USMAWEQ — Havoc at the Hawks' Nest: 19 of 49 (partial)
- Saturday `Aj0stAP3EwM`: 19 of 49 held
  - Q1–Q30 · Aj0stAP3EwM: Played before the broadcast started
### 2025 USMIAAS — Girls R GRAYT All Girls: 0 of 26 (unplaced)
- Saturday `-MAdeK462K0`: 0 of 0 held
- Sunday 2026-06-14: no recording (26 played)
  - Q1–Q20, M1–M6 · no video: No recording for Sunday
### 2025 USMIMIQ1 — GLBR Qualifier: 0 of 54 (unplaced)
- Friday `RE2yo5T2d80`: 0 of 54 held — Video 12 h 42 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q43, M1–M11 · RE2yo5T2d80: Video 12 h 42 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USMISCLT — South Central League Tournament: 7 of 49 (partial)
- Saturday `LozxQh22O7A`: 7 of 49 held
  - Q2–Q4, Q6–Q15, Q17–Q18, Q20–Q39, M2–M8 · LozxQh22O7A: An early start would open on the match before (starts up to 7 min early)
### 2025 USMNCMPGLXY — Minnesota FTC State Championship - Galaxy Division: 4 of 66 (partial)
- Saturday `kzo5SBlOhVs`: 4 of 66 held
  - Q2–Q18, Q20–Q33, Q19, Q35–Q56, M2–M9 · kzo5SBlOhVs: An early start would open on the match before (starts up to 14 min early)
### 2025 USMNCMPNANO — Minnesota FTC State Championship - Nano Division: 0 of 66 (unplaced)
- Saturday `w6wOm-lfJyM`: 0 of 66 held — Video 21 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q56, M1–M10 · w6wOm-lfJyM: Video 21 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2025 USMNOTQ2 — MN FTC Otsego Sunday: 38 of 48 (partial)
- Sunday `Ri9iaQqYYmg`: 38 of 48 held
  - Q1–Q10 · Ri9iaQqYYmg: Played before the broadcast started
### 2025 USMOKSKCEM1 — Lawson Meet @ 8 AM: 0 of 12 (unplaced)
- Day `d7aikgA0fcA`: 0 of 12 held — Video has no broadcast clock (an upload, not a live stream)
  - Q1–Q12 · d7aikgA0fcA: Video has no broadcast clock (an upload, not a live stream)
### 2025 USMOKSKCEM2 — Lawson Meet @ 10:30 AM: 0 of 12 (unplaced)
- Day `clFcWK19XOY`: 0 of 12 held — Video has no broadcast clock (an upload, not a live stream)
  - Q1–Q12 · clFcWK19XOY: Video has no broadcast clock (an upload, not a live stream)
### 2025 USMOKSKCEM3 — F.L. Schlagle Meet  @ 10:30 AM: 0 of 14 (unplaced)
- Day `yUA68q4_Bw8`: 0 of 14 held — Video has no broadcast clock (an upload, not a live stream)
  - Q1–Q14 · yUA68q4_Bw8: Video has no broadcast clock (an upload, not a live stream)
### 2025 USMOKSKCEM4 — Mill Valley Meet @ 10:30 AM: 0 of 15 (unplaced)
- Day `lTf4wpMdRAw`: 0 of 15 held — Video has no broadcast clock (an upload, not a live stream)
  - Q1–Q15 · lTf4wpMdRAw: Video has no broadcast clock (an upload, not a live stream)
### 2025 USMOKSKCEM5 — Notre Dame DeSion Meet @ 8 AM: 0 of 18 (unplaced)
- Day `lvDdKIQ88W8`: 0 of 18 held — Video has no broadcast clock (an upload, not a live stream)
  - Q1–Q18 · lvDdKIQ88W8: Video has no broadcast clock (an upload, not a live stream)
### 2025 USMOKSKCEM6 — Notre Dame DeSion Meet @ 10:30 AM: 0 of 18 (unplaced)
- Day `AMQqeLVGogc`: 0 of 18 held — Video has no broadcast clock (an upload, not a live stream)
  - Q1–Q18 · AMQqeLVGogc: Video has no broadcast clock (an upload, not a live stream)
### 2025 USMOKSKCEM7 — Holden Meet @ 8 AM: 0 of 18 (unplaced)
- Day `eY4QVi0NhP8`: 0 of 18 held — Video has no broadcast clock (an upload, not a live stream)
  - Q1–Q18 · eY4QVi0NhP8: Video has no broadcast clock (an upload, not a live stream)
### 2025 USMOKSKCEM8 — Holden Meet @ 1 PM: 0 of 18 (unplaced)
- Day `JFYaccZibdY`: 0 of 18 held — Video has no broadcast clock (an upload, not a live stream)
  - Q1–Q18 · JFYaccZibdY: Video has no broadcast clock (an upload, not a live stream)
### 2025 USMOKSKCWM1 — F.L. Schlagle Meet @ 8 AM: 0 of 18 (unplaced)
- Day `1jAcFtbdhoY`: 0 of 18 held — Video has no broadcast clock (an upload, not a live stream)
  - Q1–Q18 · 1jAcFtbdhoY: Video has no broadcast clock (an upload, not a live stream)
### 2025 USMOKSKCWM2 — F.L. Schlagle Meet @ 1 PM: 0 of 12 (unplaced)
- Day `iAXElqTy5Q4`: 0 of 12 held — Video has no broadcast clock (an upload, not a live stream)
  - Q1–Q12 · iAXElqTy5Q4: Video has no broadcast clock (an upload, not a live stream)
### 2025 USMOKSKCWM3 — Mill Valley Meet @ 8 AM: 0 of 18 (unplaced)
- Day `39UKBQFZJck`: 0 of 18 held — Video has no broadcast clock (an upload, not a live stream)
  - Q1–Q18 · 39UKBQFZJck: Video has no broadcast clock (an upload, not a live stream)
### 2025 USMOKSKCWM4 — Mill Valley Meet @ 1 PM: 0 of 18 (unplaced)
- Day `PMaiVkKpIEA`: 0 of 18 held — Video has no broadcast clock (an upload, not a live stream)
  - Q1–Q18 · PMaiVkKpIEA: Video has no broadcast clock (an upload, not a live stream)
### 2025 USMOKSKCWM5 — Holden Meet @ 10:30 AM: 0 of 14 (unplaced)
- Day `JXr1K-6FFUo`: 0 of 14 held — Video has no broadcast clock (an upload, not a live stream)
  - Q1–Q14 · JXr1K-6FFUo: Video has no broadcast clock (an upload, not a live stream)
### 2025 USMOKSKCWM6 — Chisholm Trail Meet @ 8 AM: 0 of 18 (unplaced)
- Day `imEPCNgb8FQ`: 0 of 18 held — Video has no broadcast clock (an upload, not a live stream)
  - Q1–Q18 · imEPCNgb8FQ: Video has no broadcast clock (an upload, not a live stream)
### 2025 USMOKSKCWM7 — Chisholm Trail Meet @ 10:30 AM: 0 of 18 (unplaced)
- Day `uZSxJ3jMSgU`: 0 of 18 held — Video has no broadcast clock (an upload, not a live stream)
  - Q1–Q18 · uZSxJ3jMSgU: Video has no broadcast clock (an upload, not a live stream)
### 2025 USMOKSSTLMM2 — Lafayette Meet #1 @ 8 AM: 0 of 17 (unplaced)
- Day `lvhcciim1Y4`: 0 of 17 held — Video has no broadcast clock (an upload, not a live stream)
  - Q1–Q17 · lvhcciim1Y4: Video has no broadcast clock (an upload, not a live stream)
### 2025 USMOKSSTLMM3 — Lafayette Meet #1 @ 1 PM: 0 of 18 (unplaced)
- Day `-r3PgmLHlHs`: 0 of 18 held — Video has no broadcast clock (an upload, not a live stream)
  - Q1–Q18 · -r3PgmLHlHs: Video has no broadcast clock (an upload, not a live stream)
### 2025 USMOKSSTLMM4 — Eureka Meet @ 8 AM: 0 of 12 (unplaced)
- Day `ELQxhBjSDJc`: 0 of 12 held — Video has no broadcast clock (an upload, not a live stream)
  - Q1–Q12 · ELQxhBjSDJc: Video has no broadcast clock (an upload, not a live stream)
### 2025 USMOKSSTLMM5 — Eureka Meet @ 1 PM: 0 of 18 (unplaced)
- Day `D1hnMIhxmDc`: 0 of 18 held — Video has no broadcast clock (an upload, not a live stream)
  - Q1–Q18 · D1hnMIhxmDc: Video has no broadcast clock (an upload, not a live stream)
### 2025 USMOKSSTLMM7 — Lafayette Meet #2 @ 10 AM: 0 of 18 (unplaced)
- Saturday `GR6luBpywmU`: 0 of 18 held — Video 1 h 10 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q18 · GR6luBpywmU: Video 1 h 10 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USMOKSSTLSM6 — Gateway STEM Meet  @ 4:30 PM: 0 of 18 (unplaced)
- Day `8xY_WKXYdGE`: 0 of 18 held — Video has no broadcast clock (an upload, not a live stream)
  - Q1–Q18 · 8xY_WKXYdGE: Video has no broadcast clock (an upload, not a live stream)
### 2025 USMOKSSTLSM7 — South Tech Meet #2 @ 8 AM: 16 of 17 (partial)
- Saturday `AG3p5DRVWdc`: 16 of 17 held
  - Q1 · AG3p5DRVWdc: Played before the broadcast started
### 2025 USMSCMP — Mississippi Championship: 36 of 46 (partial)
- Saturday `Or98pKIIRjo`: 36 of 46 held
  - M1–M10 · Or98pKIIRjo: Played after the broadcast ended
### 2025 USMTBUQ — Montana Qualifier - Butte MT-Tech: 45 of 53 (partial)
- Saturday `ppp0SiSuuSE`: 0 of 8 held
- Saturday `Xw9sHITGd3o`: 45 of 45 held
  - M3–M10 · ppp0SiSuuSE: Played after the broadcast ended
### 2025 USNCCMP — North Carolina Championship: 4 of 55 (partial)
- Sunday `cFia2BHJXZ4`: 4 of 55 held
  - Q1–Q9 · cFia2BHJXZ4: Played before the broadcast started
  - Q11–Q45, M2–M8 · cFia2BHJXZ4: An early start would open on the match before (starts up to 9 min early)
### 2025 USNHCMP — New Hampshire Championship: 0 of 45 (unplaced)
- Saturday `Qu7DQwOx4Go`: 0 of 45 held — Video 6 h 13 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q19, Q21–Q35, Q20, M1–M10 · Qu7DQwOx4Go: Video 6 h 13 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USNMCMP — New Mexico Championship: 5 of 29 (partial)
- Saturday `awgTySwJx-Y`: 5 of 29 held
  - Q2–Q7, Q9, Q11–Q23, M2–M4, M6 · awgTySwJx-Y: An early start would open on the match before (starts up to 14 min early)
### 2025 USNYEXCMP — MVCC New York - Excelsior Championship: 70 of 74 (partial)
- Saturday `pCbOYH7Htf4`: 4 of 8 held
- Sunday `A_LRxc_4wZk`: 66 of 66 held
  - Q2, Q5–Q7 · pCbOYH7Htf4: An early start would open on the match before (starts up to 4 min early)
### 2025 USNYEXCOQ — Corning Qualifier: 13 of 44 (partial)
- Sunday `2gUfXLDd9vA`: 13 of 44 held
  - Q2–Q3, Q5–Q13, Q15–Q16, Q18–Q20, Q22–Q31, Q33, M2, M4, M6–M7 · 2gUfXLDd9vA: An early start would open on the match before (starts up to 6 min early)
### 2025 USNYEXHJQ — John Jay Qualifier: 0 of 45 (unplaced)
- Saturday `lwsnQGR_fsk`: 0 of 45 held — Video 3 h 5 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q35, M1–M10 · lwsnQGR_fsk: Video 3 h 5 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USNYEXPEQ — Peekskill Qualifier: 0 of 45 (unplaced)
- Saturday `aRALidvFmR0`: 0 of 45 held — Video 1 h 48 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q35, M1–M10 · aRALidvFmR0: Video 1 h 48 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USNYEXPEQ2 — Finger Lakes Qualifier: 0 of 38 (unplaced)
- Sunday `XSLYW_MySy8`: 0 of 38 held — Video 52 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q28, M1–M10 · XSLYW_MySy8: Video 52 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USOHAUOS — KSS Turtle Friendly: 0 of 10 (unplaced)
- Day `lG9PpwTA-P8`: 0 of 10 held — Video has no broadcast clock (an upload, not a live stream)
  - M1–M10 · lG9PpwTA-P8: Video has no broadcast clock (an upload, not a live stream)
### 2025 USOHCEOHLT — Central Ohio League Tournament: 0 of 25 (unplaced)
- Day `M_S4haY-IcU`: 0 of 25 held — Video has no broadcast clock (an upload, not a live stream)
  - Q1–Q19, M1–M6 · M_S4haY-IcU: Video has no broadcast clock (an upload, not a live stream)
### 2025 USOHCEOHM3 — Central Ohio Meet 3: 0 of 24 (unplaced)
- Day `YLbszDxtrAY`: 0 of 24 held — Video has no broadcast clock (an upload, not a live stream)
  - Q1–Q18, M1–M6 · YLbszDxtrAY: Video has no broadcast clock (an upload, not a live stream)
### 2025 USOHCLQ2 — CMSD Qualifier: 0 of 25 (unplaced)
- Thursday `S6iU2gWkFZ8`: 0 of 25 held — Video 6 h 29 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q10, Q12–Q18, Q11, M1–M7 · S6iU2gWkFZ8: Video 6 h 29 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USOHNEOHM3 — NEOH 3: 0 of 20 (unplaced)
- Day `ixYvoqIRw0Q`: 0 of 20 held — Video unavailable or private
  - Q1–Q2, Q4, Q3, Q5–Q20 · ixYvoqIRw0Q: Video unavailable or private
### 2025 USORCMPPUR1 — Oregon Championship - Purple Division: 34 of 52 (partial)
- Saturday `-_vByPV-npI`: 7 of 12 held
- Sunday `ki957nlxltA`: 27 of 40 held
  - Q3, Q5, Q9–Q10, Q12 · -_vByPV-npI: An early start would open on the match before (starts up to 4 min early)
  - Q40–Q42, M1–M10 · ki957nlxltA: Past the part of the video its chapters confirm (to 3 h 47 min into the broadcast)
### 2025 USORIMLT — Iron Mountain League Tournament: 7 of 21 (partial)
- Saturday `z8EdxVLAEGY`: 7 of 21 held
  - Q1–Q14 · z8EdxVLAEGY: Played before the broadcast started
### 2025 USORIMM1 — Iron Mountain League Meet 1: 0 of 13 (unplaced)
- Saturday `acZfrIyzSXw`: 0 of 13 held — Video 2 h 24 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q13 · acZfrIyzSXw: Video 2 h 24 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USORIMM2 — Iron Mountain League Meet 2: 0 of 14 (unplaced)
- Saturday `J9CYyMc9ybw`: 0 of 14 held — Video 2 h 4 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q14 · J9CYyMc9ybw: Video 2 h 4 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USORIMM3 — Iron Mountain League Meet 3: 0 of 14 (unplaced)
- Day `KI7s_LuQIrc`: 0 of 14 held — Video has no broadcast clock (an upload, not a live stream)
  - Q1–Q14 · KI7s_LuQIrc: Video has no broadcast clock (an upload, not a live stream)
### 2025 USORPHQ — Spark Invitational: 15 of 55 (partial)
- Sunday `LNoHfnyab6s`: 15 of 55 held
  - Q2–Q8, Q10–Q12, Q14, Q16–Q17, Q19–Q21, Q23, Q25, Q27–Q28, Q30–Q32, Q34–Q45, M2–M4, M6, M8 · LNoHfnyab6s: An early start would open on the match before (starts up to 6 min early)
### 2025 USORRCLT — Rose City League Tournament: 19 of 28 (partial)
- Saturday `vytSgpJsr1Q`: 19 of 28 held
  - Q21–Q22, Q1, M1–M6 · vytSgpJsr1Q: Past the part of the video its chapters confirm (to 3 h 22 min into the broadcast)
### 2025 USORRCM1 — Rose City League Meet 1: 0 of 20 (unplaced)
- Saturday `rv2i4S5eu_k`: 0 of 20 held
  - Q1, Q3–Q20, Q2 · rv2i4S5eu_k: Played after the broadcast ended
### 2025 USORRCM2 — Rose City League Meet 2: 0 of 20 (unplaced)
- Monday `gPITsadBcwY`: 0 of 0 held
- Saturday 2025-12-13: no recording (20 played)
  - Q1–Q20 · no video: No recording for Saturday
### 2025 USORRCM3 — Rose City League Meet 3: 0 of 22 (unplaced)
- Day `gxt836H-w2s`: 0 of 22 held — Video unavailable or private
  - Q1–Q22 · gxt836H-w2s: Video unavailable or private
### 2025 USPALAQ2 — Blue Streak Qualifier: 0 of 43 (unplaced)
- Day `J7AGzW0ki1k`: 0 of 43 held — Video unavailable or private
  - Q1–Q33, M1–M10 · J7AGzW0ki1k: Video unavailable or private
### 2025 USTNCMP — Tennessee Championship: 5 of 45 (partial)
- Saturday `UxEbw2_MSck`: 5 of 45 held
  - Q3–Q8, Q1, Q10–Q11, Q13–Q35, Q12, M2–M8 · UxEbw2_MSck: An early start would open on the match before (starts up to 13 min early)
### 2025 USTXCHCM2 — FiT-Central NSAHC Hill Country League Meet 2: 8 of 22 (partial)
- Saturday `oqY-OZ3-juk`: 8 of 22 held
  - Q9 · oqY-OZ3-juk: After the video ends (the video stops 0 min before it)
  - Q10–Q22 · oqY-OZ3-juk: Played after the broadcast ended
### 2025 USTXCMP4A — FiT-Central Texas Regional Championship - Aero Division: 43 of 46 (partial)
- Saturday `nTfPHziGyL8`: 43 of 46 held
  - M8–M10 · nTfPHziGyL8: Past the part of the video its chapters confirm (to 5 h 59 min into the broadcast)
### 2025 USTXCMP4T — FiT-Central Texas Regional Championship - Terra Division: 6 of 46 (partial)
- Saturday `F8LTQSq1Lck`: 6 of 46 held
  - Q7–Q36, M1–M10 · F8LTQSq1Lck: Past the part of the video its chapters confirm (to 59 min into the broadcast)
### 2025 USTXDAQ2 — FiT-North Winter Charger Qualifier: 6 of 49 (partial)
- Saturday `Uk5UCkpzRTs`: 0 of 43 held — Video 13 h 37 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
- Saturday `qmi1hWqYa4Q`: 0 of 0 held — Video 28 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
- Saturday `eKFwME2gVAc`: 3 of 3 held
- Saturday `JxIKaTysWYc`: 3 of 3 held
- Saturday `J78zdSTmEtY`: 0 of 0 held — Video 4 h 17 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q2, Q7–Q12, Q14–Q39, M1–M10 · Uk5UCkpzRTs: Video 13 h 37 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USTXDASQ — FiT-North Dallas Semi-Regional: 40 of 43 (partial)
- Saturday `TfCy8Ji0vuI`: 40 of 43 held
  - M9–M11 · TfCy8Ji0vuI: Past the part of the video its chapters confirm (to 4 h 34 min into the broadcast)
### 2025 USTXFMQ — FiT-North Last Call Qualifier: 0 of 55 (unplaced)
- Saturday `3JIBUValRVM`: 0 of 55 held — Video 6 h 27 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q41, Q43, Q42, Q45, Q44, M1–M10 · 3JIBUValRVM: Video 6 h 27 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USTXGRSQ — FiT-North Grapevine Semi-Regional: 9 of 48 (partial)
- Saturday `p-1xMvJiTmc`: 9 of 48 held
  - Q10–Q38, M1–M10 · p-1xMvJiTmc: Past the part of the video its chapters confirm (to 1 h 18 min into the broadcast)
### 2025 USTXNAM2 — FiT-North A-League Meet 2: 0 of 35 (unplaced)
- Saturday `qmi1hWqYa4Q`: 0 of 35 held — Video 28 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q35 · qmi1hWqYa4Q: Video 28 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USTXNAM3 — FiT-North A-League Meet 3: 0 of 35 (unplaced)
- Saturday `I96iSxbO_TY`: 0 of 35 held — Video 1 h 20 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q35 · I96iSxbO_TY: Video 1 h 20 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USTXNDLT — FiT-North D-League Tournament: 0 of 30 (unplaced)
- Saturday `d8gLyynDuyc`: 0 of 30 held — Video 1 h 49 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q24, M1–M6 · d8gLyynDuyc: Video 1 h 49 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USTXNDM1 — FiT-North D-League Meet 1: 0 of 22 (unplaced)
- Saturday `OMDhQ9Nf-TQ`: 0 of 22 held — Video 4 h 15 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q22 · OMDhQ9Nf-TQ: Video 4 h 15 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USTXNDM2 — FiT-North D-League Meet 2: 3 of 27 (partial)
- Saturday `eKFwME2gVAc`: 3 of 27 held
  - Q2–Q5, Q7–Q11, Q13–Q27 · eKFwME2gVAc: An early start would open on the match before (starts up to 10 min early)
### 2025 USTXNDM3 — FiT-North D-League Meet 3: 0 of 24 (unplaced)
- Saturday `LSNWexDpHGs`: 0 of 24 held — Video 1 h 9 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q2–Q24, Q1 · LSNWexDpHGs: Video 1 h 9 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USTXNELT — FiT-North E-League Tournament: 0 of 16 (unplaced)
- Saturday `0NBABCtsPXE`: 0 of 16 held — Video 6 h 48 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q14, F1–F2 · 0NBABCtsPXE: Video 6 h 48 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USTXNEM3 — FiT-North E-League Meet 3: 0 of 14 (unplaced)
- Saturday `R4i_zFysuOE`: 0 of 14 held — Video 2 h 19 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q14 · R4i_zFysuOE: Video 2 h 19 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USTXNFM1 — FiT-North F-League Meet 1: 0 of 19 (unplaced)
- Saturday `ug2uPuIxEPU`: 0 of 19 held — Video 7 h 53 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q19 · ug2uPuIxEPU: Video 7 h 53 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USTXNFM2 — FiT-North F-League Meet 2: 0 of 27 (unplaced)
- Saturday `EOy_35Yv5IE`: 0 of 27 held — Video 1 h 35 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q27 · EOy_35Yv5IE: Video 1 h 35 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USTXNFM3 — FiT-North F-League Meet 3: 0 of 29 (unplaced)
- Saturday `0ejYUiBPf9U`: 0 of 29 held — Video 1 h 50 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q29 · 0ejYUiBPf9U: Video 1 h 50 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USTXNFTLT — FiT-North F&T League Tournament: 0 of 53 (unplaced)
- Saturday `Zi42pCwE5P8`: 0 of 53 held — Video 6 h 26 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q2–Q43, Q1, M1–M10 · Zi42pCwE5P8: Video 6 h 26 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USTXNIM1 — FiT-North I-League Meet 1: 0 of 21 (unplaced)
- Saturday `Cy-E303rn-0`: 0 of 21 held — Video 5 h 29 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q21 · Cy-E303rn-0: Video 5 h 29 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USTXNIM2 — FiT-North I-League Meet 2: 0 of 21 (unplaced)
- Saturday `exUgHTHC8zE`: 0 of 21 held — Video 36 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q21 · exUgHTHC8zE: Video 36 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2025 USTXNIM3 — FiT-North I-League Meet 3: 9 of 21 (partial)
- Saturday `QhWzNB0MlLo`: 9 of 21 held
  - Q10–Q21 · QhWzNB0MlLo: Past the part of the video its chapters confirm (to 2 h 12 min into the broadcast)
### 2025 USTXNISLT — FiT-North I&S League Tournament: 0 of 48 (unplaced)
- Saturday `zA72xvqndKo`: 0 of 48 held — Video 6 h 22 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q32, Q34, Q33, Q35–Q38, M1–M10 · zA72xvqndKo: Video 6 h 22 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2025 USTXNSM3 — FiT-North S-League Meet 3: 0 of 23 (unplaced)
- Saturday `tX3_dIfE7Q4`: 0 of 23 held — Video 6 h 9 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q23 · tX3_dIfE7Q4: Video 6 h 9 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USTXNTM1 — FiT-North T-League Meet 1: 0 of 26 (unplaced)
- Saturday `m_Z6k_ONiOw`: 0 of 26 held — Video 6 h 10 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q26 · m_Z6k_ONiOw: Video 6 h 10 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USTXNTM2 — FiT-North T-League Meet 2: 23 of 24 (partial)
- Saturday `JxIKaTysWYc`: 23 of 24 held
  - Q11 · JxIKaTysWYc: An early start would open on the match before (starts up to 6 min early)
### 2025 USTXNULT — FiT-North U-League Tournament: 0 of 53 (unplaced)
- Saturday `r010vILHGhA`: 0 of 53 held — Video 6 h 36 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q42, M1–M11 · r010vILHGhA: Video 6 h 36 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USTXNXAM2 — FiT-North X-League AM Meet 2: 19 of 21 (partial)
- Saturday `EOy_35Yv5IE`: 0 of 2 held — Video 1 h 35 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
- Saturday `6ciU3YSNPJg`: 0 of 0 held — Video 7 h 16 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
- Saturday `exUgHTHC8zE`: 15 of 15 held
- Saturday `tnxxtgPOkdE`: 4 of 4 held
  - Q1–Q2 · EOy_35Yv5IE: Video 1 h 35 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USTXNXAM3 — FiT-North X-League AM Meet 3: 15 of 19 (partial)
- Saturday `I96iSxbO_TY`: 0 of 4 held — Video 1 h 20 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
- Saturday `k1u8I_NLMdM`: 0 of 0 held — Video 6 h 1 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
- Saturday `0ejYUiBPf9U`: 0 of 0 held — Video 1 h 50 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
- Saturday `PmkSHvZNiqA`: 15 of 15 held
- Saturday `LSNWexDpHGs`: 0 of 0 held — Video 1 h 9 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
- Saturday `R4i_zFysuOE`: 0 of 0 held — Video 2 h 19 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q4 · I96iSxbO_TY: Video 1 h 20 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USTXNXLT — FiT-North X-League Tournament: 0 of 46 (unplaced)
- Saturday `h-URuO91CYU`: 0 of 46 held — Video 6 h 6 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q35, M1–M11 · h-URuO91CYU: Video 6 h 6 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USTXNXPM1 — FiT-North X-League PM Meet 1: 0 of 19 (unplaced)
- Saturday `ug2uPuIxEPU`: 0 of 19 held — Video 7 h 53 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
- Saturday `cruHtaD9Yjk`: 0 of 0 held — Video 6 h 46 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
- Saturday `Lj7gniR1_us`: 0 of 0 held — Video 6 h 59 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q19 · ug2uPuIxEPU: Video 7 h 53 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USTXSAOS1 — Queso Bowl: 0 of 39 (unplaced)
- Saturday `tH7n5EtRpSo`: 0 of 39 held — Video 1 h 8 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q28, M1–M9, M9-2, M10 · tH7n5EtRpSo: Video 1 h 8 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USTXSASQ — FiT-Central San Antonio Semi-Regional: 2 of 50 (partial)
- Saturday `DgrBhJC2TIk`: 2 of 50 held
  - Q2–Q8, Q10–Q18 · DgrBhJC2TIk: An early start would open on the match before (starts up to 9 min early)
  - Q19–Q40, M1–M10 · DgrBhJC2TIk: Played after the broadcast ended
### 2025 USTXWAS2 — FIRST in Texas UIL State Championship Division 6A: 5 of 38 (partial)
- Friday `3NF2rp0qZZ0`: 5 of 38 held
  - Q2–Q8, Q10–Q28, M2–M8 · 3NF2rp0qZZ0: An early start would open on the match before (starts up to 9 min early)
### 2025 USTXWAS4ARM — Texas State Cup - Armadillo Division: 34 of 82 (partial)
- Saturday `4EAwgei5pGM`: 0 of 48 held — Video 6 h 20 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
- Sunday `BLSHfiC_E7s`: 34 of 34 held
  - Q1–Q48 · 4EAwgei5pGM: Video 6 h 20 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2025 USTXWAS4MOC — Texas State Cup - Mockingbird Division: 56 of 83 (partial)
- Saturday `Ah9qZy9a55s`: 21 of 48 held
- Sunday `kljjcLXhgwc`: 35 of 35 held
  - Q22–Q48 · Ah9qZy9a55s: Past the part of the video its chapters confirm (to 3 h 2 min into the broadcast)
### 2025 USUTPRQ — Freedom Preparatory Academy Qualifier: 40 of 45 (partial)
- Saturday `6b7-S_nHpso`: 40 of 45 held
  - Q1–Q5 · 6b7-S_nHpso: Played before the broadcast started
### 2025 USWICMP — Wisconsin Championship: 5 of 58 (partial)
- Saturday `0bOFvjFD1DM`: 5 of 58 held
  - Q2–Q24, Q26–Q48, M2–M8 · 0bOFvjFD1DM: An early start would open on the match before (starts up to 10 min early)
### 2024 AUINQ — Brisbane South Qualifier: 0 of 27 (unplaced)
- Day `feez2j_CD3Y`: 0 of 27 held — Video unavailable or private
  - Q1–Q20, M1–M7 · feez2j_CD3Y: Video unavailable or private
### 2024 BRPAS — Sinos Valley Challenge: 0 of 18 (unplaced)
- Day `H4F8WI88Kk4`: 0 of 18 held — Video unavailable or private
  - Q1–Q15, F1–F3 · H4F8WI88Kk4: Video unavailable or private
### 2024 CABCSUQ1 — L.A. Matheson December Qualifier: 0 of 31 (unplaced)
- Saturday `l5pDd2JT9LQ`: 0 of 31 held — Video 26 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q25, M1–M6 · l5pDd2JT9LQ: Video 26 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 CAONSCQ2 — FIRST Tech Challenge North Scarborough Qualifier: 0 of 55 (unplaced)
- Saturday `9dkyWGs-rqY`: 0 of 55 held — Video 6 h 12 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q44, M1–M11 · 9dkyWGs-rqY: Video 6 h 12 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 DECMP — FTC Deutschland-Wettbewerb Oberkochen: 0 of 25 (unplaced)
- Saturday `xWJaJ7EV4lw`: 0 of 25 held — Video 53 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q18, M1–M7 · xWJaJ7EV4lw: Video 53 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 FPECA — Carolinas Premier Event: 31 of 71 (partial)
- Sunday `167irOy-YgY`: 31 of 31 held
- Saturday 2025-07-26: no recording (40 played)
  - Q1–Q40 · no video: No recording for Saturday
### 2024 FPEEUESCH — European Premier Event - Escher Division: 29 of 120 (partial)
- Friday `qoRpJm2UPvU`: 5 of 96 held
- Saturday `_A0fo1DwuGI`: 24 of 24 held
  - Q2–Q3, Q5–Q40, Q43–Q55, Q57–Q96 · qoRpJm2UPvU: An early start would open on the match before (starts up to 5 min early)
### 2024 FPEMITHO — Michiana Premier Event - Thomson Division: 113 of 129 (partial)
- Friday `ZNanuYqENR4`: 19 of 35 held
- Saturday `_VaklXxwE5c`: 80 of 80 held
- Sunday `lHUi_EbEXt4`: 14 of 14 held
  - Q1–Q4, Q7–Q12, Q14–Q17, Q19, Q21 · ZNanuYqENR4: Played before the broadcast started
### 2024 FPERR — Run for the Robots Premier Event: 0 of 2 (unplaced)
- Friday `6ehjHv_pakQ`: 0 of 0 held
- Friday `_RWQvtkDOqQ`: 0 of 0 held
- Saturday `J8nikGM9CSM`: 0 of 2 held — Video 6 h 2 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
- Saturday `_TLJhAsCx7g`: 0 of 0 held — Video 6 h 3 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - F1–F2 · J8nikGM9CSM: Video 6 h 2 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2024 LTCMP — Lithuania Championship: 1 of 47 (partial)
- Saturday `CsNRxpRpGMw`: 1 of 20 held
- Sunday `mlG5suk7oK0`: 0 of 27 held — Video 56 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q2–Q20 · CsNRxpRpGMw: An early start would open on the match before (starts up to 13 min early)
  - Q21–Q40, M1–M7 · mlG5suk7oK0: Video 56 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2024 MDCHS1 — Campionatul National FIRST Tech Challenge R. Moldova: 21 of 46 (partial)
- Sunday `ieQ7Lz5rLvQ`: 21 of 26 held
- Saturday 2025-04-05: no recording (20 played)
  - Q1–Q20 · no video: No recording for Saturday
  - Q21–Q25 · ieQ7Lz5rLvQ: Played before the broadcast started
### 2024 ROSLT — South Romania League Tournament: 60 of 101 (partial)
- Friday `nwwQ8RW_REo`: 15 of 15 held
- Saturday `Opr0k4kNnzs`: 16 of 57 held
- Sunday `-_GXGAMbKEg`: 29 of 29 held
  - Q19, Q21–Q31, Q34–Q35, Q37–Q45, Q47–Q48, Q50–Q51, Q53–Q55, Q57, Q60–Q67, Q69, Q71 · Opr0k4kNnzs: An early start would open on the match before (starts up to 7 min early)
### 2024 TRCMP — Türkiye Championship: 0 of 31 (unplaced)
- Saturday `pHpUCHs_aZc`: 0 of 31 held — Video 56 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q24, M1–M4, M3-2, M5–M6 · pHpUCHs_aZc: Video 56 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 TRISQ1 — Uluslararasi FIRST Tech Challenge 1. Uskudar Turnuvasi: 5 of 56 (partial)
- Friday `Iah9yGJMsZA`: 5 of 37 held
- Saturday 2024-11-30: no recording (19 played)
  - Q2–Q6, Q9–Q19, Q21–Q36 · Iah9yGJMsZA: An early start would open on the match before (starts up to 6 min early)
  - Q38–Q45, M1–M4, M3-2, M5–M10 · no video: No recording for Saturday
### 2024 TRISQ2 — Uluslararasi FIRST Tech Challenge 2. Uskudar Turnuvasi: 0 of 55 (unplaced)
- Saturday `Q6p0L9fTfQk`: 0 of 0 held
- Sunday 2024-12-01: no recording (55 played)
  - Q1–Q44, M1–M11 · no video: No recording for Sunday
### 2024 USALBIQ — UAB Qualifier: 0 of 11 (unplaced)
- Saturday `XA_r9obB_1Y`: 0 of 11 held — Video 15 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q9, F1–F2 · XA_r9obB_1Y: Video 15 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 USALCMP — Alabama Championship: 14 of 45 (partial)
- Saturday `ZHTmO6gyqdE`: 14 of 45 held
  - Q3–Q6, Q8–Q12, Q14–Q19, Q21, Q23–Q26, Q31–Q33, Q35, M2–M8 · ZHTmO6gyqdE: An early start would open on the match before (starts up to 5 min early)
### 2024 USALHUQ1 — HCMS Qualifier: 29 of 33 (partial)
- Saturday `k5bzKFMBGto`: 29 of 33 held
  - Q7, Q15, Q20, M4 · k5bzKFMBGto: An early start would open on the match before (starts up to 4 min early)
### 2024 USARBEQ — FTC Arkansas Battle at Benton: 28 of 29 (partial)
- Saturday `GR9Vxp1hrog`: 28 of 29 held
  - Q1 · GR9Vxp1hrog: Played before the broadcast started
### 2024 USARCMP — Arkansas Championship: 0 of 48 (unplaced)
- Saturday `ExGp4W_r31c`: 0 of 48 held — Video 6 h 1 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q38, M1–M10 · ExGp4W_r31c: Video 6 h 1 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 USARTBQ — FTC Arkansas Mountain Home Mayhem: 17 of 23 (partial)
- Saturday `ZlFWvskQZ1E`: 0 of 0 held — Video 15 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
- Saturday `SNJaneGlFTg`: 0 of 6 held — Video 19 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
- Saturday `-FLIL2JJxos`: 17 of 17 held
  - Q1–Q6 · SNJaneGlFTg: Video 19 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 USAZCHQ1 — Saguaro Blossom - Microchip Qualifier: 14 of 31 (partial)
- Saturday `fbo2kwEWWDo`: 14 of 31 held
  - Q15–Q25, M1–M6 · fbo2kwEWWDo: Past the part of the video its chapters confirm (to 2 h 17 min into the broadcast)
### 2024 USAZCHQ2 — Red Rock - Microchip Qualifier: 0 of 31 (unplaced)
- Saturday `UWlBxfVIJOE`: 0 of 31 held — Video 6 h 16 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q25, M1–M6 · UWlBxfVIJOE: Video 6 h 16 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2024 USAZPEQ — Desert Vista - Peoria Qualifier: 0 of 31 (unplaced)
- Saturday `WOh0_n8H-Gk`: 0 of 31 held — Video 6 h 4 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q25, M1–M6 · WOh0_n8H-Gk: Video 6 h 4 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 USAZTUQ — Diamondback - Tucson Qualifier: 0 of 31 (unplaced)
- Saturday `cT7QmMNtW3s`: 0 of 31 held — Video 16 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q25, M1–M6 · cT7QmMNtW3s: Video 16 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2024 USCALACAS — SoCal FTC League G - Meet 0: 13 of 17 (partial)
- Saturday `jgRLlw92hAk`: 13 of 17 held
  - Q1–Q3 · jgRLlw92hAk: Played before the broadcast started
  - Q17 · jgRLlw92hAk: Played after the broadcast ended
### 2024 USCALADM1 — SoCal FTC League D - Meet 1: 9 of 22 (partial)
- Sunday `59byMzgTa-s`: 9 of 22 held
  - Q4, Q6–Q7, Q10, Q13–Q19, Q21–Q22 · 59byMzgTa-s: An early start would open on the match before (starts up to 5 min early)
### 2024 USCALAGM1 — SoCal FTC League G - Meet 2: 0 of 18 (unplaced)
- Saturday `2PKJiU7_vuQ`: 0 of 18 held — Video 1 h 34 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q18 · 2PKJiU7_vuQ: Video 1 h 34 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 USCALAGM2 — SoCal FTC League G - Meet 1: 0 of 18 (unplaced)
- Saturday `cJYP0zQX8xk`: 0 of 18 held — Video 1 h 52 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q18 · cJYP0zQX8xk: Video 1 h 52 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 USCHSCHQ — Charlottesville VA Qualifier: 6 of 54 (partial)
- Saturday `mMdn3A0kjxY`: 6 of 54 held
  - Q2–Q18, Q20–Q43, M2–M8 · mMdn3A0kjxY: An early start would open on the match before (starts up to 12 min early)
### 2024 USCHSGAQ1 — Glen Allen VA #1 Qualifier: 5 of 52 (partial)
- Saturday `p3TvzUn-B0U`: 5 of 52 held
  - Q2–Q20, Q22–Q42, M2–M8 · p3TvzUn-B0U: An early start would open on the match before (starts up to 9 min early)
### 2024 USCHSGAQ2 — Glen Allen VA #2 Qualifier: 50 of 53 (partial)
- Sunday `qKzaSn6GuzY`: 50 of 53 held
  - M8–M10 · qKzaSn6GuzY: Past the part of the video its chapters confirm (to 6 h 31 min into the broadcast)
### 2024 USCHSMOQ1 — Moorefield WV 2 Qualifier: 0 of 43 (unplaced)
- Day `V0TVS2C3O7Y`: 0 of 43 held — Video unavailable or private
  - Q1–Q33, M1–M10 · V0TVS2C3O7Y: Video unavailable or private
### 2024 USCHSUBQ — Union Bridge MD Qualfier: 0 of 52 (unplaced)
- Saturday `VM3q82Oq06U`: 0 of 52 held — Video 6 h 1 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q42, M1–M10 · VM3q82Oq06U: Video 6 h 1 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2024 USCOCMP — Colorado Championship: 0 of 51 (unplaced)
- Saturday `RTMRdPhIhyg`: 0 of 51 held — Video 2 h 6 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q41, M1–M10 · RTMRdPhIhyg: Video 2 h 6 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 USCODEQ1 — Denver Qualifier: 0 of 44 (unplaced)
- Saturday `QDnMLwRh8Rk`: 0 of 44 held — Video 2 h 4 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q33, M1–M11 · QDnMLwRh8Rk: Video 2 h 4 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2024 USCOLIQ — Southwest Metro Qualifier: 0 of 35 (unplaced)
- Saturday `YGfxomMdDYc`: 0 of 35 held — Video 1 h 36 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q29, M1–M6 · YGfxomMdDYc: Video 1 h 36 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2024 USCOLOQ — Northern Qualifier: 0 of 45 (unplaced)
- Saturday `V-7MpCs5Lls`: 0 of 45 held — Video 2 h 16 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q35, M1–M10 · V-7MpCs5Lls: Video 2 h 16 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2024 USFCTCMP — Four Corners Tribal Teams Championship: 0 of 24 (unplaced)
- Saturday `QAdPOxeqpnk`: 0 of 24 held — Video 3 h 9 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q18, M1–M6 · QAdPOxeqpnk: Video 3 h 9 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2024 USFLFLORLT — Orlando Robotics League Tournament: 0 of 47 (unplaced)
- Saturday `ATO5973RRz0`: 0 of 47 held — Video 4 h 25 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q36, M1–M11 · ATO5973RRz0: Video 4 h 25 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2024 USHICMP — Hawaii Championship: 22 of 31 (partial)
- Sunday `d6EZ4zASZAo`: 22 of 31 held
  - Q23–Q25, M1–M6 · d6EZ4zASZAo: Past the part of the video its chapters confirm (to 1 h 50 min into the broadcast)
### 2024 USHIHI24LT — Hawaii League Tournament: 0 of 39 (unplaced)
- Saturday `n2CgqAvY8SU`: 0 of 39 held — Video 46 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q39 · n2CgqAvY8SU: Video 46 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2024 USHIHI24M5 — League #5 @ Island School: 0 of 17 (unplaced)
- Saturday `Tnai70TlF2E`: 0 of 17 held — Video 51 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q17 · Tnai70TlF2E: Video 51 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 USIAADRLT — Adriatic League Tournament: 0 of 29 (unplaced)
- Day `XLj8WkibVGk`: 0 of 29 held — Video unavailable or private
  - Q1–Q23, M1–M6 · XLj8WkibVGk: Video unavailable or private
### 2024 USIAADRM1 — Adriatic_2024-11-23: 14 of 17 (partial)
- Saturday `BfLhRcM2-j8`: 14 of 17 held
  - Q8, Q11, Q16 · BfLhRcM2-j8: An early start would open on the match before (starts up to 5 min early)
### 2024 USIABALLT — Baltic League Tournament: 0 of 44 (unplaced)
- Saturday `FEoSIhRlU3g`: 0 of 44 held — Video 2 h 56 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q34, M1–M10 · FEoSIhRlU3g: Video 2 h 56 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 USIABALM6 — Baltic_2025-01-18: 0 of 30 (unplaced)
- Saturday `nGgL5NFg4Ec`: 0 of 30 held — Video 1 h 24 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q30 · nGgL5NFg4Ec: Video 1 h 24 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2024 USIACASM5 — Caspian_2024-11-01: 1 of 15 (partial)
- Friday `y-y14blHETg`: 1 of 15 held
  - Q2–Q15 · y-y14blHETg: An early start would open on the match before (starts up to 13 min early)
### 2024 USIACASM6 — Caspian_2024-11-12: 0 of 25 (unplaced)
- Tuesday `Dv1CBwVT8i0`: 0 of 25 held — Video 20 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q25 · Dv1CBwVT8i0: Video 20 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 USIACELM4 — Celtic_2025-01-04: 0 of 23 (unplaced)
- Day `7St39LWtHrY`: 0 of 23 held — Video unavailable or private
  - Q1–Q23 · 7St39LWtHrY: Video unavailable or private
### 2024 USIACORM4 — Coral_2024-11-09: 10 of 30 (partial)
- Saturday `LhY2xCME8yQ`: 10 of 30 held
  - Q3, Q5, Q7–Q10, Q12–Q13, Q15–Q18, Q20–Q21, Q23–Q26, Q29–Q30 · LhY2xCME8yQ: An early start would open on the match before (starts up to 5 min early)
### 2024 USIACORM5 — Coral_2024-11-23: 15 of 27 (partial)
- Saturday `h6F9khoZXUA`: 15 of 27 held
  - Q1–Q3 · h6F9khoZXUA: Played before the broadcast started
  - Q10, Q15, Q17–Q18, Q20–Q22, Q25, Q27 · h6F9khoZXUA: An early start would open on the match before (starts up to 4 min early)
### 2024 USIASARM1 — Sargasso_2024-11-09: 5 of 15 (partial)
- Saturday `efK6N5n4C9Y`: 5 of 15 held
  - Q6–Q15 · efK6N5n4C9Y: Played after the broadcast ended
### 2024 USIATASM1 — Tasman_2024-12-21: 0 of 23 (unplaced)
- Saturday `KM9d-jelHM4`: 0 of 23 held — Video 6 h 8 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q23 · KM9d-jelHM4: Video 6 h 8 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 USIATASM3 — Tasman_2024-11-23: 0 of 24 (unplaced)
- Saturday `MZszQGMrQRQ`: 0 of 24 held — Video 32 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q24 · MZszQGMrQRQ: Video 32 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2024 USIATASM4 — Tasman_2024-11-09: 0 of 17 (unplaced)
- Saturday `KWyukzbNNqA`: 0 of 17 held — Video 26 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q17 · KWyukzbNNqA: Video 26 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 USIATASM6 — Tasman_2025-01-04: 3 of 21 (partial)
- Saturday `FWvSIbzgX2o`: 3 of 21 held
  - Q2–Q12, Q14–Q15, Q17–Q21 · FWvSIbzgX2o: An early start would open on the match before (starts up to 8 min early)
### 2024 USILCCLT1 — Chicago City League Tournament A: 0 of 39 (unplaced)
- Saturday `KjN4RVZ-XhU`: 0 of 39 held — Video 6 h 11 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q29, M1–M10 · KjN4RVZ-XhU: Video 6 h 11 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 USILCSNWLT — Suburban Northwest League Tournament: 5 of 39 (partial)
- Saturday `Fb6gOS1chO4`: 5 of 39 held
  - Q2–Q9, Q11–Q29, M2–M8 · Fb6gOS1chO4: An early start would open on the match before (starts up to 9 min early)
### 2024 USILCSSLT — Suburban South League Tournament: 0 of 44 (unplaced)
- Day `lJunlYy5uls`: 0 of 44 held — Video unavailable or private
  - Q1–Q34, M1–M10 · lJunlYy5uls: Video unavailable or private
### 2024 USMIAVLT — Avondale League Tournament: 0 of 68 (unplaced)
- Saturday `CraHqQLvMrw`: 0 of 68 held — Video 27 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q53, M1–M15 · CraHqQLvMrw: Video 27 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 USMIMDLT — Metro Detroit League Tournament: 0 of 25 (unplaced)
- Saturday `ge63wSvLdWI`: 0 of 25 held — Video 1 h 5 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q18, M1–M7 · ge63wSvLdWI: Video 1 h 5 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2024 USMIROQ — Royal Oak FTC Qualifier: 0 of 55 (unplaced)
- Day `al2d7YPklv8`: 0 of 55 held — Video unavailable or private
  - Q1–Q45, M1–M10 · al2d7YPklv8: Video unavailable or private
### 2024 USMNCMPGLXY — Minnesota FTC State Championship - Galaxy Division: 0 of 66 (unplaced)
- Saturday `crOMKg1SQZU`: 0 of 66 held — Video 4 h 25 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q56, M1–M10 · crOMKg1SQZU: Video 4 h 25 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 USMNCMPNANO — Minnesota FTC State Championship - Nano Division: 15 of 67 (partial)
- Saturday `-2KIKOBaKd0`: 15 of 67 held
  - Q1–Q9 · -2KIKOBaKd0: Played before the broadcast started
  - Q25–Q56, M1–M11 · -2KIKOBaKd0: Past the part of the video its chapters confirm (to 1 h 11 min into the broadcast)
### 2024 USMOKSCMP — Missouri Kansas Championship: 61 of 64 (partial)
- Saturday `9KfDlu4CbkY`: 61 of 64 held
  - Q1–Q3 · 9KfDlu4CbkY: Played before the broadcast started
### 2024 USMOKSSLSQ — Missouri Kansas East Super Qualifier: 6 of 64 (partial)
- Saturday `6XmwpbY--0Y`: 6 of 64 held
  - Q2–Q7, Q9–Q54, M2, M4–M8 · 6XmwpbY--0Y: An early start would open on the match before (starts up to 6 min early)
### 2024 USMSCMP — Mississippi Championship: 0 of 49 (unplaced)
- Saturday `PhI-OnEb7PY`: 0 of 49 held — Video 1 h 24 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q39, M1–M10 · PhI-OnEb7PY: Video 1 h 24 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 USMSGUQ — Gulfport Qualifier: 0 of 23 (unplaced)
- Saturday `JgDEQMy1koA`: 0 of 23 held — Video 6 h 13 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q8, Q10–Q16, Q9, Q17, M1–M6 · JgDEQMy1koA: Video 6 h 13 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2024 USMSMEQ — Meridian Qualifier: 10 of 32 (partial)
- Saturday `NXDKSE8IqlU`: 10 of 32 held
  - Q2–Q10, Q12–Q15, Q17–Q18, Q20–Q21, Q23–Q26, M4 · NXDKSE8IqlU: An early start would open on the match before (starts up to 5 min early)
### 2024 USMSTUQ — Tupelo Qualifier: 29 of 30 (partial)
- Saturday `XUELHF0b_54`: 29 of 30 held
  - Q8 · XUELHF0b_54: An early start would open on the match before (starts up to 4 min early)
### 2024 USNDCMP — North Dakota Championship: 0 of 26 (unplaced)
- Saturday `85TQ8zDMYtk`: 0 of 26 held — Video 3 h 4 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q20, M1–M6 · 85TQ8zDMYtk: Video 3 h 4 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2024 USNYEXBRQ — Broadalbin-Perth Qualifier: 0 of 43 (unplaced)
- Sunday `L4glnbm4VI0`: 0 of 43 held — Video 4 h 52 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q33, M1–M10 · L4glnbm4VI0: Video 4 h 52 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 USNYEXBUQ — Buffalo Qualifier: 0 of 21 (unplaced)
- Sunday `91U9imDl-Mg`: 0 of 21 held — Video 1 h 3 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q14, M1–M7 · 91U9imDl-Mg: Video 1 h 3 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 USNYEXCOQ — Corning Qualifier: 14 of 30 (partial)
- Sunday `GToFNJ0Egac`: 14 of 30 held
  - Q2, Q4–Q5, Q10–Q16, Q18–Q22, M2 · GToFNJ0Egac: An early start would open on the match before (starts up to 7 min early)
### 2024 USNYEXPEQ2 — Finger Lakes Qualifier: 0 of 39 (unplaced)
- Sunday `SydivuNBfoY`: 0 of 39 held — Video 2 h 30 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q29, M1–M10 · SydivuNBfoY: Video 2 h 30 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 USNYLILVQ4 — FIRST Long Island Qualifier #4: 0 of 39 (unplaced)
- Day `8uHWjHocQWc`: 0 of 39 held — Video unavailable or private
  - Q1–Q28, M1–M11 · 8uHWjHocQWc: Video unavailable or private
### 2024 USOHHIQ — Hinckley Academy Qualifier: 0 of 45 (unplaced)
- Day `GWVZydvh9co`: 0 of 45 held — Video has no broadcast clock (an upload, not a live stream)
  - Q1–Q35, M1–M10 · GWVZydvh9co: Video has no broadcast clock (an upload, not a live stream)
### 2024 USOHKIQ — OH Kirtland Robotics Qualifier: 39 of 43 (partial)
- Saturday `VR6c4Ng7FUY`: 39 of 43 held
  - Q1–Q4 · VR6c4Ng7FUY: Played before the broadcast started
### 2024 USOHNEOHLT — NEOH Aurora League Tournament: 7 of 25 (partial)
- Sunday `F2OE_HsHA1Q`: 7 of 25 held
  - Q2–Q8, Q10, Q12–Q19, M2, M4 · F2OE_HsHA1Q: An early start would open on the match before (starts up to 4 min early)
### 2024 USOKTUS2 — Super Bowl Sunday Scrimmage: 0 of 14 (unplaced)
- Sunday `MAeWCNZBfvg`: 0 of 14 held — Video 1 h 52 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q14 · MAeWCNZBfvg: Video 1 h 52 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 USORPHQ — Spark Invitational: 47 of 54 (partial)
- Sunday `-nM7QVIlNwU`: 8 of 15 held
- Sunday · Awards `C3ZYyvHYiTg`: 39 of 39 held
  - Q1 · -nM7QVIlNwU: Played before the broadcast started
  - Q10–Q15 · -nM7QVIlNwU: Played after the broadcast ended
### 2024 USORRCLT — Rose City League Tournament: 0 of 29 (unplaced)
- Saturday `bIL6YGYGbPk`: 0 of 29 held — Video 2 h 28 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q23, M1–M6 · bIL6YGYGbPk: Video 2 h 28 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2024 USORSOLT — SOAR League Tournament: 0 of 26 (unplaced)
- Day `GXxgKOSDZ-g`: 0 of 26 held — Video unavailable or private
  - Q1–Q20, M1–M6 · GXxgKOSDZ-g: Video unavailable or private
### 2024 USORSOM1 — SOAR League Meet 1: 15 of 23 (partial)
- Saturday `iW3dh6qGaSE`: 15 of 23 held
  - Q5, Q7–Q8, Q13, Q17–Q18, Q21–Q22 · iW3dh6qGaSE: An early start would open on the match before (starts up to 4 min early)
### 2024 USORSOM2 — SOAR League Meet 2: 11 of 23 (partial)
- Saturday `neHlobPVL6U`: 11 of 23 held
  - Q3–Q4, Q6, Q8, Q10, Q12–Q13, Q15, Q17, Q20–Q21, Q23 · neHlobPVL6U: An early start would open on the match before (starts up to 5 min early)
### 2024 USORSOM3 — SOAR League Meet 3: 0 of 24 (unplaced)
- Saturday `neHlobPVL6U`: 0 of 0 held
- Saturday 2025-01-11: no recording (24 played)
  - Q1–Q24 · no video: No recording for Saturday
### 2024 USPACMP — Pennsylvania Championship: 54 of 60 (partial)
- Saturday `Z5MjxPQa8gg`: 4 of 10 held
- Sunday `Fyw1bFXtSLo`: 50 of 50 held
  - Q2, Q4, Q7–Q10 · Z5MjxPQa8gg: An early start would open on the match before (starts up to 3 min early)
### 2024 USPALAQ1 — Lancaster Area Qualifier: 44 of 50 (partial)
- Saturday `J8NVkH2mYPM`: 44 of 49 held
  - Q1–Q5 · J8NVkH2mYPM: Played before the broadcast started
  - M2 · no video: No real start time from FIRST
### 2024 USPAUCQ2 — Panther Power Qualifier: 0 of 50 (unplaced)
- Sunday `PMWbWp99goY`: 0 of 50 held — Video 21 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q38, M1–M7, M6-2, M8–M11 · PMWbWp99goY: Video 21 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2024 USTXCALT1 — FiT-Central North San Antonio & Hill Country League Tournament: 1 of 52 (partial)
- Saturday `qBEw661kTGw`: 1 of 52 held
  - Q2–Q12 · qBEw661kTGw: An early start would open on the match before (starts up to 13 min early)
  - Q13–Q42, M1–M10 · qBEw661kTGw: Played after the broadcast ended
### 2024 USTXCAM1 — FiT-Central Hill Country League Meet 1: 25 of 26 (partial)
- Saturday `URvygjzZpY4`: 25 of 26 held
  - Q1 · URvygjzZpY4: Played before the broadcast started
### 2024 USTXCCOS1 — FIRST in Texas Buc Days Robotics Rodeo: 0 of 59 (unplaced)
- Saturday `vyDYFrqgMTU`: 0 of 59 held — Video 6 h 3 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q9, Q11–Q49, Q10, M1–M10 · vyDYFrqgMTU: Video 6 h 3 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 USTXDAQ — FiT-North Semi-Area Championship Whiterock Waters: 0 of 49 (unplaced)
- Saturday `SqUbpJvDmNE`: 0 of 49 held — Video 6 h 4 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q38, M1–M11 · SqUbpJvDmNE: Video 6 h 4 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 USTXDTQ2 — FiT-North Winter Charger Qualifier: 26 of 46 (partial)
- Saturday `5jNwwB2YuTU`: 26 of 46 held
  - Q1–Q20 · 5jNwwB2YuTU: Played before the broadcast started
### 2024 USTXFMQ — FiT-North Semi-Area Championship Lago Lewisville: 0 of 53 (unplaced)
- Saturday `YxnA2KwxeAU`: 0 of 53 held — Video 6 h 39 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q42, M1–M11 · YxnA2KwxeAU: Video 6 h 39 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 USTXNAM3 — FiT-North A-League Meet 3: 22 of 24 (partial)
- Saturday `mb4mJLsvuhY`: 22 of 24 held
  - Q1–Q2 · mb4mJLsvuhY: Played before the broadcast started
### 2024 USTXNEM1 — FiT-North E-League Meet 1: 0 of 15 (unplaced)
- Saturday `l5cf4uSuEK8`: 0 of 15 held — Video 8 h 47 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q15 · l5cf4uSuEK8: Video 8 h 47 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 USTXNEM2 — FiT-North E-League Meet 2: 0 of 17 (unplaced)
- Saturday `ME3VNEMbklM`: 0 of 17 held — Video 3 h 46 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q17 · ME3VNEMbklM: Video 3 h 46 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 USTXNFM1 — FiT-North F-League Meet 1: 0 of 27 (unplaced)
- Saturday `sP4gnwEf8wc`: 0 of 27 held — Video 3 h 35 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q27 · sP4gnwEf8wc: Video 3 h 35 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2024 USTXNFM2 — FiT-North F-League Meet 2: 0 of 27 (unplaced)
- Saturday `GH_0IYIK3Ss`: 0 of 27 held — Video 2 h 28 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q27 · GH_0IYIK3Ss: Video 2 h 28 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2024 USTXNGM1 — FiT-North G-League Meet 1: 0 of 32 (unplaced)
- Saturday `qUEfXSG9D1E`: 0 of 32 held — Video 2 h 23 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q32 · qUEfXSG9D1E: Video 2 h 23 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 USTXNNM2 — FiT-North N-League Meet 2: 0 of 15 (unplaced)
- Saturday `Q-wN7z903UE`: 0 of 15 held — Video 1 h 2 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q15 · Q-wN7z903UE: Video 1 h 2 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 USTXNSM2 — FiT-North S-League Meet 2: 21 of 24 (partial)
- Saturday `zZ36AlutIyg`: 21 of 24 held
  - Q10–Q11, Q16 · zZ36AlutIyg: An early start would open on the match before (starts up to 4 min early)
### 2024 USTXNTM1 — FiT-North T-League Meet 1: 9 of 14 (partial)
- Saturday `2NNPENepHnQ`: 9 of 14 held
  - Q1–Q5 · 2NNPENepHnQ: Played before the broadcast started
### 2024 USTXNXLT — FiT-North X**2 Tournament: 0 of 52 (unplaced)
- Saturday `aUyKCGAdW70`: 0 of 52 held — Video 6 h 7 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
- Saturday `3rxYgUti63A`: 0 of 0 held — Video 6 h 3 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
- Saturday `iPNkwYQX-aA`: 0 of 0 held — Video 6 h 10 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q42, M1–M10 · aUyKCGAdW70: Video 6 h 7 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 USTXTBSQJB — FiT-Central Regional Championship - Jocelyn Burnell Division: 9 of 40 (partial)
- Saturday `hxWqkLAuVAY`: 9 of 40 held
  - Q2–Q5, Q7, Q9–Q10, Q12–Q13, Q15, Q17–Q21, Q23–Q29, M2 · hxWqkLAuVAY: An early start would open on the match before (starts up to 3 min early)
  - M3–M10 · hxWqkLAuVAY: Played after the broadcast ended
### 2024 USTXTBSQLM — FiT-Central Regional Championship - Lise Meitner Division: 0 of 42 (unplaced)
- Saturday `ML6T8T1g_1s`: 0 of 42 held — Video 55 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q30, M1–M7, M6-2, M8–M11 · ML6T8T1g_1s: Video 55 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2024 USUTSAS — Beehive Academy Checkpoint Scrimmage: 12 of 13 (partial)
- Saturday `YVhwlspNlK4`: 12 of 13 held
  - Q1 · YVhwlspNlK4: Played before the broadcast started
### 2024 USWAREOS — West Coast Invitational: 0 of 32 (unplaced)
- Sunday `BpHrIvG6UH4`: 0 of 32 held — Video 20 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q26, M1–M6 · BpHrIvG6UH4: Video 20 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2024 USWIBRQ1 — Battle of Brookfield: 38 of 43 (partial)
- Saturday `cKuToMM0USo`: 38 of 43 held
  - M7–M8, M8-2, M9–M10 · cKuToMM0USo: Past the part of the video its chapters confirm (to 6 h 53 min into the broadcast)
### 2024 USWIGRQ — Thumb Wars: 27 of 33 (partial)
- Saturday `m5RXr-tw_ZE`: 27 of 33 held
  - M1–M6 · m5RXr-tw_ZE: Played after the broadcast ended
### 2024 USWIMAQ2 — Lakeshore Qualifier: 0 of 43 (unplaced)
- Saturday `MvovtDPoHlY`: 0 of 43 held — Video 16 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q33, M1–M10 · MvovtDPoHlY: Video 16 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2024 USWISHQ — Showdown in Sheboygan: 24 of 42 (partial)
- Saturday `_VqYWOU1aCM`: 24 of 42 held
  - Q1–Q18 · _VqYWOU1aCM: Played before the broadcast started
### 2023 CABCCMP — British Columbia FTC Championships: 6 of 36 (partial)
- Saturday `37Acem0J7Hg`: 0 of 0 held — Video 3 h 23 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
- Sunday `qKPNWgTD16E`: 6 of 36 held
  - Q2–Q10, Q12–Q22, Q24–Q30, M2, M1-2, M2-2 · qKPNWgTD16E: An early start would open on the match before (starts up to 9 min early)
### 2023 CABCSUQ — BC Lower Mainland FTC Qualifier: 0 of 36 (unplaced)
- Saturday `n_9vZ3Re2Rw`: 0 of 36 held — Video 47 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
- Saturday `JS4AZYr9FXg`: 0 of 0 held
  - Q1–Q28, M1–M2, M1-2, M2-2, M2-3, F1–F3 · n_9vZ3Re2Rw: Video 47 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2023 CABCVAS1 — BC Lower Mainland Scrimmage 1: 0 of 14 (unplaced)
- Saturday `qOghLjIeTnA`: 0 of 14 held — Video 1 h 14 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q14 · qOghLjIeTnA: Video 1 h 14 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 CAONTOQ1 — ON FIRST Tech Challenge North Scarborough Qualifier: 0 of 51 (unplaced)
- Sunday `eRJVXAxHB8A`: 0 of 51 held — Video 2 h 4 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q43, M1–M2, M1-2, M2-2, M1-3, M2-3, F1–F2 · eRJVXAxHB8A: Video 2 h 4 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2023 ROCMP — Romania Campionatul National FTC 070000: 55 of 97 (partial)
- Friday `6JC-hA79oAk`: 20 of 20 held
- Saturday `E4mACwlmdeM`: 13 of 55 held
- Sunday `IB37N1WITXU`: 22 of 22 held
  - Q22–Q23, Q25, Q27, Q29–Q31, Q34–Q40, Q42–Q50, Q52–Q54, Q56–Q60, Q62–Q63, Q65–Q67, Q70–Q75 · E4mACwlmdeM: An early start would open on the match before (starts up to 7 min early)
### 2023 RONR1LT — RO #1BUCURESTI 070000: 22 of 83 (partial)
- Saturday `bH0EUgKtuJM`: 22 of 62 held
- Sunday `omLSKv6O9GM`: 0 of 21 held — Video 42 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q2–Q6, Q9, Q11, Q13, Q15–Q16, Q19–Q22, Q25–Q26, Q28–Q29, Q31–Q32, Q35–Q39, Q41–Q42, Q44–Q45, Q47–Q51, Q53, Q55, Q57–Q59, Q62 · bH0EUgKtuJM: An early start would open on the match before (starts up to 5 min early)
  - Q63–Q75, M1–M2, M1-2, M2-2, M2-3, M1-3, F1–F2 · omLSKv6O9GM: Video 42 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 RONR4LT — RO #4 IASI 070000: 30 of 79 (partial)
- Saturday `jDzVQgJdEpc`: 30 of 60 held
- Sunday 2024-03-10: no recording (19 played)
  - Q3, Q5, Q9, Q11, Q17, Q20, Q22–Q23, Q25–Q28, Q30–Q34, Q36, Q39–Q43, Q45, Q47, Q49, Q51, Q57–Q58, Q60 · jDzVQgJdEpc: An early start would open on the match before (starts up to 4 min early)
  - Q61–Q72, M1–M2, M1-2, M2-2, M2-3, F1–F2 · no video: No recording for Sunday
### 2023 USALHUS2 — AL Cup #2: 0 of 34 (unplaced)
- Saturday `QjMT2acNIl0`: 0 of 34 held — Video 41 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q27, M1–M2, M1-2, M2-2, F1–F3 · QjMT2acNIl0: Video 41 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2023 USARCMP — Arkansas FTC Championship: 0 of 35 (unplaced)
- Saturday `Kmg3tdIHElo`: 0 of 35 held — Video 6 h 7 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q29, M1–M2, M1-2, M2-2, F1–F2 · Kmg3tdIHElo: Video 6 h 7 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USAZCHQ — AZ Red Rock - Microchip Qualifier: 0 of 35 (unplaced)
- Saturday `hINDJv2q0Tg`: 0 of 35 held — Video 2 h 56 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q29, M1–M2, M1-2, M2-2, F1–F2 · hINDJv2q0Tg: Video 2 h 56 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2023 USAZCMPGC1 — Arizona Championship - Grand Canyon Division: 0 of 45 (unplaced)
- Saturday `VaNMEkolveQ`: 0 of 45 held — Video 6 h 14 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q36, M1, M1-2, M2, M1-3, M2-2, M2-3, F1–F3 · VaNMEkolveQ: Video 6 h 14 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USAZCMPSG1 — Arizona Championship - Saguaro Division: 0 of 43 (unplaced)
- Saturday `1y_yCO20m7s`: 0 of 42 held — Video 6 h 14 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q9, Q11–Q36, M1–M2, M1-2, M2-2, M2-3, F1–F2 · 1y_yCO20m7s: Video 6 h 14 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q10 · no video: No real start time from FIRST
### 2023 USAZFLQ — AZ High Country - Flagstaff Qualifier: 0 of 24 (unplaced)
- Saturday `6yAwDyVNCSM`: 0 of 24 held — Video 6 h 2 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q17, M1–M2, M1-2, M2-2, F1–F3 · 6yAwDyVNCSM: Video 6 h 2 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USAZGIQ — AZ Roadrunner - Gilbert Qualifier: 0 of 38 (unplaced)
- Saturday `cndGPR2HzNk`: 0 of 38 held — Video 6 h 18 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
- Saturday `g8mAqKbT1Zg`: 0 of 0 held — Video 6 h 12 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q32, M1–M2, M1-2, M2-2, F1–F2 · cndGPR2HzNk: Video 6 h 18 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USAZGLQ — AZ Valley of the Sun Qualifier - Glendale: 0 of 41 (unplaced)
- Saturday `LLDkhflfVOs`: 0 of 41 held — Video 6 h 5 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q35, M1–M2, M1-2, M2-2, F1–F2 · LLDkhflfVOs: Video 6 h 5 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USAZSLQ — AZ White Mountain - Show Low Qualifier: 0 of 25 (unplaced)
- Saturday `g8mAqKbT1Zg`: 0 of 25 held — Video 6 h 12 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q18, M1–M2, M1-2, M2-2, M2-3, F1–F2 · g8mAqKbT1Zg: Video 6 h 12 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USAZTSQ — AZ Dine' College - Tsalie Qualifier: 0 of 23 (unplaced)
- Saturday `hINDJv2q0Tg`: 0 of 23 held — Video 2 h 56 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q14, M1–M2, M1-2, M2-2, M1-3, M2-3, F1–F3 · hINDJv2q0Tg: Video 2 h 56 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2023 USAZTUQ — AZ Diamondback - Tucson Qualifier: 0 of 29 (unplaced)
- Saturday `v4D-KvNFLoY`: 0 of 29 held — Video 28 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q22, M1–M2, M1-2, M2-2, F1–F3 · v4D-KvNFLoY: Video 28 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USCODEQ — CO Central Qualifier: 0 of 34 (unplaced)
- Saturday `GyPg5PsPUb0`: 0 of 34 held — Video 2 h 44 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q21, Q23–Q27, Q22, M1–M2, M1-2, M2-2, M2-3, F1–F2 · GyPg5PsPUb0: Video 2 h 44 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2023 USCOSEQ — CO Severance Qualifier: 0 of 41 (unplaced)
- Saturday `Roz9dI31RQ4`: 0 of 41 held — Video 3 h 26 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q35, M1–M2, M1-2, M2-2, F1–F2 · Roz9dI31RQ4: Video 3 h 26 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USIAAHM2 — IA Warhol_2023-11-11: 0 of 21 (unplaced)
- Saturday `C_tDo1kdzHI`: 0 of 21 held — Video 37 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q21 · C_tDo1kdzHI: Video 37 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USIAAHM6 — IA Warhol_2024-01-06: 0 of 18 (unplaced)
- Saturday `_f5ZqUCUJnw`: 0 of 18 held — Video 6 h 27 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q18 · _f5ZqUCUJnw: Video 6 h 27 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USIACMPBLAC — Iowa Championship - Black Division: 18 of 60 (partial)
- Friday `ifxX9isdYaE`: 9 of 9 held
- Saturday `5aKb-Qz8b7Y`: 9 of 51 held
  - Q11–Q24, Q26–Q35, Q37–Q42, Q45–Q53, M2, M1-2, M2-2 · 5aKb-Qz8b7Y: An early start would open on the match before (starts up to 7 min early)
### 2023 USIACMPGOLD — Iowa Championship - Gold Division: 9 of 61 (partial)
- Friday `EW_wMxRKbZA`: 9 of 9 held
- Saturday `9qx_zB2JC28`: 0 of 52 held — Video 1 h 6 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q10–Q54, M1–M2, M1-2, M2-2, F1–F3 · 9qx_zB2JC28: Video 1 h 6 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2023 USIAESM2 — IA Savage_2023-11-11: 2 of 12 (partial)
- Saturday `39qICus-Hyo`: 0 of 0 held
- Saturday `5TUvwmkfFNs`: 2 of 12 held
  - Q2–Q8, Q10–Q12 · 5TUvwmkfFNs: An early start would open on the match before (starts up to 13 min early)
### 2023 USIAESM4 — IA Savage_2023-12-09: 0 of 12 (unplaced)
- Saturday `zEbwk_fW-2Y`: 0 of 12 held — Video 11 h 46 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q12 · zEbwk_fW-2Y: Video 11 h 46 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USIAGWM7 — IA Wood_2023-11-14: 0 of 20 (unplaced)
- Day `HgpnYrXQoG4`: 0 of 20 held — Video unavailable or private
  - Q1–Q20 · HgpnYrXQoG4: Video unavailable or private
### 2023 USIAJPM4 — IA Pollock_2023-12-02: 2 of 30 (partial)
- Saturday `FHBsDuKApcU`: 2 of 30 held
  - Q2–Q15, Q17–Q30 · FHBsDuKApcU: An early start would open on the match before (starts up to 11 min early)
### 2023 USIAMCM1 — IA Cassatt_2023-10-21: 19 of 20 (partial)
- Saturday `Nxb2e6Iop3U`: 19 of 20 held
  - Q1 · Nxb2e6Iop3U: Played before the broadcast started
### 2023 USIAMCM2 — IA Cassatt_2023-12-09: 0 of 27 (unplaced)
- Saturday `1LwcoZsB2wQ`: 0 of 27 held — Video 24 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q27 · 1LwcoZsB2wQ: Video 24 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USIAMCM3 — IA Cassatt_2023-11-04: 0 of 17 (unplaced)
- Saturday `o8_E0OEybIg`: 0 of 17 held — Video 4 h shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q17 · o8_E0OEybIg: Video 4 h shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USIAMCM4 — IA Cassatt_2023-11-18: 0 of 32 (unplaced)
- Saturday `dDz1KsxcQ_I`: 0 of 32 held — Video 53 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q32 · dDz1KsxcQ_I: Video 53 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USMSBRQ — MS Brandon Qualifier: 0 of 21 (unplaced)
- Saturday `XXhAvJFhmZQ`: 0 of 21 held — Video 6 h 12 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q15, M1–M2, M1-2, M2-2, F1–F2 · XXhAvJFhmZQ: Video 6 h 12 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USMSCMP — Mississippi FTC Championship: 20 of 43 (partial)
- Saturday `nBGjl01zpx0`: 20 of 43 held
  - Q21–Q36, M1–M2, M1-2, M2-2, F1–F3 · nBGjl01zpx0: Past the part of the video its chapters confirm (to 2 h 26 min into the broadcast)
### 2023 USMSGRQ — MS Grenada Qualifier: 0 of 31 (unplaced)
- Saturday `tMlh81UbvjA`: 0 of 31 held — Video 26 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q24, M1–M2, M1-2, M2-2, F1–F3 · tMlh81UbvjA: Video 26 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USMSMEQ — MS Meridian Qualifier: 0 of 38 (unplaced)
- Saturday `T1UZ47iyzvY`: 0 of 38 held — Video 5 h 50 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q30, M1–M2, M1-2, M2-2, M1-3, M2-3, F1–F2 · T1UZ47iyzvY: Video 5 h 50 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USMSTUQ — MS Tupelo Qualifier: 0 of 21 (unplaced)
- Saturday `K-WJpGSwPIQ`: 0 of 21 held — Video 7 h 17 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q15, M1–M2, M1-2, M2-2, F1–F2 · K-WJpGSwPIQ: Video 7 h 17 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USMSWEQ — MS Wesson Qualifier: 14 of 27 (partial)
- Saturday `0Jz0DDaRoYQ`: 14 of 27 held
  - Q5, Q9–Q10, Q12–Q15, Q18, Q20–Q21, M2, M1-2, M2-2 · 0Jz0DDaRoYQ: An early start would open on the match before (starts up to 6 min early)
### 2023 USMSWVS — MS Water Valley Build-it Day/Scrimmage: 0 of 5 (unplaced)
- Day `klh56VgKDmE`: 0 of 5 held — Video unavailable or private
  - Q1–Q5 · klh56VgKDmE: Video unavailable or private
### 2023 USNYEXCMP — New York-Excelsior MVCC Utica Championship: 15 of 41 (partial)
- Sunday `6FYgFdWOp-I`: 15 of 41 held
  - Q4–Q5, Q7, Q10–Q14, Q17–Q18, Q22 · 6FYgFdWOp-I: An early start would open on the match before (starts up to 3 min early)
  - Q27–Q35, M1–M2, M1-2, M2-2, F1–F2 · 6FYgFdWOp-I: Played after the broadcast ended
### 2023 USNYEXHJQ — NY-Excelsior John Jay Qualifier: 0 of 34 (unplaced)
- Saturday `3j-cfbfsHts`: 0 of 34 held — Video 19 h 45 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q28, M1–M2, M1-2, M2-2, F1–F2 · 3j-cfbfsHts: Video 19 h 45 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USTXATQ — FiT-North Semi-Area Championship Stage Left: 0 of 46 (unplaced)
- Saturday `PDweBtsQxLU`: 0 of 46 held — Video 40 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q39, M1–M2, M1-2, M2-2, F1–F3 · PDweBtsQxLU: Video 40 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USTXBES — Texas FTC UIL 1A-4A State Championship: 0 of 37 (unplaced)
- Thursday `3_HS9P5L7Rk`: 0 of 37 held — Video 6 h 4 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q30, M1–M2, M1-2, M2-2, M1-3, F1–F2 · 3_HS9P5L7Rk: Video 6 h 4 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USTXBES1 — Texas FTC UIL 6A State Championship: 0 of 35 (unplaced)
- Thursday `IPbPxAvc_IE`: 0 of 35 held — Video 6 h 3 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q29, M1–M2, M1-2, M2-2, F1–F2 · IPbPxAvc_IE: Video 6 h 3 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USTXBES2 — Texas FTC UIL 5A State Championship: 0 of 35 (unplaced)
- Thursday `0EIinb4GzEU`: 0 of 35 held — Video 6 h 3 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q29, M1–M2, M1-2, M2-2, F1–F2 · 0EIinb4GzEU: Video 6 h 3 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USTXCMPJOHN — Texas FTC State Championship - Johnson Division: 12 of 62 (partial)
- Friday `mSasFa-SFqc`: 0 of 36 held — Video 55 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
- Saturday `C-UaF9Djwrw`: 12 of 26 held
  - Q1–Q36 · mSasFa-SFqc: Video 55 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q37–Q39 · C-UaF9Djwrw: Played before the broadcast started
  - Q52–Q54, M1–M2, M1-2, M2-2, M2-3, F1–F3 · C-UaF9Djwrw: Past the part of the video its chapters confirm (to 1 h 4 min into the broadcast)
### 2023 USTXCMPTESL — Texas FTC State Championship - Tesla Division: 0 of 60 (unplaced)
- Friday `G5B-lXak1IA`: 0 of 36 held — Video 1 h shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
- Saturday `sT6YS3t9kI4`: 0 of 24 held — Video 6 h 10 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q36 · G5B-lXak1IA: Video 1 h shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q37–Q54, M1–M2, M1-2, M2-2, F1–F2 · sT6YS3t9kI4: Video 6 h 10 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2023 USTXFMQ — FiT-North Last Call Qualifier: 0 of 42 (unplaced)
- Saturday `bX0x7aod65s`: 0 of 42 held — Video 6 h 8 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q35, M1–M2, M1-2, M2-2, F1–F3 · bX0x7aod65s: Video 6 h 8 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USTXMISQ — FiT-South Area Championship: 0 of 58 (unplaced)
- Saturday `4xMY1g0leoM`: 0 of 58 held — Video 6 h 15 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q50, M1–M2, M1-2, M2-2, M1-3, F1–F3 · 4xMY1g0leoM: Video 6 h 15 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USTXNBM1 — FiT-North B-League Meet 1: 11 of 20 (partial)
- Saturday `8zigks43Mpg`: 11 of 20 held
  - Q1–Q9 · 8zigks43Mpg: Played before the broadcast started
### 2023 USTXNBM3 — FiT-North B-League Meet 3: 0 of 20 (unplaced)
- Saturday `xD2TS393LV4`: 0 of 20 held — Video 1 h 1 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q20 · xD2TS393LV4: Video 1 h 1 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USTXNCM2 — FiT-North C-League Meet 2: 0 of 20 (unplaced)
- Saturday `YnZtWtqHtvQ`: 0 of 20 held — Video 6 h 5 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q20 · YnZtWtqHtvQ: Video 6 h 5 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USTXNEM3 — FiT-North E-League Meet 3: 0 of 11 (unplaced)
- Saturday `yZXtVGsoM6s`: 0 of 11 held — Video 49 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q11 · yZXtVGsoM6s: Video 49 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USTXNFM1 — FiT-North F-League Meet 1: 0 of 22 (unplaced)
- Saturday `Wo7mG83ukhM`: 0 of 22 held — Video 4 h 54 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q22 · Wo7mG83ukhM: Video 4 h 54 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USTXNMM1 — FiT-North M-League Meet 1: 0 of 19 (unplaced)
- Saturday `Zkt5ZTJuc1Y`: 0 of 19 held — Video 3 h 16 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q19 · Zkt5ZTJuc1Y: Video 3 h 16 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2023 USTXNMM2 — FiT-North M-League Meet 2: 0 of 19 (unplaced)
- Saturday `w4jMUXNIdIA`: 0 of 19 held — Video 6 h 32 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q19 · w4jMUXNIdIA: Video 6 h 32 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USTXNMM3 — FiT-North M-League Meet 3: 0 of 20 (unplaced)
- Saturday `IEP9GdqipUA`: 0 of 20 held — Video 37 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q20 · IEP9GdqipUA: Video 37 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USTXNNM2 — FiT-North N-League Meet 2: 13 of 17 (partial)
- Saturday `G4YAZEzR35o`: 13 of 17 held
  - Q14–Q17 · G4YAZEzR35o: Past the part of the video its chapters confirm (to 2 h 47 min into the broadcast)
### 2023 USTXNNM3 — FiT-North N-League Meet 3: 14 of 17 (partial)
- Saturday `8pCNLDm67aQ`: 14 of 17 held
  - Q1–Q3 · 8pCNLDm67aQ: Played before the broadcast started
### 2023 USTXNTM3 — FiT-North T-League Meet 3: 0 of 22 (unplaced)
- Saturday `ep65nA1pdyo`: 0 of 22 held — Video 23 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q22 · ep65nA1pdyo: Video 23 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USWAEDOS — WA West Coast Invitational: 0 of 32 (unplaced)
- Sunday `PR8nQE93TQw`: 0 of 32 held — Video 4 h 20 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q25, M1–M2, M1-2, M2-2, F1–F3 · PR8nQE93TQw: Video 4 h 20 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2023 USWIHAQ — WI Knack Attack: 7 of 25 (partial)
- Saturday `_hIEhqBKKnI`: 7 of 25 held
  - Q2, Q4–Q8, Q10–Q18, M2, M1-2, M2-2 · _hIEhqBKKnI: An early start would open on the match before (starts up to 8 min early)
### 2022 CABCVAS2 — BC Vancouver Scrimmage 2: 0 of 10 (unplaced)
- Sunday `0k88Q8IfErY`: 0 of 10 held — Video 6 h 20 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q10 · 0k88Q8IfErY: Video 6 h 20 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2022 CABCVIQ — BC Victoria Qualifier: 0 of 22 (unplaced)
- Saturday `Y0yrKRUpcJo`: 0 of 22 held — Video 20 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
- Saturday `TUFDPEuJSpM`: 0 of 0 held — Video 6 h 16 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q15, M1–M2, M1-2, M2-2, F1–F3 · Y0yrKRUpcJo: Video 20 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2022 ROBUQ1 — RO BUCHAREST #1 - FTC Romania Qualifying Tournament: 19 of 130 (partial)
- Monday `683mSjligL0`: 11 of 11 held
- Tuesday `W9LsNYGAtPM`: 0 of 84 held — Video 24 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
- Wednesday `JXi2ZKTiZ4c`: 8 of 35 held
  - Q12–Q95 · W9LsNYGAtPM: Video 24 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q97–Q110, Q112–Q122, M2, M2-2 · JXi2ZKTiZ4c: An early start would open on the match before (starts up to 6 min early)
### 2022 ROBUQ2 — RO BUCHAREST #2 - FTC ROMANIA QUALIFYING TOURNAMENT: 41 of 132 (partial)
- Friday `T5D0GMMhTZw`: 24 of 24 held
- Saturday `ksvPRJRbu3s`: 13 of 79 held
- Sunday `DCr1GSWOzEI`: 4 of 29 held
  - Q26–Q30, Q32–Q46, Q48–Q56, Q58–Q59, Q61–Q66, Q68–Q69, Q71–Q72, Q74–Q75, Q77–Q78, Q81–Q87, Q89–Q100, Q102–Q103 · ksvPRJRbu3s: An early start would open on the match before (starts up to 4 min early)
  - Q105–Q125, M2, M1-2, M2-2, M1-3 · DCr1GSWOzEI: An early start would open on the match before (starts up to 10 min early)
### 2022 USAZCMP — Arizona FIRST Tech Challenge Championship: 0 of 3 (unplaced)
- Saturday `-ZumNQnxvnU`: 0 of 3 held — Video 6 h 9 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
- Saturday `iWoYX5kF9xo`: 0 of 0 held — Video 6 h 10 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - F1–F3 · -ZumNQnxvnU: Video 6 h 9 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2022 USAZCMPGC23 — Arizona FIRST Tech Challenge Championship - Grand Canyon Division: 0 of 37 (unplaced)
- Saturday `-ZumNQnxvnU`: 0 of 37 held — Video 6 h 9 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q30, M1–M2, M1-2, M2-2, M1-3, F1–F2 · -ZumNQnxvnU: Video 6 h 9 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2022 USAZCMPSG23 — Arizona FIRST Tech Challenge Championship - Saguaro Division: 0 of 37 (unplaced)
- Saturday `iWoYX5kF9xo`: 0 of 37 held — Video 6 h 10 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q2, Q4–Q15, Q3, Q16–Q30, M1–M2, M1-2, M2-2, F1–F3 · iWoYX5kF9xo: Video 6 h 10 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2022 USAZGLQ — AZ Cactus - Anthem Qualifier: 32 of 35 (partial)
- Saturday `SIrsN45NDkg`: 29 of 32 held
- Saturday `SYwaPaAbD3U`: 3 of 3 held
  - M1–M2, F2 · SIrsN45NDkg: Played after the broadcast ended
### 2022 USIACHLT — IA Chemical League Tournament: 0 of 31 (unplaced)
- Saturday `PNTYp-HlQHY`: 0 of 31 held — Video 6 h 29 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q24, M1–M2, M1-2, M2-2, M1-3, F1–F2 · PNTYp-HlQHY: Video 6 h 29 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2022 USIACHM3 — IA Chemical_Meet_2022-11-12: 0 of 22 (unplaced)
- Saturday `jNZcjn8JAag`: 0 of 22 held — Video 25 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q22 · jNZcjn8JAag: Video 25 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2022 USIANOSQ — IA Central Iowa Super Qualifier: 0 of 43 (unplaced)
- Saturday `_02vKPUsJUA`: 0 of 43 held — Video 6 h 12 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q36, M1–M2, M1-2, M2-2, F1–F3 · _02vKPUsJUA: Video 6 h 12 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2022 USIASOM2 — IA Solar_Meet_2022-12-17: 5 of 26 (partial)
- Saturday `ym7HUlwd76k`: 5 of 26 held
  - Q3–Q8, Q10–Q13, Q16–Q26 · ym7HUlwd76k: An early start would open on the match before (starts up to 6 min early)
### 2022 USIAWIM7 — IA Wind_Meet_2022-11-19: 21 of 24 (partial)
- Saturday `4DIpuVlm0hY`: 21 of 24 held
  - Q12–Q13, Q19 · 4DIpuVlm0hY: An early start would open on the match before (starts up to 4 min early)
### 2022 USMSCMP — Mississippi Championship: 28 of 33 (partial)
- Saturday `YwMY0xTIdKk`: 28 of 33 held
  - Q1–Q5 · YwMY0xTIdKk: Played before the broadcast started
### 2022 USMSGRQ3 — MS Grenada Qualifier: 6 of 21 (partial)
- Saturday `zXX1AWhNKgo`: 6 of 21 held
  - Q1–Q3, Q5–Q6, Q4, Q7–Q15 · zXX1AWhNKgo: Played before the broadcast started
### 2022 USMSLAQ6 — MS Laurel Qualifier: 21 of 29 (partial)
- Saturday `m80Tbbf8Uqc`: 21 of 29 held
  - Q1–Q8 · m80Tbbf8Uqc: Played before the broadcast started
### 2022 USMSMEQ2 — MS Meridian Qualifier: 14 of 20 (partial)
- Saturday `2VFjmnlyY7I`: 14 of 20 held
  - Q1–Q6 · 2VFjmnlyY7I: Played before the broadcast started
### 2022 USNYEXCOQ — NY-Excelsior Corning Qualifier: 23 of 27 (partial)
- Sunday `wEQxSGvIpJA`: 23 of 27 held
  - Q1–Q4 · wEQxSGvIpJA: Played before the broadcast started
### 2022 USTXCECCS — TX-Central Buc Days 2023 Robot Rodeo: 0 of 55 (unplaced)
- Saturday `r9D-jIh_tlY`: 0 of 55 held — Video 6 h 1 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q48, M1–M2, M1-2, M2-2, F1–F3 · r9D-jIh_tlY: Video 6 h 1 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2022 USTXCECMPJHNS — FIRST in Texas FTC State Championship - Katherine Johnson Division: 0 of 62 (unplaced)
- Sunday `jHDfTkHip4M`: 0 of 26 held — Video 6 h 17 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
- Saturday 2023-03-25: no recording (36 played)
  - Q1–Q36 · no video: No recording for Saturday
  - Q37–Q54, M1–M2, M1-2, M2-2, M2-3, F1–F3 · jHDfTkHip4M: Video 6 h 17 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2022 USTXCECMPTSLA — FIRST in Texas FTC State Championship - Nikola Tesla Division: 0 of 61 (unplaced)
- Sunday `LRpjH8E9xC4`: 0 of 26 held — Video 6 h 16 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
- Saturday 2023-03-25: no recording (35 played)
  - Q1–Q22, Q24–Q36 · no video: No recording for Saturday
  - Q23, Q37–Q54, M1–M2, M1-2, M2-2, M2-3, F1–F2 · LRpjH8E9xC4: Video 6 h 16 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2022 USTXCENSAM4 — TX-Central Hill Country Field Meet 2: 0 of 23 (unplaced)
- Saturday `eLRdyhrd4Ug`: 0 of 23 held — Video 1 h 3 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q23 · eLRdyhrd4Ug: Video 1 h 3 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2022 USTXNOBLM1 — TX-North B-League Meet 1: 0 of 13 (unplaced)
- Saturday `aU0tr2l8z3I`: 0 of 13 held — Video 1 h 20 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q13 · aU0tr2l8z3I: Video 1 h 20 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2022 USTXNOFLM2 — TX-North F-League Meet 2: 0 of 26 (unplaced)
- Saturday `_7Ip-EcOoqA`: 0 of 26 held — Video 7 h 39 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q26 · _7Ip-EcOoqA: Video 7 h 39 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2022 USTXNOFMS — TX-North The Screamage: 18 of 20 (partial)
- Saturday `sczsiv0Mf9E`: 18 of 20 held
  - Q1–Q2 · sczsiv0Mf9E: Played before the broadcast started
### 2022 USTXNOLTSQ — TX-North Semi-Regional NORTH: 36 of 45 (partial)
- Saturday `MbMoThzRj0w`: 36 of 45 held
  - Q37–Q39, M1–M2, M2-2, M1-2, F1–F2 · MbMoThzRj0w: Past the part of the video its chapters confirm (to 4 h 18 min into the broadcast)
### 2022 USTXNOMLM1 — TX-North M-League Meet 1: 0 of 27 (unplaced)
- Saturday `Ij_lCW8b8Z4`: 0 of 27 held — Video 6 h 17 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q27 · Ij_lCW8b8Z4: Video 6 h 17 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2022 USTXNONLM2 — TX-North N-League Meet 2: 0 of 14 (unplaced)
- Saturday `k3dJqcAot48`: 0 of 14 held — Video 6 h 27 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q14 · k3dJqcAot48: Video 6 h 27 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2022 USTXNOULM3 — TX-North U-League Meet 3: 0 of 26 (unplaced)
- Saturday `Qy2x3LmYmhw`: 0 of 26 held — Video 3 h 34 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q26 · Qy2x3LmYmhw: Video 3 h 34 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2022 USTXSOBEOS — FIRST in Texas UIL State 5A: 0 of 41 (unplaced)
- Friday `xIHItKTvwBQ`: 0 of 41 held — Video 6 h 9 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q3, Q5, Q4, Q6–Q35, M1–M2, M1-2, M2-2, F1–F2 · xIHItKTvwBQ: Video 6 h 9 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2022 USTXSOBES — FIRST in Texas UIL State 6A: 0 of 41 (unplaced)
- Friday `V_LkivEPLY8`: 0 of 41 held — Video 6 h 14 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q35, M1–M2, M1-2, M2-2, F1–F2 · V_LkivEPLY8: Video 6 h 14 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2022 USTXSOCMP — FIRST in Texas UIL State 1A-4A: 0 of 42 (unplaced)
- Friday `P1UqE195ogw`: 0 of 42 held — Video 6 h 7 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q36, M1–M2, M1-2, M2-2, F1–F2 · P1UqE195ogw: Video 6 h 7 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2021 CABCCMP — British Columbia Championship: 0 of 42 (unplaced)
- Saturday `whrDSbxTY5I`: 0 of 42 held — Video 9 h 20 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
  - Q1–Q35, M1–M2, M1-2, M2-2, M1-3, F1–F2 · whrDSbxTY5I: Video 9 h 20 min shorter than its broadcast (over the 15 min an early start covers), its chapters don't confirm the clock
### 2021 CABCSUS2 — BC Lower Mainland Scrimmage 1 - Surrey: 12 of 14 (partial)
- Saturday `4IykQGab5AQ`: 12 of 12 held
- Saturday 2021-11-27: no recording (2 played)
  - Q10–Q11 · no video: No recording for Saturday
### 2021 CABCVAS1 — BC Lower Mainland Scrimmage 2 - Vancouver: 11 of 12 (partial)
- Saturday `3-erR6Z_ZUE`: 11 of 12 held
  - Q1 · 3-erR6Z_ZUE: Played before the broadcast started
### 2021 USAZCMPGG1 — Arizona Championship - Grand Canyon Division: 34 of 36 (partial)
- Saturday `sGXCgug53Ro`: 34 of 36 held
  - Q1–Q2 · sGXCgug53Ro: Played before the broadcast started
### 2021 USAZWAQ1 — AZ Desert Vista Qualifier: 0 of 36 (unplaced)
- Saturday `U27qC4CFzXk`: 0 of 36 held — Video 6 h 20 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q30, M1–M2, M1-2, M2-2, F1–F2 · U27qC4CFzXk: Video 6 h 20 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2021 USIACMPBLA — Iowa Regional Championship - Black Division: 0 of 43 (unplaced)
- Saturday `bpIbk1Uz8_M`: 0 of 43 held — Video 22 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q36, M1–M2, M1-2, M2-2, M2-3, F1–F2 · bpIbk1Uz8_M: Video 22 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2021 USIAJOM2 — IA Green_2021_11_13: 0 of 21 (unplaced)
- Saturday `PnYwXxwdOcY`: 0 of 21 held — Video 38 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q21 · PnYwXxwdOcY: Video 38 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2021 USNYEXCMP — New York- Excelsior MVCC Regional Championship: 10 of 42 (partial)
- Sunday `iOydsRR9pq0`: 10 of 42 held
  - Q1–Q32 · iOydsRR9pq0: Played before the broadcast started
### 2021 USNYNYBRQ1 — NY-NYC Qualifier 1: 7 of 31 (partial)
- Saturday `l7HXo2KWJ_4`: 7 of 31 held
  - Q2, Q4, Q6–Q10, Q12–Q23, M2, M1-2, M2-2, M1-3, M2-3 · l7HXo2KWJ_4: An early start would open on the match before (starts up to 4 min early)
### 2021 USNYNYBRQ2 — NY-NYC Qualifier 2: 0 of 33 (unplaced)
- Sunday `_HtpHt1P1tw`: 0 of 33 held — Video 2 h 49 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q26, M1–M2, M1-2, M2-2, F1–F3 · _HtpHt1P1tw: Video 2 h 49 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2021 USNYNYCCMP — New York-NYC Championship: 0 of 45 (unplaced)
- Sunday `zOHmGex79XE`: 0 of 45 held — Video 2 h 11 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q38, M1–M2, M1-2, M2-2, M1-3, F1–F2 · zOHmGex79XE: Video 2 h 11 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2021 USNYNYQUQ3 — NY-NYC Qualifier 3: 0 of 24 (unplaced)
- Saturday `E9t_IZycxeQ`: 0 of 24 held — Video 29 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q8, Q10–Q18, Q9, M1–M2, M1-2, M2-2, F1–F2 · E9t_IZycxeQ: Video 29 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2021 USNYNYQUQ4 — NY-NYC Qualifier 4: 0 of 29 (unplaced)
- Sunday `u6Rhe9CIudo`: 0 of 29 held — Video 1 h 36 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
  - Q1–Q23, M1–M2, M1-2, M2-2, F1–F2 · u6Rhe9CIudo: Video 1 h 36 min shorter than its broadcast (over the 15 min an early start covers), no chapters to confirm the clock
### 2019 2019IACMP1BLACK — Iowa Championship BLACK: 9 of 45 (partial)
- Saturday `juDEJB2wENc`: 9 of 9 held
  - Q1–Q36 · no video: No real start time from FIRST
### 2019 2019IACMP1GOLD — Iowa Championship GOLD: 7 of 43 (partial)
- Saturday `f0WTAt-jFDA`: 7 of 7 held
  - Q1–Q36 · no video: No real start time from FIRST
### 2019 2019IALT6 — League Tournament: Ottumwa: 0 of 40 (unplaced)
- Saturday `mk1-wQ80_qI`: 0 of 23 held
  - Q1, Q3, Q5, Q7, Q9, Q11, Q13, Q15, Q17, Q19, Q21, Q23, Q25, Q27, Q29, Q31, Q33 · no video: No real start time from FIRST
  - Q2, Q4, Q6, Q8, Q10, Q12, Q14, Q16, Q18, Q20, Q22, Q24, Q26, Q28, Q30, Q32, M1–M2, M1-2, M2-2, M1-3, F1–F2 · mk1-wQ80_qI: Played before the broadcast started
### 2019 2019IASQ1 — Super Qualifier: Waverly: 0 of 42 (unplaced)
- Saturday `kX5LTi80YSI`: 0 of 6 held
  - Q1–Q36 · no video: No real start time from FIRST
  - M1–M2, M1-2, M2-2, F1–F2 · kX5LTi80YSI: Played before the broadcast started
### 2019 2019IASQ2 — Super Qualifier: Johnston: 3 of 44 (partial)
- Saturday `6penXtHBHpI`: 3 of 8 held
  - Q1–Q36 · no video: No real start time from FIRST
  - M1–M2, M1-2, M2-2, M1-3 · 6penXtHBHpI: Played before the broadcast started
