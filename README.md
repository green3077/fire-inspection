# fire-inspection (소방점검 관리)

조은소방 소방점검 관리 웹앱. 순수 HTML/CSS/JS (프레임워크·빌드 과정 없음), 데이터는 브라우저 IndexedDB에 저장됩니다.

- **배포 주소**: https://green3077.github.io/fire-inspection/
- **로컬 개발**: `python serve.py` 실행 후 `http://localhost:8794` 접속 (같은 Wi-Fi의 휴대폰에서도 콘솔에 뜨는 LAN 주소로 접속 가능)

## 파일 구조

| 파일 | 역할 |
|---|---|
| `index.html` | 전체 화면 마크업 |
| `app.js` | 전체 UI 로직 (단일 IIFE) |
| `db.js` | IndexedDB 래퍼 (sites/inspections/deficiencies/photos 스토어) |
| `checklist-data.js` | 소방점검 표준 체크리스트 템플릿 |
| `import.js` | 지적사항 표 파서 (Excel/Word/PDF) |
| `client-import.js` | 거래처 정보 자동 인식 (보고서 파일 업로드 시) |
| `bldreg.js` | 건축물대장 자동 조회 (juso.go.kr + data.go.kr API) |
| `ui.js` | 커스텀 toast/confirm (네이티브 alert/confirm 사용 안 함) |
| `style.css` | 전체 스타일 (시니어 친화적 큰 글씨 테마) |
| `serve.py` | 로컬 개발 서버 (Python 내장, 별도 설치 불필요) |

데이터 모델: `sites(현장)` → `inspections(점검+체크리스트)`, `deficiencies(지적사항)`는 현장에 직접 연결(점검과 무관하게 존재 가능).

## API 키

`bldreg.js`의 `DEFAULT_KEYS`에 juso.go.kr / data.go.kr 키가 하드코딩되어 있습니다 (공개 저장소이므로 키가 노출됨을 인지하고 있는 상태 — 팀 내부 합의된 선택). 로컬 브라우저의 설정 탭에 개별 키를 입력하면 그 값이 우선 사용됩니다. 키가 만료되면 `bldreg.js`의 `DEFAULT_KEYS`를 갱신하세요.

## 협업 워크플로우

2인 개발 기준 간단한 규칙:

1. 작업 시작 전 `git pull`로 최신 상태 받기
2. 간단한 수정은 `main`에 바로 커밋 후 `git push`
3. 며칠 걸리는 큰 기능은 별도 브랜치(`feature/기능명`)에서 작업 후 서로에게 알리고 병합 — 동시에 같은 파일(특히 `app.js`)을 오래 건드리면 충돌 가능성이 크므로, 작업 시작 전 카톡 등으로 "지금 app.js 건드림" 정도만 공유해도 충분
4. `git push` 전에는 항상 로컬(`localhost:8794`)에서 직접 클릭해보고 콘솔 에러 없는지 확인
5. GitHub Pages 배포는 `main` 브랜치가 그대로 반영되므로, 검증 안 된 변경은 바로 push하지 않기

### IndexedDB는 브라우저별로 분리됨

로컬(`localhost:8794`)과 GitHub Pages(`green3077.github.io`)는 각각 다른 IndexedDB 오리진이라 데이터가 자동으로 섞이지 않습니다. 로컬 개발 중 넣은 테스트 데이터가 배포판에 영향을 주지 않으니 자유롭게 테스트하세요. 단, 팀원 각자의 로컬 DB에는 실제로 입력한 거래처 데이터가 쌓일 수 있으니 남의 브라우저의 IndexedDB를 임의로 초기화하지 않기.
