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
