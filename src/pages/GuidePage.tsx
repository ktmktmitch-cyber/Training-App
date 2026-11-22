export function GuidePage() {
  return (
    <>
      <h1>How the plan works</h1>
      <div className="card guide stack">
        <h2>Every morning</h2>
        <ul>
          <li>Garmin → intervals.icu delivers last night’s HRV, resting HR and sleep, plus your rides and lifts.</li>
          <li>Readiness compares your <b>7-day HRV average</b> (ln rMSSD) with a ~60-day personal baseline. The normal range is baseline ± 0.5 SD — the “smallest worthwhile change” approach used in HRV-guided cycling studies. A single bad morning matters less than a suppressed average.</li>
          <li>A sustained rise in resting HR, short sleep, very negative form (TSB), a fast fitness ramp and your own check-in all count. HRV down <i>and</i> resting HR up together is the strongest signal.</li>
          <li>Green: train as planned. Amber: first day easy, ~10% less volume, key sessions move later. Red: two easy days, one fewer quality session, ~25% less volume. Sick: rest.</li>
        </ul>

        <h2>Every week</h2>
        <ul>
          <li>You set your hours, the days you can’t train, group rides, races, or a workout you want on a given day.</li>
          <li>The phase of your season decides the session menu and how much of your available time to use (recovery weeks ~60%, taper ~65%, race week ~45%).</li>
          <li>Group rides and races count as quality sessions, so fewer intervals get added around them.</li>
          <li>Quality sessions are placed to avoid back-to-back hard days (except in a deliberate HIT-block week), the long ride goes on your day with the most time and grows ~25% at most beyond your recent longest ride, and you get at least one full rest day.</li>
          <li>Easy days are genuinely easy. Leftover time extends key sessions with Zone 2, and a ramp-rate guard trims easy volume if fitness (CTL) would rise faster than your limit.</li>
          <li>Interval sessions progress through levels (more time in zone) across each phase, start conservatively if you haven’t done intensity recently, and step down when readiness is amber/red.</li>
        </ul>

        <h2>Ideas borrowed from the best training apps</h2>
        <ul>
          <li><b>Progression levels (TrainerRoad):</b> each energy system (endurance, tempo, sweet spot, threshold, VO2max, anaerobic) has a 1-10 level built from the sustained efforts intervals.icu detects in your rides. Every workout has a level on the same scale and is labelled Achievable / Productive / Stretch for you. Levels fade slowly when you don’t train a system.</li>
          <li><b>Post-ride feel & RPE (JOIN, TrainerRoad):</b> tell the app how hard a ride felt (or log RPE in intervals.icu). “Easy” nudges that level up, “All out” or “Couldn’t finish” nudges it down.</li>
          <li><b>Missed sessions & swaps (JOIN):</b> a key session you missed in the last 3 days is rescheduled as the next quality session. Group rides you swap in count as intensity.</li>
          <li><b>Smart alternatives (JOIN, Garmin, TrainerRoad):</b> every ride offers Easier / Harder / Shorter / same-focus / endurance-instead swaps that respect your levels.</li>
          <li><b>Training Load Focus & Training Status (Garmin):</b> your last 4 weeks split into low aerobic / high aerobic / anaerobic load against the target for your phase. A shortage steers which sessions get picked. A one-word status (Productive, Maintaining, Peaking, Recovery, Strained, Overreaching, Unproductive, Detraining) sums up whether the training is working.</li>
          <li><b>Readiness factors (Garmin Training Readiness / HRV Status):</b> HRV Balanced/Unbalanced/Low, resting HR, form zone and sleep shown as separate factors.</li>
          <li><b>Compliance colours (TrainingPeaks):</b> last 7 days planned vs done. Green 80-120%, yellow 50-80 / 120-150%, orange beyond that, red missed.</li>
          <li><b>Performance Management Chart with projection (TrainingPeaks) and form zones (intervals.icu):</b> fitness/fatigue continue into the planned week, and form is shaded High risk / Optimal / Grey / Fresh / Transition.</li>
          <li><b>Power profile & rider type (JOIN, Wahoo 4DP, TrainingPeaks):</b> 5 s / 1 min / 5 min / FTP estimated from intervals.icu’s power-duration model. Your limiter is favoured when a phase offers a choice.</li>
          <li><b>Aerobic decoupling & efficiency factor (TrainingPeaks, intervals.icu):</b> a check on whether your aerobic base is ready for more intensity, which also nudges long-ride volume in base.</li>
          <li><b>Workout files (TrainingPeaks, JOIN):</b> download any session as a Zwift .zwo, or send the week to intervals.icu so it lands on your Garmin.</li>
        </ul>

        <h2>Macro periodization options</h2>
        <ul>
          <li><b>Traditional (linear):</b> prep → base (Zone 2 + tempo/sweet spot) → build (threshold + VO2max) → peak (race-specific) → taper. 3:1 load:recovery by default.</li>
          <li><b>Block:</b> 4-week accumulation blocks (volume + threshold) alternating with transmutation blocks that open with a HIT week of 4-5 VO2max sessions followed by weeks with one HIT session — the structure Rønnestad and colleagues found superior to evenly distributed intensity in trained cyclists.</li>
          <li><b>Reverse:</b> intensity first while volume is limited, then longer rides, sweet spot and durability work closer to the event.</li>
          <li><b>HRV-guided:</b> traditional phases, but a suppressed HRV average means no intensity that day (Javaloyes et al.). Best if you re-check each morning.</li>
        </ul>

        <h2>Intensity distribution</h2>
        <ul>
          <li>Both polarized and pyramidal distributions work; elite endurance athletes spend most time below LT1 either way. A 2024 meta-analysis found polarized training superior for VO2peak (especially in highly trained athletes), but not for other performance outcomes.</li>
          <li>“Auto” uses pyramidal in base and shifts toward polarized as competition nears (a pattern supported by Filipas et al. 2022), and switches to a sweet-spot-heavy approach if you have under ~6 h/week, where more intensity per hour pays off.</li>
        </ul>

        <h2>Workouts used</h2>
        <ul>
          <li><b>VO2max:</b> 30/15 short intervals (Rønnestad), 4×8 min (Seiler), classic 3-5 min intervals, fast-start intervals, 40/20s.</li>
          <li><b>Threshold:</b> 2×20-style progressions, over-unders, threshold with surges.</li>
          <li><b>Aerobic:</b> Zone 2 endurance, tempo, sweet spot, durability rides with efforts in the final hour.</li>
          <li><b>Specific:</b> crit simulation, climbing threshold, TT efforts in aero position, gravel race sim, anaerobic 1-min repeats, sprints, race openers.</li>
        </ul>

        <h2>Taper</h2>
        <ul>
          <li>7 days for short events (crit, XC, CX), ~10 for road/TT/hill climb, up to 14 for long gravel/ultra. Volume drops 40-60% while intensity and session frequency stay — the meta-analytic recipe (Bosquet et al. 2007). Openers the day before; rest two days out.</li>
        </ul>

        <h2>Strength</h2>
        <ul>
          <li>Anatomical adaptation → max strength (heavy, 4-6 reps) in base → strength-power with jumps in early build → one short heavy maintenance session per week in late build/peak → nothing heavy in the final week.</li>
          <li>Lift on hard-ride days (ride first, lift later) to keep easy days easy; never heavy legs the day before key sessions.</li>
        </ul>

        <h2>Fueling</h2>
        <ul>
          <li>30-60 g carbs/h for moderate rides over ~75 min, 60-90 g/h for longer or harder rides, and up to 90-120 g/h on long hard days if you have trained your gut with glucose+fructose products.</li>
        </ul>

        <p className="small muted">This app gives evidence-informed suggestions, not medical advice. If you’re ill, injured or have a heart condition, talk to a professional before training hard.</p>
      </div>

      <div className="card guide">
        <h2 style={{ marginBottom: 8 }}>Key references</h2>
        <ul className="refs">
          <li>Seiler S, Kjerland GØ (2006). Quantifying training intensity distribution in elite endurance athletes. Scand J Med Sci Sports.</li>
          <li>Stöggl T, Sperlich B (2014). Polarized training has greater impact on key endurance variables than threshold, high intensity, or high volume training. Front Physiol.</li>
          <li>Oliveira PS et al. (2024). Is polarized training superior to other training intensity distribution models? A systematic review and meta-analysis. Sports Med.</li>
          <li>Filipas L et al. (2022). Effects of 16 weeks of pyramidal and polarized training intensity distributions in well-trained endurance runners. Scand J Med Sci Sports.</li>
          <li>Seiler S et al. (2013). Adaptations to aerobic interval training: interactive effects of exercise intensity and total work duration. Scand J Med Sci Sports.</li>
          <li>Rønnestad BR et al. (2014). Block periodization of high-intensity aerobic intervals provides superior training effects in trained cyclists. Scand J Med Sci Sports.</li>
          <li>Rønnestad BR et al. (2015, 2020). Short (30/15) intervals vs effort-matched long intervals in well-trained and elite cyclists. Scand J Med Sci Sports.</li>
          <li>Javaloyes A et al. (2019). Training prescription guided by heart-rate variability in cycling. Int J Sports Physiol Perform.</li>
          <li>Plews DJ et al. (2013). Training adaptation and heart rate variability in elite endurance athletes: opening the door to effective monitoring. Sports Med.</li>
          <li>Bosquet L et al. (2007). Effects of tapering on performance: a meta-analysis. Med Sci Sports Exerc.</li>
          <li>Maunder E et al. (2021). The importance of “durability” in the physiological profiling of endurance athletes. Sports Med.</li>
          <li>Rønnestad BR, Mujika I (2014). Optimizing strength training for running and cycling endurance performance: a review. Scand J Med Sci Sports.</li>
          <li>Vikmoen O et al. (2016). Strength training improves cycling performance, fractional utilization of VO2max and cycling economy in female cyclists. Scand J Med Sci Sports.</li>
          <li>Rønnestad BR et al. (2010). In-season strength maintenance training increases well-trained cyclists’ performance. Eur J Appl Physiol.</li>
          <li>Impellizzeri FM et al. (2020). Acute:chronic workload ratio: conceptual issues and fundamental pitfalls. Int J Sports Physiol Perform. (Why this app uses CTL ramp rate, not ACWR.)</li>
        </ul>
      </div>
    </>
  );
}
