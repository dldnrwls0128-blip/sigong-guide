/* 도면: PDF 텍스트 추출(pdf.js) / OCR(tesseract.js) / 도면 정보 파싱 / 뷰어 */
window.DRW = (function () {
  'use strict';
  const base = p => new URL(p, document.baseURI).href;
  let pdfjsP = null;
  function pdfjs() {
    if (!pdfjsP) pdfjsP = import(base('vendor/pdfjs/pdf.min.mjs')).then(m => { m.GlobalWorkerOptions.workerSrc = base('vendor/pdfjs/pdf.worker.min.mjs'); return m; });
    return pdfjsP;
  }
  function killPdf(pdf) { try { if (pdf.loadingTask && pdf.loadingTask.destroy) pdf.loadingTask.destroy(); else if (pdf.destroy) pdf.destroy(); } catch (e) { } }
  async function openPdf(data) {
    const lib = await pdfjs();
    return lib.getDocument({ data, cMapUrl: base('vendor/pdfjs/cmaps/'), cMapPacked: true, standardFontDataUrl: base('vendor/pdfjs/standard_fonts/'), wasmUrl: base('vendor/pdfjs/wasm/'), iccUrl: base('vendor/pdfjs/iccs/') }).promise;
  }
  /* pdf.js 텍스트 조각을 같은 높이끼리 한 줄로 묶기 */
  function itemsToLines(items) {
    const its = items.filter(i => i.str && i.str.trim()).map(i => ({ s: i.str, x: i.transform[4], y: i.transform[5], h: Math.abs(i.transform[3]) || i.height || 8, w: i.width || 0 }));
    its.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    for (const it of its) {
      const r = rows.find(r => Math.abs(r.y - it.y) <= Math.max(2, Math.min(r.h, it.h) * 0.45));
      if (r) r.items.push(it); else rows.push({ y: it.y, h: it.h, items: [it] });
    }
    return rows.map(r => {
      r.items.sort((a, b) => a.x - b.x);
      let out = '', end = null;
      for (const it of r.items) { if (end !== null && it.x - end > it.h * 0.25) out += it.x - end > it.h * 3 ? '   ' : ' '; out += it.s; end = it.x + it.w; }
      return out.trim();
    }).filter(Boolean);
  }
  async function renderToCanvas(page, width) {
    const v1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: width / v1.width });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return c;
  }
  function imgToCanvas(blob, maxW) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(blob); const img = new Image();
      img.onload = () => { const r = img.width < 1200 ? Math.min(2, 1600 / img.width) : Math.min(1, maxW / img.width); const c = document.createElement('canvas'); c.width = Math.round(img.width * r); c.height = Math.round(img.height * r); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('이미지를 열 수 없습니다')); };
      img.src = url;
    });
  }
  /* ---------- OCR ---------- */
  let tessP = null;
  function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('스크립트 로드 실패')); document.head.appendChild(s); }); }
  async function ocr(canvas, onStatus) {
    if (!navigator.onLine) onStatus && onStatus('오프라인: 이전에 OCR을 한 번 써 본 기기에서만 동작합니다');
    if (!window.Tesseract) await loadScript(base('vendor/tesseract/tesseract.min.js'));
    if (!tessP) tessP = window.Tesseract.createWorker(['kor', 'eng'], 1, {
      workerPath: base('vendor/tesseract/worker.min.js'), workerBlobURL: false,
      logger: m => { if (onStatus && m.status) { const k = { 'loading tesseract core': 'OCR 엔진 불러오는 중', 'initializing tesseract': 'OCR 초기화', 'loading language traineddata': '한글·영문 데이터 불러오는 중', 'initializing api': 'OCR 준비', 'recognizing text': '글자 인식 중' }[m.status] || m.status; onStatus(`${k}${m.progress ? ' ' + Math.round(m.progress * 100) + '%' : ''}`); } }
    }).catch(e => { tessP = null; throw e; });
    let w;
    try { w = await tessP; } catch (e) { throw new Error('OCR 엔진을 불러오지 못했습니다. 처음 한 번은 인터넷 연결이 필요합니다. (' + (e.message || e) + ')'); }
    onStatus && onStatus('표 선 제거(전처리)');
    const clean = removeRules(canvas);
    const toLines = t => (t || '').split(/\n+/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const score = (lines, conf) => Object.keys(parse(lines)).length * 10 + Math.min(conf || 0, 100) / 10;
    let best = null;
    for (const psm of ['4', '11', '3']) { // 4: 한 열 가변 크기(표제란에 가장 잘 맞음) → 11: 흩어진 글자 → 3: 자동
      onStatus && onStatus(`OCR 글자 인식 (모드 ${psm})`);
      await w.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: '1', debug_file: '/dev/null' });
      const r = await w.recognize(clean);
      const lines = toLines(r.data.text); const sc = score(lines, r.data.confidence);
      if (!best || sc > best.sc) best = { lines, sc };
      if (best.sc >= 50) break;
    }
    return best.lines;
  }
  /* 표제란 테두리 같은 긴 직선을 지워 OCR 정확도 향상 */
  function removeRules(src) {
    const w = src.width, h = src.height; const ctx = src.getContext('2d');
    const img = ctx.getImageData(0, 0, w, h); const d = img.data; const n = w * h;
    const dark = new Uint8Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) dark[i] = (d[j] * 0.3 + d[j + 1] * 0.59 + d[j + 2] * 0.11) < 160 ? 1 : 0;
    const kill = new Uint8Array(n); const minH = Math.max(40, w * 0.06), minV = Math.max(40, h * 0.12);
    for (let y = 0; y < h; y++) { let x = 0; const o = y * w; while (x < w) { if (dark[o + x]) { const s = x; while (x < w && dark[o + x]) x++; if (x - s > minH) for (let k = s; k < x; k++) kill[o + k] = 1; } else x++; } }
    for (let x = 0; x < w; x++) { let y = 0; while (y < h) { if (dark[y * w + x]) { const s = y; while (y < h && dark[y * w + x]) y++; if (y - s > minV) for (let k = s; k < y; k++) kill[k * w + x] = 1; } else y++; } }
    const out = document.createElement('canvas'); out.width = w; out.height = h; const oc = out.getContext('2d'); const oi = oc.createImageData(w, h); const od = oi.data;
    for (let i = 0, j = 0; i < n; i++, j += 4) { const v = dark[i] && !kill[i] ? 0 : 255; od[j] = od[j + 1] = od[j + 2] = v; od[j + 3] = 255; }
    oc.putImageData(oi, 0, 0); return out;
  }
  /* ---------- 추출 (파일 → 줄 목록) ---------- */
  async function extract(blob, mime, onStatus) {
    const st = s => onStatus && onStatus(s);
    if (mime === 'application/pdf') {
      st('PDF 여는 중');
      const pdf = await openPdf(new Uint8Array(await blob.arrayBuffer()));
      let lines = [];
      const n = Math.min(pdf.numPages, 3);
      for (let p = 1; p <= n; p++) { st(`텍스트 추출 ${p}/${n}쪽`); const page = await pdf.getPage(p); const tc = await page.getTextContent(); lines = lines.concat(itemsToLines(tc.items)); }
      const page1 = await pdf.getPage(1);
      const thumb = (await renderToCanvas(page1, 360)).toDataURL('image/jpeg', 0.7);
      let method = 'pdf-text';
      if (lines.join('').replace(/\s/g, '').length < 15) { // 스캔 PDF → OCR
        st('글자 정보 없음 → OCR');
        const c = await renderToCanvas(page1, 2400);
        lines = await ocr(c, st); method = 'ocr';
      }
      killPdf(pdf);
      return { lines, method, pages: pdf.numPages, thumb };
    }
    const c = await imgToCanvas(blob, 2400);
    const t = document.createElement('canvas'); const r = 360 / c.width; t.width = 360; t.height = Math.round(c.height * r); t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
    st('OCR 준비');
    const lines = await ocr(c, st);
    return { lines, method: 'ocr', pages: 1, thumb: t.toDataURL('image/jpeg', 0.7) };
  }
  /* ---------- 파싱 ---------- */
  const sp = s => s.split('').map(ch => /[가-힣]/.test(ch) ? ch + '\\s*' : ch === ' ' ? '\\s*' : ch.replace(/[.]/g, '\\.?')).join('').replace(/(\\s\*)+$/, '');
  const LABELS = {
    projectName: ['공사명', '현장명', '사업명', '공사건명', 'PROJECT NAME', 'PROJECT TITLE', 'PROJECT'],
    title: ['도면명', '도면 제목', 'DRAWING TITLE', 'DWG TITLE', 'DWG. TITLE', 'TITLE'],
    number: ['도면번호', '도면 NO', 'DWG NO', 'DWG. NO', 'DRAWING NO', 'SHEET NO', 'DRAWING NUMBER'],
    scale: ['축척', 'SCALE'],
    address: ['대지위치', '대지 위치', '현장위치', '공사위치', '건설위치', '소재지', '주소', 'LOCATION', 'SITE ADDRESS'],
    etc: ['설계자', '설계', '감리', '시공', '작성', '검토', '승인', '일자', '날짜', 'DATE', 'DRAWN', 'DESIGNED', 'CHECKED', 'APPROVED', 'REV', 'NORTH', '비고', '건축주', 'CLIENT', 'OWNER']
  };
  const allLabels = [];
  Object.keys(LABELS).forEach(k => LABELS[k].forEach(l => allLabels.push({ k, l, re: sp(l) })));
  allLabels.sort((a, b) => b.l.length - a.l.length);
  const labelRe = new RegExp('(?:^|[^A-Za-z가-힣])(' + allLabels.map(a => a.re).join('|') + ')(?![A-Za-z])', 'gi');
  function whichLabel(m) { const s = m.replace(/\s/g, '').toUpperCase().replace(/\./g, ''); const a = allLabels.find(a => a.l.replace(/\s/g, '').toUpperCase().replace(/\./g, '') === s); return a ? a.k : null; }
  function labeled(lines) {
    const out = {};
    lines.forEach((line, li) => {
      const hits = []; let m; labelRe.lastIndex = 0;
      while ((m = labelRe.exec(line))) { const st = m.index + m[0].indexOf(m[1]); hits.push({ k: whichLabel(m[1]), st, en: st + m[1].length }); if (labelRe.lastIndex === m.index) labelRe.lastIndex++; }
      hits.forEach((h, i) => {
        if (!h.k || h.k === 'etc' || out[h.k]) return;
        let v = line.slice(h.en, i + 1 < hits.length ? hits[i + 1].st : undefined).replace(/^[\s:：.\-|)]+/, '').replace(/[\s|]+$/, '').trim();
        let conf = 'high';
        if (!v && lines[li + 1] && !(labelRe.lastIndex = 0, labelRe.test(lines[li + 1]))) { v = lines[li + 1].trim(); conf = 'mid'; }
        labelRe.lastIndex = 0;
        if (v && v.length <= 80) out[h.k] = { v: v.replace(/\s{2,}/g, ' '), conf };
      });
    });
    return out;
  }
  const uniq = a => Array.from(new Set(a));
  const DISC = [[/^(A|AR|ID)$/, '건축'], [/^(S|ST|SD)$/, '구조'], [/^(M|ME|P|MP|H|HV)$/, '기계설비'], [/^(E|EL|EE)$/, '전기'], [/^(F|FP|FA)$/, '소방'], [/^(T|TC|IT)$/, '통신'], [/^(C|CV)$/, '토목'], [/^(L|LA|LS)$/, '조경']];
  const TRADE_KW = [['철근', /배근|철근|REBAR/i], ['거푸집', /거푸집|형틀/], ['콘크리트', /콘크리트|타설/], ['철골', /철골|강구조|STEEL/i], ['조적', /조적|벽돌|블록|BLOCK/i], ['방수', /방수|WATER\s*PROOF/i], ['석재', /석재|화강석|대리석|STONE/i], ['커튼월', /커튼\s*월|CURTAIN/i], ['창호', /창호|WINDOW|창\s*호\s*도/i], ['타일', /타일|TILE/i], ['내장', /천장|천정|경량\s*벽|석고보드|내장|INTERIOR/i], ['도장', /도장|PAINT/i], ['토공', /흙막이|터파기|토공|굴착/], ['파일', /파일|PILE|말뚝/i], ['가설', /가설|비계/], ['설비전기연계', /설비|위생|배관|덕트|전기|전등|전열|소방|ELEC|MECH|PLUMB/i]];
  const TITLE_RE = /([가-힣A-Za-z0-9()~∼·,\-\s]{0,30}?(?:평면도|단면도|입면도|배근도|상세도|일람표|구조도|계통도|배치도|전개도|창호도|기초도|천장도|평면 상세도|매설도|투시도))/;
  function floorLabel(n) { return n < 0 ? 'B' + (-n) : n + 'F'; }
  function parse(lines) {
    const L = labeled(lines);
    const text = lines.join('\n');
    const f = {};
    const put = (k, v, conf, why) => { if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)) f[k] = { v, conf, why }; };
    // 공사명
    if (L.projectName) put('projectName', L.projectName.v, L.projectName.conf, '‘공사명/PROJECT’ 칸');
    else { const m = text.match(/([가-힣A-Za-z0-9○◯·()\s]{2,40}?(?:신축|증축|재건축|리모델링|개축|건립)\s*공사)/); if (m) put('projectName', m[1].trim(), 'mid', '‘…신축공사’ 문구'); }
    // 대지위치
    if (L.address) put('address', L.address.v, L.address.conf, '‘대지위치’ 칸');
    else { const m = text.match(/((?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|충북|충남|전라|전북|전남|경상|경북|경남|제주)[가-힣]*\s+[가-힣]+(?:시|군|구)(?:\s+[가-힣]+(?:구|시|군))?\s+[가-힣0-9]+(?:동|읍|면|리|로|길)(?:\s*[\d\-]+(?:번지)?)?)/); if (m) put('address', m[1].trim(), 'mid', '주소 형식 문구'); }
    // 도면번호
    const NUM_RE = /(?<![A-Za-z0-9])([A-Z]{1,3})\s?-\s?(\d{2,4}[A-Z]?)(?![0-9])/g;
    let num = null;
    if (L.number) { const m = L.number.v.match(/([A-Z]{1,3})\s?-?\s?(\d{1,4}[A-Z]?)/); num = m ? m[1] + '-' + m[2] : L.number.v.split(/\s+/)[0]; put('number', num, L.number.conf, '‘도면번호/DWG NO’ 칸'); }
    else {
      const cand = {}; let m; NUM_RE.lastIndex = 0;
      while ((m = NUM_RE.exec(text))) { const k = m[1] + '-' + m[2]; const known = DISC.some(d => d[0].test(m[1])); cand[k] = (cand[k] || 0) + (known ? 3 : 1) + (m[2].length >= 3 ? 1 : 0); }
      const best = Object.keys(cand).sort((a, b) => cand[b] - cand[a])[0];
      if (best && cand[best] >= 3) { num = best; put('number', best, 'mid', '도면번호 형식(A-101 등)'); }
    }
    // 도면명
    if (L.title) put('title', L.title.v, L.title.conf, '‘도면명/TITLE’ 칸');
    else { let best = ''; lines.forEach(l => { const m = l.match(TITLE_RE); if (m && m[1].trim().length > best.length) best = m[1].trim(); }); if (best) put('title', best, 'mid', '‘…평면도/배근도’ 문구'); }
    // 축척
    const sc = (L.scale && L.scale.v.match(/(\d)\s*[:/]\s*(\d{1,5})|NONE|N\.?S/i)) || text.match(/(?<![0-9])(1)\s*[:/]\s*(\d{2,4})(?![0-9])/);
    if (sc) put('scale', sc[2] ? `1/${sc[2]}` : 'NONE', L.scale ? 'high' : 'mid', L.scale ? '‘축척/SCALE’ 칸' : '1/100 형식');
    // 분야
    const pre = num ? num.split('-')[0] : '';
    const d = DISC.find(x => x[0].test(pre));
    if (d) put('discipline', d[1], 'high', `도면번호 접두사 ${pre}`);
    else { const kw = [['구조', /구조|배근/], ['기계설비', /기계|위생|설비/], ['전기', /전기/], ['소방', /소방/], ['토목', /토목/], ['조경', /조경/], ['건축', /평면도|입면도|단면도|창호|마감/]].find(x => x[1].test(text)); if (kw) put('discipline', kw[0], 'low', '도면 내용 키워드'); }
    // 공종
    const titleTxt = (f.title ? f.title.v : '') + ' ' + text;
    let trades = TRADE_KW.filter(t => t[1].test(f.title ? f.title.v : '')).map(t => t[0]);
    let tconf = 'high', twhy = '도면명 키워드';
    if (!trades.length) { trades = TRADE_KW.filter(t => t[1].test(titleTxt)).map(t => t[0]).slice(0, 4); tconf = 'mid'; twhy = '도면 본문 키워드'; }
    if (!trades.length && f.discipline) {
      const m = { '구조': ['철근', '거푸집', '콘크리트'], '기계설비': ['설비전기연계'], '전기': ['설비전기연계'], '소방': ['설비전기연계'], '토목': ['토공'] }[f.discipline.v];
      if (m) { trades = m; tconf = 'low'; twhy = '분야(' + f.discipline.v + ')에서 추정'; }
    }
    put('trades', uniq(trades), tconf, twhy);
    // 동
    const dongs = []; let m; const DONG_RE = /(?<![0-9A-Za-z\-])(\d{1,4})\s*동(?!바리|일|등|시|안|선|력|작|절|파|결|굴|판|관|선)/g;
    while ((m = DONG_RE.exec(text))) { const n = +m[1]; if (n > 0) dongs.push(n + '동'); }
    put('dongs', uniq(dongs), 'mid', '‘101동’ 형식');
    // 층
    const fl = []; const notes = [];
    const RANGE = /(?:(지하)\s*)?(\d{1,3})\s*(?:층|F)?\s*[~∼]\s*(?:(지하|지상)\s*)?(\d{1,3})\s*(?:층|F)(?![A-Za-z])/g;
    let rangeTxt = text;
    while ((m = RANGE.exec(text))) {
      let a = +m[2] * (m[1] ? -1 : 1), b = +m[4] * (m[3] === '지하' ? -1 : 1);
      if (a > b) [a, b] = [b, a];
      if (b - a <= 120) { for (let n = a; n <= b; n++) if (n !== 0) fl.push(floorLabel(n)); notes.push(m[0].replace(/\s+/g, '')); }
      rangeTxt = rangeTxt.replace(m[0], ' ');
    }
    const tx = rangeTxt;
    for (const r of [/지하\s*(\d{1,2})\s*층/g, /(?<![A-Za-z0-9])B\s?(\d{1,2})\s?(?:F|층)(?![A-Za-z])/g]) { r.lastIndex = 0; while ((m = r.exec(tx))) fl.push('B' + (+m[1])); }
    const tx2 = tx.replace(/지하\s*\d{1,2}\s*층/g, ' ').replace(/(?<![A-Za-z0-9])B\s?\d{1,2}\s?(?:F|층)/g, ' ');
    for (const r of [/(?<![0-9A-Za-z.\-])(\d{1,3})\s*층(?!고|수|간|별|높이)/g, /(?<![0-9A-Za-z.\-])(\d{1,3})F(?![A-Za-z0-9])/g]) { r.lastIndex = 0; while ((m = r.exec(tx2))) { const n = +m[1]; if (n > 0 && n <= 120) fl.push(n + 'F'); } }
    if (/(?<![A-Za-z])PH(?![A-Za-z])|옥탑|펜트하우스/.test(text)) fl.push('PH');
    if (/지붕층|옥상|ROOF/i.test(text)) fl.push('옥상');
    if (/기준층/.test(text)) notes.push('기준층');
    // 호
    const hos = []; let units = 0;
    const HR = /(?<![0-9])(\d{3,4})\s*[~∼]\s*(\d{3,4})\s*호/g;
    let htx = text;
    while ((m = HR.exec(text))) { const a = +m[1], b = +m[2]; if (Math.floor(a / 100) === Math.floor(b / 100) && b >= a && b - a <= 30) for (let n = a; n <= b; n++) hos.push(n + '호'); htx = htx.replace(m[0], ' '); }
    const H1 = /(?<![0-9])(\d{3,4})\s*호(?!선|기|실|차)/g;
    while ((m = H1.exec(htx))) { const n = +m[1]; if (n % 100 > 0 && n % 100 <= 40) hos.push(n + '호'); }
    const H2 = /(?<![0-9])0?(\d{1,2})\s*호(?!선|기|실|차)/g; const htx2 = htx.replace(/\d{3,4}\s*호/g, ' ');
    while ((m = H2.exec(htx2))) { const n = +m[1]; if (n > 0 && n <= 40) units = Math.max(units, n); }
    uniq(hos).forEach(h => { units = Math.max(units, parseInt(h, 10) % 100); const fn = Math.floor(parseInt(h, 10) / 100); if (fn > 0 && !fl.includes(fn + 'F')) fl.push(fn + 'F'); });
    const order = x => x === 'PH' ? 1000 : x === '옥상' ? 1001 : x[0] === 'B' ? -parseInt(x.slice(1), 10) : parseInt(x, 10);
    put('floors', uniq(fl).sort((a, b) => order(a) - order(b)), notes.length ? 'mid' : (fl.length ? 'mid' : 'low'), notes.length ? uniq(notes).join(', ') : '‘15층/B2/지하2층’ 형식');
    put('hos', uniq(hos).sort(), 'mid', '‘1501호’ 형식');
    if (units) put('units', units, 'low', '호수 번호에서 추정(층당 호수)');
    return f;
  }

  /* ---------- 뷰어 (확대/이동) ---------- */
  const V = { pdf: null, page: 1, zoom: 1, fitW: 360, el: null, blob: null, mime: '', renderTask: null, img: null };
  async function view(el, blob, mime, onInfo) {
    Object.assign(V, { el, blob, mime, page: 1, zoom: 1, pdf: null, img: null });
    V.fitW = el.clientWidth || 360; V.onInfo = onInfo;
    if (mime === 'application/pdf') { V.pdf = await openPdf(new Uint8Array(await blob.arrayBuffer())); }
    else { V.img = document.createElement('img'); V.img.src = URL.createObjectURL(blob); V.img.className = 'dview-img'; await new Promise(r => { V.img.onload = r; V.img.onerror = r; }); }
    await draw(); bindPinch(el);
  }
  async function draw() {
    const el = V.el; if (!el) return;
    const w = Math.round(V.fitW * V.zoom);
    if (V.img) { V.img.style.width = w + 'px'; if (!V.img.parentNode) { el.innerHTML = ''; el.appendChild(V.img); } info(); return; }
    const page = await V.pdf.getPage(V.page);
    const v1 = page.getViewport({ scale: 1 });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let scale = (w * dpr) / v1.width; if (v1.width * scale > 6000) scale = 6000 / v1.width;
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height); c.style.width = w + 'px'; c.className = 'dview-canvas';
    if (V.renderTask) try { V.renderTask.cancel(); } catch (e) { }
    V.renderTask = page.render({ canvasContext: c.getContext('2d'), viewport: vp });
    try { await V.renderTask.promise; } catch (e) { if (e && e.name === 'RenderingCancelledException') return; throw e; }
    el.innerHTML = ''; el.appendChild(c); info();
  }
  function info() { V.onInfo && V.onInfo({ page: V.page, pages: V.pdf ? V.pdf.numPages : 1, zoom: V.zoom }); }
  function cur() { return V.el && (V.el.querySelector('canvas') || V.el.querySelector('img')); }
  async function zoomTo(z, cx, cy) {
    const el = V.el; z = Math.max(0.5, Math.min(8, z));
    const fx = cx == null ? el.clientWidth / 2 : cx, fy = cy == null ? el.clientHeight / 2 : cy;
    const px = (el.scrollLeft + fx) / V.zoom, py = (el.scrollTop + fy) / V.zoom;
    V.zoom = z; await draw(); el.scrollLeft = px * z - fx; el.scrollTop = py * z - fy;
  }
  function bindPinch(el) {
    if (el._pinch) return; el._pinch = true;
    let d0 = 0, z0 = 1, mid = null;
    const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    el.addEventListener('touchstart', e => { if (e.touches.length === 2) { d0 = dist(e.touches); z0 = V.zoom; const r = el.getBoundingClientRect(); mid = [(e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left, (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top]; } }, { passive: true });
    el.addEventListener('touchmove', e => { if (e.touches.length === 2 && d0) { e.preventDefault(); const k = dist(e.touches) / d0; const c = cur(); if (c) { c.style.transformOrigin = `${el.scrollLeft + mid[0]}px ${el.scrollTop + mid[1]}px`; c.style.transform = `scale(${k})`; } el._k = k; } }, { passive: false });
    el.addEventListener('touchend', e => { if (d0 && e.touches.length < 2) { const k = el._k || 1; d0 = 0; el._k = 1; const c = cur(); if (c) c.style.transform = ''; zoomTo(z0 * k, mid[0], mid[1]); } });
    el.addEventListener('dblclick', e => { const r = el.getBoundingClientRect(); zoomTo(V.zoom >= 2 ? 1 : V.zoom * 2, e.clientX - r.left, e.clientY - r.top); });
  }
  return {
    extract, parse, view,
    zoomIn: () => zoomTo(V.zoom * 1.5), zoomOut: () => zoomTo(V.zoom / 1.5), fit: () => zoomTo(1),
    pageTo: async d => { if (!V.pdf) return; const n = V.page + d; if (n < 1 || n > V.pdf.numPages) return; V.page = n; await draw(); V.el.scrollTop = 0; },
    close: () => { if (V.pdf) killPdf(V.pdf); if (V.img) URL.revokeObjectURL(V.img.src); Object.assign(V, { pdf: null, img: null, el: null }); }
  };
})();
