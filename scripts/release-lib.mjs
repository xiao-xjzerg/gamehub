import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile, readdir, lstat, realpath} from 'node:fs/promises';
import path from 'node:path';

export const sha256 = data => createHash('sha256').update(data).digest('hex');
export function git(directory, ...args) {
  return execFileSync('git', ['-C', directory, ...args], {maxBuffer:64*1024*1024, windowsHide:true, stdio:['ignore','pipe','pipe']});
}
export function safeRelative(name) {
  if (!name || name.includes('\\') || name.includes('\0') || path.posix.isAbsolute(name) || name.split('/').some(p=>!p || p==='.' || p==='..') || /^[a-z]:/i.test(name)) throw new Error(`Unsafe file path: ${name}`);
  return name;
}
export function sensitivePath(name) {
  return name.split('/').some(p=>/^(?:\.git|\.agents|\.codex|node_modules|data|backups|tmp|coverage|test-results|playwright-report)$/i.test(p)) ||
    /(?:^|\/)(?:\.env(?:\..*)?|id_rsa|id_ed25519)$/i.test(name) && !name.endsWith('/.env.example') && name!=='.env.example' ||
    /\.(?:sqlite(?:3)?(?:-.*)?|db(?:-.*)?|pem|key|log|pfx|p12)$/i.test(name);
}
export function secretContent(data) {
  if (data.subarray(0,16).toString()==='SQLite format 3\0') return 'SQLite database';
  const text=data.toString('utf8');
  if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(text)) return 'private key';
  if (/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9_-]{40,})\b/.test(text)) return 'credential pattern';
  if (/https?:\/\/[^\s/:]+:[^\s/@]+@[^\s/]+/.test(text)) return 'credential in URL';
  return null;
}
export function committedFiles(directory, commit) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Use a full 40-character commit SHA');
  git(directory,'cat-file','-e',`${commit}^{commit}`);
  const paths=git(directory,'ls-tree','-rz','--full-tree',commit).toString('utf8').split('\0').filter(Boolean).map(row=>{
    const [info,name]=row.split('\t');
    if (!/^100(?:644|755) blob /.test(info)) throw new Error(`Symlink/submodule is not supported: ${name}`);
    safeRelative(name);
    return name;
  });
  if (new Set(paths.map(n=>n.toLowerCase())).size!==paths.length) throw new Error('Case-colliding filenames cannot be released');
  return paths.sort();
}
export function requireCleanHead(directory, commit) {
  if (git(directory,'rev-parse','HEAD').toString().trim()!==commit) throw new Error(`HEAD does not match pinned commit: ${directory}`);
  if (git(directory,'status','--porcelain','--untracked-files=all').length) throw new Error(`Commit or move untracked/modified files before releasing: ${directory}`);
}
export function blob(directory, commit, name) {
  const data=git(directory,'show',`${commit}:${safeRelative(name)}`);
  if (sensitivePath(name) || secretContent(data)) throw new Error(`Sensitive file cannot enter a release: ${name}`);
  return data;
}
export async function filesUnder(directory) {
  const result=[];
  async function walk(relative='') {
    for (const entry of await readdir(path.join(directory,relative),{withFileTypes:true})) {
      const name=relative?`${relative}/${entry.name}`:entry.name;
      safeRelative(name);
      if (entry.isSymbolicLink()) throw new Error(`Symlink in artifact: ${name}`);
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile()) result.push(name);
      else throw new Error(`Unsupported artifact entry: ${name}`);
    }
  }
  await walk();
  return result.sort();
}
export async function inventory(directory) {
  const items=[];
  for (const name of await filesUnder(directory)) {
    if (name==='release-manifest.json') continue;
    const data=await readFile(path.join(directory,name));
    if (sensitivePath(name) || secretContent(data)) throw new Error(`Sensitive content in artifact: ${name}`);
    items.push({path:name,bytes:data.length,sha256:sha256(data)});
  }
  return items;
}
export function fileSetHash(files) {
  return sha256(JSON.stringify(files));
}
export function parseOptions(args, allowed) {
  const out={};
  for (let i=0;i<args.length;i+=2) {
    const key=args[i]?.replace(/^--/,'');
    if (!args[i]?.startsWith('--') || !allowed.includes(key) || !args[i+1] || args[i+1].startsWith('--') || key in out) throw new Error(`Invalid option: ${args[i]}`);
    out[key]=args[i+1];
  }
  return out;
}
export async function noPathOverlap(a,b) {
  const resolved=await realpath(a);let target=path.resolve(b);
  try {target=path.join(await realpath(path.dirname(target)),path.basename(target));}catch(e){if(e.code!=='ENOENT')throw e;}
  const rel=path.relative(resolved,target);
  if (!rel || !rel.startsWith('..') && !path.isAbsolute(rel)) throw new Error('Output must be outside the source repository');
  try { if ((await lstat(target)).isSymbolicLink()) throw new Error('Output cannot be a symlink'); } catch(e) { if(e.code!=='ENOENT')throw e; }
}
