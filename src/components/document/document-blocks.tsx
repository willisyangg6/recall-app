/**
 * The document content blocks (P2B6B): one renderer per kind in the content
 * model, shared by every trust document. The registry decides what a
 * document says and in what order; this file decides only how each kind of
 * block looks, from the tokens and the shared primitives. It invents no
 * words, so a claim can never exist here alone.
 *
 * Every kind, and its treatment:
 *
 *   paragraph      `body` in `text/primary`, selectable — long-form reading
 *                  type, at the scale's 1.5 leading, wrapping at the content
 *                  width.
 *   bullets        one row per item: a bullet in the same type beside the
 *                  item, each row one element to assistive technology.
 *   note           the soft-blue information Callout — a limitation or
 *                  boundary the reader should not miss, never the lime
 *                  warning tone, which is reserved for personal relevance.
 *   risk-levels    one row per tier: the production Risk Label (the same
 *                  component, word and colours as the feed card) beside the
 *                  meaning in `body`; the row speaks the label's spoken name
 *                  and then the meaning.
 *   link           an external link: the label in `action/secondary` with the
 *                  design's external-link glyph beside it — Recall Detail's
 *                  official-source treatment at the document's own reading
 *                  size (`body`) — a `link` role, the spoken hint that it opens
 *                  the browser, and a row at least 44pt tall as its target.
 *   document-link  a link to another registered document: the same row with
 *                  the navigation chevron instead, pushed through the
 *                  router's own Link to the one document route.
 *
 * A link is recognizable without its colour: the glyph is the second
 * channel, and the row is a real link to a screen reader. Text scales with
 * the reader's setting and wraps; nothing is capped or truncated.
 */

import { Link } from 'expo-router';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { Callout } from '@/components/ui/callout';
import { Icon, type IconName } from '@/components/ui/icon';
import { RiskLabel } from '@/components/ui/risk-label';
import { Text } from '@/components/ui/text';
import { hitTarget, spacing } from '@/constants/design-tokens';
import type { DocumentBlock, RiskLevelItem } from '@/content/document-model';
import { DOCUMENT_EXTERNAL_LINK_HINT, DOCUMENT_LINK_HINT } from '@/lib/document-screen';
import { riskTierLabel } from '@/lib/risk-display';

export function DocumentBlockView({ block }: { block: DocumentBlock }) {
  switch (block.kind) {
    case 'paragraph':
      return (
        <Text variant="body" selectable>
          {block.text}
        </Text>
      );
    case 'bullets':
      return <BulletList items={block.items} />;
    case 'note':
      return <Callout tone="information">{block.text}</Callout>;
    case 'risk-levels':
      return <RiskLevelList items={block.items} />;
    case 'link':
      return (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={block.label}
          accessibilityHint={DOCUMENT_EXTERNAL_LINK_HINT}
          onPress={() => void Linking.openURL(block.url)}
          style={({ pressed }) => pressed && styles.pressed}>
          <LinkRow label={block.label} icon="external-link" />
        </Pressable>
      );
    case 'document-link':
      return (
        <Link href={{ pathname: '/document/[slug]', params: { slug: block.slug } }} asChild>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={block.label}
            accessibilityHint={DOCUMENT_LINK_HINT}
            style={({ pressed }) => pressed && styles.pressed}>
            <LinkRow label={block.label} icon="chevron-right" />
          </Pressable>
        </Link>
      );
  }
}

function BulletList({ items }: { items: readonly string[] }) {
  return (
    <View style={styles.list}>
      {items.map((item) => (
        <View key={item} accessible accessibilityLabel={item} style={styles.bulletRow}>
          <Text variant="body" color="text/secondary" style={styles.bullet}>
            {'•'}
          </Text>
          <Text variant="body" selectable style={styles.rowText}>
            {item}
          </Text>
        </View>
      ))}
    </View>
  );
}

function RiskLevelList({ items }: { items: readonly RiskLevelItem[] }) {
  return (
    <View style={styles.list}>
      {items.map((item) => {
        const label = riskTierLabel(item.tier);
        return (
          <View
            key={item.tier}
            accessible
            accessibilityLabel={`${label.accessibilityLabel}. ${item.meaning}`}
            style={styles.riskRow}>
            {/* The label keeps its own line so a long tier word never
                squeezes the meaning; the meaning wraps beneath it at any
                type size. */}
            <RiskLabel
              tier={item.tier}
              label={label.text}
              accessibilityLabel={label.accessibilityLabel}
            />
            <Text variant="body" selectable>
              {item.meaning}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** The visible part of either link: label, then the glyph that says what kind. */
function LinkRow({ label, icon }: { label: string; icon: IconName }) {
  return (
    <View style={styles.linkRow}>
      <Text variant="body" color="action/secondary" style={styles.linkText}>
        {label}
      </Text>
      <Icon name={icon} size={16} color="icon/brand" />
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing[8],
  },
  bulletRow: {
    flexDirection: 'row',
    gap: spacing[8],
  },
  bullet: {
    width: spacing[16],
    textAlign: 'center',
  },
  rowText: {
    flex: 1,
  },
  riskRow: {
    gap: spacing[4],
    paddingVertical: spacing[4],
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing[4],
    minHeight: hitTarget.minimum,
    paddingVertical: spacing[8],
  },
  // The label wraps when it must, and the glyph stays beside its last line.
  linkText: {
    flexShrink: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});
