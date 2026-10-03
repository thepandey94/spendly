const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const config = require('../config');

// Ensure database directory exists
const dbDir = path.dirname(config.DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Initialize SQLite database instance
const db = new Database(config.DB_PATH, {
  verbose: process.env.NODE_ENV === 'development' ? console.log : null
});

// Configure SQLite for high performance and strict relational integrity
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');

// Run schema initialization
const schemaPath = path.join(__dirname, 'schema.sql');
if (fs.existsSync(schemaPath)) {
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schemaSql);
} else {
  console.error('schema.sql not found at:', schemaPath);
}

// Graceful closing
process.on('SIGINT', () => {
  try {
    db.close();
  } catch (err) {
    // ignore
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  try {
    db.close();
  } catch (err) {
    // ignore
  }
  process.exit(0);
});

module.exports = db;
