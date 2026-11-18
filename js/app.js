/* 시공관리 가이드 — 메인 앱 (vanilla JS, 정적 PWA) */
(function () {
  'use strict';
  const D = window.SG_DATA;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const nowStr = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  const RESULTS = ['적합', '부적합', '해당없음'];
  const ISTAT = ['작성중', '검측요청', '승인', '반려'];
  const XSTAT = ['미조치', '조치중', '조치완료'];
  const PARTS = ['기초', '벽체', '기둥', '보', '슬래브', '계단', '지붕', '외벽', '세대 내부', '욕실', '발코니', '코어', '지하주차장', '옥상', '공용부'];

  let S = null; // 앱 상태
  const filt = { insp: {}, issue: {}, photo: {}, log: {}, drw: {} };
  const photoCache = new Map();

  /* ---------- 상태 ---------- */
  function defaults() {
    return {
      v: 2, projects: [], cur: null, progress: {}, inspections: [], logs: [], issues: [], drawings: [],
      templates: D.templates.map(t => ({ id: uid(), trade: t.trade, name: t.name, builtin: true, items: t.items.map(i => ({ id: uid(), text: i.text, std: i.std })) })),
      settings: { author: '' }
    };
  }
  let saveTimer = null;
  function save(now) {
    clearTimeout(saveTimer);
    const run = () => DB.set('state', S).catch(e => toast('저장 실패: ' + e.message));
    if (now) return run();
    saveTimer = setTimeout(run, 150);
  }
  const P = () => S.projects.find(p => p.id === S.cur) || null;
  const byP = arr => arr.filter(x => x.projectId === S.cur);
  const trades = () => Array.from(new Set(S.templates.map(t => t.trade).concat(D.stages.flatMap(s => s.trades))));

  /* ---------- 위치 ---------- */
  function floorsOf(d) {
    if (!d) return [];
    const out = [];
    for (let f = Number(d.minF); f <= Number(d.maxF); f++) { if (f === 0) continue; out.push(f < 0 ? 'B' + (-f) : f + 'F'); }
    out.push('PH', '옥상');
    return out;
  }
  function hosOf(d, floor) {
    if (!d || !floor || !/^\d+F$/.test(floor)) return [];
    const f = parseInt(floor, 10), n = Number(d.units) || 0, out = [];
    for (let i = 1; i <= n; i++) out.push(f * 100 + i + '호');
    return out;
  }
  const locStr = o => [o.dong, o.floor, o.ho, o.part].filter(Boolean).join(' ');
  function locFields(o, pre) {
    const p = P(); const dongs = p ? p.dongs : [];
    const d = dongs.find(x => x.name === o.dong) || null;
    const opt = (arr, v, ph) => `<option value="">${ph}</option>` + arr.map(x => `<option ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('');
    return `<div class="grid3">
      <label>동<select id="${pre}dong" onchange="App.locChange('${pre}','dong')">${opt(dongs.map(x => x.name).concat(['공용', '단지외부']), o.dong, '선택')}</select></label>
      <label>층<select id="${pre}floor" onchange="App.locChange('${pre}','floor')">${opt(floorsOf(d), o.floor, '선택')}</select></label>
      <label>호<select id="${pre}ho">${opt(hosOf(d, o.floor), o.ho, '-')}</select></label></div>
      <label>부위<input id="${pre}part" list="partlist" value="${esc(o.part || '')}" placeholder="예: 슬래브, 벽체, 외벽"></label>`;
  }
  function readLoc(pre) { return { dong: $('#' + pre + 'dong').value, floor: $('#' + pre + 'floor').value, ho: $('#' + pre + 'ho').value, part: $('#' + pre + 'part').value.trim() }; }

  const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
  function applyParsed(d) {
    const F = DRW.parse(d.lines || []); const g = k => (F[k] ? F[k].v : '');
    d.fields = F;
    d.info = { projectName: g('projectName'), address: g('address'), title: g('title'), number: g('number'), scale: g('scale'), discipline: g('discipline') };
    d.tags = { dongs: g('dongs') || [], floors: g('floors') || [], hos: g('hos') || [], trades: g('trades') || [], units: g('units') || 0 };
  }
  /* ---------- 공통 UI ---------- */
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 1800); }
  function setTitle(t, back) { $('#title').textContent = t; $('#back').style.visibility = back ? 'visible' : 'hidden'; $('#back').dataset.to = back || ''; }
  function nav(h) { location.hash = h; }
  const badge = s => `<span class="badge b-${esc(s)}">${esc(s)}</span>`;
  function filterBar(key, opts) {
    const f = filt[key]; const p = P();
    const dongs = p ? p.dongs.map(d => d.name).concat(['공용', '단지외부']) : [];
    const d = p && p.dongs.find(x => x.name === f.dong);
    const sel = (k, arr, ph) => `<select onchange="App.setFilter('${key}','${k}',this.value)"><option value="">${ph}</option>${arr.map(x => `<option ${f[k] === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`;
    return `<div class="filters">
      <input type="search" placeholder="검색어" value="${esc(f.q || '')}" onchange="App.setFilter('${key}','q',this.value)">
      ${sel('dong', dongs, '전체 동')}${sel('floor', floorsOf(d), '전체 층')}${sel('trade', trades(), '전체 공종')}${opts.status ? sel('status', opts.status, '전체 상태') : ''}${opts.date ? `<input type="date" value="${esc(f.date || '')}" onchange="App.setFilter('${key}','date',this.value)">` : ''}
      ${Object.values(f).some(Boolean) ? `<button class="btn sm ghost" onclick="App.clearFilter('${key}')">필터 초기화</button>` : ''}</div>`;
  }
  function applyFilter(arr, key, textFn) {
    const f = filt[key];
    return arr.filter(x => (!f.dong || x.dong === f.dong) && (!f.floor || x.floor === f.floor) && (!f.trade || x.trade === f.trade) && (!f.status || x.status === f.status) && (!f.date || x.date === f.date) && (!f.q || textFn(x).toLowerCase().includes(f.q.toLowerCase())));
  }

  /* ---------- 사진 ---------- */
  function compress(file, max = 1280, q = 0.72) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => {
        const img = new Image();
        img.onload = () => {
          let { width: w, height: h } = img; const r = Math.min(1, max / Math.max(w, h)); w = Math.round(w * r); h = Math.round(h * r);
          const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h);
          res(c.toDataURL('image/jpeg', q));
        };
        img.onerror = () => rej(new Error('이미지를 읽을 수 없습니다'));
        img.src = fr.result;
      };
      fr.onerror = () => rej(fr.error); fr.readAsDataURL(file);
    });
  }
  async function addPhotos(files, meta) {
    const ids = [];
    for (const f of Array.from(files || [])) {
      try {
        const data = await compress(f);
        const p = Object.assign({ id: uid(), projectId: S.cur, data, date: today(), createdAt: Date.now(), caption: '' }, meta);
        await DB.putPhoto(p); photoCache.set(p.id, p); ids.push(p.id);
      } catch (e) { toast(e.message); }
    }
    return ids;
  }
  function photoInput(ctx) { // ctx: 'insp' | 'log' | 'issue' | 'issueAct' | 'gallery'
    return `<label class="btn sm photo-btn">📷 사진 촬영/선택<input type="file" accept="image/*" capture="environment" multiple hidden onchange="App.onPhoto('${ctx}',this)"></label>`;
  }
  function thumbs(ids, ctx, editable) {
    if (!ids || !ids.length) return '<p class="muted small">사진 없음</p>';
    return `<div class="thumbs">${ids.map((id, i) => `<figure><img data-pid="${id}" alt="사진 ${i + 1}" onclick="App.viewPhoto('${id}')"><figcaption>${i + 1}</figcaption>${editable ? `<button class="x" onclick="App.rmPhoto('${ctx}','${id}')">✕</button>` : ''}</figure>`).join('')}</div>`;
  }
  async function hydrate() {
    for (const img of $$('img[data-pid]')) {
      const id = img.dataset.pid; let p = photoCache.get(id);
      if (!p) { p = await DB.getPhoto(id); if (p) photoCache.set(id, p); }
      if (p) img.src = p.data; else img.alt = '(삭제됨)';
    }
  }

  /* ---------- 진행률 ---------- */
  function prog(stageId) {
    const p = S.progress[S.cur] = S.progress[S.cur] || {};
    return p[stageId] = p[stageId] || { done: {}, custom: [], hidden: {} };
  }
  function stageTodos(st) {
    const g = prog(st.id);
    return st.todos.map((t, i) => ({ id: 'd' + i, text: t, custom: false })).filter(t => !g.hidden[t.id]).concat(g.custom.map(c => ({ id: c.id, text: c.text, custom: true })));
  }
  function stagePct(st) { const t = stageTodos(st); if (!t.length) return 0; const g = prog(st.id); return Math.round(t.filter(x => g.done[x.id]).length / t.length * 100); }
  function overall() { let a = 0, b = 0; D.stages.forEach(st => { const t = stageTodos(st), g = prog(st.id); a += t.filter(x => g.done[x.id]).length; b += t.length; }); return b ? Math.round(a / b * 100) : 0; }
  function curStage() { const p = P(); if (p && p.curStage) return D.stages.find(s => s.id === p.curStage); return D.stages.find(s => stagePct(s) < 100) || D.stages[D.stages.length - 1]; }

  /* ---------- 화면: 대시보드 ---------- */
  function vDash() {
    setTitle('대시보드');
    const p = P();
    if (!p) return `<div class="card hero"><h2>👷 시공관리 가이드</h2><p>철거부터 준공까지 단계별 할 일, 검측 체크리스트, 검측요청서, 작업일지·사진·지적사항을 한 곳에서 관리합니다.</p><p>먼저 현장을 등록하세요. 도면을 올리면 현장명·위치·동/층/호를 자동으로 채울 수 있습니다.</p><div class="row"><button class="btn primary" onclick="location.hash='#/project/new'">+ 현장 등록</button><button class="btn" onclick="location.hash='#/drawings'">🗂 도면으로 시작</button></div></div>`;
    const cs = curStage(); const pend = byP(S.inspections).filter(i => i.status !== '승인');
    const open = byP(S.issues).filter(i => i.status !== '조치완료');
    const logs = byP(S.logs).sort((a, b) => b.date.localeCompare(a.date));
    return `<div class="card"><div class="row between"><div><div class="muted small">현재 현장</div><h2>${esc(p.name)}</h2><div class="muted small">${esc(p.location || '')} · ${p.dongs.length}개 동</div></div><button class="btn sm ghost" onclick="location.hash='#/settings'">변경</button></div></div>
    <div class="stats">
      <a class="stat" href="#/stage/${cs.id}"><b>${cs.icon} ${esc(cs.name)}</b><span>현재 단계 · ${stagePct(cs)}%</span></a>
      <a class="stat" href="#/stages"><b>${overall()}%</b><span>전체 진행률</span></a>
      <a class="stat ${pend.length ? 'warn' : ''}" href="#/insp" onclick="App.preFilter('insp')"><b>${pend.length}</b><span>미결 검측</span></a>
      <a class="stat ${open.length ? 'danger' : ''}" href="#/records/issue"><b>${open.length}</b><span>미조치 지적</span></a>
    </div>
    <div class="quick">
      <button class="btn primary" onclick="App.newInsp()">📝 검측요청서 작성</button>
      <button class="btn" onclick="location.hash='#/log/new'">📒 오늘 작업일지</button>
      <button class="btn" onclick="location.hash='#/issue/new'">⚠️ 지적사항 등록</button>
      <button class="btn" onclick="location.hash='#/records/photo'">📷 사진 기록</button>
      <button class="btn" onclick="location.hash='#/drawings'">🗂 도면 (자동 인식)${(S.drawings || []).filter(d => d.projectId === S.cur && d.status === '확인필요').length ? ' <span class="badge b-검측요청">확인 필요</span>' : ''}</button>
    </div>
    <div class="card"><h3>공정 진행</h3>${D.stages.map(st => { const v = stagePct(st); return `<a class="pbar ${st.id === cs.id ? 'cur' : ''}" href="#/stage/${st.id}"><span>${st.icon} ${esc(st.name)}</span><i style="--w:${v}%"></i><em>${v}%</em></a>`; }).join('')}</div>
    <div class="card"><h3>미결 검측 ${pend.length ? `(${pend.length})` : ''}</h3>${pend.length ? pend.slice(0, 5).map(inspRow).join('') : '<p class="muted">미결 검측이 없습니다.</p>'}</div>
    <div class="card"><h3>미조치 지적사항 ${open.length ? `(${open.length})` : ''}</h3>${open.length ? open.slice(0, 5).map(issueRow).join('') : '<p class="muted">미조치 지적사항이 없습니다.</p>'}</div>
    <div class="card"><h3>최근 작업일지</h3>${logs.length ? logs.slice(0, 3).map(logRow).join('') : '<p class="muted">작성된 일지가 없습니다.</p>'}</div>`;
  }

  /* ---------- 화면: 공정 ---------- */
  function vStages() {
    setTitle('단계별 공정 가이드');
    if (!P()) return needProject();
    const cs = curStage();
    return `<p class="muted small">철거 → 준공까지 13단계. 단계를 눌러 할 일과 착공 전·시공 중·완료 후 확인사항을 보세요.</p>` +
      D.stages.map((st, i) => { const v = stagePct(st); return `<a class="card stage ${st.id === cs.id ? 'cur' : ''}" href="#/stage/${st.id}"><div class="row between"><b>${i + 1}. ${st.icon} ${esc(st.name)}</b>${st.id === cs.id ? '<span class="badge b-검측요청">현재</span>' : ''}</div><div class="bar"><i style="width:${v}%"></i></div><div class="muted small">${v}% · 할 일 ${stageTodos(st).length}개 · 공종: ${st.trades.join(', ')}</div></a>`; }).join('');
  }
  function vStage(id) {
    const st = D.stages.find(s => s.id === id); if (!st) return notFound();
    if (!P()) return needProject();
    setTitle(st.name, '#/stages');
    const g = prog(st.id), todos = stageTodos(st), cs = curStage();
    const pts = (t, arr, cls) => `<div class="pt ${cls}"><h4>${t}</h4><ul>${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
    const tpls = S.templates.filter(t => st.trades.includes(t.trade));
    return `<div class="card"><div class="row between"><h2>${st.icon} ${esc(st.name)}</h2><b class="pct">${stagePct(st)}%</b></div>
      <div class="bar"><i style="width:${stagePct(st)}%"></i></div>
      ${st.id === cs.id && P().curStage ? '<p class="muted small">현재 단계로 지정됨</p>' : `<button class="btn sm" onclick="App.setCurStage('${st.id}')">현재 단계로 지정</button>`}</div>
    <div class="card"><h3>해야 할 일</h3><ul class="todos">${todos.map(t => `<li><label><input type="checkbox" ${g.done[t.id] ? 'checked' : ''} onchange="App.toggleTodo('${st.id}','${t.id}',this.checked)"><span>${esc(t.text)}</span></label><button class="icon" title="삭제" onclick="App.delTodo('${st.id}','${t.id}',${t.custom})">🗑</button></li>`).join('')}</ul>
      <div class="row"><input id="newTodo" placeholder="할 일 추가"><button class="btn sm primary" onclick="App.addTodo('${st.id}')">추가</button></div>
      ${Object.keys(g.hidden).length ? `<button class="btn sm ghost" onclick="App.restoreTodos('${st.id}')">삭제한 기본 항목 복원</button>` : ''}</div>
    <div class="card"><h3>핵심 확인사항</h3>${pts('착공 전', st.pre, 'pre')}${pts('시공 중', st.during, 'during')}${pts('완료 후', st.post, 'post')}</div>
    <div class="card"><h3>관련 검측 체크리스트</h3>${tpls.length ? tpls.map(t => `<div class="row between li"><span>${esc(t.name)} <span class="muted small">(${t.items.length}항목)</span></span><span><button class="btn sm" onclick="location.hash='#/tpl/${t.id}'">보기</button> <button class="btn sm primary" onclick="App.newInsp('${t.id}')">검측</button></span></div>`).join('') : '<p class="muted">관련 템플릿 없음</p>'}</div>`;
  }

  /* ---------- 화면: 검측 ---------- */
  function inspRow(i) {
    const bad = i.items.filter(x => x.result === '부적합').length;
    return `<a class="li row between" href="#/insp/${i.id}"><span><b>${esc(i.trade)}</b> · ${esc(locStr(i) || '위치 미지정')}<br><span class="muted small">${esc(i.docNo)} · ${esc(i.date)}${i.parentId ? ' · 재검측' : ''}${bad ? ` · <span class="red">부적합 ${bad}</span>` : ''}</span></span>${badge(i.status)}</a>`;
  }
  function vInspList() {
    setTitle('검측');
    if (!P()) return needProject();
    const list = applyFilter(byP(S.inspections), 'insp', i => [i.docNo, i.trade, locStr(i), i.matters, i.requester, i.inspector].join(' ')).sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
    return `<button class="btn primary block" onclick="App.newInsp()">+ 검측요청서 작성</button>${filterBar('insp', { status: ISTAT, date: true })}
      <p class="muted small">${list.length}건</p>${list.length ? `<div class="card list">${list.map(inspRow).join('')}</div>` : '<p class="muted">검측 기록이 없습니다.</p>'}`;
  }
  function vInspNew(tplId) {
    setTitle('검측요청서 작성', '#/insp');
    if (!P()) return needProject();
    const t0 = S.templates.find(t => t.id === tplId);
    return `<div class="card form"><label>공종 / 체크리스트<select id="nTpl">${S.templates.map(t => `<option value="${t.id}" ${t0 && t0.id === t.id ? 'selected' : ''}>[${esc(t.trade)}] ${esc(t.name)}</option>`).join('')}</select></label>
      ${locFields({}, 'n')}
      <label>검측 요구일<input type="date" id="nDate" value="${today()}"></label>
      <button class="btn primary block" onclick="App.createInsp()">체크리스트 불러오기 →</button></div>`;
  }
  function docNo() { const d = today().replace(/-/g, ''); const n = S.inspections.filter(i => i.docNo && i.docNo.includes(d)).length + 1; return `검측-${d}-${String(n).padStart(3, '0')}`; }
  function vInsp(id) {
    const i = S.inspections.find(x => x.id === id); if (!i) return notFound();
    setTitle('검측요청서', '#/insp');
    const ed = i.status === '작성중', mark = i.status === '작성중' || i.status === '검측요청';
    const cnt = r => i.items.filter(x => x.result === r).length;
    const left = i.items.filter(x => !x.result).length;
    const parent = i.parentId && S.inspections.find(x => x.id === i.parentId);
    const child = S.inspections.filter(x => x.parentId === i.id);
    return `<div class="card"><div class="row between"><div><div class="muted small">${esc(i.docNo)}${parent ? ` · 원본 <a href="#/insp/${parent.id}">${esc(parent.docNo)}</a>` : ''}</div><h2>${esc(i.trade)} ${i.parentId ? '<span class="red">(재)</span>' : ''}</h2></div>${badge(i.status)}</div>
      <div class="flow">${['작성중', '검측요청', i.status === '반려' ? '반려' : '승인'].map(s => `<span class="${s === i.status ? 'on' : ''}">${s}</span>`).join('<i>→</i>')}${child.length ? `<i>→</i><span>재검측</span>` : ''}</div></div>
    <div class="card form"><h3>기본 정보</h3>
      ${ed ? locFields(i, 'e') : `<p><b>위치</b> ${esc(locStr(i) || '-')}</p>`}
      <div class="grid2"><label>검측 요구일<input type="date" id="eDate" value="${esc(i.date)}" ${ed ? '' : 'disabled'}></label><label>체크리스트<input value="${esc(i.tplName)}" disabled></label></div>
      <label>검측 요청사항<textarea id="eMatters" rows="2" ${ed ? '' : 'disabled'} placeholder="예: 15층 슬래브 철근 배근 완료, 타설 전 검측 요청">${esc(i.matters || '')}</textarea></label></div>
    ${inspDrawingsHtml(i, i.status !== '승인')}
    <div class="card"><div class="row between"><h3>체크리스트</h3><span class="muted small">적합 ${cnt('적합')} · 부적합 <span class="red">${cnt('부적합')}</span> · N/A ${cnt('해당없음')} · 미기입 ${left}</span></div>
      ${mark ? `<div class="row"><button class="btn sm ghost" onclick="App.markAll('${i.id}')">미기입 항목 모두 적합</button></div>` : ''}
      <ol class="checks">${i.items.map((x, k) => `<li class="${x.result === '부적합' ? 'bad' : ''}"><div class="ct">${esc(x.text)}${x.std ? `<div class="std">기준: ${esc(x.std)}</div>` : ''}</div>
        <div class="seg">${RESULTS.map(r => `<button class="${x.result === r ? 'on r-' + r : ''}" ${mark ? '' : 'disabled'} onclick="App.setRes('${i.id}',${k},'${r}')">${r === '해당없음' ? 'N/A' : r}</button>`).join('')}</div>
        <input class="note" placeholder="비고" value="${esc(x.note || '')}" ${mark ? '' : 'disabled'} onchange="App.setNote('${i.id}',${k},this.value)"></li>`).join('')}</ol></div>
    <div class="card"><h3>사진 (${(i.photoIds || []).length})</h3>${mark ? photoInput('insp') : ''}${thumbs(i.photoIds, 'insp', mark)}</div>
    <div class="card form"><h3>확인 / 서명</h3><div class="grid2"><label>요청자(시공)<input id="eReq" value="${esc(i.requester || S.settings.author || '')}" ${ed ? '' : 'disabled'}></label><label>검측자(감리)<input id="eIns" value="${esc(i.inspector || '')}" ${i.status === '승인' ? 'disabled' : ''}></label></div>
      <label>검측자 의견<textarea id="eOp" rows="2" ${i.status === '승인' ? 'disabled' : ''}>${esc(i.opinion || '')}</textarea></label></div>
    <div class="actions">
      ${ed ? `<button class="btn" onclick="App.saveInsp('${i.id}')">저장</button><button class="btn primary" onclick="App.requestInsp('${i.id}')">검측 요청</button>` : ''}
      ${i.status === '검측요청' ? `<button class="btn" onclick="App.saveInsp('${i.id}')">저장</button><button class="btn ok" onclick="App.decide('${i.id}','승인')">승인</button><button class="btn danger" onclick="App.decide('${i.id}','반려')">반려</button><button class="btn ghost" onclick="App.backToDraft('${i.id}')">작성중으로</button>` : ''}
      ${i.status === '반려' ? (child.length ? `<a class="btn" href="#/insp/${child[0].id}">재검측 보기</a>` : `<button class="btn primary" onclick="App.reinspect('${i.id}')">재검측 생성</button>`) : ''}
      <button class="btn" onclick="App.saveInsp('${i.id}',true);location.hash='#/insp/${i.id}/print'">🖨 인쇄/PDF</button>
      <button class="btn ghost danger-t" onclick="App.delInsp('${i.id}')">삭제</button></div>
    ${i.history && i.history.length ? `<div class="card"><h3>이력</h3><ul class="hist">${i.history.map(h => `<li><b>${esc(h.status)}</b> · ${esc(h.at)}${h.by ? ' · ' + esc(h.by) : ''}${h.memo ? '<br>' + esc(h.memo) : ''}</li>`).join('')}</ul></div>` : ''}`;
  }
  function vPrint(id) {
    const i = S.inspections.find(x => x.id === id); if (!i) return notFound();
    setTitle('인쇄 미리보기', '#/insp/' + id);
    const p = P() || {};
    const bad = i.items.filter(x => x.result === '부적합');
    const ck = (x, r) => x.result === r ? '●' : '';
    return `<div class="noprint row"><button class="btn primary" onclick="window.print()">🖨 인쇄 / PDF 저장</button><a class="btn" href="#/insp/${i.id}">돌아가기</a></div><p class="noprint muted small">인쇄 대화상자에서 ‘PDF로 저장’을 고르면 PDF 파일이 됩니다. 용지: A4 세로.</p>
    <article class="a4">
      <header class="doc-h"><h1>검 측 요 청 서${i.parentId ? ' <span class="red">(재)</span>' : ''}</h1><div class="doc-no">문서번호: ${esc(i.docNo)}${i.parentId ? `<br>원본: ${esc((S.inspections.find(x => x.id === i.parentId) || {}).docNo || '')}` : ''}</div></header>
      <table class="doc"><tr><th>공사명</th><td colspan="3">${esc(p.name || '')}</td></tr>
        <tr><th>현장 위치</th><td colspan="3">${esc(p.location || '')}</td></tr>
        <tr><th>공종</th><td>${esc(i.trade)}</td><th>검측 요구일</th><td>${esc(i.date)}</td></tr>
        <tr><th>검측 위치</th><td colspan="3">${esc(locStr(i))}</td></tr>
        <tr><th>요청 사항</th><td colspan="3">${esc(i.matters || '')}</td></tr>
        <tr><th>관련 도면</th><td colspan="3">${(i.drawingIds || []).map(id => S.drawings.find(d => d.id === id)).filter(Boolean).map(d => esc([d.info.number, d.info.title, d.info.scale ? '(' + d.info.scale + ')' : ''].filter(Boolean).join(' '))).join('<br>') || '-'}</td></tr>
        <tr><th>진행 상태</th><td>${esc(i.status)}</td><th>체크리스트</th><td>${esc(i.tplName)}</td></tr></table>
      <table class="doc chk"><thead><tr><th style="width:6%">No</th><th>검측 항목</th><th style="width:16%">기준</th><th style="width:8%">적합</th><th style="width:8%">부적합</th><th style="width:8%">N/A</th><th style="width:18%">비고</th></tr></thead>
        <tbody>${i.items.map((x, k) => `<tr><td class="c">${k + 1}</td><td>${esc(x.text)}</td><td class="small">${esc(x.std || '')}</td><td class="c">${ck(x, '적합')}</td><td class="c red">${ck(x, '부적합')}</td><td class="c">${ck(x, '해당없음')}</td><td class="small">${esc(x.note || '')}</td></tr>`).join('')}</tbody></table>
      <table class="doc"><tr><th>부적합 내용</th><td>${bad.length ? bad.map(x => esc(x.text) + (x.note ? ' — ' + esc(x.note) : '')).join('<br>') : '없음'}</td></tr>
        <tr><th>검측자 의견</th><td>${esc(i.opinion || '')}</td></tr>
        <tr><th>검측 결과</th><td>${i.status === '승인' ? '■ 합격 □ 불합격' : i.status === '반려' ? '□ 합격 ■ 불합격' : '□ 합격 □ 불합격'}</td></tr></table>
      <table class="doc sign"><tr><th>구분</th><th>성명</th><th>서명</th><th>일자</th></tr>
        <tr><td>요청자(시공)</td><td>${esc(i.requester || '')}</td><td></td><td>${esc((i.history.find(h => h.status === '검측요청') || {}).at || '')}</td></tr>
        <tr><td>검측자(감리)</td><td>${esc(i.inspector || '')}</td><td></td><td>${esc((i.history.slice().reverse().find(h => h.status === '승인' || h.status === '반려') || {}).at || '')}</td></tr></table>
      ${(i.photoIds || []).length ? `<h3 class="doc-sub">사진대지</h3><div class="doc-photos">${i.photoIds.map((pid, k) => `<figure><img data-pid="${pid}"><figcaption>사진 ${k + 1}. ${esc(locStr(i))}</figcaption></figure>`).join('')}</div>` : ''}
    </article>`;
  }

  /* ---------- 화면: 기록 ---------- */
  function logRow(l) { return `<a class="li" href="#/log/${l.id}"><b>${esc(l.date)}</b> ${l.weather ? '· ' + esc(l.weather) : ''}${l.workers ? ' · 인원 ' + esc(l.workers) : ''}<br><span class="muted small">${esc((l.work || l.memo || '').slice(0, 60))}</span></a>`; }
  function issueRow(x) { return `<a class="li row between" href="#/issue/${x.id}"><span><b>${esc(x.title)}</b><br><span class="muted small">${esc(x.trade || '')} · ${esc(locStr(x) || '위치 미지정')}${x.due ? ' · 기한 ' + esc(x.due) : ''}</span></span>${badge(x.status)}</a>`; }
  function vRecords(tab) {
    tab = tab || 'log'; setTitle('기록');
    if (!P()) return needProject();
    const tabs = `<div class="tabs">${[['log', '📒 작업일지'], ['photo', '📷 사진'], ['issue', '⚠️ 지적사항']].map(([k, n]) => `<a class="${k === tab ? 'on' : ''}" href="#/records/${k}">${n}</a>`).join('')}</div>`;
    if (tab === 'log') {
      const list = applyFilter(byP(S.logs), 'log', l => [l.work, l.memo, l.tomorrow, l.weather].join(' ')).sort((a, b) => b.date.localeCompare(a.date));
      return tabs + `<button class="btn primary block" onclick="location.hash='#/log/new'">+ 작업일지/메모 작성</button>
        <div class="filters"><input type="search" placeholder="검색어" value="${esc(filt.log.q || '')}" onchange="App.setFilter('log','q',this.value)"><input type="date" value="${esc(filt.log.date || '')}" onchange="App.setFilter('log','date',this.value)"></div>
        ${list.length ? `<div class="card list">${list.map(logRow).join('')}</div>` : '<p class="muted">작업일지가 없습니다.</p>'}`;
    }
    if (tab === 'issue') {
      const list = applyFilter(byP(S.issues), 'issue', x => [x.title, x.desc, x.action, locStr(x)].join(' ')).sort((a, b) => XSTAT.indexOf(a.status) - XSTAT.indexOf(b.status) || b.createdAt - a.createdAt);
      return tabs + `<button class="btn primary block" onclick="location.hash='#/issue/new'">+ 지적사항(부적합) 등록</button>${filterBar('issue', { status: XSTAT })}
        <p class="muted small">${list.length}건 · 미조치 ${list.filter(x => x.status === '미조치').length} · 조치중 ${list.filter(x => x.status === '조치중').length}</p>
        ${list.length ? `<div class="card list">${list.map(issueRow).join('')}</div>` : '<p class="muted">지적사항이 없습니다.</p>'}`;
    }
    return tabs + `<div class="card form"><h3>사진 추가</h3><p class="muted small">아래 위치·공종이 사진에 함께 기록됩니다.</p>${locFields(filt.photoNew || {}, 'g')}
      <div class="grid2"><label>공종<select id="gTrade"><option value="">선택</option>${trades().map(t => `<option ${(filt.photoNew || {}).trade === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label><label>설명<input id="gCap" placeholder="예: 배근 완료"></label></div>${photoInput('gallery')}</div>
      ${filterBar('photo', { date: true })}<div id="gallery"><p class="muted">불러오는 중…</p></div>`;
  }
  async function renderGallery() {
    const el = $('#gallery'); if (!el) return;
    const all = (await DB.allPhotos()).filter(p => p.projectId === S.cur);
    all.forEach(p => photoCache.set(p.id, p));
    const list = applyFilter(all, 'photo', p => [p.caption, locStr(p), p.trade, p.refLabel].join(' ')).sort((a, b) => b.createdAt - a.createdAt);
    if (!list.length) { el.innerHTML = '<p class="muted">사진이 없습니다.</p>'; return; }
    const groups = {}; list.forEach(p => (groups[p.date] = groups[p.date] || []).push(p));
    el.innerHTML = `<p class="muted small">${list.length}장</p>` + Object.keys(groups).map(d => `<h4 class="gdate">${esc(d)}</h4><div class="gal">${groups[d].map(p => `<figure onclick="App.viewPhoto('${p.id}')"><img src="${p.data}" alt=""><figcaption>${esc([p.trade, locStr(p)].filter(Boolean).join(' · ') || '-')}${p.caption ? '<br>' + esc(p.caption) : ''}${p.refLabel ? `<br><span class="muted">${esc(p.refLabel)}</span>` : ''}</figcaption></figure>`).join('')}</div>`).join('');
  }
  function vLog(id) {
    const isNew = id === 'new';
    const l = isNew ? (App._draftLog = App._draftLog || { id: uid(), projectId: S.cur, date: today(), weather: '', workers: '', work: '', tomorrow: '', memo: '', photoIds: [], _new: true }) : S.logs.find(x => x.id === id);
    if (!l) return notFound();
    setTitle(isNew ? '작업일지 작성' : '작업일지', '#/records/log');
    return `<div class="card form"><div class="grid2"><label>일자<input type="date" id="lDate" value="${esc(l.date)}"></label><label>날씨<input id="lWeather" list="wlist" value="${esc(l.weather)}" placeholder="맑음 / 비 / 영하"></label></div>
      <label>투입 인원·장비<input id="lWorkers" value="${esc(l.workers)}" placeholder="예: 철근 12, 형틀 15, 펌프카 1"></label>
      <label>금일 작업 내용<textarea id="lWork" rows="4" placeholder="예: 101동 15층 벽체 철근 배근, 슬래브 거푸집">${esc(l.work)}</textarea></label>
      <label>명일 작업 계획<textarea id="lTom" rows="2">${esc(l.tomorrow)}</textarea></label>
      <label>메모 / 특이사항(안전·민원·지시)<textarea id="lMemo" rows="3">${esc(l.memo)}</textarea></label></div>
    <div class="card"><h3>사진</h3>${photoInput('log')}${thumbs(l.photoIds, 'log', true)}</div>
    <div class="actions"><button class="btn primary" onclick="App.saveLog()">저장</button>${isNew ? '' : `<button class="btn ghost danger-t" onclick="App.delLog('${l.id}')">삭제</button>`}</div>`;
  }
  function vIssue(id) {
    const isNew = id === 'new';
    const x = isNew ? (App._draftIssue = App._draftIssue || { id: uid(), projectId: S.cur, title: '', desc: '', trade: '', status: '미조치', due: '', action: '', photoIds: [], actionPhotoIds: [], createdAt: Date.now(), _new: true }) : S.issues.find(v => v.id === id);
    if (!x) return notFound();
    setTitle(isNew ? '지적사항 등록' : '지적사항', '#/records/issue');
    const insp = x.inspectionId && S.inspections.find(v => v.id === x.inspectionId);
    return `<div class="card form">${insp ? `<p class="muted small">출처: <a href="#/insp/${insp.id}">${esc(insp.docNo)}</a></p>` : ''}
      <label>지적 내용(제목)<input id="xTitle" value="${esc(x.title)}" placeholder="예: 슬래브 하부 피복두께 부족"></label>
      <label>상세<textarea id="xDesc" rows="3">${esc(x.desc)}</textarea></label>
      ${locFields(x, 'x')}
      <div class="grid2"><label>공종<select id="xTrade"><option value="">선택</option>${trades().map(t => `<option ${x.trade === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label><label>조치 기한<input type="date" id="xDue" value="${esc(x.due)}"></label></div>
      <label>조치 상태<div class="seg wide">${XSTAT.map(s => `<button class="${x.status === s ? 'on s-' + s : ''}" onclick="App.setIssueStat('${s}')">${s}</button>`).join('')}</div></label>
      <label>조치 내용<textarea id="xAction" rows="2" placeholder="예: 스페이서 보강 후 재확인">${esc(x.action)}</textarea></label></div>
    <div class="card"><h3>지적 사진</h3>${photoInput('issue')}${thumbs(x.photoIds, 'issue', true)}<h3>조치 사진</h3>${photoInput('issueAct')}${thumbs(x.actionPhotoIds, 'issueAct', true)}</div>
    <div class="actions"><button class="btn primary" onclick="App.saveIssue()">저장</button>${isNew ? '' : `<button class="btn ghost danger-t" onclick="App.delIssue('${x.id}')">삭제</button>`}</div>`;
  }

  /* ---------- 화면: 템플릿 ---------- */
  function vTpls() {
    setTitle('검측 체크리스트 템플릿', '#/more');
    const g = {}; S.templates.forEach(t => (g[t.trade] = g[t.trade] || []).push(t));
    return `<p class="muted small">기준 수치가 현장마다 다른 항목은 <b>${esc(D.CHECK)}</b>로 표시했습니다. 현장 시방서 값으로 고쳐 쓰세요.</p>
      <div class="row"><button class="btn primary" onclick="App.newTpl()">+ 새 템플릿</button><button class="btn ghost" onclick="App.resetTpls()">기본 템플릿 복원</button></div>
      ${Object.keys(g).map(tr => `<div class="card"><h3>${esc(tr)}</h3>${g[tr].map(t => `<a class="li row between" href="#/tpl/${t.id}"><span>${esc(t.name)}</span><span class="muted small">${t.items.length}항목 ›</span></a>`).join('')}</div>`).join('')}`;
  }
  function vTpl(id) {
    const t = S.templates.find(x => x.id === id); if (!t) return notFound();
    setTitle('템플릿 편집', '#/tpl');
    return `<div class="card form"><div class="grid2"><label>공종<input id="tTrade" list="tradelist" value="${esc(t.trade)}" onchange="App.tplMeta('${t.id}')"></label><label>이름<input id="tName" value="${esc(t.name)}" onchange="App.tplMeta('${t.id}')"></label></div></div>
    <div class="card"><h3>항목 (${t.items.length})</h3><ol class="tpl-items">${t.items.map((x, k) => `<li><textarea rows="2" onchange="App.tplItem('${t.id}',${k},'text',this.value)">${esc(x.text)}</textarea>
        <input placeholder="기준(예: ${esc(D.CHECK)})" value="${esc(x.std)}" onchange="App.tplItem('${t.id}',${k},'std',this.value)">
        <div class="row"><button class="btn sm ghost" onclick="App.tplMove('${t.id}',${k},-1)">▲</button><button class="btn sm ghost" onclick="App.tplMove('${t.id}',${k},1)">▼</button><button class="btn sm ghost danger-t" onclick="App.tplDel('${t.id}',${k})">삭제</button></div></li>`).join('')}</ol>
      <div class="form"><textarea id="tNew" rows="2" placeholder="새 항목 내용"></textarea><input id="tNewStd" placeholder="기준 (선택)"><button class="btn primary" onclick="App.tplAdd('${t.id}')">+ 항목 추가</button></div></div>
    <div class="actions"><button class="btn primary" onclick="App.newInsp('${t.id}')">이 템플릿으로 검측</button><button class="btn" onclick="App.dupTpl('${t.id}')">복제</button><button class="btn ghost danger-t" onclick="App.delTpl('${t.id}')">템플릿 삭제</button></div>`;
  }

  /* ---------- 화면: 더보기/설정 ---------- */
  function vMore() {
    setTitle('더보기');
    return `<div class="card list"><a class="li" href="#/drawings">🗂 도면 (올리면 정보 자동 인식)</a><a class="li" href="#/tpl">✅ 검측 체크리스트 템플릿 관리</a><a class="li" href="#/settings">🏗 현장 관리 · 백업</a><a class="li" href="#/stages">📋 단계별 공정 가이드</a><a class="li" href="#/help">❓ 사용법 · 설치 방법</a></div>`;
  }
  function vSettings() {
    setTitle('현장 · 설정 · 백업', '#/more');
    return `<div class="card"><h3>현장 목록</h3>${S.projects.length ? S.projects.map(p => `<div class="li row between"><span><b>${esc(p.name)}</b> ${p.id === S.cur ? '<span class="badge b-승인">사용 중</span>' : ''}<br><span class="muted small">${esc(p.location || '')} · ${p.dongs.map(d => esc(d.name)).join(', ')}</span></span><span>${p.id === S.cur ? '' : `<button class="btn sm" onclick="App.useProject('${p.id}')">선택</button>`} <button class="btn sm ghost" onclick="location.hash='#/project/${p.id}'">편집</button></span></div>`).join('') : '<p class="muted">등록된 현장이 없습니다.</p>'}
      <button class="btn primary" onclick="location.hash='#/project/new'">+ 현장 등록</button></div>
    <div class="card form"><h3>사용자</h3><label>내 이름(검측요청서 요청자 기본값)<input id="sAuthor" value="${esc(S.settings.author)}" onchange="App.setAuthor(this.value)"></label></div>
    <div class="card"><h3>데이터 백업</h3><p class="muted small">모든 데이터는 이 기기 브라우저에만 저장됩니다. 기기 변경·브라우저 데이터 삭제 전에 꼭 백업하세요. (사진 포함 JSON)</p>
      <div class="row"><button class="btn primary" onclick="App.exportJSON()">⬇ 백업 내보내기</button><label class="btn">⬆ 백업 가져오기<input type="file" accept="application/json,.json" hidden onchange="App.importJSON(this)"></label></div>
      <p class="muted small" id="usage"></p></div>
    <div class="card"><h3>초기화</h3><button class="btn ghost danger-t" onclick="App.wipe()">모든 데이터 삭제</button></div>`;
  }
  function vProject(id) {
    const isNew = id === 'new'; const p = isNew ? { name: '', location: '', dongs: [{ name: '101동', minF: -2, maxF: 15, units: 4 }] } : S.projects.find(x => x.id === id);
    if (!p) return notFound();
    setTitle(isNew ? '현장 등록' : '현장 편집', S.projects.length ? '#/settings' : '#/');
    App._dongs = JSON.parse(JSON.stringify(p.dongs));
    return `<div class="card form"><label>현장명<input id="pName" value="${esc(p.name)}" placeholder="예: ○○ 공동주택 신축공사"></label>
      <label>위치<input id="pLoc" value="${esc(p.location)}" placeholder="예: 서울시 ○○구 ○○동"></label></div>
    <div class="card"><h3>동 / 층 / 호 구조</h3><p class="muted small">지하층은 음수(예: -2 = B2). 호수는 층마다 01~N호로 자동 생성(예: 15층 4개 → 1501~1504호).</p><div id="dongs">${dongRows()}</div>
      <div class="row"><button class="btn sm" onclick="App.addDong()">+ 동 추가</button><button class="btn sm ghost" onclick="App.addDongs()">여러 동 한번에</button></div></div>
    <div class="actions"><button class="btn primary" onclick="App.saveProject('${isNew ? '' : p.id}')">저장</button>${isNew ? '' : `<button class="btn ghost danger-t" onclick="App.delProject('${p.id}')">현장 삭제</button>`}</div>`;
  }
  function dongRows() {
    return `<div class="dong hdr"><span>동 이름</span><span>최하층</span><span>최상층</span><span>층당 호수</span><span></span></div>` + App._dongs.map((d, k) => `<div class="dong"><input value="${esc(d.name)}" onchange="App._dongs[${k}].name=this.value.trim()"><input type="number" value="${d.minF}" onchange="App._dongs[${k}].minF=+this.value"><input type="number" value="${d.maxF}" onchange="App._dongs[${k}].maxF=+this.value"><input type="number" min="0" value="${d.units}" onchange="App._dongs[${k}].units=+this.value"><button class="icon" onclick="App.rmDong(${k})">🗑</button></div>`).join('');
  }
  function vHelp() {
    setTitle('사용법', '#/more');
    return `<div class="card"><h3>휴대폰에 설치</h3><ol><li>앱 주소(https)를 휴대폰 크롬/사파리로 엽니다.</li><li>안드로이드 크롬: 메뉴(⋮) → <b>홈 화면에 추가 / 앱 설치</b>. 아이폰 사파리: 공유 → <b>홈 화면에 추가</b>.</li><li>한 번 연 뒤에는 인터넷 없이도 열립니다.</li></ol></div>
    <div class="card"><h3>기본 흐름</h3><ol><li>현장 등록(동·층·호)</li><li>공정 탭에서 현재 단계의 할 일 체크</li><li>검측 탭 → 공종·위치 선택 → 체크리스트 적합/부적합 기입 → 사진 → <b>검측 요청</b></li><li>감리 확인 후 <b>승인</b> 또는 <b>반려</b> (반려 시 부적합 항목이 지적사항으로 자동 등록, 재검측 생성)</li><li>인쇄/PDF로 A4 검측요청서 출력</li><li>기록 탭에서 작업일지·사진·지적사항 조치 관리</li><li>더보기 → 도면: PDF/사진을 올리면 공사명·도면번호·동·층·호·공종을 자동 인식 → 확인 후 현장 정보·구조에 반영, 검측요청서에 관련 도면으로 연결</li></ol></div>
    <div class="card"><h3>주의</h3><p class="muted">데이터는 이 기기에만 저장됩니다(서버 없음). 설정 → 백업 내보내기로 주기적으로 보관하세요. 체크리스트 기준 수치는 반드시 현장 설계도서·시방서로 확인하세요.</p></div>`;
  }
  const needProject = () => `<div class="card"><p>먼저 현장을 등록하세요.</p><button class="btn primary" onclick="location.hash='#/project/new'">+ 현장 등록</button></div>`;
  const notFound = () => { setTitle('없음', '#/'); return '<div class="card"><p>항목을 찾을 수 없습니다.</p><a class="btn" href="#/">홈으로</a></div>'; };

  /* ---------- 화면: 도면 ---------- */
  const DISCS = ['건축', '구조', '기계설비', '전기', '소방', '통신', '토목', '조경'];
  const CONF = { high: ['높음', 'c-high'], mid: ['보통', 'c-mid'], low: ['낮음', 'c-low'] };
  const fOrder = x => x === 'PH' ? 1000 : x === '옥상' ? 1001 : /^B\d+$/.test(x) ? -parseInt(x.slice(1), 10) : parseInt(x, 10) || 2000;
  function fmtFloors(arr) { // ['3F','4F',...,'15F','PH'] → '3F~15F, PH'
    const a = (arr || []).slice().sort((x, y) => fOrder(x) - fOrder(y)); const out = []; let i = 0;
    while (i < a.length) { let j = i; while (j + 1 < a.length && fOrder(a[j + 1]) === fOrder(a[j]) + 1 && fOrder(a[j]) < 999 && !(fOrder(a[j]) === -1 && fOrder(a[j + 1]) === 0)) j++; out.push(j - i >= 2 ? a[i] + '~' + a[j] : a.slice(i, j + 1).join(', ')); i = j + 1; }
    return out.join(', ');
  }
  function normFloor(t) { t = t.trim().toUpperCase().replace(/\s/g, ''); let m; if ((m = t.match(/^(?:B|지하)(\d+)(?:F|층)?$/))) return 'B' + (+m[1]); if ((m = t.match(/^(\d+)(?:F|층)?$/))) return +m[1] ? (+m[1]) + 'F' : ''; if (/^(PH|옥탑)/.test(t)) return 'PH'; if (/^(옥상|지붕|ROOF)/.test(t)) return '옥상'; return ''; }
  function parseFloors(s) {
    const out = [];
    String(s || '').split(/[,\s]+/).filter(Boolean).forEach(tok => {
      const r = tok.split(/[~∼]/);
      if (r.length === 2) { const a = fOrder(normFloor(r[0])), b = fOrder(normFloor(r[1])); if (a < 999 && b < 999 && b >= a && b - a <= 120) { for (let n = a; n <= b; n++) if (n) out.push(n < 0 ? 'B' + (-n) : n + 'F'); return; } }
      const f = normFloor(tok); if (f) out.push(f);
    });
    return Array.from(new Set(out)).sort((x, y) => fOrder(x) - fOrder(y));
  }
  const splitList = (s, suf) => Array.from(new Set(String(s || '').split(/[,\s]+/).map(x => x.trim()).filter(Boolean).map(x => suf && /^\d+$/.test(x) ? x + suf : x)));
  function drwLabel(d) { return [d.info.number, d.info.title].filter(Boolean).join(' ') || d.fileName; }
  function drwTags(d, small) {
    const t = d.tags || {}; const c = [];
    (t.dongs || []).forEach(x => c.push(x)); if ((t.floors || []).length) c.push(fmtFloors(t.floors)); if ((t.hos || []).length) c.push(t.hos.length > 3 ? t.hos[0] + ' 외 ' + (t.hos.length - 1) : t.hos.join(', '));
    (t.trades || []).forEach(x => c.push(x)); if (d.info.discipline) c.unshift(d.info.discipline);
    return c.length ? `<div class="chips ${small ? 'sm' : ''}">${c.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : '<div class="muted small">태그 없음</div>';
  }
  function drwRow(d) {
    return `<a class="drw" href="#/drawing/${d.id}${d.status === '확인필요' ? '/review' : ''}">${d.thumb ? `<img src="${d.thumb}" alt="">` : '<span class="nothumb">📄</span>'}<div><b>${esc(d.info.number || '')}</b> ${esc(d.info.title || d.fileName)}<br>${d.status === '인식중' ? '' : drwTags(d, true)}<span class="muted small">${esc(d.fileName)}${d.pages > 1 ? ' · ' + d.pages + '쪽' : ''}</span> ${d.status === '확인완료' ? '' : `<span class="badge b-${d.status === '인식실패' ? '반려' : '검측요청'}" id="ds-${d.id}">${esc(d.statusText || d.status)}</span>`}</div></a>`;
  }
  function vDrawings() {
    setTitle('도면', '#/more');
    const f = filt.drw; const p = P();
    let list = (S.drawings || []).filter(d => d.projectId === S.cur || (!S.cur && !d.projectId));
    list = list.filter(d => { const t = d.tags || {}; return (!f.dong || (t.dongs || []).includes(f.dong)) && (!f.floor || (t.floors || []).includes(f.floor)) && (!f.trade || (t.trades || []).includes(f.trade)) && (!f.q || [d.info.number, d.info.title, d.fileName].join(' ').toLowerCase().includes(f.q.toLowerCase())); }).sort((a, b) => (a.info.number || '~').localeCompare(b.info.number || '~'));
    const pend = list.filter(d => d.status === '확인필요').length;
    return `<div class="card"><h3>도면 올리기</h3><p class="muted small">PDF·사진(JPG/PNG)을 여러 개 한꺼번에 올릴 수 있습니다. 표제란의 공사명·도면명·도면번호·축척·동·층·호수·공종을 자동으로 읽어 <b>확인 화면</b>을 보여 줍니다. 확인 전에는 현장 정보를 바꾸지 않습니다.</p>
      <label class="btn primary block">📤 도면 파일 선택<input type="file" id="drwInput" accept="application/pdf,.pdf,image/*" multiple hidden onchange="App.onDrawings(this)"></label>
      <p class="muted small">※ CAD에서 내보낸 PDF는 글자를 바로 읽습니다(오프라인 가능). 스캔 PDF·사진은 OCR을 쓰며, <b>OCR은 처음 한 번 인터넷 연결이 필요</b>합니다(엔진·한글 데이터 약 수 MB 내려받은 뒤 기기에 저장).</p><div id="drwProg"></div></div>
      ${pend ? `<p class="small"><span class="badge b-검측요청">확인 필요 ${pend}</span> 인식 결과를 확인해 주세요.</p>` : ''}
      <div class="filters"><input type="search" placeholder="도면번호·도면명 검색" value="${esc(f.q || '')}" onchange="App.setFilter('drw','q',this.value)">
      <select onchange="App.setFilter('drw','dong',this.value)"><option value="">전체 동</option>${(p ? p.dongs.map(d => d.name) : []).concat(Array.from(new Set((S.drawings || []).flatMap(d => (d.tags || {}).dongs || [])))).filter((v, i, a) => a.indexOf(v) === i).map(x => `<option ${f.dong === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      <select onchange="App.setFilter('drw','floor',this.value)"><option value="">전체 층</option>${Array.from(new Set((S.drawings || []).flatMap(d => (d.tags || {}).floors || []))).sort((a, b) => fOrder(a) - fOrder(b)).map(x => `<option ${f.floor === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      <select onchange="App.setFilter('drw','trade',this.value)"><option value="">전체 공종</option>${trades().map(x => `<option ${f.trade === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
      ${Object.values(f).some(Boolean) ? `<button class="btn sm ghost" onclick="App.clearFilter('drw')">필터 초기화</button>` : ''}</div>
      <p class="muted small">${list.length}장</p>${list.length ? `<div class="card list">${list.map(drwRow).join('')}</div>` : '<p class="muted">도면이 없습니다.</p>'}`;
  }
  function vDrawing(id) {
    const d = (S.drawings || []).find(x => x.id === id); if (!d) return notFound();
    setTitle(d.info.number || '도면 보기', '#/drawings');
    return `<div class="card"><div class="row between"><div><b>${esc(d.info.number || '')}</b> ${esc(d.info.title || d.fileName)}<div class="muted small">${esc([d.info.scale, d.info.projectName].filter(Boolean).join(' · '))}</div></div></div>${drwTags(d)}</div>
      <div class="dtool"><button class="btn sm" onclick="DRW.pageTo(-1)">◀</button><span id="dpage">-</span><button class="btn sm" onclick="DRW.pageTo(1)">▶</button><span class="sp"></span><button class="btn sm" onclick="DRW.zoomOut()">－</button><button class="btn sm" id="dzoom" onclick="DRW.fit()">맞춤</button><button class="btn sm" onclick="DRW.zoomIn()">＋</button></div>
      <div class="dview" id="dview"><p class="muted">도면 불러오는 중…</p></div>
      <p class="muted small">두 손가락으로 확대, 한 손가락으로 이동, 두 번 탭하면 2배 확대.</p>
      <div class="actions"><a class="btn primary" href="#/drawing/${d.id}/review">🔎 인식 결과 확인·수정</a><button class="btn" onclick="App.dlDrawing('${d.id}')">⬇ 원본 저장</button><button class="btn ghost danger-t" onclick="App.delDrawing('${d.id}')">삭제</button></div>`;
  }
  async function mountViewer(id) {
    const d = S.drawings.find(x => x.id === id); const el = $('#dview'); if (!d || !el) return;
    const f = await DB.getFile(id); if (!f) { el.innerHTML = '<p class="muted">원본 파일이 없습니다.</p>'; return; }
    try { await DRW.view(el, f.blob, d.mime, i => { const a = $('#dpage'), z = $('#dzoom'); if (a) a.textContent = `${i.page}/${i.pages}`; if (z) z.textContent = Math.round(i.zoom * 100) + '%'; }); }
    catch (e) { console.warn(e); el.innerHTML = '<p class="red">도면을 표시하지 못했습니다: ' + esc(e.message) + '</p>'; }
  }
  function confTag(fl) { if (!fl) return '<span class="conf c-none">인식 안 됨</span>'; const c = CONF[fl.conf] || CONF.low; return `<span class="conf ${c[1]}" title="${esc(fl.why || '')}">${c[0]}</span><span class="muted small"> ${esc(fl.why || '')}</span>`; }
  function planStruct(p, dongs, floors, hos, unitsHint) {
    const nums = floors.map(fOrder).filter(n => n < 999);
    let units = Math.max(unitsHint || 0, ...hos.map(h => parseInt(h, 10) % 100).filter(n => n > 0 && n < 100), 0);
    const ref = p && p.dongs[0] ? p.dongs[0] : null;
    const adds = [], mods = [];
    dongs.forEach(name => {
      const ex = p && p.dongs.find(x => x.name === name);
      if (!ex) {
        const minF = nums.length ? Math.min(Math.min(...nums), ref ? ref.minF : 1) : (ref ? ref.minF : -1);
        const maxF = nums.length ? Math.max(Math.max(...nums), ref ? ref.maxF : 1) : (ref ? ref.maxF : 15);
        adds.push({ name, minF, maxF, units: units || (ref ? ref.units : 4), guessed: !units || !nums.length });
      } else {
        const ch = {}; if (nums.length && Math.min(...nums) < ex.minF) ch.minF = Math.min(...nums); if (nums.length && Math.max(...nums) > ex.maxF) ch.maxF = Math.max(...nums); if (units > ex.units) ch.units = units;
        if (Object.keys(ch).length) mods.push({ name, from: { minF: ex.minF, maxF: ex.maxF, units: ex.units }, to: Object.assign({ minF: ex.minF, maxF: ex.maxF, units: ex.units }, ch) });
      }
    });
    return { adds, mods };
  }
  const fl = n => n < 0 ? 'B' + (-n) : n + 'F';
  function readReview() {
    return {
      projectName: $('#rProj').value.trim(), address: $('#rAddr').value.trim(), title: $('#rTitle').value.trim(), number: $('#rNum').value.trim(), scale: $('#rScale').value.trim(), discipline: $('#rDisc').value,
      trades: $$('.rTrade:checked').map(x => x.value), dongs: splitList($('#rDongs').value, '동'), floors: parseFloors($('#rFloors').value), hos: splitList($('#rHos').value, '호'), units: +$('#rUnits').value || 0
    };
  }
  function reviewApplyHtml(d, v) {
    const p = P(); const pr = d.projectId ? S.projects.find(x => x.id === d.projectId) : p;
    let a = '';
    if (!pr) a = `<label class="chk"><input type="checkbox" id="aNewProj" checked> <b>이 정보로 새 현장 등록</b> — ${esc(v.projectName || '(현장명 없음)')}${v.address ? ' · ' + esc(v.address) : ''}</label>`;
    else {
      const row = (key, label, cur, nv) => !nv || nv === cur ? '' : `<label class="chk"><input type="checkbox" id="${key}" ${cur ? '' : 'checked'}> ${label}: <span class="muted">${esc(cur || '(비어 있음)')}</span> → <b>${esc(nv)}</b>${cur ? ' <span class="red small">(기존 값 바꿈)</span>' : ''}</label>`;
      a = row('aName', '현장명', pr.name, v.projectName) + row('aLoc', '위치', pr.location, v.address);
      if (!a) a = '<p class="muted small">현장 정보와 같거나 새 정보가 없습니다.</p>';
    }
    const plan = planStruct(pr, v.dongs, v.floors, v.hos, v.units);
    let b = '';
    if (!v.dongs.length) b = `<p class="muted small">동이 인식되지 않아 구조 병합은 하지 않습니다. 위 ‘동’ 칸에 입력하면 병합할 수 있습니다.${v.floors.length ? ' (층 태그는 도면에 저장됩니다)' : ''}</p>`;
    else if (!plan.adds.length && !plan.mods.length) b = '<p class="muted small">이미 현장 구조에 모두 있습니다. 추가할 것이 없습니다.</p>';
    else b = `<label class="chk"><input type="checkbox" id="aStruct" checked> <b>현장 동/층/호 구조에 병합</b> (중복 없이 추가·확장만)</label><ul class="small">${plan.adds.map(x => `<li>새 동 <b>${esc(x.name)}</b>: ${fl(x.minF)}~${fl(x.maxF)}, 층당 ${x.units}호${x.guessed ? ' <span class="muted">(인식 안 된 층·호수는 기존 동 기준 — 나중에 현장 편집에서 수정)</span>' : ''}</li>`).join('')}${plan.mods.map(x => `<li><b>${esc(x.name)}</b>: ${fl(x.from.minF)}~${fl(x.from.maxF)}·${x.from.units}호 → <b>${fl(x.to.minF)}~${fl(x.to.maxF)}·${x.to.units}호</b></li>`).join('')}</ul>`;
    return `<h4>① 현장 정보</h4>${a}<h4>② 위치 구조</h4>${b}<h4>③ 도면 태그</h4><p class="small">${v.dongs.length || v.floors.length || v.trades.length ? `이 도면을 <b>${esc([v.dongs.join(', '), fmtFloors(v.floors), v.trades.join(', ')].filter(Boolean).join(' / '))}</b> 검측요청서의 ‘관련 도면’에 띄웁니다.` : '태그가 없으면 검측요청서에 추천되지 않습니다.'}</p>`;
  }
  function vReview(id) {
    const d = (S.drawings || []).find(x => x.id === id); if (!d) return notFound();
    setTitle('자동 인식 결과', '#/drawings');
    const F = d.fields || {}; const I = d.info, T = d.tags || {};
    const pend = S.drawings.filter(x => x.status === '확인필요' && x.id !== id && (x.projectId === S.cur || !x.projectId));
    const fld = (key, label, input) => `<div class="rf"><div class="row between"><span class="rl">${label}</span><span>${confTag(F[key])}</span></div>${input}</div>`;
    const v0 = { projectName: I.projectName || '', address: I.address || '', title: I.title || '', number: I.number || '', scale: I.scale || '', discipline: I.discipline || '', trades: T.trades || [], dongs: T.dongs || [], floors: T.floors || [], hos: T.hos || [], units: T.units || 0 };
    return `<div class="card"><div class="drw head"><img src="${d.thumb || ''}" alt="" onclick="location.hash='#/drawing/${d.id}'"><div><b>${esc(d.fileName)}</b><br><span class="muted small">${d.method === 'ocr' ? 'OCR(이미지 글자 인식)' : 'PDF 글자 추출'} · ${d.pages || 1}쪽 · 인식 줄 ${(d.lines || []).length}개</span><br><a class="small" href="#/drawing/${d.id}">도면 보기 ›</a></div></div>
      ${d.status === '인식실패' ? `<p class="red small">인식 실패: ${esc(d.error || '')}</p>` : ''}
      <p class="muted small">값을 확인하고 틀린 곳은 고쳐 주세요. <span class="conf c-high">높음</span> 표제란 칸 이름 옆에서 읽음 · <span class="conf c-mid">보통</span> 형식으로 추정 · <span class="conf c-low">낮음</span> 간접 추정</p></div>
    <div class="card form" oninput="App.reviewPreview('${d.id}')" onchange="App.reviewPreview('${d.id}')">
      ${fld('projectName', '공사명(현장명)', `<input id="rProj" value="${esc(v0.projectName)}">`)}
      ${fld('address', '대지위치', `<input id="rAddr" value="${esc(v0.address)}">`)}
      ${fld('title', '도면명', `<input id="rTitle" value="${esc(v0.title)}">`)}
      <div class="grid2">${fld('number', '도면번호', `<input id="rNum" value="${esc(v0.number)}">`)}${fld('scale', '축척', `<input id="rScale" value="${esc(v0.scale)}">`)}</div>
      ${fld('discipline', '분야', `<select id="rDisc"><option value="">-</option>${DISCS.map(x => `<option ${x === v0.discipline ? 'selected' : ''}>${x}</option>`).join('')}</select>`)}
      ${fld('trades', '공종 (검측 연결)', `<div class="chips pick">${trades().map(t => `<label><input type="checkbox" class="rTrade" value="${esc(t)}" ${v0.trades.includes(t) ? 'checked' : ''}><span>${esc(t)}</span></label>`).join('')}</div>`)}
      ${fld('dongs', '동', `<input id="rDongs" value="${esc(v0.dongs.join(', '))}" placeholder="예: 101동, 102동">`)}
      ${fld('floors', '층', `<input id="rFloors" value="${esc(fmtFloors(v0.floors))}" placeholder="예: B2, 3F~15F, PH">`)}
      <div class="grid2">${fld('hos', '호수', `<input id="rHos" value="${esc(v0.hos.join(', '))}" placeholder="예: 1501호, 1502호">`)}${fld('units', '층당 호수', `<input id="rUnits" type="number" min="0" value="${v0.units || ''}">`)}</div>
    </div>
    <div class="card" id="rApply">${reviewApplyHtml(d, v0)}</div>
    <div class="actions"><button class="btn primary" onclick="App.applyReview('${d.id}')">✔ 확인하고 적용</button><button class="btn" onclick="App.reparse('${d.id}')">↻ 다시 인식</button></div>
    ${pend.length ? `<p class="small">확인 대기 도면 ${pend.length}장 더 있음</p>` : ''}
    <details class="card"><summary>인식된 원문 보기 (${(d.lines || []).length}줄)</summary><pre class="raw">${esc((d.lines || []).join('\n'))}</pre></details>`;
  }
  function relatedDrawings(i) {
    const out = [];
    (S.drawings || []).filter(d => d.projectId === S.cur && d.status !== '인식중').forEach(d => {
      const t = d.tags || {}; const linked = (i.drawingIds || []).includes(d.id);
      const dn = (t.dongs || []).length ? (t.dongs.includes(i.dong) ? 2 : -99) : 0;
      const fr = (t.floors || []).length ? (t.floors.includes(i.floor) ? 2 : -99) : 0;
      const tr = (t.trades || []).length ? (t.trades.includes(i.trade) ? 3 : -99) : 0;
      const sc = dn + fr + tr;
      if (linked || sc > 0) out.push({ d, sc, linked, full: sc > 0 && tr > 0 && (dn > 0 || fr > 0) });
    });
    return out.sort((a, b) => (b.linked - a.linked) || (b.sc - a.sc));
  }
  function inspDrawingsHtml(i, editable) {
    const r = relatedDrawings(i);
    return `<div class="card"><h3>관련 도면 ${r.filter(x => x.linked).length ? `(${r.filter(x => x.linked).length} 첨부)` : ''}</h3>${r.length ? r.map(x => `<div class="drw sm"><img src="${x.d.thumb || ''}" alt="" onclick="location.hash='#/drawing/${x.d.id}'"><div><label class="chk"><input type="checkbox" ${x.linked ? 'checked' : ''} ${editable ? '' : 'disabled'} onchange="App.linkDrw('${i.id}','${x.d.id}',this.checked)"><span><b>${esc(x.d.info.number || '')}</b> ${esc(x.d.info.title || x.d.fileName)}</span></label>${drwTags(x.d, true)}${x.linked ? '' : '<span class="muted small">추천(위치·공종 일치)</span>'}</div></div>`).join('') : `<p class="muted small">이 위치·공종에 태그된 도면이 없습니다. <a href="#/drawings">도면 올리기 ›</a></p>`}</div>`;
  }

  /* ---------- 라우터 ---------- */
  function route() {
    const h = location.hash.replace(/^#\/?/, '').split('/');
    const [a, b, c] = h; let html, tab = a || 'dash';
    if (a !== 'log' || b !== 'new') App._draftLog = null;
    if (a !== 'issue' || b !== 'new') App._draftIssue = null;
    switch (a || '') {
      case '': case 'dash': html = vDash(); tab = 'dash'; break;
      case 'stages': html = vStages(); tab = 'stages'; break;
      case 'stage': html = vStage(b); tab = 'stages'; break;
      case 'insp': tab = 'insp'; html = !b ? vInspList() : b === 'new' ? vInspNew(c) : c === 'print' ? vPrint(b) : vInsp(b); break;
      case 'records': html = vRecords(b); tab = 'records'; break;
      case 'log': html = vLog(b); tab = 'records'; break;
      case 'issue': html = vIssue(b); tab = 'records'; break;
      case 'tpl': html = b ? vTpl(b) : vTpls(); tab = 'more'; break;
      case 'more': html = vMore(); break;
      case 'settings': html = vSettings(); tab = 'more'; break;
      case 'project': html = vProject(b); tab = 'more'; break;
      case 'help': html = vHelp(); tab = 'more'; break;
      case 'drawings': html = vDrawings(); tab = 'more'; break;
      case 'drawing': html = b && c === 'review' ? vReview(b) : vDrawing(b); tab = 'more'; break;
      default: html = notFound();
    }
    DRW.close();
    $('#main').innerHTML = html;
    document.body.classList.toggle('printing', c === 'print');
    $$('#tabbar a').forEach(x => x.classList.toggle('on', x.dataset.tab === tab));
    hydrate(); if (a === 'records' && b === 'photo') renderGallery();
    if (a === 'settings') usage();
    if (a === 'drawing' && b && c !== 'review') mountViewer(b);
  }
  function rerender() { const y = window.scrollY; route(); window.scrollTo(0, y); }
  async function usage() { try { const e = await navigator.storage.estimate(); const el = $('#usage'); if (el) el.textContent = `사용 중 저장공간: ${(e.usage / 1048576).toFixed(1)}MB / 가용 ${(e.quota / 1048576).toFixed(0)}MB`; } catch (e) { } }

  /* ---------- 액션 ---------- */
  const App = window.App = {
    _dongs: [],
    locChange(pre, which) {
      const p = P(); const dn = $('#' + pre + 'dong').value; const d = p && p.dongs.find(x => x.name === dn);
      const fs = $('#' + pre + 'floor'); const keep = fs.value; const fl = floorsOf(d);
      if (which === 'dong' || !fl.includes(keep)) fs.innerHTML = '<option value="">선택</option>' + fl.map(x => `<option ${x === keep ? 'selected' : ''}>${esc(x)}</option>`).join('');
      $('#' + pre + 'ho').innerHTML = '<option value="">-</option>' + hosOf(d, fs.value).map(x => `<option>${esc(x)}</option>`).join('');
    },
    setFilter(k, f, v) { filt[k][f] = v; if (f === 'dong') filt[k].floor = ''; rerender(); },
    clearFilter(k) { filt[k] = {}; rerender(); },
    preFilter(k) { filt[k] = {}; },
    setCurStage(id) { P().curStage = id; save(); toast('현재 단계로 지정했습니다'); rerender(); },
    toggleTodo(sid, tid, v) { prog(sid).done[tid] = v; save(); rerender(); },
    addTodo(sid) { const v = $('#newTodo').value.trim(); if (!v) return; prog(sid).custom.push({ id: 'c' + uid(), text: v }); save(); rerender(); },
    delTodo(sid, tid, custom) { if (!confirm('이 할 일을 삭제할까요?')) return; const g = prog(sid); if (custom) g.custom = g.custom.filter(c => c.id !== tid); else g.hidden[tid] = true; delete g.done[tid]; save(); rerender(); },
    restoreTodos(sid) { prog(sid).hidden = {}; save(); rerender(); },

    newInsp(tplId) { nav('#/insp/new' + (tplId ? '/' + tplId : '')); },
    createInsp() {
      const t = S.templates.find(x => x.id === $('#nTpl').value); if (!t) return toast('체크리스트를 선택하세요');
      const loc = readLoc('n'); if (!loc.dong) return toast('동을 선택하세요');
      const i = Object.assign({ id: uid(), projectId: S.cur, docNo: docNo(), trade: t.trade, tplId: t.id, tplName: t.name, date: $('#nDate').value || today(), matters: '', status: '작성중', requester: S.settings.author, inspector: '', opinion: '', photoIds: [], createdAt: String(Date.now()), history: [{ status: '작성중', at: nowStr(), by: S.settings.author }], items: t.items.map(x => ({ text: x.text, std: x.std, result: '', note: '' })) }, loc);
      i.drawingIds = relatedDrawings(i).filter(x => x.full).map(x => x.d.id);
      S.inspections.push(i); save(); nav('#/insp/' + i.id);
    },
    linkDrw(iid, did, on) { const i = S.inspections.find(x => x.id === iid); this.collectInsp(i); i.drawingIds = (i.drawingIds || []).filter(x => x !== did); if (on) i.drawingIds.push(did); save(); rerender(); },
    collectInsp(i) {
      if (i.status === '작성중' && $('#edong')) Object.assign(i, readLoc('e'), { date: $('#eDate').value, matters: $('#eMatters').value, requester: $('#eReq').value.trim() });
      if ($('#eIns') && !$('#eIns').disabled) { i.inspector = $('#eIns').value.trim(); i.opinion = $('#eOp').value; }
    },
    saveInsp(id, quiet) { const i = S.inspections.find(x => x.id === id); this.collectInsp(i); save(); if (!quiet) { toast('저장했습니다'); rerender(); } },
    setRes(id, k, r) { const i = S.inspections.find(x => x.id === id); this.collectInsp(i); i.items[k].result = i.items[k].result === r ? '' : r; save(); rerender(); },
    setNote(id, k, v) { S.inspections.find(x => x.id === id).items[k].note = v; save(); },
    markAll(id) { const i = S.inspections.find(x => x.id === id); this.collectInsp(i); i.items.forEach(x => { if (!x.result) x.result = '적합'; }); save(); rerender(); },
    requestInsp(id) {
      const i = S.inspections.find(x => x.id === id); this.collectInsp(i);
      if (!i.dong) return toast('위치(동)를 입력하세요');
      if (!i.requester) return toast('요청자 이름을 입력하세요');
      const left = i.items.filter(x => !x.result).length;
      if (left && !confirm(`자체점검 미기입 항목이 ${left}개 있습니다. 그래도 요청할까요?`)) return;
      i.status = '검측요청'; i.history.push({ status: '검측요청', at: nowStr(), by: i.requester }); save(); toast('검측 요청했습니다'); rerender();
    },
    decide(id, st) {
      const i = S.inspections.find(x => x.id === id); this.collectInsp(i);
      if (!i.inspector) return toast('검측자(감리) 이름을 입력하세요');
      const bad = i.items.filter(x => x.result === '부적합');
      if (st === '승인' && bad.length && !confirm(`부적합 항목 ${bad.length}개가 있습니다. 승인할까요?`)) return;
      let memo = '';
      if (st === '반려') { memo = prompt('반려 사유', bad.map(x => x.text).join(', ')) ; if (memo === null) return; if (!i.opinion) i.opinion = '반려: ' + memo; }
      i.status = st; i.history.push({ status: st, at: nowStr(), by: i.inspector, memo });
      if (st === '반려' && bad.length && confirm(`부적합 ${bad.length}개 항목을 지적사항 목록에 등록할까요?`)) {
        bad.forEach(x => S.issues.push({ id: uid(), projectId: S.cur, title: x.text.slice(0, 60), desc: x.note || '', dong: i.dong, floor: i.floor, ho: i.ho, part: i.part, trade: i.trade, status: '미조치', due: '', action: '', photoIds: [], actionPhotoIds: [], createdAt: Date.now(), inspectionId: i.id }));
      }
      save(); toast(st + ' 처리했습니다'); rerender();
    },
    backToDraft(id) { const i = S.inspections.find(x => x.id === id); i.status = '작성중'; i.history.push({ status: '작성중', at: nowStr(), memo: '요청 회수' }); save(); rerender(); },
    reinspect(id) {
      const o = S.inspections.find(x => x.id === id);
      const n = JSON.parse(JSON.stringify(o));
      const cnt = S.inspections.filter(x => x.docNo.startsWith(o.docNo.replace(/-R\d+$/, ''))).length;
      Object.assign(n, { id: uid(), parentId: o.id, docNo: o.docNo.replace(/-R\d+$/, '') + '-R' + cnt, status: '작성중', date: today(), opinion: '', photoIds: [], createdAt: String(Date.now()), history: [{ status: '작성중', at: nowStr(), memo: '재검측 (원본 ' + o.docNo + ')' }] });
      n.items.forEach(x => { if (x.result === '부적합') { x.note = (x.note ? '[지적] ' + x.note : '[재검측]'); x.result = ''; } });
      S.inspections.push(n); save(); toast('재검측 요청서를 만들었습니다'); nav('#/insp/' + n.id);
    },
    async delInsp(id) {
      if (!confirm('이 검측요청서를 삭제할까요?')) return; const i = S.inspections.find(x => x.id === id);
      for (const p of i.photoIds || []) await DB.delPhoto(p);
      S.inspections = S.inspections.filter(x => x.id !== id); save(); nav('#/insp');
    },

    async onPhoto(ctx, input) {
      const files = input.files; if (!files || !files.length) return;
      toast('사진 처리 중…');
      let target, meta = {}, key = 'photoIds';
      const h = location.hash.split('/');
      if (ctx === 'insp') { target = S.inspections.find(x => x.id === h[2]); this.collectInsp(target); meta = { dong: target.dong, floor: target.floor, ho: target.ho, part: target.part, trade: target.trade, refLabel: '검측 ' + target.docNo, ref: { type: 'insp', id: target.id } }; }
      else if (ctx === 'log') { this.collectLog(); target = App._draftLog || S.logs.find(x => x.id === h[2]); meta = { refLabel: '작업일지 ' + target.date, ref: { type: 'log', id: target.id } }; }
      else if (ctx === 'issue' || ctx === 'issueAct') { this.collectIssue(); target = App._draftIssue || S.issues.find(x => x.id === h[2]); if (ctx === 'issueAct') key = 'actionPhotoIds'; meta = { dong: target.dong, floor: target.floor, ho: target.ho, part: target.part, trade: target.trade, refLabel: (ctx === 'issue' ? '지적 ' : '조치 ') + (target.title || ''), ref: { type: 'issue', id: target.id } }; }
      else if (ctx === 'gallery') { const loc = readLoc('g'); filt.photoNew = Object.assign({}, loc, { trade: $('#gTrade').value }); meta = Object.assign(loc, { trade: $('#gTrade').value, caption: $('#gCap').value.trim() }); }
      const ids = await addPhotos(files, meta);
      if (target) { target[key] = (target[key] || []).concat(ids); save(); }
      toast(`사진 ${ids.length}장 저장`); rerender();
    },
    async rmPhoto(ctx, id) {
      if (!confirm('사진을 삭제할까요?')) return;
      const h = location.hash.split('/'); let target, key = ctx === 'issueAct' ? 'actionPhotoIds' : 'photoIds';
      if (ctx === 'insp') target = S.inspections.find(x => x.id === h[2]);
      else if (ctx === 'log') { this.collectLog(); target = App._draftLog || S.logs.find(x => x.id === h[2]); }
      else { this.collectIssue(); target = App._draftIssue || S.issues.find(x => x.id === h[2]); }
      target[key] = target[key].filter(x => x !== id); await DB.delPhoto(id); photoCache.delete(id); save(); rerender();
    },
    async viewPhoto(id) {
      const p = photoCache.get(id) || await DB.getPhoto(id); if (!p) return;
      const m = $('#modal'); m.innerHTML = `<div class="mbox"><img src="${p.data}"><p>${esc([p.date, p.trade, locStr(p), p.caption, p.refLabel].filter(Boolean).join(' · '))}</p><div class="row"><button class="btn" onclick="App.closeModal()">닫기</button>${p.ref ? '' : `<button class="btn ghost danger-t" onclick="App.delGalleryPhoto('${p.id}')">삭제</button>`}</div></div>`; m.hidden = false;
    },
    closeModal() { $('#modal').hidden = true; },
    async delGalleryPhoto(id) { if (!confirm('사진을 삭제할까요?')) return; await DB.delPhoto(id); photoCache.delete(id); this.closeModal(); rerender(); },

    collectLog() {
      if (!$('#lDate')) return; const h = location.hash.split('/'); const l = App._draftLog || S.logs.find(x => x.id === h[2]); if (!l) return;
      Object.assign(l, { date: $('#lDate').value || today(), weather: $('#lWeather').value.trim(), workers: $('#lWorkers').value.trim(), work: $('#lWork').value, tomorrow: $('#lTom').value, memo: $('#lMemo').value });
    },
    saveLog() {
      this.collectLog(); const l = App._draftLog;
      if (l) { delete l._new; S.logs.push(l); App._draftLog = null; save(); toast('저장했습니다'); nav('#/log/' + l.id); return; }
      save(); toast('저장했습니다'); rerender();
    },
    async delLog(id) { if (!confirm('작업일지를 삭제할까요?')) return; const l = S.logs.find(x => x.id === id); for (const p of l.photoIds) await DB.delPhoto(p); S.logs = S.logs.filter(x => x.id !== id); save(); nav('#/records/log'); },
    collectIssue() {
      if (!$('#xTitle')) return; const h = location.hash.split('/'); const x = App._draftIssue || S.issues.find(v => v.id === h[2]); if (!x) return;
      Object.assign(x, readLoc('x'), { title: $('#xTitle').value.trim(), desc: $('#xDesc').value, trade: $('#xTrade').value, due: $('#xDue').value, action: $('#xAction').value });
    },
    setIssueStat(s) { this.collectIssue(); const h = location.hash.split('/'); const x = App._draftIssue || S.issues.find(v => v.id === h[2]); x.status = s; if (s === '조치완료' && !x.doneAt) x.doneAt = today(); if (!x._new) save(); rerender(); },
    saveIssue() {
      this.collectIssue(); const x = App._draftIssue;
      if (x) { if (!x.title) return toast('지적 내용을 입력하세요'); delete x._new; S.issues.push(x); App._draftIssue = null; save(); toast('등록했습니다'); nav('#/issue/' + x.id); return; }
      save(); toast('저장했습니다'); rerender();
    },
    async delIssue(id) { if (!confirm('지적사항을 삭제할까요?')) return; const x = S.issues.find(v => v.id === id); for (const p of x.photoIds.concat(x.actionPhotoIds || [])) await DB.delPhoto(p); S.issues = S.issues.filter(v => v.id !== id); save(); nav('#/records/issue'); },

    async onDrawings(input) {
      const files = Array.from(input.files || []); input.value = ''; if (!files.length) return;
      const ids = [];
      for (const file of files) {
        const mime = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : /\.(jpe?g|png|webp)$/i.test(file.name) ? 'image/jpeg' : '');
        if (!(mime === 'application/pdf' || mime.startsWith('image/'))) { toast(file.name + ': PDF·이미지만 올릴 수 있습니다'); continue; }
        const d = { id: uid(), projectId: S.cur, fileName: file.name, mime, size: file.size, status: '인식중', statusText: '대기 중', info: {}, tags: {}, fields: {}, createdAt: Date.now() };
        await DB.putFile({ id: d.id, blob: file }); S.drawings.push(d); ids.push(d.id);
      }
      await save(true); rerender();
      for (const id of ids) { await this.runExtract(id); if (location.hash.startsWith('#/drawings')) rerender(); }
      const pg = $('#drwProg'); if (pg) pg.textContent = '';
      if (!ids.length) return;
      if (ids.length > 1) toast(`${ids.length}장 인식 완료 — 차례로 확인해 주세요`);
      const first = ids.map(id => S.drawings.find(x => x.id === id)).find(x => x && x.status === '확인필요') || S.drawings.find(x => x.id === ids[0]);
      nav('#/drawing/' + first.id + '/review');
    },
    async runExtract(id) {
      const d = S.drawings.find(x => x.id === id); const f = await DB.getFile(id); if (!d || !f) return;
      d.status = '인식중';
      const set = t => { d.statusText = t; const el = $('#ds-' + id); if (el) el.textContent = t; const pg = $('#drwProg'); if (pg) pg.textContent = d.fileName + ' — ' + t; };
      try {
        const r = await DRW.extract(f.blob, d.mime, set);
        Object.assign(d, { lines: r.lines.slice(0, 400), method: r.method, pages: r.pages, thumb: r.thumb });
        applyParsed(d); d.status = '확인필요'; delete d.error;
      } catch (e) { console.warn('drawing extract', e); d.status = '인식실패'; d.error = e.message || String(e); }
      d.statusText = ''; await save(true);
    },
    reviewPreview(id) { const d = S.drawings.find(x => x.id === id); const el = $('#rApply'); if (d && el) el.innerHTML = reviewApplyHtml(d, readReview()); },
    applyReview(id) {
      const d = S.drawings.find(x => x.id === id); const v = readReview(); const ck = s => { const e = $(s); return !!(e && e.checked); };
      let pr = d.projectId ? S.projects.find(x => x.id === d.projectId) : P(); const msgs = [];
      if (!pr) {
        if (ck('#aNewProj')) {
          const plan = planStruct(null, v.dongs, v.floors, v.hos, v.units);
          const dongs = plan.adds.map(x => ({ name: x.name, minF: x.minF, maxF: x.maxF, units: x.units }));
          if (!dongs.length) { dongs.push({ name: '101동', minF: -1, maxF: 15, units: 4 }); msgs.push('동 미인식 → 101동 기본값'); }
          pr = { id: uid(), name: v.projectName || '새 현장', location: v.address, dongs, createdAt: Date.now(), curStage: null };
          S.projects.push(pr); S.cur = pr.id; msgs.unshift('새 현장 등록');
        }
      } else {
        if (ck('#aName')) { pr.name = v.projectName; msgs.push('현장명'); }
        if (ck('#aLoc')) { pr.location = v.address; msgs.push('위치'); }
        if (ck('#aStruct')) {
          const plan = planStruct(pr, v.dongs, v.floors, v.hos, v.units);
          plan.adds.forEach(x => pr.dongs.push({ name: x.name, minF: x.minF, maxF: x.maxF, units: x.units }));
          plan.mods.forEach(m => Object.assign(pr.dongs.find(x => x.name === m.name), m.to));
          if (plan.adds.length || plan.mods.length) msgs.push(`구조(동 추가 ${plan.adds.length}·확장 ${plan.mods.length})`);
        }
      }
      if (pr) S.drawings.forEach(x => { if (!x.projectId) x.projectId = pr.id; });
      d.info = { projectName: v.projectName, address: v.address, title: v.title, number: v.number, scale: v.scale, discipline: v.discipline };
      d.tags = { dongs: v.dongs, floors: v.floors, hos: v.hos, trades: v.trades, units: v.units };
      d.status = '확인완료'; save();
      toast('적용: ' + (msgs.length ? msgs.join(', ') + ' + 도면 태그' : '도면 태그 저장'));
      const next = S.drawings.find(x => x.status === '확인필요' && x.projectId === S.cur);
      nav(next ? '#/drawing/' + next.id + '/review' : '#/drawings');
    },
    async reparse(id) { if (!confirm('파일을 다시 읽어 인식합니다. 이 화면에서 고친 값은 사라집니다. 계속할까요?')) return; toast('다시 인식 중…'); await this.runExtract(id); rerender(); },
    async dlDrawing(id) { const d = S.drawings.find(x => x.id === id); const f = await DB.getFile(id); if (!f) return; const a = document.createElement('a'); a.href = URL.createObjectURL(f.blob); a.download = d.fileName; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); },
    async delDrawing(id) { if (!confirm('이 도면을 삭제할까요? (검측요청서의 연결도 해제됩니다)')) return; await DB.delFile(id); S.drawings = S.drawings.filter(x => x.id !== id); S.inspections.forEach(i => { if (i.drawingIds) i.drawingIds = i.drawingIds.filter(x => x !== id); }); save(); nav('#/drawings'); },
    newTpl() { const t = { id: uid(), trade: '기타', name: '새 체크리스트', items: [] }; S.templates.push(t); save(); nav('#/tpl/' + t.id); },
    dupTpl(id) { const o = S.templates.find(x => x.id === id); const t = JSON.parse(JSON.stringify(o)); t.id = uid(); t.name += ' (복사)'; t.builtin = false; t.items.forEach(i => i.id = uid()); S.templates.push(t); save(); nav('#/tpl/' + t.id); },
    delTpl(id) { if (!confirm('템플릿을 삭제할까요? (이미 작성한 검측서는 유지됩니다)')) return; S.templates = S.templates.filter(x => x.id !== id); save(); nav('#/tpl'); },
    resetTpls() { if (!confirm('기본 템플릿을 다시 추가할까요? 내가 만든 템플릿은 유지되고, 수정한 기본 템플릿은 원래대로 바뀝니다.')) return; S.templates = S.templates.filter(t => !t.builtin).concat(defaults().templates); save(); rerender(); },
    tplMeta(id) { const t = S.templates.find(x => x.id === id); t.trade = $('#tTrade').value.trim() || '기타'; t.name = $('#tName').value.trim() || '이름 없음'; save(); toast('저장됨'); },
    tplItem(id, k, f, v) { S.templates.find(x => x.id === id).items[k][f] = v.trim(); save(); toast('저장됨'); },
    tplMove(id, k, d) { const it = S.templates.find(x => x.id === id).items; const j = k + d; if (j < 0 || j >= it.length) return; [it[k], it[j]] = [it[j], it[k]]; save(); rerender(); },
    tplDel(id, k) { if (!confirm('이 항목을 삭제할까요?')) return; S.templates.find(x => x.id === id).items.splice(k, 1); save(); rerender(); },
    tplAdd(id) { const v = $('#tNew').value.trim(); if (!v) return toast('항목 내용을 입력하세요'); S.templates.find(x => x.id === id).items.push({ id: uid(), text: v, std: $('#tNewStd').value.trim() }); save(); rerender(); },

    addDong() { const n = App._dongs.length; const last = App._dongs[n - 1] || { name: '100동', minF: -1, maxF: 15, units: 4 }; const num = parseInt(last.name, 10); App._dongs.push({ name: isNaN(num) ? '' : (num + 1) + '동', minF: last.minF, maxF: last.maxF, units: last.units }); $('#dongs').innerHTML = dongRows(); },
    addDongs() { const s = prompt('추가할 동 이름을 쉼표로 입력 (예: 102동,103동,104동)'); if (!s) return; const last = App._dongs[App._dongs.length - 1] || { minF: -1, maxF: 15, units: 4 }; s.split(/[,\s]+/).filter(Boolean).forEach(n => App._dongs.push({ name: n, minF: last.minF, maxF: last.maxF, units: last.units })); $('#dongs').innerHTML = dongRows(); },
    rmDong(k) { App._dongs.splice(k, 1); $('#dongs').innerHTML = dongRows(); },
    saveProject(id) {
      const name = $('#pName').value.trim(); if (!name) return toast('현장명을 입력하세요');
      const dongs = App._dongs.filter(d => d.name); if (!dongs.length) return toast('동을 1개 이상 입력하세요');
      if (dongs.some(d => d.minF > d.maxF)) return toast('최하층이 최상층보다 클 수 없습니다');
      if (id) { Object.assign(S.projects.find(p => p.id === id), { name, location: $('#pLoc').value.trim(), dongs }); }
      else { const p = { id: uid(), name, location: $('#pLoc').value.trim(), dongs, createdAt: Date.now(), curStage: null }; S.projects.push(p); S.cur = p.id; }
      save(); toast('저장했습니다'); nav('#/');
    },
    useProject(id) { S.cur = id; Object.keys(filt).forEach(k => filt[k] = {}); save(); toast('현장을 변경했습니다'); nav('#/'); },
    async delProject(id) {
      if (!confirm('이 현장과 관련된 검측·기록·사진이 모두 삭제됩니다. 계속할까요?')) return;
      S.projects = S.projects.filter(p => p.id !== id); ['inspections', 'logs', 'issues'].forEach(k => S[k] = S[k].filter(x => x.projectId !== id)); delete S.progress[id];
      for (const p of await DB.allPhotos()) if (p.projectId === id) await DB.delPhoto(p.id);
      for (const d of (S.drawings || []).filter(x => x.projectId === id)) await DB.delFile(d.id);
      S.drawings = (S.drawings || []).filter(x => x.projectId !== id);
      if (S.cur === id) S.cur = S.projects[0] ? S.projects[0].id : null; save(); nav('#/settings');
    },
    setAuthor(v) { S.settings.author = v.trim(); save(); toast('저장됨'); },
    async exportJSON() {
      await save(true);
      const files = [];
      for (const f of await DB.allFiles()) files.push({ id: f.id, mime: f.blob.type, data: await blobToDataURL(f.blob) });
      const data = { app: 'sigong-guide', version: 2, exportedAt: new Date().toISOString(), state: S, photos: await DB.allPhotos(), files };
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `시공관리_백업_${today()}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('백업 파일을 내보냈습니다');
    },
    async importJSON(input) {
      const f = input.files[0]; if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (data.app !== 'sigong-guide' || !data.state) throw new Error('이 앱의 백업 파일이 아닙니다');
        if (!confirm('현재 데이터를 백업 파일 내용으로 바꿀까요? (현재 데이터는 사라집니다)')) return;
        S = Object.assign(defaults(), data.state); await DB.clearPhotos(); photoCache.clear(); Object.keys(filt).forEach(k => filt[k] = {});
        for (const p of data.photos || []) await DB.putPhoto(p);
        await DB.clearFiles();
        for (const f of data.files || []) await DB.putFile({ id: f.id, blob: await (await fetch(f.data)).blob() });
        await save(true); toast('가져오기 완료'); nav('#/'); route();
      } catch (e) { alert('가져오기 실패: ' + e.message); }
      input.value = '';
    },
    async wipe() { if (!confirm('모든 현장·검측·기록·사진을 삭제합니다. 백업하셨나요?')) return; S = defaults(); await DB.clearPhotos(); await DB.clearFiles(); photoCache.clear(); Object.keys(filt).forEach(k => filt[k] = {}); await save(true); nav('#/'); route(); }
  };

  /* ---------- 시작 ---------- */
  async function init() {
    try { S = await DB.get('state'); } catch (e) { console.warn(e); }
    if (!S) { S = defaults(); await save(true); }
    S = Object.assign(defaults(), S);
    $('#back').onclick = () => { const t = $('#back').dataset.to; if (t) nav(t); };
    $('#modal').onclick = e => { if (e.target.id === 'modal') App.closeModal(); };
    document.body.insertAdjacentHTML('beforeend', `<datalist id="partlist">${PARTS.map(p => `<option>${p}</option>`).join('')}</datalist><datalist id="wlist"><option>맑음</option><option>흐림</option><option>비</option><option>눈</option><option>폭염</option><option>한파</option></datalist><datalist id="tradelist">${trades().map(t => `<option>${esc(t)}</option>`).join('')}</datalist>`);
    window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });
    route();
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
  }
  init();
})();
