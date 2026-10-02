# 30명 수업 검증 · 제작기 진단 · QR 직접 입력 · 참가자 복구

## 적용 순서

시작 시 최신 migration은 016이었다. 기존 001~016은 수정하지 않았다. 새 SQL은 **아직 실제 Supabase에 적용하지 않았다**.

로컬 검증 후, 수업을 운영하지 않는 시점에 Supabase SQL Editor의 새 쿼리에서 다음 파일 전체를 **순서대로 한 번씩** 실행한다. 각 파일은 트랜잭션이다. 오류가 나면 다음 파일을 실행하지 않고 오류를 확인한다.

1. `C:\Users\ywj58\OneDrive\바탕 화면\방탈출\supabase\017_qr_manual_code.sql`
2. `C:\Users\ywj58\OneDrive\바탕 화면\방탈출\supabase\018_duplicate_participant_recovery.sql`

001~016을 재실행하지 않는다. 두 SQL 성공 후 프런트엔드를 배포하고 기존 제작기/학생 화면을 새로고침한다. 인쇄된 QR token/URL은 유지된다. 테스트 데이터나 계정을 실제 DB에 추가하는 migration은 없다.

## 구현과 보안

- **블록 진단:** 기존 `inspectForPlay`가 `issues` 및 `byBlock`도 반환한다. 기존 문자열 errors/warnings API는 유지한다. 제목이 아닌 블록 ID로 연결한다. 일반 블록, 병렬 대표 행/개별 칸에 작은 빨강/주황 배지를 표시하고 선택 영역에 모든 원인을 보여준다. 편집 revision마다 한 번 계산하고 선택/미리보기에는 결과를 재사용한다. 선택지/연결 항목 부족은 오류, UNIQUE_MEMBER의 정원 대비 QR 부족은 실제 참가 인원에 따라 달라지는 경고다.
- **QR 수동 코드:** `qrMissions[].codes[].manualCode`에 독립 난수 6자를 저장한다. O/0/I/1을 제외하고 문서 내 중복을 고친다. 콘텐츠/세션 snapshot trigger 및 backfill로 기존 ID/token을 유지하며 코드를 채운다. 구버전 문서를 저장해도 서버가 기존 ID+token의 코드를 보존한다. 학생 projection에는 코드 목록/token을 추가하지 않는다.
- 새 anon RPC `escape_answer_qr_manual(token, block, code)`는 해당 수업/블록/역할/활성 QR을 찾아 **기존 `scan_current_qr`**를 호출한다. 개인/팀, ANY/ALL/N_OF_M/UNIQUE_MEMBER, 병렬, OR late submit, 되감기를 같은 엔진에서 처리한다. 잘못된 코드는 게임 이벤트/오답/점수를 만들지 않는다. 비공개 `manual_qr_attempts`에서 참가자당 분당 30회 요청을 제한한다. 대소문자/공백을 정규화한다. 카메라와 직접 입력 모두 기존 성공 확인 화면/일시정지 흐름을 사용한다. 인쇄에는 QR 크기를 줄이지 않고 아래 6mm 보조 행을 추가한다.
- **참가자 복구:** 활성 session+학년+반+번호, `left_at IS NULL` 부분 unique index와 세션 행 잠금으로 중복을 막는다. 이름은 NFC/공백 제거/소문자로 비교한다. 유효한 기존 token이 최우선이다. 이름 불일치 오류는 기존 이름을 노출하지 않는다.
- 새 기기의 join은 `requiresRecovery`와 일회성 확인 challenge만 반환한다. 확인 후 새 anon RPC `escape_recover_participant(code, token, challenge)`가 기존 참가자 행의 token hash를 교체한다. challenge/새 token/이전 hash를 묶고 2분 만료를 적용한다. ID/팀/역할/진행/이벤트/QR/점수는 유지한다. 학생 RPC는 세션 잠금 뒤 token을 다시 검사해 이전 token의 지연 요청도 차단한다. 동시 복구는 먼저 성공한 challenge만 유효하며 동일 새 token 재시도는 멱등이다.
- left_at 행은 자동 복구하지 않는다. **016의 완료 후 나가기**는 결과 명단을 보존하는 기존 정책을 유지하면서 새 `recovery_disabled`로 재복구를 금지한다. 이미 시작한 수업의 신규 참가 제한도 유지한다. 이전 종료 세션이나 초기화 후 새 세션은 별도 참가자다.
- 새 비공개 테이블 `participant_recovery_challenges`, `manual_qr_attempts`는 public/anon/authenticated 직접 접근을 차단한다. 공개 학생 RPC만 anon에 허용한다. 교사 owner RLS/인증을 유지하며 service_role/Secret Key를 추가하지 않았다.

## 변경 파일

| 영역 | 파일 |
|---|---|
| 기존 검증 확장 | `src/core/model.js`, `chat.js`, `parallel.js`, `team-settings.js` |
| QR 모델/인쇄 | `src/core/qr.js`, `qr-print.js` |
| 진단 UI | `src/ui/block-diagnostics.js`(신규), `editor.js`, `parallel-editor.js`, `src/experience.css` |
| QR UI | `src/ui/block-qr.js`, `qr-print.js`, `qr.js`, `live-play.js`, `player.js` |
| 복구 | `src/data/lobby.js`, `src/ui/lobby.js` |
| 새 SQL | `supabase/017_qr_manual_code.sql`, `018_duplicate_participant_recovery.sql` |
| 새 테스트/도구 | `tests/manual-recovery-diagnostics.test.js`, `scripts/sql-fixture.mjs`, `load-backend.mjs`, `load-30.mjs`, `verify-manual-recovery-sql.mjs`, `verify-manual-recovery-ui.mjs` |
| 기존 SQL 회귀 도구 | `scripts/verify-team-chat-sql.mjs`, `verify-team-roles-sql.mjs`, `verify-parallel-sql.mjs`에 `--recovery` 옵션 추가 |
| 문서/명령 | `SPEC.md`, `README.md`, `package.json`, 이 문서 |

## 자동 검증 실행

프로젝트 루트, Node 22 이상에서 실행한다. 기존 PGlite(`@electric-sql/pglite` 또는 `artifacts/pglite/package`) 및 Playwright 설치를 재사용한다. 새 프레임워크는 추가하지 않았다.

```powershell
node --test
node scripts/verify-manual-recovery-sql.mjs
node scripts/verify-manual-recovery-ui.mjs
node scripts/verify-team-chat-sql.mjs --roles --parallel --recovery
node scripts/verify-team-roles-sql.mjs --parallel --recovery
node scripts/verify-parallel-sql.mjs --recovery
node scripts/load-30.mjs --report=artifacts/load-30.json
node scripts/build.mjs
```

기존 `verify-{lobby,play,controls,results,qr,qr-question,editor-flow,ux,media,teacher-tools}-sql.mjs` 10개와 `verify-{ux,qr-ux,team-chat,team-roles,parallel}-ui.mjs` 5개도 실행했다. 이전 migration 전용 fixtures는 유지하고, 014/015/016 회귀는 017/018까지 적용하여 검증했다. 로그인은 실제 계정 대신 기존 인증 bootstrap/API mock 회귀를 실행했다.

30명 스크립트는 실제 공개 RPC로 입장/동시 일반 풀이/같은 팀 동일 문제/다른 팀 다른 문제/동일 request 재시도/UNIQUE_MEMBER/팀·역할 채팅/AND 대기 해제/OR 승자와 late submit/기기 복구/교사 조작 경쟁/보관·삭제 초기화/같은 코드 새 수업을 검증한다. 개인전 완료 회귀도 포함한다. 예상 거부 응답은 unexpected failure와 구분한다. 로컬 SQL 감사로 활성 중복 completion/closure/QR과 이전 세션 혼입을 검사한다.

**PGlite는 단일 연결에서 트랜잭션을 직렬 처리한다.** Promise.all은 요청 경쟁/재시도 흐름을 재현하지만 실제 PostgreSQL 다중 연결의 잠금 대기/교착/네트워크 성능을 측정하지 않는다. 출력 지연에는 로컬 큐 대기가 포함되므로 실수업 응답 속도를 보장하지 않는다. 특히 QR·병렬 계산 구간의 대기는 실제 테스트 프로젝트에서 별도로 측정해야 한다.

Realtime은 HTTP 지연과 분리한다. SQL은 빈 invalidation payload를 검사한다. 기존 UI integration은 두 학생+교사 브라우저 context에서 실제 렌더러/WebSocket 수신 경로의 AND 해제, OR 종료, 진행률 및 채팅 갱신을 검사한다. **실제 Supabase WebSocket 전달 시간을 측정한 것은 아니다** (`realRealtimeLatencyMs: null`).

## 별도 staging 선택 실행

기본 실행은 메모리 DB만 사용한다. 실제 HTTP 경쟁 테스트는 **001~018을 적용한 별도 폐기용 Supabase 프로젝트**를 준비하고 다음 환경 변수와 `--staging`을 명시해야 한다.

- `ESCAPE_LOAD_URL`: 테스트 프로젝트 HTTPS origin
- `ESCAPE_LOAD_ALLOW_HOST`: URL의 정확한 host
- `ESCAPE_LOAD_CONFIRM`: `disposable-staging`
- `ESCAPE_LOAD_PUBLIC_KEY`: 테스트 프로젝트 publishable/anon key
- `ESCAPE_LOAD_TEACHER_JWT`: 테스트 교사의 유효한 authenticated access token (환경 변수에만 설정, 채팅/저장소에 기록하지 않음)

```powershell
node scripts/load-30.mjs --staging --report=artifacts/load-30-staging.json
```

현재 운영 host와 service_role/secret 키는 거부한다. HTTP 요청 상한 1,800회, timeout 30초를 둔다. `[LOAD TEST]` 신규 콘텐츠만 만들고 **이번 실행에서 생성한 ID만** finally에서 삭제·조회 확인한다. 강제 프로세스 종료/네트워크 단절 때는 finally가 보장되지 않으므로 테스트 교사 계정에서 해당 테스트 콘텐츠만 정리한다. Hosted 실행은 비공개 테이블 감사 권한이 없어 completion/closure 직접 SQL 감사값은 null이며 학생·교사 RPC로 동작을 검사한다. 이번 작업에서는 staging을 실행하지 않았다.

## 적용 후 실기기 확인 목록

1. 교사 로그인 → 기존 방 저장 → 블록/병렬 경고 선택·수정·해제. 입장 QR과 이전 인쇄 QR 유지 확인.
2. 태블릿 카메라 권한 거부 → 코드 직접 입력. 잘못된/다른 문제 코드 진행 차단, 올바른 코드 진행, 인쇄 가독성/QR 크기 확인.
3. 두 기기의 camera/manual 혼합 스캔, QR 4가지 모드, AND 대기 해제/OR late submit, 새로고침, 일시정지·재개/되감기 확인.
4. 새 기기 동일 학생 → 취소/확인 → 같은 ID·팀·역할·위치·QR·오답·힌트 유지. 이전 기기 제출 거부, 교사 인원 불변, 다른 이름 병합 금지 확인.
5. 오프라인/온라인 전환 후 채팅·역할 접근·교사 진행률의 실시간 복구, 브라우저 콘솔/Realtime 권한 오류 확인.
6. 보관/삭제 초기화 → 같은 방 코드 다음 반 입장 → 과거 QR/채팅/진행 혼입 없음. 완료 후 나가기는 기존 결과 명단 보존.

영향 범위는 QR 문서 정규화·제작기 검증, 학생 입장/복구와 token 검사다. 로그인/교사 권한·정답 판정·배정·조건·결과 엔진은 재사용했다. 이름·학년·반·번호를 아는 사람이 복구를 요청할 수 있다는 신원 기반 복구의 한계는 남으며, 동시 기기 사용은 token 회전으로 줄인다. 실제 네트워크 30연결, 학교 기기 카메라/인쇄 검증은 별도로 필요하다.

## 이번 실행 결과

2026-10-02 로컬 최종 실행. `artifacts/` 원시 실행 결과는 Git에 포함하지 않는다.

| 검증 | 결과 |
|---|---|
| Node 자동 테스트 | 123 통과 / 0 실패 |
| SQL 실행 스크립트 | 14개 통과 / 0 실패 (신규 17개 시나리오 포함) |
| Headless UI 실행 스크립트 | 6개 통과 / 0 실패 (신규 6개 시나리오 포함), uncaught JS 오류 없음 |
| 30명 시뮬레이션 | 9개 시나리오 통과 / 0 실패 |
| 정적 빌드 / diff whitespace 검사 | 통과 |
| 기존 001~016 SQL | HEAD 대비 변경 없음 |

| 로컬 부하 지표 | 결과 |
|---|---|
| 동시 가상 학생 | 30명, 6팀 × 5명 |
| RPC 요청 | 532회 |
| 정상 응답 / 의도한 거부 / 예상 밖 실패 | 509 / 23 / 0 |
| 평균 / p50 / p95 / 최대 | 2,083.93 / 120.12 / 13,308.41 / 55,865.16 ms |
| 가장 느린 RPC | escape_answer_qr (큐 대기 포함) |
| 초기화 직전 참가자 | 30명 |
| 일반 공통 문제 completion | 예상 12 / 실제 12 |
| 병렬 closure | 예상 12 / 실제 12 |
| 활성 중복 completion / closure / 팀별 QR | 0 / 0 / 0 |
| UNIQUE_MEMBER scan | 30건 (팀원별 1개) |
| QR OR 그룹 scan | 6건 (팀당 승자 1개) |
| 로컬 Realtime invalidation | 1,012건, payload 비공개 데이터 유출 없음 |
| 생성한 테스트 콘텐츠 | 정리 완료 (폐기용 로컬 DB만 사용) |

최대 55.9초는 WASM DB 단일 큐에 동시 요청이 쌓인 결과다. 데이터 정합성은 통과했지만, 실제 30개 PostgreSQL 연결과 Supabase Realtime의 지연/잠금 안정성이 검증되었다고 해석하면 안 된다. 실제 Supabase에는 테스트 데이터나 SQL 변경을 보내지 않았다. staging 실행 및 위 실기기 목록이 남아 있다. commit/push는 하지 않았다.
