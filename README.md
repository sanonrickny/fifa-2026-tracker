# FIFA World Cup 2026 Tracker

A live tracker for the 2026 World Cup and the NBA season, built so people new to either sport can follow along.

Live at [fifa-2026-tracker.web.app](https://fifa-2026-tracker.web.app/).

## What it does

→ Live scores as matches happen  
→ Full schedule in your local time, detected automatically  
→ Bracket and standings that update automatically  
→ NBA season: every night's scores, conference standings with the playoff picture, and stat leaders, pulled live  
→ NBA Cup bracket and groups, next to the season  
→ Tap or hover any underlined term (GB, L10, wild card, GD...) for a plain-English explanation  
→ Fully responsive, works well on mobile  
→ Installable as a PWA: add it to your home screen  
→ Opens offline with the last scores it saw  

## Stack

Plain HTML, CSS, and JavaScript. No frameworks. Hosted on Firebase.

## Run locally

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000).

## Tests

```bash
node test_bracket.js
```

```bash
node test_nba.js
```

Checks the knockout bracket is a proper single-elimination tree and that the
wiring stays consistent with each slot's scheduled kickoff, and that the NBA
Cup groups, seeds, and season standings come out right.

---

Made for the love of the game.
