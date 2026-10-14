/** Scoped to Feed/Saved: no global token or onboarding layout changes. */
export const recallCardGeometry = {
  photoSide: 112,
  columnGap: 12,
  minimumIdentityWidth: 140,
  stackFontScale: 1.5,
  relevanceSide: 28,
  relevanceRadius: 7,
  relevanceIconSide: 18,
  saveTargetSide: 44,
  /** The location's MAXIMUM width beside the reason; it sizes to its text. */
  locationWidth: 132,
  locationPaddingLeft: 12,
  locationPaddingRight: 8,
  reasonIconSide: 18,
  /** The reason's type: 15/20, scaling with Dynamic Type like all Feed text. */
  reasonFontSize: 15,
  reasonLineHeight: 20,
  /**
   * From this text scale the location moves below the reason (founder
   * approval, 2026-10-14). The rest of the card stacks only from 1.5.
   */
  footerStackFontScale: 1.15,
} as const;

/** Narrow phones keep the image beside the title when at least 140pt remain.
 * Accessibility text stacks, and the full title is then visible. */
export function recallCardStacks(contentWidth: number, fontScale: number): boolean {
  if (fontScale >= recallCardGeometry.stackFontScale) return true;
  return (
    contentWidth > 0 &&
    contentWidth - recallCardGeometry.photoSide - recallCardGeometry.columnGap <
      recallCardGeometry.minimumIdentityWidth
  );
}

/** Whether the reason/location row stacks: with the card, or from 1.15x text. */
export function recallCardFooterStacks(cardStacked: boolean, fontScale: number): boolean {
  return cardStacked || fontScale >= recallCardGeometry.footerStackFontScale;
}
