# 제작기·수업 동선과 블록 QR (009)

## 적용

`supabase/009_editor_flow_and_block_qr.sql` 전체를 **008 적용 후 한 번** 실행한다. 001~008은 수정하거나 재실행하지 않는다. 정적 파일과 009를 함께 사용한다. 관리자 DB 연결이 없어 Supabase 적용은 사용자가 수행한다.

새 테이블·열·RLS 정책 변경은 없다. 기존 콘텐츠 JSON, 참가자, QR 스캔, 교사 override, 결과/보관/초기화 테이블을 사용한다. 새 교사 전용 `escape_class_states()`는 소유 교사의 활성 세션 상태만 반환한다. 익명 실행 권한은 없다.

## 사용 흐름

- 카드: 방탈출 시작(활성 수업은 수업으로 돌아가기) → 편집하기 → 테스트 → 더보기. 수업 기록/복제/JSON/삭제는 더보기에 배치.
- 제작기: 수업 시작 또는 진행 상황 → 저장 → 플레이 테스트. 시작은 대기실을 열며 학생 게임 시작은 대기실 교사 버튼으로 수행.
- 동일 콘텐츠의 활성 수업을 재사용한다. 종료된 수업 뒤 새 수업 시작은 기존 `escape_finish_reset`의 결과 보관 경로로 새 대기실을 만든다. 코드와 콘텐츠를 유지한다.
- 대기실에서 입장 코드, 개인정보 없는 입장 QR/링크, 참가자 목록을 동시에 표시. 대기실/실시간 화면에 내 방탈출로 돌아가기 링크 제공.
- 로그인 후 같은 브라우저의 로컬 제작물을 가져올 수 있다. 기존 서버 ID를 덮어쓰지 않으며 INSERT 후 인증된 조회로 저장을 확인한다. 실패 항목만 재시도하고 로컬 원본은 유지한다. 완료 표시는 프로젝트+계정 단위이다.

## 초안과 실행

`validateDraft`는 저장 가능한 데이터 구조만 검사한다. `validateForPlay`는 테스트/새 수업 진입 전에 정답, 자료 URL, 이미지 배경, QR 개수/조건, 공개 조건과 순환을 검사한다. 서버 `assert_runnable`도 새 수업/게임 시작 전에 핵심 조건을 검사한다. 활성 수업으로 돌아갈 때는 편집 중인 초안 오류가 방해하지 않는다.

빈 자료 URL은 저장 시 제거한다. 비어 있지 않은 잘못된 URL은 저장하고 경고한다. 실행 오류는 블록 이름과 항목으로 안내한다.

`wait`는 제작 블록 유형에서 제거한다. 로컬/서버 저장 콘텐츠를 읽고 저장하는 정리 과정에서 제거하고 관련 조건을 정리한다. 009 적용 중 기존 활성 세션에 wait가 있으면 해당 블록/참조만 제거하고 진행을 재계산한다. 과거 결과 보관은 변경하지 않는다. 진행할 블록이 없으면 시스템 대기 화면을 사용한다.

## QR 데이터와 서버 처리

콘텐츠 JSON의 기존 `qrMissions`를 내부 저장 형식으로 재사용한다. QR 문제의 `qrMissionId`와 해당 그룹의 `blockId`로 연결한다. 그룹의 `scope`는 문제의 `qrScope`와 일치한다. ANY/ALL/N_OF_M/UNIQUE_MEMBER를 기존 그룹 판정으로 평가한다.

기존 독립 미션은 제작물을 불러올 때 QR 문제로 변환한다. 의존 콘텐츠 앞(없으면 끝)에 배치하고 기존 QR 토큰과 조건을 유지한다. 기존 008 단일 QR 문제는 연결된 그룹을 블록 안으로 가져온다. 복제는 새 QR 토큰을 발급한다. 진행 중인 세션의 QR 설정은 편집본으로 덮어쓰지 않는다.

공개 `escape_scan_qr`(직접 링크), `escape_answer_qr`(문제 버튼)는 모두 서버의 현재 블록 검사를 통과해야 한다. 다른 블록/선행 QR/비 QR 현재 화면/일시정지/탈출 완료에서는 처리하지 않는다. 007의 기존 검증 함수는 private `scan_qr_v7`로 보관해 재사용한다. 콘텐츠 소유·세션·활성·배정·정답 비공개·복구 토큰 검증을 유지한다.

팀 범위는 기존 팀+QR 중복 방지를 유지한다. 학생 범위는 같은 기존 스캔 테이블에서 참가자 subject key로 구분하므로 팀원별로 같은 QR을 찾을 수 있다. 모두 같은 세션 잠금 안에서 처리한다. 조건 달성 시 서버 `complete_block`와 `sync_play`를 호출하고 revision을 갱신한다. 팀 전체 완료는 팀원들의 다음 콘텐츠까지 재계산한다.

QR 진행도와 스캔 버튼은 현재 QR 문제에서만 표시한다. 잘못된 QR은 스캐너 안의 중앙 모달로 표시하며 확인 뒤 기존 카메라 스트림으로 재스캔한다. 모달 닫기/화면 이동/일시정지/현재 블록 변경 때만 스트림을 종료한다.

교사 complete/skip override를 학생 공개 조건보다 먼저 적용한다. move/open override는 배정과 잠금에 우선하며, 기존 소유자 확인·revision 검사·조작 기록을 유지한다.

## 표시 방식

공통 `display`는 card/theme/image. 이전 full은 theme로 변환한다. 이미지 배경은 `backgroundUrl`을 별도 사용하고 cover/center로 비율 유지, 하단 그라데이션과 본문/입력 UI, 반응형 버튼을 제공한다. 서버 학생 projection에는 배경 URL과 테마 색만 추가한다. 답안·QR 토큰은 내려주지 않는다.

## 변경 파일

- 모델/가상 플레이: `src/core/model.js`, `answers.js`, `session.js`, `qr.js`
- 저장/가져오기: `src/data/storage.js`, `supabase.js`, `local-import.js`, `lobby.js`, `examples.js`
- UI: `src/ui/library.js`, `editor.js`, `settings.js`, `lobby.js`, `live-play.js`, `player.js`, `qr.js`
- 신규 UI 모듈: `src/ui/block-qr.js`, `display.js`, `validation.js`, `local-import.js`
- 스타일: `src/experience.css`, `index.html`
- 서버: `supabase/009_editor_flow_and_block_qr.sql`
- 자동 검증: `tests/editor-flow.test.js`, `tests/qr-question.test.js`, `tests/qr.test.js`, `scripts/verify-editor-flow-sql.mjs`, 기존 play/controls/results SQL 스크립트의 `--editor-flow` 옵션

## 검증 기록

2026-09-25 로컬 자동 검증:

- Node 테스트 59개 통과: 초안 저장/빈 미디어/로컬 가져오기 재시도·중복 방지/QR 범위/복제/URL/대비 포함.
- PGlite PostgreSQL: 개인전·팀전과 학생/팀 범위의 QR 4조건, 잘못된·선행·반복 QR, 직접 링크 RPC, 일시정지, 재조회 복구, projection 비공개, 익명/타 교사 권한 차단, 테스트 데이터 정리 통과.
- 강제 skip/move 후 현재 위치 유지, QR 조건보다 우선하는 학생/팀 override, wait 정리, 잘못된 초안의 서버 시작 차단, 활성 세션 재사용, 종료 수업 보관 후 새 대기실 통과.
- 기존 서버 회귀: 정답 유형/협동 조건, 일시정지 시간 제외/교사 제어, 도착 기록/힌트/페널티/순위/보관/초기화/RLS 통과.
- JS 문법 검사 및 GitHub Pages 정적 빌드 통과.

사용자 요청에 따라 이번 변경의 실제 브라우저·Supabase 반복 검증은 수행하지 않았다. 009 적용 후 실제 환경에서 확인할 항목은 카메라 권한 및 잘못된 QR 재스캔, 두 기기의 QR 팀 완료/교사 제어 Realtime, 로그인 시 로컬 가져오기, 모바일/태블릿/PC 배경 표시이다. 실제 콘솔 오류가 없다고 단정하지 않는다. 이번 작업에서 실제 Supabase 테스트 데이터를 만들지 않았다.
