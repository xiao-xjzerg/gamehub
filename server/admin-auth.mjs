import {createHash,randomBytes,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {transaction} from './store.mjs';

const scrypt=promisify(scryptCallback);
const sessionMs=8*3600000;
const sha256=value=>createHash('sha256').update(value).digest('hex');

export function validAdminPassword(value) {
  return typeof value==='string' && [...value].length>=6 && [...value].length<=128 && !value.includes('\0');
}

async function derive(password,salt) {
  return (await scrypt(password,Buffer.from(salt,'hex'),64,{N:16384,r:8,p:1,maxmem:64*1024*1024})).toString('hex');
}

export function hasAdminAccount(db) {
  return Boolean(db.prepare('SELECT 1 FROM admin_account WHERE id=1').get());
}

export async function verifyAdminPassword(db,password) {
  const account=db.prepare('SELECT salt,password_hash FROM admin_account WHERE id=1').get();
  if(!account || typeof password!=='string' || password.length>512)return false;
  const candidate=Buffer.from(await derive(password,account.salt),'hex');
  return timingSafeEqual(candidate,Buffer.from(account.password_hash,'hex'));
}

export async function provisionAdmin(db,password,{reset=false,clock=Date.now}={}) {
  if(!validAdminPassword(password))throw new Error('Password must contain 6–128 characters');
  if(hasAdminAccount(db) && !reset)throw new Error('Admin account already exists');
  const salt=randomBytes(16).toString('hex');
  const hash=await derive(password,salt);
  transaction(db,()=>{
    if(hasAdminAccount(db)){
      if(!reset)throw new Error('Admin account already exists');
      db.prepare('UPDATE admin_account SET salt=?,password_hash=?,updated_at=? WHERE id=1').run(salt,hash,clock());
    }else{
      db.prepare('INSERT INTO admin_account(id,salt,password_hash,created_at,updated_at) VALUES(1,?,?,?,?)').run(salt,hash,clock(),clock());
    }
    db.prepare('DELETE FROM admin_sessions').run();
  });
}

export function issueAdminSession(db,now=Date.now()) {
  const token=randomBytes(32).toString('hex');
  db.prepare('DELETE FROM admin_sessions WHERE expires_at<=?').run(now);
  db.prepare('INSERT INTO admin_sessions(token_hash,created_at,expires_at) VALUES(?,?,?)').run(sha256(token),now,now+sessionMs);
  return {token,csrfToken:sha256(`csrf:${token}`),maxAge:sessionMs/1000};
}

export function readAdminSession(db,token,now=Date.now()) {
  if(typeof token!=='string' || !/^[a-f0-9]{64}$/.test(token))return null;
  const session=db.prepare('SELECT expires_at FROM admin_sessions WHERE token_hash=?').get(sha256(token));
  return session && session.expires_at>now?{csrfToken:sha256(`csrf:${token}`)}:null;
}

export function revokeAdminSession(db,token) {
  if(typeof token==='string' && /^[a-f0-9]{64}$/.test(token))db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(sha256(token));
}

export function revokeAllAdminSessions(db) {db.prepare('DELETE FROM admin_sessions').run();}
