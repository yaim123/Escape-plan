# 24시간 지난 수업 자동 초기화

`019_expired_class_reset.sql`은 기존 001~018을 수정하지 않고 서버 자동 정리만 추가한다.

## 동작

- 시작한 수업은 `started_at`, 시작하지 않은 대기실은 `created_at`부터 **실제 24시간**이 지나면 정리 대상이다. 일시정지/학생 재접속/교사 조회는 이 시간을 연장하지 않는다. 진행 중/일시정지/모두 완료했으나 미종료/종료/대기실 상태를 모두 포함한다.
- Supabase `pg_cron` 작업 `escape-reset-expired-classes`가 **5분마다** 확인한다. 따라서 일반적으로 24시간 경과 후 다음 5분 주기에 정리된다. 모든 브라우저가 닫혀 있어도 동작한다. DB 자체가 일시정지/장애 상태이면 복구 후 예약 작업이 실행될 때 처리된다.
- 오래된 세션을 삭제하고 기존 FK cascade를 이용해 참가자·팀 편성·진행·오답·힌트·점수·완료·QR 스캔·채팅·병렬 합류·교사 제어·현재 결과를 삭제한다. 결과를 새로 보관하지 않는다.
- 콘텐츠, 고정 방 코드, QR token, 미디어, **이전에 따로 보관한 수업 결과**는 유지한다. 새 대기실 snapshot은 기존 수동 초기화와 같이 최신 콘텐츠에서 만든다.
- 콘텐츠 → 세션 순서로 잠그고 `SKIP LOCKED`를 사용해 학생 제출/교사 수동 초기화와 충돌하는 수업은 다음 실행에 재시도한다. 한 번에 콘텐츠 100개까지 처리한다. 새 수업이 이미 있으면 오래된 종료 세션만 지우고 새 수업은 유지한다.
- 예전 교사 탭은 소유권을 검증한 reset receipt로 현재 대기실/수업을 다시 조회한다. 학생의 이전 token은 세션 삭제로 무효화되고, 열려 있던 진행/대기 화면은 입장 화면으로 돌아간다. 기존 25초 복구 조회도 유지한다.
- 정리 함수와 조회 보조 함수는 `escape_private`에 두고 anon/authenticated 실행을 차단한다. 기존 교사 공개 RPC의 소유권 검증을 유지한다. 새 공개 학생 API/키/테이블 권한은 추가하지 않는다. Reset receipt에는 기존 수동 초기화처럼 세션 전환 ID만 기록하며 학생 결과를 보관하지 않는다.

## 적용

실제 서비스 프로젝트는 `rxknixllqewkvgfnpshu`이다. 현재 연결된 Supabase 계정에는 이 프로젝트의 관리 권한이 없으므로 원격 DB 적용/예약 실행 성공 여부는 직접 확인하지 못했다. 다른 연결 프로젝트에는 변경하지 않았다.

Supabase SQL Editor 새 쿼리에서 다음 파일 전체를 **한 번** 실행한다.

`C:\Users\ywj58\OneDrive\바탕 화면\방탈출\supabase\019_expired_class_reset.sql`

001~018은 재실행하지 않는다. 전체가 한 트랜잭션으로 적용된다. 성공하면 Cron 작업이 등록되고, 이미 하루 지난 수업도 다음 실행부터 정리된다. 별도의 GitHub Secrets, service_role 키, 유료 서버는 필요 없다.

관리자 확인용 읽기 쿼리:

```sql
select jobid, jobname, schedule, active
from cron.job where jobname = 'escape-reset-expired-classes';

select status, return_message, start_time, end_time
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'escape-reset-expired-classes')
order by start_time desc limit 5;
```

기존 보관 기록은 `escape_result_archives`에 유지된다. 예약 실행 이력은 pg_cron의 관리용 기록이며 학생 문제/결과 데이터가 아니다.

설정 근거: [Supabase Cron](https://supabase.com/docs/guides/cron), [Cron SQL 예약/실행 이력](https://supabase.com/docs/guides/cron/quickstart).

## 변경 및 검증

- 추가: `supabase/019_expired_class_reset.sql`.
- 수정: `src/ui/lobby.js` — 삭제된 참가자의 대기실 화면/로컬 복구 정보를 정리.
- 테스트: `scripts/verify-expired-class-sql.mjs`, `verify-expired-class-ui.mjs`, `cron-fixture.mjs` 추가, 기존 `sql-fixture.mjs`에 019 로드 및 PostgreSQL 배열 인자 지원.
- 기존 001~018 SQL 변경 없음.

2026-11-16 로컬 검증:

- Node 테스트 123 통과, 실패 0.
- 신규 SQL 시나리오 12 통과: 24시간 경계, 최근 시작 보호, 상태별 정리, FK 정리, 과거 보관 기록/콘텐츠/방 코드/QR 유지, 다른 교사 접근 차단, 오래된 종료 세션과 새 수업 분리, 반복 정리, 같은 코드 새 입장.
- 기존 QR/복구 SQL 시나리오 17 통과.
- 신규 브라우저 + 실제 로컬 SQL 연동 시나리오 4 통과: 교사 대기실/QR 복귀, 진행 학생 및 대기 학생 참가 정보 해제, 같은 코드로 새 입장. JavaScript 오류 없음.
- 기존 병렬/교사 화면 브라우저 시나리오 10 통과.
- 정적 빌드 및 diff 검사 통과.

로컬 PGlite에는 pg_cron 백그라운드 워커가 없으므로 예약 SQL 등록값만 fixture로 검사하고, 실제 정리 함수와 공개 RPC를 실행해 검증했다. **실제 서버 예약 실행은 SQL 적용 후 위 쿼리로 확인해야 한다.** 이 검증을 원격 DB 적용 완료로 표현하지 않는다.
