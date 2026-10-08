import {mkdir, readFile, writeFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {blob, committedFiles, requireCleanHead, inventory, fileSetHash, git, noPathOverlap, parseOptions, sha256, safeRelative} from './release-lib.mjs';
import {verifyRelease} from './verify-release.mjs';

const ids=['happyjump','3d-runway','gogodown'];
const rewrites=new Map([
 ['https://cdn.jsdelivr.net/npm/three@0.162.0/build/three.module.js','/gamehub/assets/vendor/three-0.162.0.module.js'],
 ['https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js','/gamehub/assets/vendor/three-0.128.0.min.js'],
 ['https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4','/gamehub/assets/vendor/tailwind-browser-4.3.3.js']
]);
const hubRuntime=name=>/^(?:server|admin|portal|shared|deploy|docs|assets\/vendor)\//.test(name) ||
 ['package.json','.node-version','.env.example','README.md','LICENSE','THIRD_PARTY_NOTICES.md','scripts/admin-password.mjs','scripts/db-tool.mjs','scripts/release-lib.mjs','scripts/verify-release.mjs'].includes(name);

export async function buildRelease(input, output) {
  if(input.schemaVersion!==1 || input.artworkDistributionConfirmed!==true || !['MIT','UNLICENSED'].includes(input.codeLicense) || !['pending','published'].includes(input.publication))throw new Error('Complete source lock and distribution metadata before building');
  const sources=[input.hub,...input.games];
  const selectedIds=input.games.map(g=>g.id).sort().join();
  if(![[...ids].sort().join(),[...ids,'solovs'].sort().join()].includes(selectedIds))throw new Error('Release requires the three ranked games and optionally Solovs');
  for(const item of sources) {
    if(!item.path || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?$/.test(item.repository || '') || !/^[\w./-]+$/.test(item.branch || ''))throw new Error('Specify local repository, GitHub URL and branch for every source');
    requireCleanHead(item.path,item.commit);
    committedFiles(item.path,item.commit);
    if(input.publication==='published') {
      const remote=git(item.path,'ls-remote',item.repository,`refs/heads/${item.branch}`).toString().trim().split(/\s/)[0];
      if(remote!==item.commit)throw new Error(`Published branch differs from release commit: ${item.id || 'gamehub'}`);
    }
    await noPathOverlap(item.path,output);
  }
  const hub=input.hub;
  const expectedNode=blob(hub.path,hub.commit,'.node-version').toString().trim();
  if(process.versions.node!==expectedNode)throw new Error(`Build with Node ${expectedNode}, not ${process.versions.node}`);
  output=path.resolve(output);
  await mkdir(path.dirname(output),{recursive:true});
  for(const item of sources)await noPathOverlap(item.path,output);
  await mkdir(output); // Never replace an existing artifact.
  const put=async(name,data)=>{safeRelative(name);const target=path.join(output,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,data,{flag:'wx'});};
  await put('release-manifest.json',JSON.stringify({schemaVersion:1,status:'incomplete'})+'\n');
  const hubFiles=committedFiles(hub.path,hub.commit);
  for(const name of hubFiles.filter(hubRuntime))await put(`app/${name}`,blob(hub.path,hub.commit,name));
  const vendor=JSON.parse(blob(hub.path,hub.commit,'assets/vendor/lock.json'));
  const expectedVendor=new Set([...rewrites.values()].map(url=>url.split('/').at(-1)));
  for(const entry of vendor.files) {
    safeRelative(entry.name);
    const data=blob(hub.path,hub.commit,`assets/vendor/${entry.name}`);
    if(sha256(data)!==entry.sha256 || data.length!==entry.bytes)throw new Error(`Vendor checksum mismatch: ${entry.name}`);
    if(entry.name.endsWith('.js'))expectedVendor.delete(entry.name);
    await put(`public/gamehub/assets/vendor/${entry.name}`,data);
  }
  if(expectedVendor.size)throw new Error('Required third-party script is missing');
  for(const name of hubFiles.filter(n=>n.startsWith('portal/'))) {
    const relative=name.slice('portal/'.length);
    const dest=relative==='index.html'?'public/gamehub/index.html':relative.startsWith('assets/')?`public/gamehub/${relative}`:`public/gamehub/assets/${relative}`;
    await put(dest,blob(hub.path,hub.commit,name));
  }
  const catalog=JSON.parse(blob(hub.path,hub.commit,'shared/games.json'));
  if(catalog.find(g=>g.id==='solovs')?.available===true && !input.games.some(g=>g.id==='solovs'))throw new Error('Enabled Solovs must have a pinned source in this release');
  for(const game of input.games) {
    const spec=catalog.find(g=>g.id===game.id);
    if(!spec?.include || !spec.entry || (game.id==='solovs'?spec.ranking!==null:!spec.ranking))throw new Error(`Missing game rules or invalid ranking state: ${game.id}`);
    const candidates=committedFiles(game.path,game.commit);
    const selected=candidates.filter(n=>spec.include.some(p=>n===p || n.startsWith(p+'/')));
    if(!selected.includes(spec.entry))throw new Error(`Missing committed entry: ${game.id}`);
    for(const name of selected) {
      let data=blob(game.path,game.commit,name);
      if(/\.(?:html|js|css)$/.test(name)) {
        let text=data.toString('utf8');
        for(const [from,to] of rewrites)text=text.replaceAll(from,to);
        data=Buffer.from(text);
      }
      await put(`public/gamehub/play/${game.id}/${name}`,data);
    }
    for(const name of candidates.filter(n=>n.startsWith('third_party/') || /^(?:LICENSE(?:\.[\w-]+)?|NOTICE(?:\.[\w-]+)?|THIRD_PARTY_NOTICES\.md)$/.test(n)))await put(`public/gamehub/play/${game.id}/${name}`,blob(game.path,game.commit,name));
    if(input.codeLicense==='MIT' && !candidates.includes('LICENSE'))throw new Error(`Declared game license is missing: ${game.id}`);
    delete spec.source;spec.available=true;
  }
  for(const deferred of catalog.filter(g=>!input.games.some(item=>item.id===g.id))){
    delete deferred.source;deferred.include=[];deferred.available=false;
  }
  await writeFile(path.join(output,'app/shared/games.json'),JSON.stringify(catalog,null,2)+'\n');
  const files=await inventory(output);
  const games=input.games.map(g=>{
    const spec=catalog.find(item=>item.id===g.id);
    const gameFiles=files.filter(f=>f.path.startsWith(`public/gamehub/play/${g.id}/`));
    return {id:g.id,repository:g.repository,branch:g.branch,commit:g.commit,mode:spec.mode,rulesVersion:spec.rulesVersion,fileSetSha256:fileSetHash(gameFiles)};
  });
  const manifest={schemaVersion:1,status:input.publication==='published'?'published-source-verified':'local-candidate',nodeVersion:expectedNode,hub:{repository:hub.repository,branch:hub.branch,commit:hub.commit},games,deferredGames:catalog.filter(g=>g.available===false).map(g=>({id:g.id,reason:'Development in progress'})),vendor:vendor.files,artworkDistributionConfirmed:true,codeLicense:input.codeLicense,database:{included:false,schemaVersion:4,requiresExternalPersistentPath:true},fileSetSha256:fileSetHash(files),totalBytes:files.reduce((sum,f)=>sum+f.bytes,0),files};
  await writeFile(path.join(output,'release-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  try {await verifyRelease(output);}catch(error){
    await writeFile(path.join(output,'release-manifest.json'),JSON.stringify({schemaVersion:1,status:'incomplete',reason:'Artifact verification failed'})+'\n');
    throw error;
  }
  return {directory:output,status:manifest.status,fileSetSha256:manifest.fileSetSha256,totalBytes:manifest.totalBytes,files:files.length};
}
if(import.meta.main) {
  const options=parseOptions(process.argv.slice(2),['lock','output']);
  if(!options.lock || !options.output)throw new Error('Usage: node scripts/build-release.mjs --lock SOURCE_LOCK.json --output NEW_DIRECTORY');
  const input=JSON.parse(await readFile(options.lock,'utf8'));
  for(const item of [input.hub,...input.games])item.path=path.resolve(path.dirname(path.resolve(options.lock)),item.path);
  console.log(JSON.stringify(await buildRelease(input,options.output),null,2));
}
