const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const config = require('../config');

// AsyncLocalStorage tracks active transaction client across async call stacks
const asyncLocalStorage = new AsyncLocalStorage();

const isPostgres = !!(process.env.DATABASE_URL || config.DATABASE_URL);

let pool = null;
let sqliteDb = null;

if (isPostgres) {
  const { Pool, types } = require('pg');

  // Parse BIGINT (type OID 20) as JavaScript Number for exact mathematical compatibility
  if (types && typeof types.setTypeParser === 'function') {
    types.setTypeParser(20, (val) => (val === null ? null : parseInt(val, 10)));
  }

  const connectionString = process.env.DATABASE_URL || config.DATABASE_URL;
  const isSsl = connectionString.includes('sslmode=require') || 
                process.env.NODE_ENV === 'production' || 
                connectionString.includes('neon.tech') || 
                connectionString.includes('supabase.co');

  pool = new Pool({
    connectionString,
    ssl: isSsl ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });

  pool.on('error', (err) => {
    console.error('[Spendly PostgreSQL Pool Error]', err);
  });
} else {
  const Database = require('better-sqlite3');
  const dbPath = config.DB_PATH || path.join(__dirname, 'spendly.db');
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  sqliteDb = new Database(dbPath, {
    verbose: process.env.NODE_ENV === 'development' && process.env.DEBUG_SQL ? console.log : null
  });

  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('foreign_keys = ON');
  sqliteDb.pragma('synchronous = NORMAL');
  sqliteDb.pragma('busy_timeout = 5000');
}

/**
 * Translates SQLite queries with ? placeholders and COLLATE NOCASE into PostgreSQL $1, $2... syntax
 */
function translateSql(sql) {
  if (!isPostgres) return sql;
  let paramIdx = 1;
  let translated = sql.replace(/COLLATE\s+NOCASE/gi, '');
  translated = translated.replace(/\?/g, () => `$${paramIdx++}`);
  return translated;
}

/**
 * Normalizes query parameters (flattens single arrays, converts undefined to null)
 */
function normalizeParams(params) {
  let flat = params;
  if (params.length === 1 && Array.isArray(params[0])) {
    flat = params[0];
  }
  return flat.map((p) => (p === undefined ? null : p));
}

const db = {
  isPostgres,

  async init() {
    if (isPostgres) {
      const schemaPath = path.join(__dirname, 'schema.postgres.sql');
      if (fs.existsSync(schemaPath)) {
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');
        const client = await pool.connect();
        try {
          await client.query(schemaSql);

          // Safe, idempotent migration for existing databases
          await client.query(`
            ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
          `);
          await client.query(`
            CREATE INDEX IF NOT EXISTS idx_users_is_admin ON users(is_admin);
          `);

          // Ensure configured admin emails are marked as admin in DB
          if (config.ADMIN_EMAILS && config.ADMIN_EMAILS.length > 0) {
            for (const adminEmail of config.ADMIN_EMAILS) {
              await client.query(
                `UPDATE users SET is_admin = TRUE WHERE LOWER(email) = LOWER($1)`,
                [adminEmail]
              );
            }
          }

          console.log('💾 Database: PostgreSQL connected and schema verified');
        } finally {
          client.release();
        }
      }
    } else {
      const schemaPath = path.join(__dirname, 'schema.sql');
      if (fs.existsSync(schemaPath)) {
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');
        sqliteDb.exec(schemaSql);

        // Safe, idempotent migration for SQLite
        try {
          const columns = sqliteDb.pragma('table_info(users)');
          const hasIsAdmin = columns.some((c) => c.name === 'is_admin');
          if (!hasIsAdmin) {
            sqliteDb.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0;');
          }
          sqliteDb.exec('CREATE INDEX IF NOT EXISTS idx_users_is_admin ON users(is_admin);');
        } catch (mErr) {
          // ignore
        }

        // Ensure configured admin emails are marked as admin in SQLite
        if (config.ADMIN_EMAILS && config.ADMIN_EMAILS.length > 0) {
          for (const adminEmail of config.ADMIN_EMAILS) {
            try {
              sqliteDb.prepare('UPDATE users SET is_admin = 1 WHERE email = ? COLLATE NOCASE').run(adminEmail);
            } catch (aErr) {}
          }
        }

        console.log(`💾 Database: SQLite (WAL Mode) at ${config.DB_PATH}`);
      }
    }
  },

  prepare(sql) {
    if (isPostgres) {
      const tSql = translateSql(sql);
      return {
        async get(...params) {
          const client = asyncLocalStorage.getStore() || pool;
          const flatParams = normalizeParams(params);
          const res = await client.query(tSql, flatParams);
          return res.rows[0] || null;
        },
        async all(...params) {
          const client = asyncLocalStorage.getStore() || pool;
          const flatParams = normalizeParams(params);
          const res = await client.query(tSql, flatParams);
          return res.rows;
        },
        async run(...params) {
          const client = asyncLocalStorage.getStore() || pool;
          const flatParams = normalizeParams(params);
          const res = await client.query(tSql, flatParams);
          return {
            changes: res.rowCount,
            rowCount: res.rowCount,
            lastInsertRowid: res.rows[0]?.id || null
          };
        }
      };
    } else {
      const stmt = sqliteDb.prepare(sql);
      return {
        async get(...params) {
          const flat = normalizeParams(params);
          const result = stmt.get(...flat);
          return result === undefined ? null : result;
        },
        async all(...params) {
          const flat = normalizeParams(params);
          return stmt.all(...flat);
        },
        async run(...params) {
          const flat = normalizeParams(params);
          return stmt.run(...flat);
        }
      };
    }
  },

  async query(sql, params = []) {
    if (isPostgres) {
      const client = asyncLocalStorage.getStore() || pool;
      const tSql = translateSql(sql);
      const flatParams = normalizeParams(params);
      const res = await client.query(tSql, flatParams);
      return res.rows;
    } else {
      return this.prepare(sql).all(params);
    }
  },

  async get(sql, params = []) {
    return this.prepare(sql).get(params);
  },

  async all(sql, params = []) {
    return this.prepare(sql).all(params);
  },

  async run(sql, params = []) {
    return this.prepare(sql).run(params);
  },

  async exec(sql) {
    if (isPostgres) {
      const client = asyncLocalStorage.getStore() || pool;
      return client.query(sql);
    } else {
      return sqliteDb.exec(sql);
    }
  },

  async transaction(fn) {
    if (isPostgres) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const txDb = {
          prepare: (sql) => db.prepare(sql),
          get: (sql, params) => db.get(sql, params),
          all: (sql, params) => db.all(sql, params),
          run: (sql, params) => db.run(sql, params),
          query: (sql, params) => client.query(translateSql(sql), normalizeParams(params))
        };
        const result = await asyncLocalStorage.run(client, async () => {
          return await fn(txDb);
        });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } else {
      sqliteDb.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn(db);
        sqliteDb.exec('COMMIT');
        return result;
      } catch (err) {
        try {
          sqliteDb.exec('ROLLBACK');
        } catch (rbErr) {
          // ignore rollback error if already rolled back
        }
        throw err;
      }
    }
  },

  async close() {
    if (pool) {
      await pool.end();
    }
    if (sqliteDb) {
      try {
        sqliteDb.close();
      } catch (err) {
        // ignore
      }
    }
  }
};

// Graceful closing
process.on('SIGINT', async () => {
  await db.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await db.close();
  process.exit(0);
});

module.exports = db;
