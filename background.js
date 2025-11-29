// background.js
// ──────────────────────────────────────────────
// ▷ content.js에서 보낸 회사명으로 JobPlanet 검색 페이지를 가져오는 역할
// ▷ HTML만 그대로 보내주고 파싱은 content.js에서 처리
// ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "FETCH_JOBPLANET_SCORE" && message.companyName) {

        const searchUrl =
            `https://www.jobplanet.co.kr/search?query=${encodeURIComponent(message.companyName)}`;

        fetch(searchUrl, { credentials: "include" })
            .then(async (res) => {
                const html = await res.text();
                sendResponse({ html, status: res.status });   // content.js에 HTML 전달
            })
            .catch(() => {
                sendResponse({ html: null, status: null });
            });

        return true; // 비동기 응답 지속
    }
});
