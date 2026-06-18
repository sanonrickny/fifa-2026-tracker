# Live Data Auto-Update — Design

**Date:** 2026-06-17
**Status:** Approved (Approach A), implementing
**File touched:** `index.html` (single-file app)

## Problem

The app already polls ESPN every 60s for live scores, and `getTeamStats` already
computes points/standings from results. But two gaps make it look like "points
aren't added" and teams never qualify:

1. **Completed results don't load or persist.** `fetchScores` only requests
   *today + tomorrow*. A group game played earlier is never re-fetched, and
   nothing is cached, so after a reload standings reset to zero for past games.
2. **The knockout bracket is empty placeholders** (`home:null, away:null`) with
   no logic mapping group results into it. Teams never auto-qualify or advance.

## Goal

Keep the whole tournament picture current automatically: completed results always
count toward points/standings, the top-2 of each group plus the 8 best
third-placed teams auto-qualify into the Round of 32, and knockout winners
auto-advance through to the Final — all driven by live ESPN data, persisted
across reloads.

## Approach A (chosen): compute it ourselves

The bracket *structure* for 2026 is fixed and public; only the *teams* in it are
results-dependent. We hardcode the structure and derive everything else from data.

### 1. Data source — one range fetch + persistence

ESPN's scoreboard endpoint accepts a **date range** and returns the entire
tournament (verified: `?dates=20260611-20260719` → 100 events, each with
`competitors[].score`, `competitors[].winner` (bool), `abbreviation`, and
`status.type.state` of `pre|in|post`). Team abbreviations match our team codes.

- Replace the today+tomorrow two-call logic with **one full-range fetch**
  (`TOURNAMENT_START`–`TOURNAMENT_END`). Keeps it simple and backfills every
  finished result every cycle.
- **Persist** the per-match result snapshot (`status`, `homeScore`, `awayScore`,
  `minute`, `espnId`, and resolved knockout teams) to `localStorage` under a
  versioned key. On startup, hydrate from cache *before* the first fetch so the
  page renders correct standings instantly and works offline; then the fetch
  refreshes.
- Keep the 60s `setInterval`. Add a `visibilitychange` / `online` listener to
  fetch immediately when the tab is re-focused or the network returns (fixes
  "laptop woke from sleep with stale data").

### 2. Data model

- Add tournament-window constants `TOURNAMENT_START = '20260611'`,
  `TOURNAMENT_END = '20260719'`.
- **Integrate knockout matches into the score pipeline.** Give each
  `KNOCKOUT_ROUNDS` match a stable mapping so ESPN results can fill it:
  - `feedHome` / `feedAway`: a *source spec* describing where the team comes
    from — `{type:'group', pos:1|2, group:'A'}`, `{type:'third', slot:N}`, or
    `{type:'winner', match:'<id>'}`.
  - `homeScore`, `awayScore`, `status`, `winnerCode` (filled from ESPN once the
    teams are known and the match is played).
- Add the official 2026 bracket wiring (from FIFA/Wikipedia Annex, match
  numbers 73–104):

  Round of 32 (slot → feeds):
  ```
  M73 2A  vs 2B          M74 1E  vs 3[A/B/C/D/F]
  M75 1F  vs 2C          M76 1C  vs 2F
  M77 1I  vs 3[C/D/F/G/H] M78 2E vs 2I
  M79 1A  vs 3[C/E/F/H/I] M80 1L vs 3[E/H/I/J/K]
  M81 1D  vs 3[B/E/F/I/J] M82 1G vs 3[A/E/H/I/J]
  M83 2K  vs 2L          M84 1H  vs 2J
  M85 1B  vs 3[E/F/G/I/J] M86 1J vs 2H
  M87 1K  vs 3[D/E/I/J/L] M88 2D vs 2G
  ```
  Round of 16: 89=W74/W77, 90=W73/W75, 91=W76/W78, 92=W79/W80,
  93=W83/W84, 94=W81/W82, 95=W86/W88, 96=W85/W87.
  QF: 97=W89/W90, 98=W93/W94, 99=W91/W92, 100=W95/W96.
  SF: 101=W97/W98, 102=W99/W100. Final: 104=W101/W102.

  The existing `R32M1..16 / R16M1..8 / QF1..4 / SF1..2 / FIN` ids are kept; each
  gets its feed spec. R32 display order is arranged so each adjacent pair feeds
  the same R16 match (clean bracket lines).

### 3. Qualification engine (`computeQualification()`)

Runs after every data refresh, pure function of `matchesById`:

1. **Group ranking** — reuse `getTeamStats`; order each group by
   pts → GD → GF → (name fallback). Top-2 = winner/runner-up.
2. **Best-8 third place** — collect each group's 3rd team, rank by
   pts → GD → GF → goals → name (FIFA also uses conduct + world ranking; those
   data aren't available, so we stop at goals/name — documented limitation).
   Take the best 8; record their groups.
3. **Third-place slot assignment** — each third-place R32 slot allows 5 specific
   groups. Assign the 8 qualifying groups to the 8 slots via **backtracking
   bipartite matching** (each slot gets a group from its allowed set, bijection),
   with a deterministic alphabetical tie-break so the result is stable. This
   reproduces FIFA's Annex C constraints; in the rare case the official table
   picks a different valid permutation, ESPN's actual knockout fixtures (once
   drawn) win via name-match reconciliation.
4. **Fill R32** home/away team objects from winners/runners-up/assigned thirds.
5. **Advance knockouts** — for each played knockout match, resolve the winner
   from ESPN's `winner` flag (handles extra-time/penalties, which raw score
   can't), set `winnerCode`, and propagate into the dependent slot's feed.
   Only resolved (`status==='final'`) matches advance; otherwise slot stays TBD.

Standings/qualification stay correct even before kickoff because everything is a
projection that tightens as results arrive.

### 4. Rendering

- Groups: unchanged math; the top-2 qualified marker already exists (`pos-q`),
  add a subtle "best-third" indicator for 3rd-place teams currently in the best-8.
- Bracket: render real team flags/names + scores once feeds resolve; `winner`
  side highlighted (existing `.winner` style). Unresolved slots show `TBD` /
  `3rd A/B/…` hint.
- Add a small "Updated h:mm a" timestamp + offline indicator near the live badge.

### 5. Edge cases / risks

- **Name/abbr mismatch** between ESPN and our codes → already handled by
  `normName` fallback; log unmatched events to console for debugging.
- **Third-place table ambiguity** → constraint matching + ESPN reconciliation
  (above). Documented that pre-draw assignment is a projection.
- **Conduct/world-ranking tiebreakers unavailable** → documented; extremely rare
  to affect the 8th/9th boundary.
- **localStorage disabled/full** → wrap in try/catch; fall back to in-memory.
- **ESPN downtime** → keep last cached data, show stale timestamp.

### 6. Verification

- Re-fetch the live range and assert finished group games produce non-zero points
  and a sorted table per group.
- Unit-style checks (inline, run in browser console) for: third-place ranking,
  constraint matching produces a valid bijection for sample qualifying sets, and
  knockout advancement from a `winner`-flagged sample event.
- Manual: load page, confirm standings populated from cache instantly, bracket
  fills group winners/runners-up, and a played knockout advances.

## Out of scope

- Editing the hardcoded schedule/teams/venues (still maintained in `RAW_MATCHES`).
- A server/scheduled rebuild — static hosting only updates while a tab is open;
  the 60s client poll is the realistic "always updating."
