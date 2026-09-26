# 교사 도구 012 변경 기록

2026-09-26. 구현 및 로컬 검증 완료. 실제 Supabase 적용과 배포는 대기 중이다. 기존 001~011 SQL은 수정하지 않았다.

## 적용할 SQL

Supabase SQL Editor의 새 쿼리에서 다음 파일 **전체를 한 번** 실행한다.

`C:\Users\ywj58\OneDrive\바탕 화면\방탈출\supabase\012_analysis_print_and_block_library.sql`

001~011은 다시 실행하지 않는다. 012 성공 후 새 프런트엔드를 배포한다. 별도 Storage bucket 생성이나 정책 수동 추가는 필요 없다. 이번 작업에서 원격 DB, 운영 수업, 실제 계정, 실제 Storage 파일을 변경하지 않았다. Git push/배포도 수행하지 않았다.

## 구현된 기능

| 기능 | 구현 및 검증 상태 |
| --- | --- |
| 문제별 결과 분석 | 문제 블록만 분석. 개인은 학생, 팀전은 팀당 한 행으로 완료 수·전체/평균 오답·힌트·평균 해결 시간을 집계. 기존 개인/팀 도착 시간 결과 표는 유지. 전체 완료/수업 종료 화면과 보관된 기록에 표시. |
| 막힌 문제 TOP 3 | 오답+힌트 합계 내림차순, 동률은 기록된 평균 해결 시간 내림차순, 마지막 동률은 블록 ID. 산식을 화면에 설명. |
| 진행 지연 | 문제에서 마지막 새로운 제출/힌트/QR 또는 실제 진입 이후 기본 3분. 팀당 가장 오래 지연된 문제 한 건 표시. 노란 주의, 기준보다 2분 더 지난 경우(기본 5분) 강한 표시. 정상 화면을 가리지 않음. |
| 지연 기준 | 전체 설정→진행 규칙에 OFF, 1~10분. 기존 필드 생략 시 3분. 실제 수업은 snapshot의 설정을 사용. |
| QR 일괄 인쇄 | 제작기 왼쪽 도구의 QR 인쇄. 전체/개별 선택, 개별 및 일괄 수량 1~30, 4/6/8cm 또는 3~10cm 직접 입력, 이름/번호/절취선, A4 자동 페이지 및 미리보기/브라우저 인쇄. 한 번에 최대 300개. |
| 개인 블록 보관함 | 블록 편집의 보관함에 저장, 콘텐츠 추가의 보관함에서 가져오기. 제목/유형/저장일/태그 목록, 제목·태그 검색, 개별 삭제(한 번 더 확인). 로그인 교사 자신의 계정 단위 테이블 사용. 로컬 모드는 별도 브라우저 보관함. |
| 독립 가져오기 | 새 블록 ID. QR 문제는 기존 duplicateRoom을 재사용해 mission/code/token 모두 새로 생성. 저장본/가져온 블록/원본 room 사이의 수정은 독립. 미디어 URL은 복사. |
| Storage 보호 | 보관함 payload도 기존 참조 검사에 포함. 보관함 저장 시 삭제된 경로의 재참조를 차단. 마지막 참조 제거 후 기존 Storage API로 미사용 파일 정리. |
| 분류 | 기본 정보에 학년/분류 과목/복수 장르/태그. Enter·쉼표 입력, 중복 제거, 태그 삭제. 기존 자유 입력 subject는 유지. 검색·플레이 방식·분류 필터를 AND 결합. 하나라도 필터하면 만들기 카드 숨김, 기본 화면에서 첫 카드 유지. |

## 분석과 시간의 정확한 의미

- 평균 오답은 현재 참여 대상 전체 기준이다. 팀원들의 실제 오답/힌트 사용을 합산하되 **팀을 여러 번 평균에 넣지 않는다**. 기존 결과의 현재 팀 구성/진행 초기화 규칙을 그대로 따른다.
- 해결 시간은 서버가 해당 문제를 현재 콘텐츠로 배정한 구간의 합이다. 일시정지와 다른 콘텐츠로 이동한 구간은 제외한다. 팀전에서 여러 팀원이 동시에 같은 문제를 보고 있어도 시간은 한 번만 누적한다. 사람이 실제로 화면을 응시한 시간까지 추정하지 않는다.
- 최초 진입부터 완료까지 정확하게 추적한 완료 대상만 평균에 포함하며 표에 표본 수를 표시한다. 교사 강제 완료/건너뛰기는 해결 시간 평균에서 제외한다. 교사 초기화/팀 변경으로 이전 시간의 의미가 달라진 대상은 시간 기록을 무효화하고 평균에서 제외한다.
- 012 이전에 이미 시작한 수업에는 정확한 진입 기록이 없으므로 시간 평균/지연을 소급 생성하지 않는다. 오답·힌트·완료 수는 기존 데이터로 계산할 수 있다. 기존 보관 기록에 문제별 데이터가 없으면 없다고 표시한다.
- 012 적용 후 시작하는 수업부터 시간 기록을 수집한다. 적용 전 만들어 둔 lobby도 적용 후 시작하면 시간 추적이 활성화된다. 기존 playing/paused 수업 snapshot은 수정하지 않는다.
- 새 제출 영수증/힌트 사용/유효한 새 QR 스캔만 활동으로 간주한다. 단순 조회, 재접속, heartbeat, 같은 제출 요청 재전송, 이미 처리한 QR은 지연 시간을 다시 시작하지 않는다. 일시정지 중에는 경고를 숨기고 서버 유효 시간도 멈춘다.
- 분석/지연은 기존 소유 교사 전용 RPC에만 추가한다. 학생 응답에는 다른 학생/팀의 분석, 정답, 내부 시간 기록을 추가하지 않는다. 실제 오답 문자열도 저장하지 않는다.

## 보관함의 참조 처리

보관함에는 블록과 연결된 QR 설정의 snapshot을 저장한다. 가져올 때 새 블록/QR 식별자로 바꾼 독립 복사본을 현재 스테이지에 넣는다. **다른 블록을 참조하는 공개 조건은 한 블록만 가져와서는 유효하게 연결할 수 없으므로 제외하고 개수를 안내한다.** 해당 조건과 팀원/역할 배정은 새 수업에 맞게 확인해야 한다. 보관함에 저장한 원본 설정은 변경하지 않는다.

다른 room, 활성 수업 snapshot, 다른 보관함 항목 중 하나라도 파일을 참조하면 삭제하지 않는다. 파일 바이트 삭제는 011의 Storage API/helper를 재사용하며 SQL로 storage.objects를 삭제하는 운영 기능을 추가하지 않았다. 네트워크 오류로 파일 정리가 실패하면 보관함 삭제 결과와 남은 정리를 구분해 안내한다.

## 추가 데이터와 보안 변경

- `room.metadata`: `grade`, `subject`, `genres[]`, `tags[]`. 이전 subject가 정해진 과목과 정확히 일치하면 분류 과목의 초기값으로 사용할 수 있다. 학년/장르는 임의 추정하지 않는다. 미분류를 명시적으로 선택한 경우 그대로 유지한다.
- `room.rules.delayMinutes`: 0=OFF, 1~10분, 생략 시 3분.
- 신규 `public.escape_block_library`: id, owner_id, title, type, tags, payload, created_at. owner_id=auth.uid() RLS로 SELECT/INSERT/UPDATE/DELETE를 제한한다. anon 권한 없음. 별도 중복 관리 RPC 대신 기존 authenticated REST 접근 방식을 사용한다.
- 신규 `escape_private.question_timing`: session/subject/block 단위 active_since_ms, elapsed_ms, last_activity_ms, active, completed, timing_known. 세션 삭제 시 cascade, API 역할 직접 조회/수정 불가.
- `escape_sessions.analysis_enabled`: 기존 수업은 false, 신규 수업 또는 lobby→playing은 true.
- 기존 `escape_teacher_progress` RPC를 감싸 `questionAnalysis`, `delayState`를 추가. 기존 owner 검증을 먼저 통과해야 한다.
- 기존 `escape_result_archives.summary`에 questionAnalysis를 추가하는 트리거. 결과 보관/초기화 RPC와 기존 archive history RPC를 그대로 재사용한다.
- 기존 `escape_private.media_referenced`의 검사 대상에 보관함을 추가. 기존 버킷·Storage RLS 정책 자체를 완화하거나 새 공개 쓰기 정책을 만들지 않았다.
- 세션 progress_revision/status 트리거 및 기존 제출/힌트/QR 레코드 INSERT 트리거로 시간을 기록한다. 실제 입력 값은 복사하지 않는다.
- QR 인쇄는 DB 쓰기를 호출하지 않으며 기존 렌더러로 동일 토큰을 반복해서 SVG로 만든다. 토큰/URL 문자열을 인쇄 목록에 표시하지 않는다.

## 주요 파일

- `supabase/012_analysis_print_and_block_library.sql`
- `src/core/analysis.js`, `src/ui/analysis.js`, `src/ui/live-play.js`, `src/ui/results.js`: 문제 분석/지연.
- `src/core/qr-print.js`, `src/ui/qr-print.js`: 읽기 전용 QR 선택·크기·배치·인쇄.
- `src/core/block-library.js`, `src/data/block-library.js`, `src/ui/block-library.js`: 개인 보관함과 독립 복사.
- `src/core/classification.js`, `src/core/model.js`, `src/ui/room-settings.js`, `src/ui/library.js`: 분류 및 지연 설정.
- `src/ui/editor.js`, `src/experience.css`: 제작기 동선과 화면 연결.
- `tests/teacher-tools.test.js`, `scripts/verify-teacher-tools-sql.mjs`, `scripts/verify-ux-ui.mjs`: 신규 자동 검증.
- 기존 SQL 회귀 스크립트 6종에 `--tools`를 추가하여 012 적용 상태에서도 검증.

## 로컬 테스트

- `node --test`: **95/95 통과**. 기존 86개 + 신규 9개.
- 신규 `node scripts/verify-teacher-tools-sql.mjs`: 문제만 집계, 개인/팀 중복 방지, 오답/힌트, pause 제외 시간, 재접속/재전송 보존, 지연 기준 변경/OFF, QR 활동, 강제 완료/구기록의 시간 제외, archive/reset, 다른 교사/익명 권한 거절, 보관함/room 미디어 참조와 삭제 보호 통과.
- 012 포함 기존 PGlite 회귀 6종 통과:
  - `node scripts/verify-play-sql.mjs --controls --results --editor-flow --ux --media --tools`
  - `node scripts/verify-controls-sql.mjs --results --editor-flow --ux --media --tools`
  - `node scripts/verify-results-sql.mjs --editor-flow --ux --media --tools`
  - `node scripts/verify-editor-flow-sql.mjs --ux --media --tools`
  - `node scripts/verify-ux-sql.mjs --media --tools`
  - `node scripts/verify-media-sql.mjs --tools`
- 기존 대기실/QR/QR 문제의 역사적 migration 범위 회귀 3종도 통과: verify-lobby-sql / verify-qr-sql / verify-qr-question-sql.
- 총 **10개 SQL 검증 스크립트** 통과. 실제 운영 PostgreSQL 대신 로컬 PGlite에서 실행했고, fixture는 정리했다.
- headless Edge UI: 분류 저장/태그 삭제/복합 필터, 보관함 저장/검색/QR 독립 가져오기, QR 전체·개별 선택과 일괄 수량, 미리보기와 표시 옵션, 인쇄 SVG를 jsQR로 재해독해 기존 토큰 일치, 문서/저장 호출 불변 확인. 기존 스테이지·카드·설정·몰입형·업로드·인증 콜백·스토리 TXT 내보내기 검증도 통과. 처리되지 않은 JS 오류 없음.
- 빌드 및 JavaScript 구문, git diff 공백 검사 통과.

## 적용/배포 후 확인할 사항

1. 새 개인전/팀전 수업에서 오답/힌트/QR 활동, 1분 또는 3분 지연 표시, 일시정지/재접속 후 시간 유지 확인.
2. 수업 완료 후 문제 분석과 기존 도착 시간 확인, 보관 후 초기화하여 동일 분석이 과거 결과에 남는지 확인.
3. 실제 두 교사 계정에서 개인 보관함이 분리되는지 확인. 파일을 보관함에 저장한 뒤 원래 블록을 삭제해도 파일이 유지되는지 확인.
4. QR 인쇄에서 A4·배율 100%·브라우저 머리글/바닥글 OFF로 실제 인쇄하거나 PDF 저장. 6cm는 QR 무늬 자체의 길이이며 4모듈 흰 여백과 카드 패딩이 추가됨. 프린터의 자동 축소 설정/용지 여백은 브라우저 밖이므로 실물 크기와 스캔을 확인.
5. 실제 Supabase 권한 응답 및 브라우저 콘솔 확인. 로컬 테스트는 실제 네트워크/프린터/Storage 바이트 삭제를 대신하지 않는다.

이 단계에서 새 대형 기능, 기존 SQL 재작성, 학생용 관리자 권한, secret/service_role 키, 자동 배포는 추가하지 않았다.
