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

// 회사명 단위로 요청 캐싱 및 in-flight 중복 제거
//  - jobPlanetCache: 이미 받아온 회사 점수를 메모리에 저장해 재사용
//  - inFlightRequests: 동일 회사에 대한 fetch가 진행 중이면 그 Promise를 재사용해 병렬 중복 요청 방지
const jobPlanetCache = new Map();
const inFlightRequests = new Map();

function requestJobPlanetScore(companyName) {
    if (jobPlanetCache.has(companyName)) {
        return Promise.resolve(jobPlanetCache.get(companyName));
    }

    if (inFlightRequests.has(companyName)) {
        return inFlightRequests.get(companyName);
    }

    const req = new Promise((resolve) => {
        chrome.runtime.sendMessage(
            { type: "FETCH_JOBPLANET_SCORE", companyName },
            (response) => {
                if (!response?.html) {
                    inFlightRequests.delete(companyName);
                    return resolve({ score: "N/A" });
                }

                const parser = new DOMParser();
                const doc = parser.parseFromString(response.html, "text/html");

                // 기본 헤더가 없을 때 대비해 h4/h3 텍스트 전체를 스캔
                const headerSelector = "h4.line-clamp-1.text-gray-800, h4, h3";
                const headers = doc.querySelectorAll(headerSelector);

                for (const h of headers) {
                    const jpName = h.textContent?.trim();
                    if (!jpName) continue;

                    // ⭐ 법적 표기 제거 후 동일해야 같은 회사로 인정
                    if (normalizeForCompare(jpName) !== normalizeForCompare(companyName)) {
                        continue;
                    }

                    // 점수는 기본 클래스가 없을 수도 있으니 숫자 포함 텍스트를 폭넓게 탐색
                    const scoreCandidate =
                        h.parentElement?.querySelector('[class*="text-gray"]') ??
                        h.parentElement?.querySelector('[class*="rating"]') ??
                        h.parentElement?.querySelector('[class*="score"]') ??
                        h.parentElement?.querySelector("span, strong");

                    const rawScore = scoreCandidate?.textContent?.trim();
                    const numScoreFromNode = rawScore ? parseFloat(rawScore) : NaN;

                    // 추가 안전장치: 헤더 주변 텍스트에서 1.0~5.0 사이 숫자 추출
                    const siblingText = h.parentElement?.textContent ?? "";
                    const regexMatch = siblingText.match(/([1-5](?:\.\d)?)/);
                    const parsedRegex = regexMatch ? parseFloat(regexMatch[1]) : NaN;

                    const chosenScore = !Number.isNaN(numScoreFromNode)
                        ? numScoreFromNode
                        : !Number.isNaN(parsedRegex)
                            ? parsedRegex
                            : NaN;

                    const result =
                        !Number.isNaN(chosenScore)
                            ? { score: chosenScore.toFixed(1) }
                            : { score: "N/A" };

                    jobPlanetCache.set(companyName, result);
                    inFlightRequests.delete(companyName);

                    if (result.score === "N/A") {
                        console.log("[jp-score] Score not found for matched company", {
                            companyName,
                            rawScore,
                            siblingTextSample: siblingText.slice(0, 120),
                        });
                    }

                    return resolve(result);
                }

                inFlightRequests.delete(companyName);
                const fallback = { score: "N/A" };
                jobPlanetCache.set(companyName, fallback);
                console.log("[jp-score] Company not matched in JobPlanet results", {
                    companyName,
                    status: response.status,
                    htmlSample: response.html.slice(0, 400),
                });
                resolve(fallback);
            }
        );
    });

    inFlightRequests.set(companyName, req);
    return req;
}


// ===========================
// 4. 사람인 회사명 수집
// ===========================
function getSaraminCompanyElements() {
    const path = location.pathname;

    // ▷ 사람인 검색 페이지
    //    예: /zf_user/search?searchword=...
    if (path.startsWith("/zf_user/search")) {
        return Array.from(
            document.querySelectorAll(
                'a[data-track_event="total_search|search_recruit|com_info_btn"]'
            )
        );
    }

    return [];
}

async function displaySaraminScores() {
    const list = getSaraminCompanyElements();
    const map = new Map();

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

    // ▷ 잡코리아 검색 페이지
    //    예: /Search...
    if (path.startsWith("/Search")) {
        const els = Array.from(
            document.querySelectorAll(
                'span[class*="Typography_variant_size16"][class*="Typography_weight_regular"][class*="Typography_color_gray700"][class*="Typography_truncate"]'
            )
        );
        // 채용 공고 상단 탭 글자는 제외
        const BLOCK = ["기업정보", "채용정보", "알바몬정보"];
        return els.filter(el => !BLOCK.includes(el.textContent.trim()));
    }

    return [];
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
        if (num <= 1.0) color = "#aaaaaa";      // Gray
        else if (num < 2.0) color = "#fa2d2d"; // Red
        else if (num < 3.0) color = "#f1c40f"; // Yellow
        else if (num < 4.0) color = "#27ae60"; // Green
        else color = "#2d59fa";               // Blue
    }

    const jpURL =
        `https://www.jobplanet.co.kr/search?query=${encodeURIComponent(name)}`;

    const isSaramin = location.hostname.includes("saramin");

    const style = isSaramin
        ? `display:block;margin:2px 0;font-weight:bold;cursor:pointer;width:fit-content;`
        : `display:inline-block;margin-left:6px;font-weight:bold;cursor:pointer;width:fit-content;`;

    const tag =
        `<span class="jp-score" style="${style}background:#f4f4f6;padding:2px 6px;border-radius:6px;">
            JP Score <span style="color:${color}">${score}</span>
        </span>`;

    group.forEach(el => {
        if (!el.nextElementSibling?.classList?.contains("jp-score")) {
            el.insertAdjacentHTML("afterend", tag);
            el.nextElementSibling.onclick = () => window.open(jpURL, "_blank");
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
