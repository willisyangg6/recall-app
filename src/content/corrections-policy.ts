/**
 * Corrections Policy — how official revisions propagate and what Recall
 * corrects on its own side. Contains no response-time promises (the founder
 * has approved none) and no support-contact claim (none exists yet); the
 * report-a-problem path is stated honestly as not yet available.
 */

import { bullets, note, paragraph, type TrustDocument } from './document-model';

export const CORRECTIONS_POLICY: TrustDocument = {
  slug: 'corrections-policy',
  title: 'Corrections Policy',
  summary: 'How official revisions and Lotly’s own corrections are handled.',
  sections: [
    {
      title: null,
      blocks: [
        paragraph(
          'Lotly’s information is derived from official government notices, and those notices are ' +
            'revised, expanded, corrected, and occasionally retracted by the agencies that issue ' +
            'them. This policy explains how those changes, and mistakes in Lotly’s own ' +
            'presentation, are handled.',
        ),
      ],
    },
    {
      title: 'Official corrections and revisions',
      blocks: [
        bullets([
          'Lotly re-collects source pages whenever their content changes, so an agency’s revision reaches the affected case through the same pipeline as the original notice.',
          'Material changes are recorded on the case: more products, more areas, classification changes, newly reported illnesses, changed instructions, corrections, and retractions.',
          'A notice the agency retracts is marked retracted in Lotly. It is not deleted: the notice stays visible, marked retracted.',
        ]),
      ],
    },
    {
      title: 'Merged and duplicate cases',
      blocks: [
        paragraph(
          'When two entries are found to describe the same real-world recall (for example an ' +
            'announcement and its expansion, or two records of one event), they are merged so a ' +
            'single case remains, carrying the complete combined history. A merged duplicate stops ' +
            'appearing as a separate item.',
        ),
      ],
    },
    {
      title: 'What Lotly corrects',
      blocks: [
        bullets([
          'Lotly may correct its own derived presentation: product name extraction, distribution and store parsing, image selection, case matching and merging, summaries, and risk-level derivation.',
          'Lotly never alters the authoritative government notice, its preserved source records, or the official classification the agency assigned. Corrections change how the official material is presented, not what it says.',
        ]),
      ],
    },
    {
      title: 'What you will see',
      blocks: [
        paragraph(
          'A corrected case shows the current, corrected facts, with its official source link ' +
            'unchanged, so you can always compare Lotly’s presentation with the official notice. ' +
            'A material update appears as the Update line and the Updated date on the recall.',
        ),
      ],
    },
    {
      title: 'Reporting a problem',
      blocks: [
        paragraph(
          'A way to report a suspected data problem from inside the app is not available yet. The ' +
            'official source link on every notice is the authoritative reference for that recall.',
        ),
      ],
    },
    {
      title: 'Source precedence',
      blocks: [
        note(
          'In every case, the official government notice takes precedence over anything shown in ' +
            'Lotly. If Lotly and the official notice disagree, trust the official notice.',
        ),
      ],
    },
  ],
};
