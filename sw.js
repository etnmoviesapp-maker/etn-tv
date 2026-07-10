/* ETN TV Service Worker v35.0 · Phase 18 VIP & Monetization */
const V = 'etn-v35.0';
const SHELL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];
const IMG_CACHE = 'etn-img-v1';
const IMG_MAX = 200; // LRU cap for image cache

async function trimCache(name, max){
  try{
    const c = await caches.open(name);
    const keys = await c.keys();
    if(keys.length <= max) return;
    const remove = keys.length - max;
    for(let i=0;i<remove;i++) await c.delete(keys[i]);
  }catch{}
}

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL).catch(()=>{})));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== V && k !== IMG_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'ETN_PING') e.source && e.source.postMessage({ type: 'ETN_PONG', v: V });
  if (d.type === 'SKIP_WAITING') self.skipWaiting();
  if (d.type === 'WARMUP_CACHE' && Array.isArray(d.urls)) {
    e.waitUntil(caches.open(V).then(c => Promise.all(d.urls.map(u => c.add(u).catch(()=>{})))));
  }
});

// Network-first for HTML/navigation; cache-first for shell assets;
// pass-through for video/media & firebase (never cache streams).
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never intercept video / media streams / firebase / analytics
  if (/\.(mp4|mkv|m3u8|ts|webm|mp3|aac)(\?|$)/i.test(url.pathname)) return;
  if (/firebaseio\.com|googleapis\.com|gstatic\.com\/firebasejs|google-analytics|doubleclick|imasdk/.test(url.host)) return;
  if (req.headers.get('range')) return;

  // HTML / navigation → stale-while-revalidate for instant paint
  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith((async ()=>{
      const cached = await caches.match(req) || await caches.match('./index.html');
      const netP = fetch(req).then(r=>{
        if(r && r.ok){ const copy=r.clone(); caches.open(V).then(c=>c.put(req, copy)); }
        return r;
      }).catch(()=>null);
      return cached || netP || fetch(req);
    })());
    return;
  }

  // Images (thumbnails etc.) → cache-first with LRU trim
  if (req.destination === 'image' || /\.(png|jpe?g|webp|gif|svg|avif)(\?|$)/i.test(url.pathname)) {
    e.respondWith((async ()=>{
      const c = await caches.open(IMG_CACHE);
      const hit = await c.match(req);
      if(hit){
        // background refresh
        fetch(req).then(r=>{ if(r && r.ok) c.put(req, r.clone()); }).catch(()=>{});
        return hit;
      }
      try{
        const r = await fetch(req);
        if(r && r.ok){ c.put(req, r.clone()); trimCache(IMG_CACHE, IMG_MAX); }
        return r;
      }catch{ return hit || Response.error(); }
    })());
    return;
  }

  // Static → cache first, background refresh
  e.respondWith(
    caches.match(req).then(cached => {
      const fetchP = fetch(req).then(r => {
        if (r.ok && r.status === 200 && (url.origin === location.origin || /cdn|fonts/i.test(url.host))) {
          const copy = r.clone();
          caches.open(V).then(c => c.put(req, copy));
        }
        return r;
      }).catch(() => cached);
      return cached || fetchP;
    })
  );
});
