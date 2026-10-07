import {createTelemetry} from './telemetry.js';

const $=selector=>document.querySelector(selector);
const container=$('#games'),dialog=$('#ranking-dialog');
const element=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
const genres={happyjump:'轻松跳跃','3d-runway':'极速跑酷',gogodown:'平台挑战',solovs:'BOSS 对决'};
let availableGames=[],currentGame,requestVersion=0;

async function api(path){
  const response=await fetch(`/gamehub/api/${path}`,{credentials:'same-origin',signal:AbortSignal.timeout(10000)});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error?.message||'暂时无法连接，请稍后重试');
  return data;
}
async function identity(){
  try{return await api('guest');}
  catch{$('#guest-status').textContent='游客服务暂不可用';return null;}
}

const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const finePointer=matchMedia('(hover: hover) and (pointer: fine)');
const revealObserver=!reduced.matches && 'IntersectionObserver' in window?new IntersectionObserver(entries=>{
  for(const entry of entries)if(entry.isIntersecting){entry.target.classList.add('revealed');revealObserver.unobserve(entry.target);}
},{threshold:.08}):null;
if(revealObserver)document.documentElement.classList.add('motion-ready');
function motion(root=document){
  for(const target of root.querySelectorAll('[data-reveal]'))revealObserver?.observe(target);
  for(const target of root.querySelectorAll('[data-tilt],[data-scene]')){
    let frame=0;
    target.addEventListener('pointermove',event=>{
      if(reduced.matches||!finePointer.matches||innerWidth<768)return;
      cancelAnimationFrame(frame);
      const {clientX,clientY}=event;
      frame=requestAnimationFrame(()=>{
        const bounds=target.getBoundingClientRect(),x=(clientX-bounds.left)/bounds.width-.5,y=(clientY-bounds.top)/bounds.height-.5;
        if(target.hasAttribute('data-scene')){target.style.setProperty('--scene-x',`${x*18}px`);target.style.setProperty('--scene-y',`${y*12}px`);}
        else{target.style.setProperty('--rx',`${-y*3.2}deg`);target.style.setProperty('--ry',`${x*3.2}deg`);}
      });
    });
    target.addEventListener('pointerleave',()=>{cancelAnimationFrame(frame);for(const name of ['--rx','--ry','--scene-x','--scene-y'])target.style.removeProperty(name);});
  }
}
reduced.addEventListener('change',()=>{if(reduced.matches){document.documentElement.classList.remove('motion-ready');revealObserver?.disconnect();}});
const scene=$('[data-scene]');
let sceneVisible=true;
const pauseScene=()=>scene.classList.toggle('animation-paused',document.hidden||!sceneVisible);
if('IntersectionObserver' in window)new IntersectionObserver(entries=>{sceneVisible=entries[0].isIntersecting;pauseScene();}).observe(scene);
document.addEventListener('visibilitychange',pauseScene);
motion();

function renderGames(games){
  container.replaceChildren();
  for(const [index,game] of games.entries()){
    const card=element('article','game card'),cover=element('div','game-art cover');
    card.dataset.reveal='';card.dataset.tilt='';
    if(game.coverUrl){const img=element('img','cover-image');img.src=game.coverUrl;img.alt=`${game.name} 游戏封面`;img.width=1600;img.height=900;img.loading=index<2?'eager':'lazy';img.decoding='async';cover.append(img);}
    else cover.append(element('span','cover-placeholder','封面待提供'));
    const body=element('div','game-info'),title=element('div','game-heading');
    title.append(element('h3','game-title',game.name),element('span','genre',genres[game.id]||'小游戏'));
    const actions=element('div','game-actions'),play=element(game.available===false?'span':'a','text-play');
    if(game.available===false){play.textContent='开发中';play.classList.add('unavailable');}
    else{play.href=game.playUrl;play.setAttribute('aria-label',`开始游戏：${game.name}`);play.append(element('span','','开始游戏'),element('span','arrow','→'));}
    const rank=element('button','rank rank-button',game.ranking?'排行榜':'排行榜暂未开放');
    rank.type='button';rank.disabled=!game.ranking;rank.setAttribute('aria-label',`${game.name} ${game.ranking?'排行榜':'排行榜暂未开放'}`);rank.addEventListener('click',()=>openRanking(game));
    actions.append(play,rank);body.append(title,element('p','game-desc',game.description),actions);card.append(cover,body);container.append(card);
  }
  if(!games.length)container.append(element('p','empty','暂时没有游戏，请稍后再来。'));
  motion(container);
}
function renderRankingGames(){
  const nav=$('#ranking-games');nav.replaceChildren();
  for(const game of availableGames){
    const button=element('button','ranking-game',game.name+(game.ranking?'':' · 暂未开放'));
    button.type='button';button.disabled=!game.ranking;button.dataset.gameId=game.id;button.setAttribute('aria-pressed','false');button.addEventListener('click',()=>openRanking(game));nav.append(button);
  }
}
async function loadGames(){
  $('#reload').hidden=true;container.setAttribute('aria-busy','true');$('#nav-ranking').disabled=true;
  container.replaceChildren(...Array.from({length:4},()=>{const skeleton=element('div','game-skeleton');skeleton.setAttribute('aria-hidden','true');return skeleton;}));
  try{
    availableGames=(await api('games')).games;renderGames(availableGames);renderRankingGames();
    $('#nav-ranking').disabled=!availableGames.some(game=>game.ranking);
  }catch{
    container.replaceChildren(element('p','error','游戏列表加载失败，请检查连接后重试。'));$('#reload').hidden=false;
  }finally{container.setAttribute('aria-busy','false');}
}
function resultText(game,metrics){
  if(game.id==='happyjump')return `${metrics.score} 分 · Lv.${metrics.level}`;
  if(game.id==='3d-runway')return `${metrics.coins} 金币 · ${metrics.score} 分 · ${metrics.time.toFixed(1)} 秒`;
  return `${metrics.floor} 层 · Lv.${metrics.level} · ${metrics.duration.toFixed(3)} 秒`;
}
function formatDate(value){const date=new Date(value);return Number.isFinite(Number(value))&&Number(value)>0&&!Number.isNaN(date.getTime())?`${date.getFullYear()}/${date.getMonth()+1}/${date.getDate()}`:'—';}
async function openRanking(game){
  if(!game?.ranking)return;
  currentGame=game;const version=++requestVersion;
  $('#ranking-title').textContent=`${game.name} 排行榜`;
  for(const button of $('#ranking-games').children)button.setAttribute('aria-pressed',String(button.dataset.gameId===game.id));
  const content=$('#ranking-content');content.replaceChildren(element('p','empty','正在加载排行榜…'));content.setAttribute('aria-busy','true');$('#retry-ranking').hidden=true;
  if(!dialog.open)dialog.showModal();
  try{
    const data=await api(`leaderboards/${encodeURIComponent(game.id)}?limit=10`);
    if(version!==requestVersion)return;
    if(!data.entries.length){content.replaceChildren(element('p','empty','还没有成绩。\n来成为第一位挑战者吧'));return;}
    const header=element('div','board-head');for(const label of ['名次','玩家','成绩','日期'])header.append(element('span','',label));
    const list=element('ol','board');
    for(const entry of data.entries){const item=element('li');item.append(element('span','rank',String(entry.rank).padStart(2,'0')),element('span','nickname',entry.nickname),element('span','result',resultText(game,entry.metrics)),element('span','date',formatDate(entry.acceptedAt)));list.append(item);}
    content.replaceChildren(header,list);
  }catch{if(version!==requestVersion)return;content.replaceChildren(element('p','error','排行榜暂时无法加载，请稍后重试。'));$('#retry-ranking').hidden=false;}
  finally{if(version===requestVersion)content.setAttribute('aria-busy','false');}
}
$('#nav-ranking').addEventListener('click',()=>openRanking(currentGame||availableGames.find(game=>game.ranking)));
$('#close-ranking').addEventListener('click',()=>dialog.close());
dialog.addEventListener('close',()=>{requestVersion++;$('#ranking-content').setAttribute('aria-busy','false');});
dialog.addEventListener('click',event=>{if(event.target===dialog){const bounds=dialog.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)dialog.close();}});
$('#retry-ranking').addEventListener('click',()=>openRanking(currentGame));
$('#reload').addEventListener('click',loadGames);
const initialGuest=identity();
createTelemetry({kind:'portal',getGuest:async()=>await initialGuest||api('guest')});
loadGames();
