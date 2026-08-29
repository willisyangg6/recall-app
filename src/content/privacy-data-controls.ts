/**
 * Privacy & Data Controls — the consumer-readable explanation of what the app
 * actually stores and sends. This is NOT the formal legal Privacy Policy
 * (that draft lives in docs/recall-privacy-policy-draft.md and is withheld
 * from the app until its founder/legal inputs are resolved).
 *
 * Every statement here was verified against the shipped code in C7/C7.1:
 * preferences-store.ts / installation-id.ts / push-registration.ts /
 * push-api.ts / recall-feed.ts / installation-reset*.ts, the Supabase
 * migrations (RLS + RPCs + delete_installation_data), and the dependency
 * lock (no analytics/advertising/crash SDK exists — pinned by
 * trust-documents tests against package.json). The reset action label is
 * imported from the one copy contract the UI renders, so this document and
 * the control can never drift apart.
 */

import { RESET_ACTION_LABEL } from '@/lib/installation-reset';
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
            'Your personalization choices are kept, and the disabled registration record itself is ' +
            `not deleted — deleting it is what “${RESET_ACTION_LABEL}” below is for.`,
        ),
      ],
    },
    {
      title: 'Clearing and resetting',
      blocks: [
        bullets([
          'You can clear each personalization choice in Settings; the cleared (empty) state syncs to the server mirror.',
          `For a complete reset, use “${RESET_ACTION_LABEL}” at the bottom of this screen. It deletes this installation’s server records — the preference mirror, the push registration, and its alert delivery records — then clears your choices, the alerts setting, and the installation identifier from this device and creates a fresh identifier. The app returns to its default, unpersonalized state and stays fully usable; alerts stay off until you enable them again.`,
          'The reset asks for confirmation first, and cancelling changes nothing. If the deletion cannot reach the server, nothing is changed on this device either — you can simply try again.',
        ]),
        paragraph(
          'Two honest limits: standard, short-lived infrastructure logs at our hosting providers ' +
            '(routine connection details such as IP addresses) are outside what the app can delete ' +
            'directly — they expire on the provider’s schedule. And if you reinstalled the app in ' +
            'the past, a registration left by the earlier installation is kept under a different, ' +
            'now-unused identifier; it is disabled and no longer receives anything, and it is not ' +
            'reachable by this reset.',
        ),
      ],
    },
    {
      title: 'Deleting the app',
      blocks: [
        paragraph(
          'Uninstalling the app alone is not treated as a request to delete your server data: the ' +
            'app gets no chance to run, and entries in the device’s secure storage (your choices ' +
            'and the installation identifier) can persist in the operating system keychain and ' +
            'survive a reinstall, depending on the platform. To remove your data, use ' +
            `“${RESET_ACTION_LABEL}” on this screen first, then uninstall. A reinstall that ` +
            're-enables alerts re-uses or replaces the old registration rather than ' +
            'double-registering the device.',
        ),
      ],
    },
  ],
};
