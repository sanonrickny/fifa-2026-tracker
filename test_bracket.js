// Bracket wiring self-check. Run: node test_bracket.js
// Verifies the knockout tree is a proper single-elimination bracket whose
// wiring is chronologically consistent with each slot's scheduled kickoff,
// and anchors a couple of externally-verified FIFA 2026 facts.
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/data.js', 'utf8');
const ctx = {};
new Function(src + '\nthis.FEEDS=FEEDS;this.KNOCKOUT_ROUNDS=KNOCKOUT_ROUNDS;this.THIRD_SLOTS=THIRD_SLOTS;')
  .call(ctx);
const { FEEDS, KNOCKOUT_ROUNDS, THIRD_SLOTS } = ctx;

const ok = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } };

// slot id -> kickoff Date (for chronology). "Jun 29" + "1:00 PM ET".
const MON = { Jun: 5, Jul: 6 };
const kickoff = {};
KNOCKOUT_ROUNDS.forEach(r => r.matches.forEach(m => {
  const [mon, day] = m.date.split(' ');
  const t = m.time.match(/(\d+):(\d+)\s*(AM|PM)/);
  let h = +t[1] % 12 + (t[3] === 'PM' ? 12 : 0);
  kickoff[m.id] = new Date(2026, MON[mon], +day, h, +t[2]);
}));

// Every winner-feed points at a real earlier slot, exactly once (proper tree),
// and the feeding match kicks off before the match that consumes its winner.
const fedInto = {};
Object.entries(FEEDS).forEach(([id, f]) => {
  [f.home, f.away].forEach(s => {
    if (!s.w) return;
    ok(kickoff[s.w], `${id} feeds from unknown match ${s.w}`);
    fedInto[s.w] = (fedInto[s.w] || 0) + 1;
    ok(kickoff[s.w] < kickoff[id], `${s.w} must kick off before ${id} that uses its winner`);
  });
});
Object.keys(kickoff).forEach(id => {
  if (id === 'FIN') return;
  ok(fedInto[id] === 1, `${id} should feed exactly one later match, got ${fedInto[id] || 0}`);
});

// Counts: 16 R32, 8 R16, 4 QF, 2 SF, 1 FIN = 31 matches; 8 third-place slots.
ok(Object.keys(FEEDS).length === 31, `expected 31 knockout matches, got ${Object.keys(FEEDS).length}`);
const g3Slots = Object.entries(FEEDS).filter(([, f]) => f.home.g3 || f.away.g3).map(([id]) => id);
ok(g3Slots.length === 8, `expected 8 third-place slots, got ${g3Slots.length}`);
ok(THIRD_SLOTS.length === 8 && THIRD_SLOTS.every(s => g3Slots.includes(s.id)),
   'THIRD_SLOTS ids must match the slots carrying a {g3} feed');

// Externally-verified anchors (the bug this check guards against):
//   Winner of Group C plays Jun 29, 1:00 PM ET in Houston (FIFA M76).
const r32m1 = KNOCKOUT_ROUNDS[0].matches.find(m => m.id === 'R32M1');
ok(FEEDS.R32M1.home.gw === 'C', 'R32M1 home should be Winner Group C (Brazil slot, M76)');
ok(r32m1.time === '1:00 PM ET' && /Houston/.test(r32m1.venue), 'R32M1 should be 1:00 PM ET in Houston');

if (!process.exitCode) console.log('OK: bracket wiring consistent (31 matches, proper tree, chronology, anchors)');
