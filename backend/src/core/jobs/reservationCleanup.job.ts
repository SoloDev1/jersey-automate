import cron from 'node-cron';
import { supabase } from '../database/supabase.js';

let cleanupTask: cron.ScheduledTask | null = null;

/**
 * Starts the periodic background cron job that releases expired 15-minute stock holds.
 * Runs every 5 minutes.
 */
export function startReservationCleanupJob(): cron.ScheduledTask {
  if (cleanupTask) return cleanupTask;

  cleanupTask = cron.schedule('*/5 * * * *', async () => {
    try {
      const { data, error } = await supabase.rpc('release_expired_reservations');
      if (error) {
        console.error('[Cron] Error releasing expired stock reservations:', error.message);
      } else if (typeof data === 'number' && data > 0) {
        console.log(`[Cron] Successfully released ${data} expired stock reservation(s).`);
      }
    } catch (err) {
      console.error('[Cron] Unexpected failure in reservation cleanup:', err);
    }
  });

  console.log('[Cron] Initialized reservation cleanup worker (Every 5 mins).');
  return cleanupTask;
}
