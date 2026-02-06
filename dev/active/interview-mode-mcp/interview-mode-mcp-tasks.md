# Interview Mode MCP - Tasks

## Phase 1: 초기 구현 (완료)
- [x] npm 프로젝트 초기화 (package.json, tsconfig.json)
- [x] MCP SDK + Zod 의존성 설치
- [x] MCP 서버 구현 (start_interview, record, get_context, end_interview)
- [x] interview 프롬프트 구현
- [x] TypeScript 빌드 성공
- [x] 서버 프로토콜 응답 테스트 통과
- [x] `.mcp.json` 설정 (프로젝트 레벨 MCP 등록)

## Phase 2: 테스트 & 검증 (완료)
- [x] 새 세션에서 MCP 서버 로드 확인
- [x] `start_interview` 도구 호출 테스트
- [x] `record` (qa/decision) 도구 호출 테스트
- [x] `get_context` 도구 호출 테스트
- [x] `end_interview` 도구 호출 테스트
- [x] 실제 인터뷰 대화 E2E 테스트 (고도화 인터뷰 14 Q&A, 10 결정)

## Phase 3: 체크포인트 시스템 + Supabase 연동 (완료)
- [x] Supabase 프로젝트 생성 (tnefdqkeyldkjebtsydd)
- [x] `checkpoints` 테이블 생성 (카테고리별 체크포인트 사전)
- [x] `interview_metadata` 테이블 생성 (세션 메타데이터)
- [x] RLS 정책 설정 (public read/insert/update)
- [x] `supabase/schema.sql` 작성 + `npx supabase db push`로 배포
- [x] Supabase 클라이언트 연동 (환경변수 기반, 없으면 로컬 전용)
- [x] `start_interview` 수정: category 파라미터 + Supabase에서 체크포인트 로드
- [x] `record` 수정: `covered_checkpoints` 파라미터 추가 + 매칭 로직
- [x] `get_context` 수정: 미탐색 체크포인트 함께 반환
- [x] `end_interview` 수정: 메타데이터 Supabase 업로드 (await 방식)
- [x] uploadMetadata 진단 로그 추가
- [x] 빌드 성공
- [x] 직접 MCP 실행 시 Supabase insert 정상 확인

## Phase 3.5: 스트레스 테스트 (완료)
- [x] 10개 다양한 페르소나 에이전트 인터뷰 (SaaS, Mobile PM, E-commerce 등)
- [x] 10개 업무자동화 페르소나 에이전트 인터뷰 (HR, 회계, 영업 등)
- [x] 모든 20개 에이전트 완료 확인
- [x] Supabase 민감정보 유출 없음 확인
- [x] 세션 재시작 후 실제 Supabase 데이터 축적 검증 (id:4 정상 저장 확인)

## Phase 4: 프롬프트 고도화 (완료)
- [x] 적극 제안형 인터뷰어 프롬프트 작성
- [x] 문서 연동 지시 추가 (시작 시 관련 문서 확인/읽기, 종료 시 수정 제안)
- [x] 체크포인트 활용 지시 (미탐색 항목 기반 다음 질문 방향)
- [x] 빌드 성공

## Phase 5: 진화 시스템 (완료)
- [x] `checkpoint_scores` 테이블 설계 + 생성 (베이지안 스무딩 결정률, 평균 위치)
- [x] `interview_patterns` 테이블 설계 + 생성 (세션별 커버리지 시퀀스)
- [x] Supabase RLS 정책 설정 (pg 직접 연결, us-west-2 리전)
- [x] 타입 추가: `CoverageEvent`, `CheckpointScore`, `Checkpoint.score`
- [x] 헬퍼 함수: `bayesianDecisionRate()`, `compositeScore()`, `computeRecommendedPath()`, `loadCheckpointScores()`
- [x] `start_interview` 수정: 스코어 로드 + compositeScore 정렬 + recommended_path/high_value_checkpoints 응답
- [x] `record` 수정: coverageOrder 추적 + ledToDecision 마킹(소급 포함) + next_recommended
- [x] `get_context` 수정: 스코어 기반 정렬 + recommended_next + coverage_order_so_far
- [x] `uploadMetadata` 수정: interview_patterns insert + checkpoint_scores upsert + decision_count 증분 수정
- [x] 프롬프트 수정: Checkpoint Strategy 섹션 추가
- [x] 빌드 성공 (v0.3.0)
- [ ] 세션 재시작 후 E2E 검증 (같은 카테고리 인터뷰 2회 → 스코어 축적 확인)

## Phase 6: npm 배포 (미착수)
- [ ] README.md 작성 (영어, 설치/설정/사용법)
- [ ] 환경변수 가이드
- [ ] `npx claude-interview-mode` 실행 테스트
- [ ] npm publish
