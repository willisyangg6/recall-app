/**
 * THE installation mutation coordinator (C7.1): one serial queue for every
 * operation that writes installation-scoped state — locally or on the server.
 *
 * Before C7.1 only preference saves were serialized (their own queue in
 * preferences-store). Data deletion makes the wider ordering matter: a
 * preference autosave, a launch-time dirty-flag flush, or a silent push
 * re-registration racing "Reset app and delete my data" could re-upsert a
 * row on the server AFTER the deletion transaction ran — recreating exactly
 * the data the user just deleted. With one FIFO queue that interleaving is
 * impossible:
 *
 *   - anything enqueued before the reset runs first, and whatever it wrote
 *     is deleted by the reset;
 *   - anything enqueued after the reset runs against the FRESH installation
 *     identity (the reset regenerates the id inside its own queue turn), so
 *     it can never touch — or recreate — the old installation's rows.
 *
 * The preference last-request-wins guarantee is unchanged: saves still both
 * start and finish in request order on this same FIFO (createSerialQueue's
 * proofs in serial-queue.test.ts apply verbatim — this module only widens
 * which operations share the chain).
 *
 * What must go through this queue: preference saves and the dirty-flag
 * flush, push registration/refresh/disable server writes, and the reset
 * itself. What must NOT: reads (they mutate nothing) and the system
 * permission prompt (queueing a user dialog would stall every queued save
 * until the user answers — enableRecallAlerts prompts first, then enqueues
 * only its server write).
 */

import { createSerialQueue } from './serial-queue';

export const enqueueInstallationMutation = createSerialQueue();
