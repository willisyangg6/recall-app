/**
 * The standardized consumer card, rendered entirely from the shared
 * presentation contract (lib/recall-presentation.ts) — this component derives
 * no recall wording of its own, so every surface that lists recalls says the
 * same thing. Hierarchy (P1): notice/risk + the one activity date, the
 * Affects-you flag, the hero image, product name, brand, concise reason,
 * compact location. The raw government headline never appears here, and cards
 * carry no per-card agency label — source attribution lives on the detail
 * screen.
 *
 * Extracted from the Home screen in P2A so the Saved tab lists recalls
 * through the SAME component rather than a second implementation that could
 * drift from it. The card itself is unchanged apart from the save control.
 *
 * The save control is a nested Pressable inside the card's Link: tapping it
 * toggles the bookmark and does not open the recall, while a tap anywhere
 * else on the card still opens it.
 */

import { Link } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { PhotoThumbnail } from '@/components/photo-gallery';
import { RiskBadge } from '@/components/risk-badge';
import { SaveRecallButton } from '@/components/save-recall-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radii, Spacing } from '@/constants/theme';
import type { HomeCardModel } from '@/lib/recall-presentation';

function Badge({ label, emphasized }: { label: string; emphasized?: boolean }) {
  return (
    <ThemedView type={emphasized ? 'backgroundSelected' : 'backgroundElement'} style={styles.badge}>
      <ThemedText type="small" style={emphasized ? styles.badgeEmphasized : undefined}>
        {label}
      </ThemedText>
    </ThemedView>
  );
}

export function RecallCard({ model }: { model: HomeCardModel }) {
  return (
    <Link href={{ pathname: '/recall/[id]', params: { id: model.id } }} asChild>
      <Pressable accessibilityRole="button">
        <ThemedView type="backgroundElement" style={styles.card}>
          <View style={styles.badgeRow}>
            {/* Consumer risk first — it is the primary risk language. Home
                and Detail render the same risk state from the shared model
                (P2a): rated tiers badge their tier, an unclassified FDA
                recall reads "Risk pending", a PHA's absent class reads
                "Not rated" — the two screens can never disagree. */}
            {model.risk.badgeLabel ? (
              <RiskBadge
                tier={model.risk.tier}
                label={model.risk.badgeLabel}
                accessibilityLabel={model.risk.accessibilityLabel}
              />
            ) : null}
            {/* Public Health Alerts are always explicitly labeled. */}
            {model.noticeLabel ? <Badge label={model.noticeLabel} emphasized /> : null}
            <ThemedText type="small" themeColor="textSecondary">
              {model.activity.text}
            </ThemedText>
            {/* Available in every feed mode whenever saved preferences
                establish a match — not restricted to the Affects me view.
                Exactly ONE generic flag (P2a): the legacy match-explanation
                chips ("Your allergen · Peanuts", "Affects California") are
                retired — matching logic is unchanged, only its rendering. */}
            {model.affectsYou ? <Badge label="Affects you" emphasized /> : null}
          </View>
          {/* Product identity stays dominant; the photo is a recognition aid
              beside it, and the row collapses cleanly when there is none. */}
          <View style={styles.cardBody}>
            <PhotoThumbnail uri={model.heroImageUrl} alt={model.productName} />
            <View style={styles.cardText}>
              <ThemedText type="subtitle">{model.productName}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {model.brand.text}
              </ThemedText>
              {model.reasonLine ? <ThemedText type="small">{model.reasonLine}</ThemedText> : null}
            </View>
          </View>
          <View style={styles.footerRow}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.location}>
              {model.locationSummary}
            </ThemedText>
            <SaveRecallButton caseId={model.id} />
          </View>
        </ThemedView>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Radii.medium,
    marginBottom: Spacing.two,
  },
  cardBody: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  // flexShrink lets long product names wrap instead of pushing the thumbnail
  // off the card.
  cardText: {
    flex: 1,
    flexShrink: 1,
    gap: Spacing.one,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  badge: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Radii.small,
  },
  badgeEmphasized: {
    fontWeight: '600',
  },
  // The location line keeps the row's width; the save control sits at its
  // trailing edge so it is reachable without competing with the product
  // identity above it.
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  location: {
    flex: 1,
    flexShrink: 1,
  },
});
