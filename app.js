// ─── STATE ───────────────────────────────────────────────────────────────────
let userTZ = 'America/New_York';
let liveScores = {}; // espnEventId or teamKey -> score info
let matchesById = {}; // id -> match object
let currentModalId = null;
let refreshTimer = null;
let pastExpanded = false; // Full Schedule: whether finished games are revealed
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

function onTimezoneChange(tz) {
  userTZ = tz;
  renderAll();
}

// ─── ESPN LIVE SCORES ─────────────────────────────────────────────────────────
let fetchInFlight = false;
async function fetchScores() {
  if (fetchInFlight) return;          // avoid overlapping polls
  fetchInFlight = true;
  try {
    // One range request returns every group + knockout match for the whole
    // tournament (with scores + a winner flag), so completed games always count.
    const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/FIFA.World/scoreboard?dates=${TOURNAMENT_START}-${TOURNAMENT_END}`;
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

    // If a match modal is open and the game is live, refresh odds too
    if (currentModalId) {
      const openMatch = matchesById[currentModalId];
      if (openMatch && openMatch.status === 'live') {
        // Bust cache so we get fresh in-play odds
        delete oddsCache[currentModalId];
        fetchOddsForMatch(openMatch).then(odds => {
          if (currentModalId === openMatch.id) renderProbability(openMatch, odds);
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
  const hasLive = Object.values(matchesById).some(m => m.status === 'live');
  document.getElementById('liveBadge').style.display = hasLive ? 'flex' : 'none';
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
    let winnerCode = null;
    if (a.winner) winnerCode = ca; else if (b.winner) winnerCode = cb;
    return { status, scoreByCode, winnerCode };
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
  const thirdAssign = {};
  if (groupStageDone) {
    const res = assignThirdSlots(best8, THIRD_SLOTS.map(s => s.allowed));
    THIRD_SLOTS.forEach((s, i) => { thirdAssign[s.id] = res[i]; });
  }

  // Resolve every knockout match in round order (R32 → Final).
  const koById = {};
  KNOCKOUT_ROUNDS.forEach(r => r.matches.forEach(m => { koById[m.id] = m; }));
  KNOCKOUT_ROUNDS.forEach(r => r.matches.forEach(m => {
    const f = FEEDS[m.id];
    m.home = m.away = null; m.homeScore = m.awayScore = null;
    m.status = 'upcoming'; m.winnerCode = null;
    // Real kickoff instant so knockout games sort into the full schedule.
    // ponytail: hardcode EDT (-04:00) — every WC2026 knockout date is in summer.
    m.kickoffUTC = new Date(`${m.date} 2026 ${m.time.replace(/\s*ET$/, '')} GMT-0400`);
    if (!f) return;
    m.home = resolveFeed(f.home, ranked, complete, thirdAssign, groupStageDone, koById, m.id);
    m.away = resolveFeed(f.away, ranked, complete, thirdAssign, groupStageDone, koById, m.id);
    if (!m.home || !m.away) return;
    const koDate = m.date ? new Date(`${m.date}, 2026`) : null;
    let r2 = findResult(m.home.code, m.away.code, m.home.name, m.away.name,
                        koDate && !isNaN(koDate.getTime()) ? koDate : null);
    if (!r2 && koResultsCache[m.id]) r2 = koResultsCache[m.id]; // offline fallback
    if (!r2) return;
    m.status = r2.status;
    if (r2.status !== 'upcoming') {
      m.homeScore = r2.scoreByCode[m.home.code] >= 0 ? r2.scoreByCode[m.home.code] : null;
      m.awayScore = r2.scoreByCode[m.away.code] >= 0 ? r2.scoreByCode[m.away.code] : null;
    }
    if (r2.status === 'final' && r2.winnerCode) m.winnerCode = r2.winnerCode;
    koResultsCache[m.id] = { status: r2.status, scoreByCode: r2.scoreByCode, winnerCode: r2.winnerCode };
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
    return { text: `${m.homeScore} – ${m.awayScore}`, cls: 'final' };
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
              <div class="match-broadcaster" style="font-size:0.65rem;color:var(--gold);font-weight:700">${m.broadcaster}</div>
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
      <div class="smc-vs-score ${sd.cls}">${sd.text}</div>
      ${teamCell(m.away, f.away)}
    </div>
    <div class="smc-right">
      <div class="smc-time">${formatTime(m.kickoffUTC, userTZ)}</div>
      <div class="smc-venue">${isKO ? m.venue : m.city}</div>
      ${isKO ? '' : `<span class="smc-broadcaster">${m.broadcaster}</span>`}
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
      ? `Today · ${formatDateFull(dayMatches[0].kickoffUTC, userTZ)}`
      : formatDateFull(dayMatches[0].kickoffUTC, userTZ);
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

function renderSchedule() {
  const container = document.getElementById('scheduleList');
  const now = Date.now();

  // Partition into finished vs. (live + upcoming). Live and future render
  // together so the in-progress game sits at the top of the default view.
  // Group-stage matches plus every knockout game that now has a kickoff instant,
  // so the full schedule spans group + bracket days.
  const all = Object.values(matchesById);
  KNOCKOUT_ROUNDS.forEach(r => r.matches.forEach(m => { if (m.kickoffUTC) all.push(m); }));

  const past = [], current = [];
  all.forEach(m => {
    (matchPhase(m, now) === 'past' ? past : current).push(m);
  });

  let html = '';

  // Collapsed past-games section pinned to the top — scroll up to read it.
  if (past.length) {
    html += `
      <div class="past-toggle-bar ${pastExpanded?'open':''}" onclick="togglePastSchedule()">
        <span class="ptb-arrow">▸</span>
        <span class="ptb-label">Past games (${past.length})</span>
      </div>
      <div class="past-schedule ${pastExpanded?'open':''}">
        ${pastExpanded ? buildDayGroups(past, now) : ''}
      </div>`;
  }

  // Default visible list: in-progress game first, then upcoming matches.
  if (current.length) {
    html += buildDayGroups(current, now);
  } else {
    html += `<p class="schedule-empty">All matches complete — see past games above.</p>`;
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
function renderBracket() {
  const container = document.getElementById('bracketEl');
  // The horizontal scroll lives on the wrapper; replacing the inner content
  // resets it to 0, so capture and restore it around the rebuild.
  const wrap = container.closest('.bracket-wrapper');
  const savedScrollLeft = wrap ? wrap.scrollLeft : 0;
  container.innerHTML = '';

  KNOCKOUT_ROUNDS.forEach(round => {
    const col = document.createElement('div');
    col.className = 'bracket-round';
    const isFinal = round.label.includes('FINAL');

    col.innerHTML = `<div class="bracket-round-label">${round.label}</div>`;

    round.matches.forEach(m => {
      const mc = document.createElement('div');
      mc.className = `bracket-match${isFinal?' final-card':''}${m.status==='live'?' is-live':''}`;
      mc.onclick = () => openKnockoutModal(m);

      const f = FEEDS[m.id] || {};
      const homeLabel = m.home ? `${m.home.flag} ${m.home.name}` : feedLabel(f.home);
      const awayLabel = m.away ? `${m.away.flag} ${m.away.name}` : feedLabel(f.away);
      const homeWin = m.winnerCode && m.home && m.home.code === m.winnerCode;
      const awayWin = m.winnerCode && m.away && m.away.code === m.winnerCode;

      mc.innerHTML = `
        <div class="bracket-date-line">${m.status==='live'?'<span class="live-pip"></span>':''}${m.date} · ${m.time}</div>
        <div class="bracket-team ${!m.home?'tbd':''}${homeWin?' winner':''}">${homeLabel}<span class="bt-score">${m.homeScore ?? ''}</span></div>
        <div class="bracket-team ${!m.away?'tbd':''}${awayWin?' winner':''}">${awayLabel}<span class="bt-score">${m.awayScore ?? ''}</span></div>
      `;
      col.appendChild(mc);
    });

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

async function fetchOddsForMatch(m) {
  // If we already have fresh odds (< 90s old), return cached
  const cached = oddsCache[m.id];
  if (cached && (Date.now() - cached.fetched) < 90000) return cached;

  // Step 1: ensure we have espnId — fetch scoreboard for match date if needed
  // ESPN groups by Eastern midnight, so try stored date + next day as fallback
  if (!m.espnId) {
    for (let offset = 0; offset <= 1 && !m.espnId; offset++) {
      const d = new Date(m.kickoffUTC.getTime() + offset * 86400000);
      const dateStr = d.toISOString().slice(0,10).replace(/-/g,'');
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
    }
  }

  if (!m.espnId) return null;

  // Step 2: fetch summary for this event
  try {
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/FIFA.World/summary?event=${m.espnId}`);
    if (!r.ok) return null;
    const data = await r.json();

    const pc = (data.pickcenter || data.odds || [])[0];
    if (!pc) return null;

    const homeML = parseML(pc.homeTeamOdds);
    const awayML = parseML(pc.awayTeamOdds);
    const drawML = parseML(pc.drawOdds);

    if (homeML == null || awayML == null || drawML == null) return null;

    const raw = devig(mlToProb(homeML), mlToProb(drawML), mlToProb(awayML));
    const provName = pc.provider?.name || 'Sportsbook';
    const isLive = m.status === 'live';

    const result = {
      home: raw.home, draw: raw.draw, away: raw.away,
      homeML, drawML, awayML,
      source: provName,
      isLive,
      fetched: Date.now(),
    };
    oddsCache[m.id] = result;
    return result;
  } catch(e) {
    return null;
  }
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
    <div class="modal-meta-row"><span class="modal-meta-icon">📡</span><span class="modal-meta-val">Broadcasting on ${m.broadcaster}</span></div>
  `;

  // Free links
  const freeLinks = [...FREE_STREAMS];
  if (!isTubi) {
    // For non-Tubi matches, add a note that Tubi is only select matches
    freeLinks[0] = { ...freeLinks[0], note: 'Select matches only (not this game) – check Tubi for availability' };
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

  const badge = document.getElementById('mStatusBadge');
  badge.textContent = m.status === 'final' ? 'Full Time'
    : m.status === 'live' ? (m.minute || 'LIVE')
    : `${m.date} · ${m.time}`;
  badge.className = `modal-status-badge ${m.status === 'upcoming' ? 'upcoming' : m.status}`;

  document.getElementById('mMeta').innerHTML = `
    <div class="modal-meta-row"><span class="modal-meta-icon">📅</span><span class="modal-meta-val">${m.date}</span></div>
    <div class="modal-meta-row"><span class="modal-meta-icon">⏰</span><span class="modal-meta-val">${m.time}</span></div>
    <div class="modal-meta-row"><span class="modal-meta-icon">📍</span><span class="modal-meta-val">${m.venue}</span></div>
    <div class="modal-meta-row"><span class="modal-meta-icon">📡</span><span class="modal-meta-val">Broadcasting on FOX / FS1</span></div>
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

  // Knockout: no odds yet, show placeholder
  document.getElementById('probContent').innerHTML = `<div class="prob-error">Odds available once teams are confirmed</div>`;
  document.getElementById('probSource').textContent = '';
  document.getElementById('probLiveDot').style.display = 'none';

  document.getElementById('modalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
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

// ─── COUNTDOWN ────────────────────────────────────────────────────────────────
let countdownTimer = null;
function updateCountdown() {
  const kickoff = new Date('2026-06-11T19:00:00Z'); // 3 PM ET = 19:00 UTC
  const now = new Date();
  const diff = kickoff - now;
  if (diff <= 0) {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    // renderLiveStrip() owns countdownRow once the tournament has started —
    // writing here would overwrite the live game cards on every 1s tick.
    return;
  }
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  document.getElementById('cdDays').textContent = String(d).padStart(2,'0');
  document.getElementById('cdHours').textContent = String(h).padStart(2,'0');
  document.getElementById('cdMins').textContent = String(m).padStart(2,'0');
  document.getElementById('cdSecs').textContent = String(s).padStart(2,'0');
}

// ─── RENDER ALL ───────────────────────────────────────────────────────────────
// A compact fingerprint of everything the three panels render. When it's
// unchanged (the common case between 60s polls), skip the full innerHTML
// rebuild so the user's bracket scroll, hover, and taps aren't interrupted.
function renderSignature() {
  const now = Date.now();
  const parts = [userTZ, pastExpanded ? '1' : '0'];
  Object.values(matchesById)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .forEach(m => parts.push(
      `${m.id}:${m.status}:${m.homeScore}:${m.awayScore}:${m.minute}:${matchPhase(m, now)}`
    ));
  KNOCKOUT_ROUNDS.forEach(r => r.matches.forEach(m => parts.push(
    `${m.id}:${m.home?.code || ''}:${m.away?.code || ''}:${m.status}:${m.homeScore}:${m.awayScore}:${m.winnerCode || ''}`
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
      row.innerHTML = `<div class="tournament-live-banner">⚽ THE TOURNAMENT IS LIVE!</div>`;
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

// ─── INIT ─────────────────────────────────────────────────────────────────────
buildMatches();
loadResults();          // hydrate cached results so the page starts populated
computeQualification(); // build standings + bracket from cache before first paint
renderAll();
updateTimestamp();
updateCountdown();
countdownTimer = setInterval(updateCountdown, 1000);

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
  if (e.key === 'Escape') { closeModal(); tzPickerWrapper.classList.remove('open'); }
});

// ─── CUSTOM TIMEZONE PICKER ───────────────────────────────────────────────────
const tzPickerWrapper = document.getElementById('tzPickerWrapper');
const tzDisplayEl = document.getElementById('tzDisplay');

tzPickerWrapper.addEventListener('click', function(e) {
  e.stopPropagation();
  this.classList.toggle('open');
});

document.querySelectorAll('.tz-option').forEach(btn => {
  btn.addEventListener('click', function(e) {
    e.stopPropagation();
    document.querySelectorAll('.tz-option').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    tzDisplayEl.textContent = this.dataset.short;
    tzPickerWrapper.classList.remove('open');
    onTimezoneChange(this.dataset.tz);
  });
});

document.addEventListener('click', function() {
  tzPickerWrapper.classList.remove('open');
});
