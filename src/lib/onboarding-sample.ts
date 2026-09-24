/**
 * The illustrative recall the onboarding shows (P2B7X.1): ONE static card
 * model, rendered through the shared card surface on Welcome and on the
 * Personalized Preview.
 *
 * It is an example, and it says so. It is not a recall: nothing here comes
 * from an official notice, it is never in the feed, it opens no Detail, it
 * cannot be saved, and it is bundled with the app so a first launch with no
 * network shows it exactly as a connected one does. Two of its own fields
 * carry the disclaimer in the card's own slots — the activity line reads
 * `Example` where a real card reads its date, and the brand line reads
 * `Example, not a live recall` — and the screens label it above the card
 * besides. The founder chose its content (Critical, Gummy Products, an
 * undeclared peanut allergen, Nationwide, Affects You) as the clearest
 * picture of what a personalized match looks like.
 *
 * The risk view is produced by the real `riskView` pipeline from a real
 * classification shape (a single Class I), so the badge is the product's own
 * CRITICAL and nothing is hand-lettered. A leaf.
 */

import type { HomeCardModel } from './recall-presentation';
import { riskView } from './risk-display';

export const SAMPLE_PRODUCT_NAME = 'Gummy Products';
export const SAMPLE_REASON = 'Undeclared peanut allergen';
export const SAMPLE_LOCATION = 'Nationwide';
/** The card's activity slot. A real card reads `Announced Aug 21` here. */
export const SAMPLE_ACTIVITY = 'Example';
/** The card's brand slot. */
export const SAMPLE_BRAND_LINE = 'Example, not a live recall';
/** A stable, non-routable id: the sample opens nothing. */
export const SAMPLE_CARD_ID = 'onboarding-sample';

export const SAMPLE_RECALL_MODEL: HomeCardModel = {
  id: SAMPLE_CARD_ID,
  noticeLabel: null,
  risk: riskView(
    { value: 'class_I', sourceText: null, officialClasses: ['class_I'] },
    'FDA',
    'recall',
  ),
  activity: { kind: 'announced', dateIso: '', text: SAMPLE_ACTIVITY },
  affectsYou: true,
  productName: SAMPLE_PRODUCT_NAME,
  brand: { text: SAMPLE_BRAND_LINE, brands: [], usedBrand: false },
  reasonLine: SAMPLE_REASON,
  categoryLabel: null,
  // The bundled illustration is attached by the component, not by a URL:
  // the model's URL slot stays empty so no image is ever fetched for it.
  heroImageUrl: null,
  locationSummary: SAMPLE_LOCATION,
};
