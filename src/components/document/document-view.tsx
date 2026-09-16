/**
 * The shared trust-document renderer (P2B6B): one document from the content
 * registry laid out as a reading page, the same way for all seven.
 *
 * Hierarchy, top to bottom:
 *
 *   1. the document title, `heading-1`, a header — the page's one full title
 *      (the navigator's bar carries the Profile group's name instead, so the
 *      same words never appear twice; see lib/document-screen.ts)
 *   2. the registry's one-line summary as the standfirst, `body` in
 *      `text/secondary`
 *   3. the lead section, when the document has one: its blocks with no
 *      heading
 *   4. each titled section — a content section heading (title case as
 *      written, `heading-3`, navy; DESIGN.md "Section headings and group
 *      labels") over its blocks
 *
 * Sections are parted by `spacing/32` of air and nothing else: no card per
 * paragraph, no rule between sections. Within a section the blocks sit
 * `spacing/12` apart, and every block renders through `DocumentBlockView`,
 * so a document is different from its neighbours only where its content
 * is — a note here, the risk-label rows there, a link beneath a paragraph.
 * The renderer adds no words; what follows the document (the one reset
 * control, on Privacy & Data Controls) is the route's to place.
 */

import { StyleSheet, View } from 'react-native';

import { DocumentBlockView } from '@/components/document/document-blocks';
import { Text } from '@/components/ui/text';
import { spacing } from '@/constants/design-tokens';
import type { DocumentSection, TrustDocument } from '@/content/document-model';

export function DocumentView({ doc }: { doc: TrustDocument }) {
  return (
    <View style={styles.document}>
      <View style={styles.titleBlock}>
        <Text variant="heading-1" accessibilityRole="header" selectable>
          {doc.title}
        </Text>
        <Text variant="body" color="text/secondary" selectable>
          {doc.summary}
        </Text>
      </View>
      {doc.sections.map((section, index) => (
        <DocumentSectionView key={section.title ?? `lead-${index}`} section={section} />
      ))}
    </View>
  );
}

export function DocumentSectionView({ section }: { section: DocumentSection }) {
  return (
    <View style={styles.section}>
      {section.title ? (
        <Text variant="heading-3" accessibilityRole="header" selectable>
          {section.title}
        </Text>
      ) : null}
      {section.blocks.map((block, index) => (
        <DocumentBlockView key={`${block.kind}-${index}`} block={block} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  document: {
    gap: spacing[32],
  },
  titleBlock: {
    gap: spacing[8],
  },
  section: {
    gap: spacing[12],
  },
});
