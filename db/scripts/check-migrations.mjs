#!/usr/bin/env node
/**
 * Offline migration sanity checks — runs without a database so it can gate CI
 * even where Postgres/Flyway are unavailable. Verifies:
 *   1. Every file in sql/ follows Flyway naming (V<n>__desc.sql or R__desc.sql).
 *   2. Versioned migration numbers are unique and gap-free starting at 1.
 *   3. No obviously-empty migration files.
 *
 * This is NOT a substitute for applying migrations against PostgreSQL — that
 * happens in a DB-capable environment / CI (see README.md).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const sqlDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'sql');

let files;
try {
  files = readdirSync(sqlDir).filter((f) => f.endsWith('.sql'));
} catch {
  console.error(`No sql/ directory at ${sqlDir}`);
  process.exit(1);
}

const errors = [];
const versioned = /^V(\d+)__[A-Za-z0-9_]+\.sql$/;
const repeatable = /^R__[A-Za-z0-9_]+\.sql$/;
const versions = [];

for (const f of files) {
  const vMatch = f.match(versioned);
  if (!vMatch && !repeatable.test(f)) {
    errors.push(`Bad migration filename: ${f} (expected V<n>__desc.sql or R__desc.sql)`);
    continue;
  }
  if (vMatch) versions.push(Number(vMatch[1]));
  const body = readFileSync(join(sqlDir, f), 'utf8').trim();
  if (body.length === 0) errors.push(`Empty migration: ${f}`);
}

versions.sort((a, b) => a - b);
const dupes = versions.filter((v, i) => versions.indexOf(v) !== i);
if (dupes.length) errors.push(`Duplicate version numbers: ${[...new Set(dupes)].join(', ')}`);
versions.forEach((v, i) => {
  if (v !== i + 1) errors.push(`Version gap/out-of-order: expected V${i + 1}, found V${v}`);
});

if (errors.length) {
  console.error('Migration checks FAILED:');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

console.log(
  `Migration checks passed: ${versions.length} versioned migration(s) [V${versions.join(', V')}], naming + ordering OK.`
);
