import { cardReasonText } from '@/lib/recall-card-reason';
import type { HomeCardModel } from '@/lib/recall-presentation';

/** One explicit announcement; decorative photos/glyphs add no repeated title. */
export function recallCardAccessibilityLabel(model: HomeCardModel, saved: boolean): string {
  return [
    model.risk.badgeLabel ? model.risk.accessibilityLabel : null,
    model.noticeLabel,
    model.activity.text,
    model.affectsYou ? 'Affects you' : null,
    model.productName,
    model.brand.text,
    model.categoryLabel,
    // The same shorter card wording the reason row shows.
    cardReasonText(model.reasonLine),
    model.locationSummary,
    saved ? 'Saved' : 'Not saved',
  ]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join('. ');
}
