# Live Game Hero Strip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static "⚽ THE TOURNAMENT IS LIVE!" hero text with a horizontal scrollable row of live game cards whenever a World Cup match is in progress, each tappable to open the existing match detail modal.

**Architecture:** Two new functions in `app.js` — `getLiveMatches()` (pure filter/sort over existing `matchesById`) and `renderLiveStrip()` (writes into the existing `countdownRow` element). `renderLiveStrip()` is called as the last line of the existing `renderAll()`, which already fires after every ESPN poll and timezone change. New CSS classes in `styles.css` for the strip and cards.

**Tech Stack:** Vanilla HTML/CSS/JS. No build tools, no frameworks. Served from Firebase static hosting. Browser tested via `python3 -m http.server 8000`.

## Global Constraints

- No new HTML in `index.html` — all DOM is written by JS into existing `#countdownRow`
- No new fetch calls or polling intervals — piggyback on existing 60s ESPN poll
- Team objects have properties: `.name` (string), `.code` (3-letter string), `.flag` (emoji string)
- Match objects have: `.id`, `.status` (`'upcoming'|'live'|'final'`), `.homeScore` (number|null), `.awayScore` (number|null), `.minute` (string|null), `.home` (team obj), `.away` (team obj), `.kickoffUTC` (Date)
- `openModal(matchId)` is the existing function to open the detail modal — takes the match `.id` string
- CSS custom properties available: `--bg`, `--bg2`, `--bg3`, `--card`, `--gold`, `--red`, `--white`, `--gray`, `--border`, `--border2`
- Mobile breakpoint: `@media (max-width: 640px)` block already exists at end of `styles.css` — add mobile overrides there
- Tournament kickoff constant for fallback text: `new Date('2026-06-11T19:00:00Z')`

---

### Task 1: CSS — Live strip and card styles

**Files:**
- Modify: `styles.css` — append new rules before the final `@media (max-width: 640px)` block; add mobile overrides inside that block

**Interfaces:**
- Produces: `.live-strip`, `.live-match-card`, `.lmc-team`, `.lmc-flag`, `.lmc-name`, `.lmc-center`, `.lmc-score`, `.lmc-live-row`, `.lmc-dot`, `.lmc-min` — used by Task 2's HTML template

- [ ] **Step 1: Verify the classes don't exist yet**

Open browser console at `http://localhost:8000` and run:
```js
document.styleSheets[1].cssRules // styles.css is the second sheet
// Confirm no rules mention "live-strip" or "live-match-card"
// Expected: no matches
```

Or simpler:
```js
[...document.styleSheets].flatMap(s => { try { return [...s.cssRules] } catch(e) { return [] } }).map(r => r.selectorText).filter(Boolean).filter(s => s.includes('lmc'))
// Expected: []
```

- [ ] **Step 2: Add CSS to `styles.css`**

Find the line in `styles.css` that reads:
```css
/* ── TOUCH FEEDBACK ──
```
Insert the following block **immediately before** that line:

```css
/* ── LIVE STRIP ── */
.live-strip {
  display: flex;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  gap: 0.75rem;
  justify-content: center;
  padding: 0.25rem 1rem;
  width: 100%;
  scrollbar-width: none;
}
.live-strip::-webkit-scrollbar { display: none; }

.live-match-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 260px;
  width: min(85vw, 300px);
  flex-shrink: 0;
  scroll-snap-align: center;
  background: var(--card);
  border: 1px solid rgba(255,59,48,0.35);
  border-top: 2px solid var(--red);
  border-radius: 12px;
  padding: 0.85rem 1rem;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.live-match-card:hover {
  border-color: rgba(255,59,48,0.7);
  box-shadow: 0 0 18px rgba(255,59,48,0.15);
}
.live-match-card:active { background: rgba(255,255,255,0.05); }

.lmc-team {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  flex: 1;
  min-width: 0;
}
.lmc-flag { font-size: 1.8rem; line-height: 1; }
.lmc-name {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 700;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--white);
  max-width: 70px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lmc-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
  flex-shrink: 0;
}
.lmc-score {
  font-family: 'Orbitron', monospace;
  font-weight: 700;
  font-size: 1.5rem;
  color: var(--white);
  letter-spacing: 0.05em;
}
.lmc-live-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.lmc-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--red);
  flex-shrink: 0;
  animation: pulse 1.2s ease-in-out infinite;
}
.lmc-min {
  font-family: 'Rajdhani', sans-serif;
  font-weight: 600;
  font-size: 0.72rem;
  color: var(--red);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
```

Then inside the existing `@media (max-width: 640px)` block, at the very end (before the closing `}`), add:

```css
  .lmc-flag { font-size: 1.5rem; }
  .lmc-name { font-size: 0.72rem; max-width: 55px; }
  .lmc-score { font-size: 1.25rem; }
```

- [ ] **Step 3: Verify CSS loaded in browser**

Hard-refresh the page (`Cmd+Shift+R`), then run in console:
```js
[...document.styleSheets].flatMap(s => { try { return [...s.cssRules] } catch(e) { return [] } }).map(r => r.selectorText).filter(Boolean).filter(s => s && s.includes('lmc'))
// Expected: ['.lmc-team', '.lmc-flag', '.lmc-name', '.lmc-center', '.lmc-score', '.lmc-live-row', '.lmc-dot', '.lmc-min'] (order may vary)
```

Also verify the card looks right by injecting a mock element:
```js
const row = document.getElementById('countdownRow');
row.innerHTML = `<div class="live-strip"><div class="live-match-card"><div class="lmc-team"><span class="lmc-flag">🇺🇸</span><span class="lmc-name">USA</span></div><div class="lmc-center"><div class="lmc-score">1 – 0</div><div class="lmc-live-row"><span class="lmc-dot"></span><span class="lmc-min">34'</span></div></div><div class="lmc-team"><span class="lmc-flag">🇧🇷</span><span class="lmc-name">BRA</span></div></div></div>`;
// Expected: A dark card with red top border, flags, score "1 – 0", pulsing red dot, "34'" appears in the hero area
```

- [ ] **Step 4: Commit**

```bash
git add styles.css
git commit -m "feat: add live strip CSS classes"
```

---

### Task 2: JS — `getLiveMatches()`, `renderLiveStrip()`, wire into `renderAll()`

**Files:**
- Modify: `app.js:961-968` — `renderAll()` function; append two new functions after it and add one call inside it

**Interfaces:**
- Consumes: `matchesById` (global object, match values have `.status`, `.homeScore`, `.awayScore`, `.minute`, `.home.flag`, `.home.code`, `.away.flag`, `.away.code`, `.kickoffUTC`, `.id`), `openModal(matchId)` (existing function, line 757)
- Produces: `getLiveMatches()` → `Array<match>`, `renderLiveStrip()` → void (writes into `#countdownRow`)

- [ ] **Step 1: Verify functions don't exist yet**

In browser console:
```js
typeof getLiveMatches   // Expected: "undefined"
typeof renderLiveStrip  // Expected: "undefined"
```

- [ ] **Step 2: Add `getLiveMatches()` and `renderLiveStrip()` to `app.js`**

Locate the `renderAll()` function (line 961). It currently ends at line 968:
```js
function renderAll() {
  const sig = renderSignature();
  if (sig === lastRenderSig) return;
  lastRenderSig = sig;
  renderGroups();
  renderSchedule();
  renderBracket();
}
```

Replace it with:
```js
function renderAll() {
  const sig = renderSignature();
  if (sig === lastRenderSig) return;
  lastRenderSig = sig;
  renderGroups();
  renderSchedule();
  renderBracket();
  renderLiveStrip();
}
```

Then, immediately after the closing `}` of `renderAll()`, add:

```js
function getLiveMatches() {
  return Object.values(matchesById)
    .filter(m => m.status === 'live')
    .sort((a, b) => a.kickoffUTC - b.kickoffUTC);
}

function renderLiveStrip() {
  const row = document.getElementById('countdownRow');
  if (!row) return;
  const live = getLiveMatches();
  if (live.length === 0) {
    if (Date.now() >= new Date('2026-06-11T19:00:00Z').getTime()) {
      row.innerHTML = `<div style="font-family:'Bebas Neue';font-size:1.5rem;color:var(--gold);letter-spacing:0.1em">⚽ THE TOURNAMENT IS LIVE!</div>`;
    }
    return;
  }
  const cards = live.map(m => {
    const hs = m.homeScore ?? 0;
    const as = m.awayScore ?? 0;
    const min = m.minute || 'LIVE';
    return `
      <div class="live-match-card" data-match-id="${m.id}">
        <div class="lmc-team">
          <span class="lmc-flag">${m.home?.flag || '🏳️'}</span>
          <span class="lmc-name">${m.home?.code || '???'}</span>
        </div>
        <div class="lmc-center">
          <div class="lmc-score">${hs} – ${as}</div>
          <div class="lmc-live-row">
            <span class="lmc-dot"></span>
            <span class="lmc-min">${min}</span>
          </div>
        </div>
        <div class="lmc-team">
          <span class="lmc-flag">${m.away?.flag || '🏳️'}</span>
          <span class="lmc-name">${m.away?.code || '???'}</span>
        </div>
      </div>`;
  }).join('');
  row.innerHTML = `<div class="live-strip">${cards}</div>`;
  row.querySelectorAll('.live-match-card').forEach(card => {
    card.addEventListener('click', () => openModal(card.dataset.matchId));
  });
}
```

- [ ] **Step 3: Verify functions exist**

Hard-refresh, then in console:
```js
typeof getLiveMatches   // Expected: "function"
typeof renderLiveStrip  // Expected: "function"
```

- [ ] **Step 4: Verify live strip renders correctly**

Simulate a live match by forcing one in browser console:
```js
// Pick any match id — grab the first one
const firstId = Object.keys(matchesById)[0];
const m = matchesById[firstId];
m.status = 'live';
m.homeScore = 1;
m.awayScore = 0;
m.minute = "34'";
renderLiveStrip();
// Expected: hero area shows a dark card with red top border,
//           home flag + code, "1 – 0", pulsing dot, "34'", away flag + code
```

- [ ] **Step 5: Verify two live games show as a scrollable row**

```js
const ids = Object.keys(matchesById);
matchesById[ids[0]].status = 'live';
matchesById[ids[0]].homeScore = 2;
matchesById[ids[0]].awayScore = 1;
matchesById[ids[0]].minute = "67'";
matchesById[ids[1]].status = 'live';
matchesById[ids[1]].homeScore = 0;
matchesById[ids[1]].awayScore = 0;
matchesById[ids[1]].minute = "12'";
renderLiveStrip();
// Expected: two side-by-side cards in a scrollable strip
// On mobile (resize DevTools to 390px wide): first card ~85vw, second peeks at edge
```

- [ ] **Step 6: Verify tap opens the modal**

```js
// After Step 4 or 5, click any live card in the hero
// Expected: the existing match detail modal opens for that game
// (score, where to watch, win probability all appear as normal)
```

- [ ] **Step 7: Verify no-live-games fallback**

```js
// Reset the match we forced to live
const firstId = Object.keys(matchesById)[0];
matchesById[firstId].status = 'final';
const secondId = Object.keys(matchesById)[1];
matchesById[secondId].status = 'final';
renderLiveStrip();
// Expected: hero shows "⚽ THE TOURNAMENT IS LIVE!" text (not a card)
```

- [ ] **Step 8: Verify `renderAll()` calls `renderLiveStrip()` automatically**

```js
// Force one match live again
matchesById[Object.keys(matchesById)[0]].status = 'live';
// Trigger a full render as if the 60s poll fired
lastRenderSig = null;  // bust the sig cache so renderAll doesn't short-circuit
renderAll();
// Expected: live card appears in hero without calling renderLiveStrip() directly
```

- [ ] **Step 9: Commit**

```bash
git add app.js
git commit -m "feat: show live game strip in hero when matches are in progress"
```
