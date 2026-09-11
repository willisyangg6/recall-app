/**
 * How Affects Me Works — the consumer explanation of the personalization
 * semantics in src/lib/relevance.ts, src/domain/allergen-only.ts and
 * src/domain/retailer-evidence.ts. The integrity tests run the REAL relevance
 * evaluation against the claims in this document, so a semantics change that
 * contradicts a sentence here fails the build instead of shipping a lie.
 *
 * The allergen list is imported from the canonical vocabulary rather than
 * retyped, so this document can never advertise an allergen the matcher
 * cannot match.
 */

import { CONSUMER_ALLERGENS } from '@/domain/preferences';
import { bullets, paragraph, type TrustDocument } from './document-model';

const ALLERGEN_LABELS = CONSUMER_ALLERGENS.map((option) => option.label);

export const HOW_AFFECTS_ME_WORKS: TrustDocument = {
  slug: 'how-affects-me-works',
  title: 'How Affects Me Works',
  summary: 'What puts a recall in your personalized list — and what never does.',
  sections: [
    {
      title: null,
      blocks: [
        paragraph(
          'Affects Me is a shortlist: the current notices that, based on your choices and on facts ' +
            'stated in the official notice, may be relevant to you. It is built from exactly two ' +
            'things — what you chose in Personalization, and what the government notice itself says. ' +
            'Nothing is inferred about you, and All Recalls always remains available with every ' +
            'current notice.',
        ),
      ],
    },
    {
      title: 'What you can choose',
      blocks: [
        bullets([
          'Your state — one U.S. state, DC, or Puerto Rico.',
          `Allergens to watch — any of the nine major food allergens: ${ALLERGEN_LABELS.join(', ')}. Select any that are relevant to you or anyone you shop or cook for.`,
          'Stores you shop at — chosen from a catalog of named retailers.',
        ]),
        paragraph(
          'All three are optional. Your choices are preferences, never medical information Recall ' +
            'interprets — selecting an allergen tells Recall which notices to surface, nothing more.',
        ),
      ],
    },
    {
      title: 'How location matching works',
      blocks: [
        bullets([
          'A notice that states distribution to your state is included.',
          'A nationwide notice affects every state, so it is included once you have chosen a state.',
          'A notice that explicitly states distribution only to other states is excluded. This explicit geographic exclusion is final: a store or allergen match never overrides what the notice itself says about where the product went.',
          'A notice that does not say where the product was sold is never treated as “not you.” Unknown is unknown — it is included when one of your allergens or stores also matches, because a wrong “doesn’t affect you” is the dangerous mistake.',
          'If you have not chosen a state, Recall cannot assess location for you, so only allergen and store matches appear in Affects Me. Nationwide notices stay in All Recalls.',
        ]),
      ],
    },
    {
      title: 'How allergen matching works',
      blocks: [
        paragraph(
          'An allergen match is a positive signal: a notice naming one of your selected allergens ' +
            'is surfaced even when its location is unknown. The absence of an allergen match never ' +
            'excludes a general hazard — contamination, foreign material, and every other ' +
            'non-allergen risk stays in Affects Me on location alone.',
        ),
        bullets([
          'There is exactly one exclusion: when the agency’s own record shows a recall is only about allergens AND names which allergens, and none of them is one you selected, that recall is left out of Affects Me. A milk-only recall is not information a person watching only peanuts needs.',
          'If a notice says “undeclared allergen” without naming it, it is never excluded — the unnamed allergen could be yours.',
          'A recall with any hazard beyond allergens is never excluded this way.',
          'Selecting more allergens can only include more notices in Affects Me, never fewer. If you select no allergens, allergen-only recalls with named allergens are not shortlisted for you.',
          'Everything excluded from Affects Me remains in All Recalls.',
        ]),
      ],
    },
    {
      title: 'How store matching works',
      blocks: [
        bullets([
          'A store is flagged only when the official notice itself states the product was sold, shipped, or distributed there. Recall never infers a store from a chain’s known locations.',
          'Recall never knows or guesses what you actually bought. There is no purchase history, no receipts, and no inference from your store list — a store match only means the notice named a store you selected. The one exception is a community shopper report you choose to submit, which you fill in yourself and which never affects Affects Me.',
          'Notices often do not state where a product was sold, so no store flag never means “not sold there.”',
        ]),
      ],
    },
    {
      title: 'What Affects Me is not',
      blocks: [
        bullets([
          'It is not a guarantee of safety or completeness. A notice missing from Affects Me does not mean a product is safe — it means nothing in the notice matched your choices.',
          'It is not a substitute for All Recalls, which always remains available and always holds every current notice.',
        ]),
      ],
    },
    {
      title: 'Alerts use the same rules',
      blocks: [
        paragraph(
          'Push alerts are decided by the same relevance evaluation as the Affects Me list, so what ' +
            'the app shows and what it sends can never disagree. Until you choose a state, alerts ' +
            'are not narrowed at all — every new recall alert qualifies — because allergen and store ' +
            'choices only ever add relevance and are never used to silently drop safety information.',
        ),
      ],
    },
    {
      title: 'Where your choices live',
      blocks: [
        paragraph(
          'Your choices are saved on this device first and work offline. They are also synced to ' +
            'Recall’s server, keyed by a random installation identifier, so alert delivery can apply ' +
            'the same rules. Details are in Privacy & Data Controls.',
        ),
      ],
    },
  ],
};
