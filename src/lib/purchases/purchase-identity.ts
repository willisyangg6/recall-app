/**
 * The purchase identity (2026-10-12): the anonymous app-user id RevenueCat
 * knows this device by, kept SEPARATE from the installation id.
 *
 * ## Why separate
 *
 * Until now the RevenueCat app-user id WAS the installation id. "Reset app
 * and delete my data" replaces the installation id, and the adapter
 * configures the SDK once per process, so a reset left RevenueCat on the old
 * id until relaunch and then moved it to a brand-new customer with no
 * subscription — a paying shopper met the paywall until they tapped Restore.
 * RevenueCat documents that keeping the same app-user id keeps access
 * "without requiring a restore"; the alternatives (logIn + syncPurchases
 * after a reset) depend on transfer semantics RevenueCat does not document
 * for identified ids, and a programmatic restore is discouraged.
 *
 * So the purchase identity is its own random id that the reset does NOT
 * rotate. A subscription survives a reset with no store call, no transfer
 * between customers and no network dependency. Restore Purchases stays the
 * fallback for what this cannot cover (a new device, a lost keychain).
 *
 * ## What it is, and is not
 *
 * - A random UUID minted on this device, in the keychain (SecureStore). It
 *   encodes nothing about the device or the shopper.
 * - Sent ONLY to RevenueCat; no Lotly server call ever carries it. A
 *   freshly minted id is unknown to Lotly's server, so the two servers hold
 *   no shared identifier (an ADOPTED id is the exception until the next
 *   reset; see "Upgrading").
 * - Not installation data: the reset keeps it (the subscription belongs to
 *   the shopper's Apple Account, not to the installation), and the 12-month
 *   inactivity deletion never sees it.
 *
 * ## Upgrading without a Restore
 *
 * Builds before this one configured RevenueCat with the INSTALLATION id, so
 * an existing subscriber's purchases live under that id. When no purchase id
 * is stored yet, the resolver ADOPTS the current installation id as the
 * purchase id — but only with evidence that RevenueCat already knows it as a
 * customer: personalization was completed (in this flow that happens in the
 * same commit as a verified purchase or restore) or a verified entitlement
 * is cached. A fresh install has neither at its first store call, so it
 * mints a separate id. Adoption is persisted on the first store call (the
 * launch entitlement read), and "Reset app and delete my data" resolves the
 * purchase id BEFORE it rotates the installation id, so a reset can never
 * strand an upgraded subscriber on a brand-new identity.
 *
 * The cost: for an upgraded installation the purchase id starts out equal to
 * the installation id Lotly's server also keys rows by, until a reset (or the
 * inactivity purge) rotates or removes the server side.
 *
 * One case cannot be preserved: a subscriber who used "Reset app and delete
 * my data" on an OLDER build and has not restored since. That build moved
 * RevenueCat to the post-reset id at the next launch, so their purchases
 * still sit under the pre-reset id, which the device no longer holds.
 * Restore Purchases recovers them (RevenueCat's default transfer).
 *
 * ## Fail closed
 *
 * The id is PERSISTED before it is ever returned. If the keychain write
 * fails, resolution throws, the adapter's configuration fails, and the
 * provider answers `unavailable` — never a purchase made under an id that a
 * relaunch would forget. Concurrent first callers share one attempt, so two
 * ids are never minted; a failed attempt is forgotten so the next call
 * retries.
 */

export interface PurchaseIdentityDeps {
  readStored(): Promise<string | null>;
  writeStored(id: string): Promise<void>;
  randomId(): string;
  /**
   * The installation id an earlier build used as the RevenueCat app-user id,
   * or null when there is no evidence it was (see "Upgrading" above).
   */
  adoptableLegacyId(): Promise<string | null>;
}

/** The shape every installation-style id already uses (RPC validation). */
const ID_SHAPE = /^[A-Za-z0-9-]{16,64}$/;

export function createPurchaseIdentity(deps: PurchaseIdentityDeps): () => Promise<string> {
  let resolving: Promise<string> | null = null;
  return () => {
    resolving ??= (async () => {
      const stored = await deps.readStored();
      if (stored !== null && ID_SHAPE.test(stored)) return stored;
      const legacy = await deps.adoptableLegacyId();
      const minted = legacy !== null && ID_SHAPE.test(legacy) ? legacy : deps.randomId();
      if (!ID_SHAPE.test(minted)) throw new Error('purchase id has the wrong shape');
      await deps.writeStored(minted);
      // Read back: the id is used only once the keychain demonstrably holds it.
      if ((await deps.readStored()) !== minted) throw new Error('purchase id did not persist');
      return minted;
    })().catch((error: unknown) => {
      resolving = null;
      throw error;
    });
    return resolving;
  };
}

export interface LegacyEvidenceDeps {
  peekInstallationId(): Promise<string | null>;
  /** Personalization completed: set in the same commit as a verified purchase or restore. */
  personalizationCompleted(): Promise<boolean>;
  /** A verified active entitlement is cached on this device. */
  hasCachedEntitlement(): Promise<boolean>;
}

/**
 * The one adoption rule (see "Upgrading"): the existing installation id, but
 * only when this install demonstrably reached a purchase. Never mints.
 */
export function legacyPurchaseId(deps: LegacyEvidenceDeps): () => Promise<string | null> {
  return async () => {
    const installationId = await deps.peekInstallationId();
    if (installationId === null) return null;
    const [completed, cached] = await Promise.all([
      deps.personalizationCompleted(),
      deps.hasCachedEntitlement(),
    ]);
    return completed || cached ? installationId : null;
  };
}
