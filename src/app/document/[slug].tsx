/**
 * The one reusable trust-document screen (C7; restyled in P2B6B): renders
 * any document from the content registry (src/content) through the shared
 * document renderer (components/document). All business claims live in the
 * structured content — this file is the page and nothing else, so a claim
 * can never exist in JSX alone.
 *
 * The page is the warm page colour under the navigator's tokenized header,
 * which names the Profile group the document sits in while the page names
 * the document itself (lib/document-screen.ts); 16pt margins, the content
 * column capped at `max-content-width`, the bottom safe-area inset added to
 * the content padding. Text is selectable (people quote safety information),
 * external links open the official source in the system browser, document
 * links push this same route, and an unknown slug renders the shared
 * not-found state rather than crashing — the same convention as Recall
 * Detail. Nothing on the page scrolls sideways.
 */

import { useLocalSearchParams } from 'expo-router';

import { DocumentPage } from '@/components/document/document-page';
import { documentBySlug } from '@/content';
import { navigatorTitle } from '@/lib/document-screen';

export default function DocumentScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const doc = documentBySlug(slug);
  return <DocumentPage doc={doc} title={doc ? navigatorTitle(doc) : ''} />;
}
