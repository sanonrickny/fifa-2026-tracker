# Live Game Hero Strip — Design

**Date:** 2026-06-19  
**Status:** Approved, pending implementation plan

## Problem

When the app loads while a World Cup match is in progress, there is no immediate signal of what's happening right now. The header shows a small red "LIVE" badge, but the hero section — the first thing a visitor sees — just shows a static "⚽ THE TOURNAMENT IS LIVE!" text that gives no actual game information.

## Goal

Replace the static "TOURNAMENT IS LIVE!" text in the hero with a live game strip showing all currently-live matches (score, teams, current minute), each tappable to open the existing match detail modal. When no match is live the existing text is restored. Works on mobile and desktop.

## Scope

- **In scope:** Reading existing match state, rendering cards in `countdownRow`, CSS for the strip/cards, touch/click → existing `openModal(id)`
- **Out of scope:** New data fetching, polling interval changes, new modal design, new tabs, push notifications

## Architecture

### Data flow

No new state. Every 60 seconds `fetchScores()` already updates `matchesById` and calls `renderAll()`. A new `renderLiveStrip()` function is appended to `renderAll()` — it reads the already-updated `matchesById`, finds live matches, and writes into `countdownRow`. The fetch cycle is the single source of truth; no additional timers or listeners are needed.

### `getLiveMatches()`

Pure filter + sort over `Object.values(matchesById)`:

```
filter: m.status === 'live'
sort:   ascending by m.kickoffUTC
```

Returns an array (may be empty). No side effects.

### `renderLiveStrip()`

```
live = getLiveMatches()
if live.length === 0:
  if tournament has started: restore "⚽ THE TOURNAMENT IS LIVE!" text
  else: do nothing (countdown is still running)
  return
countdownRow.innerHTML = buildLiveStripHTML(live)
attach click listener to each card → openModal(m.id)
```

`buildLiveStripHTML(matches)` returns one `.live-strip` wrapper containing one `.live-match-card` per match.

Called as the last line of `renderAll()` (which already fires after every fetch, timezone change, and initial hydrate-from-cache).

### State transitions in `countdownRow`

| Condition | Content |
|---|---|
| Before 2026-06-11T19:00Z | D / H / M / S countdown (unchanged) |
| Tournament started, no live game | `⚽ THE TOURNAMENT IS LIVE!` (unchanged) |
| 1+ games live | `.live-strip` with one `.live-match-card` per game |

Transitions happen naturally on the next `renderAll()` call — no separate event needed.

## UI Components

### `.live-strip`

```
display: flex
overflow-x: auto
scroll-snap-type: x mandatory
gap: 0.75rem
justify-content: center  (desktop: all cards visible; mobile: first card centered)
padding: 0.25rem 1rem
scrollbar hidden (webkit + scrollbar-width: none)
```

### `.live-match-card`

```
layout:       flex row, align-items center, gap 0.75rem
width:        min(85vw, 300px)  — one card visible on mobile, peek at next
min-width:    260px on desktop
scroll-snap-align: center
background:   var(--card)  (rgba(11,17,32,0.85))
border:       1px solid rgba(255,59,48,0.35)
border-top:   2px solid var(--red)   ← live indicator
border-radius: 12px
padding:      0.85rem 1rem
cursor:       pointer
transition:   border-color 0.2s, box-shadow 0.2s
:hover        border-color: rgba(255,59,48,0.7), box-shadow: 0 0 18px rgba(255,59,48,0.15)
:active       background: rgba(255,255,255,0.05)
```

### `.lmc-team` (home + away, mirrored)

```
display: flex, flex-direction: column, align-items: center
gap: 0.2rem
flex: 1
.lmc-flag:  font-size 1.8rem
.lmc-name:  Rajdhani 700, 0.8rem, uppercase, letter-spacing 0.06em
            max-width 70px, overflow hidden, text-overflow ellipsis, white-space nowrap
```

### `.lmc-center`

```
display: flex, flex-direction: column, align-items: center
gap: 0.3rem
flex-shrink: 0

.lmc-score:   Orbitron 700, 1.5rem, color var(--white)
              format: "H – A"  (e.g. "2 – 1")
              fallback when null: "0 – 0"

.lmc-live-row: flex row, gap 0.35rem, align-items center
  .lmc-dot:   7px circle, background var(--red), animation pulse (reuse existing keyframe)
  .lmc-min:   Rajdhani 600, 0.72rem, color var(--red), uppercase
              value: m.minute when present (e.g. "45+2'"), else "LIVE"
```

### Mobile (`max-width: 640px`)

```
.lmc-flag:  font-size 1.5rem
.lmc-name:  font-size 0.72rem, max-width 55px
.lmc-score: font-size 1.25rem
```

## Edge Cases

| Scenario | Behavior |
|---|---|
| `m.minute` is null / undefined | `.lmc-min` shows `LIVE` with no clock value |
| `m.homeScore` or `m.awayScore` is null | Score renders as `0 – 0` |
| Game transitions `live → final` | Next `renderAll()` removes its card; if none remain, restores "TOURNAMENT IS LIVE!" text |
| Two games start simultaneously | Both cards visible; on mobile the second peeks at the right edge (natural scroll affordance) |
| ESPN temporarily returns `status: 'pre'` for a live game (known glitch) | Card disappears for up to 60s then reappears when ESPN corrects |
| localStorage / cache hydration before first fetch | No cards shown until first `fetchScores()` confirms `status: 'live'` — avoids stale cache incorrectly showing a card for a yesterday's game |

## Files Changed

| File | Change |
|---|---|
| `app.js` | Add `getLiveMatches()`, `renderLiveStrip()`. Add one call at end of `renderAll()`. |
| `styles.css` | Add `.live-strip`, `.live-match-card`, `.lmc-team`, `.lmc-flag`, `.lmc-name`, `.lmc-center`, `.lmc-score`, `.lmc-live-row`, `.lmc-dot`, `.lmc-min`. Add mobile overrides in existing `@media (max-width: 640px)` block. |
| `index.html` | No changes. |

## Verification

1. Open the app while a match is `live` in `matchesById` → strip appears in hero with correct score + minute
2. Open the app when no match is live → "⚽ THE TOURNAMENT IS LIVE!" text shows as before
3. Tap a card → existing match modal opens for that game
4. Simulate two live games in the browser console → two cards appear; scrollable on mobile
5. After a game ends (`status: 'final'`), next poll → card disappears
6. Mobile: card is ~85vw wide, second card peeks at edge; no horizontal page overflow
