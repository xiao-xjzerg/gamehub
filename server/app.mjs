import http from 'node:http';
import {randomBytes, randomUUID, createHash} from 'node:crypto';
import {readFile, realpath, stat} from 'node:fs/promises';
import path from 'node:path';
import {isIP} from 'node:net';
import {fileURLToPath} from 'node:url';
import {openStore, transaction} from './store.mjs';
import {games, publicGames, gameFor} from './catalog.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(status,code,message)=>{throw Object.assign(new Error(message),{status,code});};
const uuid=value=>typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.mp3':'audio/mpeg','.wav':'audio/wav','.ogg':'audio/ogg','.tmx':'application/xml','.tsx':'application/xml','.glb':'model/gltf-binary'};
function metricsFor(game,value) {
  const fields=game.ranking?.filter(([n])=>!['acceptedAt','id'].includes(n)).map(([n])=>n) || [];
  if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).length!==fields.length) fail(400,'INVALID_METRICS','成绩字段不完整或包含未知字段');
  const result={};
  for(const field of fields) {
    const n=value[field], time=['time','duration'].includes(field);
    if(typeof n!=='number' || !Number.isFinite(n) || n<0 || n>(time?86400:100000000) || (!time && !Number.isSafeInteger(n)) || (field==='level' && n<1)) fail(400,'INVALID_METRICS',`成绩字段 ${field} 超出允许范围`);
    result[field]=time?Math.round(n*(field==='time'?10:1000))/(field==='time'?10:1000):n;
  }
  return result;
}
async function jsonBody(req) {
  if(req.headers['content-type']?.split(';')[0].trim()!=='application/json') fail(415,'JSON_REQUIRED','请使用 application/json');
  let size=0; const chunks=[];
  for await(const chunk of req) {size+=chunk.length;if(size>8192)fail(413,'BODY_TOO_LARGE','请求内容过大');chunks.push(chunk);}
  try {const value=JSON.parse(Buffer.concat(chunks).toString());if(!value || typeof value!=='object' || Array.isArray(value))throw new Error();return value;}
  catch {fail(400,'INVALID_JSON','JSON 格式无效');}
}
export function createApp({dbPath=path.resolve(root,'../data/gamehub.sqlite'),dev=false,gameRoot=path.resolve(root,'../public/gamehub/play'),origin,secureCookie=false,trustProxy=false,clock=Date.now,rateLimit=180}={}) {
  const db=openStore(dbPath),buckets=new Map();
  const query=(sql,...params)=>db.prepare(sql).get(...params);
  const run=(sql,...params)=>db.prepare(sql).run(...params);
  function visitorIp(req) {
    const direct=req.socket.remoteAddress?.replace(/^::ffff:/,'') || null;
    const forwarded=req.headers['x-real-ip'];
    if(trustProxy && ['127.0.0.1','::1'].includes(direct))return typeof forwarded==='string' && isIP(forwarded.trim())?forwarded.trim():null;
    return direct && isIP(direct)?direct:null;
  }
  function event(guest,visit,name,runId=null){run('INSERT INTO events(guest_id,visit_id,run_id,name,occurred_at) VALUES(?,?,?,?,?)',guest,visit,runId,name,clock());}
  function identity(req,res,create=false) {
    const token=req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('gamehub_guest='))?.slice(14);
    let raw=token,guest=token && /^[a-f0-9]{64}$/.test(token)?query('SELECT * FROM guests WHERE token_hash=?',hash(token)):null;
    if(!guest) {
      if(!create)fail(401,'GUEST_REQUIRED','请先初始化游客身份');
      raw=randomBytes(32).toString('hex');guest={id:randomUUID(),nickname:null};
      run('INSERT INTO guests(id,token_hash,created_at,last_seen) VALUES(?,?,?,?)',guest.id,hash(raw),clock(),clock());
      res.setHeader('Set-Cookie',`gamehub_guest=${raw}; Path=/gamehub/; HttpOnly; SameSite=Lax; Max-Age=31536000${secureCookie?'; Secure':''}`);
    }
    if(req.method==='POST' && req.headers['x-gamehub-csrf']!==hash(`csrf:${raw}`))fail(403,'CSRF_REJECTED','身份校验失败，请刷新页面');
    let visit=query('SELECT * FROM visits WHERE guest_id=? ORDER BY last_seen DESC LIMIT 1',guest.id);
    const ip=visitorIp(req);
    if(!visit || clock()-visit.last_seen>=1800000) {visit={id:randomUUID()};run('INSERT INTO visits(id,guest_id,started_at,last_seen,first_ip,last_ip) VALUES(?,?,?,?,?,?)',visit.id,guest.id,clock(),clock(),ip,ip);event(guest.id,visit.id,'visit_start');}
    run('UPDATE visits SET last_seen=?,last_ip=COALESCE(?,last_ip) WHERE id=?',clock(),ip,visit.id);run('UPDATE guests SET last_seen=? WHERE id=?',clock(),guest.id);
    return {guest,visit,csrfToken:hash(`csrf:${raw}`)};
  }
  function registerPage(guest,visit,body,kind) {
    if(!uuid(body.pageId) || (kind==='game' && !games.some(g=>g.id===body.gameId && g.available!==false)))
      fail(400,'INVALID_ENTRY','页面 ID 或游戏无效');
    const gameId=kind==='game'?body.gameId:null;
    const old=query('SELECT * FROM page_sessions WHERE page_id=?',body.pageId);
    if(old) {
      if(old.guest_id!==guest.id || old.kind!==kind || old.game_id!==gameId)
        fail(409,'IDEMPOTENCY_CONFLICT','页面 ID 已用于其他进入记录');
      return [200,{pageId:old.page_id,replayed:true}];
    }
    const now=clock();
    run('INSERT INTO page_sessions(page_id,guest_id,visit_id,kind,game_id,entered_at) VALUES(?,?,?,?,?,?)',body.pageId,guest.id,visit.id,kind,gameId,now);
    if(kind==='game') {
      run('INSERT INTO game_pages(page_id,guest_id,visit_id,game_id,entered_at) VALUES(?,?,?,?,?)',body.pageId,guest.id,visit.id,gameId,now);
      event(guest.id,visit.id,'game_enter');
    }
    return [201,{pageId:body.pageId,replayed:false}];
  }
  async function staticFile(req,res,base,relative) {
    if(relative.includes('\\') || relative.split('/').some(s=>s.startsWith('.')))fail(404,'NOT_FOUND','未找到资源');
    try {
      const directory=await realpath(base),target=await realpath(path.resolve(directory,relative)),rel=path.relative(directory,target);
      if(rel.startsWith('..') || path.isAbsolute(rel) || !(await stat(target)).isFile())fail(404,'NOT_FOUND','未找到资源');
      res.setHeader('Content-Type',mime[path.extname(target)] || 'application/octet-stream');res.end(req.method==='HEAD'?undefined:await readFile(target));
    }catch(e){if(e.status)throw e;fail(404,'NOT_FOUND','未找到资源');}
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Cache-Control','no-store');
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    try {
      const url=new URL(req.url,'http://localhost'),p=url.pathname;
      if(p.startsWith('/gamehub/api/')) {
        const now=clock(),key=visitorIp(req) || req.socket.remoteAddress;
        if(buckets.size>10000){for(const [k,v] of buckets)if(now-v.since>=60000)buckets.delete(k);if(buckets.size>10000)fail(503,'BUSY','服务繁忙');}
        let bucket=buckets.get(key);if(!bucket || now-bucket.since>=60000){bucket={since:now,count:0};buckets.set(key,bucket);}
        if(++bucket.count>rateLimit){res.setHeader('Retry-After','60');fail(429,'RATE_LIMITED','请求过于频繁，请稍后再试');}
        if(!['GET','POST'].includes(req.method))fail(405,'METHOD_NOT_ALLOWED','不支持该请求方式');
        if(req.method==='POST') {
          const expected=origin || `http://127.0.0.1:${server.address().port}`;
          if((req.headers.origin && req.headers.origin!==expected) || req.headers['sec-fetch-site']==='cross-site')fail(403,'ORIGIN_REJECTED','不允许跨站提交');
        }
        if(p==='/gamehub/api/health' && req.method==='GET')return send(200,{ok:true});
        if(p==='/gamehub/api/games' && req.method==='GET')return send(200,{games:publicGames});
        if(p==='/gamehub/api/guest' && req.method==='GET') {
          const r=transaction(db,()=>identity(req,res,true));return send(200,{guestId:r.guest.id,nickname:r.guest.nickname,visitId:r.visit.id,csrfToken:r.csrfToken});
        }
        if(p==='/gamehub/api/pages' && req.method==='POST') {
          const body=await jsonBody(req);
          const output=transaction(db,()=>{
            const {guest,visit}=identity(req,res);
            if(body.kind!=='portal' && body.kind!=='game')fail(400,'INVALID_ENTRY','页面类型无效');
            return registerPage(guest,visit,body,body.kind);
          });return send(...output);
        }
        if(p==='/gamehub/api/entries' && req.method==='POST') {
          const body=await jsonBody(req);
          const output=transaction(db,()=>{
            const {guest,visit}=identity(req,res);
            return registerPage(guest,visit,body,'game');
          });return send(...output);
        }
        if(p==='/gamehub/api/heartbeats' && req.method==='POST') {
          const body=await jsonBody(req);
          const output=transaction(db,()=>{
            const {guest,visit}=identity(req,res);
            const page=uuid(body.pageId)?query('SELECT * FROM page_sessions WHERE page_id=?',body.pageId):null;
            if(!page || page.guest_id!==guest.id)fail(404,'PAGE_NOT_FOUND','页面记录不存在');
            const seq=body.seq,start=body.startedAt,end=body.endedAt;
            if(!Number.isSafeInteger(seq) || seq<1 || seq>1000000000 ||
               !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
               end<=start || end-start>20000 || typeof body.playing!=='boolean' ||
               (page.kind==='portal' && body.playing))
              fail(400,'INVALID_HEARTBEAT','计时区间无效');
            const prior=query('SELECT * FROM heartbeats WHERE page_id=? AND seq=?',body.pageId,seq);
            if(prior) {
              if(prior.client_start_at!==start || prior.client_end_at!==end || Boolean(prior.playing)!==body.playing)
                fail(409,'IDEMPOTENCY_CONFLICT','心跳序号已用于其他区间');
              return [200,{pageId:body.pageId,seq,replayed:true,recordedMs:prior.end_at-prior.start_at}];
            }
            if(seq<=page.last_seq)fail(409,'STALE_HEARTBEAT','心跳序号已过期');
            const now=clock();
            if(end<now-30000 || end>now+2000 || start<page.entered_at-2000 || start>now)
              fail(400,'INVALID_HEARTBEAT','计时区间超出允许范围');
            const recordedStart=Math.max(start,page.entered_at,page.last_end_at??page.entered_at,now-20000);
            const recordedEnd=Math.max(recordedStart,Math.min(end,now));
            run('INSERT INTO heartbeats(page_id,seq,guest_id,visit_id,client_start_at,client_end_at,start_at,end_at,playing,received_at) VALUES(?,?,?,?,?,?,?,?,?,?)',body.pageId,seq,guest.id,visit.id,start,end,recordedStart,recordedEnd,body.playing?1:0,now);
            run('UPDATE page_sessions SET last_seq=?,last_end_at=? WHERE page_id=?',seq,recordedEnd,body.pageId);
            return [201,{pageId:body.pageId,seq,replayed:false,recordedMs:recordedEnd-recordedStart}];
          });return send(...output);
        }
        const board=p.match(/^\/gamehub\/api\/leaderboards\/([^/]+)$/);
        if(board && req.method==='GET') {
          const game=games.find(g=>g.id===board[1]);if(!game)fail(404,'GAME_NOT_FOUND','游戏不存在');if(!game.ranking)fail(409,'RANKING_DISABLED','排行榜暂未开放');
          if((url.searchParams.get('mode') || game.mode)!==game.mode || (url.searchParams.get('rulesVersion') || game.rulesVersion)!==game.rulesVersion)fail(400,'INVALID_RULES','模式或规则版本无效');
          const limit=Number(url.searchParams.get('limit') || 10);if(!Number.isInteger(limit) || limit<1 || limit>100)fail(400,'INVALID_LIMIT','条数范围为 1–100');
          // Identifiers and directions originate exclusively from the trusted catalog.
          const order=game.ranking.map(([f,d])=>`${f==='id'?'s.id':f==='acceptedAt'?'s.accepted_at':`json_extract(r.metrics, '$.${f}')`} ${d}`).join(',');
          const rows=db.prepare(`SELECT s.id,s.nickname,s.accepted_at,r.metrics FROM scores s JOIN runs r ON r.id=s.run_id WHERE r.game_id=? AND r.mode=? AND r.rules_version=? ORDER BY ${order} LIMIT ?`).all(game.id,game.mode,game.rulesVersion,limit);
          return send(200,{gameId:game.id,mode:game.mode,rulesVersion:game.rulesVersion,entries:rows.map((r,i)=>({rank:i+1,nickname:r.nickname,metrics:JSON.parse(r.metrics),acceptedAt:r.accepted_at}))});
        }
        const action=p.match(/^\/gamehub\/api\/runs\/([a-f0-9-]+)\/(finish|score)$/);
        if(req.method==='POST' && (p==='/gamehub/api/runs' || action)) {
          const body=await jsonBody(req);
          const output=transaction(db,()=>{
            const {guest,visit}=identity(req,res);
            if(!action) {
              const game=gameFor(body.gameId,body.mode,body.rulesVersion);
              if(!game || !uuid(body.requestId))fail(400,'INVALID_RUN','游戏、模式、规则版本或 requestId 无效');
              const old=query('SELECT * FROM runs WHERE guest_id=? AND request_id=?',guest.id,body.requestId);
              if(old){if(old.game_id!==game.id || old.mode!==game.mode || old.rules_version!==game.rulesVersion)fail(409,'IDEMPOTENCY_CONFLICT','重复请求内容不一致');return [200,{runId:old.id,startedAt:old.started_at,replayed:true}];}
              const id=randomUUID();run('INSERT INTO runs(id,guest_id,visit_id,request_id,game_id,mode,rules_version,started_at) VALUES(?,?,?,?,?,?,?,?)',id,guest.id,visit.id,body.requestId,game.id,game.mode,game.rulesVersion,clock());event(guest.id,visit.id,'run_start',id);
              return [201,{runId:id,startedAt:clock(),replayed:false}];
            }
            const record=query('SELECT * FROM runs WHERE id=? AND guest_id=?',action[1],guest.id);if(!record)fail(404,'RUN_NOT_FOUND','对局不存在');
            if(action[2]==='finish') {
              const game=gameFor(record.game_id,record.mode,record.rules_version);
              if(!['completed','victory','defeat'].includes(body.outcome) || (game.id==='solovs'?body.outcome==='completed':body.outcome!=='completed'))fail(400,'INVALID_OUTCOME','结算类型无效');
              const metrics=JSON.stringify(metricsFor(game,body.metrics));
              if(record.finished_at!==null){if(record.outcome!==body.outcome || record.metrics!==metrics)fail(409,'IDEMPOTENCY_CONFLICT','对局已结算，内容不一致');return [200,{runId:record.id,finishedAt:record.finished_at,replayed:true}];}
              if(clock()-record.started_at>86400000)fail(409,'RUN_EXPIRED','对局已超过 24 小时');
              const values=JSON.parse(metrics);if((values.time ?? values.duration ?? 0)>(clock()-record.started_at)/1000+2)fail(400,'INVALID_DURATION','游玩时长超过对局经过时间');
              run('UPDATE runs SET finished_at=?,outcome=?,metrics=? WHERE id=?',clock(),body.outcome,metrics,record.id);event(guest.id,record.visit_id,'run_finish',record.id);
              return [200,{runId:record.id,finishedAt:clock(),replayed:false}];
            }
            if(!games.find(g=>g.id===record.game_id).ranking)fail(409,'RANKING_DISABLED','排行榜暂未开放');
            if(record.finished_at===null)fail(409,'RUN_NOT_FINISHED','对局尚未结算');
            if(typeof body.nickname!=='string')fail(400,'INVALID_NICKNAME','请输入昵称');
            const nickname=body.nickname.trim().normalize('NFC');
            if(!nickname || [...nickname].length>16 || /[\p{Cc}\p{Cf}]/u.test(nickname))fail(400,'INVALID_NICKNAME','昵称需为 1–16 个可见字符');
            const old=query('SELECT * FROM scores WHERE run_id=?',record.id);
            if(old){if(old.nickname!==nickname)fail(409,'IDEMPOTENCY_CONFLICT','成绩已提交，昵称不一致');return [200,{scoreId:old.id,replayed:true}];}
            const saved=run('INSERT INTO scores(run_id,nickname,accepted_at) VALUES(?,?,?)',record.id,nickname,clock());run('UPDATE guests SET nickname=? WHERE id=?',nickname,guest.id);event(guest.id,record.visit_id,'score_submit',record.id);
            return [201,{scoreId:Number(saved.lastInsertRowid),replayed:false}];
          });return send(...output);
        }
        fail(404,'NOT_FOUND','接口不存在');
      }
      if(!['GET','HEAD'].includes(req.method))fail(405,'METHOD_NOT_ALLOWED','不支持该请求方式');
      if(p==='/gamehub'){res.writeHead(308,{Location:'/gamehub/'});return res.end();}
      if(p==='/gamehub/')return await staticFile(req,res,path.join(root,'portal'),'index.html');
      const asset=p.match(/^\/gamehub\/assets\/(app\.js|telemetry\.js|style\.css|(?:happyjump-cover|3d-runway-cover|gogodown-cover|solovs-cover|site-background)\.webp)$/);
      if(asset){
        const image=asset[1].endsWith('.webp');
        res.setHeader('Cache-Control',`public, max-age=${image?3600:300}`);
        return await staticFile(req,res,path.join(root,'portal',image?'assets':''),asset[1]);
      }
      const vendor=p.match(/^\/gamehub\/assets\/vendor\/(three-0\.128\.0\.min\.js|three-0\.162\.0\.module\.js|tailwind-browser-4\.3\.3\.js)$/);
      if(vendor){res.setHeader('Cache-Control','public, max-age=86400');return await staticFile(req,res,path.join(root,'assets/vendor'),vendor[1]);}
      const play=p.match(/^\/gamehub\/play\/([^/]+)(\/.*)?$/),game=games.find(g=>g.id===play?.[1]);
      if(game && game.available!==false){if(!play[2]){res.writeHead(308,{Location:p+'/'});return res.end();}const relative=decodeURIComponent(play[2].slice(1)) || game.entry;if(!game.include.some(s=>relative===s || relative.startsWith(s+'/')) && !['LICENSE','THIRD_PARTY_NOTICES.md'].includes(relative))fail(404,'NOT_FOUND','未找到资源');return await staticFile(req,res,dev?path.resolve(root,game.source):path.join(gameRoot,game.id),relative);}
      fail(404,'NOT_FOUND','未找到资源');
    }catch(e){if(res.headersSent)return res.destroy();if(!e.status)console.error('GameHub request failed:',e.message);send(e.status || 500,{error:{code:e.code || 'INTERNAL_ERROR',message:e.status?e.message:'服务暂时不可用'}});}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  return {server,db,close:async()=>{if(server.listening)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));db.close();}};
}
