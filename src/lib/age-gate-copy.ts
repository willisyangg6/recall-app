/**
 * The words the launch age check shows (lib/age-assurance.ts). Pure data.
 *
 * Failures use the house form "Lotly couldn’t …" (consumer-copy.test.ts).
 * Nothing here names an age the shopper did not share, and nothing claims
 * more than the code does: the range stays on the iPhone.
 */

/** While Apple's answer is pending (shown only if it takes longer than the splash hold). */
export const AGE_CHECKING_TITLE = 'Checking your age range';
export const AGE_CHECKING_BODY =
  'Lotly asks Apple for your age range before setup. It stays on this iPhone.';

/** Apple's age service did not answer, and Lotly may not go on without it. */
export const AGE_RETRY_TITLE = 'Lotly couldn’t check your age range';
export const AGE_RETRY_BODY_UNAVAILABLE =
  'Lotly needs your age range from Apple before setup. Check your connection, then try again.';
export const AGE_RETRY_BODY_NOT_SIGNED_IN =
  'Lotly needs your age range from Apple before setup. Sign in to your Apple Account in Settings, then try again.';
export const AGE_RETRY_ACTION = 'Try again';
export const AGE_RETRY_HINT = 'Asks Apple for your age range again.';

/** The shared range is under 13 (Terms of Use: 13 and older). */
export const AGE_UNDER13_TITLE = 'Lotly is for ages 13 and up';
export const AGE_UNDER13_BODY =
  'The age range your Apple Account shares is under 13, so Lotly can’t be set up on this iPhone.';
