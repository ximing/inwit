import { pool } from './index.js';
import { applyMigrations, migrationsFolder } from './migrator.js';

try {
  console.log(`applying migrations from ${migrationsFolder}`);
  await applyMigrations();
  console.log('migrations applied');
} catch (err) {
  console.error('migration failed', err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
