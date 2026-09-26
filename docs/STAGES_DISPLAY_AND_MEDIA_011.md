# 011 제작기·학생 표시·자료 업로드 변경 기록

작성일: 2026-09-26. 상태: 구현 및 로컬 자동 검증 완료, 실제 Supabase 적용/배포 대기.

## 적용 순서

1. 이미 적용한 001~010은 다시 실행하지 않는다. 해당 파일들은 이번 변경에서 수정하지 않았다.
2. 다음 파일 **전체**를 Supabase SQL Editor의 새 쿼리에 붙여 넣고 한 번 실행한다.

   `C:\Users\ywj58\OneDrive\바탕 화면\방탈출\supabase\011_stages_display_and_media.sql`
3. 성공 결과를 확인한 후 새 프런트엔드를 배포한다. 이번 작업에서는 원격 DB 적용, Git push, GitHub Pages 배포를 수행하지 않았다.
4. 적용 후 아래 실제 환경 확인만 수행한다. 기존 수업 snapshot은 이 마이그레이션이나 제작기 편집으로 자동 교체되지 않는다.

SQL이 `escape-media` public bucket, 허용 MIME, 버킷 용량 제한, 소유자 업로드/삭제 정책을 만든다. 별도로 공개 쓰기 정책을 만들 필요가 없다. Publishable Key와 교사 로그인 JWT를 사용하며, 관리자 키를 클라이언트에 추가하지 않았다.

앱은 이미지 15MiB, 오디오 20MiB, 영상 100MiB를 제한한다. **프로젝트의 Storage 전역 제한도 적용된다.** Supabase Free는 전역 최대 50MB이므로 Free에서 50MB 초과 영상 업로드는 불가능하다. 100MiB 업로드가 필요한 프로젝트는 해당 용량을 지원하는 요금제와 전역 제한이 필요하다. 앱은 서버 용량 오류를 안내하며, 큰 영상은 기존 외부 URL 입력으로 사용할 수 있다. 요금제나 전역 설정은 자동 변경하지 않았다.

공식 문서: [파일 용량 제한](https://supabase.com/docs/guides/storage/uploads/file-limits), [Storage RLS](https://supabase.com/docs/guides/storage/security/access-control), [파일 삭제 API](https://supabase.com/docs/guides/storage/management/delete-objects).

## 요구사항별 상태

아래의 ‘구현’은 코드 및 로컬 검증 완료를 의미한다. 실제 호스팅 Storage API와 로그인 계정 검증은 SQL 적용 후 진행한다.

| 요구사항 | 상태 및 동작 |
| --- | --- |
| 1 교사 화면 왕복 | 구현. 상단에는 `← 방탈출 편집`만 표시. 같은 contentId로 이동하며 기존 세션을 종료/초기화하지 않음. |
| 2 스테이지 그룹 | 구현. 이름·빈 그룹 추가·그룹별 블록 추가·위아래 이동·번호 재계산·블록 드래그·소속 선택·접기. 기존 stage를 그룹으로 해석하고 블록/QR/조건 ID 유지. |
| 3 카드 위치/순서 | 구현. 기본 화면만 만들기 카드 우선, 검색/필터 시 제거, createdAt 오름차순 및 ID 동률 정렬. |
| 4 설명 | 구현. room.description만 사용, 빈 설명 placeholder 제거, 두 줄 제한. |
| 5 코드 가독성 | 구현. 진한 색·큰 글자·강조 숫자. |
| 6 테마 카드 | 구현. 기존 카드 헤더에 테마색 적용, 명도에 따른 글자색. |
| 7 수업 기록 관리 | 구현. 현재 수업 초기화는 기존 reset 모달/RPC 재사용(삭제 기본값). 과거 보관 결과 전체 삭제는 별도 소유자 RPC와 파괴적 확인창. 다른 콘텐츠/활성 수업 불변. |
| 8~10 전체 설정 | 구현. 왼쪽 상단 고정 버튼, 가운데 A~F 아코디언, 실제 room 필드 자동 저장. |
| 11 표시 정책 | 구현. 21개 부가 정보의 항상/info/숨김. 필수 본문·문제 조작·QR·승인·오류 안내 유지. |
| 12 몰입형 | 구현. 항상 표시도 정보창으로 이동. 전체 이미지·자막·터치 진행 및 정보 클릭 분리 유지. |
| 13 디자인 | 구현. 배경색/테마색 picker+HEX, 자동/밝은/어두운 글자, 기본 이미지 cover, 밝은/어두운/반투명 카드. 개별 theme/image/immersive 표시 우선. |
| 14~15 규칙/팀 | 구현. 기존 rules/teamSettings를 그대로 편집. 개인전 팀 설정 비활성. |
| 16 음악 | 구현. URL/업로드·음량·음소거 허용. 사용자 음악 시작 버튼으로 자동 재생 제한 대응, 일시정지/종료 시 중지. |
| 17~18 공통 업로드/Storage | 구현. 파일 선택·드롭·진행률·미리보기·파일명/크기·교체/삭제/실패 안내. 교사/콘텐츠/자료종류/랜덤파일 경로. public 읽기, 소유 경로만 쓰기/삭제. 실제 Storage 확인은 적용 후. |
| 19~22 유형/최적화 | 구현. 이미지 클라이언트 최적화 1600px(배경/고화질 1920px), WebP .83/.9, 원본 유지, 투명도 유지, 작은 파일 불필요 재압축/확대 방지. GIF 및 오디오/영상 원본 유지. 용량 제한 적용. |
| 23 파일 수명 | 구현. 새 업로드→문서 저장 성공→미사용 기존 파일 정리. 문서/활성 snapshot/사본 참조는 보존. 방 삭제 시 원본 폴더와 문서에 연결된 자체 Storage 경로 정리. |
| 24 외부 URL | 구현. URL 입력 원문 저장, 자동 다운로드·재압축·Storage 삭제 없음. 기존 warning/fallback 유지. |
| 25 사본 | 구현. 콘텐츠/코드/블록/QR/스테이지 ID 독립, 파일 URL 공유 허용 및 참조 보호. |
| 26~28 모델/스냅샷/공통 UI | 구현. JSON 확장·normalize·서버 실행 검증·최소 학생 projection. 기존 진행 중 snapshot 불변, 자료 업로드 helper/화면 공유. |
| 29 테스트 | 로컬 Node·PGlite·headless UI·빌드 완료. 실제 배포 환경 체크는 아래 참조. |
| 30 마이그레이션 | 011 파일 하나만 추가. 사용자 적용 시점에서 중단. |
| 31 보고 | 본 문서에 기능·파일·모델·정책·테스트·제약 정리. |

## 주요 변경 파일

- `src/core/stages.js`: 그룹 정규화·이동·번호 계산.
- `src/core/presentation.js`: 표시 정책·디자인/음악 기본값·생성순 정렬.
- `src/core/model.js`: 기존 문서 호환, 사본 ID 재배정, 실행 검증과 자료 경고.
- `src/ui/editor.js`, `src/ui/room-settings.js`: 그룹 제작기 및 실제 전체 설정 저장.
- `src/ui/library.js`, `src/data/storage.js`, `src/data/supabase.js`: 카드·정렬·수업/기록 메뉴.
- `src/data/media-storage.js`, `src/ui/upload.js`: 공통 업로드·최적화·참조 확인·안전한 교체.
- `src/ui/student-info.js`, `src/ui/display.js`, `src/ui/immersive.js`: 3단계 정보 표시·디자인·BGM.
- `src/ui/player.js`, `src/ui/live-play.js`, `src/ui/lobby.js`, `src/ui/results.js`: 실제/테스트 플레이 연결 및 교사 동선.
- `src/ui/asset-probe.js`, `src/ui/asset-fallback.js`, `src/experience.css`: 기본 자료 검사·fallback·스타일.
- `tests/stages-media.test.js`, `scripts/verify-media-sql.mjs`, `scripts/storage-fixture.mjs`, `scripts/verify-ux-ui.mjs`: 신규 검증. 기존 SQL 검증 스크립트 5종은 `--media` 옵션으로 011까지 적용 가능.
- `SPEC.md`: 이번 동작 명세 반영.

## JSON 필드

별도 스테이지 테이블은 만들지 않는다.

- `room.stageGroups[]`: `{id, name, legacyStage?}`. 표시 순서는 배열 순서. 이전 stage 값은 legacyStage에 남기며 최초 해석 시 기존 콘텐츠 배열 순서를 보존한다.
- `block.stageId`: 그룹 ID. 기존 `block.stage`는 현재 그룹 순서의 문자열 번호로 계속 저장해 기존 서버 엔진을 재사용한다. 그룹/블록 이동 시 콘텐츠 배열도 그룹 순서로 갱신한다.
- `room.studentDisplaySettings`: 항목별 `always | info | hidden`. 이전 문서에서 필드 생략 시 기존 상시 정보를 우선하는 기본값, 새 콘텐츠는 제목/진행/블록 제목/유형 상시 및 세부 정보 info.
- `room.design`: `backgroundColor`, `text: auto|light|dark`, `card: light|dark|glass`.
- `room.sound`: `volume`(0~1), `allowMute`.
- 기존 `theme.color/background/bgm`, `description`, `rules`, `teamSettings` 재사용.
- `theme.backgroundUpload/bgmUpload`, `block.backgroundUpload`, `media[].upload`: 파일명·저장 크기·원본 크기(가능한 경우). 미디어 URL은 기존 필드에 그대로 저장한다.

학생 응답은 표시용 theme/design/sound/표시정책/본인 결과 통계 및 스테이지 이름만 추가한다. 정답이나 원본 콘텐츠 전체를 새로 내려주지 않는다. 공개 순위/전체 현황은 기존 서버의 공개 범위 안에서만 표시하며, 표시 설정으로 비공개 팀 진행을 공개하지 않는다.

## 011 테이블·RPC·정책

- 신규 `escape_private.media_retired`: 삭제 경로 tombstone. 문서 참조 생성과 삭제를 트랜잭션 advisory lock으로 직렬화하고 삭제한 URL을 뒤늦게 다시 저장하는 충돌을 방지한다. 클라이언트 조회 불가.
- `storage.buckets`, `storage.objects`: escape-media 버킷 및 소유자 정책. 기존 넓은 정책이 있더라도 이 버킷에서 타인 쓰기/삭제/덮어쓰기를 허용하지 않는 restrictive guard 포함.
- 신규 교사 RPC `escape_unused_media`, `escape_room_media`, `escape_library_sessions`, `escape_delete_archives`.
- Storage 정책 helper `escape_storage_owned`, `escape_storage_can_insert`, `escape_storage_can_delete`.
- private `student_projection`, `asset_warnings`, `safe_play_document`, `assert_runnable` 확장. 기존 버전 함수는 wrapper에서 재사용.
- `escape_contents.document`, `escape_sessions.content_snapshot` 참조 보호 트리거. 마이그레이션은 기존 document/snapshot 자체를 일괄 변경하지 않음.
- 실제 파일 바이트 삭제는 **Storage API**만 사용한다. SQL에서 storage.objects를 직접 삭제하는 운영 기능을 만들지 않았다. PGlite 테스트의 메타데이터 삭제는 정책 검증용 fixture이다.

## 자동 검증 결과

- `node --test`: 86/86 통과(스토리 내보내기 추가 테스트 포함).
- 011 포함 PGlite 6개 스크립트 통과:
  - `node scripts/verify-play-sql.mjs --controls --results --editor-flow --ux --media`
  - `node scripts/verify-controls-sql.mjs --results --editor-flow --ux --media`
  - `node scripts/verify-results-sql.mjs --editor-flow --ux --media`
  - `node scripts/verify-editor-flow-sql.mjs --ux --media`
  - `node scripts/verify-ux-sql.mjs --media`
  - `node scripts/verify-media-sql.mjs`
- 기존 역사적 migration 범위의 대기실/QR/QR 문제 전용 3개 스크립트도 통과: `verify-lobby-sql.mjs`, `verify-qr-sql.mjs`, `verify-qr-question-sql.mjs`. 최신 011의 QR 경로는 위 editor-flow 테스트에서도 검증.
- `node scripts/verify-ux-ui.mjs`: 격리된 headless Edge에서 그룹 이름/추가/접기/이동 및 실제 마우스 드래그 후 저장, 카드 정렬/검색/필터, 3단계 정보와 필수 조작, 전체화면 미리보기, 몰입형 진행/키보드/오류, 업로드 진행, PNG 투명도 유지 최적화, 이메일 콜백 통과. 처리되지 않은 JS 오류 없음.
- 이미지/음성/영상 업로드 요청·교사 JWT·경로·외부 URL 보존·교체 실패/응답 유실 안전성: mock XHR 및 단위 테스트 통과.
- Storage 소유 경로, 익명/다른 교사 거절, 복제 문서/활성 snapshot 참조 보호, tombstone, 결과 삭제 범위, fixture 정리: PGlite 통과.
- `node scripts/build.mjs`, JavaScript 구문 검사, `git diff --check` 통과.
- 테스트는 로컬 fixture만 사용했다. 이번 작업에서 실제 Supabase에 테스트 콘텐츠/파일/학생/기록을 생성하지 않았다.

## 적용·배포 후 사람 확인

1. 로그인 교사 계정에서 이미지/음성/영상을 각 1개 업로드하고 실제 public URL 재생 및 파일명/진행률/실패 안내 확인.
2. 이미지 교체·삭제 후 미참조 파일이 Storage에서 제거되는지, 사본 및 playing/paused snapshot이 쓰는 파일은 유지되는지 확인.
3. 실제 교사 대기실→편집→진행 상황 왕복 시 동일 학생/팀/세션 유지 확인.
4. 모바일에서 그룹 이동 보조 select/버튼, 정보 패널·몰입형·QR 필수 조작, BGM 첫 사용자 클릭 및 음소거 설정 확인.
5. 테스트용 수업에서 현재 초기화(기본 삭제/선택 보관)와 별도 과거 기록 삭제 확인. 실제 수업 자료를 검증용으로 삭제하지 않음.
6. Supabase API의 실제 Storage/RPC 권한 응답과 브라우저 콘솔 확인. 로컬의 mocked HTTP/Realtime 검증은 배포 환경 네트워크 검증을 대체하지 않음.

## 의도적인 범위/제약

- 외부 URL 재저장·오디오/영상 재인코딩·관리자 키 도입·진행 중 snapshot 자동 교체는 요구사항에 따라 하지 않았다.
- 브라우저 정책 때문에 BGM 무조건 자동 재생은 하지 않으며 음악 시작 버튼을 제공한다.
- 저장 성공 여부까지 확인할 수 없는 네트워크 장애에서는 파일을 보수적으로 남긴다. 정상 저장 이후 미사용 파일 정리를 시도하고, 오류를 표시한다. 업로드 중 탭 강제 종료 등으로 생긴 모든 고아 파일의 정기 수거 작업은 추가하지 않았다.
- 진행 중 수업이 참조해서 보존한 파일은 이후 편집 저장/해당 콘텐츠 삭제 등 정리 기회에 다시 검사한다. 백그라운드 자동 만료 작업은 없다.
- SQL 적용과 실제 서비스 배포·전역 Storage 설정 변경은 사용자가 수행한다.


## 추가 요청: 스토리 텍스트 내보내기

- 제작기 왼쪽의 기존 JSON 내보내기 옆에 `스토리 텍스트로 내보내기`를 추가했다. JSON 내보내기는 그대로 유지했다.
- `src/core/story-export.js`는 순수 텍스트 생성 함수이며 room을 수정하지 않는다. 스테이지 그룹 순서와 블록 순서, 전체 콘텐츠 번호를 사용한다. 스토리만 출력하면 중간 문제 번호는 건너뛴다.
- `src/ui/story-export.js`는 범위(스토리만/스토리+안내/모두), 번호/스테이지/정답 옵션과 즉시 갱신 미리보기, 복사 및 저장 버튼을 제공한다. 기본값은 스토리만·번호 ON·스테이지/정답 OFF이다.
- `src/data/story-export.js`는 Clipboard API 및 선택 복사 fallback, UTF-8 BOM TXT 저장을 담당한다. 파일 내용은 미리보기와 동일하다.
- 본문 줄바꿈과 표현을 유지하고 과도한 빈 줄/HTML을 텍스트로 정리한다. 시스템 ID·QR token·조건·미디어 필드는 내보내지 않는다. 순서형/짝맞추기 정답은 선택한 경우만 읽기 좋게 표시한다.
- `tests/story-export.test.js`의 11개 테스트와 headless UI의 실제 다운로드/복사/저장 호출 없음 검증이 통과했다.
- 이 추가 기능은 DB/RPC/Storage/학생 플레이를 변경하지 않으며 별도 migration이 없다. 011은 앞선 제작기·Storage 요청에 필요한 파일이다.
