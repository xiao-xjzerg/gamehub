// Optional, bounded foreground telemetry. Failed intervals are dropped, never replayed later.
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes=crypto.getRandomValues(new Uint8Array(16));
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export function createTelemetry({kind,gameId=null,pageId=uuid(),getGuest,initialPlaying=false}) {
  if(!['portal','game'].includes(kind) || typeof getGuest!=='function')throw new Error('Invalid telemetry configuration');
  let ready=false,registerPromise=null,playing=Boolean(initialPlaying),active=false;
  let started=0,seq=0,pending=0,queue=Promise.resolve(),stopped=false;
  const foreground=()=>!document.hidden && (document.hasFocus?.() ?? true);

  async function post(endpoint,body,keepalive=false) {
    const guest=await getGuest();
    const response=await fetch(`/gamehub/api/${endpoint}`,{
      method:'POST',credentials:'same-origin',keepalive,
      signal:AbortSignal.timeout(8000),
      headers:{'Content-Type':'application/json','X-GameHub-CSRF':guest.csrfToken},
      body:JSON.stringify(body),
    });
    if(!response.ok)throw new Error(`Telemetry request failed: ${response.status}`);
    return response.json();
  }

  function mark(){started=performance.now();}

  function register() {
    if(ready || stopped)return Promise.resolve();
    if(!registerPromise)registerPromise=post('pages',{pageId,kind,...(kind==='game'?{gameId}:{})})
      .then(()=>{ready=true;active=foreground();if(active)mark();})
      .catch(()=>{})
      .finally(()=>{registerPromise=null;});
    return registerPromise;
  }

  function flush(keepalive=false) {
    if(!ready || !active || stopped)return;
    const elapsed=Math.min(20000,Math.max(0,performance.now()-started));
    mark();
    if(elapsed<250 || pending>=2)return;
    const endedAt=Date.now();
    const body={pageId,seq:++seq,startedAt:Math.round(endedAt-elapsed),endedAt,playing:kind==='game' && playing};
    pending++;
    queue=queue.then(()=>post('heartbeats',body,keepalive)).catch(()=>{}).finally(()=>{pending--;});
  }

  function updateVisibility() {
    const next=foreground();
    if(active && !next)flush(true);
    if(!active && next && ready)mark();
    active=next && ready;
  }

  function setPlaying(value) {
    if(kind!=='game')return;
    const next=Boolean(value);
    if(next===playing)return;
    flush();
    playing=next;
  }

  document.addEventListener('visibilitychange',updateVisibility);
  window.addEventListener('focus',updateVisibility);
  window.addEventListener('blur',updateVisibility);
  window.addEventListener('pagehide',()=>{flush(true);active=false;},{once:true});
  const timer=window.setInterval(()=>{if(!ready)register();else{updateVisibility();flush();}},15000);
  register();
  return {pageId,setPlaying,stop(){if(stopped)return;flush(true);stopped=true;window.clearInterval(timer);}};
}
