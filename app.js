// ─── STATE ───────────────────────────────────────────────────────────────────
// Auto-detect the viewer's timezone — no picker needed.
let userTZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
let matchesById = {}; // id -> match object
let currentModalId = null;
let refreshTimer = null;
let pastExpanded = false; // Full Schedule: whether finished knockout games are revealed
let bracketCollapsed = {}; // round code -> user override; default = auto-collapse finished rounds
let groupExpanded = false; // Full Schedule: whether the finished group stage is revealed
let lastRenderSig = null;  // skip redundant full re-renders (preserves scroll/interaction)

// Tournament data window + persistence
const TOURNAMENT_START = '20260611';
const TOURNAMENT_END   = '20260719';
const LS_KEY = 'rickcup_results_v2';
let espnEvents = [];            // raw ESPN events from the full-range fetch
let koResultsCache = {};        // knockout match id -> {status, winnerCode, scoreByCode} (persisted fallback)
let lastUpdated = null;         // ms timestamp of last successful data refresh
let QUAL = { best8: new Set(), groupStageDone: false };

// ─── TEAM LOOKUP ─────────────────────────────────────────────────────────────
let teamByCode = {};
Object.values(GROUPS).forEach(g => g.teams.forEach(t => teamByCode[t.code] = t));

// Build match objects
function buildMatches() {
  RAW_MATCHES.forEach(([id, group, hCode, aCode, date, utc, venue, city, broadcaster]) => {
    const home = teamByCode[hCode];
    const away = teamByCode[aCode];
    // `utc` is an "HH:MM" UTC kickoff string (supports half-hour kickoffs).
    const kickoffUTC = new Date(`${date}T${utc}:00Z`);
    matchesById[id] = {
      id, group, home, away, kickoffUTC, venue, city, broadcaster,
      status: 'upcoming', homeScore: null, awayScore: null, minute: null,
      espnId: null,
    };
  });
}

// ─── TIMEZONE ─────────────────────────────────────────────────────────────────
function formatTime(dateUTC, tz) {
  return dateUTC.toLocaleString('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
function formatDate(dateUTC, tz) {
  return dateUTC.toLocaleString('en-US', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  });
}
function formatDateFull(dateUTC, tz) {
  return dateUTC.toLocaleString('en-US', {
    timeZone: tz,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}
function getDateKey(dateUTC, tz) {
  return dateUTC.toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
}

// ─── ESPN LIVE SCORES ─────────────────────────────────────────────────────────
let fetchInFlight = false;
async function fetchScores() {
  if (fetchInFlight) return;          // avoid overlapping polls
  fetchInFlight = true;
  try {
    // One range request returns every group + knockout match for the whole
    // tournament (with scores + a winner flag), so completed games always count.
    // ESPN caps the response at 100 events by default and the tournament has
    // 104 — without `limit` the semifinals and final are silently dropped.
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/FIFA.World/scoreboard?dates=${TOURNAMENT_START}-${TOURNAMENT_END}&limit=200`;
    const resp = await fetch(url);
    if (resp.ok) {
      const data = await resp.json();
      espnEvents = data.events || [];
      processESPNData(data);          // fill group-stage results
      lastUpdated = Date.now();
    }

    computeQualification();           // roll results into standings + bracket
    saveResults();                    // persist so a reload starts populated
    renderAll();
    updateLiveBadge();
    updateTimestamp();

    // If a match modal is open, keep its score/status fresh; if the game is
    // live, refresh odds and events too. Knockout matches live outside
    // matchesById, so fall back to the KO lookup: during the semis and final
    // that is the only kind of live game there is.
    if (currentModalId) {
      const openMatch = matchesById[currentModalId] || knockoutMatchById(currentModalId);
      if (openMatch) refreshOpenModalScore(openMatch);
      if (openMatch && openMatch.status === 'live') {
        // Bust caches so we get fresh in-play odds and events
        delete oddsCache[currentModalId];
        delete summaryCache[currentModalId];
        fetchOddsForMatch(openMatch).then(odds => {
          if (currentModalId === openMatch.id) renderProbability(openMatch, odds);
        });
        fetchSummary(openMatch).then(data => {
          if (currentModalId === openMatch.id) renderEvents(openMatch, data);
        });
      }
    }
  } catch (e) {
    console.warn('Score fetch failed:', e);
  } finally {
    fetchInFlight = false;
  }
}

function processESPNData(data) {
  if (!data.events) return;
  data.events.forEach(ev => {
    const comp = ev.competitions?.[0];
    if (!comp) return;
    const competitors = comp.competitors || [];
    if (competitors.length < 2) return;

    const status = ev.status?.type?.state; // pre / in / post
    const minute = ev.status?.displayClock;
    // Identity + score for each ESPN competitor, independent of home/away role.
    const info = c => ({
      abbr: c.team?.abbreviation || '',
      name: c.team?.displayName || c.team?.name || '',
      score: parseInt(c.score ?? '-1'),
    });
    const c0 = info(competitors[0]);
    const c1 = info(competitors[1]);

    // Bind this event to our fixture by team identity in EITHER orientation —
    // FIFA's home/away designation at neutral venues often differs from ESPN's
    // ordering, so we must not assume our home == ESPN's home. Scores are then
    // assigned by team, never by ESPN's role. A date guard prevents a stray
    // same-teams event on another day from binding.
    Object.values(matchesById).forEach(m => {
      if (!eventNearKickoff(ev, m.kickoffUTC)) return;
      let homeInfo = null, awayInfo = null;
      if (sameTeam(m.home, c0.abbr, c0.name) && sameTeam(m.away, c1.abbr, c1.name)) {
        homeInfo = c0; awayInfo = c1;
      } else if (sameTeam(m.home, c1.abbr, c1.name) && sameTeam(m.away, c0.abbr, c0.name)) {
        homeInfo = c1; awayInfo = c0;
      }
      if (!homeInfo) return;

      m.espnId = ev.id;
      m.status = status === 'in' ? 'live' : status === 'post' ? 'final' : 'upcoming';
      m.minute = minute || null;
      if (status !== 'pre') {
        m.homeScore = homeInfo.score >= 0 ? homeInfo.score : null;
        m.awayScore = awayInfo.score >= 0 ? awayInfo.score : null;
      }
    });
  });
}

function normName(s) {
  return s.toLowerCase().replace(/[^a-z]/g,'');
}

// ESPN labels several nations differently than our display names. Map our
// 3-letter code → alternative spellings ESPN/feeds may use, so a live result
// binds to the correct fixture even when the name or abbreviation differs.
const TEAM_ALIASES = {
  KOR: ['Korea Republic', 'Republic of Korea', 'South Korea'],
  CZE: ['Czech Republic', 'Czechia'],
  BIH: ['Bosnia and Herzegovina', 'Bosnia & Herzegovina', 'Bosnia'],
  TUR: ['Turkey', 'Türkiye', 'Turkiye'],
  CIV: ["Côte d'Ivoire", "Cote d'Ivoire", 'Ivory Coast'],
  CUW: ['Curacao', 'Curaçao'],
  IRN: ['IR Iran', 'Iran'],
  CPV: ['Cabo Verde', 'Cape Verde'],
  COD: ['DR Congo', 'Congo DR', 'Democratic Republic of the Congo', 'Congo Democratic Republic'],
  USA: ['United States', 'United States of America', 'USA'],
  KSA: ['Saudi Arabia'],
  RSA: ['South Africa'],
};

// True if an ESPN competitor (abbreviation + display name) is our `team`.
// Matches on 3-letter code (case-insensitive), exact normalized name, or a
// known alias — so naming differences don't drop a valid result.
function sameTeam(team, abbr, name) {
  if (!team) return false;
  if (abbr && team.code.toUpperCase() === String(abbr).toUpperCase()) return true;
  const n = normName(name || '');
  if (!n) return false;
  if (n === normName(team.name)) return true;
  return (TEAM_ALIASES[team.code] || []).some(a => normName(a) === n);
}

// Guard against binding a result from the wrong day. ESPN's range scoreboard
// can return same-teams events on other dates; a real result sits within a day
// of our scheduled kickoff. Returns true when no usable date is available so we
// never drop a result purely for lack of a timestamp.
const MATCH_DATE_TOLERANCE_MS = 30 * 60 * 60 * 1000; // 30h — covers tz bucketing
function eventNearKickoff(ev, kickoffUTC) {
  if (!kickoffUTC || isNaN(kickoffUTC.getTime())) return true;
  const t = ev?.date ? new Date(ev.date).getTime() : NaN;
  if (!Number.isFinite(t)) return true;
  return Math.abs(t - kickoffUTC.getTime()) <= MATCH_DATE_TOLERANCE_MS;
}

function updateLiveBadge() {
  // Knockout matches live outside matchesById — count both.
  document.getElementById('liveBadge').style.display = getLiveMatches().length ? 'flex' : 'none';
}

// ─── QUALIFICATION + BRACKET ENGINE (Approach A) ──────────────────────────────
// Order a group's teams by FIFA tiebreakers we can compute from results.
function groupRanked(letter) {
  return GROUPS[letter].teams
    .map(t => ({ t, s: getTeamStats(t.code, letter) }))
    .sort((a, b) =>
      b.s.pts - a.s.pts || b.s.gd - a.s.gd || b.s.gf - a.s.gf ||
      a.t.name.localeCompare(b.t.name)
    );
}
function groupComplete(letter) {
  return Object.values(matchesById)
    .filter(m => m.group === letter)
    .every(m => m.status === 'final');
}

// Find a played result for the pair (code1, code2) from ESPN, regardless of
// home/away orientation. Falls back to the persisted knockout cache when offline.
function findResult(code1, code2, name1, name2, kickoffUTC) {
  const t1 = teamByCode[code1], t2 = teamByCode[code2];
  for (const ev of espnEvents) {
    if (!eventNearKickoff(ev, kickoffUTC)) continue;
    const comp = ev.competitions?.[0];
    const cs = comp?.competitors || [];
    if (cs.length < 2) continue;
    const [a, b] = cs;
    const ca = a.team?.abbreviation || '', cb = b.team?.abbreviation || '';
    const na = a.team?.displayName || a.team?.name || '';
    const nb = b.team?.displayName || b.team?.name || '';
    const aIs1 = sameTeam(t1, ca, na), aIs2 = sameTeam(t2, ca, na);
    const bIs1 = sameTeam(t1, cb, nb), bIs2 = sameTeam(t2, cb, nb);
    const pair = (aIs1 && bIs2) || (aIs2 && bIs1);
    if (!pair) continue;
    const state = ev.status?.type?.state;
    const status = state === 'in' ? 'live' : state === 'post' ? 'final' : 'upcoming';
    const scoreByCode = {};
    scoreByCode[ca] = parseInt(a.score ?? '-1');
    scoreByCode[cb] = parseInt(b.score ?? '-1');
    // ESPN exposes penalty shootout tallies as `shootoutScore` on each
    // competitor when a knockout game was decided on penalties.
    const shootoutByCode = {};
    const sa = parseInt(a.shootoutScore ?? '-1'), sb = parseInt(b.shootoutScore ?? '-1');
    if (sa >= 0 || sb >= 0) { shootoutByCode[ca] = Math.max(sa, 0); shootoutByCode[cb] = Math.max(sb, 0); }
    let winnerCode = null;
    if (a.winner) winnerCode = ca; else if (b.winner) winnerCode = cb;
    const minute = state === 'in' ? (ev.status?.displayClock || null) : null;
    return { status, scoreByCode, shootoutByCode, winnerCode, minute };
  }
  return null;
}

// Assign each qualifying third-place group to a slot (bijection respecting each
// slot's allowed groups). Deterministic via sorted input + backtracking.
function assignThirdSlots(qualifiedGroups, slotAllowed) {
  const groups = qualifiedGroups.slice().sort();
  const used = new Set();
  const result = new Array(slotAllowed.length).fill(null);
  function bt(i) {
    if (i === slotAllowed.length) return true;
    for (const g of groups) {
      if (!used.has(g) && slotAllowed[i].includes(g)) {
        used.add(g); result[i] = g;
        if (bt(i + 1)) return true;
        used.delete(g); result[i] = null;
      }
    }
    return false;
  }
  bt(0);
  return result;
}

function resolveFeed(spec, ranked, complete, thirdAssign, groupStageDone, koById, slotId) {
  if (spec.gw) return complete[spec.gw] ? ranked[spec.gw][0].t : null;
  if (spec.gr) return complete[spec.gr] ? ranked[spec.gr][1].t : null;
  if (spec.g3) {
    if (!groupStageDone) return null;
    const g = thirdAssign[slotId];
    return g ? ranked[g][2].t : null;
  }
  if (spec.w) {
    const src = koById[spec.w];
    return src && src.winnerCode ? teamByCode[src.winnerCode] : null;
  }
  return null;
}

// Recompute group standings, best-8 thirds, and the entire knockout bracket from
// the current results. Pure function of matchesById + espnEvents (+ cache).
function computeQualification() {
  const ranked = {}, complete = {};
  Object.keys(GROUPS).forEach(l => { ranked[l] = groupRanked(l); complete[l] = groupComplete(l); });
  const groupStageDone = Object.keys(GROUPS).every(l => complete[l]);

  // Best 8 of the 12 third-placed teams.
  const thirds = Object.keys(GROUPS)
    .map(l => ({ l, s: ranked[l][2] && ranked[l][2].s }))
    .filter(x => x.s)
    .sort((a, b) =>
      b.s.pts - a.s.pts || b.s.gd - a.s.gd || b.s.gf - a.s.gf || a.l.localeCompare(b.l)
    );
  const best8 = thirds.slice(0, 8).map(x => x.l);
  QUAL = { best8: new Set(best8), groupStageDone };

  // Assign thirds to slots (only meaningful once the group stage is decided).
  // Prefer FIFA's official slotting for the actual qualifying set; otherwise
  // fall back to any valid bijection via backtracking.
  const thirdAssign = {};
  if (groupStageDone) {
    const official = THIRD_ALLOCATION[best8.slice().sort().join('')];
    if (official) {
      Object.assign(thirdAssign, official);
    } else {
      const res = assignThirdSlots(best8, THIRD_SLOTS.map(s => s.allowed));
      THIRD_SLOTS.forEach((s, i) => { thirdAssign[s.id] = res[i]; });
    }
  }

  // Resolve every knockout match in round order (R32 → Final).
  const koById = {};
  KNOCKOUT_ROUNDS.forEach(r => r.matches.forEach(m => { koById[m.id] = m; }));
  KNOCKOUT_ROUNDS.forEach(r => r.matches.forEach(m => {
    const f = FEEDS[m.id];
    m.home = m.away = null; m.homeScore = m.awayScore = null;
    m.homePens = m.awayPens = null;
    m.status = 'upcoming'; m.winnerCode = null;
    // Real kickoff instant: prefer ESPN's live schedule (bound by stadium +
    // nearest date, so TBD games update too); the hardcoded date/time is only
    // the fallback. ponytail: fallback hardcodes EDT (-04:00) — every WC2026
    // knockout date is in summer.
    const fallback = new Date(`${m.date} 2026 ${m.time.replace(/\s*ET$/, '')} GMT-0400`);
    m.kickoffUTC = koKickoff(m.venue, fallback, espnEvents);
    if (!f) return;
    m.home = resolveFeed(f.home, ranked, complete, thirdAssign, groupStageDone, koById, m.id);
    m.away = resolveFeed(f.away, ranked, complete, thirdAssign, groupStageDone, koById, m.id);
    if (!m.home || !m.away) return;
    let r2 = findResult(m.home.code, m.away.code, m.home.name, m.away.name, m.kickoffUTC);
    if (!r2 && koResultsCache[m.id]) r2 = koResultsCache[m.id]; // offline fallback
    if (!r2) return;
    m.status = r2.status;
    m.minute = r2.minute || null;
    if (r2.status !== 'upcoming') {
      m.homeScore = r2.scoreByCode[m.home.code] >= 0 ? r2.scoreByCode[m.home.code] : null;
      m.awayScore = r2.scoreByCode[m.away.code] >= 0 ? r2.scoreByCode[m.away.code] : null;
    }
    if (r2.status === 'final' && r2.winnerCode) m.winnerCode = r2.winnerCode;
    if (r2.shootoutByCode && (r2.shootoutByCode[m.home.code] != null || r2.shootoutByCode[m.away.code] != null)) {
      m.homePens = r2.shootoutByCode[m.home.code] ?? 0;
      m.awayPens = r2.shootoutByCode[m.away.code] ?? 0;
    }
    koResultsCache[m.id] = { status: r2.status, scoreByCode: r2.scoreByCode, shootoutByCode: r2.shootoutByCode, winnerCode: r2.winnerCode };
  }));
}

// ─── PERSISTENCE ──────────────────────────────────────────────────────────────
function saveResults() {
  try {
    const groups = {};
    Object.values(matchesById).forEach(m => {
      if (m.status !== 'upcoming')
        groups[m.id] = { s: m.status, h: m.homeScore, a: m.awayScore, m: m.minute, e: m.espnId };
    });
    localStorage.setItem(LS_KEY, JSON.stringify({ t: lastUpdated, groups, ko: koResultsCache }));
  } catch (e) { /* storage unavailable — stay in-memory */ }
}
function loadResults() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    Object.entries(d.groups || {}).forEach(([id, v]) => {
      const m = matchesById[id];
      if (!m) return;
      m.status = v.s === 'live' ? 'upcoming' : v.s; m.homeScore = v.h; m.awayScore = v.a; m.minute = v.m; m.espnId = v.e;
    });
    koResultsCache = d.ko || {};
    lastUpdated = d.t || null;
  } catch (e) { /* ignore corrupt cache */ }
}
function updateTimestamp() {
  const el = document.getElementById('lastUpdated');
  if (!el) return;
  if (!lastUpdated) { el.textContent = ''; return; }
  const t = formatTime(new Date(lastUpdated), userTZ);
  el.textContent = navigator.onLine === false ? `Offline · last ${t}` : `Updated ${t}`;
}

// ─── SCORE DISPLAY ────────────────────────────────────────────────────────────
function scoreDisplay(m) {
  if (m.status === 'live' && m.homeScore !== null) {
    return { text: `${m.homeScore} – ${m.awayScore}`, cls: 'live-score' };
  }
  if (m.status === 'final' && m.homeScore !== null) {
    const pens = m.homePens != null ? ` (${m.homePens}-${m.awayPens}p)` : '';
    return { text: `${m.homeScore} – ${m.awayScore}${pens}`, cls: 'final' };
  }
  return { text: formatTime(m.kickoffUTC, userTZ), cls: 'upcoming' };
}

// ─── RENDER GROUPS ────────────────────────────────────────────────────────────
function renderGroups() {
  const container = document.getElementById('groupsGrid');
  container.innerHTML = '';
  Object.entries(GROUPS).forEach(([letter, grp]) => {
    const matches = Object.values(matchesById).filter(m => m.group === letter);
    const card = document.createElement('div');
    card.className = 'group-card';
    card.innerHTML = `
      <div class="group-header">
        <div class="group-label">Group ${letter}</div>
        <div class="group-teams-mini">${grp.teams.map(t=>t.flag).join('')}</div>
      </div>
      <table class="standings-table">
        <colgroup>
          <col class="col-team">
          <col class="col-num"><col class="col-num"><col class="col-num">
          <col class="col-num"><col class="col-num"><col class="col-num">
        </colgroup>
        <thead>
          <tr>
            <th>Team</th>
            <th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th>
          </tr>
        </thead>
        <tbody>
          ${grp.teams
            .map(t => ({ t, s: getTeamStats(t.code, letter) }))
            .sort((a, b) =>
              b.s.pts - a.s.pts ||
              b.s.gd  - a.s.gd  ||
              b.s.gf  - a.s.gf  ||
              a.t.name.localeCompare(b.t.name)
            )
            .map(({ t, s }, i) => `<tr>
              <td><div class="team-cell"><span class="team-pos ${i<2?'pos-q':i===2?(QUAL.best8.has(letter)?'pos-q':'pos-m'):''}">${i+1}</span><span class="team-flag">${t.flag}</span><span class="team-name">${t.name}</span></div></td>
              <td>${s.p}</td><td>${s.w}</td><td>${s.d}</td><td>${s.l}</td>
              <td>${s.gd >= 0 ? '+'+s.gd : s.gd}</td>
              <td><strong>${s.pts}</strong></td>
            </tr>`)
            .join('')}
        </tbody>
      </table>
      <div class="group-matches">
        ${matches.map(m => {
          const sd = scoreDisplay(m);
          return `<div class="match-row" onclick="openModal('${m.id}')">
            ${m.status==='live' ? '<span class="live-pip"></span>' : ''}
            <div class="match-teams">
              <span class="match-team"><span>${m.home.flag}</span>${m.home.code}</span>
              <span class="match-vs">vs</span>
              <span class="match-team"><span>${m.away.flag}</span>${m.away.code}</span>
            </div>
            <div class="match-score ${sd.cls}">${sd.text}</div>
            <div class="match-time-info">
              <div class="match-date-str">${formatDate(m.kickoffUTC, userTZ)}</div>
            </div>
          </div>`;
        }).join('')}
      </div>
    `;
    container.appendChild(card);
  });
}

function getTeamStats(code, group) {
  const matches = Object.values(matchesById).filter(m =>
    m.group === group && (m.home.code === code || m.away.code === code) && m.status !== 'upcoming'
  );
  let w=0,d=0,l=0,gf=0,ga=0;
  matches.forEach(m => {
    const isHome = m.home.code === code;
    const myG = isHome ? m.homeScore : m.awayScore;
    const oppG = isHome ? m.awayScore : m.homeScore;
    if (myG === null || oppG === null) return;
    gf += myG; ga += oppG;
    if (myG > oppG) w++;
    else if (myG === oppG) d++;
    else l++;
  });
  return { p: w+d+l, w, d, l, gf, ga, gd: gf-ga, pts: w*3+d };
}

// ─── RENDER SCHEDULE ──────────────────────────────────────────────────────────
const IN_PROGRESS_MS = 2.25 * 60 * 60 * 1000; // ~135 min safety window for a lagging feed

// Classify a match relative to `now`. Live-data status wins; the kickoff clock
// is the fallback so a game still reads correctly when the ESPN feed lags.
function matchPhase(m, now) {
  // A game only leaves "today's schedule" once the calendar day rolls over —
  // so finished games still played *today* stay visible alongside the rest.
  const todayKey = new Date(now).toLocaleDateString('en-CA', { timeZone: userTZ });
  if (getDateKey(m.kickoffUTC, userTZ) < todayKey) return 'past';
  if (m.status === 'live') return 'live';
  if (m.status === 'final') return 'future';            // today's final — keep it in the day list
  const kickoff = m.kickoffUTC.getTime();
  if (now >= kickoff && now < kickoff + IN_PROGRESS_MS) return 'live'; // kicked off, feed lagging
  return 'future';
}

// Knockout matches live in KNOCKOUT_ROUNDS, not matchesById; look one up by id.
function knockoutMatchById(id) {
  for (const r of KNOCKOUT_ROUNDS) for (const m of r.matches) if (m.id === id) return m;
}
function openKnockoutById(id) { const m = knockoutMatchById(id); if (m) openKnockoutModal(m); }
// Short round badge from the match id (R32M1→R32, QF1→QF, FIN→F).
function koBadge(id) {
  return id.startsWith('R32') ? 'R32' : id.startsWith('R16') ? 'R16'
       : id.startsWith('QF') ? 'QF' : id.startsWith('SF') ? 'SF' : 'F';
}
// One team cell — flag + name when known, else the bracket feed label (TBD / Winner A …).
function teamCell(team, feedSpec) {
  return team
    ? `<div class="smc-team"><span class="smc-flag">${team.flag}</span>${team.name}</div>`
    : `<div class="smc-team smc-tbd">${feedLabel(feedSpec)}</div>`;
}

// Render a single schedule card. Handles both group matches and knockout matches
// (no group letter, possibly-undecided teams, no broadcaster, KO modal).
function scheduleCard(m, now) {
  const sd = scoreDisplay(m);
  const live = matchPhase(m, now) === 'live';
  const isKO = !m.group;
  const f = isKO ? (FEEDS[m.id] || {}) : {};
  const click = isKO ? `openKnockoutById('${m.id}')` : `openModal('${m.id}')`;
  return `<div class="schedule-match-card ${live?'is-live':''}" onclick="${click}">
    <div class="smc-group-badge">${isKO ? koBadge(m.id) : m.group}</div>
    <div class="smc-teams">
      ${teamCell(m.home, f.home)}
      ${teamCell(m.away, f.away)}
    </div>
    <div class="smc-right">
      <div class="smc-vs-score ${sd.cls}">${sd.text}</div>
      <div class="smc-venue">${isKO ? m.venue : m.city}</div>
    </div>
  </div>`;
}

// Build the day-grouped card markup for a set of matches (oldest → newest).
function buildDayGroups(matches, now) {
  const todayKey = new Date(now).toLocaleDateString('en-CA', { timeZone: userTZ });
  const byDay = {};
  matches.forEach(m => {
    const dk = getDateKey(m.kickoffUTC, userTZ);
    (byDay[dk] = byDay[dk] || []).push(m);
  });
  return Object.keys(byDay).sort().map(dk => {
    const dayMatches = byDay[dk].sort((a,b) => a.kickoffUTC - b.kickoffUTC);
    const dayLabel = dk === todayKey
      ? 'Today'
      : formatDate(dayMatches[0].kickoffUTC, userTZ);
    return `
      <div class="schedule-day">
        <div class="schedule-day-header">
          <div class="schedule-date-label">${dayLabel}</div>
          <div class="schedule-divider"></div>
        </div>
        <div class="schedule-matches-list">
          ${dayMatches.map(m => scheduleCard(m, now)).join('')}
        </div>
      </div>`;
  }).join('');
}

function togglePastSchedule() {
  pastExpanded = !pastExpanded;
  renderSchedule();
}
function toggleGroupSchedule() {
  groupExpanded = !groupExpanded;
  renderSchedule();
}

function renderSchedule() {
  const container = document.getElementById('scheduleList');
  const now = Date.now();

  // The group stage is over, so it's collapsed behind its own button at the
  // bottom; the knockout schedule is the default focus.
  // ponytail: collapse ALL group games unconditionally — safe because the group
  // stage has ended. Revisit only if this page is reused mid-group-stage.
  const groupGames = Object.values(matchesById);
  const ko = [];
  KNOCKOUT_ROUNDS.forEach(r => r.matches.forEach(m => { if (m.kickoffUTC) ko.push(m); }));

  // Knockout: finished games collapsed, live + upcoming shown by default.
  const koPast = [], koCurrent = [];
  ko.forEach(m => (matchPhase(m, now) === 'past' ? koPast : koCurrent).push(m));

  let html = '';

  // Finished knockout games, collapsed at the top — scroll up to read them.
  if (koPast.length) {
    html += `
      <div class="past-toggle-bar ${pastExpanded?'open':''}" onclick="togglePastSchedule()">
        <span class="ptb-arrow">▸</span>
        <span class="ptb-label">Past knockout games (${koPast.length})</span>
      </div>
      <div class="past-schedule ${pastExpanded?'open':''}">
        ${pastExpanded ? buildDayGroups(koPast, now) : ''}
      </div>`;
  }

  // Default visible list: live knockout game first, then upcoming knockout.
  if (koCurrent.length) {
    html += buildDayGroups(koCurrent, now);
  } else {
    html += `<p class="schedule-empty">All knockout matches complete.</p>`;
  }

  // Group stage — finished; collapsed behind its own button.
  if (groupGames.length) {
    html += `
      <div class="past-toggle-bar ${groupExpanded?'open':''}" onclick="toggleGroupSchedule()">
        <span class="ptb-arrow">▸</span>
        <span class="ptb-label">Group stage games (${groupGames.length})</span>
      </div>
      <div class="past-schedule ${groupExpanded?'open':''}">
        ${groupExpanded ? buildDayGroups(groupGames, now) : ''}
      </div>`;
  }

  container.innerHTML = html;
}

// ─── RENDER BRACKET ───────────────────────────────────────────────────────────
// Human-readable placeholder for a bracket slot whose team isn't decided yet.
function feedLabel(spec) {
  if (!spec) return 'TBD';
  if (spec.gw) return `Winner ${spec.gw}`;
  if (spec.gr) return `2nd ${spec.gr}`;
  if (spec.g3) return `3rd · ${spec.g3.join('/')}`;
  return 'TBD';
}
// Lay the bracket out as a wallchart: order each round so the two matches that
// feed the same next match are vertically adjacent (a post-order walk of the
// feed tree from the Final back to R32). Returns one ordered array per round,
// aligned to KNOCKOUT_ROUNDS' order [R32, R16, QF, SF, FIN].
function bracketDisplayOrder() {
  const order = { R32:[], R16:[], QF:[], SF:[], FIN:[] };
  const code = id => id.startsWith('R32') ? 'R32' : id.startsWith('R16') ? 'R16'
        : id.startsWith('QF') ? 'QF' : id.startsWith('SF') ? 'SF' : 'FIN';
  const byId = {};
  KNOCKOUT_ROUNDS.forEach(r => r.matches.forEach(m => { byId[m.id] = m; }));
  (function walk(id) {
    const f = FEEDS[id] || {};
    if (f.home && f.home.w) walk(f.home.w);
    if (f.away && f.away.w) walk(f.away.w);
    if (byId[id]) order[code(id)].push(byId[id]);
  })('FIN');
  return [order.R32, order.R16, order.QF, order.SF, order.FIN];
}

function renderBracket() {
  const container = document.getElementById('bracketEl');
  // The horizontal scroll lives on the wrapper; replacing the inner content
  // resets it to 0, so capture and restore it around the rebuild.
  const wrap = container.closest('.bracket-wrapper');
  const savedScrollLeft = wrap ? wrap.scrollLeft : 0;
  container.innerHTML = '';

  const ordered = bracketDisplayOrder();

  KNOCKOUT_ROUNDS.forEach((round, ri) => {
    const code = ['R32', 'R16', 'QF', 'SF', 'FIN'][ri];
    // Finished rounds fold into a thin tab so the bracket fits the screen;
    // tapping any round label toggles it. Auto-collapse, user tap overrides.
    const allFinal = ordered[ri].length > 0 && ordered[ri].every(m => m.status === 'final');
    const collapsed = bracketCollapsed[code] ?? allFinal;
    const toggle = () => { bracketCollapsed[code] = !collapsed; renderBracket(); };

    const col = document.createElement('div');
    if (collapsed) {
      col.className = 'bracket-round collapsed';
      col.innerHTML = `<div class="bracket-collapsed-tab">${round.label} ▸</div>`;
      col.onclick = toggle;
      container.appendChild(col);
      return;
    }
    col.className = 'bracket-round';
    const isFinal = round.label.includes('FINAL');

    col.innerHTML = `<div class="bracket-round-label">${round.label} <span class="brl-chev">▾</span></div>`;
    col.querySelector('.bracket-round-label').onclick = toggle;
    const body = document.createElement('div');
    body.className = 'bracket-body';

    ordered[ri].forEach(m => {
      const cell = document.createElement('div');
      cell.className = 'bracket-cell';

      const mc = document.createElement('div');
      mc.className = `bracket-match${isFinal?' final-card':''}${m.status==='live'?' is-live':''}`;
      mc.onclick = () => openKnockoutModal(m);

      const f = FEEDS[m.id] || {};
      const homeLabel = m.home ? `${m.home.flag} ${m.home.name}` : feedLabel(f.home);
      const awayLabel = m.away ? `${m.away.flag} ${m.away.name}` : feedLabel(f.away);
      const homeWin = m.winnerCode && m.home && m.home.code === m.winnerCode;
      const awayWin = m.winnerCode && m.away && m.away.code === m.winnerCode;
      // Penalty tally shown beside the score, e.g. "1 (4)" — only when a shootout happened.
      const homePen = m.homePens != null ? ` <span class="bt-pens">(${m.homePens})</span>` : '';
      const awayPen = m.awayPens != null ? ` <span class="bt-pens">(${m.awayPens})</span>` : '';

      mc.innerHTML = `
        <div class="bracket-date-line">${m.status==='live'?'<span class="live-pip"></span>':''}${formatDate(m.kickoffUTC, userTZ)} · ${formatTime(m.kickoffUTC, userTZ)}${m.homePens!=null?' · pens':''}</div>
        <div class="bracket-team ${!m.home?'tbd':''}${homeWin?' winner':''}">${homeLabel}<span class="bt-score">${m.homeScore ?? ''}${homePen}</span></div>
        <div class="bracket-team ${!m.away?'tbd':''}${awayWin?' winner':''}">${awayLabel}<span class="bt-score">${m.awayScore ?? ''}${awayPen}</span></div>
      `;
      cell.appendChild(mc);
      body.appendChild(cell);
    });

    col.appendChild(body);
    container.appendChild(col);
  });

  if (wrap) wrap.scrollLeft = savedScrollLeft;
}

// ─── WIN PROBABILITY ──────────────────────────────────────────────────────────

// Read an American moneyline off an ESPN odds object, tolerating both the legacy
// (`moneyLine`) and current (`current.moneyLine.value/american`) shapes, plus
// string values like "+150" / "-110". Returns a finite Number or null.
function parseML(odds) {
  if (!odds) return null;
  let v = odds.moneyLine
    ?? odds.current?.moneyLine?.value
    ?? odds.current?.moneyLine?.american;
  if (v == null) return null;
  if (typeof v === 'string') v = Number(v.replace(/[+\s]/g, ''));
  return Number.isFinite(v) ? Number(v) : null;
}

// Convert American moneyline to raw implied probability
function mlToProb(ml) {
  if (ml < 0) return Math.abs(ml) / (Math.abs(ml) + 100);
  return 100 / (ml + 100);
}

// Devig: normalize probabilities so they sum to 1
function devig(home, draw, away) {
  const total = home + draw + away;
  return {
    home: home / total,
    draw: draw / total,
    away: away / total,
  };
}

// ESPN espnId cache: date string → array of events
const espnEventCache = {};
// Odds cache: espnId → { homeML, drawML, awayML, source, isLive, fetched }
const oddsCache = {};
// Summary cache: match id → { promise, fetched }. Odds and the events timeline
// both read the same ESPN summary response, so fetch it once per match.
const summaryCache = {};

// Ensure m.espnId is set: fetch the scoreboard for the match date if needed.
async function bindEspnId(m) {
  // ESPN buckets events by Eastern calendar day, not UTC day — a 9pm ET kickoff
  // is already past midnight UTC, so the UTC date is a day ahead of ESPN's
  // bucket. Derive the date from the Eastern calendar day directly (same
  // conversion as getDateKey) instead of slicing the UTC ISO string, and check
  // a day on each side for slop.
  if (!m.espnId) {
    for (let offset = -1; offset <= 1 && !m.espnId; offset++) {
      const d = new Date(m.kickoffUTC.getTime() + offset * 86400000);
      const dateStr = getDateKey(d, 'America/New_York').replace(/-/g,'');
      if (!espnEventCache[dateStr]) {
        try {
          const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/FIFA.World/scoreboard?dates=${dateStr}`);
          const data = await r.json();
          espnEventCache[dateStr] = data.events || [];
          processESPNData(data);
        } catch(e) { /* ignore */ }
      } else {
        processESPNData({ events: espnEventCache[dateStr] });
      }
      // processESPNData only binds group fixtures (matchesById). Knockout match
      // objects aren't in there, so bind their espnId here by team identity.
      if (!m.espnId && m.home && m.away) {
        const ev = (espnEventCache[dateStr] || []).find(ev => {
          const cs = ev.competitions?.[0]?.competitors || [];
          if (cs.length < 2) return false;
          const [a, b] = cs;
          const ca = a.team?.abbreviation, cb = b.team?.abbreviation;
          const na = a.team?.displayName || a.team?.name, nb = b.team?.displayName || b.team?.name;
          return (sameTeam(m.home, ca, na) && sameTeam(m.away, cb, nb)) ||
                 (sameTeam(m.home, cb, nb) && sameTeam(m.away, ca, na));
        });
        if (ev) m.espnId = ev.id;
      }
    }
  }

}

// Fetch the ESPN summary (odds, key events) for a match. The in-flight promise
// is cached for 60s so concurrent odds + events callers share one request.
function fetchSummary(m) {
  const c = summaryCache[m.id];
  if (c && (Date.now() - c.fetched) < 60000) return c.promise;
  const promise = (async () => {
    if (!m.espnId) await bindEspnId(m);
    if (!m.espnId) return null;
    try {
      const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/FIFA.World/summary?event=${m.espnId}`);
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      return null;
    }
  })();
  summaryCache[m.id] = { promise, fetched: Date.now() };
  return promise;
}

async function fetchOddsForMatch(m) {
  // If we already have fresh odds (< 90s old), return cached
  const cached = oddsCache[m.id];
  if (cached && (Date.now() - cached.fetched) < 90000) return cached;

  const data = await fetchSummary(m);
  if (!data) return null;

  const pc = (data.pickcenter || data.odds || [])[0];
  if (!pc) return null;

  const homeML = parseML(pc.homeTeamOdds);
  const awayML = parseML(pc.awayTeamOdds);
  const drawML = parseML(pc.drawOdds);

  if (homeML == null || awayML == null || drawML == null) return null;

  const raw = devig(mlToProb(homeML), mlToProb(drawML), mlToProb(awayML));

  const result = {
    home: raw.home, draw: raw.draw, away: raw.away,
    homeML, drawML, awayML,
    source: pc.provider?.name || 'Sportsbook',
    isLive: m.status === 'live',
    fetched: Date.now(),
  };
  oddsCache[m.id] = result;
  return result;
}

function renderProbability(m, odds) {
  const probContent = document.getElementById('probContent');
  const probSource  = document.getElementById('probSource');
  const probLiveDot = document.getElementById('probLiveDot');

  if (!odds) {
    probContent.innerHTML = `<div class="prob-error">Odds not available yet — check back closer to kickoff</div>`;
    probSource.textContent = '';
    probLiveDot.style.display = 'none';
    return;
  }

  const homePct  = Math.round(odds.home * 100);
  const drawPct  = Math.round(odds.draw * 100);
  const awayPct  = Math.max(0, 100 - homePct - drawPct); // remainder, never negative

  probSource.textContent = odds.isLive ? `Live · ${odds.source}` : odds.source;
  probLiveDot.style.display = odds.isLive ? 'inline-block' : 'none';

  probContent.innerHTML = `
    <div class="prob-row">
      <div class="prob-label"><span class="flag">${m.home.flag}</span><span class="name">${m.home.name}</span></div>
      <div class="prob-bar-wrap"><div class="prob-bar-fill home" id="pb-home" style="width:0%"></div></div>
      <div class="prob-pct" id="pp-home">0%</div>
    </div>
    <div class="prob-row">
      <div class="prob-label"><span class="flag">🤝</span><span class="name">Draw</span></div>
      <div class="prob-bar-wrap"><div class="prob-bar-fill draw" id="pb-draw" style="width:0%"></div></div>
      <div class="prob-pct draw" id="pp-draw">0%</div>
    </div>
    <div class="prob-row">
      <div class="prob-label"><span class="flag">${m.away.flag}</span><span class="name">${m.away.name}</span></div>
      <div class="prob-bar-wrap"><div class="prob-bar-fill away" id="pb-away" style="width:0%"></div></div>
      <div class="prob-pct away" id="pp-away">0%</div>
    </div>
  `;

  // Animate bars after a tick
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.getElementById('pb-home').style.width = homePct + '%';
      document.getElementById('pb-draw').style.width = drawPct + '%';
      document.getElementById('pb-away').style.width = awayPct + '%';
      document.getElementById('pp-home').textContent = homePct + '%';
      document.getElementById('pp-draw').textContent = drawPct + '%';
      document.getElementById('pp-away').textContent = awayPct + '%';
    });
  });
}

// ─── MATCH EVENTS TIMELINE ────────────────────────────────────────────────────
// Pull goals and cards out of an ESPN summary's keyEvents. Defensive: shapes
// vary by event type, so every field access is optional.
function parseMatchEvents(data) {
  return (data?.keyEvents || []).map(ev => {
    const type = ev.type?.text || '';
    let icon = null;
    if (/goal/i.test(type) || /^penalty - scored/i.test(type)) icon = '⚽';
    else if (/yellow card/i.test(type)) icon = '🟨';
    else if (/red card/i.test(type)) icon = '🟥';
    if (!icon) return null;
    return {
      icon,
      minute: ev.clock?.displayValue || '',
      teamName: ev.team?.displayName || '',
      player: ev.participants?.[0]?.athlete?.displayName || '',
      own: /own goal/i.test(type),
      pen: /penalty/i.test(type),
      text: ev.text || '',
    };
  }).filter(Boolean);
}

function renderEvents(m, data) {
  const section = document.getElementById('eventsSection');
  const list = document.getElementById('eventsList');
  const evts = parseMatchEvents(data);
  if (!evts.length) { section.style.display = 'none'; list.innerHTML = ''; return; }
  list.innerHTML = evts.map(e => {
    // Attribute the event to one of our two teams to show its flag.
    const flag = sameTeam(m.home, '', e.teamName) ? m.home.flag
               : sameTeam(m.away, '', e.teamName) ? m.away.flag : '';
    const note = e.own ? ' (own goal)' : e.pen ? ' (pen)' : '';
    return `<div class="event-row">
      <span class="event-min">${e.minute}</span>
      <span class="event-icon">${e.icon}</span>
      <span class="event-player">${e.player || e.text}${note}</span>
      <span class="event-flag">${flag}</span>
    </div>`;
  }).join('');
  section.style.display = '';
}

// ─── MODAL ────────────────────────────────────────────────────────────────────
function openModal(matchId) {
  const m = matchesById[matchId];
  if (!m) return;
  currentModalId = matchId;

  const sd = scoreDisplay(m);
  const isTubi = TUBI_MATCHES.includes(matchId);

  document.getElementById('mRound').textContent = `Group ${m.group} · Match Day ${getMatchday(matchId)}`;
  document.getElementById('mHomeFlag').textContent = m.home.flag;
  document.getElementById('mHomeName').textContent = m.home.name;
  document.getElementById('mHomeCode').textContent = m.home.code;
  document.getElementById('mAwayFlag').textContent = m.away.flag;
  document.getElementById('mAwayName').textContent = m.away.name;
  document.getElementById('mAwayCode').textContent = m.away.code;

  const scoreEl = document.getElementById('mScore');
  scoreEl.textContent = sd.cls === 'live-score' || sd.cls === 'final' ? sd.text : 'VS';
  scoreEl.className = `modal-score-display ${sd.cls}`;
  document.getElementById('mPens').style.display = 'none'; // group games never go to penalties

  const badge = document.getElementById('mStatusBadge');
  if (m.status === 'live') {
    badge.textContent = m.minute ? `LIVE · ${m.minute}` : 'LIVE';
    badge.className = 'modal-status-badge live';
  } else if (m.status === 'final') {
    badge.textContent = 'Final';
    badge.className = 'modal-status-badge final';
  } else {
    badge.textContent = formatTime(m.kickoffUTC, userTZ);
    badge.className = 'modal-status-badge upcoming';
  }

  document.getElementById('mMeta').innerHTML = `
    <div class="modal-meta-row"><span class="modal-meta-icon">📅</span><span class="modal-meta-val">${formatDateFull(m.kickoffUTC, userTZ)}</span></div>
    <div class="modal-meta-row"><span class="modal-meta-icon">⏰</span><span class="modal-meta-val">${formatTime(m.kickoffUTC, userTZ)}</span></div>
    <div class="modal-meta-row"><span class="modal-meta-icon">📍</span><span class="modal-meta-val">${m.venue}, ${m.city}</span></div>
    <div class="modal-meta-row"><span class="modal-meta-icon">📡</span><span class="modal-meta-val">${m.broadcaster}</span></div>
  `;

  // Free links
  const freeLinks = [...FREE_STREAMS];
  if (!isTubi) {
    // For non-Tubi matches, add a note that Tubi is only select matches
    freeLinks[0] = { ...freeLinks[0], note: 'Select matches only · not this game' };
  }

  document.getElementById('mFreeLinks').innerHTML = freeLinks.map(s => `
    <a class="watch-link free-link" href="${s.url}" target="_blank" rel="noopener">
      <span class="wl-icon">${s.icon}</span>
      <span class="wl-info"><div class="wl-name">${s.name}</div><div class="wl-note">${s.note}</div></span>
      <span class="wl-badge free">${s.badge}</span>
      <span class="wl-arrow">→</span>
    </a>
  `).join('');

  document.getElementById('mPaidLinks').innerHTML = PAID_STREAMS.map(s => `
    <a class="watch-link" href="${s.url}" target="_blank" rel="noopener">
      <span class="wl-icon">${s.icon}</span>
      <span class="wl-info"><div class="wl-name">${s.name}</div><div class="wl-note">${s.note}</div></span>
      <span class="wl-badge ${s.type}">${s.badge}</span>
      <span class="wl-arrow">→</span>
    </a>
  `).join('');

  document.getElementById('modalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';

  // Kick off odds fetch — show loading state immediately
  document.getElementById('probContent').innerHTML = '<div class="prob-loading">Loading odds…</div>';
  document.getElementById('probSource').textContent = '';
  document.getElementById('probLiveDot').style.display = 'none';
  fetchOddsForMatch(m).then(odds => {
    // Only update if same modal is still open
    if (currentModalId === matchId) renderProbability(m, odds);
  });

  // Events timeline (goals, cards) from the same summary fetch
  document.getElementById('eventsSection').style.display = 'none';
  fetchSummary(m).then(data => {
    if (currentModalId === matchId) renderEvents(m, data);
  });
}

function openKnockoutModal(m) {
  // Simplified modal for knockout matches. Track the open id so the live-odds
  // refresh in fetchScores targets the right match (knockout ids aren't in
  // matchesById, so that branch safely no-ops instead of acting on a stale id).
  currentModalId = m.id;
  document.getElementById('mRound').textContent = 'Knockout Stage';
  document.getElementById('mHomeFlag').textContent = m.home?.flag || '🏳️';
  document.getElementById('mHomeName').textContent = m.home?.name || 'TBD';
  document.getElementById('mHomeCode').textContent = '';
  document.getElementById('mAwayFlag').textContent = m.away?.flag || '🏳️';
  document.getElementById('mAwayName').textContent = m.away?.name || 'TBD';
  document.getElementById('mAwayCode').textContent = '';

  const scoreEl = document.getElementById('mScore');
  if (m.status !== 'upcoming' && m.homeScore != null) {
    scoreEl.textContent = `${m.homeScore} – ${m.awayScore}`;
    scoreEl.className = `modal-score-display ${m.status === 'live' ? 'live-score' : 'final'}`;
  } else {
    scoreEl.textContent = 'VS';
    scoreEl.className = 'modal-score-display upcoming';
  }

  // Penalty shootout result on its own line below the score, so it never
  // overflows the score column.
  const pensEl = document.getElementById('mPens');
  if (m.homePens != null) {
    pensEl.textContent = `Penalties ${m.homePens}–${m.awayPens}`;
    pensEl.style.display = 'block';
  } else {
    pensEl.style.display = 'none';
  }

  const badge = document.getElementById('mStatusBadge');
  badge.textContent = m.status === 'final' ? 'Full Time'
    : m.status === 'live' ? (m.minute || 'LIVE')
    : `${formatDate(m.kickoffUTC, userTZ)} · ${formatTime(m.kickoffUTC, userTZ)}`;
  badge.className = `modal-status-badge ${m.status === 'upcoming' ? 'upcoming' : m.status}`;

  document.getElementById('mMeta').innerHTML = `
    <div class="modal-meta-row"><span class="modal-meta-icon">📅</span><span class="modal-meta-val">${formatDateFull(m.kickoffUTC, userTZ)}</span></div>
    <div class="modal-meta-row"><span class="modal-meta-icon">⏰</span><span class="modal-meta-val">${formatTime(m.kickoffUTC, userTZ)}</span></div>
    <div class="modal-meta-row"><span class="modal-meta-icon">📍</span><span class="modal-meta-val">${m.venue}</span></div>
    <div class="modal-meta-row"><span class="modal-meta-icon">📡</span><span class="modal-meta-val">FOX / FS1</span></div>
  `;

  document.getElementById('mFreeLinks').innerHTML = FREE_STREAMS.map(s => `
    <a class="watch-link free-link" href="${s.url}" target="_blank" rel="noopener">
      <span class="wl-icon">${s.icon}</span>
      <span class="wl-info"><div class="wl-name">${s.name}</div><div class="wl-note">${s.note}</div></span>
      <span class="wl-badge free">${s.badge}</span>
      <span class="wl-arrow">→</span>
    </a>
  `).join('');

  document.getElementById('mPaidLinks').innerHTML = PAID_STREAMS.map(s => `
    <a class="watch-link" href="${s.url}" target="_blank" rel="noopener">
      <span class="wl-icon">${s.icon}</span>
      <span class="wl-info"><div class="wl-name">${s.name}</div><div class="wl-note">${s.note}</div></span>
      <span class="wl-badge ${s.type}">${s.badge}</span>
      <span class="wl-arrow">→</span>
    </a>
  `).join('');

  // Win probability: fetch real odds once both teams are confirmed (same path
  // as group games); until then there's nothing to price.
  document.getElementById('probSource').textContent = '';
  document.getElementById('probLiveDot').style.display = 'none';
  document.getElementById('eventsSection').style.display = 'none';
  if (m.home && m.away) {
    document.getElementById('probContent').innerHTML = '<div class="prob-loading">Loading odds…</div>';
    fetchOddsForMatch(m).then(odds => {
      if (currentModalId === m.id) renderProbability(m, odds);
    });
    fetchSummary(m).then(data => {
      if (currentModalId === m.id) renderEvents(m, data);
    });
  } else {
    document.getElementById('probContent').innerHTML = `<div class="prob-error">Odds available once teams are confirmed</div>`;
  }

  document.getElementById('modalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

// Update just the score, penalties, and status badge of the open modal after a
// poll, so a live game's modal tracks the match without a full re-open (which
// would reset the user's modal scroll).
function refreshOpenModalScore(m) {
  const scoreEl = document.getElementById('mScore');
  if (m.status !== 'upcoming' && m.homeScore != null) {
    scoreEl.textContent = `${m.homeScore} – ${m.awayScore}`;
    scoreEl.className = `modal-score-display ${m.status === 'live' ? 'live-score' : 'final'}`;
  }
  if (m.homePens != null) {
    const pensEl = document.getElementById('mPens');
    pensEl.textContent = `Penalties ${m.homePens}–${m.awayPens}`;
    pensEl.style.display = 'block';
  }
  const badge = document.getElementById('mStatusBadge');
  if (m.status === 'live') {
    badge.textContent = m.minute ? `LIVE · ${m.minute}` : 'LIVE';
    badge.className = 'modal-status-badge live';
  } else if (m.status === 'final') {
    badge.textContent = m.group ? 'Final' : 'Full Time';
    badge.className = 'modal-status-badge final';
  }
}

function getMatchday(id) {
  const num = parseInt(id.replace(/[A-Z]/g,''));
  if (num <= 2) return 1;
  if (num <= 4) return 2;
  return 3;
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
  document.body.style.overflow = '';
  currentModalId = null;
}

function closeModalOnBg(e) {
  if (e.target === document.getElementById('modalOverlay')) closeModal();
}

// ─── TABS ─────────────────────────────────────────────────────────────────────
function showTab(name, btn) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`panel-${name}`).classList.add('active');
  btn.classList.add('active');
}

// ─── RENDER ALL ───────────────────────────────────────────────────────────────
// A compact fingerprint of everything the three panels render. When it's
// unchanged (the common case between 60s polls), skip the full innerHTML
// rebuild so the user's bracket scroll, hover, and taps aren't interrupted.
function renderSignature() {
  const now = Date.now();
  const parts = [userTZ, pastExpanded ? '1' : '0', groupExpanded ? '1' : '0'];
  Object.values(matchesById)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .forEach(m => parts.push(
      `${m.id}:${m.status}:${m.homeScore}:${m.awayScore}:${m.minute}:${matchPhase(m, now)}`
    ));
  KNOCKOUT_ROUNDS.forEach(r => r.matches.forEach(m => parts.push(
    `${m.id}:${m.home?.code || ''}:${m.away?.code || ''}:${m.status}:${m.homeScore}:${m.awayScore}:${m.homePens}:${m.awayPens}:${m.winnerCode || ''}:${m.kickoffUTC ? m.kickoffUTC.getTime() : ''}`
  )));
  parts.push('q:' + [...QUAL.best8].sort().join(',') + ':' + (QUAL.groupStageDone ? '1' : '0'));
  return parts.join('|');
}

function renderAll() {
  const sig = renderSignature();
  if (sig === lastRenderSig) return; // nothing the panels show has changed
  lastRenderSig = sig;
  renderGroups();
  renderSchedule();
  renderBracket();
  renderLiveStrip();
}

// ─── LIVE STRIP ───────────────────────────────────────────────────────────────
function getLiveMatches() {
  const ko = [];
  KNOCKOUT_ROUNDS.forEach(r => r.matches.forEach(m => { if (m.status === 'live') ko.push(m); }));
  return Object.values(matchesById)
    .filter(m => m.status === 'live')
    .concat(ko)
    .sort((a, b) => a.kickoffUTC - b.kickoffUTC);
}

// Earliest match that hasn't kicked off yet (group or knockout).
function nextUpcoming() {
  const now = Date.now();
  const all = Object.values(matchesById)
    .concat(KNOCKOUT_ROUNDS.flatMap(r => r.matches));
  return all
    .filter(m => m.status === 'upcoming' && m.kickoffUTC && !isNaN(m.kickoffUTC) && m.kickoffUTC > now)
    .sort((a, b) => a.kickoffUTC - b.kickoffUTC)[0] || null;
}

function renderLiveStrip() {
  const row = document.getElementById('nowStrip');
  if (!row) return;
  const live = getLiveMatches();
  if (live.length === 0) {
    // No live game — show the next kickoff instead.
    const n = nextUpcoming();
    if (!n) { row.innerHTML = ''; return; }
    row.innerHTML = `
      <div class="next-card" data-match-id="${n.id}">
        <div class="lmc-team">
          <span class="lmc-flag">${n.home?.flag || '🏳️'}</span>
          <span class="lmc-name">${n.home?.code || 'TBD'}</span>
        </div>
        <div class="lmc-center">
          <span class="next-chip">Next</span>
          <span class="next-time">${formatDate(n.kickoffUTC, userTZ)} · ${formatTime(n.kickoffUTC, userTZ)}</span>
        </div>
        <div class="lmc-team">
          <span class="lmc-flag">${n.away?.flag || '🏳️'}</span>
          <span class="lmc-name">${n.away?.code || 'TBD'}</span>
        </div>
      </div>`;
    const card = row.querySelector('.next-card');
    const ko = knockoutMatchById(n.id);
    card.addEventListener('click', () => ko ? openKnockoutModal(ko) : openModal(n.id));
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
    const id = card.dataset.matchId;
    const koMatch = knockoutMatchById(id);
    card.addEventListener('click', () => koMatch ? openKnockoutModal(koMatch) : openModal(id));
  });
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
buildMatches();
loadResults();          // hydrate cached results so the page starts populated
computeQualification(); // build standings + bracket from cache before first paint
renderAll();
updateTimestamp();

// Fetch scores immediately, then every 60s
fetchScores();
setInterval(fetchScores, 60000);

// Refresh as soon as the tab is re-focused or the network comes back (covers
// laptop-sleep / lost-connection cases so data is never silently stale).
document.addEventListener('visibilitychange', () => { if (!document.hidden) fetchScores(); });
window.addEventListener('online', () => { updateTimestamp(); fetchScores(); });
window.addEventListener('offline', updateTimestamp);

// Keyboard: Escape closes modal
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});
