// ─── NBA REGULAR SEASON ───────────────────────────────────────────────────────
// Games (any day's scoreboard), conference standings, and stat leaders, all from
// ESPN. Needs nba.js (game parsing, cards, modal) loaded first.
const NBA_SEASON_LS = 'rickcup_nba_season_v1';
const NBA_LEAD_CATS = ['pointsPerGame', 'reboundsPerGame', 'assistsPerGame', 'stealsPerGame', 'blocksPerGame', '3PointsMadePerGame'];

let nbaDayOffset = 0;     // days away from ESPN's "today" on the Games tab
const nbaDayCache = {};   // YYYYMMDD -> games, for days other than today
let nbaTable = null;      // [{ conf, teams: [...] }] from nbaTableSlim
let nbaLeaders = null;    // [{ key, name, list: [...] }] from nbaLeadersSlim

// Standings: each conference's 15 teams in seed order. ESPN keys every stat by
// `type` (wins, gamesbehind, lasttengames, ...).
function nbaTableSlim(json) {
  return (json.children || []).map(c => ({
    conf: c.abbreviation || c.name,
    teams: (c.standings?.entries || []).map(e => {
      const s = {};
      (e.stats || []).forEach(x => { s[x.type] = x; });
      const v = k => s[k]?.displayValue ?? '';
      return {
        abbr: e.team.abbreviation, name: e.team.shortDisplayName || e.team.name,
        logo: e.team.logos?.[0]?.href || '',
        seed: s.playoffseed?.value ?? 99, w: s.wins?.value ?? 0, l: s.losses?.value ?? 0,
        gb: v('gamesbehind'), l10: v('lasttengames'), strk: v('streak'),
      };
    }).sort((a, b) => a.seed - b.seed),
  }));
}

// Leaders: the top 5 in a handful of categories a newcomer can read.
function nbaLeadersSlim(json) {
  const cats = json.leaders?.categories || [];
  return NBA_LEAD_CATS.map(k => cats.find(c => c.name === k)).filter(Boolean).map(c => ({
    key: c.abbreviation, name: c.displayName,
    list: (c.leaders || []).slice(0, 5).map(l => ({
      v: l.displayValue, n: l.athlete?.displayName || '',
      img: l.athlete?.headshot?.href || '',
      team: l.team?.abbreviation || '', logo: l.team?.logos?.[0]?.href || '',
    })),
  }));
}

// Playoff picture zone for a conference seed.
const nbaZone = seed => seed <= 6 ? 'playoffs' : seed <= 10 ? 'playin' : 'out';

// ─── FETCH ────────────────────────────────────────────────────────────────────
async function nbaSeasonFetch() {
  const get = u => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null);
  const [st, ld] = await Promise.all([
    get('https://site.api.espn.com/apis/v2/sports/basketball/nba/standings'),
    get(`https://site.api.espn.com/apis/site/v3/sports/basketball/nba/leaders?limit=5`),
  ]);
  if (st) nbaTable = nbaTableSlim(st);
  if (ld) nbaLeaders = nbaLeadersSlim(ld);
  try { localStorage.setItem(NBA_SEASON_LS, JSON.stringify({ table: nbaTable, leaders: nbaLeaders })); } catch (e) {}
  renderNbaSeason();
}

// YYYYMMDD shifted by n days (ESPN's game day is US Eastern; noon UTC avoids DST edges).
function nbaShift(key, n) {
  const d = new Date(Date.UTC(+key.slice(0, 4), +key.slice(4, 6) - 1, +key.slice(6, 8), 12) + n * 864e5);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

async function nbaFetchDay(key) {
  const r = await fetch(`${NBA_API}/scoreboard?dates=${key}`).then(r => r.ok ? r.json() : null).catch(() => null);
  if (r) nbaDayCache[key] = (r.events || []).map(nbaGame).filter(Boolean);
  renderNbaGames();
}

function nbaDayStep(n) {
  nbaDayOffset += n;
  const key = nbaShift(nbaTodayKey, nbaDayOffset);
  if (nbaDayOffset && !nbaDayCache[key]) nbaFetchDay(key);
  renderNbaGames();
}

// ─── RENDER ───────────────────────────────────────────────────────────────────
function renderNbaGames() {
  const el = document.getElementById('nbaGamesEl');
  if (!el) return;
  updateLiveBadge();
  if (!nbaTodayKey) { el.innerHTML = `<p class="schedule-empty">Loading games…</p>`; return; }
  const key = nbaShift(nbaTodayKey, nbaDayOffset);
  const games = nbaDayOffset ? nbaDayCache[key] : nbaToday;
  const date = new Date(Date.UTC(+key.slice(0, 4), +key.slice(4, 6) - 1, +key.slice(6, 8), 12));
  const label = { '-1': 'Yesterday', 0: 'Today', 1: 'Tomorrow' }[nbaDayOffset]
    || date.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  const list = (games || []).slice().sort((a, b) =>
    (a.status === 'live' ? 0 : 1) - (b.status === 'live' ? 0 : 1) || a.date.localeCompare(b.date));
  el.innerHTML = `
    <div class="day-nav">
      <button onclick="nbaDayStep(-1)" aria-label="Previous day">‹</button>
      <div class="day-nav-label">${label}${nbaDayOffset ? `<small>${date.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })}</small>` : ''}</div>
      <button onclick="nbaDayStep(1)" aria-label="Next day">›</button>
    </div>
    ${!games ? `<p class="schedule-empty">Loading…</p>`
      : list.length ? `<div class="schedule-matches-list">${list.map(nbaCard).join('')}</div>`
      : `<p class="schedule-empty">No games this day.</p>`}
    ${nbaDayOffset ? `<button class="day-today" onclick="nbaDayStep(${-nbaDayOffset})">Back to today</button>` : ''}`;
}

function nbaConfCard(c) {
  const head = ['W', 'L', 'GB', 'L10', 'STRK'];
  const sub = { playoffs: 'Playoffs', playin: 'Play-in', out: 'Out of the playoffs' };
  let zone = null;
  const rows = c.teams.map((t, i) => {
    const z = nbaZone(t.seed);
    const divider = z !== zone ? `<tr class="nba-sub zone-${z}"><td colspan="6"><span ${tip(z)}>${sub[z]}</span></td></tr>` : '';
    zone = z;
    return divider + `<tr>
      <td><div class="team-cell"><span class="team-pos zone-${z}">${i + 1}</span>${nbaLogo(t)}<span class="team-name">${nbaEsc(t.name)}</span></div></td>
      <td>${t.w}</td><td>${t.l}</td><td>${nbaEsc(t.gb)}</td><td>${nbaEsc(t.l10)}</td>
      <td class="${/^W/.test(t.strk) ? 'strk-w' : 'strk-l'}">${nbaEsc(t.strk)}</td>
    </tr>`;
  }).join('');
  return `<div class="group-card">
    <div class="group-header"><div class="group-label" ${tip(c.conf)}>${c.conf}</div><div class="nba-head-note" ${tip('season')}>2026-27 season</div></div>
    <table class="standings-table season-table">
      <colgroup><col class="col-team">${head.map(() => '<col class="col-num">').join('')}</colgroup>
      <thead><tr><th ${tip('rank')}>Team</th>${head.map(k => `<th ${tip(k)}>${k}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function nbaLeaderCard(c) {
  const img = p => p.img
    ? `<img class="lead-face" src="https://a.espncdn.com/combiner/i?img=${encodeURIComponent(p.img.replace('https://a.espncdn.com', ''))}&w=96&h=70&scale=crop" alt="" loading="lazy">`
    : '<span class="lead-face"></span>';
  return `<div class="group-card lead-card">
    <div class="group-header"><div class="group-label" ${tip(c.key)}>${nbaEsc(c.name)}</div></div>
    ${c.list.map((p, i) => `<div class="lead-row${i ? '' : ' top'}">
      <span class="lead-rank">${i + 1}</span>${img(p)}
      <span class="lead-name">${nbaEsc(p.n)}<small>${nbaLogo(p)}${nbaEsc(p.team)}</small></span>
      <span class="lead-val">${nbaEsc(p.v)}</span>
    </div>`).join('')}
  </div>`;
}

let nbaSeasonSig = null;
function renderNbaSeason() {
  const sig = JSON.stringify([nbaTable, nbaLeaders]);
  if (sig === nbaSeasonSig) return;
  nbaSeasonSig = sig;
  document.getElementById('nbaStandingsEl').innerHTML = nbaTable
    ? `<div class="zone-legend">
        <span ${tip('playoffs')}><i class="zone-playoffs"></i>Playoffs</span>
        <span ${tip('playin')}><i class="zone-playin"></i>Play-in</span>
        <span ${tip('out')}><i class="zone-out"></i>Out</span>
      </div>
      <div class="groups-grid">${nbaTable.map(nbaConfCard).join('')}</div>`
    : `<p class="schedule-empty">Loading standings…</p>`;
  document.getElementById('nbaLeadersEl').innerHTML = nbaLeaders
    ? `<div class="groups-grid">${nbaLeaders.map(nbaLeaderCard).join('')}</div>`
    : `<p class="schedule-empty">Loading leaders…</p>`;
}

// ─── INIT (all NBA) ───────────────────────────────────────────────────────────
if (typeof document !== 'undefined') {
  try {
    const saved = JSON.parse(localStorage.getItem(NBA_LS) || '{}');
    nbaGames = saved.games || {}; nbaUpdated = saved.t || null;
    nbaToday = saved.today || []; nbaTodayKey = saved.day || '';
    const season = JSON.parse(localStorage.getItem(NBA_SEASON_LS) || '{}');
    nbaTable = season.table || null; nbaLeaders = season.leaders || null;
  } catch (e) {}
  renderNba();
  renderNbaGames();
  renderNbaSeason();
  nbaFetch(true);
  nbaSeasonFetch();
  setInterval(() => { if (!document.hidden) nbaFetch(false); }, 60000);
  // Standings, leaders, and newly named Cup knockout teams change slowly.
  setInterval(() => { if (!document.hidden) { nbaFetch(true); nbaSeasonFetch(); } }, 15 * 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) nbaFetch(true); });
  window.addEventListener('online', () => { nbaFetch(true); nbaSeasonFetch(); });
  if (location.hash.startsWith('#NBA')) {
    setSport('nba');
    openNbaModal(location.hash.slice(4));
  }
}
if (typeof module !== 'undefined') module.exports = { nbaTableSlim, nbaLeadersSlim, nbaZone, nbaShift };
