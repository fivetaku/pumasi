# 버전 고르는 원칙

특정 연도의 추천표를 두지 않는다. 표는 금방 낡고, 낡은 표는 워커에게 틀린 버전을 강요한다.

1. **기존 프로젝트**: `package.json`·잠금 파일·`pyproject.toml` 등에 이미 있는 버전을 따른다. 업그레이드는 별도 태스크로 명시할 때만 한다.
2. **새 패키지·새 프로젝트**: 그 시점의 안정 버전을 레지스트리에서 확인해 instruction에 적는다 (예: `npm view <pkg> version`, `pip index versions <pkg>`).
3. **꼭 지켜야 할 메이저 버전**(API가 크게 다른 경우)은 instruction에 명시하고, 필요하면 게이트로 확인한다 (예: `node -e "process.exit(require('react/package.json').version.startsWith('19.')?0:1)"`).
4. 프로젝트 공통 규칙(패키지 매니저, 모듈 형식 등)은 config의 `style`에 적으면 모든 워커 프롬프트에 들어간다.
