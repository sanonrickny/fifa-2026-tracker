// ═══════════════════════════════════════════════
//  DATA
// ═══════════════════════════════════════════════

const GROUPS = {
  A: { teams: [
    { name:'Mexico',       code:'MEX', flag:'🇲🇽' },
    { name:'South Africa', code:'RSA', flag:'🇿🇦' },
    { name:'South Korea',  code:'KOR', flag:'🇰🇷' },
    { name:'Czechia',      code:'CZE', flag:'🇨🇿' },
  ]},
  B: { teams: [
    { name:'Canada',              code:'CAN', flag:'🇨🇦' },
    { name:'Bosnia-Herzegovina',  code:'BIH', flag:'🇧🇦' },
    { name:'Qatar',               code:'QAT', flag:'🇶🇦' },
    { name:'Switzerland',         code:'SUI', flag:'🇨🇭' },
  ]},
  C: { teams: [
    { name:'Brazil',   code:'BRA', flag:'🇧🇷' },
    { name:'Morocco',  code:'MAR', flag:'🇲🇦' },
    { name:'Haiti',    code:'HAI', flag:'🇭🇹' },
    { name:'Scotland', code:'SCO', flag:'🏴󠁧󠁢󠁳󠁣󠁴󠁿' },
  ]},
  D: { teams: [
    { name:'United States', code:'USA', flag:'🇺🇸' },
    { name:'Paraguay',      code:'PAR', flag:'🇵🇾' },
    { name:'Australia',     code:'AUS', flag:'🇦🇺' },
    { name:'Türkiye',       code:'TUR', flag:'🇹🇷' },
  ]},
  E: { teams: [
    { name:'Germany',      code:'GER', flag:'🇩🇪' },
    { name:'Ivory Coast',  code:'CIV', flag:'🇨🇮' },
    { name:'Ecuador',      code:'ECU', flag:'🇪🇨' },
    { name:'Curaçao',      code:'CUW', flag:'🇨🇼' },
  ]},
  F: { teams: [
    { name:'Netherlands', code:'NED', flag:'🇳🇱' },
    { name:'Sweden',      code:'SWE', flag:'🇸🇪' },
    { name:'Tunisia',     code:'TUN', flag:'🇹🇳' },
    { name:'Japan',       code:'JPN', flag:'🇯🇵' },
  ]},
  G: { teams: [
    { name:'Belgium',     code:'BEL', flag:'🇧🇪' },
    { name:'Egypt',       code:'EGY', flag:'🇪🇬' },
    { name:'Iran',        code:'IRN', flag:'🇮🇷' },
    { name:'New Zealand', code:'NZL', flag:'🇳🇿' },
  ]},
  H: { teams: [
    { name:'Spain',        code:'ESP', flag:'🇪🇸' },
    { name:'Cape Verde',   code:'CPV', flag:'🇨🇻' },
    { name:'Saudi Arabia', code:'KSA', flag:'🇸🇦' },
    { name:'Uruguay',      code:'URU', flag:'🇺🇾' },
  ]},
  I: { teams: [
    { name:'France',  code:'FRA', flag:'🇫🇷' },
    { name:'Senegal', code:'SEN', flag:'🇸🇳' },
    { name:'Iraq',    code:'IRQ', flag:'🇮🇶' },
    { name:'Norway',  code:'NOR', flag:'🇳🇴' },
  ]},
  J: { teams: [
    { name:'Argentina', code:'ARG', flag:'🇦🇷' },
    { name:'Algeria',   code:'ALG', flag:'🇩🇿' },
    { name:'Austria',   code:'AUT', flag:'🇦🇹' },
    { name:'Jordan',    code:'JOR', flag:'🇯🇴' },
  ]},
  K: { teams: [
    { name:'Portugal',   code:'POR', flag:'🇵🇹' },
    { name:'DR Congo',   code:'COD', flag:'🇨🇩' },
    { name:'Uzbekistan', code:'UZB', flag:'🇺🇿' },
    { name:'Colombia',   code:'COL', flag:'🇨🇴' },
  ]},
  L: { teams: [
    { name:'England', code:'ENG', flag:'🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
    { name:'Croatia', code:'CRO', flag:'🇭🇷' },
    { name:'Ghana',   code:'GHA', flag:'🇬🇭' },
    { name:'Panama',  code:'PAN', flag:'🇵🇦' },
  ]},
};

// Streaming options — free is shown first and highlighted
const FREE_STREAMS = [
  {
    name: 'Tubi',
    note: 'Free – select matches (Mexico vs South Africa & USA vs Paraguay)',
    icon: '📺',
    badge: 'FREE',
    url: 'https://tubitv.com/live',
    type: 'free'
  },
  {
    name: 'Over-the-Air Antenna (FOX)',
    note: 'Free HD broadcast if you have an antenna – most matches on FOX',
    icon: '📡',
    badge: 'FREE',
    url: 'https://www.foxsports.com/soccer/fifa-world-cup',
    type: 'free'
  },
  {
    name: 'Peacock (Spanish / Telemundo)',
    note: 'Free with Walmart+ or Instacart – Spanish language coverage',
    icon: '🦚',
    badge: 'FREE*',
    url: 'https://www.peacocktv.com',
    type: 'free'
  },
];

const PAID_STREAMS = [
  { name:'FOX One',        note:'7-day free trial · $19.99/mo after',  icon:'🦊', badge:'TRIAL', url:'https://www.fox.com/soccer/fifa-world-cup', type:'trial' },
  { name:'YouTube TV',     note:'21-day free trial · then $72.99/mo',  icon:'▶️',  badge:'TRIAL', url:'https://tv.youtube.com/browse/fifa-world-cup-UCgL1z0K3r-CJig5sXlSvDbg', type:'trial' },
  { name:'Fubo',           note:'5-day free trial · FOX + FS1 included', icon:'📡', badge:'TRIAL', url:'https://www.fubo.tv/stream/worldcup/', type:'trial' },
  { name:'DirecTV Stream', note:'5-day free trial · FOX + FS1 included', icon:'🛰️', badge:'TRIAL', url:'https://www.directv.com/stream/', type:'trial' },
  { name:'Hulu + Live TV', note:'$82.99/mo · FOX + FS1 included',      icon:'🟩', badge:'PAID',  url:'https://www.hulu.com/live-tv', type:'paid' },
  { name:'Sling TV',       note:'Select cities · Orange package',       icon:'🔷', badge:'PAID',  url:'https://www.sling.com', type:'paid' },
];

// Tubi-specific match IDs
const TUBI_MATCHES = ['A1', 'D1'];

// ─── SCHEDULE DATA ───────────────────────────────────────────────────────────
// Rebuilt from the official FIFA World Cup 2026 fixture list (verified against
// ESPN's fifa.world schedule feed). Format:
//   [id, group, home_code, away_code, date(YYYY-MM-DD), utc(HH:MM), venue, city, broadcaster]
// `date`+`utc` are the kickoff in UTC; id encodes group + matchday (1-2 = MD1,
// 3-4 = MD2, 5-6 = MD3). Home/away follow FIFA's official designation.
const RAW_MATCHES = [
  // GROUP A
  ['A1','A','MEX','RSA','2026-06-11','19:00','Estadio Banorte','Mexico City, Mexico','FOX'],
  ['A2','A','KOR','CZE','2026-06-12','02:00','Estadio Akron','Guadalajara, Mexico','FS1'],
  ['A3','A','CZE','RSA','2026-06-18','16:00','Mercedes-Benz Stadium','Atlanta, GA','FOX'],
  ['A4','A','MEX','KOR','2026-06-19','01:00','Estadio Akron','Guadalajara, Mexico','FOX'],
  ['A5','A','MEX','CZE','2026-06-25','01:00','Estadio Banorte','Mexico City, Mexico','FOX'],
  ['A6','A','KOR','RSA','2026-06-25','01:00','Estadio BBVA','Monterrey, Mexico','FS1'],
  // GROUP B
  ['B1','B','CAN','BIH','2026-06-12','19:00','BMO Field','Toronto, Canada','FOX'],
  ['B2','B','QAT','SUI','2026-06-13','19:00','Levi\'s Stadium','Santa Clara, CA','FOX'],
  ['B3','B','SUI','BIH','2026-06-18','19:00','SoFi Stadium','Inglewood, CA','FOX'],
  ['B4','B','CAN','QAT','2026-06-18','22:00','BC Place','Vancouver, Canada','FS1'],
  ['B5','B','BIH','QAT','2026-06-24','19:00','Lumen Field','Seattle, WA','FS1'],
  ['B6','B','CAN','SUI','2026-06-24','19:00','BC Place','Vancouver, Canada','FOX'],
  // GROUP C
  ['C1','C','BRA','MAR','2026-06-13','22:00','MetLife Stadium','East Rutherford, NJ','FOX'],
  ['C2','C','HAI','SCO','2026-06-14','01:00','Gillette Stadium','Foxborough, MA','FOX'],
  ['C3','C','SCO','MAR','2026-06-19','22:00','Gillette Stadium','Foxborough, MA','FOX'],
  ['C4','C','BRA','HAI','2026-06-20','00:30','Lincoln Financial Field','Philadelphia, PA','FOX'],
  ['C5','C','HAI','MAR','2026-06-24','22:00','Mercedes-Benz Stadium','Atlanta, GA','FS1'],
  ['C6','C','BRA','SCO','2026-06-24','22:00','Hard Rock Stadium','Miami Gardens, FL','FOX'],
  // GROUP D
  ['D1','D','USA','PAR','2026-06-13','01:00','SoFi Stadium','Inglewood, CA','FOX'],
  ['D2','D','AUS','TUR','2026-06-14','04:00','BC Place','Vancouver, Canada','FS1'],
  ['D3','D','USA','AUS','2026-06-19','19:00','Lumen Field','Seattle, WA','FOX'],
  ['D4','D','TUR','PAR','2026-06-20','03:00','Levi\'s Stadium','Santa Clara, CA','FS1'],
  ['D5','D','PAR','AUS','2026-06-26','02:00','Levi\'s Stadium','Santa Clara, CA','FS1'],
  ['D6','D','TUR','USA','2026-06-26','02:00','SoFi Stadium','Inglewood, CA','FOX'],
  // GROUP E
  ['E1','E','GER','CUW','2026-06-14','17:00','NRG Stadium','Houston, TX','FOX'],
  ['E2','E','CIV','ECU','2026-06-14','23:00','Lincoln Financial Field','Philadelphia, PA','FS1'],
  ['E3','E','GER','CIV','2026-06-20','20:00','BMO Field','Toronto, Canada','FOX'],
  ['E4','E','ECU','CUW','2026-06-21','00:00','GEHA Field at Arrowhead Stadium','Kansas City, MO','FS1'],
  ['E5','E','CUW','CIV','2026-06-25','20:00','Lincoln Financial Field','Philadelphia, PA','FS1'],
  ['E6','E','ECU','GER','2026-06-25','20:00','MetLife Stadium','East Rutherford, NJ','FOX'],
  // GROUP F
  ['F1','F','NED','JPN','2026-06-14','20:00','AT&T Stadium','Arlington, TX','FOX'],
  ['F2','F','SWE','TUN','2026-06-15','02:00','Estadio BBVA','Monterrey, Mexico','FS1'],
  ['F3','F','NED','SWE','2026-06-20','17:00','NRG Stadium','Houston, TX','FOX'],
  ['F4','F','TUN','JPN','2026-06-21','04:00','Estadio BBVA','Monterrey, Mexico','FS1'],
  ['F5','F','JPN','SWE','2026-06-25','23:00','AT&T Stadium','Arlington, TX','FS1'],
  ['F6','F','TUN','NED','2026-06-25','23:00','GEHA Field at Arrowhead Stadium','Kansas City, MO','FOX'],
  // GROUP G
  ['G1','G','BEL','EGY','2026-06-15','19:00','Lumen Field','Seattle, WA','FOX'],
  ['G2','G','IRN','NZL','2026-06-16','01:00','SoFi Stadium','Inglewood, CA','FS1'],
  ['G3','G','BEL','IRN','2026-06-21','19:00','SoFi Stadium','Inglewood, CA','FS1'],
  ['G4','G','NZL','EGY','2026-06-22','01:00','BC Place','Vancouver, Canada','FS1'],
  ['G5','G','EGY','IRN','2026-06-27','03:00','Lumen Field','Seattle, WA','FS1'],
  ['G6','G','NZL','BEL','2026-06-27','03:00','BC Place','Vancouver, Canada','FOX'],
  // GROUP H
  ['H1','H','ESP','CPV','2026-06-15','16:00','Mercedes-Benz Stadium','Atlanta, GA','FOX'],
  ['H2','H','KSA','URU','2026-06-15','22:00','Hard Rock Stadium','Miami Gardens, FL','FS1'],
  ['H3','H','ESP','KSA','2026-06-21','16:00','Mercedes-Benz Stadium','Atlanta, GA','FOX'],
  ['H4','H','URU','CPV','2026-06-21','22:00','Hard Rock Stadium','Miami Gardens, FL','FS1'],
  ['H5','H','CPV','KSA','2026-06-27','00:00','NRG Stadium','Houston, TX','FS1'],
  ['H6','H','URU','ESP','2026-06-27','00:00','Estadio Akron','Guadalajara, Mexico','FOX'],
  // GROUP I
  ['I1','I','FRA','SEN','2026-06-16','19:00','MetLife Stadium','East Rutherford, NJ','FOX'],
  ['I2','I','NOR','IRQ','2026-06-16','22:00','Gillette Stadium','Foxborough, MA','FOX'],
  ['I3','I','FRA','IRQ','2026-06-22','21:00','Lincoln Financial Field','Philadelphia, PA','FOX'],
  ['I4','I','NOR','SEN','2026-06-23','00:00','MetLife Stadium','East Rutherford, NJ','FOX'],
  ['I5','I','NOR','FRA','2026-06-26','19:00','Gillette Stadium','Foxborough, MA','FOX'],
  ['I6','I','SEN','IRQ','2026-06-26','19:00','BMO Field','Toronto, Canada','FS1'],
  // GROUP J
  ['J1','J','ARG','ALG','2026-06-17','01:00','GEHA Field at Arrowhead Stadium','Kansas City, MO','FOX'],
  ['J2','J','AUT','JOR','2026-06-17','04:00','Levi\'s Stadium','Santa Clara, CA','FS1'],
  ['J3','J','ARG','AUT','2026-06-22','17:00','AT&T Stadium','Arlington, TX','FOX'],
  ['J4','J','JOR','ALG','2026-06-23','03:00','Levi\'s Stadium','Santa Clara, CA','FS1'],
  ['J5','J','ALG','AUT','2026-06-28','02:00','GEHA Field at Arrowhead Stadium','Kansas City, MO','FS1'],
  ['J6','J','JOR','ARG','2026-06-28','02:00','AT&T Stadium','Arlington, TX','FOX'],
  // GROUP K
  ['K1','K','POR','COD','2026-06-17','17:00','NRG Stadium','Houston, TX','FOX'],
  ['K2','K','COL','UZB','2026-06-18','02:00','Estadio Banorte','Mexico City, Mexico','FS1'],
  ['K3','K','POR','UZB','2026-06-23','17:00','NRG Stadium','Houston, TX','FOX'],
  ['K4','K','COL','COD','2026-06-24','02:00','Estadio Akron','Guadalajara, Mexico','FS1'],
  ['K5','K','COL','POR','2026-06-27','23:30','Hard Rock Stadium','Miami Gardens, FL','FOX'],
  ['K6','K','COD','UZB','2026-06-27','23:30','Mercedes-Benz Stadium','Atlanta, GA','FS1'],
  // GROUP L
  ['L1','L','ENG','CRO','2026-06-17','20:00','AT&T Stadium','Arlington, TX','FOX'],
  ['L2','L','GHA','PAN','2026-06-17','23:00','BMO Field','Toronto, Canada','FS1'],
  ['L3','L','ENG','GHA','2026-06-23','20:00','Gillette Stadium','Foxborough, MA','FOX'],
  ['L4','L','PAN','CRO','2026-06-23','23:00','BMO Field','Toronto, Canada','FOX'],
  ['L5','L','CRO','GHA','2026-06-27','21:00','Lincoln Financial Field','Philadelphia, PA','FS1'],
  ['L6','L','PAN','ENG','2026-06-27','21:00','MetLife Stadium','East Rutherford, NJ','FOX'],
];

// Knockout matches — dates/times/venues verified against the official FIFA
// World Cup 2026 schedule (ESPN fifa.world feed). Teams resolve from results.
const KNOCKOUT_ROUNDS = [
  {
    label: 'Round of 32',
    dates: ['Jun 28 – Jul 4'],
    matches: [
    { id:'R32M1', home:null, away:null, date:'Jun 29', time:'1:00 PM ET', venue:"NRG Stadium, Houston TX" },
    { id:'R32M2', home:null, away:null, date:'Jun 30', time:'1:00 PM ET', venue:"AT&T Stadium, Arlington TX" },
    { id:'R32M3', home:null, away:null, date:'Jun 28', time:'3:00 PM ET', venue:"SoFi Stadium, Inglewood CA" },
    { id:'R32M4', home:null, away:null, date:'Jun 29', time:'4:30 PM ET', venue:"Gillette Stadium, Foxborough MA" },
    { id:'R32M5', home:null, away:null, date:'Jun 29', time:'9:00 PM ET', venue:"Estadio BBVA, Monterrey MX" },
    { id:'R32M6', home:null, away:null, date:'Jun 30', time:'5:00 PM ET', venue:"MetLife Stadium, East Rutherford NJ" },
    { id:'R32M7', home:null, away:null, date:'Jun 30', time:'9:00 PM ET', venue:"Estadio Banorte, Mexico City MX" },
    { id:'R32M8', home:null, away:null, date:'Jul 1', time:'12:00 PM ET', venue:"Mercedes-Benz Stadium, Atlanta GA" },
    { id:'R32M9', home:null, away:null, date:'Jul 2', time:'3:00 PM ET', venue:"SoFi Stadium, Inglewood CA" },
    { id:'R32M10', home:null, away:null, date:'Jul 2', time:'7:00 PM ET', venue:"BMO Field, Toronto CA" },
    { id:'R32M11', home:null, away:null, date:'Jul 1', time:'4:00 PM ET', venue:"Lumen Field, Seattle WA" },
    { id:'R32M12', home:null, away:null, date:'Jul 1', time:'8:00 PM ET', venue:"Levi's Stadium, Santa Clara CA" },
    { id:'R32M13', home:null, away:null, date:'Jul 3', time:'2:00 PM ET', venue:"AT&T Stadium, Arlington TX" },
    { id:'R32M14', home:null, away:null, date:'Jul 3', time:'9:30 PM ET', venue:"GEHA Field at Arrowhead Stadium, Kansas City MO" },
    { id:'R32M15', home:null, away:null, date:'Jul 2', time:'11:00 PM ET', venue:"BC Place, Vancouver CA" },
    { id:'R32M16', home:null, away:null, date:'Jul 3', time:'6:00 PM ET', venue:"Hard Rock Stadium, Miami Gardens FL" },
    ]
  },
  {
    label: 'Round of 16',
    dates: ['Jul 4 – 7'],
    matches: [
    { id:'R16M1', home:null, away:null, date:'Jul 4', time:'1:00 PM ET', venue:"NRG Stadium, Houston TX" },
    { id:'R16M2', home:null, away:null, date:'Jul 4', time:'5:00 PM ET', venue:"Lincoln Financial Field, Philadelphia PA" },
    { id:'R16M3', home:null, away:null, date:'Jul 5', time:'4:00 PM ET', venue:"MetLife Stadium, East Rutherford NJ" },
    { id:'R16M4', home:null, away:null, date:'Jul 5', time:'8:00 PM ET', venue:"Estadio Banorte, Mexico City MX" },
    { id:'R16M5', home:null, away:null, date:'Jul 6', time:'3:00 PM ET', venue:"AT&T Stadium, Arlington TX" },
    { id:'R16M6', home:null, away:null, date:'Jul 6', time:'5:00 PM ET', venue:"Lumen Field, Seattle WA" },
    { id:'R16M7', home:null, away:null, date:'Jul 7', time:'12:00 PM ET', venue:"Mercedes-Benz Stadium, Atlanta GA" },
    { id:'R16M8', home:null, away:null, date:'Jul 7', time:'4:00 PM ET', venue:"BC Place, Vancouver CA" },
    ]
  },
  {
    label: 'Quarterfinals',
    dates: ['Jul 9 – 11'],
    matches: [
    { id:'QF1', home:null, away:null, date:'Jul 9', time:'4:00 PM ET', venue:"Gillette Stadium, Foxborough MA" },
    { id:'QF2', home:null, away:null, date:'Jul 10', time:'3:00 PM ET', venue:"SoFi Stadium, Inglewood CA" },
    { id:'QF3', home:null, away:null, date:'Jul 11', time:'5:00 PM ET', venue:"Hard Rock Stadium, Miami Gardens FL" },
    { id:'QF4', home:null, away:null, date:'Jul 11', time:'9:00 PM ET', venue:"GEHA Field at Arrowhead Stadium, Kansas City MO" },
    ]
  },
  {
    label: 'Semifinals',
    dates: ['Jul 14 – 15'],
    matches: [
    { id:'SF1', home:null, away:null, date:'Jul 14', time:'3:00 PM ET', venue:"AT&T Stadium, Arlington TX" },
    { id:'SF2', home:null, away:null, date:'Jul 15', time:'3:00 PM ET', venue:"Mercedes-Benz Stadium, Atlanta GA" },
    ]
  },
  {
    label: '🏆 FINAL',
    dates: ['Jul 19'],
    matches: [
    { id:'FIN', home:null, away:null, date:'Jul 19', time:'3:00 PM ET', venue:"MetLife Stadium, East Rutherford NJ" },
    ]
  },
];

// ─── OFFICIAL 2026 BRACKET WIRING (FIFA match numbers 73–104) ──────────────────
// Each knockout slot's two sides are defined by a "feed":
//   {gw:'A'}  winner of Group A      {gr:'A'} runner-up of Group A
//   {g3:[...]} best-third slot (allowed source groups per FIFA Annex C)
//   {w:'R32M1'} winner of an earlier knockout match
// R32 display order is arranged so each adjacent pair feeds the same R16 match.
const FEEDS = {
  // Round of 32 — slot id ↔ FIFA match #. Each slot's wiring matches the
  // date/time/venue stamped on that SAME slot in KNOCKOUT_ROUNDS above.
  R32M1:  { home:{gw:'C'}, away:{gr:'F'} },                   // M76
  R32M2:  { home:{gr:'E'}, away:{gr:'I'} },                   // M78
  R32M3:  { home:{gr:'A'}, away:{gr:'B'} },                   // M73
  R32M4:  { home:{gw:'E'}, away:{g3:['A','B','C','D','F']} }, // M74
  R32M5:  { home:{gw:'F'}, away:{gr:'C'} },                   // M75
  R32M6:  { home:{gw:'I'}, away:{g3:['C','D','F','G','H']} }, // M77
  R32M7:  { home:{gw:'A'}, away:{g3:['C','E','F','H','I']} }, // M79
  R32M8:  { home:{gw:'L'}, away:{g3:['E','H','I','J','K']} }, // M80
  R32M9:  { home:{gw:'H'}, away:{gr:'J'} },                   // M84
  R32M10: { home:{gr:'K'}, away:{gr:'L'} },                   // M83
  R32M11: { home:{gw:'G'}, away:{g3:['A','E','H','I','J']} }, // M82
  R32M12: { home:{gw:'D'}, away:{g3:['B','E','F','I','J']} }, // M81
  R32M13: { home:{gr:'D'}, away:{gr:'G'} },                   // M88
  R32M14: { home:{gw:'K'}, away:{g3:['D','E','I','J','L']} }, // M87
  R32M15: { home:{gw:'B'}, away:{g3:['E','F','G','I','J']} }, // M85
  R32M16: { home:{gw:'J'}, away:{gr:'H'} },                   // M86
  // ── Round of 16 — wiring verified against ESPN's live FIFA.World bracket
  // (each R16 game's two Round-of-32-winner feeds), mapped by host venue.
  // The 2026 bracket is NOT the naive "W73 v W74 / W75 v W76" pairing, so each
  // slot is wired to the exact R32 slots ESPN reports for that venue. ──
  R16M1: { home:{w:'R32M3'},  away:{w:'R32M5'}  }, // NRG Houston       W(M73) v W(M75)
  R16M2: { home:{w:'R32M4'},  away:{w:'R32M6'}  }, // Lincoln Philly    W(M74) v W(M77)
  R16M3: { home:{w:'R32M1'},  away:{w:'R32M2'}  }, // MetLife NJ        W(M76) v W(M78)
  R16M4: { home:{w:'R32M7'},  away:{w:'R32M8'}  }, // Estadio Banorte   W(M79) v W(M80)
  R16M5: { home:{w:'R32M10'}, away:{w:'R32M9'}  }, // AT&T Arlington    W(M83) v W(M84)
  R16M6: { home:{w:'R32M12'}, away:{w:'R32M11'} }, // Lumen Seattle     W(M81) v W(M82)
  R16M7: { home:{w:'R32M16'}, away:{w:'R32M13'} }, // Mercedes-Benz     W(M86) v W(M88)
  R16M8: { home:{w:'R32M15'}, away:{w:'R32M14'} }, // BC Place          W(M85) v W(M87)
  // ── Quarterfinals — R16 winners per ESPN's bracket, mapped by host venue. ──
  QF1: { home:{w:'R16M2'}, away:{w:'R16M1'} }, // Gillette Foxborough
  QF2: { home:{w:'R16M5'}, away:{w:'R16M6'} }, // SoFi Inglewood
  QF3: { home:{w:'R16M3'}, away:{w:'R16M4'} }, // Hard Rock Miami
  QF4: { home:{w:'R16M7'}, away:{w:'R16M8'} }, // GEHA Arrowhead KC
  // Semifinals + Final
  SF1: { home:{w:'QF1'}, away:{w:'QF2'} }, // M101
  SF2: { home:{w:'QF3'}, away:{w:'QF4'} }, // M102
  FIN: { home:{w:'SF1'}, away:{w:'SF2'} }, // M104
};

// The 8 best-third-place R32 slots (the side carrying a {g3} feed) and their
// FIFA-allowed source groups. Used to assign qualifying thirds to slots.
const THIRD_SLOTS = [
  { id:'R32M4',  allowed:['A','B','C','D','F'] }, // M74
  { id:'R32M6',  allowed:['C','D','F','G','H'] }, // M77
  { id:'R32M7',  allowed:['C','E','F','H','I'] }, // M79
  { id:'R32M8',  allowed:['E','H','I','J','K'] }, // M80
  { id:'R32M11', allowed:['A','E','H','I','J'] }, // M82
  { id:'R32M12', allowed:['B','E','F','I','J'] }, // M81
  { id:'R32M14', allowed:['D','E','I','J','L'] }, // M87
  { id:'R32M15', allowed:['E','F','G','I','J'] }, // M85
];

// FIFA uses a FIXED published table mapping the SET of 8 groups whose third
// qualifies → which R32 slot each plays (multiple valid bijections exist, but
// only one is official). Backtracking over THIRD_SLOTS finds *a* valid mapping,
// not necessarily FIFA's. Override with the official slotting for known sets.
// Key: the 8 qualifying group letters, sorted and joined. Value: slot → group.
// ponytail: only the actual 2026 qualifying set is encoded (group stage is
// over, so it's locked); any other set falls back to backtracking. Add a row
// here if the set ever changes.
const THIRD_ALLOCATION = {
  // Qualifying thirds B,D,E,F,I,J,K,L → official FIFA 2026 R32 slotting
  // (verified against the published Round of 32 bracket: Germany–Paraguay,
  //  France–Sweden, USA–Bosnia, Belgium–Senegal, Mexico–Ecuador,
  //  England–Congo DR, Switzerland–Algeria, Colombia–Ghana).
  BDEFIJKL: { R32M4:'D', R32M6:'F', R32M7:'E', R32M8:'K', R32M11:'I', R32M12:'B', R32M14:'L', R32M15:'J' },
};
