import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {inventory,fileSetHash,filesUnder,sha256,safeRelative} from './release-lib.mjs';

export async function verifyRelease(directory) {
  const manifest=JSON.parse(await readFile(path.join(directory,'release-manifest.json'),'utf8'));
  if(manifest.schemaVersion!==1 || !['local-candidate','published-source-verified'].includes(manifest.status) || manifest.nodeVersion!=='26.10.0' || !manifest.artworkDistributionConfirmed || manifest.database?.included!==false || !['MIT','UNLICENSED'].includes(manifest.codeLicense))throw new Error('Artifact metadata is incomplete');
  const files=await inventory(directory);
  if(JSON.stringify(files)!==JSON.stringify(manifest.files) || fileSetHash(files)!==manifest.fileSetSha256 || files.reduce((sum,f)=>sum+f.bytes,0)!==manifest.totalBytes)throw new Error('Artifact file inventory/hash mismatch');
  const paths=new Set(files.map(f=>f.path));
  if(new Set([...paths].map(n=>n.toLowerCase())).size!==paths.size)throw new Error('Case-colliding artifact paths');
  const ids=['happyjump','3d-runway','gogodown'];
  const selectedIds=manifest.games.map(g=>g.id).sort().join();
  if(![[...ids].sort().join(),[...ids,'solovs'].sort().join()].includes(selectedIds) || !/^[a-f0-9]{40}$/.test(manifest.hub?.commit || ''))throw new Error('Source commits/game set do not match this release');
  for(const game of manifest.games) {
    if(!/^[a-f0-9]{40}$/.test(game.commit) || !game.repository || !paths.has(`public/gamehub/play/${game.id}/index.html`))throw new Error(`Unpinned game: ${game.id}`);
    if(manifest.codeLicense==='MIT' && !paths.has(`public/gamehub/play/${game.id}/LICENSE`))throw new Error(`Declared game license is missing: ${game.id}`);
    if(fileSetHash(files.filter(f=>f.path.startsWith(`public/gamehub/play/${game.id}/`)))!==game.fileSetSha256)throw new Error(`Game digest mismatch: ${game.id}`);
  }
  if([...paths].some(n=>/^(?:public\/gamehub\/play\/)([^/]+)\//.test(n) && !manifest.games.some(g=>g.id===n.split('/')[3]) || /(?:^|\/)(?:tests?|tools|2D_version|assets\/source)\//i.test(n) || /prompt|DEMO\.html/i.test(n)))throw new Error('Development/deferred files must not be packaged');
  for(const essential of ['app/server/index.mjs','app/server/migrations/004_admin_access.sql','app/admin/index.html','public/gamehub/index.html'])if(!paths.has(essential))throw new Error(`Missing runtime file: ${essential}`);
  if(manifest.codeLicense==='MIT' && !paths.has('app/LICENSE'))throw new Error('Declared project license is missing');
  const catalog=JSON.parse(await readFile(path.join(directory,'app/shared/games.json'),'utf8'));
  if(catalog.some(g=>'source' in g) || catalog.filter(g=>g.available!==false).map(g=>g.id).sort().join()!==selectedIds || catalog.find(g=>g.id==='solovs')?.ranking!==null || catalog.filter(g=>g.available===false).map(g=>g.id).sort().join()!==(manifest.deferredGames || []).map(g=>g.id).sort().join())throw new Error('Artifact catalog/source availability or ranking state mismatch');
  function checkReference(from, ref) {
    if(!ref || /^(?:data:|#|mailto:)/.test(ref))return;
    if(/^(?:https?:)?\/\//.test(ref))throw new Error(`External runtime dependency: ${from}`);
    const url=new URL(ref,`http://release.local/${from.replace('public/','')}`);
    if(url.pathname.startsWith('/gamehub/api/'))return;
    const target='public'+decodeURIComponent(url.pathname);
    if(!paths.has(target) && !paths.has(target.replace(/\/$/,'')+'/index.html'))throw new Error(`Missing/case-mismatched reference: ${from} -> ${ref}`);
  }
  for(const name of paths) {
    if(!name.startsWith('public/') || !/\.(?:html|css|js)$/.test(name) || name.includes('/vendor/'))continue;
    const text=await readFile(path.join(directory,name),'utf8');
    if(/https?:\/\//.test(text))throw new Error(`External URL remains in application runtime: ${name}`);
    if(name.endsWith('.html'))for(const match of text.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/g))checkReference(name,match[1]);
    if(name.endsWith('.css'))for(const match of text.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g))checkReference(name,match[1]);
    if(name.endsWith('.js')) {
      for(const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*)["']([^"']+)["']/g))checkReference(name,match[1]);
      // Audio filenames are literal configuration strings; model/texture placeholders are not loaded.
      const gameDocument=name.match(/^public\/gamehub\/play\/([^/]+)\//);
      for(const match of text.matchAll(/["'](assets\/sounds\/[^"']+\.(?:mp3|ogg|wav))["']/g))checkReference(gameDocument?`public/gamehub/play/${gameDocument[1]}/index.html`:name,match[1]);
    }
  }
  for(const asset of manifest.vendor) {
    safeRelative(asset.name);
    if(sha256(await readFile(path.join(directory,'public/gamehub/assets/vendor',asset.name)))!==asset.sha256)throw new Error(`Vendor digest mismatch: ${asset.name}`);
  }
  return {status:manifest.status,files:files.length,totalBytes:manifest.totalBytes,fileSetSha256:manifest.fileSetSha256};
}
if(import.meta.main) {
  if(process.argv.length!==3)throw new Error('Usage: node scripts/verify-release.mjs ARTIFACT_DIRECTORY');
  console.log(JSON.stringify(await verifyRelease(path.resolve(process.argv[2])),null,2));
}
