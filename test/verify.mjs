import { chromium } from 'playwright-core';
import fs from 'node:fs';
const BASE = 'http://127.0.0.1:8899/';
const SHOT = '/workspace/sigong-guide/screenshots/';
const errs = []; const log = (...a) => console.log(...a);
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'], headless: true });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ko-KR', acceptDownloads: true });
const pg = await ctx.newPage();
pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
pg.on('pageerror', e => errs.push('PAGEERR ' + e.message));
pg.on('dialog', d => d.accept(d.type() === 'prompt' ? (d.defaultValue() || '피복두께 부족') : undefined));
const W = ms => pg.waitForTimeout(ms || 250);
await pg.goto(BASE); await W(600);
// project
await pg.click('text=+ 현장 등록'); await W();
await pg.fill('#pName', '효성 ○○ 오피스텔 신축공사'); await pg.fill('#pLoc', '서울시 영등포구');
await pg.click('text=+ 동 추가'); await W();
await pg.click('text=저장'); await W(500);
// author
await pg.goto(BASE + '#/settings'); await W(); await pg.fill('#sAuthor', '이욱진'); await pg.press('#sAuthor', 'Tab'); await W();
// stages: tick some todos
for (const id of ['demo', 'temp', 'earth', 'found']) { await pg.goto(BASE + '#/stage/' + id); await W(); const n = await pg.locator('.todos input').count(); for (let k = 0; k < n; k++) { await pg.locator('.todos input').nth(k).check(); await W(60); } }
await pg.goto(BASE + '#/stage/frame'); await W(); for (let k = 0; k < 4; k++) { await pg.locator('.todos input').nth(k).check(); await W(60); }
await pg.fill('#newTodo', '15층 매립 슬리브 설비팀 확인'); await pg.click('button:has-text("추가")'); await W();
await pg.screenshot({ path: SHOT + '02-stage-frame.png', fullPage: false });
// inspection
await pg.goto(BASE + '#/insp/new'); await W();
const tplVal = await pg.$eval('#nTpl', s => Array.from(s.options).find(o => o.text.includes('철근')).value);
await pg.selectOption('#nTpl', tplVal); await pg.selectOption('#ndong', '101동'); await W(); await pg.selectOption('#nfloor', '15F'); await W(); await pg.selectOption('#nho', '1502호'); await pg.fill('#npart', '슬래브');
await pg.click('text=체크리스트 불러오기'); await W(500);
await pg.fill('#eMatters', '101동 15층 슬래브 철근 배근 완료, 타설 전 검측 요청');
await pg.click('text=미기입 항목 모두 적합'); await W();
await pg.click('.checks li:nth-child(5) .seg button:nth-child(2)'); await W();
await pg.fill('.checks li:nth-child(5) .note', '단변방향 하부근 피복 부족 구간 있음'); await pg.press('.checks li:nth-child(5) .note', 'Tab');
await pg.setInputFiles('input[type=file][onchange*="insp"]', ['rebar.jpg', 'rebar.jpg']); await W(1500);
log('insp photos', await pg.$$eval('.thumbs img', a => a.filter(i => i.src.startsWith('data:')).length));
await pg.evaluate(() => window.scrollTo(0, 0));
await pg.screenshot({ path: SHOT + '03-inspection-checklist.png', fullPage: false });
await pg.screenshot({ path: SHOT + '03b-inspection-full.png', fullPage: true });
await pg.click('button:has-text("검측 요청")'); await W();
await pg.fill('#eIns', '김감리'); await pg.click('button.danger:has-text("반려")'); await W(400);
log('status after 반려', await pg.textContent('.card .badge'));
await pg.click('text=재검측 생성'); await W(400);
log('reinspect docno', await pg.textContent('.card .muted.small'));
await pg.click('.checks li:nth-child(5) .seg button:nth-child(1)'); await W();
await pg.click('button:has-text("검측 요청")'); await W(); await pg.fill('#eIns', '김감리'); await pg.fill('#eOp', '보강 확인, 타설 승인');
await pg.click('button.ok:has-text("승인")'); await W(400);
log('status after 승인', await pg.textContent('.card .badge'));
// print first inspection
await pg.goto(BASE + '#/insp'); await W();
const first = await pg.$$eval('.list a', a => a.map(x => x.getAttribute('href')));
log('insp list', first);
await pg.goto(BASE + first[first.length - 1] + '/print'); await W(2200);
await pg.screenshot({ path: SHOT + '04-inspection-print.png', fullPage: true });
await pg.emulateMedia({ media: 'print' }); await pg.pdf({ path: '/workspace/sigong-guide/test/검측요청서_sample.pdf', format: 'A4', printBackground: true }); await pg.emulateMedia({ media: 'screen' });
// issue list
await pg.goto(BASE + '#/records/issue'); await W(); log('issues', await pg.$$eval('.list a', a => a.length));
await pg.click('.list a'); await W(); await pg.click('.seg.wide button:nth-child(2)'); await W(); await pg.fill('#xAction', '스페이서 추가 설치'); await pg.click('text=저장'); await W();
await pg.goto(BASE + '#/issue/new'); await W(); await pg.fill('#xTitle', '외부 비계 벽이음 누락'); await pg.selectOption('#xdong', '102동'); await W(); await pg.selectOption('#xfloor', '8F'); await pg.selectOption('#xTrade', '가설');
await pg.setInputFiles('input[type=file][onchange*="\'issue\'"]', 'rebar.jpg'); await W(1000);
log('draft title kept', await pg.inputValue('#xTitle'));
await pg.click('button.primary:has-text("저장")'); await W();
await pg.goto(BASE + '#/records/issue'); await W();
await pg.selectOption('.filters select:nth-of-type(1)', '102동'); await W();
log('filtered issues 102동', await pg.$$eval('.list a', a => a.length));
await pg.screenshot({ path: SHOT + '06-issues.png' });
// log
await pg.goto(BASE + '#/log/new'); await W(); await pg.fill('#lWeather', '맑음'); await pg.fill('#lWorkers', '철근 12, 형틀 15'); await pg.fill('#lWork', '101동 15층 슬래브 철근 배근 및 검측');
await pg.setInputFiles('input[type=file][onchange*="log"]', 'rebar.jpg'); await W(1000);
log('log draft work kept', await pg.inputValue('#lWork'));
await pg.click('button.primary:has-text("저장")'); await W();
// gallery
await pg.goto(BASE + '#/records/photo'); await W(); await pg.selectOption('#gdong', '101동'); await W(); await pg.selectOption('#gfloor', 'B1'); await pg.selectOption('#gTrade', '방수'); await pg.fill('#gCap', '지하 외벽 방수');
await pg.setInputFiles('input[type=file][onchange*="gallery"]', 'rebar.jpg'); await W(1200);
log('gallery count', await pg.$$eval('.gal figure', a => a.length));
await pg.screenshot({ path: SHOT + '07-photos.png' });
// template edit
await pg.goto(BASE + '#/tpl'); await W(); await pg.click('text=석재 건식 검측'); await W();
await pg.fill('#tNew', '⑨ 테스트 항목'); await pg.click('text=+ 항목 추가'); await W();
log('stone items', await pg.$$eval('.tpl-items li', a => a.length));
await pg.click('.tpl-items li:last-child button:has-text("삭제")'); await W();
log('stone items after del', await pg.$$eval('.tpl-items li', a => a.length));
await pg.screenshot({ path: SHOT + '05-template-stone.png' });
// dashboard
await pg.goto(BASE + '#/'); await W(2000);
await pg.screenshot({ path: SHOT + '01-dashboard.png' });
// backup
await pg.goto(BASE + '#/settings'); await W();
const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('text=백업 내보내기')]);
const bp = '/workspace/sigong-guide/test/backup.json'; await dl.saveAs(bp);
const bj = JSON.parse(fs.readFileSync(bp, 'utf8'));
log('backup', bj.state.inspections.length, 'insp', bj.photos.length, 'photos', bj.state.logs.length, 'logs', bj.state.issues.length, 'issues');
await pg.click('text=모든 데이터 삭제'); await W(500);
await pg.goto(BASE + '#/settings'); await W();
await pg.setInputFiles('input[type=file][accept*="json"]', bp); await W(1500);
await pg.goto(BASE + '#/insp'); await W(); log('after import insp', await pg.$$eval('.list a', a => a.length));
// offline
await pg.reload(); await W(1000);
log('sw', await pg.evaluate(() => navigator.serviceWorker.controller ? 'controlled' : 'none'));
await ctx.setOffline(true); await pg.reload(); await W(800);
log('offline title', await pg.textContent('#title'), (await pg.$$('.list a')).length);
await ctx.setOffline(false);
log('ERRORS', errs);
await b.close();
