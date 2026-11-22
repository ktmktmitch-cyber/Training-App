// On-bike fueling guidance following current sports-nutrition consensus:
// carbohydrate intake scaled to duration/intensity (30-60 g/h → 60-90 g/h → up to
// 90-120 g/h with glucose:fructose blends for trained guts), fluids with sodium,
// and carbohydrate + protein after hard/long sessions.
import type { PlannedWorkout } from './types';

export function fuelingFor(w: PlannedWorkout, weightKg: number | null): string {
  const d = w.durationMin;
  const hard = w.intensity === 'hard' || w.category === 'race' || w.category === 'group';
  const moderate = w.intensity === 'moderate';
  const recovery = weightKg ? ` Afterwards: ~${Math.round(weightKg * 1)} g carbs + ${Math.round(weightKg * 0.3)} g protein within 1-2 h.` : ' Afterwards: carbs + 20-40 g protein within 1-2 h.';

  if (w.category === 'recovery' || (d <= 60 && !hard && !moderate)) return 'Water is enough; normal meals around it.';
  if (d < 75) {
    return hard || moderate
      ? `Carb-rich meal 2-3 h before. During: water, optionally 20-30 g carbs.${hard ? recovery : ''}`
      : 'Water; a small carb snack is optional.';
  }
  if (d <= 150) {
    const g = hard ? '60-90' : moderate ? '45-75' : '30-60';
    return `Aim for ${g} g carbs/h from the first 20-30 min, 500-750 ml fluid/h with electrolytes.${hard || moderate ? recovery : ''}`;
  }
  return `${hard ? '80-120' : '60-90'} g carbs/h (glucose + fructose mixes allow >60 g/h — practise this to train your gut), 500-1000 ml fluid/h with 300-600 mg sodium/h in the heat.${recovery}`;
}
