/**
 * The Recall Card (P2B1) — Figma `Recall-Card` — rendered entirely from the
 * shared presentation contract (lib/recall-presentation.ts). This component
 * derives no recall wording of its own, so every surface that lists recalls
 * says the same thing. Hierarchy (P1, unchanged): risk + the one activity
 * date, the Affects-you relevance label, the product media, product name,
 * brand, the product-category tag, concise reason, compact location, and the
 * save control. The raw government headline never appears here, and cards
 * carry no per-card agency label — source attribution lives on the detail
 * screen.
 *
 * Extracted from the Feed in P2A so the Saved tab lists recalls through the
 * SAME component rather than a second implementation that could drift.
 *
 * ## The four states
 *
 * Two independent dimensions, both decided upstream and only rendered here:
 * relevance (`model.affectsYou`, the personalization verdict) and media
 * (`model.heroImageUrl`, the shared image-role allocation). Affects You +
 * Image, Affects You + No Image, Does not affect you + Image, Does not
 * affect you + No Image — and the card's geometry is the same in all four:
 * the media tile keeps its footprint and renders the neutral placeholder
 * when there is no usable image, never a broken-image glyph and never a
 * substitute picture. A Public Health Alert additionally carries its
 * explicit notice label (shipped behaviour, ahead of Figma).
 *
 * The card's height is its content's. No height is fixed: a long product
 * name or summary wraps beside the media, and the type scales with the
 * reader's Dynamic Type setting. The ONE bounded element (P2B7G) is the
 * product name, which shows at most three lines with a tail ellipsis — the
 * corpus holds official multi-product names past 250 characters, and an
 * unbounded card title buries the reason, location, and every card below it.
 * The bound is a LINE count, never a height: three lines scale with Dynamic
 * Type, so no text size clips vertically. The full name stays the Text
 * node's content, so the card's single grouped VoiceOver element still
 * speaks the complete title (visual truncation never reaches the
 * accessibility tree), Search matches the full stored fields, and Detail
 * renders the complete name.
 *
 * ## The product-category tag (P2B7D)
 *
 * A third, OPTIONAL dimension, and the only one that can remove an element
 * rather than change it: `model.categoryLabel` is the one launch-visible
 * product category the presentation contract read out of the stored
 * projection, or null. Null renders nothing — see the comment at the call
 * site — so a card with no displayable category is byte-identical to its
 * pre-P2B7D self. The card decides nothing about which categories are
 * shown or what they are called; see `cardCategoryLabel`.
 *
 * ## Interaction
 *
 * The whole card opens Recall Details. The save control is a nested
 * pressable inside the card's Link: React Native hands a tap to the
 * innermost responder, so saving toggles the bookmark and does not open the
 * recall, while a tap anywhere else on the card still opens it.
 *
 * ## Accessibility
 *
 * To VoiceOver the card is one element — risk, date, relevance, product,
 * brand, category, reason, location and the save state, read in that order
 * — and iOS does not let a screen reader reach a control nested inside such
 * an element. The save action is therefore also exposed as a custom
 * accessibility action on the card itself ("Save recall" / "Remove from
 * saved recalls", the same spoken names the control itself uses, read from
 * the same `saveControlState`), so a screen-reader user can save without
 * leaving the card. The visible control stays for everyone else — and since
 * P2B7H it is the bookmark glyph alone, with no visible word, on the card
 * exactly as on Detail.
 */

import { Link } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { SaveRecallButton } from '@/components/save-recall-button';
import { CategoryTag } from '@/components/ui/category-tag';
import { Icon } from '@/components/ui/icon';
import { MediaTile } from '@/components/ui/media-tile';
import { NoticeLabel } from '@/components/ui/notice-label';
import { RelevanceLabel } from '@/components/ui/relevance-label';
import { RiskLabel } from '@/components/ui/risk-label';
import { Surface } from '@/components/ui/surface';
import { Text } from '@/components/ui/text';
import { layout, spacing } from '@/constants/design-tokens';
import { useSavedRecalls } from '@/hooks/use-saved-recalls';
import type { HomeCardModel } from '@/lib/recall-presentation';
import { isSavedId, saveControlState } from '@/lib/saved-recalls';

/** The spoken hint for the card's own press. */
export const CARD_ACCESSIBILITY_HINT = 'Opens the recall details.';

/** The custom accessibility action name that toggles saving from the card. */
const SAVE_ACTION = 'save';

export function RecallCard({ model }: { model: HomeCardModel }) {
  const savedRecalls = useSavedRecalls();
  // The card's custom accessibility action reads the SAME save contract the
  // visible control does, so the two can never announce different actions.
  const save = saveControlState(isSavedId(savedRecalls.ids, model.id));

  return (
    <Link href={{ pathname: '/recall/[id]', params: { id: model.id } }} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityHint={CARD_ACCESSIBILITY_HINT}
        accessibilityActions={
          savedRecalls.available
            ? [
                {
                  name: SAVE_ACTION,
                  label: save.accessibilityLabel,
                },
              ]
            : []
        }
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === SAVE_ACTION) void savedRecalls.toggle(model.id);
        }}
        style={({ pressed }) => pressed && styles.pressed}>
        <Surface radius={16} border="border/subtle" elevation="card" style={styles.card}>
          <View style={styles.statusRow}>
            <View style={styles.statusGroup}>
              {/* Consumer risk first — it is the primary risk language. Feed
                  and Detail render the same risk state from the shared model
                  (P2a): rated tiers label their tier, an unclassified FDA
                  recall reads "PENDING", a PHA's absent class reads
                  "UNKNOWN" — the two screens can never disagree. */}
              {model.risk.badgeLabel ? (
                <RiskLabel
                  tier={model.risk.tier}
                  label={model.risk.badgeLabel}
                  accessibilityLabel={model.risk.accessibilityLabel}
                />
              ) : null}
              {/* Public Health Alerts are always explicitly labeled. */}
              {model.noticeLabel ? <NoticeLabel label={model.noticeLabel} /> : null}
              {/* The activity date is READ, not glanced at: "Updated Aug 21"
                  is how someone decides whether they have already seen this
                  recall, so it takes the readable `caption` (12pt) — the
                  same token Detail's status row uses, so Feed, Saved and
                  Detail carry one metadata hierarchy. It was `micro-caption`
                  (10pt) through P2B7G, which measured smaller than the brand
                  and category text beside it and read as a footnote
                  (P2B7H). `micro-caption` stays for genuinely incidental
                  labels; a date the product asks the reader to act on is
                  not one. No height is fixed here, so Dynamic Type grows the
                  row rather than clipping it. */}
              <Text variant="caption" color="text/secondary">
                {model.activity.text}
              </Text>
            </View>
            {/* Available in every feed mode whenever saved preferences
                establish a match — not restricted to the Affects me view.
                Exactly ONE relevance label (P2a); the matching logic is
                unchanged, only its rendering. */}
            {model.affectsYou ? <RelevanceLabel /> : null}
          </View>

          {/* Product identity stays dominant; the media is a recognition aid
              beside it, and keeps its footprint when there is no image. */}
          <View style={styles.content}>
            <MediaTile
              uri={model.heroImageUrl}
              alt={model.productName}
              size={layout.cardMediaSize}
            />
            <View style={styles.identity}>
              <View>
                {/* At most three lines, ellipsized at the tail (the RN
                    default). The line clamp bounds the VISUAL box only: the
                    node's content stays the complete name, which is what the
                    card's grouped accessibility element announces — so a
                    screen-reader user hears the whole title exactly once,
                    with no second element and no truncation. */}
                <Text variant="heading-3" numberOfLines={3}>
                  {model.productName}
                </Text>
                <Text variant="caption" color="text/secondary">
                  {model.brand.text}
                </Text>
              </View>
              {/* The product category, when the case carries a launch-visible
                  one. Placed under the identity it describes rather than in
                  the status row above, which belongs to risk and relevance;
                  it is quiet metadata and must never read as a third status.
                  A case with none renders NOTHING here — the identity column
                  is a gapped flex column, so an omitted child leaves no gap,
                  no spacer and no accessibility element behind it. */}
              {model.categoryLabel ? <CategoryTag label={model.categoryLabel} /> : null}
              {model.reasonLine ? (
                <Text variant="body-small" color="text/secondary">
                  {model.reasonLine}
                </Text>
              ) : null}
            </View>
          </View>

          {/* The location keeps the row's width; the save control sits at its
              trailing edge so it is reachable without competing with the
              product identity above it. */}
          <View style={styles.footerRow}>
            <View style={styles.location}>
              <Icon name="map-pin" size={12} color="icon/primary" />
              <Text variant="caption" style={styles.locationText}>
                {model.locationSummary}
              </Text>
            </View>
            <SaveRecallButton caseId={model.id} />
          </View>
        </Surface>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.6,
  },
  card: {
    padding: spacing[12],
    gap: spacing[8],
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing[8],
  },
  statusGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    flexShrink: 1,
    gap: spacing[8],
  },
  content: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[12],
  },
  // flex + minWidth 0 let long product names wrap instead of pushing the
  // media off the card.
  identity: {
    flex: 1,
    minWidth: 0,
    gap: spacing[8],
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[8],
    marginTop: spacing[8],
  },
  location: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[4],
  },
  locationText: {
    flexShrink: 1,
  },
});
