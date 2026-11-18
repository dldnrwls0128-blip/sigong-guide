# 시공관리 가이드 (PWA, v1.0)

철거 → 준공 13단계 공정 가이드 + 공종별 검측 체크리스트 + 검측요청서(A4 인쇄/PDF) + 작업일지·사진·지적사항 관리.
서버 없이 동작하는 정적 웹앱. 데이터는 기기 브라우저(IndexedDB)에만 저장됩니다.

## 실행
- PC: `cd sigong-guide && python3 -m http.server 8080` → http://localhost:8080
- 휴대폰 설치: https 주소에 올려야 «홈 화면에 추가»·오프라인이 됩니다.
  가장 쉬운 방법: https://app.netlify.com/drop 에 이 폴더(또는 zip)를 끌어다 놓기 → 나온 주소를 폰에서 열고 «홈 화면에 추가».
  (GitHub Pages, Cloudflare Pages 도 가능)
- index.html 을 파일로 직접 열면 화면은 동작하지만 오프라인 캐시(서비스워커)는 켜지지 않습니다.

## 파일
index.html · css/app.css · js/data.js(공정·템플릿 기본값) · js/db.js(IndexedDB) · js/app.js · manifest.json · sw.js · icons/
test/verify.mjs — 헤드리스 크롬 E2E 검증 스크립트 (node_modules 는 zip 에서 제외)

## 백업
더보기 → 현장 관리·백업 → 백업 내보내기(JSON, 사진 포함) / 가져오기.

## 도면 자동 인식 (v1.1)
더보기 → 도면. PDF(여러 장)·JPG/PNG 업로드 → 표제란에서 공사명·대지위치·도면명·도면번호·축척·분야·공종·동·층·호수 자동 인식 → ‘자동 인식 결과’ 화면에서 확인·수정 → 체크한 항목만 현장 정보·동/층/호 구조에 반영(중복 없이 병합) → 도면 태그로 검측요청서 ‘관련 도면’에 추천·첨부, 인쇄본에 도면번호 표기.
- CAD 내보내기 PDF: pdf.js 글자 추출(vendor/pdfjs, 오프라인)
- 스캔 PDF·사진: tesseract.js OCR(kor+eng). 엔진(core)·언어 데이터는 처음 한 번 cdn.jsdelivr.net 에서 내려받고 서비스워커·IndexedDB에 저장
- 도면 원본은 IndexedDB(files)에 저장, 백업 JSON에 포함
