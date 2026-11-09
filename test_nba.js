// NBA Cup self-check. Run: node test_nba.js
// Builds a fake 30-team Cup in ESPN's event shape and checks that groups,
// seeds, and the knockout tree come out of it correctly.
const { nbaSlim, nbaStandings, nbaBracket } = require('./nba.js');
const ok = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } };

const EAST = 'ATL BOS BKN CHA CHI CLE DET IND MIA MIL NY ORL PHI TOR WSH'.split(' ');
const WEST = 'DAL DEN GS HOU LAC LAL MEM MIN NO OKC PHX POR SA SAC UTAH'.split(' ');
let n = 0;
const ev = (note, home, away, hs, as, state = 'post', date = '2026-11-07T00:00Z') => ({
  id: String(++n), date, status: { type: { state } },
  competitions: [{ notes: [{ headline: note }], competitors: [
    { homeAway: 'home', score: String(hs), winner: state === 'post' && hs > as, team: { abbreviation: home, shortDisplayName: home } },
    { homeAway: 'away', score: String(as), winner: state === 'post' && as > hs, team: { abbreviation: away, shortDisplayName: away } },
  ] }],
});

// Groups of 5 in list order; the earlier team always wins, by a margin that
// grows with the gap, so each group finishes 4-0, 3-1, 2-2, 1-3, 0-4.
const events = [ev('Not a cup game', 'ATL', 'DAL', 100, 90)];
[EAST, WEST].forEach(conf => {
  for (let g = 0; g < 3; g++) {
    const grp = conf.slice(g * 5, g * 5 + 5);
    for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++)
      events.push(ev('NBA Cup - Group Play', grp[i], grp[j], 100 + (j - i) + g, 100));
  }
});
const games = {};
events.forEach(e => { const s = nbaSlim(e); if (s) games[s.id] = s; });
ok(Object.keys(games).length === 60, '60 group games, non-cup game dropped');

const st = nbaStandings(games);
ok(st.groups.length === 6 && st.groups.every(g => g.teams.length === 5), '6 groups of 5');
ok(st.groups.filter(g => g.conf === 'East').length === 3, '3 East groups');
ok(st.done, 'group play complete');
ok(st.groups[0].teams.map(t => t.w).join('') === '43210', 'group sorted by wins');
// Later groups win by more, so seeds run group 3, 2, 1; wild card is the best runner-up.
ok(st.seeds.East.map(t => t.abbr).join() === 'NY,CLE,ATL,ORL', 'East seeds: ' + st.seeds.East.map(t => t.abbr));
ok(st.groups[0].teams[0].form.join('') === 'WWWW' && nbaStandings(games, '2026-01-01').groups[0].teams[0].w === 0, 'form tracked; cutoff rewinds the table');
ok(st.seeds.East[3].q === 'wc' && st.seeds.East[0].q === 'win', 'wild card flagged');

// Mid group play nothing is seeded: the bracket shows slot labels, not teams.
const first = Object.keys(games)[0];
const partial = { ...games, [first]: { ...games[first], status: 'upcoming' } };
const mid = nbaStandings(partial);
ok(!mid.done && nbaBracket(partial, mid)[0].every(m => !m.projected && m.teams.every(x => x == null)), 'no teams in the bracket before group play ends');
ok(nbaBracket(partial, mid)[0][0].labels.join() === 'East #1 seed,East wild card', 'slot labels');

let [qf, sf, fin] = nbaBracket(games, st);
ok(qf.length === 4 && sf.length === 2 && fin.length === 1, '4-2-1 tree');
ok(qf.every(m => m.projected), 'quarterfinals projected before ESPN names them');
ok(qf[0].teams.map(t => t.abbr).join() === 'NY,ORL' && qf[1].teams.map(t => t.abbr).join() === 'CLE,ATL', '1v4 and 2v3');
ok(sf[0].teams.every(t => t == null), 'semifinal undecided');

// ESPN posts the real knockout games: they replace the projections and feed forward.
[ev('NBA Cup - Quarterfinals', 'NY', 'ORL', 110, 100), ev('NBA Cup - Quarterfinals', 'CLE', 'ATL', 90, 99),
 ev('NBA Cup - Quarterfinals', 'TBD', 'TBD', 0, 0, 'pre'), ev('NBA Cup - Semifinals', 'TBD', 'TBD', 0, 0, 'pre')]
  .forEach(e => { const s = nbaSlim(e); games[s.id] = s; });
[qf, sf, fin] = nbaBracket(games, st);
ok(qf[0].game && qf[1].game && !qf[0].projected, 'real East quarterfinals bound');
ok(qf[2].projected && qf[3].projected, 'West still projected (TBD event ignored)');
ok(sf[0].teams.map(t => t.abbr).join() === 'NY,ATL', 'QF winners advance to the semifinal');
ok(fin[0].teams.every(t => t == null) && !fin[0].winner, 'final undecided');

if (!process.exitCode) console.log('NBA Cup checks passed');
