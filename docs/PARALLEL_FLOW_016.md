# 병렬 진행·정보창·나가기·설정·진행률 (016)

## 적용 상태와 순서

코드 구현과 로컬 검증 완료. 실제 Supabase에 016을 적용하거나 실서비스 계정으로 검증하지 않았다. 이번 테스트는 원격 학생·교사 데이터에 접근하지 않았다.

1. Supabase에 **015_team_roles_and_visibility.sql까지 적용되어 있는 상태**가 전제다. 이미 적용한 SQL을 다시 실행하지 않는다.
2. `C:\Users\ywj58\OneDrive\바탕 화면\방탈출\supabase\016_parallel_flow.sql` 전체를 SQL Editor의 새 쿼리로 한 번 실행한다. `begin`부터 `commit`까지가 하나의 트랜잭션이다.
3. 성공 후 새 코드로 제작기를 열어 테스트 수업을 시작한다. 진행 중인 기존 수업의 스냅샷에는 제작기 변경을 자동 반영하지 않는다.
4. 실제 환경 확인 후 GitHub에 소스를 반영하고 기존 Pages 배포 절차를 따른다. 이번 작업에서 commit/push/배포는 하지 않았다.

기존 001~015 SQL, Auth 설정, 공개 키, 기존 RLS 정책은 변경하지 않았다. 기존 방 문서를 일괄 변환하지 않는다.

## 기존 구조와 원인

- 정보창은 타이머·RPC 갱신마다 내부 HTML을 다시 만들면서 스크롤을 잃었다. 항목별 DOM을 유지해 텍스트만 갱신하고, 콘텐츠 장면 교체가 필요한 경우 열린 상태와 scrollTop을 저장·복원한다. focus에는 preventScroll을 사용한다.
- 완료 화면의 나가기 버튼은 비활성화됐고, 기존 RPC도 진행 중 미완료 학생의 leave만 지원했다. 완료/종료된 학생은 회복 토큰만 폐기해 결과·팀·전체 수업을 보존한다. 클라이언트는 참가 복구·학생 정보·채팅 읽음 상태를 지우고 `#/join/<방 코드>?fresh=1`로 이동한다. 방 코드는 유지하고 이름·학년·반·번호는 빈 값이다.
- 기존 `play_state`, `completed`, `assigned`, 공개 조건, QR 검증을 유지했다. 기존 Realtime의 빈 변경 알림 → 인증된 RPC 재조회 방식을 재사용한다.
- 기존 교사 진행 화면의 현재 제목은 서버 progress에서 얻는다. 추가 진행률도 서버의 완료 판정에서 계산하며 배열상 현재 인덱스를 사용하지 않는다.
- 014의 replay floor와 retired_at 이력을 병렬 합류 기록에 연결했다.

## 기능과 저장 모델

- 전체 설정은 **A 기본 정보 → B 플레이 방식/팀 설정 → C 학생 화면 표시 → D 화면 디자인 → E 진행 규칙 → F 소리** 순서다. 개인전에서 B의 팀 세부 UI만 숨기며 값은 보존한다.
- `parallelGroups[]`에 `{id,name,mode,lanes:[{name},{name}],steps:[{id,cells:[{blockId},{blockId}]}]}`를 추가한다. 새 필드가 없는 방은 기존 순차 경로를 사용한다.
- 각 칸은 기존 content 블록을 참조한다. block/stage/QR/조건 ID는 재배치해도 유지한다. 경로 역할은 각 블록의 기존 `assignment.visibleRoles`를 재사용한다. 서로 겹치지 않는 역할을 A/B에 지정하고 각 팀에 두 경로 담당자가 있어야 시작할 수 있다.
- 새 단계는 양쪽 모두 새 콘텐츠가 기본이다. 스토리·문제·안내 유형과 기존 QR/미디어 설정을 편집할 수 있다. 구간 전체 ↑↓/드래그, 여러 단계, 여러 구간, 역할 필터, 방 복제/save/load를 지원한다.
- 유지 칸은 `{hold:true}`이고 블록을 복제하지 않는다. 첫 단계 유지 또는 양쪽 동시 유지는 허용하지 않는다. 유지로 변경할 때 해당 칸과 QR·외부 참조 조건 삭제를 확인한다. 일반 카드/몰입형 모두 이전 내용은 읽기 전용이다.
- 각 경로는 독립적으로 순차 진행한다. 유지 칸에서는 그 단계까지 반대 경로의 실제 콘텐츠가 완료될 때까지 앞 화면을 보여준다. AND는 모든 경로, OR는 어느 한 **전체 경로**가 완료되면 합류한다.
- AND 대기는 기존 `teamSettings.waiting` 문구와 표시 옵션을 쓰며 `1 / 2 경로 완료`를 표시한다. OR 종료는 미해결 경로에 정답·스캔·점수 이벤트를 만들지 않는다. 늦은 정답/유효 QR 요청은 안전한 안내와 최신 본인 화면을 반환한다.
- 교사 개인/팀 행에 작은 막대와 %를 넣었다. 일반 적용 블록은 1단위, 병렬 구간은 경로 수·단계 수와 무관하게 1단위다. AND는 두 경로 완료 비율의 평균, OR는 가장 진행된 경로의 비율이며 합류 시 1이다. 0~100%로 제한하고 실제 도착 결과는 100%다.
- 교사 앞쪽 강제 이동은 기존 기록을 유지한다. 병렬 구간 이전으로 되감거나 팀 변경/진행 초기화 시 관련 팀의 현재 병렬 상태를 무효화한다. 병렬 공유 상태는 학생 한 명만 되감아도 해당 팀에 영향을 주며 UI에서 안내한다. AND 대기자가 있는 팀 강제 완료/건너뛰기는 진행 중인 팀원의 현재 콘텐츠에만 적용한다.

## DB / RPC / 권한

추가 테이블은 비공개 스키마의 `escape_private.parallel_closures` 하나다. 세션/팀/구간마다 활성 합류 기록은 최대 한 개이며 session FK cascade로 초기화 시 삭제된다. 되감기는 retired_at으로 이전 합류 이력을 보존한다. public/anon/authenticated 직접 접근을 허용하지 않는다.

추가/확장한 내부 함수: `parallel_group`, `parallel_block_done`, `parallel_state`, `team_progress_percent`, `play_state`, `sync_play`, `student_projection`, `result_groups`, `assert_runnable`, `assert_role_roster`, `scan_current_qr`.

기존 공개 RPC `escape_student_play`, `escape_student_lobby`, `escape_teacher_progress`, `escape_teacher_control`의 시그니처를 유지한다. `escape_answer_qr`/`escape_scan_qr`도 기존 내부 검증을 재사용한다. 학생은 recovery token, 교사는 auth.uid() 소유권 검사를 계속 사용한다. 세션 행 잠금과 활성 합류 unique index로 중복 처리를 방지한다. 정답과 다른 역할의 문제 본문은 학생 projection에 포함하지 않는다. 새 서비스 키나 공개 테이블 권한은 없다.

## 변경 파일

- `src/core/model.js`, `session.js`, `stages.js`: 참조/복제/이동/가상 플레이 연결.
- `src/data/lobby.js`: 해당 참가자의 복구 정보 정리.
- `src/ui/editor.js`, `room-settings.js`: 병렬 제작 및 설정 재배치.
- `src/ui/student-info.js`, `immersive.js`, `live-play.js`, `player.js`, `lobby.js`, `teacher-controls.js`, `team-waiting.js`, `src/experience.css`: 스크롤·나가기·대기·진행률·관리 안내.
- 기존 SQL 회귀 스크립트 9개에 `--parallel` 옵션, 설정 순서 변경에 따른 기존 테스트 2개 갱신.
- 새 파일: `src/core/parallel.js`, `src/ui/parallel-editor.js`, `src/ui/progress-meter.js`, `supabase/016_parallel_flow.sql`, `tests/parallel.test.js`, `scripts/verify-parallel-sql.mjs`, `scripts/verify-parallel-ui.mjs`, 이 문서.
- `SPEC.md`, `README.md`: 현재 동작과 적용 문서 연결.

## 검증 결과

- `node --test`: **117 tests passed**, 실패 0.
- PGlite 로컬 PostgreSQL: **10개 SQL 검증 스크립트 통과**(새 016 + 기존 9개를 016까지 적용). 개인전/일반 팀전, 역할·조건·QR ANY/ALL/N_OF_M/UNIQUE_MEMBER, 채팅, 일시정지, 교사 조작, 결과/보관/초기화, 토큰·RLS 접근 거부 회귀 포함.
- 새 016 SQL: AND/OR 양쪽 승자, 동일 역할 여러 명, 다단계·유지·재접속, 두 번 분리/합류, 동시/지연 제출, 중복 합류 방지, QR 정상/다른 역할/잘못된 QR/늦은 QR, pause, 강제 이동·완료·되감기, AND 대기 중 팀 관리, OR 최종 결과와 미완료 경로 점수 제외, 완료/종료 나가기, 비공개 테이블 접근 거부, 테스트 데이터 정리 확인.
- Headless Edge: **5개 UI 스크립트 통과**(새 016의 10개 시나리오 + 기존 4개). scrollTop=500 유지, 타이머/장면 교체, 닫기/재열기, 읽기 전용 몰입형, 제작/설정/폭/역할 필터/구간 이동, 학생 2개+교사 1개 브라우저 컨텍스트의 Realtime 알림과 AND/OR 화면 전환, 교사 %, 완료 후 같은 코드의 빈 입력 폼 복귀 확인. 예상 밖 JS 오류 0.
- Realtime UI는 로컬 RPC/WebSocket fixture이며 실제 Supabase 네트워크 검증과 구분한다. SQL의 동시 제출은 단일 PGlite 연결에서 직렬 처리되므로 실서버 다중 연결 부하 테스트를 의미하지 않는다.
- `node scripts/build.mjs`로 기존 정적 배포 경로를 사용한다. 비밀키·SQL·테스트는 dist 배포물에 포함하지 않는다.

## 직접 확인과 제한

016 적용 후 서로 다른 두 학생 브라우저로 A/B 역할 입장 → AND 대기 → OR 즉시 합류 → 새로고침 복구 → 교사 되감기를 한 번 확인하면 좋다. 완료 후 나가기를 눌러 같은 코드와 빈 학생 입력값을 확인한다.

이번 UI는 요청한 2경로 중심이다. 역할 표시와 기존 수행자/완료 조건은 함께 적용되므로 전원 완료나 QR UNIQUE_MEMBER를 일부 역할에게만 배정하는 모순은 기존 검증에서 거부한다. 팀 변경/이탈로 담당 역할이 없어지지 않도록 교사가 구성해야 한다. 네트워크 지연·실기기 카메라·실서버 다중 연결 검증은 이번 로컬 테스트 범위 밖이다. 수업 도중 대규모 편집 반영이나 다른 팀 진행 공개, 최고 관리자 기능은 추가하지 않았다.
