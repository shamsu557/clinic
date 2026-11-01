'use strict';
/*
 * Owner setup from the terminal:   node hash.js
 * Asks for the owner's details, hashes the password (bcrypt) and the security answer, and saves
 * everything to the MySQL database so you can log in right away. Nothing is stored in plaintext.
 * It also applies any pending database migrations first, so a fresh database just works.
 */
const readline = require('readline');
const { spawnSync } = require('child_process');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('./src/config');
const V = require('./src/lib/validate');
const S = require('./src/lib/security');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
let muted = false;
rl._writeToOutput = function (s) { if (!muted) return rl.output.write(s); if (!/[\r\n]/.test(s)) rl.output.write('*'); };
const ask = (q) => new Promise((resolve) => { muted = false; rl.question(q, (a) => resolve(a.trim())); });
const askHidden = (q) => new Promise((resolve) => { rl.question(q, (a) => { muted = false; process.stdout.write('\n'); resolve(a); }); muted = true; });
async function askUntil(q, parse, err, { hidden = false } = {}) {
  for (;;) { const raw = hidden ? await askHidden(q) : await ask(q); const v = parse(raw); if (v) return v; console.log(`  ✗ ${err}`); }
}

(async () => {
  console.log('\n=== The Clinic — Owner account setup ===\n');
  const mig = spawnSync(process.execPath, [path.join(__dirname, 'scripts', 'migrate.js')], { stdio: 'inherit' });
  if (mig.status !== 0) { console.error('\nCould not prepare the database. Check DB_HOST / DB_USER / DB_PASSWORD / DB_NAME in your .env file.'); process.exit(1); }

  const db = await mysql.createConnection({ ...config.db, charset: 'utf8mb4' });
  const [[ownerRole]] = await db.query("SELECT id FROM roles WHERE code='owner'");
  const [existing] = await db.query('SELECT id, full_name, email FROM users WHERE role_id=?', [ownerRole.id]);
  let replaceId = null;
  if (existing.length) {
    console.log(`\nAn owner account already exists: ${existing[0].full_name} <${existing[0].email}>`);
    const a = (await ask('Replace this owner\'s details and password? (yes/no): ')).toLowerCase();
    if (a !== 'yes' && a !== 'y') { console.log('Nothing changed.'); await db.end(); rl.close(); return; }
    replaceId = existing[0].id;
  }

  console.log('\nEnter the owner\'s details:\n');
  const fullName = await askUntil('Full name: ', (s) => (s.length >= 3 && s.length <= 150 ? s : null), 'Please enter at least 3 characters.');
  const email = await askUntil('Email address: ', (s) => V.normalizeEmail(s) || null, 'That is not a valid email address.');
  const phone = await askUntil('Phone number (e.g. 08030000000): ', (s) => V.normalizePhone(s) || null, 'That is not a valid phone number.');
  const jobTitle = (await ask('Job title (press Enter for "Owner"): ')) || 'Owner';

  let password;
  for (;;) {
    password = await askUntil('Password (min 8 characters): ', (s) => (s.length >= 8 && s.length <= 72 ? s : null), 'Use 8 to 72 characters.', { hidden: true });
    const again = await askHidden('Confirm password: ');
    if (again === password) break;
    console.log('  ✗ Passwords do not match. Try again.');
  }

  const [qs] = await db.query('SELECT id, question FROM security_questions WHERE active=1 ORDER BY id');
  console.log('\nChoose a security question (used for password recovery):');
  qs.forEach((q, i) => console.log(`  ${i + 1}. ${q.question}`));
  const q = await askUntil('Number: ', (s) => qs[parseInt(s, 10) - 1] || null, `Enter a number from 1 to ${qs.length}.`);
  const answer = await askUntil('Your answer: ', (s) => (s.length >= 2 && s.length <= 100 ? s : null), 'Answer must be 2 to 100 characters.', { hidden: true });

  const passwordHash = await S.hashPassword(password);
  const answerHash = await S.hashAnswer(answer); // trimmed + UPPERCASE, then bcrypt

  try {
    await db.beginTransaction();
    let id = replaceId;
    if (id) {
      await db.query(`UPDATE users SET full_name=?, email=?, phone=?, password_hash=?, status='active', must_change_password=0, must_setup_security=0,
        failed_login_count=0, locked_until=NULL, password_changed_at=UTC_TIMESTAMP() WHERE id=?`, [fullName, email, phone, passwordHash, id]);
    } else {
      const [r] = await db.query(`INSERT INTO users (role_id, full_name, email, phone, password_hash, must_change_password, must_setup_security, password_changed_at)
        VALUES (?,?,?,?,?,0,0,UTC_TIMESTAMP())`, [ownerRole.id, fullName, email, phone, passwordHash]);
      id = r.insertId;
    }
    await db.query('INSERT INTO staff_profiles (user_id, job_title) VALUES (?,?) ON DUPLICATE KEY UPDATE job_title=VALUES(job_title)', [id, jobTitle]);
    await db.query('INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?,?)', [id, ownerRole.id]);
    await db.query(`INSERT INTO user_security_answers (user_id, question_id, answer_hash) VALUES (?,?,?)
      ON DUPLICATE KEY UPDATE question_id=VALUES(question_id), answer_hash=VALUES(answer_hash)`, [id, q.id, answerHash]);
    // the owner is recorded as the actor (they created their own account from the terminal)
    await db.query("INSERT INTO audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_label, details) VALUES (?,?,?,?, 'user', ?,?, ?)",
      [id, fullName, 'Owner', replaceId ? 'owner.updated' : 'owner.created', String(id), fullName, JSON.stringify({ via: 'hash.js terminal setup' })]);
    await db.commit();
  } catch (e) {
    await db.rollback();
    console.error(e.code === 'ER_DUP_ENTRY' ? '\n✗ That email or phone number is already used by another account.' : `\n✗ ${e.message}`);
    await db.end(); rl.close(); process.exit(1);
  }
  await db.end(); rl.close();
  console.log(`\n✓ Owner saved. You can now start the server (node server.js) and sign in with:\n    ${email}   or   ${phone}\n  and the password you just entered.\n`);
})().catch((e) => { console.error(e.message); process.exit(1); });
