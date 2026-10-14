/**
 * `/privacy/controls` — Privacy & Data Controls reachable without an active
 * subscription (B8, 2026-10-14). The lapsed-subscriber paywall links here so
 * reset, export, request codes and allergen-consent withdrawal never require
 * resubscribing. It renders the very same document and sections as
 * `/document/privacy-data-controls` (components/document/document-page.tsx).
 * The route lives in the `privacy` group (lib/access-gate.ts), mounted in the
 * app and paywall phases only; no recall content is reachable from it.
 */

import { DocumentPage } from '@/components/document/document-page';
import { documentBySlug } from '@/content';
import { navigatorTitle } from '@/lib/document-screen';

export const PRIVACY_CONTROLS_SLUG = 'privacy-data-controls';

export default function PrivacyControlsScreen() {
  const doc = documentBySlug(PRIVACY_CONTROLS_SLUG);
  return <DocumentPage doc={doc} title={doc ? navigatorTitle(doc) : ''} />;
}
