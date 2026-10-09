/**
 * The decorative glyph beside each reviewed symptom in Recall Detail's Health
 * Risk section (Recall Detail source kit, 2026-10-07).
 *
 * Visual shorthand only. The reviewed symptom wording in
 * src/content/hazard-guides.ts is authoritative and renders unchanged; a glyph
 * is never a diagnosis, never spoken (the bubble is decorative), and never
 * decides anything. Keys are the guides' EXACT strings: a symptom whose text
 * changes, or a new one, falls back to the neutral `circle` — it is never
 * hidden — and `symptom-icons.test.ts` fails until it is mapped deliberately.
 */
import type { IconName } from '@/components/ui/icon';

export const SYMPTOM_ICONS: Readonly<Record<string, IconName>> = {
  'A low fever': 'thermometer',
  'Coughing or wheezing': 'wind',
  'Dark urine or clay-colored stools': 'droplets',
  'Diarrhea or vomiting': 'droplets',
  'Diarrhea, which may be bloody': 'droplets',
  'Difficulty breathing': 'wind',
  'Difficulty swallowing': 'brain',
  'Dizziness or fainting': 'brain',
  'Double or blurred vision': 'eye',
  'Drooping eyelids': 'eye',
  'Feeling tired': 'activity',
  'Feeling very tired': 'activity',
  Fever: 'thermometer',
  Headache: 'brain',
  'Headache, stiff neck, or confusion': 'brain',
  'Hives or flushed skin': 'hand',
  'Increased gas': 'droplets',
  'Joint pain': 'activity',
  'Loss of appetite': 'utensils-crossed',
  'Loss of appetite and weight loss': 'utensils-crossed',
  'Muscle aches or fatigue': 'activity',
  'Muscle weakness': 'activity',
  Nausea: 'droplets',
  'Nausea or vomiting': 'droplets',
  'Nausea, vomiting, or stomach pain': 'droplets',
  'Slurred speech': 'brain',
  'Stomach cramps or bloating': 'droplets',
  'Stomach cramps, which can be severe': 'droplets',
  'Tingling or swelling of the mouth, face, or throat': 'hand',
  'Trouble breathing': 'wind',
  Vomiting: 'droplets',
  'Vomiting, diarrhea, or stomach cramps': 'droplets',
  'Watery diarrhea': 'droplets',
  'Yellow skin or eyes': 'hand',
};

/** The glyph for one exact symptom string; `circle` when it has none. */
export function symptomIcon(symptom: string): IconName {
  return SYMPTOM_ICONS[symptom] ?? 'circle';
}
