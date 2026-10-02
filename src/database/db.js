import sqlite3 from 'sqlite3';
import pg from 'pg';
import mysql from 'mysql2/promise';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbType = (process.env.DB_TYPE || '').toLowerCase();
const isMySQL = dbType === 'mysql' || dbType === 'mariadb' || Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('mysql')) || Boolean(process.env.MYSQL_HOST);
const isPostgres = dbType === 'postgres' || Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('postgres'));

let dbInstance = null;
let pgPool = null;
let mysqlPool = null;

// Ensure data directory exists
const dataDir = path.resolve(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const sqlitePath = path.join(dataDir, 'lesson_plans.db');

export async function initDatabase() {
  if (isMySQL) {
    const config = process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('mysql')
      ? { uri: process.env.DATABASE_URL }
      : {
          host: process.env.DB_HOST || process.env.MYSQL_HOST || 'localhost',
          port: parseInt(process.env.DB_PORT || process.env.MYSQL_PORT || '3306', 10),
          user: process.env.DB_USER || process.env.MYSQL_USER || 'root',
          password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || '',
          database: process.env.DB_NAME || process.env.MYSQL_DATABASE || 'school_lesson_plans',
          waitForConnections: true,
          connectionLimit: 10,
          queueLimit: 0,
          charset: 'utf8mb4',
          dateStrings: true
        };
    console.log(`[DB] Connecting to MySQL/MariaDB database (${config.database || 'custom'}) at ${config.host || 'URI'}...`);
    mysqlPool = mysql.createPool(config);
    const conn = await mysqlPool.getConnection();
    console.log('[DB] Connected to MySQL/MariaDB successfully.');
    conn.release();
    await initMySQLSchema(mysqlPool);
    return;
  }

  if (isPostgres) {
    pgPool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    console.log('[DB] Connecting to PostgreSQL database...');
    await initPostgresSchema(pgPool);
    return;
  }

  // SQLite Default
  console.log(`[DB] Initializing SQLite database at: ${sqlitePath}`);
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(sqlitePath, (err) => {
      if (err) return reject(err);
      dbInstance = db;
      // Enable foreign keys
      db.run('PRAGMA foreign_keys = ON;', async (pragmaErr) => {
        if (pragmaErr) return reject(pragmaErr);
        try {
          await initSqliteSchema(db);
          resolve();
        } catch (schemaErr) {
          reject(schemaErr);
        }
      });
    });
  });
}

function runSqlite(sql, params = []) {
  return new Promise((resolve, reject) => {
    dbInstance.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function getSqlite(sql, params = []) {
  return new Promise((resolve, reject) => {
    dbInstance.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function allSqlite(sql, params = []) {
  return new Promise((resolve, reject) => {
    dbInstance.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function initSqliteSchema(db) {
  const schema = `
    CREATE TABLE IF NOT EXISTS academic_terms (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      start_date TEXT,
      end_date TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL, -- 'teacher', 'dept_head', 'academic_director', 'director'
      department TEXT,
      position_title TEXT NOT NULL,
      avatar TEXT
    );

    CREATE TABLE IF NOT EXISTS lesson_plans (
      id TEXT PRIMARY KEY,
      academic_term_id TEXT NOT NULL,
      teacher_name TEXT NOT NULL,
      teacher_email TEXT NOT NULL,
      teacher_department TEXT NOT NULL,
      subject_code TEXT NOT NULL,
      subject_name TEXT NOT NULL,
      grade_level TEXT NOT NULL,
      file_original_name TEXT,
      file_size INTEGER,
      local_file_path TEXT,
      stamped_file_path TEXT,
      google_drive_file_id TEXT,
      google_drive_view_link TEXT,
      google_drive_download_link TEXT,
      signature_data TEXT,
      signed_at DATETIME,
      submission_status TEXT NOT NULL DEFAULT 'submitted', -- 'draft', 'submitted', 'under_review', 'approved', 'revision_needed'
      current_stage TEXT NOT NULL DEFAULT 'dept_head', -- 'dept_head', 'academic_director', 'director', 'completed', 'revision_needed'
      current_reviewer_title TEXT DEFAULT 'หัวหน้ากลุ่มสาระการเรียนรู้',
      reviewer_feedback TEXT,
      reviewed_at DATETIME,
      reviewed_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT unique_teacher_per_term UNIQUE (teacher_email, academic_term_id),
      FOREIGN KEY (academic_term_id) REFERENCES academic_terms(id)
    );

    CREATE TABLE IF NOT EXISTS approval_timeline (
      id TEXT PRIMARY KEY,
      lesson_plan_id TEXT NOT NULL,
      step_order INTEGER NOT NULL,
      stage_key TEXT NOT NULL, -- 'submission', 'dept_head', 'academic_director', 'director'
      stage_title TEXT NOT NULL,
      reviewer_name TEXT,
      reviewer_role TEXT,
      status TEXT NOT NULL DEFAULT 'waiting', -- 'completed', 'in_progress', 'waiting', 'revision_needed'
      feedback TEXT,
      action_at DATETIME,
      FOREIGN KEY (lesson_plan_id) REFERENCES lesson_plans(id)
    );

    CREATE TABLE IF NOT EXISTS job_tasks (
      id TEXT PRIMARY KEY,
      lesson_plan_id TEXT,
      status TEXT NOT NULL, -- 'queued', 'validating', 'stamping_signature', 'uploading_drive', 'completed', 'failed'
      progress INTEGER DEFAULT 0,
      message TEXT,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      head_name TEXT,
      head_email TEXT,
      head_pin TEXT DEFAULT '1234',
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `;

  // Run schema commands sequentially
  const statements = schema.split(';').map(s => s.trim()).filter(s => s.length > 0);
  for (const statement of statements) {
    await runSqlite(statement);
  }

  // Safe migration for existing tables if columns missing
  try {
    await runSqlite(`ALTER TABLE lesson_plans ADD COLUMN current_stage TEXT DEFAULT 'dept_head';`);
  } catch (e) {}
  try {
    await runSqlite(`ALTER TABLE lesson_plans ADD COLUMN current_reviewer_title TEXT DEFAULT 'หัวหน้ากลุ่มสาระการเรียนรู้';`);
  } catch (e) {}
  try {
    await runSqlite(`ALTER TABLE approval_timeline ADD COLUMN reviewer_signature TEXT;`);
  } catch (e) {}
  try {
    await runSqlite(`ALTER TABLE approval_timeline ADD COLUMN round_number INTEGER DEFAULT 1;`);
  } catch (e) {}
  try {
    await runSqlite(`ALTER TABLE lesson_plans ADD COLUMN submission_round INTEGER DEFAULT 1;`);
  } catch (e) {}
  try {
    await runSqlite(`ALTER TABLE lesson_plans ADD COLUMN current_round INTEGER DEFAULT 1;`);
  } catch (e) {}
  try {
    await runSqlite(`ALTER TABLE lesson_plans ADD COLUMN round_2_status TEXT DEFAULT 'not_started';`);
  } catch (e) {}
  try {
    await runSqlite(`ALTER TABLE lesson_plans ADD COLUMN round_2_stage TEXT DEFAULT 'dept_head';`);
  } catch (e) {}
  try {
    await runSqlite(`ALTER TABLE lesson_plans ADD COLUMN round_2_signature TEXT;`);
  } catch (e) {}
  try {
    await runSqlite(`ALTER TABLE lesson_plans ADD COLUMN round_2_signed_at DATETIME;`);
  } catch (e) {}
  try {
    await runSqlite(`ALTER TABLE users ADD COLUMN pin_code TEXT DEFAULT '1234';`);
  } catch (e) {}
  try {
    await runSqlite(`UPDATE users SET pin_code = '1234' WHERE pin_code IS NULL;`);
  } catch (e) {}

  // Seed default academic terms if not exists
  const existingTerm = await getSqlite('SELECT id FROM academic_terms LIMIT 1');
  if (!existingTerm) {
    await runSqlite(
      `INSERT INTO academic_terms (id, code, name, is_active, start_date, end_date) VALUES 
      ('term-2569-1', '1/2569', 'ภาคเรียนที่ 1 ปีการศึกษา 2569 (ภาคเรียนปัจจุบัน)', 1, '2026-05-15', '2026-10-15'),
      ('term-2568-2', '2/2568', 'ภาคเรียนที่ 2 ปีการศึกษา 2568', 0, '2025-11-01', '2026-03-31')`
    );
    console.log('[DB] Seeded initial academic terms.');
  }

  // Standard 8 Thai Learning Groups (กลุ่มสาระการเรียนรู้ 8 กลุ่มสาระ)
  const standardDepartments = [
    { id: 'dept-sci', code: 'sci', name: 'วิทยาศาสตร์และเทคโนโลยี', desc: 'วิทยาศาสตร์ ฟิสิกส์ เคมี ชีววิทยา และเทคโนโลยีคอมพิวเตอร์' },
    { id: 'dept-math', code: 'math', name: 'คณิตศาสตร์', desc: 'คณิตศาสตร์พื้นฐานและคณิตศาสตร์เพิ่มเติม' },
    { id: 'dept-thai', code: 'thai', name: 'ภาษาไทย', desc: 'ภาษาไทย วรรณคดี และหลักภาษา' },
    { id: 'dept-foreign', code: 'foreign', name: 'ภาษาต่างประเทศ', desc: 'ภาษาอังกฤษ ภาษาจีน ภาษาญี่ปุ่น และภาษาต่างประเทศ' },
    { id: 'dept-social', code: 'social', name: 'สังคมศึกษา ศาสนา และวัฒนธรรม', desc: 'สังคมศึกษา ศาสนา วัฒนธรรม ประวัติศาสตร์ และภูมิศาสตร์' },
    { id: 'dept-health', code: 'health', name: 'สุขศึกษาและพลศึกษา', desc: 'สุขศึกษา พลศึกษา และการสร้างเสริมสุขภาวะ' },
    { id: 'dept-art', code: 'art', name: 'ศิลปะ', desc: 'ทัศนศิลป์ ดนตรี และนาฏศิลป์' },
    { id: 'dept-career', code: 'career', name: 'การงานอาชีพ', desc: 'งานบ้าน งานช่าง งานเกษตร และธุรกิจการงานอาชีพ' }
  ];

  for (const d of standardDepartments) {
    const existingDept = await getSqlite('SELECT id FROM departments WHERE id = ? OR code = ?', [d.id, d.code]);
    if (!existingDept) {
      await runSqlite(
        `INSERT INTO departments (id, code, name, head_name, head_email, head_pin, description) VALUES (?, ?, ?, NULL, NULL, '1234', ?)`,
        [d.id, d.code, d.name, d.desc]
      );
    }
  }

  // Seed Admin account only (ผู้ดูแลระบบ)
  const adminAccount = {
    id: 'u-admin',
    name: 'นายปิยะพงษ์ ยะจันโท',
    email: 'admin@school.ac.th',
    role: 'admin',
    dept: 'ผู้ดูแลระบบ',
    title: 'ผู้ดูแลระบบคอมพิวเตอร์',
    avatar: '💻',
    pin: '1234'
  };

  const existingAdmin = await getSqlite('SELECT id FROM users WHERE role = ? OR id = ?', ['admin', adminAccount.id]);
  if (!existingAdmin) {
    await runSqlite(
      `INSERT INTO users (id, name, email, role, department, position_title, avatar, pin_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [adminAccount.id, adminAccount.name, adminAccount.email, adminAccount.role, adminAccount.dept, adminAccount.title, adminAccount.avatar, adminAccount.pin]
    );
    console.log('[DB] Seeded initial admin account.');
  }
}

async function initMySQLSchema(pool) {
  const tables = [
    `CREATE TABLE IF NOT EXISTS academic_terms (
      id VARCHAR(64) PRIMARY KEY,
      code VARCHAR(32) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      is_active TINYINT(1) DEFAULT 1,
      start_date VARCHAR(32),
      end_date VARCHAR(32),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    `CREATE TABLE IF NOT EXISTS departments (
      id VARCHAR(64) PRIMARY KEY,
      code VARCHAR(32) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      head_name VARCHAR(255) DEFAULT NULL,
      head_email VARCHAR(255) DEFAULT NULL,
      head_pin VARCHAR(32) DEFAULT '1234',
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    `CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      role VARCHAR(64) NOT NULL,
      department VARCHAR(255),
      position_title VARCHAR(255) NOT NULL,
      avatar VARCHAR(64) DEFAULT '👨‍🏫',
      pin_code VARCHAR(32) DEFAULT '1234'
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    `CREATE TABLE IF NOT EXISTS lesson_plans (
      id VARCHAR(64) PRIMARY KEY,
      academic_term_id VARCHAR(64) NOT NULL,
      teacher_name VARCHAR(255) NOT NULL,
      teacher_email VARCHAR(255) NOT NULL,
      teacher_department VARCHAR(255) NOT NULL,
      subject_code VARCHAR(64) NOT NULL,
      subject_name VARCHAR(255) NOT NULL,
      grade_level VARCHAR(64) NOT NULL,
      file_original_name VARCHAR(255),
      file_size BIGINT,
      local_file_path TEXT,
      stamped_file_path TEXT,
      google_drive_file_id VARCHAR(255),
      google_drive_view_link TEXT,
      google_drive_download_link TEXT,
      signature_data LONGTEXT,
      signed_at DATETIME,
      submission_status VARCHAR(64) NOT NULL DEFAULT 'submitted',
      current_stage VARCHAR(64) NOT NULL DEFAULT 'dept_head',
      current_reviewer_title VARCHAR(255) DEFAULT 'หัวหน้ากลุ่มสาระการเรียนรู้',
      reviewer_feedback TEXT,
      reviewed_at DATETIME,
      reviewed_by VARCHAR(255),
      submission_round INT DEFAULT 1,
      current_round INT DEFAULT 1,
      round_2_status VARCHAR(64) DEFAULT 'not_started',
      round_2_stage VARCHAR(64) DEFAULT 'dept_head',
      round_2_signature LONGTEXT,
      round_2_signed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_teacher_per_term (teacher_email, academic_term_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    `CREATE TABLE IF NOT EXISTS approval_timeline (
      id VARCHAR(64) PRIMARY KEY,
      lesson_plan_id VARCHAR(64) NOT NULL,
      step_order INT NOT NULL,
      stage_key VARCHAR(64) NOT NULL,
      stage_title VARCHAR(255) NOT NULL,
      reviewer_name VARCHAR(255),
      reviewer_role VARCHAR(255),
      status VARCHAR(64) NOT NULL DEFAULT 'waiting',
      feedback TEXT,
      action_at DATETIME,
      reviewer_signature LONGTEXT,
      round_number INT DEFAULT 1,
      KEY idx_plan_timeline (lesson_plan_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,

    `CREATE TABLE IF NOT EXISTS job_tasks (
      id VARCHAR(64) PRIMARY KEY,
      lesson_plan_id VARCHAR(64),
      status VARCHAR(64) NOT NULL,
      progress INT DEFAULT 0,
      message TEXT,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`
  ];

  for (const sql of tables) {
    await pool.query(sql);
  }

  // Seed default academic terms
  const [terms] = await pool.query('SELECT id FROM academic_terms LIMIT 1');
  if (terms.length === 0) {
    await pool.query(`
      INSERT INTO academic_terms (id, code, name, is_active, start_date, end_date) VALUES 
      ('term-2569-1', '1/2569', 'ภาคเรียนที่ 1 ปีการศึกษา 2569 (ภาคเรียนปัจจุบัน)', 1, '2026-05-15', '2026-10-15'),
      ('term-2568-2', '2/2568', 'ภาคเรียนที่ 2 ปีการศึกษา 2568', 0, '2025-11-01', '2026-03-31')
      ON DUPLICATE KEY UPDATE name=VALUES(name);
    `);
    console.log('[DB] Seeded initial academic terms to MySQL.');
  }

  // Seed standard 8 departments
  const standardDepartments = [
    { id: 'dept-sci', code: 'sci', name: 'วิทยาศาสตร์และเทคโนโลยี', desc: 'วิทยาศาสตร์ ฟิสิกส์ เคมี ชีววิทยา และเทคโนโลยีคอมพิวเตอร์' },
    { id: 'dept-math', code: 'math', name: 'คณิตศาสตร์', desc: 'คณิตศาสตร์พื้นฐานและคณิตศาสตร์เพิ่มเติม' },
    { id: 'dept-thai', code: 'thai', name: 'ภาษาไทย', desc: 'ภาษาไทย วรรณคดี และหลักภาษา' },
    { id: 'dept-foreign', code: 'foreign', name: 'ภาษาต่างประเทศ', desc: 'ภาษาอังกฤษ ภาษาจีน ภาษาญี่ปุ่น และภาษาต่างประเทศ' },
    { id: 'dept-social', code: 'social', name: 'สังคมศึกษา ศาสนา และวัฒนธรรม', desc: 'สังคมศึกษา ศาสนา วัฒนธรรม ประวัติศาสตร์ และภูมิศาสตร์' },
    { id: 'dept-health', code: 'health', name: 'สุขศึกษาและพลศึกษา', desc: 'สุขศึกษา พลศึกษา และการสร้างเสริมสุขภาวะ' },
    { id: 'dept-art', code: 'art', name: 'ศิลปะ', desc: 'ทัศนศิลป์ ดนตรี และนาฏศิลป์' },
    { id: 'dept-career', code: 'career', name: 'การงานอาชีพ', desc: 'งานบ้าน งานช่าง งานเกษตร และธุรกิจการงานอาชีพ' }
  ];

  for (const d of standardDepartments) {
    const [existing] = await pool.query('SELECT id FROM departments WHERE id = ? OR code = ?', [d.id, d.code]);
    if (existing.length === 0) {
      await pool.query(
        'INSERT INTO departments (id, code, name, head_name, head_email, head_pin, description) VALUES (?, ?, ?, NULL, NULL, "1234", ?)',
        [d.id, d.code, d.name, d.desc]
      );
    }
  }

  // Seed admin account
  const adminAccount = {
    id: 'u-admin',
    name: 'นายปิยะพงษ์ ยะจันโท',
    email: 'admin@school.ac.th',
    role: 'admin',
    dept: 'ผู้ดูแลระบบ',
    title: 'ผู้ดูแลระบบคอมพิวเตอร์',
    avatar: '💻',
    pin: '1234'
  };

  const [existingAdmin] = await pool.query('SELECT id FROM users WHERE role = ? OR id = ?', ['admin', adminAccount.id]);
  if (existingAdmin.length === 0) {
    await pool.query(
      'INSERT INTO users (id, name, email, role, department, position_title, avatar, pin_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [adminAccount.id, adminAccount.name, adminAccount.email, adminAccount.role, adminAccount.dept, adminAccount.title, adminAccount.avatar, adminAccount.pin]
    );
    console.log('[DB] Seeded initial admin account to MySQL.');
  }
}

async function initPostgresSchema(pool) {
  const schema = `
    CREATE TABLE IF NOT EXISTS academic_terms (
      id VARCHAR(64) PRIMARY KEY,
      code VARCHAR(32) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      start_date VARCHAR(32),
      end_date VARCHAR(32),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS lesson_plans (
      id VARCHAR(64) PRIMARY KEY,
      academic_term_id VARCHAR(64) NOT NULL REFERENCES academic_terms(id),
      teacher_name VARCHAR(255) NOT NULL,
      teacher_email VARCHAR(255) NOT NULL,
      teacher_department VARCHAR(255) NOT NULL,
      subject_code VARCHAR(64) NOT NULL,
      subject_name VARCHAR(255) NOT NULL,
      grade_level VARCHAR(64) NOT NULL,
      file_original_name VARCHAR(255),
      file_size BIGINT,
      local_file_path TEXT,
      stamped_file_path TEXT,
      google_drive_file_id VARCHAR(255),
      google_drive_view_link TEXT,
      google_drive_download_link TEXT,
      signature_data TEXT,
      signed_at TIMESTAMP WITH TIME ZONE,
      submission_status VARCHAR(64) NOT NULL DEFAULT 'submitted',
      reviewer_feedback TEXT,
      reviewed_at TIMESTAMP WITH TIME ZONE,
      reviewed_by VARCHAR(255),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT unique_teacher_per_term UNIQUE (teacher_email, academic_term_id)
    );

    CREATE TABLE IF NOT EXISTS job_tasks (
      id VARCHAR(64) PRIMARY KEY,
      lesson_plan_id VARCHAR(64),
      status VARCHAR(64) NOT NULL,
      progress INT DEFAULT 0,
      message TEXT,
      error_message TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;
  await pool.query(schema);

  const res = await pool.query('SELECT id FROM academic_terms LIMIT 1');
  if (res.rows.length === 0) {
    await pool.query(`
      INSERT INTO academic_terms (id, code, name, is_active, start_date, end_date) VALUES 
      ('term-2569-1', '1/2569', 'ภาคเรียนที่ 1 ปีการศึกษา 2569 (ภาคเรียนปัจจุบัน)', true, '2026-05-15', '2026-10-15'),
      ('term-2568-2', '2/2568', 'ภาคเรียนที่ 2 ปีการศึกษา 2568', false, '2025-11-01', '2026-03-31')
      ON CONFLICT DO NOTHING;
    `);
  }
}

// Universal database interface
export const db = {
  async query(sql, params = []) {
    if (isMySQL) {
      const [rows] = await mysqlPool.query(sql, params);
      return rows;
    } else if (isPostgres) {
      let paramIdx = 1;
      const pgSql = sql.replace(/\?/g, () => `$${paramIdx++}`);
      const res = await pgPool.query(pgSql, params);
      return res.rows;
    } else {
      return allSqlite(sql, params);
    }
  },

  async get(sql, params = []) {
    if (isMySQL) {
      const [rows] = await mysqlPool.query(sql, params);
      return rows[0] || null;
    } else if (isPostgres) {
      let paramIdx = 1;
      const pgSql = sql.replace(/\?/g, () => `$${paramIdx++}`);
      const res = await pgPool.query(pgSql, params);
      return res.rows[0] || null;
    } else {
      return getSqlite(sql, params);
    }
  },

  async execute(sql, params = []) {
    if (isMySQL) {
      const [result] = await mysqlPool.query(sql, params);
      return { lastID: result.insertId, changes: result.affectedRows };
    } else if (isPostgres) {
      let paramIdx = 1;
      const pgSql = sql.replace(/\?/g, () => `$${paramIdx++}`);
      const res = await pgPool.query(pgSql, params);
      return { changes: res.rowCount };
    } else {
      return runSqlite(sql, params);
    }
  }
};
