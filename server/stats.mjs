import {games} from './catalog.mjs';

export function unionMs(intervals) {
  const sorted=intervals.filter(([start,end])=>end>start).sort((a,b)=>a[0]-b[0] || a[1]-b[1]);
  let total=0,start=null,end=null;
  for(const [from,to] of sorted) {
    if(start===null){start=from;end=to;continue;}
    if(from<=end){end=Math.max(end,to);continue;}
    total+=end-start;start=from;end=to;
  }
  return start===null?total:total+end-start;
}

export function statistics(db,now=Date.now()) {
  const todayStart=Math.floor((now+8*3600000)/86400000)*86400000-8*3600000;
  const scalar=sql=>db.prepare(sql).get().count;
  const guests=db.prepare('SELECT id,nickname,created_at,last_seen FROM guests ORDER BY last_seen DESC').all();
  const lastIps=new Map(db.prepare('SELECT guest_id,last_ip FROM visits ORDER BY last_seen').all().map(row=>[row.guest_id,row.last_ip]));
  const visitCounts=new Map(db.prepare('SELECT guest_id,COUNT(*) AS count FROM visits GROUP BY guest_id').all().map(row=>[row.guest_id,row.count]));
  const entryCounts=new Map(db.prepare('SELECT guest_id,COUNT(*) AS count FROM game_pages GROUP BY guest_id').all().map(row=>[row.guest_id,row.count]));
  const runCounts=new Map(db.prepare('SELECT guest_id,COUNT(*) AS starts,SUM(CASE WHEN finished_at IS NOT NULL THEN 1 ELSE 0 END) AS finishes FROM runs GROUP BY guest_id').all().map(row=>[row.guest_id,row]));
  const scoreCounts=new Map(db.prepare('SELECT r.guest_id,COUNT(*) AS count FROM scores s JOIN runs r ON r.id=s.run_id GROUP BY r.guest_id').all().map(row=>[row.guest_id,row.count]));
  const intervals=db.prepare('SELECT h.guest_id,h.start_at,h.end_at,h.playing,p.kind,p.game_id FROM heartbeats h JOIN page_sessions p ON p.page_id=h.page_id WHERE h.end_at>h.start_at ORDER BY h.start_at').all();
  const duration=(guestId,kind,gameId=null,playing=false)=>unionMs(intervals.filter(row=>row.guest_id===guestId && row.kind===kind && (gameId===null || row.game_id===gameId) && (!playing || row.playing===1)).map(row=>[row.start_at,row.end_at]));
  const visitors=guests.map(row=>({
    guestId:row.id,nickname:row.nickname,firstSeen:row.created_at,lastSeen:row.last_seen,lastIp:lastIps.get(row.id)||null,
    visits:visitCounts.get(row.id)||0,gameEntries:entryCounts.get(row.id)||0,
    runStarts:runCounts.get(row.id)?.starts||0,runFinishes:runCounts.get(row.id)?.finishes||0,
    scores:scoreCounts.get(row.id)||0,
    portalForegroundMs:duration(row.id,'portal'),
    gameForegroundMs:duration(row.id,'game'),
    playMs:duration(row.id,'game',null,true),
  }));
  const byGame=games.map(game=>{
    const gameId=game.id;
    const entries=db.prepare('SELECT COUNT(*) AS count FROM game_pages WHERE game_id=?').get(gameId).count;
    const runs=db.prepare('SELECT COUNT(*) AS starts,SUM(CASE WHEN finished_at IS NOT NULL THEN 1 ELSE 0 END) AS finishes FROM runs WHERE game_id=?').get(gameId);
    const scores=db.prepare('SELECT COUNT(*) AS count FROM scores s JOIN runs r ON r.id=s.run_id WHERE r.game_id=?').get(gameId).count;
    return {gameId,name:game.name,entries,runStarts:runs.starts,runFinishes:runs.finishes||0,scores,
      foregroundMs:guests.reduce((sum,g)=>sum+duration(g.id,'game',gameId),0),
      playMs:guests.reduce((sum,g)=>sum+duration(g.id,'game',gameId,true),0)};
  });
  const recentRuns=db.prepare(`SELECT r.id,r.game_id,r.started_at,r.finished_at,r.outcome,r.metrics,
    g.id AS guest_id,g.nickname AS guest_nickname,s.nickname AS score_nickname,s.accepted_at
    FROM runs r JOIN guests g ON g.id=r.guest_id LEFT JOIN scores s ON s.run_id=r.id
    ORDER BY r.started_at DESC LIMIT 30`).all().map(row=>({
      runId:row.id,gameId:row.game_id,guestId:row.guest_id,nickname:row.score_nickname||row.guest_nickname,
      startedAt:row.started_at,finishedAt:row.finished_at,outcome:row.outcome,
      submittedAt:row.accepted_at,metrics:row.metrics?JSON.parse(row.metrics):null,
    }));
  return {
    generatedAt:now,
    totals:{guests:guests.length,visits:scalar('SELECT COUNT(*) AS count FROM visits'),
      todayVisitors:db.prepare('SELECT COUNT(DISTINCT guest_id) AS count FROM visits WHERE started_at>=?').get(todayStart).count,
      todayVisits:db.prepare('SELECT COUNT(*) AS count FROM visits WHERE started_at>=?').get(todayStart).count,
      todayRunStarts:db.prepare('SELECT COUNT(*) AS count FROM runs WHERE started_at>=?').get(todayStart).count,
      uniqueIps:scalar('SELECT COUNT(DISTINCT last_ip) AS count FROM visits WHERE last_ip IS NOT NULL'),
      activeEstimate:db.prepare('SELECT COUNT(DISTINCT guest_id) AS count FROM heartbeats WHERE received_at>=?').get(now-60000).count,
      gameEntries:scalar('SELECT COUNT(*) AS count FROM game_pages'),
      runStarts:scalar('SELECT COUNT(*) AS count FROM runs'),
      runFinishes:scalar('SELECT COUNT(*) AS count FROM runs WHERE finished_at IS NOT NULL'),
      scores:scalar('SELECT COUNT(*) AS count FROM scores'),
      portalForegroundMs:visitors.reduce((sum,g)=>sum+g.portalForegroundMs,0),
      gameForegroundMs:visitors.reduce((sum,g)=>sum+g.gameForegroundMs,0),
      playMs:visitors.reduce((sum,g)=>sum+g.playMs,0)},
    byGame,visitors,recentRuns,
  };
}

export function visitorDetails(db,guestId) {
  const guest=db.prepare('SELECT id,nickname,created_at,last_seen FROM guests WHERE id=?').get(guestId);
  if(!guest)return null;
  return {
    guestId:guest.id,nickname:guest.nickname,firstSeen:guest.created_at,lastSeen:guest.last_seen,
    visits:db.prepare('SELECT id,started_at,last_seen,first_ip,last_ip FROM visits WHERE guest_id=? ORDER BY started_at DESC LIMIT 30').all(guestId),
    runs:db.prepare('SELECT r.id,r.game_id,r.started_at,r.finished_at,s.nickname AS score_nickname FROM runs r LEFT JOIN scores s ON s.run_id=r.id WHERE r.guest_id=? ORDER BY r.started_at DESC LIMIT 30').all(guestId),
  };
}

export function gameDetails(db,gameId) {
  const game=games.find(item=>item.id===gameId);
  if(!game)return null;
  return {
    gameId,name:game.name,rankingEnabled:Boolean(game.ranking),
    runs:db.prepare('SELECT r.id,r.guest_id,r.started_at,r.finished_at,s.nickname AS score_nickname FROM runs r LEFT JOIN scores s ON s.run_id=r.id WHERE r.game_id=? ORDER BY r.started_at DESC LIMIT 30').all(gameId),
  };
}
