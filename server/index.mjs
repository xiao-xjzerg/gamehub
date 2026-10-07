import {pathToFileURL} from 'node:url';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createApp} from './app.mjs';
import {createAdminServer} from './admin.mjs';
export function start(dev=false) {
  const expected=readFileSync(new URL('../.node-version',import.meta.url),'utf8').trim();
  if(process.versions.node!==expected)throw new Error(`Please use Node ${expected}; current version is ${process.versions.node}`);
  const artifactRoot=fileURLToPath(new URL('../../',import.meta.url));
  if(!dev && existsSync(path.join(artifactRoot,'release-manifest.json'))){
    const database=process.env.GAMEHUB_DB;
    if(!database || !path.isAbsolute(database))throw new Error('Packaged production server requires an absolute GAMEHUB_DB path outside the release');
    const relative=path.relative(artifactRoot,path.resolve(database));
    if(!relative || !relative.startsWith('..') && !path.isAbsolute(relative))throw new Error('Production database must be outside the release directory');
  }
  const port=Number(process.env.PORT || (dev?4173:8001));
  const adminPort=Number(process.env.GAMEHUB_ADMIN_PORT || (dev?4174:8002));
  const app=createApp({dev,dbPath:process.env.GAMEHUB_DB,origin:process.env.GAMEHUB_ORIGIN,secureCookie:process.env.GAMEHUB_SECURE_COOKIE==='true',trustProxy:process.env.GAMEHUB_TRUST_PROXY==='true'});
  const admin=createAdminServer(app.db);
  app.server.listen(port,'127.0.0.1',()=>console.log(`GameHub: http://127.0.0.1:${app.server.address().port}/gamehub/`));
  admin.listen(adminPort,'127.0.0.1',()=>console.log(`GameHub admin (local only): http://127.0.0.1:${admin.address().port}/admin/`));
  let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;if(admin.listening)await new Promise(resolve=>admin.close(resolve));await app.close();};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);return {...app,adminServer:admin,close:stop};
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)start();
