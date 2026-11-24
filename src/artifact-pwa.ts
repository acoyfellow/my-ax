export type ArtifactPwaInput = {
  readonly id: string;
  readonly title: string;
  readonly origin: string;
};

const ICON_PALETTES: readonly [string, string][] = [
  ["#f6821f", "#ea580c"],
  ["#0ea5e9", "#2563eb"],
  ["#10b981", "#059669"],
  ["#8b5cf6", "#6d28d9"],
  ["#ec4899", "#be185d"],
  ["#f59e0b", "#d97706"],
];

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

export function artifactShortName(title: string): string {
  const clean = title.trim().replace(/\s+/g, " ");
  if (!clean) return "Widget";
  return clean.length <= 16 ? clean : `${clean.slice(0, 15).trimEnd()}…`;
}

export function artifactMonogram(title: string): string {
  const words = title.trim().match(/[A-Za-z0-9]+/g) ?? [];
  const first = words[0];
  const second = words[1];
  if (first && second) return `${first[0]}${second[0]}`.toUpperCase();
  if (first) return first.slice(0, 2).toUpperCase();
  return "AX";
}

function paletteFor(id: string): readonly [string, string] {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash * 31) + id.charCodeAt(i)) | 0;
  return ICON_PALETTES[Math.abs(hash) % ICON_PALETTES.length];
}

export function artifactPwaIconSvg(id: string, title: string): string {
  const [start, end] = paletteFor(id);
  const label = escapeHtml(artifactMonogram(title));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${start}"/><stop offset="100%" stop-color="${end}"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="url(#g)"/><text x="256" y="294" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="196" font-weight="700" fill="#ffffff" letter-spacing="-4">${label}</text></svg>`;
}

export function artifactWebManifest(input: ArtifactPwaInput) {
  const origin = input.origin.replace(/\/+$/, "");
  const encodedId = encodeURIComponent(input.id);
  const appPath = `/apps/${encodedId}`;
  const title = input.title.trim() || "Widget";
  return {
    id: appPath,
    name: title,
    short_name: artifactShortName(title),
    description: `${title} — installed from My AX`,
    start_url: `${origin}${appPath}`,
    scope: `${origin}${appPath}`,
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "any",
    background_color: "#0b1118",
    theme_color: "#0b1118",
    icons: [
      { src: `${origin}${appPath}/icon.svg`, sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: `${origin}/static/brand/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${origin}/static/brand/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${origin}/static/brand/icon-maskable-192.png`, sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: `${origin}/static/brand/icon-maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

export function artifactPwaShellHtml(input: ArtifactPwaInput): string {
  const encodedId = encodeURIComponent(input.id);
  const appPath = `/apps/${encodedId}`;
  const previewPath = `/api/artifacts/${encodedId}/preview`;
  const title = escapeHtml(input.title.trim() || "Widget");
  const shortTitle = escapeHtml(artifactShortName(input.title.trim() || "Widget"));
  const boot = `(function(){
  var bar=document.getElementById('pwa-bar');
  var installBtn=document.getElementById('pwa-install');
  var dismissBtn=document.getElementById('pwa-dismiss');
  var help=document.getElementById('pwa-help');
  var helpText=document.getElementById('pwa-help-text');
  var copyBtn=document.getElementById('pwa-copy');
  var deferred=null;
  var standalone=(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)||window.navigator.standalone===true;
  if(standalone&&bar){bar.hidden=true;}
  if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}).catch(function(){});}
  window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();deferred=e;if(installBtn)installBtn.textContent='Install app';});
  window.addEventListener('appinstalled',function(){deferred=null;if(bar)bar.hidden=true;if(help)help.hidden=true;});
  if(installBtn){installBtn.addEventListener('click',function(){
    if(deferred){deferred.prompt();deferred.userChoice.finally(function(){deferred=null;});return;}
    if(!help||!helpText)return;
    var ua=navigator.userAgent||'';
    var ios=/iPad|iPhone|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
    helpText.textContent=ios?'In Safari: tap the Share button, then tap "Add to Home Screen".':'In Safari on Mac: File -> Add to Dock. In Chrome/Edge: open the browser menu and pick "Install page as app".';
    help.hidden=!help.hidden;
  });}
  if(dismissBtn&&bar){dismissBtn.addEventListener('click',function(){bar.hidden=true;if(help)help.hidden=true;});}
  if(copyBtn){copyBtn.addEventListener('click',function(){if(navigator.clipboard){navigator.clipboard.writeText(location.href).then(function(){copyBtn.textContent='Copied';setTimeout(function(){copyBtn.textContent='Copy link';},1500);}).catch(function(){});}});}
  var frame=document.querySelector('iframe[data-artifact-pwa-frame]');
  var appId=frame?frame.getAttribute('data-artifact-pwa-frame'):'';
  var prefix='my-ax:app:'+appId+':';
  function detectMode(){var ms=['window-controls-overlay','standalone','minimal-ui','fullscreen','browser'];for(var i=0;i<ms.length;i++){if(window.matchMedia&&window.matchMedia('(display-mode: '+ms[i]+')').matches)return ms[i];}return 'unknown';}
  function pushEnv(){
    if(!frame||!frame.contentWindow)return;
    var dm=detectMode();
    var isStandalone=dm==='standalone'||dm==='window-controls-overlay'||window.navigator.standalone===true;
    var swCtrl=Boolean(navigator.serviceWorker&&navigator.serviceWorker.controller);
    frame.contentWindow.postMessage({type:'my-ax:app-env',appId:appId,standalone:isStandalone,displayMode:dm,online:Boolean(navigator.onLine),swControlled:swCtrl,origin:location.origin},'*');
  }
  if(frame){frame.addEventListener('load',pushEnv);}
  window.addEventListener('online',pushEnv);
  window.addEventListener('offline',pushEnv);
  window.addEventListener('message',function(e){
    if(!frame||!frame.contentWindow||e.source!==frame.contentWindow)return;
    var d=e.data;if(!d||typeof d!=='object')return;
    if(d.type==='my-ax:app-env-request'){pushEnv();return;}
    if(d.type==='my-ax:app-storage'){
      var cid=d.callId;
      try{
        var op=d.op;
        if(op==='get'){
          var k=String(d.key||'');
          frame.contentWindow.postMessage({type:'my-ax:app-storage-result',callId:cid,ok:true,value:localStorage.getItem(prefix+k)},'*');
        }else if(op==='set'){
          var k2=String(d.key||'');var v2=String(d.value==null?'':d.value);
          if(k2.length>128||v2.length>262144)throw new Error('quota exceeded');
          localStorage.setItem(prefix+k2,v2);
          frame.contentWindow.postMessage({type:'my-ax:app-storage-result',callId:cid,ok:true},'*');
        }else if(op==='remove'){
          localStorage.removeItem(prefix+String(d.key||''));
          frame.contentWindow.postMessage({type:'my-ax:app-storage-result',callId:cid,ok:true},'*');
        }else if(op==='keys'){
          var ks=[];for(var j=0;j<localStorage.length;j++){var lk=localStorage.key(j);if(lk&&lk.indexOf(prefix)===0)ks.push(lk.slice(prefix.length));}
          frame.contentWindow.postMessage({type:'my-ax:app-storage-result',callId:cid,ok:true,keys:ks},'*');
        }else if(op==='clear'){
          var rm=[];for(var j2=0;j2<localStorage.length;j2++){var lk2=localStorage.key(j2);if(lk2&&lk2.indexOf(prefix)===0)rm.push(lk2);}
          for(var r=0;r<rm.length;r++)localStorage.removeItem(rm[r]);
          frame.contentWindow.postMessage({type:'my-ax:app-storage-result',callId:cid,ok:true},'*');
        }else{
          frame.contentWindow.postMessage({type:'my-ax:app-storage-result',callId:cid,ok:false,error:'unknown op'},'*');
        }
      }catch(err){
        frame.contentWindow.postMessage({type:'my-ax:app-storage-result',callId:cid,ok:false,error:String(err&&err.message||err)},'*');
      }
      return;
    }
    if(d.type==='my-ax:app-notify'){
      var ncid=d.callId;
      if(typeof Notification==='undefined'){frame.contentWindow.postMessage({type:'my-ax:app-notify-result',callId:ncid,ok:false,permission:'unsupported',error:'Notification API unavailable'},'*');return;}
      var fire=function(perm){
        if(perm==='granted'){
          try{new Notification(String(d.title||'My AX App').slice(0,120),{body:String(d.body||'').slice(0,400),icon:'/apps/'+appId+'/icon.svg'});frame.contentWindow.postMessage({type:'my-ax:app-notify-result',callId:ncid,ok:true,permission:perm},'*');}
          catch(err){frame.contentWindow.postMessage({type:'my-ax:app-notify-result',callId:ncid,ok:false,permission:perm,error:String(err&&err.message||err)},'*');}
        }else{
          frame.contentWindow.postMessage({type:'my-ax:app-notify-result',callId:ncid,ok:false,permission:perm,error:'permission: '+perm},'*');
        }
      };
      if(Notification.permission==='default'){Notification.requestPermission().then(fire).catch(function(err){frame.contentWindow.postMessage({type:'my-ax:app-notify-result',callId:ncid,ok:false,permission:'denied',error:String(err&&err.message||err)},'*');});}
      else{fire(Notification.permission);}
      return;
    }
    if(d.type==='my-ax:app-share'){
      var scid=d.callId;
      if(!navigator.share){frame.contentWindow.postMessage({type:'my-ax:app-share-result',callId:scid,ok:false,error:'navigator.share unsupported'},'*');return;}
      navigator.share({title:String(d.title||document.title).slice(0,120),text:String(d.text||'').slice(0,500),url:String(d.url||location.href)}).then(function(){
        frame.contentWindow.postMessage({type:'my-ax:app-share-result',callId:scid,ok:true},'*');
      }).catch(function(err){
        frame.contentWindow.postMessage({type:'my-ax:app-share-result',callId:scid,ok:false,error:String(err&&err.message||err)},'*');
      });
    }
  });
})();`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${title}</title>
<meta name="theme-color" content="#0b1118">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="${shortTitle}">
<link rel="manifest" href="${appPath}/manifest.webmanifest" crossorigin="use-credentials">
<link rel="icon" type="image/svg+xml" href="${appPath}/icon.svg">
<link rel="apple-touch-icon" href="/static/brand/apple-touch-icon.png">
<style>
*{box-sizing:border-box}
html,body{margin:0;padding:0;width:100%;height:100%;background:#0b1118;color:#f7f9fb;font-family:system-ui,-apple-system,sans-serif;overflow:hidden}
body{display:flex;flex-direction:column;height:100dvh;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}
#pwa-bar{position:fixed;top:calc(10px + env(safe-area-inset-top));right:10px;z-index:20;display:flex;align-items:center;gap:6px;padding:4px 6px 4px 10px;border-radius:999px;background:rgba(17,26,36,0.9);border:1px solid rgba(255,255,255,0.16);backdrop-filter:blur(10px);box-shadow:0 4px 18px rgba(0,0,0,0.35);font-size:12px}
#pwa-bar[hidden]{display:none}
#pwa-bar button,#pwa-bar a{appearance:none;border:0;background:transparent;color:#f7f9fb;font:inherit;cursor:pointer;text-decoration:none;padding:4px 8px;border-radius:999px}
#pwa-install{background:#f6821f!important;color:#fff!important;font-weight:600!important}
#pwa-install:hover{background:#ea580c!important}
#pwa-dismiss{color:#9baaba!important;padding:4px 6px!important}
#pwa-help{position:fixed;top:calc(52px + env(safe-area-inset-top));right:10px;z-index:20;max-width:300px;padding:12px 14px;border-radius:12px;background:rgba(17,26,36,0.96);border:1px solid rgba(255,255,255,0.18);box-shadow:0 8px 28px rgba(0,0,0,0.45);font-size:12px;line-height:1.45;color:#dbe4ee}
#pwa-help[hidden]{display:none}
#pwa-help-actions{margin-top:8px;display:flex;gap:8px}
#pwa-copy{appearance:none;border:1px solid rgba(255,255,255,0.2);background:transparent;color:#fff;border-radius:8px;padding:4px 10px;font:inherit;cursor:pointer}
iframe{flex:1;width:100%;height:100%;border:0;display:block;background:#0b1118}
</style>
</head>
<body>
<div id="pwa-bar" data-pwa-install-bar>
  <button id="pwa-install" type="button" data-pwa-install-btn>Install app</button>
  <a href="/" title="Back to My AX">my·ax</a>
  <button id="pwa-dismiss" type="button" aria-label="Hide install bar">×</button>
</div>
<div id="pwa-help" hidden role="status" aria-live="polite" data-pwa-help>
  <div id="pwa-help-text"></div>
  <div id="pwa-help-actions"><button id="pwa-copy" type="button">Copy link</button></div>
</div>
<iframe src="${previewPath}" title="${title}" sandbox="allow-scripts allow-downloads allow-forms allow-popups allow-popups-to-escape-sandbox" allow="fullscreen; clipboard-write; clipboard-read; screen-wake-lock; web-share; autoplay" allowfullscreen referrerpolicy="no-referrer" data-artifact-pwa-frame="${encodedId}"></iframe>
<script>${boot}</script>
</body>
</html>`;
}
