import ExpoModulesCore
import StoreKit

// Reads StoreKit's app transaction (docs/recall-privacy-program-proposal.md
// §2.6). The id is the join key a RESCIND_CONSENT notification carries. It is
// returned to JS only; src/lib/revocation-key-sync.ts decides whether it is
// sent (a regulated 13–17 user with alerts on, and then only as input to a
// server-side keyed hash).
public class AppTransactionModule: Module, @unchecked Sendable {
  public func definition() -> ModuleDefinition {
    Name("LotlyAppTransaction")

    AsyncFunction("getAppTransactionAsync") { () -> [String: Any] in
      let result = try await AppTransaction.shared
      switch result {
      case .verified(let transaction):
        return Self.describe(transaction, verified: true)
      case .unverified(let transaction, _):
        return Self.describe(transaction, verified: false)
      }
    }
  }

  private static func describe(_ transaction: AppTransaction, verified: Bool) -> [String: Any] {
    return [
      "appTransactionId": transaction.appTransactionID,
      "environment": transaction.environment.rawValue,
      "bundleId": transaction.bundleID,
      "originalPurchaseDate": ISO8601DateFormatter().string(from: transaction.originalPurchaseDate),
      "verified": verified,
    ]
  }
}
