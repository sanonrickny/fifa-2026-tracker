// ─── NBA CUP ──────────────────────────────────────────────────────────────────
// Everything here is derived from ESPN's NBA scoreboard: Cup games carry a
// "NBA Cup - ..." note, groups fall out of who plays whom, and the knockout
// bracket is filled from real events once ESPN names the teams (projected from
// the standings until then). Nothing about the season is hardcoded.
const NBA_API = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const NBA_LS = 'rickcup_nba_v2';
// Conference membership is the one fact the scoreboard doesn't carry.
const NBA_EAST = new Set('ATL BOS BKN CHA CHI CLE DET IND MIA MIL NY ORL PHI TOR WSH'.split(' '));
const NBA_ROUND = { GP: 'Group Play', QF: 'Quarterfinal', SF: 'Semifinal', F: 'Championship' };

let nbaGames = {};        // ESPN event id -> slim game
let nbaPastOpen = false;  // whether finished games are revealed in the list
let nbaLastSig = null;
let nbaUpdated = null;    // ms timestamp of the last successful fetch

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
    headline: c.headlines?.[0]?.shortLinkText || '',
    // Away first, home second ("WSH @ ATL").
    teams: c.competitors.slice().sort((a, b) => (a.homeAway === 'home') - (b.homeAway === 'home')).map(x => ({
      abbr: x.team?.abbreviation || 'TBD',
      name: x.team?.shortDisplayName || x.team?.name || 'TBD',
      logo: x.team?.logo || '',
      score: parseInt(x.score ?? '0') || 0,
      winner: !!x.winner,
      rec: (x.records || []).find(r => r.type === 'total')?.summary || '',   // season record
      q: (x.linescores || []).map(l => l.value),                           // points per quarter
      lead: (x.leaders || []).slice(0, 3).map(l => ({
        k: l.abbreviation || '', v: l.leaders?.[0]?.displayValue || '', n: l.leaders?.[0]?.athlete?.shortName || '',
      })).filter(l => l.n),
    })),
  };
}

const nbaConf = abbr => NBA_EAST.has(abbr) ? 'East' : 'West';
const nbaReal = g => g.teams.every(t => t.abbr !== 'TBD');

// Group standings + the 8 projected knockout seeds, from group-play results.
// NBA Cup rules: only the 4 group games count (not the season record). A group
// is ordered by record, then head-to-head, point differential, points scored.
// Each group winner advances, plus one wild card per conference: the best
// runner-up. Winners are seeded 1-3 by record, the wild card is seed 4.
// ponytail: the NBA's last two tiebreakers (prior-season record, random draw)
// are not modelled; once ESPN names the quarterfinalists the bracket uses those.
// `cutoff` (ISO date) ignores results from that moment on, to rebuild an
// earlier table for the movement arrows.
function nbaStandings(games, cutoff) {
  const t = {};
  const team = x => t[x.abbr] || (t[x.abbr] = {
    abbr: x.abbr, name: x.name, logo: x.logo, w: 0, l: 0, pf: 0, pa: 0, opp: new Set(), beat: new Set(), form: [],
  });
  Object.values(games).filter(g => g.round === 'GP' && nbaReal(g)).sort((x, y) => x.date.localeCompare(y.date)).forEach(g => {
    const [a, b] = g.teams.map(team);
    a.opp.add(b.abbr); b.opp.add(a.abbr);
    // Season record: the next unplayed game carries the current one.
    g.teams.forEach((x, i) => { const m = i ? b : a; if (g.status === 'final') m.lastRec = x.rec; else if (!m.season) m.season = x.rec; });
    if (g.status !== 'final' || (cutoff && g.date >= cutoff)) return;
    const [sa, sb] = g.teams.map(x => x.score);
    a.pf += sa; a.pa += sb; b.pf += sb; b.pa += sa;
    const [win, lose] = sa > sb ? [a, b] : [b, a];
    win.w++; lose.l++; win.beat.add(lose.abbr);
    win.form.push('W'); lose.form.push('L');
  });

  // Win percentage first: mid-stage, teams have played different numbers of games.
  const pct = x => x.w + x.l ? x.w / (x.w + x.l) : 0;
  const base = (a, b) => pct(b) - pct(a) || b.w - a.w || a.l - b.l;
  const tail = (a, b) => (b.pf - b.pa) - (a.pf - a.pa) || b.pf - a.pf || a.abbr.localeCompare(b.abbr);
  const h2h = (a, b) => a.beat.has(b.abbr) ? -1 : b.beat.has(a.abbr) ? 1 : 0;
  const inGroup = (a, b) => base(a, b) || h2h(a, b) || tail(a, b);
  const across = (a, b) => base(a, b) || tail(a, b);

  // A group is a team plus everyone it plays in group play.
  Object.values(t).forEach(m => { m.season = m.season || m.lastRec || ''; });
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
  return { groups, seeds, across, done: groups.length > 0 && groups.every(g => g.done) };
}

// The 7-game knockout tree: 4 quarterfinals (East, East, West, West), 2
// conference semifinals, 1 championship. Each slot is a real ESPN game when the
// teams are known, otherwise the projected matchup or a "winner of" placeholder.
function nbaBracket(games, st) {
  const ko = r => Object.values(games).filter(g => g.round === r && nbaReal(g))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const slot = (round, game, teams, labels, projected, conf) => ({
    round, game, conf, projected: !game && !!projected,
    teams: game ? game.teams : teams,
    labels,
    winner: game && game.status === 'final' ? game.teams.find(x => x.winner) || null : null,
  });

  const qf = [], sf = [];
  ['East', 'West'].forEach(conf => {
    const s = st.seeds[conf] || [];
    // 1 v 4, 2 v 3. Seeds mean nothing until every group game is played, so
    // until then the slots only say which seed will land there.
    const pairs = st.done ? [[s[0], s[3]], [s[1], s[2]]] : [[], []];
    const labels = [[`${conf} #1 seed`, `${conf} wild card`], [`${conf} #2 seed`, `${conf} #3 seed`]];
    const real = ko('QF').filter(g => nbaConf(g.teams[0].abbr) === conf).slice(0, 2);
    // Projected pairs not already covered by a real game fill the open slots.
    const open = pairs.filter(p => !real.some(g => g.teams.some(x => p.some(y => y && y.abbr === x.abbr))));
    const mine = real.map(g => slot('QF', g, null, null, false, conf));
    while (mine.length < 2) {
      const p = open.shift() || [];
      mine.push(slot('QF', null, [p[0] || null, p[1] || null], labels[mine.length], p[0] && p[1], conf));
    }
    qf.push(...mine);
    const realSF = ko('SF').find(g => nbaConf(g.teams[0].abbr) === conf);
    sf.push(slot('SF', realSF || null, mine.map(m => m.winner), [`${conf} QF winner`, `${conf} QF winner`], false, conf));
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
  if (res.some(Boolean)) nbaUpdated = Date.now();
  try { localStorage.setItem(NBA_LS, JSON.stringify({ t: nbaUpdated, games: nbaGames })); } catch (e) {}
  renderNba();
  updateTimestamp();
  const open = String(currentModalId || '').startsWith('NBA') && nbaGames[currentModalId.slice(3)];
  if (open) { nbaModalScore(open); nbaDetail(open); }
}

function nbaLiveCount() {
  return Object.values(nbaGames).filter(g => g.status === 'live').length;
}

// ─── RENDER ───────────────────────────────────────────────────────────────────
const nbaEsc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const nbaLogo = t => t && t.logo ? `<img class="nba-logo" src="${nbaEsc(t.logo)}" alt="" loading="lazy">` : '';
// Unscheduled games sit at midnight ET, so read their date in ET, not locally.
const nbaTZ = g => g.timeValid ? userTZ : 'America/New_York';
const nbaWhen = g => formatDate(new Date(g.date), nbaTZ(g)) + (g.timeValid ? ' · ' + formatTime(new Date(g.date), userTZ) : '');
const nbaScore = g => `${g.teams[0].score} – ${g.teams[1].score}`;
const nbaDiff = t => (t.pf - t.pa > 0 ? '+' : '') + (t.pf - t.pa);

function nbaBracketCell(m) {
  const g = m.game;
  const state = !g ? (m.projected ? 'Projected' : 'TBD')
    : g.status === 'live' ? `<span class="live-pip"></span>${nbaEsc(g.clock)}`
    : g.status === 'final' ? 'Final' : nbaWhen(g);
  const row = (t, label) => {
    if (!t) return `<div class="bracket-team tbd">${label}</div>`;
    const win = g && g.status === 'final' && t.winner;
    const seed = m.round === 'QF' && t.seed ? `<span class="nba-seed">${t.seed}</span>` : '';
    // A projected team shows its group record where the score will go.
    const right = g ? (g.status !== 'upcoming' ? t.score : '') : (t.w != null ? `${t.w}-${t.l}` : '');
    return `<div class="bracket-team${win ? ' winner' : ''}${m.projected ? ' nba-proj' : ''}">${seed}${nbaLogo(t)}${nbaEsc(t.name)}<span class="bt-score">${right}</span></div>`;
  };
  return `<div class="bracket-cell"><div class="bracket-match${m.round === 'F' ? ' final-card' : ''}${g && g.status === 'live' ? ' is-live' : ''}" ${g ? `onclick="openNbaModal('${g.id}')"` : 'style="cursor:default"'}>
    <div class="bracket-date-line">${m.conf ? m.conf + ' · ' : ''}${state}</div>
    ${row(m.teams[0], m.labels && m.labels[0])}
    ${row(m.teams[1], m.labels && m.labels[1])}
  </div></div>`;
}

function nbaCard(g) {
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
        : `<div class="smc-team${g.status === 'final' && !t.winner ? ' nba-lost' : ''}">${nbaLogo(t)}${nbaEsc(t.name)}</div>`).join('')}
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
      <div class="schedule-matches-list">${byDay[k].map(nbaCard).join('')}</div>
    </div>`).join('');
}

function nbaTogglePast() { nbaPastOpen = !nbaPastOpen; renderNba(); }

// Live games, else the next tip-off, at the top of every NBA tab.
function nbaNowHTML(all) {
  const side = t => `<div class="lmc-team"><span class="lmc-flag">${nbaLogo(t) || '🏀'}</span><span class="lmc-name">${nbaEsc(t.abbr)}</span></div>`;
  const live = all.filter(g => g.status === 'live');
  if (live.length) return `<div class="live-strip">${live.map(g => `
    <div class="live-match-card" onclick="openNbaModal('${g.id}')">
      ${side(g.teams[0])}
      <div class="lmc-center"><div class="lmc-score">${nbaScore(g)}</div>
        <div class="lmc-live-row"><span class="lmc-dot"></span><span class="lmc-min">${nbaEsc(g.clock)}</span></div></div>
      ${side(g.teams[1])}
    </div>`).join('')}</div>`;
  const next = all.find(g => g.status === 'upcoming' && new Date(g.date) > Date.now());
  if (!next) return '';
  return `<div class="next-card" onclick="openNbaModal('${next.id}')">
    ${side(next.teams[0])}
    <div class="lmc-center"><span class="next-chip">Next Cup game</span><span class="next-time">${nbaWhen(next)}</span></div>
    ${side(next.teams[1])}
  </div>`;
}

// One tile of the "who has won what" strip: the decided team, or who leads now.
function nbaWinnerTile(title, team, note, cls) {
  return `<div class="nba-win ${cls || ''}${team ? ' decided' : ''}">
    <div class="nba-win-title">${title}</div>
    ${team
      ? `<div class="nba-win-team">${nbaLogo(team)}${nbaEsc(team.name)}</div>`
      : `<div class="nba-win-team tbd">Undecided</div>
         ${note ? `<div class="nba-win-sub">${note}</div>` : ''}`}
  </div>`;
}

// Who would make the knockout round today, and who is next in line.
function nbaPictureCard(conf, st) {
  const seeds = st.seeds[conf] || [];
  const chasing = st.groups.filter(g => g.conf === conf).map(g => g.teams[1])
    .filter(t => t && !seeds.includes(t)).sort(st.across);
  const row = (t, tag, cls) => `<tr>
    <td><div class="team-cell"><span class="team-pos ${cls}">${t.seed || '–'}</span>${nbaLogo(t)}<span class="team-name">${nbaEsc(t.name)}</span>${tag ? `<span class="nba-chip">${tag}</span>` : ''}</div></td>
    <td>${t.w}-${t.l}</td><td>${nbaDiff(t)}</td><td>${nbaEsc(t.season)}</td></tr>`;
  return `<div class="group-card">
    <div class="group-header"><div class="group-label">${conf}</div><div class="nba-head-note">${st.done ? 'Final seeds' : 'Not final'}</div></div>
    <table class="standings-table">
      <colgroup><col class="col-team"><col class="nba-col-rec"><col class="nba-col-rec"><col class="nba-col-season"></colgroup>
      <thead><tr><th>Team</th><th>Cup</th><th>Diff</th><th>Season</th></tr></thead>
      <tbody>
        <tr class="nba-sub"><td colspan="4">Group leaders</td></tr>
        ${seeds.filter(t => t.q !== 'wc').map(t => row(t, '', 'pos-q')).join('')}
        <tr class="nba-sub"><td colspan="4">Wild card: best second place</td></tr>
        ${seeds.filter(t => t.q === 'wc').map(t => row(t, '', 'pos-m')).join('')}
        ${chasing.length ? `<tr class="nba-sub"><td colspan="4">${st.done ? 'Missed out' : 'Next in line for the wild card'}</td></tr>` : ''}
        ${chasing.map(t => row(t, '', '')).join('')}
      </tbody>
    </table>
  </div>`;
}

function nbaGroupCard(g, gi, prev) {
  const games = Object.values(nbaGames)
    .filter(x => x.round === 'GP' && g.teams.some(t => t.abbr === x.teams[0].abbr))
    .sort((a, b) => a.date.localeCompare(b.date));
  // Movement since the last game night: compare with the standings before it.
  const before = prev && prev.groups[gi];
  const moved = t => {
    if (!before || !before.teams.some(x => x.w + x.l > 0)) return '';
    const d = before.teams.findIndex(x => x.abbr === t.abbr) - g.teams.indexOf(t);
    return d > 0 ? `<span class="nba-up">▲${d}</span>` : d < 0 ? `<span class="nba-down">▼${-d}</span>` : '';
  };
  return `<div class="group-card">
    <div class="group-header">
      <div class="group-label">${g.conf}</div>
      <div class="group-teams-mini">${g.teams.map(nbaLogo).join('')}</div>
    </div>
    <table class="standings-table">
      <colgroup><col class="col-team"><col class="col-num"><col class="col-num"><col class="nba-col-rec"><col class="nba-col-form"></colgroup>
      <thead><tr><th>Team</th><th>W</th><th>L</th><th>Diff</th><th>Form</th></tr></thead>
      <tbody>${g.teams.map((t, i) => `<tr>
        <td><div class="team-cell"><span class="team-pos ${t.q === 'win' ? 'pos-q' : t.q === 'wc' ? 'pos-m' : ''}">${i + 1}</span>${nbaLogo(t)}<span class="team-name">${nbaEsc(t.name)}</span>${moved(t)}</div></td>
        <td>${t.w}</td><td>${t.l}</td><td>${nbaDiff(t)}</td>
        <td><span class="nba-form">${t.form.map(r => `<i class="${r}"></i>`).join('')}${'<i></i>'.repeat(Math.max(0, t.opp.size - t.form.length))}</span></td>
      </tr>`).join('')}</tbody>
    </table>
    <div class="group-matches">${games.map(x => {
      const cls = x.status === 'live' ? 'live-score' : x.status === 'final' ? 'final' : 'upcoming';
      return `<div class="match-row" onclick="openNbaModal('${x.id}')">
        ${x.status === 'live' ? '<span class="live-pip"></span>' : ''}
        <div class="match-teams">
          <span class="match-team">${nbaLogo(x.teams[0])}${nbaEsc(x.teams[0].abbr)}</span>
          <span class="match-vs">@</span>
          <span class="match-team">${nbaLogo(x.teams[1])}${nbaEsc(x.teams[1].abbr)}</span>
        </div>
        <div class="match-score ${cls}">${x.status === 'upcoming' ? formatTime(new Date(x.date), userTZ) : nbaScore(x)}</div>
        <div class="match-time-info"><div class="match-date-str">${formatDate(new Date(x.date), userTZ)}</div></div>
      </div>`;
    }).join('')}</div>
  </div>`;
}

function renderNba() {
  const bracketEl = document.getElementById('nbaBracketEl');
  if (!bracketEl) return;
  const todayKey = getDateKey(new Date(), userTZ);
  const sig = JSON.stringify(nbaGames) + nbaPastOpen + todayKey + userTZ;
  if (sig === nbaLastSig) return;
  nbaLastSig = sig;
  updateLiveBadge();

  const all = Object.values(nbaGames).sort((a, b) => a.date.localeCompare(b.date));
  if (!all.length) { bracketEl.innerHTML = `<p class="schedule-empty">Loading the NBA Cup…</p>`; return; }

  const st = nbaStandings(nbaGames);
  // Standings as they stood before the most recent game night (all tip-offs of
  // one night fall within 12 hours of the last one).
  const lastFinal = all.filter(g => g.round === 'GP' && g.status === 'final').pop();
  const prev = lastFinal ? nbaStandings(nbaGames, new Date(new Date(lastFinal.date) - 12 * 3600e3).toISOString()) : null;
  const [qf, sf, fin] = nbaBracket(nbaGames, st);
  const projected = qf.some(m => m.projected);
  // Round dates come from ESPN's placeholder events (parked at midnight ET).
  const day = g => new Date(g.date).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
  const span = r => {
    const d = [...new Set(all.filter(g => g.round === r).map(day))];
    return d.length > 1 ? `${d[0]} to ${d[d.length - 1]}` : d[0] || '';
  };
  const played = all.filter(g => g.round === 'GP' && g.status === 'final').length;
  const total = all.filter(g => g.round === 'GP').length;

  document.getElementById('nbaNow').innerHTML = nbaNowHTML(all);

  bracketEl.innerHTML = `
    <div class="nba-winners">
      ${nbaWinnerTile('East winner', sf[0].winner, span('SF') && `Semifinal ${span('SF')}`)}
      ${nbaWinnerTile('🏆 Cup champion', fin[0].winner, span('F') && `Final ${span('F')}`, 'champ')}
      ${nbaWinnerTile('West winner', sf[1].winner, span('SF') && `Semifinal ${span('SF')}`)}
    </div>
    <div class="nba-progress">
      <div class="nba-progress-bar"><div style="width:${total ? played / total * 100 : 0}%"></div></div>
      <span>${st.done ? 'Group play complete' : `Group play: ${played} of ${total} games, ends ${span('GP').split(' to ').pop()}`}</span>
    </div>

    <div class="nba-title">Bracket<span>${!st.done ? 'Teams are set when group play ends' : projected ? 'Seeds from the final group standings' : ''}</span></div>
    <div class="bracket-wrapper nba-bracket-wrap"><div class="bracket">
      ${[qf, sf, fin].map((r, i) => `<div class="bracket-round">
        <div class="bracket-round-label">${['Quarterfinals', 'Semifinals', 'Championship'][i]}<small>${span(['QF', 'SF', 'F'][i])}</small></div>
        <div class="bracket-body">${r.map(nbaBracketCell).join('')}</div>
      </div>`).join('')}
    </div></div>

    <div class="nba-title">${st.done ? 'Who advanced' : 'If group play ended today'}</div>
    <p class="nba-note">4 teams per conference reach the quarterfinals: the 3 group leaders and 1 wild card (the best second-place team). <b>Cup</b> is the record in Cup games only, which is all that counts here. <b>Season</b> is the full NBA record.</p>
    <div class="groups-grid">${nbaPictureCard('East', st)}${nbaPictureCard('West', st)}</div>

    <div class="nba-title">How it works</div>
    <div class="nba-steps">
      <div class="nba-step"><b>1 · Groups</b>6 groups of 5. Everyone plays 4 Cup games.</div>
      <div class="nba-step"><b>2 · Eight advance</b>Each group winner, plus 1 wild card per conference.</div>
      <div class="nba-step"><b>3 · Knockout</b>Lose once and you're out.</div>
    </div>`;

  document.getElementById('nbaGroupsEl').innerHTML = `
    <p class="nba-note">Cup games only. A team's season record is separate and does not count.</p>
    <div class="nba-legend"><i class="pos-q">●</i> group leader <i class="pos-m">●</i> wild card
      <span class="nba-up">▲</span><span class="nba-down">▼</span> moved last game night
      <span class="nba-form"><i class="W"></i></span> win <span class="nba-form"><i class="L"></i></span> loss</div>
    <div class="groups-grid">${st.groups.map((g, i) => nbaGroupCard(g, i, prev)).join('')}</div>`;

  const past = all.filter(g => getDateKey(new Date(g.date), nbaTZ(g)) < todayKey);
  const current = all.filter(g => !past.includes(g));
  document.getElementById('nbaScheduleEl').innerHTML = `
    <p class="nba-note">Only Cup games are listed. Regular NBA games on other nights are not part of the Cup.</p>
    ${past.length ? `
      <div class="past-toggle-bar ${nbaPastOpen ? 'open' : ''}" onclick="nbaTogglePast()">
        <span class="ptb-arrow">▸</span>
        <span class="ptb-label">Past games (${past.length})</span>
      </div>
      <div class="past-schedule ${nbaPastOpen ? 'open' : ''}">${nbaPastOpen ? nbaDays(past, todayKey) : ''}</div>` : ''}
    ${current.length ? nbaDays(current, todayKey) : `<p class="schedule-empty">The NBA Cup is complete.</p>`}`;
}

// Box-score detail under the modal meta: quarter scores, leaders, ESPN's recap line.
function nbaDetail(g) {
  const el = document.getElementById('nbaDetail');
  const played = g.status !== 'upcoming' && g.teams.some(t => t.q.length);
  const n = Math.max(...g.teams.map(t => t.q.length), 4);
  const line = played ? `<table class="nba-line">
    <thead><tr><th></th>${Array.from({ length: n }, (_, i) => `<th>${i < 4 ? 'Q' + (i + 1) : 'OT' + (i > 4 ? i - 3 : '')}</th>`).join('')}<th>T</th></tr></thead>
    <tbody>${g.teams.map(t => `<tr class="${t.winner ? 'won' : ''}"><td>${nbaLogo(t)}${nbaEsc(t.abbr)}</td>${Array.from({ length: n }, (_, i) => `<td>${t.q[i] ?? ''}</td>`).join('')}<td><b>${t.score}</b></td></tr>`).join('')}</tbody>
  </table>` : '';
  const leaders = g.teams.some(t => t.lead.length) ? `<div class="nba-leaders">${g.teams.map(t => `
    <div><div class="nba-leaders-team">${nbaLogo(t)}${nbaEsc(t.abbr)}${t.rec ? `<span>${nbaEsc(t.rec)}</span>` : ''}</div>
      ${t.lead.map(l => `<div class="nba-leader"><b>${nbaEsc(l.v)}</b> ${nbaEsc(l.k)} <span>${nbaEsc(l.n)}</span></div>`).join('')}</div>`).join('')}</div>` : '';
  el.innerHTML = (g.headline ? `<div class="nba-headline">${nbaEsc(g.headline)}</div>` : '')
    + line
    + (leaders ? `<div class="events-title">${played ? 'Game leaders' : 'Season leaders'}</div>${leaders}` : '');
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
  nbaDetail(g);

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
  try {
    const saved = JSON.parse(localStorage.getItem(NBA_LS) || '{}');
    nbaGames = saved.games || {}; nbaUpdated = saved.t || null;
  } catch (e) {}
  renderNba();
  nbaFetch(true);
  setInterval(() => { if (!document.hidden) nbaFetch(false); }, 60000);
  setInterval(() => { if (!document.hidden) nbaFetch(true); }, 15 * 60000); // picks up newly named knockout teams
  document.addEventListener('visibilitychange', () => { if (!document.hidden) nbaFetch(true); });
  window.addEventListener('online', () => nbaFetch(true));
  if (location.hash.startsWith('#NBA')) {
    setSport('nba');
    openNbaModal(location.hash.slice(4));
  }
}
if (typeof module !== 'undefined') module.exports = { nbaSlim, nbaStandings, nbaBracket };
