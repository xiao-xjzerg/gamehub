import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
export function openStore(filename) {
  if(filename !== ':memory:') mkdirSync(path.dirname(filename), {recursive:true});
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if(version > 4) {db.close(); throw new Error('Database schema newer than this server');}
  if(version < 1) {
    db.exec('BEGIN IMMEDIATE');
    try {db.exec(readFileSync(new URL('./migrations/001_initial.sql',import.meta.url),'utf8')); db.exec('PRAGMA user_version=1; COMMIT');}
    catch(e) {db.exec('ROLLBACK'); db.close(); throw e;}
  }
  if(version < 2) {
    db.exec('BEGIN IMMEDIATE');
    try {db.exec(readFileSync(new URL('./migrations/002_game_enter.sql',import.meta.url),'utf8')); db.exec('PRAGMA user_version=2; COMMIT');}
    catch(e) {db.exec('ROLLBACK'); db.close(); throw e;}
  }
  if(version < 3) {
    db.exec('BEGIN IMMEDIATE');
    try {db.exec(readFileSync(new URL('./migrations/003_telemetry.sql',import.meta.url),'utf8')); db.exec('PRAGMA user_version=3; COMMIT');}
    catch(e) {db.exec('ROLLBACK'); db.close(); throw e;}
  }
  if(version < 4) {
    db.exec('BEGIN IMMEDIATE');
    try {db.exec(readFileSync(new URL('./migrations/004_admin_access.sql',import.meta.url),'utf8')); db.exec('PRAGMA user_version=4; COMMIT');}
    catch(e) {db.exec('ROLLBACK'); db.close(); throw e;}
  }
  return db;
}
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {const result=fn(); db.exec('COMMIT'); return result;}
  catch(e) {db.exec('ROLLBACK'); throw e;}
}
