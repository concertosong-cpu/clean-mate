# CleanMate

에릭네 청소가게 크루 **출퇴근·근태·예약 승인** 앱 (PWA — 홈 화면에 추가해 앱처럼 씀).
돈 관리(인보이스·자니킹 정산·지출)는 별도 앱 "에릭 가계부"에서 다룹니다. 이 저장소에 넣지 않습니다.

## 폴더
- `public/` — 배포되는 앱 전체 (빌드 없음, 파일 그대로 서비스)
- `docs/` — 진행 기록(PROJECT-SUMMARY.md), Supabase SQL

## 배포 (Vercel)
- 저장소 루트의 `vercel.json`이 설정을 담고 있습니다: 빌드 없음, 배포 폴더 `public`, 검색엔진 노출 막음, `sw.js`·첫 화면은 매번 새로 받음
- 처음 한 번: Vercel → Add New → Project → GitHub `clean-mate` Import → 설정은 그대로 두고 Deploy
- 그 뒤로는 main에 올릴 때마다 자동 배포
- 배포할 때마다 `public/sw.js`의 `CACHE_NAME` 번호를 올립니다 (안 올리면 폰에 옛 화면이 남음)

## 서버
- Supabase 프로젝트 `hhjxbqcpzccadtptbdqf` (`public/app.js` 상단). 공개(publishable) 키만 코드에 둡니다.
- 접근 잠금(RLS) 미설정 상태 — 실데이터 전에 잠가야 합니다.

## 고객용 홈페이지 (`site/`)
- 에릭의 청소회사 **Supreme Solutions Management**(브리즈번) 소개·견적 문의 사이트. 빌드 없음, 파일 그대로 서비스
- 영어 기본, 우측 상단 버튼으로 한국어 전환 (`?lang=ko`로도 열림). 영어 문구는 `site/index.html`, 한국어 문구는 `site/script.js`의 `KO` 사전
- 연락처·이메일·소셜은 현재 운영 중인 supremesolution.com.au 에서 그대로 가져옴. 바꿀 때는 `index.html`을 검색해 고침
- 견적 폼: `script.js` 상단 `CONFIG.formEndpoint`에 Formspree 같은 주소를 넣으면 서버로 전송, 비워두면 방문자 메일 앱이 열림
- `CONFIG.crewAppUrl`에 CleanMate 앱 주소를 넣으면 푸터에 "크루 로그인" 링크가 생김
- 배포: Vercel에서 **별도 프로젝트**로 Import → Settings → Root Directory를 `site`로 지정. (앱 `public/`은 검색엔진 차단이지만 이 사이트는 노출되어야 하므로 따로 배포)
- 로컬 확인: `npx http-server site -p 8123` 후 http://127.0.0.1:8123
