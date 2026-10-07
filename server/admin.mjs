import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {statistics,visitorDetails,gameDetails} from './stats.mjs';
import {hasAdminAccount,verifyAdminPassword,validAdminPassword,issueAdminSession,readAdminSession,revokeAdminSession,provisionAdmin} from './admin-auth.mjs';

const assets=new Map([
  ['/admin/',['../admin/index.html','text/html; charset=utf-8']],
  ['/admin/app.js',['../admin/app.js','text/javascript; charset=utf-8']],
  ['/admin/style.css',['../admin/style.css','text/css; charset=utf-8']],
]);
const loopback=new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);
const cookieName='gamehub_admin';
// Both frontends share these approved files, without exposing a directory.
for(const name of ['happyjump-cover','3d-runway-cover','gogodown-cover','solovs-cover','site-background']){
  assets.set(`/admin/assets/${name}.webp`,[`../portal/assets/${name}.webp`,'image/webp']);
}

function cookie(req) {
  return req.headers.cookie?.split(';').map(item=>item.trim()).find(item=>item.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
}

async function jsonBody(req) {
  if(req.headers['content-type']?.split(';')[0].trim()!=='application/json')throw Object.assign(new Error('请使用 JSON 请求'),{status:415});
  let length=0;const chunks=[];
  for await(const chunk of req){length+=chunk.length;if(length>4096)throw Object.assign(new Error('请求内容过大'),{status:413});chunks.push(chunk);}
  try {const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(value && typeof value==='object' && !Array.isArray(value))return value;}
  catch {}
  throw Object.assign(new Error('请求内容无效'),{status:400});
}

export function createAdminServer(db,{clock=Date.now}={}) {
  const failedLogins=new Map();
  return http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(req.method==='HEAD'?undefined:JSON.stringify(data));};
    const host=(req.headers.host||'').split(':')[0].toLowerCase();
    if(!loopback.has(req.socket.remoteAddress) || !['127.0.0.1','localhost'].includes(host))return send(403,{error:'管理入口仅允许本机访问'});
    if(!['GET','HEAD','POST'].includes(req.method))return send(405,{error:'不支持该请求方式'});
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/admin' && ['GET','HEAD'].includes(req.method)){res.writeHead(308,{Location:'/admin/'});return res.end();}
    try {
      if(req.method==='POST'){
        if(req.headers.origin!==`http://${req.headers.host}` || req.headers['sec-fetch-site']==='cross-site')return send(403,{error:'请求来源无效'});
      }
      if(pathname==='/admin/api/session' && req.method==='GET'){
        const session=readAdminSession(db,cookie(req),clock());
        return send(200,{authenticated:Boolean(session),setupRequired:!hasAdminAccount(db),csrfToken:session?.csrfToken||null});
      }
      if(pathname==='/admin/api/login' && req.method==='POST'){
        if(!hasAdminAccount(db))return send(503,{error:'请先在服务器终端设置管理员密码'});
        const now=clock(),key=req.socket.remoteAddress;
        const failures=failedLogins.get(key);
        if(failures && now-failures.since<15*60000 && failures.count>=5){res.setHeader('Retry-After','900');return send(429,{error:'尝试次数过多，请稍后再试'});}
        const body=await jsonBody(req);
        if(!await verifyAdminPassword(db,body.password)){
          const previous=failures && now-failures.since<15*60000?failures:{since:now,count:0};
          failedLogins.set(key,{since:previous.since,count:previous.count+1});
          return send(401,{error:'密码不正确'});
        }
        failedLogins.delete(key);
        const session=issueAdminSession(db,now);
        res.setHeader('Set-Cookie',`${cookieName}=${session.token}; Path=/admin/; HttpOnly; SameSite=Strict; Max-Age=${session.maxAge}`);
        return send(200,{authenticated:true,csrfToken:session.csrfToken});
      }
      const asset=assets.get(pathname);
      if(asset && ['GET','HEAD'].includes(req.method)){
        const body=await readFile(new URL(asset[0],import.meta.url));
        res.writeHead(200,{'Content-Type':asset[1]});
        return res.end(req.method==='HEAD'?undefined:body);
      }
      if(!pathname.startsWith('/admin/api/'))return send(404,{error:'未找到页面'});
      const session=readAdminSession(db,cookie(req),clock());
      if(!session)return send(401,{error:'请先登录管理后台'});
      if(req.method==='POST' && req.headers['x-gamehub-admin-csrf']!==session.csrfToken)return send(403,{error:'请求验证失败'});
      if(pathname==='/admin/api/summary' && ['GET','HEAD'].includes(req.method))return send(200,statistics(db,clock()));
      const user=pathname.match(/^\/admin\/api\/users\/([a-f0-9-]{36})$/i);
      if(user && req.method==='GET'){
        const data=visitorDetails(db,user[1]);return data?send(200,data):send(404,{error:'未找到游客'});
      }
      const game=pathname.match(/^\/admin\/api\/games\/([a-z0-9-]+)$/);
      if(game && req.method==='GET'){
        const data=gameDetails(db,game[1]);return data?send(200,data):send(404,{error:'未找到游戏'});
      }
      if(pathname==='/admin/api/logout' && req.method==='POST'){
        revokeAdminSession(db,cookie(req));
        res.setHeader('Set-Cookie',`${cookieName}=; Path=/admin/; HttpOnly; SameSite=Strict; Max-Age=0`);
        return send(200,{ok:true});
      }
      if(pathname==='/admin/api/change-password' && req.method==='POST'){
        const body=await jsonBody(req);
        if(!await verifyAdminPassword(db,body.currentPassword))return send(401,{error:'当前密码不正确'});
        if(!validAdminPassword(body.newPassword))return send(400,{error:'新密码需为 6–128 个字符'});
        if(body.newPassword===body.currentPassword)return send(400,{error:'新密码不能与当前密码相同'});
        await provisionAdmin(db,body.newPassword,{reset:true,clock});
        res.setHeader('Set-Cookie',`${cookieName}=; Path=/admin/; HttpOnly; SameSite=Strict; Max-Age=0`);
        return send(200,{ok:true});
      }
      return send(404,{error:'未找到接口'});
    }catch(error){
      if(!error.status)console.error('GameHub admin request failed:',error.message);
      return send(error.status||500,{error:error.status?error.message:'管理服务暂时不可用'});
    }
  });
}
