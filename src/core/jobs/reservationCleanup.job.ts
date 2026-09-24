import cron from 'node-cron';
import { ordersRepository } from '../../modules/orders/orders.repository.js';

let cleanupTask: cron.ScheduledTask | null = null;
let isRunning = false;

/**
 * Starts the periodic background cron job that collects expired reservation holds.
 *
 * Timing:
 * Stock reservations have a 15-minute TTL. This worker polls every 5 minutes (approx 15-20 min total hold).
 *
 * Concurrency & Distributed Safety:
 * - `isRunning` provides in-process overlap protection within this specific Node.js process.
 * - Distributed multi-replica coordination is enforced at the database level inside `releaseExpiredReservations()`
 *   via PostgreSQL advisory locking (`pg_try_advisory_lock`), preventing split-brain execution across multiple server instances.
 */
export function startReservationCleanupJob(): cron.ScheduledTask {
  if (cleanupTask) return cleanupTask;

  cleanupTask = cron.schedule('*/5 * * * *', async () => {
    // In-process overlap protection: prevent concurrent execution within this Node.js process
    if (isRunning) {
      console.warn('[Cron:ReservationCleanup] Previous in-process cycle still running, skipping overlap.');
      return;
    }

    isRunning = true;
    try {
      const releasedCount = await ordersRepository.releaseExpiredReservations();
      if (releasedCount > 0) {
        console.log(`[Cron:ReservationCleanup] Successfully released ${releasedCount} expired stock reservation hold(s).`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Cron:ReservationCleanup] Unexpected failure during reservation cleanup:', message);
    } finally {
      isRunning = false;
    }
  });

  console.log('[Cron] Initialized stock reservation cleanup worker (Every 5 mins).');
  return cleanupTask;
}

/**
 * Gracefully stops the reservation cleanup cron worker.
 */
export function stopReservationCleanupJob(): void {
  if (cleanupTask) {
    cleanupTask.stop();
    cleanupTask = null;
    isRunning = false;
    console.log('[Cron] Stopped stock reservation cleanup worker.');
  }
}
