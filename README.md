# Training App

An adaptive **cycling + strength planner** that connects to **intervals.icu** (and through it, Garmin — optionally Strava) and plans your next 7 days from:

- **Readiness**: HRV (7-day ln rMSSD vs your personal normal range), resting HR, sleep, form (TSB), fitness ramp rate and an optional "how do you feel" check-in.
- **Training trends**: weekly load, intensity distribution, recent hard sessions, longest ride, lifting frequency, monotony.
- **Your season**: goal event + date, macro periodization model (traditional, block, reverse, HRV-guided), intensity distribution (auto, polarized, pyramidal, sweet spot) and loading pattern (2:1 / 3:1 / 4:1).
- **Your week**: hours available, days you can't train, group rides (with how hard they usually are), races, or a specific workout you want on a day.
- **Strength**: your lifting frequency, equipment (full gym, home barbell, dumbbells/KB, bodyweight) and experience. The plan picks lift days, which phase you're in (adaptation → max strength → power → maintenance → taper) and the exercises.

Then **one tap sends the week to your intervals.icu calendar as structured workouts**, which intervals.icu syncs on to Garmin Connect (and Zwift/Wahoo if you use them).

### Borrowed from the best training apps

| Idea | Inspired by |
|---|---|
| Per-zone **progression levels** (1-10) from detected efforts; workouts labelled Achievable / Productive / Stretch | TrainerRoad |
| **Post-ride feel / RPE** adapts your levels; **missed key sessions are rescheduled**; group rides count as intensity | JOIN, TrainerRoad |
| **Smart swaps**: easier / harder / shorter / same focus / endurance instead | JOIN, Garmin, TrainerRoad |
| **Training Load Focus** (low/high aerobic, anaerobic vs phase targets) steers session choice; **Training Status** label | Garmin |
| **Readiness factors** and HRV status (Balanced / Unbalanced / Low) | Garmin |
| **Next-workout hero** card with one-tap adjustments | Garmin daily suggested workout, JOIN |
| **Compliance colours** for planned vs done | TrainingPeaks |
| **PMC with planned-week projection**, weekly TSS targets (ATP) | TrainingPeaks |
| **Form zones**, aerobic decoupling and efficiency-factor trends | intervals.icu, TrainingPeaks |
| **Power profile & rider type**, limiter-aware session choice | JOIN, Wahoo 4DP, TrainingPeaks |
| **.zwo export** for Zwift/indoor apps | TrainingPeaks, JOIN |

## Quick start

```bash
npm install
npm run dev          # app on http://localhost:5173 (API server on :8787)
```

Or a production build served by the bundled Node server:

```bash
npm run build
npm start            # http://localhost:8787
```

The app opens with **demo data**, so you can explore it before connecting anything.

## Connect your data

1. **intervals.icu** → Settings → *Developer Settings*: copy your **API key** and **athlete ID** (looks like `i12345`). Paste them in the app's **Settings** page and hit **Sync now**. The key is stored only in your browser (or put it in `.env` as `ICU_API_KEY` / `ICU_ATHLETE_ID` so the browser never sees it).
2. **Garmin**: Garmin's API is only open to approved businesses, so this app uses intervals.icu's official Garmin integration. In intervals.icu → Settings → Garmin enable **Sync activities**, **Download wellness** (HRV, resting HR, sleep) and **Upload planned workouts**.
3. **Strava (optional)**: only useful if some activities reach intervals.icu via Strava, because Strava's API terms stop intervals.icu from passing those on to other apps. Create an app at <https://www.strava.com/settings/api>, set *Authorization Callback Domain* to your host (e.g. `localhost`), copy `.env.example` to `.env`, fill in `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET` and `PUBLIC_URL`, restart, then use **Connect Strava** in Settings.

## Using it each week

1. **Week** tab → **Edit this week**: set your hours, mark days you can't train, add group rides/races, or pick a workout for a day. **Save as my usual week** pre-fills future weeks.
2. Check your readiness card (optionally tell it how you feel). Expand any day for intervals with watts/HR targets, the reasoning, fueling and the lifting session.
3. Swap any workout from the library, or mark a day "Can't train", and the rest of the week re-plans around it.
4. **Send to intervals.icu** to put the workouts on your calendar and Garmin device. Re-sending updates the same workouts instead of duplicating them.

The **Season** tab shows your phase timeline, the week-by-week plan and projected fitness/form on race day. **Trends** shows HRV/RHR with your normal range, fitness/fatigue/form, weekly hours and intensity distribution. **Guide** explains the logic and lists references.

## Deploy / use on your phone

Any Node 20+ host works (Render, Railway, Fly.io, a VPS, a home server):

```bash
docker build -t training-app .
docker run -p 8787:8787 --env-file .env training-app
```

If the server is reachable by anyone else, **set `APP_PASSWORD`** in `.env` (especially if you put your intervals.icu key or Strava credentials on the server). Open the URL on your phone and use *Add to Home Screen*. The app is installable and works full-screen.

The static build (`dist/`) can also be hosted without the server. It then calls intervals.icu directly from the browser, which only works if intervals.icu allows cross-origin requests from your host, and Strava is unavailable.

## How the planner works (short version)

- **Macro plan** is anchored to your plan start date and counts back from the goal: e.g. traditional = prep → base → build → peak → taper → race, recovery week every 4th (3:1) week, taper 7-14 days depending on the event.
- **Each week** gets a session menu from its phase and your intensity model (e.g. build = one threshold-type + one VO2-type session + long ride). Group rides and races count as quality sessions.
- **Placement** avoids back-to-back hard days (except in a block-periodization HIT week), puts the long ride on your roomiest day (progressing at most ~25% beyond your recent longest), guarantees rest, and makes the day after a hard day easy.
- **Readiness** trims volume and delays/drops intensity when HRV is below your normal range, resting HR is elevated, sleep is short or fatigue is very high. A ramp-rate guard keeps CTL growth under your limit.
- **Workouts** progress through levels across a phase (e.g. Threshold 4×8 → 3×20) and include modern staples: 30/15s, Seiler 4×8, fast-start VO2, over-unders, durability rides, race simulations.
- **Strength** follows adaptation → max strength → strength-power → maintenance → taper, lifting on hard-ride days and never heavy the day before a key session.

## Project layout

```
server/index.mjs       zero-dependency Node server: static files, /api/icu proxy, Strava OAuth
src/engine/            pure TypeScript training logic (unit-tested)
  readiness.ts         HRV/RHR/sleep/TSB readiness
  trends.ts            load history, intensity distribution, monotony
  periodization.ts     macro plan (linear / block / reverse / HRV-guided)
  profiles.ts          what each phase's week contains
  workouts.ts          workout library with progression levels + TSS maths
  planner.ts           the weekly planner
  strength.ts          strength phases, exercises by equipment, lift-day placement
  icuExport.ts         intervals.icu workout text + calendar events
  progression.ts       per-zone progression levels, workout levels, difficulty labels
  loadFocus.ts         4-week load focus vs phase targets
  status.ts            training status + form zones
  compliance.ts        planned vs done, missed key sessions
  powerProfile.ts      power profile / rider type from CP, W′, Pmax
  zwo.ts               Zwift workout export
src/lib/               intervals.icu + Strava clients, storage, app state
src/pages, components  React UI
tests/                 vitest
```

```bash
npm test          # unit tests
npm run typecheck
```

## Disclaimer

Evidence-informed suggestions, not medical advice. If you're ill, injured or have a heart condition, get professional guidance before training hard.
