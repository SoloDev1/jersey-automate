import { app } from './app.js';
import { env } from './core/config/env.js';
import { startReservationCleanupJob } from './core/jobs/reservationCleanup.job.js';

export function startServer(port: number = env.PORT) {
  const server = app.listen(port, () => {
    console.log(`====================================================`);
    console.log(` ⚽ Jersey Automate - Backend Engine (TypeScript)`);
    console.log(` Running on: http://localhost:${port}`);
    console.log(` Environment: ${env.NODE_ENV}`);
    console.log(` Healthcheck: http://localhost:${port}/health`);
    console.log(` API Base:    http://localhost:${port}/api/v1`);
    console.log(`====================================================`);
  });

  // Start background periodic stock cleanup worker
  if (env.NODE_ENV !== 'test') {
    startReservationCleanupJob();
  }

  return server;
}

// Start listener automatically if run directly
let serverInstance: ReturnType<typeof startServer> | null = null;
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('server.ts') || 
  process.argv[1].endsWith('server.js') || 
  process.argv[1].includes('server')
);

if (isDirectRun && env.NODE_ENV !== 'test') {
  serverInstance = startServer(env.PORT);
}

export { serverInstance };
