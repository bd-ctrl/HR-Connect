// Asset-only cache. Never store authenticated HTML, navigation, API or sign-in responses.
const CACHE='cubic-github-assets-v1';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil((async()=>{for(const k of await caches.keys())if(k.startsWith('glow-mobile-assets-')&&k!==CACHE)await caches.delete(k);await self.clients.claim();})()));
self.addEventListener('fetch',e=>{
 const u=new URL(e.request.url);
 if(e.request.method!=='GET'||u.origin!==self.location.origin||e.request.mode==='navigate')return;
 if(!/^\/(assets\/[^/]+\.(gif|png)|style\.css|app\.js|logic\.js|install\.js|login\.js)$/.test(u.pathname.replace(new URL(self.registration.scope).pathname,'/')))return;
 e.respondWith((async()=>{const c=await caches.open(CACHE);try{const response=await fetch(e.request,{cache:'no-cache'});const type=response.headers.get('content-type')||'';if(response.ok&&!response.redirected&&!type.includes('text/html'))await c.put(e.request,response.clone());return response;}catch(err){const found=await c.match(e.request);if(found)return found;throw err;}})());
});
