const $=selector=>document.querySelector(selector);
const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;return node;};
const dateFormat=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
const date=value=>Number.isFinite(value)&&value>0?dateFormat.format(new Date(value)):'—';
const number=value=>Number(value||0).toLocaleString('zh-CN');
let csrfToken=null,summary=null,currentView='overview',selectedGame=null,selectedUser=null,sessionVersion=0;
const detailVersion={game:0,user:0};
const descriptions={overview:'进入、开局、结算和入榜情况',games:'查看每款游戏的使用情况和最近对局。Solovs（test）已开放试运行，暂不统计对局或排名。',users:'当前玩家使用游客身份；IP 是访问记录，不作为识别同一人的依据。',settings:'管理账号仅用于本机或 SSH 通道内的后台。'};
const gameNames=new Map();

async function request(path,{method='GET',body}={}) {
  const response=await fetch(`/admin/api/${path}`,{
    method,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(10000),
    headers:body===undefined?{}:{'Content-Type':'application/json','X-GameHub-Admin-CSRF':csrfToken||''},
    body:body===undefined?undefined:JSON.stringify(body),
  });
  const data=await response.json();
  if(!response.ok)throw Object.assign(new Error(data.error||'请求失败'),{status:response.status});
  return data;
}

function showLogin(message='') {
  sessionVersion++;detailVersion.game++;detailVersion.user++;
  csrfToken=null;summary=null;
  $('#app-shell').hidden=true;$('#login-screen').hidden=false;
  $('#login-status').textContent=message;
  $('#login-password').value='';
  $('#password-form').reset();
  $('#game-detail').hidden=true;$('#user-detail').hidden=true;
  $('#login-password').focus({preventScroll:true});
}
function showApp(token) {sessionVersion++;csrfToken=token;$('#login-screen').hidden=true;$('#app-shell').hidden=false;$('#login-password').value='';}

function tableRows(target,items,render) {
  const body=$(target);body.replaceChildren();
  const headers=[...body.closest('table').querySelectorAll('th')];
  if(!items.length){const row=element('tr',undefined,'empty-row'),cell=element('td','暂无记录','empty');cell.colSpan=headers.length;row.append(cell);body.append(row);return;}
  for(const item of items){
    const result=render(item);
    [...result.children].forEach((cell,index)=>{
      const header=headers[index];cell.dataset.label=header.textContent;
      if(header.classList.contains('num-heading'))cell.classList.add('num-cell','number');
      if(header.textContent==='操作')cell.classList.add('action-cell');
    });
    body.append(result);
  }
}
function row(values) {
  const result=element('tr');
  for(const value of values){const cell=element('td');cell.append(value instanceof Node?value:document.createTextNode(String(value)));result.append(cell);}
  return result;
}
function named(main,small) {
  const wrap=element('div',undefined,'person'),content=element('div');
  content.append(element('strong',main,'person-name'),element('small',small,'subtle mono'));
  wrap.append(element('span',main==='未提交昵称'?'G':[...main][0],'person-mark'),content);return wrap;
}
function gameCell(gameId,name=gameNames.get(gameId)||gameId){
  const wrap=element('div',undefined,'game-cell'),content=element('div');
  content.append(element('strong',name,'game-name'));
  if(gameId==='solovs')content.append(element('small','试运行 · 排行榜暂未开放','subtle'));
  if(['happyjump','3d-runway','gogodown','solovs'].includes(gameId)){
    const thumb=element('div',undefined,'thumb'),img=document.createElement('img');
    img.src=`/admin/assets/${gameId}-cover.webp`;img.alt='';img.width=1600;img.height=900;img.loading='lazy';thumb.append(img);wrap.append(thumb);
  }
  wrap.append(content);return wrap;
}
function timestamp(value){
  if(!Number.isFinite(value)||value<=0)return '—';
  const parts=Object.fromEntries(dateFormat.formatToParts(new Date(value)).map(part=>[part.type,part.value]));
  const node=element('time',undefined,'datetime');node.dateTime=new Date(value).toISOString();
  node.append(element('span',`${parts.year}/${parts.month}/${parts.day}`,'date-date'),element('span',`${parts.hour}:${parts.minute}`,'date-clock'));return node;
}
const runState=run=>element('span',run.finished_at?'已结算':'未结算',`state${run.finished_at?'':' idle'}`);
const submitted=run=>element('span',run.score_nickname?'已提交':'未提交',`submitted${run.score_nickname?'':' idle'}`);
function action(label,callback){const button=element('button',label,'table-action');button.type='button';button.addEventListener('click',callback);return button;}

function renderOverview(data) {
  $('#today-visits').textContent=number(data.totals.todayVisits);
  $('#all-visits').textContent=number(data.totals.visits);
  $('#today-runs').textContent=number(data.totals.todayRunStarts);
  $('#all-runs').textContent=number(data.totals.runStarts);
  $('#updated').textContent=`更新于 ${date(data.generatedAt)}（北京时间）`;
  tableRows('#overview-games',data.byGame,game=>row([gameCell(game.gameId,game.name),number(game.entries),number(game.runStarts),number(game.runFinishes),number(game.scores)]));
}
function renderGames(data) {
  tableRows('#game-rows',data.byGame,game=>row([gameCell(game.gameId,game.name),number(game.entries),number(game.runStarts),number(game.runFinishes),number(game.scores),action('查看',()=>openGame(game.gameId))]));
}
function renderUsers(data) {
  $('#user-count').textContent=number(data.totals.guests);
  $('#today-users').textContent=number(data.totals.todayVisitors);
  $('#ip-count').textContent=number(data.totals.uniqueIps);
  tableRows('#user-rows',data.visitors,guest=>{
    const result=row([named(guest.nickname||'未提交昵称',guest.guestId.slice(0,8)),timestamp(guest.lastSeen),element('span',guest.lastIp||'—','mono ip'),number(guest.visits),number(guest.runStarts),action('查看',()=>openUser(guest.guestId))]);
    result.dataset.guestId=guest.guestId;result.classList.toggle('selected-record',selectedUser===guest.guestId);return result;
  });
}
async function openGame(gameId) {
  selectedGame=gameId;const version=++detailVersion.game,session=sessionVersion;
  $('#status').textContent='正在加载游戏详情…';
  $('#game-detail').hidden=true;
  try {
    const game=await request(`games/${encodeURIComponent(gameId)}`);
    if(version!==detailVersion.game||session!==sessionVersion)return;
    $('#game-detail-title').textContent=`${game.name} · 最近对局`;
    $('#game-detail-note').textContent=game.rankingEnabled?'最近 30 局；只有提交昵称的成绩才入榜':'排行榜暂未开放';
    tableRows('#game-run-rows',game.runs,run=>row([named(run.score_nickname||'未提交昵称',run.guest_id.slice(0,8)),timestamp(run.started_at),runState(run),submitted(run)]));
    $('#status').textContent='';$('#game-detail').hidden=false;$('#game-detail').scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  } catch(error) {if(version!==detailVersion.game||session!==sessionVersion)return;if(error.status===401)showLogin('登录已过期，请重新登录。');else $('#status').textContent=error.message;}
}
async function openUser(guestId) {
  selectedUser=guestId;const version=++detailVersion.user,session=sessionVersion;
  $('#status').textContent='正在加载游客详情…';$('#user-detail').hidden=true;
  for(const record of $('#user-rows').children)record.classList.toggle('selected-record',record.dataset.guestId===guestId);
  try {
    const guest=await request(`users/${encodeURIComponent(guestId)}`);
    if(version!==detailVersion.user||session!==sessionVersion)return;
    $('#user-detail-title').textContent=guest.nickname||'未提交昵称';
    $('#user-detail-note').textContent=`游客编号 ${guest.guestId} · 首次访问 ${date(guest.firstSeen)}`;
    tableRows('#user-visit-rows',guest.visits,visit=>row([timestamp(visit.started_at),timestamp(visit.last_seen),element('span',visit.first_ip===visit.last_ip?visit.last_ip||'—':`${visit.first_ip||'—'} → ${visit.last_ip||'—'}`,'mono ip')]));
    tableRows('#user-run-rows',guest.runs,run=>row([element('strong',gameNames.get(run.game_id)||run.game_id,'game-name'),timestamp(run.started_at),runState(run),submitted(run)]));
    $('#status').textContent='';$('#user-detail').hidden=false;$('#user-detail').scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  } catch(error) {if(version!==detailVersion.user||session!==sessionVersion)return;if(error.status===401)showLogin('登录已过期，请重新登录。');else $('#status').textContent=error.message;}
}

function navigate(view) {
  currentView=view;
  for(const button of document.querySelectorAll('[data-view]')){
    const selected=button.dataset.view===view;
    button.classList.toggle('is-active',selected);
    button.classList.toggle('active',selected);
    selected?button.setAttribute('aria-current','page'):button.removeAttribute('aria-current');
  }
  for(const section of document.querySelectorAll('.view'))section.hidden=section.id!==`view-${view}`;
  $('#page-title').textContent={overview:'总览',games:'游戏管理',users:'用户管理',settings:'设置'}[view];
  $('#page-subtitle').textContent=descriptions[view];
  document.title=`GameHub · ${$('#page-title').textContent}`;
  $('#status').textContent='';
}

async function load() {
  const version=sessionVersion;
  $('#refresh').disabled=true;$('#status').textContent='正在更新数据…';
  try {const data=await request('summary');if(version!==sessionVersion)return;summary=data;for(const game of data.byGame)gameNames.set(game.gameId,game.name);renderOverview(summary);renderGames(summary);renderUsers(summary);$('#status').textContent='';}
  catch(error){if(error.status===401)showLogin('登录已过期，请重新登录。');else $('#status').textContent=error.message;}
  finally{$('#refresh').disabled=false;}
}

$('#login-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const button=event.currentTarget.querySelector('button[type=submit]');if(button.disabled)return;button.disabled=true;
  $('#login-status').textContent='正在登录…';
  try {const data=await request('login',{method:'POST',body:{password:$('#login-password').value}});showApp(data.csrfToken);navigate('overview');await load();}
  catch(error){$('#login-status').textContent=error.message;}
  finally{button.disabled=false;}
});
$('#logout').addEventListener('click',async()=>{
  try {await request('logout',{method:'POST',body:{}});showLogin('已退出登录。');}
  catch(error){$('#status').textContent=`退出失败：${error.message}`;}
});
$('#refresh').addEventListener('click',load);
for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>navigate(button.dataset.view));
for(const button of document.querySelectorAll('[data-close]'))button.addEventListener('click',()=>{const kind=button.dataset.close==='game-detail'?'game':'user';detailVersion[kind]++;$(`#${button.dataset.close}`).hidden=true;});
$('#password-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const currentPassword=$('#current-password').value,newPassword=$('#new-password').value;
  if(newPassword!==$('#confirm-password').value){$('#password-status').textContent='两次输入的新密码不一致。';return;}
  const button=event.currentTarget.querySelector('button[type=submit]');if(button.disabled)return;button.disabled=true;
  $('#password-status').textContent='正在保存…';
  try {await request('change-password',{method:'POST',body:{currentPassword,newPassword}});$('#password-form').reset();showLogin('密码已修改，请使用新密码重新登录。');}
  catch(error){$('#password-status').textContent=error.message;}
  finally{button.disabled=false;}
});

try {
  const session=await request('session');
  if(session.authenticated){showApp(session.csrfToken);await load();}
  else showLogin(session.setupRequired?'管理员密码尚未设置。请先按 README 在本机终端设置密码。':'请输入管理员密码。');
} catch {showLogin('管理服务暂时无法连接。');}

document.addEventListener('visibilitychange',()=>document.body.classList.toggle('paused',document.hidden));
