const path = require('path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'smartgate_db',
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10),
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  dateStrings: true
});

// Helper for running transactions safely
async function withTransaction(callback) {
  const connection = await pool.getConnection();
  await connection.beginTransaction();
  try {
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

let schemaMigrated = false;

async function ensureSchemaColumns() {
  if (schemaMigrated) return;
  const columnsToEnsure = [
    { name: 'photo_url', def: 'VARCHAR(255) NULL' },
    { name: 'institution', def: "VARCHAR(150) DEFAULT 'HICET'" },
    { name: 'gender', def: 'VARCHAR(20) NULL' },
    { name: 'dob', def: 'VARCHAR(30) NULL' },
    { name: 'guardian_name', def: 'VARCHAR(150) NULL' },
    { name: 'district', def: 'VARCHAR(100) NULL' },
    { name: 'address', def: 'TEXT NULL' },
    { name: 'pincode', def: 'VARCHAR(20) NULL' },
    { name: 'aadhar_number', def: 'VARCHAR(30) NULL' }
  ];

  try {
    const [existingCols] = await pool.query('SHOW COLUMNS FROM students');
    const colNames = new Set(existingCols.map(c => c.Field.toLowerCase()));

    for (const col of columnsToEnsure) {
      if (!colNames.has(col.name.toLowerCase())) {
        await pool.query(`ALTER TABLE students ADD COLUMN ${col.name} ${col.def}`);
        console.log(`[DB MIGRATION] Added missing column students.${col.name}`);
      }
    }
    schemaMigrated = true;
  } catch (err) {
    console.warn('[DB MIGRATION WARN]', err.message);
  }
}

async function testConnection() {
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query('SELECT 1 + 1 AS result');
    connection.release();
    await ensureSchemaColumns();
    return true;
  } catch (error) {
    console.error('MySQL Connection Error:', error.message);
    return false;
  }
}

module.exports = {
  pool,
  withTransaction,
  testConnection,
  ensureSchemaColumns
};
