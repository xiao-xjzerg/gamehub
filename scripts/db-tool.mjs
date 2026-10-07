import {DatabaseSync, backup} from 'node:sqlite';
import {constants} from 'node:fs';
import {mkdir, stat, copyFile, readFile, writeFile, realpath, rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {sha256} from './release-lib.mjs';

const tables=['guests','visits','game_pages','page_sessions','runs','scores','events','heartbeats','admin_account','admin_sessions'];
export function inspectDatabase(filename) {
  const db=new DatabaseSync(filename,{readOnly:true});
  try {
    const integrity=db.prepare('PRAGMA integrity_check').all();
    if (integrity.length!==1 || integrity[0].integrity_check!=='ok') throw new Error('Database integrity check failed');
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Foreign-key check failed');
    const counts={};
    for(const name of tables) if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)) counts[name]=db.prepare(`SELECT count(*) n FROM ${name}`).get().n;
    const scoresByGame=db.prepare('SELECT r.game_id gameId,count(*) count FROM scores s JOIN runs r ON r.id=s.run_id GROUP BY r.game_id ORDER BY r.game_id').all().map(row=>({...row}));
    return {schemaVersion:db.prepare('PRAGMA user_version').get().user_version,counts,scoresByGame};
  } finally {db.close();}
}
async function missing(filename) {
  try {await stat(filename);throw new Error(`Destination already exists: ${filename}`);} catch(e){if(e.code!=='ENOENT')throw e;}
}
export async function backupDatabase(source,target) {
  source=await realpath(source);target=path.resolve(target);
  if (source===target) throw new Error('Backup cannot overwrite the source');
  await missing(target);await missing(target+'.json');
  await mkdir(path.dirname(target),{recursive:true});
  const staging=`${target}.backup-${randomUUID()}`;
  try {
    const db=new DatabaseSync(source,{readOnly:true});
    try {await backup(db,staging);} finally {db.close();}
    const report=inspectDatabase(staging);
    const metadata={schemaVersion:1,createdAt:new Date().toISOString(),sha256:sha256(await readFile(staging)),database:report};
    await copyFile(staging,target,constants.COPYFILE_EXCL);
    await writeFile(target+'.json',JSON.stringify(metadata,null,2)+'\n',{flag:'wx',mode:0o600});
    return report;
  } finally {
    for(const suffix of ['', '-wal', '-shm'])await rm(staging+suffix,{force:true});
  }
}
export async function restoreDatabase(source,target) {
  source=await realpath(source);target=path.resolve(target);
  // Restores are deliberately limited to a new path. Existing databases are never replaced.
  for(const suffix of ['', '-wal', '-shm']) await missing(target+suffix);
  const metadata=JSON.parse(await readFile(source+'.json','utf8'));
  if(metadata.schemaVersion!==1 || metadata.sha256!==sha256(await readFile(source)))throw new Error('Backup checksum mismatch');
  const report=inspectDatabase(source);
  if(JSON.stringify(report)!==JSON.stringify(metadata.database))throw new Error('Backup counts/schema do not match metadata');
  await mkdir(path.dirname(target),{recursive:true});
  const staging=`${target}.restore-${randomUUID()}`;
  try {
    await copyFile(source,staging,constants.COPYFILE_EXCL);
    if(sha256(await readFile(staging))!==metadata.sha256 || JSON.stringify(inspectDatabase(staging))!==JSON.stringify(report))throw new Error('Restored database verification failed');
    // copyFile EXCL also protects against a destination created after the initial check.
    await copyFile(staging,target,constants.COPYFILE_EXCL);
  } finally {
    for(const suffix of ['', '-wal', '-shm'])await rm(staging+suffix,{force:true});
  }
  return report;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [action,source,target,...rest]=process.argv.slice(2);
  if(rest.length || !source || (action==='inspect'?Boolean(target):!target) || !['inspect','backup','restore'].includes(action))throw new Error('Usage: node scripts/db-tool.mjs inspect DATABASE | backup DATABASE NEW_BACKUP | restore BACKUP NEW_DATABASE');
  console.log(JSON.stringify(action==='inspect'?inspectDatabase(source):await (action==='backup'?backupDatabase:restoreDatabase)(source,target),null,2));
}
