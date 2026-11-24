const HLTB_INIT_URL = "https://howlongtobeat.com/api/search/site/init";
const HLTB_SEARCH_URL = "https://howlongtobeat.com/api/search/site";

let cachedSecurity = null;

// Ensure header modification rules are active dynamically
async function setupRules() {
    try {
        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: [1001],
            addRules: [
                {
                    id: 1001,
                    priority: 2,
                    action: {
                        type: "modifyHeaders",
                        requestHeaders: [
                            { header: "Origin", operation: "set", value: "https://howlongtobeat.com" },
                            { header: "Referer", operation: "set", value: "https://howlongtobeat.com/" }
                        ]
                    },
                    condition: {
                        urlFilter: "||howlongtobeat.com/api/*",
                        resourceTypes: ["xmlhttprequest", "other"]
                    }
                }
            ]
        });
        console.log("[HLTB] Dynamic header spoofing rules active.");
    } catch (e) {
        console.warn("[HLTB] Error setting dynamic rules:", e);
    }
}
setupRules();

async function getSecurityContext(forceRefresh = false) {
    if (!forceRefresh && cachedSecurity && (Date.now() - cachedSecurity.timestamp < 10 * 60 * 1000)) {
        return cachedSecurity;
    }

    try {
        console.log("[HLTB] Fetching security context token...");
        const response = await fetch(`${HLTB_INIT_URL}?t=${Date.now()}`, {
            method: "GET",
            headers: {
                "Accept": "application/json"
            }
        });

        if (!response.ok) {
            throw new Error(`Security init failed (${response.status})`);
        }

        const data = await response.json();
        cachedSecurity = {
            token: data.token,
            hpKey: data.hpKey,
            hpVal: data.hpVal,
            timestamp: Date.now()
        };
        console.log("[HLTB] Security context initialized successfully with key:", data.hpKey);
        return cachedSecurity;
    } catch (err) {
        console.error("[HLTB] Failed to initialize security context:", err);
        throw err;
    }
}

// Helper to clean Steam game titles for search matching
function cleanGameTitleForSearch(title) {
    if (!title) return '';
    let cleaned = title.toLowerCase().trim();
    
    // 1. If it contains both English/ASCII and non-ASCII, strip non-ASCII
    const hasAscii = /[a-z0-9]/.test(cleaned);
    const hasNonAscii = /[^\x00-\x7F]/.test(cleaned);
    if (hasAscii && hasNonAscii) {
        cleaned = cleaned.replace(/[^\x00-\x7F]/g, ' ');
    }
    
    // 2. Replace trademark, registered, copyright, and punctuation symbols with space
    cleaned = cleaned.replace(/[™®©\-–—/\\_.,:!?'"~`@#$%^&*()[\]{}<>+=]/g, ' ');
    
    // 3. Remove anything in parenthesis (e.g. (Beta), (Demo))
    cleaned = cleaned.replace(/\([^)]*\)/g, '');
    
    // 4. Insert space between adjacent letters and numbers
    cleaned = cleaned.replace(/([a-z])([0-9])/g, '$1 $2');
    cleaned = cleaned.replace(/([0-9])([a-z])/g, '$1 $2');
    
    // 5. Collapse multiple spaces
    cleaned = cleaned.replace(/\s+/g, ' ');
    
    return cleaned.trim();
}

// Generate ordered search candidates to maximize HLTB hits
function generateSearchCandidates(rawTitle) {
    const candidates = new Set();
    const title = (rawTitle || '').trim();
    if (!title) return [];

    candidates.add(title);

    // 1. Remove parentheticals / brackets (e.g. "Persona 5 Royal (2022)" -> "Persona 5 Royal")
    const noParens = title.replace(/\s*\([^)]*\)/g, '').replace(/\s*\[[^\]]*\]/g, '').trim();
    if (noParens && noParens !== title) {
        candidates.add(noParens);
    }

    // 2. Split by slash (e.g. "NEEDY STREAMER OVERLOAD / NEEDY GIRL OVERDOSE")
    if (title.includes('/')) {
        const parts = title.split('/');
        parts.forEach(p => {
            const trimmed = p.trim();
            if (trimmed.length >= 2) candidates.add(trimmed);
        });
    }

    const baseForSplit = noParens || title;

    // 3. Split by colon - take primary title (e.g. "TOEM: A Photo Adventure" -> "TOEM")
    if (baseForSplit.includes(':')) {
        const beforeColon = baseForSplit.split(':')[0].trim();
        if (beforeColon.length >= 2) candidates.add(beforeColon);
    }

    // 4. Split by dash (e.g. "Unheard - Voices of Crime" -> "Unheard")
    if (/ [-–—] /.test(baseForSplit)) {
        const beforeDash = baseForSplit.split(/ [-–—] /)[0].trim();
        if (beforeDash.length >= 2) candidates.add(beforeDash);
    }

    // 5. Strip edition / version suffixes (e.g. "Game of the Year Edition", "Remastered", "Deluxe")
    const noEdition = baseForSplit.replace(/\b(Game of the Year(\s*Edition)?|GOTY|Deluxe(\s*Edition)?|Definitive(\s*Edition)?|Remastered|Enhanced(\s*Edition)?|Special(\s*Edition)?|Collector's(\s*Edition)?|Director's Cut|Anniversary(\s*Edition)?|Standard(\s*Edition)?|Complete(\s*Edition)?|Gold(\s*Edition)?|Ultimate(\s*Edition)?|Legendary(\s*Edition)?)\b/gi, '').trim();
    if (noEdition && noEdition !== baseForSplit && noEdition.length >= 2) {
        candidates.add(noEdition);
    }

    // 6. Cleaned base title (e.g. "toem", "the witcher 3")
    const cleaned = cleanGameTitleForSearch(baseForSplit);
    if (cleaned && cleaned.length >= 2) {
        candidates.add(cleaned);
    }

    return Array.from(candidates);
}

// Calculate string similarity percentage using Levenshtein distance
function calcDistancePercentage(text, term) {
    let longer = String(text).toLowerCase().trim();
    let shorter = String(term).toLowerCase().trim();
    if (longer.length < shorter.length) {
        let temp = longer;
        longer = shorter;
        shorter = temp;
    }
    let longerLength = longer.length;
    if (longerLength === 0) return 1.0;

    const costs = [];
    for (let i = 0; i <= longer.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= shorter.length; j++) {
            if (i === 0) {
                costs[j] = j;
            } else {
                if (j > 0) {
                    let newValue = costs[j - 1];
                    if (longer.charAt(i - 1) !== shorter.charAt(j - 1)) {
                        newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                    }
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
        }
        if (i > 0) costs[shorter.length] = lastValue;
    }
    const dist = costs[shorter.length];
    return Math.round(((longerLength - dist) / longerLength) * 100) / 100;
}


                sendResponse({ success: false, error: error.toString() });
            });
        return true; // Keep message channel open for async response
    }
});

async function searchSingleHLTB(term, security) {
    const searchTerms = term.trim().split(/\s+/).filter(Boolean);
    if (searchTerms.length === 0) return [];

    const payload = {
        searchType: "games",
        searchTerms: searchTerms,
        searchPage: 1,
        size: 10,
        searchOptions: {
            games: {
                userId: 0,
                platform: "",
                sortCategory: "popular",
                rangeCategory: "main",
                rangeTime: { min: 0, max: 0 },
                gameplay: { perspective: "", flow: "", genre: "", difficulty: "" },
                year: "",
                modifier: ""
            },
            users: { sortCategory: "postcount" },
            lists: { sortCategory: "postcount" },
            filter: "",
            sort: 0,
            randomizer: 0
        },
        useCache: true,
        [security.hpKey]: security.hpVal
    };

    const response = await fetch(HLTB_SEARCH_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-auth-token": security.token,
            "x-hp-key": security.hpKey,
            "x-hp-val": security.hpVal
        },
        body: JSON.stringify(payload)
    });

    if (response.status === 403) {
        throw new Error("403_FORBIDDEN");
    }

    if (!response.ok) {
        throw new Error(`HLTB API status: ${response.status}`);
    }

    const json = await response.json();
    return json.data || [];
}

async function fetchHLTB(appName, isRetry = false) {
    let security = await getSecurityContext(isRetry);
    const candidates = generateSearchCandidates(appName);
    console.log(`[HLTB] Generated ${candidates.length} candidates for "${appName}":`, candidates);

    let allResults = [];
    let matchedCandidate = null;

    for (const candidate of candidates) {
        try {
            console.log(`[HLTB] Searching HLTB for candidate: "${candidate}"`);
            const results = await searchSingleHLTB(candidate, security);
            if (results && results.length > 0) {
                allResults = results;
                matchedCandidate = candidate;
                break;
            }
        } catch (err) {
            if (err.message === "403_FORBIDDEN" && !isRetry) {
                console.warn("[HLTB] 403 Forbidden, refreshing token and retrying...");
                security = await getSecurityContext(true);
                return fetchHLTB(appName, true);
            }
            throw err;
        }
    }

    if (allResults.length > 0) {
        const normApp = appName.toLowerCase().trim();
        const normCand = matchedCandidate ? matchedCandidate.toLowerCase().trim() : normApp;

        let bestMatch = allResults[0];
        let bestScore = -1;

        for (const item of allResults) {
            const itemName = (item.game_name || '').toLowerCase().trim();
            if (itemName === normApp || itemName === normCand) {
                bestMatch = item;
                bestScore = 1.0;
                break;
            }
            const scoreCand = calcDistancePercentage(itemName, normCand);
            const scoreApp = calcDistancePercentage(itemName, normApp);
            const maxScore = Math.max(scoreCand, scoreApp);
            if (maxScore > bestScore) {
                bestScore = maxScore;
                bestMatch = item;
            }
        }

        console.log(`[HLTB] Best match for "${appName}" (candidate "${matchedCandidate}"): "${bestMatch.game_name}" (score: ${bestScore})`);

        return {
            hltbId: String(bestMatch.game_id),
            title: bestMatch.game_name,
            gameplayMain: Math.round((bestMatch.comp_main || 0) / 3600),
            gameplayMainExtra: Math.round((bestMatch.comp_plus || 0) / 3600),
            gameplayCompletionist: Math.round((bestMatch.comp_100 || 0) / 3600),
            releaseYear: bestMatch.release_world || null,
            imageUrl: bestMatch.game_image ? `https://howlongtobeat.com/games/${bestMatch.game_image}` : '',
            similarity: bestScore
        };
    }

    console.log(`[HLTB] No results found across all candidates for "${appName}"`);
    return null;
}

module.exports = { fetchHLTB };