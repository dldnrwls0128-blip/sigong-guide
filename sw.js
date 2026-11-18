const VERSION = 'sigong-guide-v1.1.0';
const CACHE = VERSION, EXT = 'sigong-guide-ext-v1';
const ASSETS = ['./', './index.html', './css/app.css', './js/data.js', './js/db.js', './js/drawings.js', './js/app.js', './manifest.json', './icons/icon-192.png', './icons/icon-512.png',
  './vendor/pdfjs/pdf.min.mjs', './vendor/pdfjs/pdf.worker.min.mjs', './vendor/tesseract/tesseract.min.js', './vendor/tesseract/worker.min.js', './vendor/pdfjs/cmaps/Adobe-Korea1-0.bcmap','./vendor/pdfjs/cmaps/Adobe-Korea1-1.bcmap','./vendor/pdfjs/cmaps/Adobe-Korea1-2.bcmap','./vendor/pdfjs/cmaps/Adobe-Korea1-UCS2.bcmap','./vendor/pdfjs/cmaps/KSC-EUC-H.bcmap','./vendor/pdfjs/cmaps/KSC-EUC-V.bcmap','./vendor/pdfjs/cmaps/KSCms-UHC-H.bcmap','./vendor/pdfjs/cmaps/KSCms-UHC-HW-H.bcmap','./vendor/pdfjs/cmaps/KSCms-UHC-HW-V.bcmap','./vendor/pdfjs/cmaps/KSCms-UHC-V.bcmap','./vendor/pdfjs/cmaps/UniKS-UCS2-H.bcmap','./vendor/pdfjs/cmaps/UniKS-UCS2-V.bcmap','./vendor/pdfjs/cmaps/UniKS-UTF16-H.bcmap','./vendor/pdfjs/cmaps/UniKS-UTF16-V.bcmap'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== EXT).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  // OCR 엔진·한글 데이터(CDN): 처음 한 번 내려받은 뒤 캐시에서 사용
  if (u.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.open(EXT).then(c => c.match(e.request).then(r => r || fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; }))));
    return;
  }
  if (u.origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(res => {
    if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }
    return res;
  }).catch(() => e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error())));
});
