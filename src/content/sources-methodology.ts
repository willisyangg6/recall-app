/**
 * Sources & Methodology — how Recall collects, reconciles, and presents
 * official recall information. Every claim here describes the shipped
 * pipeline (src/server, docs/recall-source-contract.md,
 * docs/recall-domain-architecture.md); nothing is aspirational, and no
 * operational secret (credentials, scheduling internals, endpoints beyond the
 * public agency pages) is disclosed.
 */

import { RECENT_WINDOW_DAYS } from '@/lib/feed-relevance';
import { bullets, link, paragraph, type TrustDocument } from './document-model';

export const SOURCES_METHODOLOGY: TrustDocument = {
  slug: 'sources-methodology',
  title: 'Sources & Methodology',
  summary: 'Where recall information comes from and how it is kept current.',
  sections: [
    {
      title: null,
      blocks: [
        paragraph(
          'Every notice in Recall comes from an official United States government food-safety source. ' +
            'Recall does not write, crowdsource, or infer recall information — it collects the ' +
            'official notices, organizes them for consumers, and links every notice back to the ' +
            'government page it came from.',
        ),
      ],
    },
    {
      title: 'Where the data comes from',
      blocks: [
        bullets([
          'FDA recall announcements: the U.S. Food and Drug Administration’s public “Recalls, Market Withdrawals, & Safety Alerts” listing for food products.',
          'FDA enforcement reports: the FDA’s openFDA food enforcement data, which carries the official Class I / Class II / Class III classification the agency assigns.',
          'USDA FSIS recalls and public health alerts: the U.S. Department of Agriculture Food Safety and Inspection Service’s public recall data for meat, poultry, and egg products.',
          'Official FSIS label documents: the label PDFs FSIS publishes with its notices, which Recall renders into viewable images.',
        ]),
        link(
          'FDA — Recalls, Market Withdrawals, & Safety Alerts',
          'https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts',
        ),
        link('USDA FSIS — Recalls & Public Health Alerts', 'https://www.fsis.usda.gov/recalls'),
        link('openFDA', 'https://open.fda.gov/'),
      ],
    },
    {
      title: 'How often Recall checks',
      blocks: [
        paragraph(
          'Recall checks the FDA and FSIS announcement sources around the clock, normally about ' +
            'every half hour, and checks the FDA’s enforcement data daily (the FDA itself refreshes ' +
            'that dataset about weekly). An independent watchdog monitors collection and re-runs it ' +
            'if a cycle is missed. New notices normally appear in Recall shortly after the agency ' +
            'publishes them, but Recall is not a real-time feed and delivery times are not guaranteed.',
        ),
      ],
    },
    {
      title: 'Source snapshots and traceability',
      blocks: [
        paragraph(
          'Every government record Recall processes is preserved as an unmodified source snapshot ' +
            'before anything is derived from it, and new snapshots are added whenever the source ' +
            'content actually changes. That means everything Recall shows can be traced to the exact ' +
            'official material it came from — and every notice links to its official government source.',
        ),
      ],
    },
    {
      title: 'One recall, one case',
      blocks: [
        paragraph(
          'A single real-world recall often produces several government records over time: the ' +
            'original announcement, updates, expansions, and — for FDA recalls — a separate ' +
            'enforcement record that arrives weeks later with the official classification. Recall ' +
            'reconciles these into one case so you see one recall, not four copies of it.',
        ),
        bullets([
          'Expansions and updates attach to the original case using the agency’s own numbering and references.',
          'FDA enforcement records are matched to their announcement using evidence from the records themselves (firm, product, dates, codes) — a record that cannot be matched confidently is kept separate rather than guessed.',
          'When two entries are found to describe the same recall, they are merged and a single case remains.',
        ]),
      ],
    },
    {
      title: 'Active, closed, and retracted',
      blocks: [
        paragraph(
          'Each case carries the lifecycle state its agency gives it: active, closed, or retracted. ' +
            'Recall never ends, hides, or relabels a notice on its own — an agency-active notice stays ' +
            'active in Recall no matter how old it is.',
        ),
        bullets([
          `For readability, active notices with recent activity (within ${RECENT_WINDOW_DAYS} days) are shown ahead of older active notices, which stay fully available in their own clearly labeled section. This is presentation only; it never changes a notice’s official status.`,
          'FSIS Public Health Alerts are labeled as public health alerts, distinct from recalls. They never receive an official recall classification, and Recall labels their risk “Not rated” rather than inventing one.',
        ]),
      ],
    },
    {
      title: 'What counts as a change',
      blocks: [
        paragraph(
          'When an agency revises a notice, Recall detects whether the revision is material to ' +
            'consumers and records it on the case timeline. Material changes include:',
        ),
        bullets([
          'More products added to the recall.',
          'More areas affected.',
          'An official classification assigned, raised, lowered, or otherwise changed.',
          'Illnesses or adverse reactions newly reported.',
          'Changed consumer instructions.',
          'A correction showing the recall covers more than first announced.',
          'The notice being retracted by the agency.',
        ]),
      ],
    },
    {
      title: 'Official sources take precedence',
      blocks: [
        paragraph(
          'Recall’s summaries, risk labels, and organization are derived from the official records — ' +
            'never a replacement for them. If anything in Recall ever conflicts with the official ' +
            'government notice, the official notice controls, which is why every case links to it.',
        ),
      ],
    },
    {
      title: 'Products, packages, and stores',
      blocks: [
        bullets([
          'Product names, package details, and printed codes are extracted from the notice itself. Each extracted product line records whether the source stated it directly or Recall extracted it from the notice text.',
          'A store is listed only when the notice itself says the product was sold, shipped, or distributed there. Recall never infers stores from a chain’s known footprint.',
          'Where a recall reached is taken only from what the notice states about distribution. When a notice does not say, Recall reports the location as not specified — an honest “unknown” instead of a guess.',
        ]),
      ],
    },
    {
      title: 'Images',
      blocks: [
        paragraph(
          'Product photos for FDA notices are the agency’s own published images, loaded directly ' +
            'from the FDA’s website. FSIS notices supply official label PDFs instead of photos; ' +
            'Recall renders those PDF pages into images and keeps a link to the original document. ' +
            'Recall never uses stock photography or third-party product images.',
        ),
      ],
    },
    {
      title: 'Known limitations',
      blocks: [
        bullets([
          'Notices vary in detail: many do not state every store, every state, or every affected product, and Recall cannot show information the agency did not publish.',
          'Official FDA classifications often arrive weeks after the announcement; until then a recall’s risk is honestly shown as Pending.',
          'Matching, extraction, and summarization are automated and conservative, but the underlying notices are written for many audiences and edge cases exist. When in doubt, read the official notice.',
        ]),
      ],
    },
    {
      title: 'Corrections and source revisions',
      blocks: [
        paragraph(
          'Agencies revise and occasionally retract notices. Recall re-collects changed source ' +
            'pages, updates the affected case, and records material changes on its timeline. How ' +
            'corrections are handled — including mistakes in Recall’s own presentation — is described ' +
            'in the Corrections Policy.',
        ),
      ],
    },
  ],
};
