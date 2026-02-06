# Interview Mode MCP - Context

## 프로젝트 개요
Claude Code용 인터뷰 모드 MCP 서버. 대화로 방향을 잡아가는 범용 인터뷰 기능.
- Claude가 자유롭게 질문/판단 (MCP는 상태만 추적)
- npm 배포 가능한 MCP 서버 형태
- **사용할수록 진화하는 체크포인트 시스템** (Supabase 연동)

## 핵심 파일
| 파일 | 역할 |
|------|------|
| `src/index.ts` | MCP 서버 메인 (도구 4개 + 프롬프트 1개 + 진화 시스템) |
| `dist/index.js` | 빌드 결과물 |
| `.mcp.json` | Claude Code MCP 서버 등록 (env vars 포함) |
| `package.json` | npm 패키지 설정 (`claude-interview-mode`) |
| `supabase/schema.sql` | DB 스키마 (4 테이블) |
| `supabase/migrations/20260207_evolution.sql` | Phase 5 마이그레이션 |

## 아키텍처 결정사항

### Phase 1 결정
1. **MCP 서버 선택** — 슬래시 커맨드(md)는 배포 불가, MCP(npm)는 배포 가능
2. **Claude 자율 주도** — MCP는 기록계일 뿐, 질문 흐름은 Claude가 결정
3. **범용 인터뷰** — 템플릿 없이 자유 형식
4. **결과물 자유** — 인터뷰 후 필요에 따라 파일 생성/수정

### Phase 3 결정 (고도화 인터뷰 2026-02-06)
5. **흐름 지능화** — 이전 답변 기반으로 더 적합한 질문 생성이 핵심
6. **양면 접근** — MCP 서버 분석 기능 + 프롬프트 정교화 동시 진행
7. **데이터 기반 진화** — 하드코딩/프롬프트 위임 대신, 사용 데이터로 체크포인트 자동 확장
8. **Supabase 메타데이터만** — 개인 내용은 로컬만, 카테고리/체크포인트/패턴만 외부 전송
9. **3 레이어 데이터** — 인터뷰 패턴 + 체크포인트 사전 + 질문 품질 스코어
10. **살아있는 체크리스트** — start 로드 → record 매칭 → get_context 미탐색 반환
11. **Claude 매칭 위임** — record 시 covered_checkpoints 파라미터로 Claude가 직접 판단
12. **문서 연동은 프롬프트로** — MCP가 아닌 Claude Code 네이티브 도구(Read/Edit)로 처리
13. **적극 제안형 인터뷰어** — 옵션 나열 아닌 의견+근거 제시

### Phase 3 구현 중 발견 (2026-02-06)
14. **uploadMetadata는 await 필수** — fire-and-forget 시 프로세스 종료 전 업로드 미완료 (레이스 컨디션)
15. **서브에이전트 MCP env var 문제** — Claude Code에서 스폰된 서브에이전트의 MCP 서버에 env var 전달 불안정. 직접 실행 시에는 정상 작동
16. **Supabase REST API는 DDL 불가** — 테이블 생성은 반드시 CLI(`npx supabase db push`) 사용
17. **진단 로그 중요** — 에러 무시(catch empty) 대신 stderr 로그로 디버깅 가능하게

### Phase 5 결정 (진화 시스템 2026-02-06)
18. **checkpoint_scores 테이블** — question_scores 대신 checkpoint_scores로 명명 (체크포인트를 스코어링하는 것이지 질문을 스코어링하는 것이 아님)
19. **베이지안 스무딩** — `(decisions + 0.6) / (covered + 2)` — prior 30% base rate, 5세션 이후 실제 데이터 지배
20. **복합 점수** — `decisionRate * 0.7 + normalizedUsage * 0.3` — 결정률 가중, 사용빈도 보조
21. **추천 경로** — `avg_position ASC` + `decision_rate > 0.2` 필터 — 그래프 탐색 없이 단순 정렬
22. **커버리지 순서 추적** — `CoverageEvent[]`로 체크포인트 커버 순서 + ledToDecision 플래그
23. **소급 마킹** — decision에서 covered_checkpoints 지정 시 이전 QA에서 커버한 체크포인트도 ledToDecision=true
24. **Supabase 리전** — `us-west-2` (ap-northeast-2가 아님, pg 직접 연결로 확인)

## Supabase 정보
- 프로젝트: `tnefdqkeyldkjebtsydd`
- URL: `https://tnefdqkeyldkjebtsydd.supabase.co`
- DB 호스트: `aws-0-us-west-2.pooler.supabase.com` (port 5432)
- 테이블 4개: `checkpoints`, `interview_metadata`, `checkpoint_scores`, `interview_patterns`
- RLS: 전체 테이블 public read/insert/update

## 현재 상태 (v0.3.0)
- Phase 1~5 완료, Phase 6 (npm 배포) 미착수
- 진화 시스템 코드 구현 + 빌드 완료
- **세션 재시작 후 E2E 검증 필요** — 같은 카테고리 인터뷰 2회 실행하여 스코어 축적 확인

## 다음 단계
1. 세션 재시작 → 진화 시스템 E2E 검증 (인터뷰 2회, 스코어 확인)
2. Phase 6: npm 배포 준비 (README, 환경변수 가이드, npx 테스트)
