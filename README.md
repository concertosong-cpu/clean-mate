# CleanMate

에릭네 청소가게 크루 **출퇴근·근태·예약 승인** 앱 (PWA — 홈 화면에 추가해 앱처럼 씀).
돈 관리(인보이스·자니킹 정산·지출)는 별도 앱 "에릭 가계부"에서 다룹니다. 이 저장소에 넣지 않습니다.

## 폴더
- `public/` — 배포되는 앱 전체 (빌드 없음, 파일 그대로 서비스)
- `docs/` — 진행 기록(PROJECT-SUMMARY.md), Supabase SQL

## 배포 (Cloudflare Pages)
- 저장소 연결 시: Framework preset `None`, Build command 비움, **Build output directory `public`**
- 직접 올리기 시: `public` 폴더 안의 파일을 그대로 업로드
- 배포할 때마다 `public/sw.js`의 `CACHE_NAME` 번호를 올립니다 (안 올리면 폰에 옛 화면이 남음)

## 서버
- Supabase 프로젝트 `hhjxbqcpzccadtptbdqf` (`public/app.js` 상단). 공개(publishable) 키만 코드에 둡니다.
- 접근 잠금(RLS) 미설정 상태 — 실데이터 전에 잠가야 합니다.
