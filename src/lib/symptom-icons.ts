/**
 * The decorative glyph beside each reviewed symptom in Recall Detail's Health
 * Risk section — Health Risk → Common symptoms, and nowhere else. One approved
 * Lotly glyph per exact string (2026-10-12), replacing the kit's eight shared
 * Lucide stand-ins of 2026-10-07; the masters, their approval hashes and the
 * render rule are in assets/icon-sources/symptoms/.
 *
 * Visual shorthand only. The reviewed symptom wording in
 * src/content/hazard-guides.ts is authoritative and renders unchanged; a glyph
 * is never a diagnosis, never spoken (the bubble is decorative), and never
 * decides anything. Keys are the guides' EXACT strings: a symptom whose text
 * changes, or a new one, falls back to the neutral `circle` — it is never
 * hidden — and `symptom-icons.test.ts` fails until it is mapped deliberately.
 * Two strings that mean the same thing may later share the better glyph; that
 * is a mapping change here, never a change to the wording.
 */
import type { IconName } from '@/components/ui/icon';

export const SYMPTOM_ICONS: Readonly<Record<string, IconName>> = {
  'A low fever': 'symptom-low-fever',
  'Coughing or wheezing': 'symptom-coughing-wheezing',
  'Dark urine or clay-colored stools': 'symptom-dark-urine-pale-stools',
  'Diarrhea or vomiting': 'symptom-diarrhea-vomiting',
  'Diarrhea, which may be bloody': 'symptom-bloody-diarrhea',
  'Difficulty breathing': 'symptom-difficulty-breathing',
  'Difficulty swallowing': 'symptom-difficulty-swallowing',
  'Dizziness or fainting': 'symptom-dizziness-fainting',
  'Double or blurred vision': 'symptom-double-blurred-vision',
  'Drooping eyelids': 'symptom-drooping-eyelids',
  'Feeling tired': 'symptom-feeling-tired',
  'Feeling very tired': 'symptom-feeling-very-tired',
  Fever: 'symptom-fever',
  Headache: 'symptom-headache',
  'Headache, stiff neck, or confusion': 'symptom-headache-neck-confusion',
  'Hives or flushed skin': 'symptom-hives-flushed-skin',
  'Increased gas': 'symptom-increased-gas',
  'Joint pain': 'symptom-joint-pain',
  'Loss of appetite': 'symptom-loss-appetite',
  'Loss of appetite and weight loss': 'symptom-appetite-weight-loss',
  'Muscle aches or fatigue': 'symptom-muscle-aches-fatigue',
  'Muscle weakness': 'symptom-muscle-weakness',
  Nausea: 'symptom-nausea',
  'Nausea or vomiting': 'symptom-nausea-vomiting',
  'Nausea, vomiting, or stomach pain': 'symptom-nausea-vomiting-pain',
  'Slurred speech': 'symptom-slurred-speech',
  'Stomach cramps or bloating': 'symptom-cramps-bloating',
  'Stomach cramps, which can be severe': 'symptom-severe-cramps',
  'Tingling or swelling of the mouth, face, or throat': 'symptom-mouth-face-throat-swelling',
  'Trouble breathing': 'symptom-trouble-breathing',
  Vomiting: 'symptom-vomiting',
  'Vomiting, diarrhea, or stomach cramps': 'symptom-vomiting-diarrhea-cramps',
  'Watery diarrhea': 'symptom-watery-diarrhea',
  'Yellow skin or eyes': 'symptom-yellow-skin-eyes',
};

/** The glyph for one exact symptom string; `circle` when it has none. */
export function symptomIcon(symptom: string): IconName {
  return SYMPTOM_ICONS[symptom] ?? 'circle';
}
