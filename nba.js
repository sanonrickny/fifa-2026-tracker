// ─── NBA CUP ──────────────────────────────────────────────────────────────────
// Everything here is derived from ESPN's NBA scoreboard: Cup games carry a
// "NBA Cup - ..." note, groups fall out of who plays whom, and the knockout
// bracket is filled from real events once ESPN names the teams (projected from
// the standings until then). Nothing about the season is hardcoded.
const NBA_API = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const NBA_LS = 'rickcup_nba_v1';
// Conference membership is the one fact the scoreboard doesn't carry.
const NBA_EAST = new Set('ATL BOS BKN CHA CHI CLE DET IND MIA MIL NY ORL PHI TOR WSH'.split(' '));
const NBA_ROUND = { GP: 'Group Play', QF: 'Quarterfinal', SF: 'Semifinal', F: 'Championship' };

let nbaGames = {};        // ESPN event id -> slim game
let nbaPastOpen = false;  // whether finished games are revealed in the list
let nbaLastSig = null;

// Reduce an ESPN event to the fields we render. Returns null for non-Cup games.
function nbaSlim(ev) {
  const c = ev.competitions?.[0];
  const note = (c?.notes || []).map(n => n.headline || '').find(h => /NBA Cup/i.test(h));
  if (!note || (c.competitors || []).length < 2) return null;
  const round = /group/i.test(note) ? 'GP' : /quarter/i.test(note) ? 'QF'
              : /semi/i.test(note) ? 'SF' : /champ|final/i.test(note) ? 'F' : null;
  if (!round) return null;
  const state = ev.status?.type?.state;
  const tv = (c.broadcasts || []).filter(b => b.market === 'national').flatMap(b => b.names || []);
  return {
    id: String(ev.id), date: ev.date, round,
    // ESPN parks unscheduled games at midnight ET; only trust the clock time
    // once the matchup is set.
    timeValid: c.competitors.every(x => x.team?.abbreviation !== 'TBD'),
    status: state === 'in' ? 'live' : state === 'post' ? 'final' : 'upcoming',
    clock: ev.status?.type?.shortDetail || '',
    venue: c.venue?.fullName || '',
    tv: tv.join(' / '),
    // Away first, home second ("WSH @ ATL").
    teams: c.competitors.slice().sort((a, b) => (a.homeAway === 'home') - (b.homeAway === 'home')).map(x => ({
      abbr: x.team?.abbreviation || 'TBD',
      name: x.team?.shortDisplayName || x.team?.name || 'TBD',
      logo: x.team?.logo || '',
      score: parseInt(x.score ?? '0') || 0,
      winner: !!x.winner,
    })),
  };
}

const nbaConf = abbr => NBA_EAST.has(abbr) ? 'East' : 'West';
const nbaReal = g => g.teams.every(t => t.abbr !== 'TBD');

// Group standings + the 8 projected knockout seeds, from group-play results.
// ponytail: tiebreaks are wins, head-to-head, point diff, points scored. The
// NBA's full list (overtime-adjusted diff, prior-season record, draw) is not
// modelled; once ESPN names the quarterfinalists the bracket uses those instead.
function nbaStandings(games) {
  const t = {};
  const team = x => t[x.abbr] || (t[x.abbr] = {
    abbr: x.abbr, name: x.name, logo: x.logo, w: 0, l: 0, pf: 0, pa: 0, opp: new Set(), beat: new Set(),
  });
  Object.values(games).filter(g => g.round === 'GP' && nbaReal(g)).forEach(g => {
    const [a, b] = g.teams.map(team);
    a.opp.add(b.abbr); b.opp.add(a.abbr);
    if (g.status !== 'final') return;
    const [sa, sb] = g.teams.map(x => x.score);
    a.pf += sa; a.pa += sb; b.pf += sb; b.pa += sa;
    const [win, lose] = sa > sb ? [a, b] : [b, a];
    win.w++; lose.l++; win.beat.add(lose.abbr);
  });

  const base = (a, b) => b.w - a.w || a.l - b.l;
  const tail = (a, b) => (b.pf - b.pa) - (a.pf - a.pa) || b.pf - a.pf || a.abbr.localeCompare(b.abbr);
  const h2h = (a, b) => a.beat.has(b.abbr) ? -1 : b.beat.has(a.abbr) ? 1 : 0;
  const inGroup = (a, b) => base(a, b) || h2h(a, b) || tail(a, b);
  const across = (a, b) => base(a, b) || tail(a, b);

  // A group is a team plus everyone it plays in group play.
  const groups = [], seen = new Set();
  Object.keys(t).sort().forEach(abbr => {
    if (seen.has(abbr)) return;
    const members = [abbr, ...t[abbr].opp].map(x => t[x]);
    members.forEach(m => seen.add(m.abbr));
    groups.push({
      conf: nbaConf(abbr),
      teams: members.sort(inGroup),
      done: members.every(m => m.w + m.l >= m.opp.size),
    });
  });
  groups.sort((a, b) => a.conf.localeCompare(b.conf));

  const seeds = {};
  ['East', 'West'].forEach(conf => {
    const gs = groups.filter(g => g.conf === conf);
    const winners = gs.map(g => g.teams[0]).sort(across);
    const wild = gs.map(g => g.teams[1]).filter(Boolean).sort(across)[0];
    seeds[conf] = wild ? [...winners, wild] : winners;
    winners.forEach(w => { w.q = 'win'; });
    if (wild) wild.q = 'wc';
    seeds[conf].forEach((s, i) => { s.seed = i + 1; });
  });
  return { groups, seeds, done: groups.length > 0 && groups.every(g => g.done) };
}

// The 7-game knockout tree: 4 quarterfinals (East, East, West, West), 2
// conference semifinals, 1 championship. Each slot is a real ESPN game when the
// teams are known, otherwise the projected matchup or a "winner of" placeholder.
function nbaBracket(games, st) {
  const ko = r => Object.values(games).filter(g => g.round === r && nbaReal(g))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const slot = (round, game, teams, labels, projected) => ({
    round, game, projected: !game && !!projected,
    teams: game ? game.teams : teams,
    labels,
    winner: game && game.status === 'final' ? game.teams.find(x => x.winner) || null : null,
  });

  const qf = [], sf = [];
  ['East', 'West'].forEach(conf => {
    const s = st.seeds[conf] || [];
    const pairs = [[s[0], s[3]], [s[1], s[2]]];   // 1 v 4, 2 v 3
    const real = ko('QF').filter(g => nbaConf(g.teams[0].abbr) === conf).slice(0, 2);
    // Projected pairs not already covered by a real game fill the open slots.
    const open = pairs.filter(p => !real.some(g => g.teams.some(x => p.some(y => y && y.abbr === x.abbr))));
    const mine = real.map(g => slot('QF', g));
    while (mine.length < 2) {
      const p = open.shift() || [null, null];
      mine.push(slot('QF', null, p, [`${conf} seed`, `${conf} seed`], p[0] && p[1]));
    }
    qf.push(...mine);
    const realSF = ko('SF').find(g => nbaConf(g.teams[0].abbr) === conf);
    sf.push(slot('SF', realSF || null, mine.map(m => m.winner), [`${conf} QF winner`, `${conf} QF winner`]));
  });
  const fin = slot('F', ko('F')[0] || null, sf.map(m => m.winner), ['East winner', 'West winner']);
  return [qf, sf, [fin]];
}

// ─── FETCH ────────────────────────────────────────────────────────────────────
// `full` pulls the whole Cup window (group play starts late October, the final
// is mid-December); otherwise just today's slate, which is all a live poll needs.
async function nbaFetch(full) {
  const d = new Date();
  const y = d.getMonth() >= 9 ? d.getFullYear() : d.getFullYear() - 1; // Jan-Sep: show the last Cup
  const urls = full
    ? ['10', '11', '12'].map(m => `${NBA_API}/scoreboard?dates=${y}${m}&limit=500`)
    : [`${NBA_API}/scoreboard`];
  const res = await Promise.all(urls.map(u => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null)));
  res.forEach(data => (data?.events || []).forEach(ev => {
    const g = nbaSlim(ev);
    if (g) nbaGames[g.id] = g;
  }));
  try { localStorage.setItem(NBA_LS, JSON.stringify(nbaGames)); } catch (e) {}
  renderNba();
  const open = String(currentModalId || '').startsWith('NBA') && nbaGames[currentModalId.slice(3)];
  if (open) nbaModalScore(open);
}

function nbaLiveCount() {
  return Object.values(nbaGames).filter(g => g.status === 'live').length;
}

// ─── RENDER ───────────────────────────────────────────────────────────────────
const nbaEsc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const nbaLogo = t => t.logo ? `<img class="nba-logo" src="${nbaEsc(t.logo)}" alt="" loading="lazy">` : '';
// Unscheduled games sit at midnight ET, so read their date in ET, not locally.
const nbaTZ = g => g.timeValid ? userTZ : 'America/New_York';
const nbaWhen = g => formatDate(new Date(g.date), nbaTZ(g)) + (g.timeValid ? ' · ' + formatTime(new Date(g.date), userTZ) : '');
const nbaScore = g => `${g.teams[0].score} – ${g.teams[1].score}`;

function nbaBracketCell(m) {
  const g = m.game;
  const head = !g ? (m.projected ? 'Projected' : 'TBD')
    : g.status === 'live' ? `<span class="live-pip"></span>${nbaEsc(g.clock)}`
    : g.status === 'final' ? 'Final' : nbaWhen(g);
  const row = (t, label) => {
    if (!t) return `<div class="bracket-team tbd">${label}</div>`;
    const win = g && g.status === 'final' && t.winner;
    const seed = m.round === 'QF' && t.seed ? `<span class="nba-seed">${t.seed}</span>` : '';
    return `<div class="bracket-team${win ? ' winner' : ''}${m.projected ? ' nba-proj' : ''}">${seed}${nbaLogo(t)}${nbaEsc(t.name)}<span class="bt-score">${g && g.status !== 'upcoming' ? t.score : ''}</span></div>`;
  };
  return `<div class="bracket-cell"><div class="bracket-match${m.round === 'F' ? ' final-card' : ''}${g && g.status === 'live' ? ' is-live' : ''}" ${g ? `onclick="openNbaModal('${g.id}')"` : 'style="cursor:default"'}>
    <div class="bracket-date-line">${head}</div>
    ${row(m.teams[0], m.labels && m.labels[0])}
    ${row(m.teams[1], m.labels && m.labels[1])}
  </div></div>`;
}

function nbaCard(g, todayKey) {
  const live = g.status === 'live';
  const mid = g.status === 'upcoming'
    ? (g.timeValid ? formatTime(new Date(g.date), userTZ) : 'TBD')
    : nbaScore(g);
  const cls = live ? 'live-score' : g.status === 'final' ? 'final' : 'upcoming';
  const badge = g.round === 'GP' ? (nbaReal(g) ? nbaConf(g.teams[0].abbr)[0] : 'GP') : g.round;
  return `<div class="schedule-match-card ${live ? 'is-live' : ''}" onclick="openNbaModal('${g.id}')">
    <div class="smc-group-badge">${badge}</div>
    <div class="smc-teams">
      ${g.teams.map(t => t.abbr === 'TBD'
        ? `<div class="smc-team smc-tbd">TBD</div>`
        : `<div class="smc-team">${nbaLogo(t)}${nbaEsc(t.name)}</div>`).join('')}
    </div>
    <div class="smc-right">
      <div class="smc-vs-score ${cls}">${mid}</div>
      <div class="smc-venue">${nbaEsc(live ? g.clock : g.status === 'final' ? 'Final' : g.tv || g.venue)}</div>
    </div>
  </div>`;
}

function nbaDays(list, todayKey) {
  const byDay = {};
  list.forEach(g => { const k = getDateKey(new Date(g.date), nbaTZ(g)); (byDay[k] = byDay[k] || []).push(g); });
  return Object.keys(byDay).sort().map(k => `
    <div class="schedule-day">
      <div class="schedule-day-header">
        <div class="schedule-date-label">${k === todayKey ? 'Today' : formatDate(new Date(byDay[k][0].date), nbaTZ(byDay[k][0]))}</div>
        <div class="schedule-divider"></div>
      </div>
      <div class="schedule-matches-list">${byDay[k].map(g => nbaCard(g, todayKey)).join('')}</div>
    </div>`).join('');
}

function nbaTogglePast() { nbaPastOpen = !nbaPastOpen; renderNba(); }

function renderNba() {
  const el = document.getElementById('nbaEl');
  if (!el) return;
  const todayKey = getDateKey(new Date(), userTZ);
  const sig = JSON.stringify(nbaGames) + nbaPastOpen + todayKey + userTZ;
  if (sig === nbaLastSig) return;
  nbaLastSig = sig;
  if (typeof updateLiveBadge === 'function') updateLiveBadge();

  const all = Object.values(nbaGames).sort((a, b) => a.date.localeCompare(b.date));
  if (!all.length) { el.innerHTML = `<p class="schedule-empty">Loading the NBA Cup…</p>`; return; }

  const st = nbaStandings(nbaGames);
  const rounds = nbaBracket(nbaGames, st);
  const projected = rounds[0].some(m => m.projected);
  const champ = rounds[2][0].winner;

  const past = all.filter(g => getDateKey(new Date(g.date), nbaTZ(g)) < todayKey);
  const current = all.filter(g => !past.includes(g));

  el.innerHTML = `
    ${champ ? `<div class="champion-card nba-champ"><div class="champ-chip">🏆 NBA Cup Champions</div>
      <div class="champ-row">${nbaLogo(champ)}<span class="champ-name">${nbaEsc(champ.name)}</span></div></div>` : ''}
    <div class="nba-steps">
      <div class="nba-step"><b>1 · Groups</b>6 groups of 5. Everyone plays 4 games.</div>
      <div class="nba-step"><b>2 · Eight advance</b>Each group winner, plus 1 wild card per conference.</div>
      <div class="nba-step"><b>3 · Knockout</b>Lose once and you're out.</div>
    </div>

    <div class="nba-title">Bracket${projected ? '<span>if group play ended today</span>' : ''}</div>
    <div class="bracket-wrapper nba-bracket-wrap"><div class="bracket">
      ${rounds.map((r, i) => `<div class="bracket-round">
        <div class="bracket-round-label">${['Quarterfinals', 'Semifinals', 'Championship'][i]}</div>
        <div class="bracket-body">${r.map(nbaBracketCell).join('')}</div>
      </div>`).join('')}
    </div></div>

    <div class="nba-title">Groups<span><i class="pos-q">●</i> group leader <i class="pos-m">●</i> wild card</span></div>
    <div class="groups-grid">
      ${st.groups.map(g => `<div class="group-card">
        <div class="group-header">
          <div class="group-label">${g.conf}</div>
          <div class="group-teams-mini">${g.teams.map(nbaLogo).join('')}</div>
        </div>
        <table class="standings-table">
          <colgroup><col class="col-team"><col class="col-num"><col class="col-num"><col class="col-num nba-diff"></colgroup>
          <thead><tr><th>Team</th><th>W</th><th>L</th><th>Diff</th></tr></thead>
          <tbody>${g.teams.map((t, i) => `<tr>
            <td><div class="team-cell"><span class="team-pos ${t.q === 'win' ? 'pos-q' : t.q === 'wc' ? 'pos-m' : ''}">${i + 1}</span>${nbaLogo(t)}<span class="team-name">${nbaEsc(t.name)}</span></div></td>
            <td>${t.w}</td><td>${t.l}</td><td>${t.pf - t.pa > 0 ? '+' : ''}${t.pf - t.pa}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`).join('')}
    </div>

    <div class="nba-title">Games</div>
    ${past.length ? `
      <div class="past-toggle-bar ${nbaPastOpen ? 'open' : ''}" onclick="nbaTogglePast()">
        <span class="ptb-arrow">▸</span>
        <span class="ptb-label">Past games (${past.length})</span>
      </div>
      <div class="past-schedule ${nbaPastOpen ? 'open' : ''}">${nbaPastOpen ? nbaDays(past, todayKey) : ''}</div>` : ''}
    ${current.length ? nbaDays(current, todayKey) : `<p class="schedule-empty">The NBA Cup is complete.</p>`}
  `;
}

// ─── MODAL ────────────────────────────────────────────────────────────────────
// Reuses the match sheet. The `nba` class hides the soccer-only sections.
function nbaModalScore(g) {
  const scoreEl = document.getElementById('mScore');
  scoreEl.textContent = g.status === 'upcoming' ? 'VS' : nbaScore(g);
  scoreEl.className = `modal-score-display ${g.status === 'live' ? 'live-score' : g.status === 'final' ? 'final' : 'upcoming'}`;
  const badge = document.getElementById('mStatusBadge');
  badge.textContent = g.status === 'live' ? `LIVE · ${g.clock}` : g.status === 'final' ? 'Final'
    : g.timeValid ? formatTime(new Date(g.date), userTZ) : 'Time TBD';
  badge.className = `modal-status-badge ${g.status}`;
}

function openNbaModal(id) {
  const g = nbaGames[id];
  if (!g) return;
  currentModalId = 'NBA' + id;
  const sheet = document.getElementById('modal');
  sheet.classList.add('nba');
  sheet.classList.toggle('nba-noprob', g.status === 'final' || !nbaReal(g));

  document.getElementById('mRound').textContent = `NBA Cup · ${NBA_ROUND[g.round]}`;
  [['Home', g.teams[0]], ['Away', g.teams[1]]].forEach(([side, t]) => {
    document.getElementById(`m${side}Flag`).innerHTML = t.logo ? `<img class="nba-logo-lg" src="${nbaEsc(t.logo)}" alt="">` : '🏀';
    document.getElementById(`m${side}Name`).textContent = t.name;
    document.getElementById(`m${side}Code`).textContent = t.abbr === 'TBD' ? '' : t.abbr;
  });
  document.getElementById('mPens').style.display = 'none';
  nbaModalScore(g);

  const when = new Date(g.date);
  const row = (icon, val) => val ? `<div class="modal-meta-row"><span class="modal-meta-icon">${icon}</span><span class="modal-meta-val">${nbaEsc(val)}</span></div>` : '';
  document.getElementById('mMeta').innerHTML =
    row('📅', formatDateFull(when, nbaTZ(g))) +
    row('⏰', g.timeValid ? formatTime(when, userTZ) : '') +
    row('📍', g.venue) +
    row('📡', g.tv);

  document.getElementById('eventsSection').style.display = 'none';
  document.getElementById('probSource').textContent = '';
  document.getElementById('probLiveDot').style.display = 'none';
  document.getElementById('probContent').innerHTML = '<div class="prob-loading">Loading…</div>';
  if (g.status !== 'final' && nbaReal(g)) nbaProb(g);

  document.getElementById('modalOverlay').classList.add('open');
  document.body.style.overflow = 'hidden';
  setModalHash('NBA' + id);
}

// Win probability from ESPN's matchup predictor (two-way: no draws in the NBA).
async function nbaProb(g) {
  let home = null;
  try {
    const r = await fetch(`${NBA_API}/summary?event=${g.id}`);
    const d = r.ok ? await r.json() : null;
    const live = d?.winprobability?.length ? d.winprobability[d.winprobability.length - 1].homeWinPercentage * 100 : null;
    home = live ?? parseFloat(d?.predictor?.homeTeam?.gameProjection);
  } catch (e) {}
  if (currentModalId !== 'NBA' + g.id) return;   // modal moved on
  const el = document.getElementById('probContent');
  if (!Number.isFinite(home)) { el.innerHTML = `<div class="prob-error">Not available yet</div>`; return; }
  document.getElementById('probSource').textContent = 'ESPN Analytics';
  const pct = [100 - Math.round(home), Math.round(home)];   // teams are [away, home]
  el.innerHTML = g.teams.map((t, i) => `
    <div class="prob-row">
      <div class="prob-label"><span class="flag">${nbaLogo(t)}</span><span class="name">${nbaEsc(t.name)}</span></div>
      <div class="prob-bar-wrap"><div class="prob-bar-fill ${i ? 'away' : 'home'}" style="width:${pct[i]}%"></div></div>
      <div class="prob-pct ${i ? 'away' : ''}">${pct[i]}%</div>
    </div>`).join('');
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
if (typeof document !== 'undefined') {
  try { nbaGames = JSON.parse(localStorage.getItem(NBA_LS) || '{}'); } catch (e) {}
  renderNba();
  nbaFetch(true);
  setInterval(() => { if (!document.hidden) nbaFetch(false); }, 60000);
  setInterval(() => { if (!document.hidden) nbaFetch(true); }, 15 * 60000); // picks up newly named knockout teams
  document.addEventListener('visibilitychange', () => { if (!document.hidden) nbaFetch(true); });
  window.addEventListener('online', () => nbaFetch(true));
  if (location.hash.startsWith('#NBA')) {
    showTab('nba', document.getElementById('tabNba'));
    openNbaModal(location.hash.slice(4));
  }
}
if (typeof module !== 'undefined') module.exports = { nbaSlim, nbaStandings, nbaBracket };
