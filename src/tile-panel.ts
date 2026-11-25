export const MAX_TILE_STATE_BYTES = 16_384;
export const SESSION_TILE_FRAME = "session.tile";

export type TileStateObject = Record<string, unknown>;

export function parseTileState(raw: unknown): TileStateObject {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as TileStateObject;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as TileStateObject) : {};
  } catch {
    return {};
  }
}

export function mergeTileState(previous: TileStateObject, patch: unknown): { state: TileStateObject; json: string } {
  const next: TileStateObject = { ...previous };
  if (patch && typeof patch === "object" && !Array.isArray(patch)) {
    for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
      if (value === undefined) delete next[key];
      else next[key] = value;
    }
  }
  const json = JSON.stringify(next);
  if (new TextEncoder().encode(json).byteLength > MAX_TILE_STATE_BYTES) {
    throw new Error(`tile state exceeds ${MAX_TILE_STATE_BYTES} bytes`);
  }
  return { state: next, json };
}

export const TILE_BASE_CSS = `
:root,.dark{color-scheme:dark;--bg:#0b1118;--bg-alt:#111a24;--line:rgba(181,198,211,0.14);--fg:#f7f9fb;--fg-mut:#9baaba;--brand:#f6821f;--good:#4ade80;--warn:#fbbf24;--bad:#ef4444;--seismo-empty:rgba(155,170,186,0.18);--seismo-llm:rgba(155,170,186,0.56);--seismo-box:#60a5fa;--seismo-mac:#f6821f;--seismo-web:#2dd4bf;--seismo-alert:#ef4444}
.light{color-scheme:light;--bg:#ffffff;--bg-alt:#f6f6f8;--line:rgba(0,0,0,0.10);--fg:#0a0a0a;--fg-mut:#5a5a62;--brand:#c4640d;--good:#15803d;--warn:#b45309;--bad:#b91c1c;--seismo-empty:rgba(90,90,98,0.14);--seismo-llm:rgba(90,90,98,0.44);--seismo-box:#2563eb;--seismo-mac:#c4640d;--seismo-web:#0d9488;--seismo-alert:#b91c1c}
*{box-sizing:border-box}
html,body{margin:0;padding:0;width:100%;height:100%;background:transparent;color:var(--fg);font-family:Inter,system-ui,-apple-system,sans-serif;overflow:hidden;font-size:11px;line-height:1.3}
#app{width:100%;height:100%;display:flex;flex-direction:column;justify-content:flex-end;overflow:hidden}
`;

export const TILE_RUNTIME_JS = `(function(){
  var listeners=[];
  var api={
    state:{},
    session:{},
    onUpdate:function(fn){
      if(typeof fn!=='function')return function(){};
      listeners.push(fn);
      try{fn(api.state,api.session);}catch(e){}
      return function(){var i=listeners.indexOf(fn);if(i>=0)listeners.splice(i,1);};
    },
    send:function(text){
      if(typeof text!=='string'||!text.trim())return;
      try{window.parent.postMessage({type:'my-ax:tile-send',text:text.trim().slice(0,2000)},'*');}catch(e){}
    }
  };
  window.myAxTile=api;
  window.addEventListener('message',function(ev){
    var d=ev&&ev.data;
    if(!d||d.type!=='my-ax:tile-state')return;
    if(d.theme==='light'||d.theme==='dark'){document.documentElement.className=d.theme;}
    if(d.state&&typeof d.state==='object')api.state=d.state;
    if(d.session&&typeof d.session==='object')api.session=d.session;
    for(var i=0;i<listeners.length;i++){try{listeners[i](api.state,api.session);}catch(e){}}
  });
  document.addEventListener('click',function(ev){
    var t=ev.target&&ev.target.closest?ev.target.closest('button,a,input,select,textarea,label,[role="button"],[data-tile-interactive]'):null;
    if(t)return;
    try{window.parent.postMessage({type:'my-ax:tile-select'},'*');}catch(e){}
  });
  document.addEventListener('contextmenu',function(ev){
    ev.preventDefault();
    try{window.parent.postMessage({type:'my-ax:tile-contextmenu',x:ev.clientX,y:ev.clientY},'*');}catch(e){}
  });
  try{window.parent.postMessage({type:'my-ax:tile-ready'},'*');}catch(e){}
})();`;
