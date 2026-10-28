const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

async function runMigration() {
  console.log('Running database migrations...');
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  // Split SQL commands by semicolon (ignoring comments and empty statements)
  const statements = sql
    .split(/;\s*$/m)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  for (const statement of statements) {
    if (statement.toLowerCase().startsWith('use ') || statement.toLowerCase().startsWith('create database ')) {
      continue; // Handled by pool config
    }
    try {
      await pool.query(statement);
    } catch (err) {
      // Table exists or similar non-fatal check
      if (!err.message.includes('already exists')) {
        console.warn('Migration warning on statement:', statement.substring(0, 50), err.message);
      }
    }
  }

  console.log('Database migration completed successfully.');
  process.exit(0);
}

runMigration().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
