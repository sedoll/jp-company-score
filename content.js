// content.js
// ──────────────────────────────────────────────
// ▷ 사람인 / 잡코리아에 잡플래닛 평점 추가
// ▷ URL 변경 시 실행 횟수 리셋 + 최대 10회 실행
// ──────────────────────────────────────────────


// ===========================
// 0. 공통 실행 제어
// ===========================

let RUN_COUNT = 0;
const MAX_RUN = 10;
let LAST_URL = location.href;

function checkUrlChanged() {
    if (location.href !== LAST_URL) {
        LAST_URL = location.href;
        RUN_COUNT = 0;
    }
}


// ===========================
// 1. 검색용 정규화 (㈜ → (주))
// ===========================

function normalizeForSearch(raw) {
    return raw.replace(/㈜/g, "(주)").trim();
}


// ===========================
// ⭐ 2. 비교용 정규화 (법적 표기 제거)
// ===========================

function normalizeForCompare(raw) {
    if (!raw) return "";

    return raw
        .replace(/㈜/g, "")
        .replace(/\(주\)/gi, "")
        .replace(/\(유\)/gi, "")
        .replace(/주식회사/gi, "")
        .replace(/유한회사/gi, "")
        .replace(/\s+/g, " ")
        .trim();
}


// ===========================
// 3. JobPlanet HTML 요청
// ===========================

function requestJobPlanetScore(companyName) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage(
            { type: "FETCH_JOBPLANET_SCORE", companyName },
            (response) => {
                if (!response?.html) return resolve({ score: "N/A" });

                const parser = new DOMParser();
                const doc = parser.parseFromString(response.html, "text/html");

                const headers = doc.querySelectorAll("h4.line-clamp-1.text-gray-800");

                for (const h of headers) {
                    const jpName = h.textContent.trim();

                    // ⭐ 법적 표기 제거 후 동일해야 같은 회사로 인정
                    if (normalizeForCompare(jpName) !== normalizeForCompare(companyName)) {
                        continue;
                    }

                    const spans =
                        h.parentElement?.querySelectorAll("span.text-gray-800") ?? [];

                    for (const s of spans) {
                        if (/ml-\[2px\]/.test(s.className)) {
                            return resolve({ score: s.textContent.trim() });
                        }
                    }
                }

                resolve({ score: "N/A" });
            }
        );
    });
}


// ===========================
// 4. 사람인 회사명 수집
// ===========================
function getSaraminCompanyElements() {
    const path = location.pathname;
    console.log('saramin', path);

    // ▷ 사람인 검색 페이지
    //    예: /zf_user/search?searchword=...
    if (path.startsWith("/zf_user/search")) {
        return Array.from(
            document.querySelectorAll(
                'a[data-track_event="total_search|search_recruit|com_info_btn"]'
            )
        );
    }
    
    // ▷ 사람인 국내 채용 리스트 페이지
    else if (path.startsWith("/zf_user/jobs/list/subway") || path.startsWith("/zf_user/jobs/list/headhunting")
                || path.startsWith("/zf_user/jobs/list/dispatch")) {
        const els1 = Array.from(
            document.querySelectorAll("li.item span.corp")
        );
        const els2 = Array.from(
            document.querySelectorAll("div.box_item a.str_tit")
        );
        return [...els1, ...els2];  // 합쳐서 반환
    }

    else if (path.startsWith("/zf_user/jobs/public/list")) {
        return Array.from(
            document.querySelectorAll("div.company_nm a.str_tit")
        );
    }

    //    예: /zf_user/jobs/list
    else if (path.startsWith("/zf_user/jobs/list") || path.startsWith("/zf_user/curation")) {
        return Array.from(
            document.querySelectorAll("li.item span.corp")
        );
    }

    else if (path.startsWith("/zf_user/salaries/")) {
        return Array.from(
            document.querySelectorAll("div.company_info a.link_tit")
        );
    }

    // ▷ 그 외의 사람인 페이지는 기업 목록 없음 → 빈 배열 반환
    return [];
}

async function displaySaraminScores() {
    const list = getSaraminCompanyElements();
    const map = new Map();

    // console.log(list)
    list.forEach(el => {
        const name = el.textContent.trim();
        if (name && name !== "기업정보") {
            if (!map.has(name)) map.set(name, []);
            map.get(name).push(el);
        }
    });

    for (const [rawName, group] of map.entries()) {
        const first = group[0];
        if (first.nextElementSibling?.classList?.contains("jp-score")) continue;

        const searchName = normalizeForSearch(rawName);

        requestJobPlanetScore(searchName).then(({ score }) => {
            insertScoreUI(group, searchName, score);
        });
    }
}


// ===========================
// 5. 잡코리아 회사명 수집
// ===========================

function getJobKoreaCompanyElements() {
    const path = location.pathname;
    console.log('jobkorea', path);

    // 검색
    if (path.startsWith('/Search/')) {
        const els = Array.from(
            document.querySelectorAll(
                'span[class*="Typography_variant_size16"][class*="Typography_weight_regular"][class*="Typography_color_gray700"][class*="Typography_truncate"]'
            )
        );
    
        const BLOCK = ["기업정보", "채용정보", "알바몬정보"];
    
        return els.filter(el => !BLOCK.includes(el.textContent.trim()));
    }

    // 채용정보
    else if (path.startsWith("/recruit/joblist")) {
        // 검색
        const els1 = Array.from(
            document.querySelectorAll("td.tplCo a.normalLog")
        );

        // 헤드헌팅 채용정보
        const els2 = Array.from(
            document.querySelectorAll("th.tplCo p.tplCoName")
        );

        // 파견대행 채용정보
        const els3 = Array.from(
            document.querySelectorAll("th.tplCo a.normalLog")
        );
        return [...els1, ...els2, ...els3];  // 합쳐서 반환
    }

    // 일간 채용 top 100
    else if (path.startsWith("/top100/")) {
        return Array.from(
            document.querySelectorAll("div.coTit a.coLink b")
        );
    }

    // 공채정보
    else if (path.startsWith("/starter/")) {
        return Array.from(
            document.querySelectorAll("div.coTit a.coLink")
        );
    }

    return []
}

async function displayJobKoreaScores() {
    const list = getJobKoreaCompanyElements();
    const map = new Map();

    list.forEach(el => {
        const name = el.textContent.trim();
        if (!map.has(name)) map.set(name, []);
        map.get(name).push(el);
    });

    for (const [rawName, group] of map.entries()) {
        const first = group[0];
        if (first.nextElementSibling?.classList?.contains("jp-score")) continue;

        const searchName = normalizeForSearch(rawName);

        requestJobPlanetScore(searchName).then(({ score }) => {
            insertScoreUI(group, searchName, score);
        });
    }
}


// ===========================
// 6. UI 추가 함수
// ===========================

function insertScoreUI(group, name, score) {
    const num = parseFloat(score);
    let color = "#aaaaaa";
    if (!isNaN(num)) {
        if (num <= 1.0) color = "#aaaaaa";
        else if (num < 2.0) color = "#fa2d2d";
        else if (num < 3.0) color = "#f1c40f";
        else if (num < 4.0) color = "#27ae60";
        else color = "#2d59fa";
    }

    const jpURL =
        `https://www.jobplanet.co.kr/search?query=${encodeURIComponent(name)}`;

    const isSaramin = location.hostname.includes("saramin");
    const path = location.pathname;
    let style = `display:block;margin:2px 0;font-weight:bold;cursor:pointer;width:fit-content;` // 사람인 검색 페이지를 기본 스타일 값으로 지정
    if (isSaramin && path.startsWith("/zf_user/jobs/list") && (path.includes("domestic") || path.includes("job-category"))
            || path.startsWith("/zf_user/curation")) {
        style = `display:inline-block;font-weight:bold;cursor:pointer;`;
    } else if (!isSaramin) {
        style = `display:block;font-weight:bold;cursor:pointer;width:fit-content;`
    }

    const tag =
        `<span class="jp-score" style="${style}background:#f4f4f6;padding:2px 6px;border-radius:6px;">
            JP Score <span style="color:${color}">${score}</span>
        </span>`;

    group.forEach(el => {
        const parent = el.parentElement;
        if (!parent) return;
    
        // 이미 존재하면 중복 삽입 금지
        const exists = parent.querySelector(".jp-score");
        if (exists) return;
    
        // 삽입 대상: 부모 요소 내부에서 el 바로 뒤 or 버튼 앞
        const btn = parent.querySelector(
            "button, .tplBtnTy, .tplBtnFavOff, .tplBtnFavOn, .favorite-button, .dev-btn-favor, .tplBtnScrOff"
        );
    
        if (btn) {
            // 버튼 뒤에 삽입
            btn.insertAdjacentHTML("afterend", tag);
            const node = btn.nextElementSibling;
            if (node) node.onclick = () => window.open(jpURL, "_blank");
        } else {
            // 버튼 없으면 el 뒤
            el.insertAdjacentHTML("afterend", tag);
            const node = el.nextElementSibling;
            if (node) node.onclick = () => window.open(jpURL, "_blank");
        }
    
        // 사람인: 리스트형 height 강제 보정
        const isSaramin = location.hostname.includes("saramin");
        const path = location.pathname;
    
        if (isSaramin && path.startsWith("/zf_user/jobs/list")) {
            const li = el.closest("li.item");
            if (li) li.style.height = "220px";
        }
    });
}


// ===========================
// 7. 실행 루프
// ===========================

function runLoop() {
    checkUrlChanged();
    if (RUN_COUNT >= MAX_RUN) return;

    RUN_COUNT++;

    if (location.hostname.includes("saramin")) {
        displaySaraminScores();
    } else if (location.hostname.includes("jobkorea")) {
        displayJobKoreaScores();
    }
}

window.addEventListener("load", () => {
    runLoop();
    setInterval(runLoop, 3000);
});
