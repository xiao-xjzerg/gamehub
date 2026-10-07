import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const git=(...args)=>execFileSync('git',['-C',root,...args],{windowsHide:true,maxBuffer:128*1024*1024,stdio:['ignore','pipe','pipe']});
const value=(...args)=>git(...args).toString('utf8').trim();
const command=process.argv[2] || 'staged';
const workingPolicy=JSON.parse(readFileSync(path.join(root,'.publish-policy.json'),'utf8'));
if(process.versions.node!==workingPolicy.nodeVersion)throw new Error(`Use Node ${workingPolicy.nodeVersion}`);
const normalize=url=>url.replace(/\.git$/,'').replace(/\/$/,'');
function validatePolicy(policy){
 if(policy.schemaVersion!==1 || !Array.isArray(policy.files) || !Array.isArray(policy.directories))throw new Error('Invalid publication policy');
 for(const name of [...policy.files,...policy.directories]){
  if(!name || name.includes('\\') || name.split('/').some(p=>!p || p==='.' || p==='..') || name.startsWith('/') || name.includes(':'))throw new Error('Invalid policy path');
 }
}
function allowed(name,policy){
 const runtimeData=policy.project==='Solovs' && /^assets\/data\/(?:boss_config\.json|csv\/[^/]+\.csv)$/.test(name);
 if(name.includes('\\') || name.split('/').some(p=>!p || p==='.' || p==='..') || name.includes(':'))return false;
 if(/(?:^|\/)(?:\.git|\.agents|\.codex|node_modules|tests?|tmp|qa|coverage|test-results|playwright-report|backups|dist|artifacts|_packs|2D_version)(?:\/|$)/i.test(name))return false;
 if(/prompt|(?:^|\/)(?:agent|agents|plan|release_design)\.md$|(?:^|\/)DEMO\.html$|\.(?:sqlite(?:3)?(?:-.*)?|db(?:-.*)?|xlsx?|pem|key|pfx|p12|zip|log|tmp|temp|pyc)$/i.test(name))return false;
 if(/(?:^|\/)\.env(?:\..*)?$/i.test(name) && name!=='.env.example')return false;
 if(/(?:^|\/)data(?:\/|$)/i.test(name) && !runtimeData)return false;
 if(policy.project==='gamehub' && /\.(?:png|jpe?g|webp|avif|gif|svg|ico|bmp|tiff?|mp3|wav|ogg|mp4|webm|woff2?|ttf|otf)$/i.test(name) && !policy.artworkFiles?.includes(name))return false;
 return policy.files.includes(name) || policy.directories.some(dir=>name.startsWith(dir+'/'));
}
function secret(data){
 if(data.subarray(0,16).toString()==='SQLite format 3\0')return true;
 const text=data.toString('utf8');
 return /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(text) ||
 /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9_-]{40,})\b/.test(text) ||
 /https?:\/\/[^\s/:]+:[^\s/@]+@[^\s/]+/.test(text);
}
const scannedBlobs=new Set();
function audit(rows,policy,label){
 validatePolicy(policy);
 const entries=rows.split('\0').filter(Boolean).map(row=>{
  const separator=row.indexOf('\t'),info=row.slice(0,separator).split(' '),name=row.slice(separator+1);
  const mode=info[0],sha=info[1]==='blob'?info[2]:info[1];
  if(!['100644','100755'].includes(mode) || info.at(-1)==='1' || info.at(-1)==='2' || info.at(-1)==='3')throw new Error(`Unsupported index entry: ${label}/${name}`);
  if(!allowed(name,policy))throw new Error(`Outside publication allowlist: ${label}/${name}`);
  return {name,sha};
 });
 if(new Set(entries.map(e=>e.name.toLowerCase())).size!==entries.length)throw new Error('Case-colliding publication paths');
 for(const required of ['.node-version','README.md'])if(!entries.some(e=>e.name===required))throw new Error(`Missing ${required}`);
 const unique=[...new Set(entries.map(e=>e.sha).filter(sha=>!scannedBlobs.has(sha)))];
 if(unique.length){
  const bytes=execFileSync('git',['-C',root,'cat-file','--batch'],{input:unique.join('\n')+'\n',windowsHide:true,maxBuffer:128*1024*1024});
  let offset=0;
  for(const sha of unique){
   const end=bytes.indexOf(10,offset),header=bytes.subarray(offset,end).toString('utf8').split(' '),size=Number(header[2]);
   if(header[0]!==sha || header[1]!=='blob' || !Number.isSafeInteger(size))throw new Error('Invalid Git blob response');
   const data=bytes.subarray(end+1,end+1+size);
   if(secret(data))throw new Error(`Credential/database content blocked: ${label}/${entries.find(e=>e.sha===sha).name}`);
   offset=end+1+size+1;scannedBlobs.add(sha);
  }
 }
 const version=entries.find(e=>e.name==='.node-version');
 if(value('cat-file','blob',version.sha)!==policy.nodeVersion)throw new Error('Node version differs from publication policy');
 return entries.length;
}
function policyAt(commit,fallback){
 try{return JSON.parse(value('show',`${commit}:.publish-policy.json`));}
 catch(error){if(value('ls-tree','--name-only',commit,'.publish-policy.json'))throw error;return fallback;}
}
function auditCommit(commit,fallback){
 return audit(git('ls-tree','-rz','--full-tree',commit).toString('utf8'),policyAt(commit,fallback),commit.slice(0,12));
}
if(command==='install'){
 validatePolicy(workingPolicy);
 git('config','--local','core.hooksPath','.githooks');
 console.log('Publication checks installed for this repository.');
}else if(command==='staged'){
 const staged=JSON.parse(value('show',':.publish-policy.json'));
 const count=audit(git('ls-files','--stage','-z').toString('utf8'),staged,'index');
 console.log(`Publication check passed: ${count} staged files.`);
}else if(command==='head'){
 const commit=value('rev-parse','HEAD');
 console.log(`Publication check passed: ${auditCommit(commit,workingPolicy)} committed files.`);
}else if(command==='pre-push'){
 const headPolicy=policyAt('HEAD',workingPolicy);
 if(normalize(process.argv[4] || '')!==normalize(headPolicy.repository))throw new Error('Push destination differs from publication policy');
 const input=readFileSync(0,'utf8').trim(),commits=new Set();
 for(const row of input?input.split(/\r?\n/):[]){
  const [localRef,localSha,remoteRef,remoteSha]=row.split(/\s+/);
  if(!/^[a-f0-9]{40}$/.test(localSha || '') || !/^[a-f0-9]{40}$/.test(remoteSha || ''))throw new Error('Invalid push input');
  if(localSha==='0'.repeat(40))throw new Error('Branch deletion requires a separate reviewed operation');
  if(remoteRef!=='refs/heads/main' || localRef!=='refs/heads/main')throw new Error('Publish the main branch only');
  let range=[localSha];
  if(remoteSha!=='0'.repeat(40)){
   try{git('cat-file','-e',`${remoteSha}^{commit}`);}catch{throw new Error('Fetch the destination branch before pushing');}
   git('merge-base','--is-ancestor',remoteSha,localSha);
   range=[`${remoteSha}..${localSha}`];
  }
  for(const sha of value('rev-list',...range).split(/\r?\n/).filter(Boolean))commits.add(sha);
  commits.add(localSha);
 }
 for(const commit of commits)auditCommit(commit,headPolicy);
 console.log(`Publication push check passed: ${commits.size} commit(s).`);
}else throw new Error('Usage: node scripts/check-public.mjs install|staged|head|pre-push');
