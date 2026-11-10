import { buildApp } from './app.js';
import { config } from './config.js';
import { closePool, pool } from './db/pool.js';
import { engine } from './orchestration/engine.js';

async function main() {
  const app = await buildApp();

  try {
    await pool.query('SELECT 1');
  } catch (error) {
    app.log.error(
      'PostgreSQL is not reachable. Start it with `docker compose up -d`, then run `npm run db:migrate`.'
    );
    app.log.error(error);
    await closePool();
    process.exit(1);
  }

  await engine.recover();
  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    `NEXUS API ready on http://${config.host}:${config.port} (${config.nodeEnv})`
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`Received ${signal}; shutting down`);
    try {
      await app.close();
      await closePool();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    app.log.error({ reason }, 'Unhandled promise rejection');
  });
}

main().catch((error) => {
  console.error('Failed to start NEXUS API');
  console.error(error);
  process.exit(1);
});
