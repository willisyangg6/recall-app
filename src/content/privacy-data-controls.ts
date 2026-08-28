/**
 * Privacy & Data Controls — the consumer-readable explanation of what the app
 * actually stores and sends. This is NOT the formal legal Privacy Policy
 * (that draft lives in docs/recall-privacy-policy-draft.md and is withheld
 * from the app until its founder/legal inputs are resolved).
 *
 * Every statement here was verified against the shipped code in C7:
 * preferences-store.ts / installation-id.ts / push-registration.ts /
 * push-api.ts / recall-feed.ts, the Supabase migrations (RLS + RPCs), and
 * the dependency lock (no analytics/advertising/crash SDK exists — pinned by
 * trust-documents tests against package.json). The known product gap — no
 * complete server-side reset control — is stated as a gap, never papered
 * over.
 */

import { bullets, paragraph, type TrustDocument } from './document-model';

export const PRIVACY_DATA_CONTROLS: TrustDocument = {
  slug: 'privacy-data-controls',
  title: 'Privacy & Data Controls',
  summary: 'What the app stores, what it sends, and what it never collects.',
  sections: [
    {
      title: null,
      blocks: [
        paragraph(
          'Recall works without an account and collects as little as it can. This page explains, ' +
            'in plain language, exactly what the current app stores and sends. A formal privacy ' +
            'policy is being prepared; this page describes verified current behavior.',
        ),
      ],
    },
    {
      title: 'What stays on your device',
      blocks: [
        bullets([
          'Your personalization choices — state, allergens to watch, and stores — saved in the device’s secure storage. They work offline and are read locally to build Affects Me.',
          'A random installation identifier, created on this device the first time it is needed. It contains nothing about you or your device — it is a random number used so the server can tell installations apart.',
          'Whether you turned recall alerts on.',
          'Search text and browsing filters are session state only: searching runs entirely on this device over already-loaded notices, and what you type is never stored or sent anywhere.',
        ]),
      ],
    },
    {
      title: 'What Recall’s server stores',
      blocks: [
        bullets([
          'A mirror of your personalization choices (state, allergens, stores), keyed by the random installation identifier — synced so alert delivery can apply exactly the same relevance rules the app shows you.',
          'When you enable alerts: a push registration holding the delivery token issued for this installation, the platform (iOS or Android), the app version, and timestamps for when alerts were enabled and last refreshed.',
          'Per-alert delivery records: which alert was sent to which registration and whether the delivery service accepted it.',
        ]),
        paragraph(
          'Server records are keyed only by the random installation identifier. Recall’s server ' +
            'has no name, email, account, or contact information to attach them to.',
        ),
      ],
    },
    {
      title: 'What Recall does not collect',
      blocks: [
        bullets([
          'No account, name, email address, phone number, contacts, or photos.',
          'No device location: Recall never uses location services. Your state is a manual choice.',
          'No advertising identifier, no advertising, and no tracking across apps or websites.',
          'No analytics, advertising, or crash-reporting SDKs are included in the app.',
          'No record of what you search for, which recalls you read, or what you share — none of that is stored by the app or tied to your installation identifier.',
        ]),
        paragraph(
          'Like every internet service, requests to load recall data reach Recall’s ' +
            'infrastructure and carry standard connection details (such as an IP address) used to ' +
            'serve the request. Recall reads are made with a shared application key and are not ' +
            'tied to your installation identifier. Product images load directly from the issuing ' +
            'agency’s website or Recall’s image storage.',
        ),
      ],
    },
    {
      title: 'Who processes data',
      blocks: [
        paragraph(
          'Recall’s database and image storage are hosted on Supabase. Push alerts are delivered ' +
            'through Expo’s push service and then Apple’s or Google’s notification infrastructure ' +
            'for your device. These providers process the data described above to provide those ' +
            'services; none of them receives it for advertising.',
        ),
      ],
    },
    {
      title: 'Turning alerts off',
      blocks: [
        paragraph(
          'Turning off recall alerts stops delivery immediately: the app clears its local ' +
            'alerts-on flag and marks this installation’s push registration disabled on the server. ' +
            'Your personalization choices are kept, and the disabled registration record is not ' +
            'currently deleted.',
        ),
      ],
    },
    {
      title: 'Clearing and resetting',
      blocks: [
        bullets([
          'You can clear each personalization choice in Settings; the cleared (empty) state syncs to the server mirror.',
          'The app does not yet offer a single “delete everything about this installation from the server” control. Until it exists, clearing preferences and turning alerts off is the strongest reset available in the app.',
        ]),
      ],
    },
    {
      title: 'Deleting the app',
      blocks: [
        paragraph(
          'Deleting the app removes it from your device, but two limits are worth knowing: ' +
            'entries in the device’s secure storage (your choices and the installation identifier) ' +
            'can persist in the operating system keychain and survive a reinstall, depending on the ' +
            'platform — and server records for the installation are not automatically deleted. A ' +
            'reinstall that re-enables alerts re-uses or replaces the old registration rather than ' +
            'double-registering the device.',
        ),
      ],
    },
  ],
};
