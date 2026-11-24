const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));

// Concise request logger for API and HTML pages
app.use((req, res, next) => {
  if (req.url.startsWith('/api') || req.url === '/' || req.url.endsWith('.html')) {
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  }
  next();
});

// Environment detection (Electron / pkg / Node)
const isElectron = typeof process.versions.electron !== 'undefined';
let isElectronPackaged = false;
if (isElectron) {
  isElectronPackaged = require('electron').app.isPackaged;
}
const isPackaged = typeof process.pkg !== 'undefined';
const baseDir = (isPackaged || isElectronPackaged) ? path.dirname(process.execPath) : __dirname;
const CONFIG_PATH = path.join(baseDir, 'config.json');
const DB_PATH = path.join(baseDir, 'db.json');

// ============================================================================
// TITLE NORMALIZATION & SIMILARITY MATCHING
// ============================================================================

function cleanGameTitleForSearch(title) {
  if (!title) return '';
  let cleaned = String(title).toLowerCase().trim();

  // Strip non-ASCII only when mixed with ASCII (e.g. bilingual Steam titles)
  const hasAscii = /[a-z0-9]/.test(cleaned);
  const hasNonAscii = /[^\x00-\x7F]/.test(cleaned);
  if (hasAscii && hasNonAscii) {
    cleaned = cleaned.replace(/[^\x00-\x7F]/g, ' ');
  }

  // Strip parenthetical / bracketed suffixes BEFORE stripping punctuation
  cleaned = cleaned.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');

  // Replace trademark and punctuation symbols with space
  cleaned = cleaned.replace(/[™®©\-–—/\\_.,:!?'"~`@#$%^&*(){}\[\]<>+=|]/g, ' ');

  // Insert space between adjacent letters and digits (e.g. portal2 -> portal 2)
  cleaned = cleaned.replace(/([a-z])([0-9])/g, '$1 $2');
  cleaned = cleaned.replace(/([0-9])([a-z])/g, '$1 $2');

  return cleaned.replace(/\s+/g, ' ').trim();
}

const EDITION_SUFFIX_RE = /\b(Game of the Year(\s*Edition)?|GOTY(\s*Edition)?|Deluxe(\s*Edition)?|Definitive(\s*Edition)?|Remastered|Enhanced(\s*Edition)?|Special(\s*Edition)?|Collector'?s(\s*Edition)?|Director'?s\s*Cut|Anniversary(\s*Edition)?|Standard(\s*Edition)?|Complete(\s*Edition)?|Gold(\s*Edition)?|Ultimate(\s*Edition)?|Legendary(\s*Edition)?|Royal(\s*Edition)?|HD\s*Remaster|HD)\b/gi;

function generateSearchCandidates(rawTitle) {
  const candidates = new Set();
  const title = String(rawTitle || '').trim();
  if (!title) return [];

  const add = (str) => {
    const t = String(str || '').trim();
    if (t.length >= 2) candidates.add(t);
  };

  candidates.add(title);

  // 1. Remove parentheticals / brackets (e.g. "Persona 5 Royal (2022)")
  const noParens = title.replace(/\s*\([^)]*\)/g, '').replace(/\s*\[[^\]]*\]/g, '').trim();
  if (noParens && noParens !== title) add(noParens);

  const base = noParens || title;

  // 2. Strip edition / remaster suffixes
  const noEdition = base.replace(EDITION_SUFFIX_RE, '').replace(/[\s:\-–—]+$/, '').trim();
  if (noEdition && noEdition !== base) add(noEdition);

  // 3. Split by slash for bilingual/dual titles
  if (title.includes('/')) {
    for (const part of title.split('/')) add(part);
  }

  // 4. Split by colon (primary title)
  if (base.includes(':')) {
    add(base.split(':')[0]);
  }

  // 5. Split by spaced dash
  if (/\s[-–—]\s/.test(base)) {
    add(base.split(/\s[-–—]\s/)[0]);
  }

  // 6. Cleaned variants
  add(cleanGameTitleForSearch(base));
  if (noEdition && noEdition !== base) {
    add(cleanGameTitleForSearch(noEdition));
  }

  return Array.from(candidates);
}

function calcDistancePercentage(text, term) {
  let longer = String(text || '').toLowerCase().trim();
  let shorter = String(term || '').toLowerCase().trim();
  if (longer.length < shorter.length) {
    [longer, shorter] = [shorter, longer];
  }
  const longerLength = longer.length;
  if (longerLength === 0) return 1.0;

  const costs = new Array(shorter.length + 1);
  for (let i = 0; i <= longer.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= shorter.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (longer.charAt(i - 1) !== shorter.charAt(j - 1)) {
          newValue = Math.min(newValue, lastValue, costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[shorter.length] = lastValue;
  }

  const dist = costs[shorter.length];
  return Math.round(((longerLength - dist) / longerLength) * 100) / 100;
}

// ============================================================================
// PRELOADED OFFLINE HLTB DATASET
// ============================================================================

let preloadedHltbData = {};
let preloadedEntriesIndex = null; // Lazy array for fallback search

try {
  const preloadedPath = path.join(__dirname, 'static', 'js', 'preloaded_hltb.json');
  if (fs.existsSync(preloadedPath)) {
    preloadedHltbData = JSON.parse(fs.readFileSync(preloadedPath, 'utf8'));
    console.log(`[Startup] Loaded ${Object.keys(preloadedHltbData).length} preloaded offline HLTB profiles.`);
  }
} catch (err) {
  console.warn('[Startup] Warning: Could not load preloaded HLTB database:', err.message);
}

function lookupPreloadedHltb(title) {
  if (!title || !preloadedHltbData) return null;

  const candidates = generateSearchCandidates(title);
  for (const cand of candidates) {
    const clean = cleanGameTitleForSearch(cand);
    const entry = preloadedHltbData[clean] || preloadedHltbData[cand.toLowerCase()];
    if (entry) {
      return {
        hltbId: String(entry.hltbId || ''),
        title: entry.title || title,
        gameplayMain: entry.gameplayMain || 0,
        gameplayMainExtra: entry.gameplayMainExtra || 0,
        gameplayCompletionist: entry.gameplayCompletionist || 0,
        imageUrl: entry.imageUrl || '',
        developers: entry.developers || '',
        publishers: entry.publishers || '',
        genres: entry.genres || '',
        platforms: entry.platforms || '',
        releaseYear: entry.releaseYear || null,
        notFound: false,
        source: 'dataset'
      };
    }
  }
  return null;
}

function hasAnyPlaytime(hltb) {
  if (!hltb || hltb.notFound) return false;
  return (hltb.gameplayMain || 0) > 0 || (hltb.gameplayMainExtra || 0) > 0 || (hltb.gameplayCompletionist || 0) > 0;
}

function mergeDatasetMetadata(hltbEntry, gameName) {
  if (!hltbEntry || hltbEntry.notFound) return hltbEntry;
  if (hltbEntry.genres && hltbEntry.developers && hltbEntry.releaseYear) return hltbEntry;

  const preloaded = lookupPreloadedHltb(hltbEntry.title || gameName) || lookupPreloadedHltb(gameName);
  if (!preloaded) return hltbEntry;

  return {
    ...hltbEntry,
    genres: hltbEntry.genres || preloaded.genres || '',
    developers: hltbEntry.developers || preloaded.developers || '',
    publishers: hltbEntry.publishers || preloaded.publishers || '',
    platforms: hltbEntry.platforms || preloaded.platforms || '',
    releaseYear: hltbEntry.releaseYear || preloaded.releaseYear || null
  };
}

function searchPreloadedDataset(query, limit = 15) {
  const q = cleanGameTitleForSearch(query);
  if (!q) return [];
  if (!preloadedEntriesIndex) {
    preloadedEntriesIndex = Object.entries(preloadedHltbData);
  }

  const matches = [];
  for (const [key, entry] of preloadedEntriesIndex) {
    if (key.includes(q) || (entry.title && entry.title.toLowerCase().includes(query.toLowerCase()))) {
      const score = key === q ? 2 : (key.startsWith(q) ? 1.5 : calcDistancePercentage(key, q));
      matches.push({ entry, score });
      if (matches.length >= 200) break;
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, limit).map(({ entry }) => ({
    hltbId: String(entry.hltbId || ''),
    title: entry.title || '',
    gameplayMain: entry.gameplayMain || 0,
    gameplayMainExtra: entry.gameplayMainExtra || 0,
    gameplayCompletionist: entry.gameplayCompletionist || 0,
    releaseYear: entry.releaseYear || null,
    genres: entry.genres || '',
    developers: entry.developers || '',
    publishers: entry.publishers || '',
    platforms: entry.platforms || '',
    imageUrl: entry.imageUrl || '',
    source: 'dataset'
  }));
}

// ============================================================================
// RESILIENT HOWLONGTOBEAT CLIENT (Multi-endpoint + Single-flight Auth)
// ============================================================================

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HLTB_ENDPOINTS = [
  { search: 'https://howlongtobeat.com/api/search/site', init: 'https://howlongtobeat.com/api/search/site/init' },
  { search: 'https://howlongtobeat.com/api/bleed', init: 'https://howlongtobeat.com/api/bleed/init' },
  { search: 'https://howlongtobeat.com/api/find', init: 'https://howlongtobeat.com/api/find/init' }
];

let activeEndpointIdx = 0;
let hltbAuthCache = null;
let hltbAuthTime = 0;
let hltbAuthPromise = null;
const inFlightHltbRequests = new Map();

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getHltbAuth(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && hltbAuthCache && (now - hltbAuthTime < 10 * 60 * 1000)) {
    return hltbAuthCache;
  }
  if (hltbAuthPromise) {
    return hltbAuthPromise;
  }

  hltbAuthPromise = (async () => {
    // Try active endpoint first, then cycle through fallbacks
    const order = [
      activeEndpointIdx,
      ...HLTB_ENDPOINTS.map((_, idx) => idx).filter(idx => idx !== activeEndpointIdx)
    ];

    for (const idx of order) {
      const ep = HLTB_ENDPOINTS[idx];
      try {
        const res = await fetchWithTimeout(`${ep.init}?t=${Date.now()}`, {
          headers: {
            'User-Agent': USER_AGENT,
            'Referer': 'https://howlongtobeat.com/',
            'Origin': 'https://howlongtobeat.com',
            'Accept': 'application/json'
          }
        }, 8000);

        if (!res.ok) continue;
        const data = await res.json();
        if (data && data.token) {
          activeEndpointIdx = idx;
          hltbAuthCache = {
            token: data.token,
            hpKey: data.hpKey,
            hpVal: data.hpVal,
            endpoint: ep
          };
          hltbAuthTime = Date.now();
          console.log(`[HLTB] Security context initialized via ${ep.init}`);
          return hltbAuthCache;
        }
      } catch (err) {
        console.warn(`[HLTB] Init failed for ${ep.init}: ${err.message}`);
      }
    }

    hltbAuthCache = null;
    return null;
  })();

  try {
    return await hltbAuthPromise;
  } finally {
    hltbAuthPromise = null;
  }
}

async function queryHltbApi(term, size = 15) {
  const searchTerms = String(term || '').trim().split(/\s+/).filter(Boolean);
  if (searchTerms.length === 0) return [];

  const runWithAuth = async (auth) => {
    const payload = {
      searchType: 'games',
      searchTerms,
      searchPage: 1,
      size,
      searchOptions: {
        games: {
          userId: 0,
          platform: '',
          sortCategory: 'popular',
          rangeCategory: 'main',
          rangeTime: { min: 0, max: 0 },
          gameplay: { perspective: '', flow: '', genre: '', difficulty: '' },
          rangeYear: { min: '', max: '' },
          year: '',
          modifier: ''
        },
        users: { sortCategory: 'postcount' },
        lists: { sortCategory: 'follows' },
        filter: '',
        sort: 0,
        randomizer: 0
      },
      useCache: true
    };

    if (auth.hpKey) {
      payload[auth.hpKey] = auth.hpVal;
    }

    const headers = {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
      'Origin': 'https://howlongtobeat.com',
      'Referer': 'https://howlongtobeat.com/',
      'x-auth-token': auth.token
    };
    if (auth.hpKey) {
      headers['x-hp-key'] = auth.hpKey;
      headers['x-hp-val'] = auth.hpVal;
    }

    const response = await fetchWithTimeout(auth.endpoint.search, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    }, 10000);

    if (response.status === 403 || response.status === 404) {
      return { retry: true, status: response.status };
    }
    if (!response.ok) {
      throw new Error(`HLTB search failed (${response.status})`);
    }
    const json = await response.json();
    return { retry: false, data: json.data || [] };
  };

  let auth = await getHltbAuth(false);
  if (!auth) return [];

  let outcome = await runWithAuth(auth);
  if (outcome.retry) {
    console.warn(`[HLTB] Endpoint returned ${outcome.status}; refreshing auth & retrying...`);
    hltbAuthCache = null;
    if (outcome.status === 404) {
      activeEndpointIdx = (activeEndpointIdx + 1) % HLTB_ENDPOINTS.length;
    }
    auth = await getHltbAuth(true);
    if (!auth) return [];
    outcome = await runWithAuth(auth);
  }

  return outcome.data || [];
}

function formatLiveHltbMatch(match, queryTitle, similarity = null) {
  return {
    hltbId: String(match.game_id),
    title: match.game_name || queryTitle,
    gameplayMain: Math.round((match.comp_main || 0) / 3600),
    gameplayMainExtra: Math.round((match.comp_plus || 0) / 3600),
    gameplayCompletionist: Math.round((match.comp_100 || 0) / 3600),
    releaseYear: match.release_world || null,
    imageUrl: match.game_image ? `https://howlongtobeat.com/games/${match.game_image}` : '',
    similarity: similarity !== null ? similarity : calcDistancePercentage(match.game_name, queryTitle),
    notFound: false,
    source: 'live'
  };
}

async function scrapeBestHltbMatch(rawTitle) {
  const candidates = generateSearchCandidates(rawTitle);
  let results = [];
  let matchedCandidate = rawTitle;

  for (const cand of candidates) {
    try {
      const hits = await queryHltbApi(cand, 15);
      if (hits && hits.length > 0) {
        results = hits;
        matchedCandidate = cand;
        break;
      }
    } catch (err) {
      console.warn(`[HLTB] Candidate search failed for "${cand}": ${err.message}`);
    }
  }

  if (results.length === 0) return null;

  const normRaw = rawTitle.toLowerCase().trim();
  const normCand = matchedCandidate.toLowerCase().trim();
  const cleanRaw = cleanGameTitleForSearch(rawTitle);

  let bestMatch = results[0];
  let bestScore = -1;

  for (const item of results) {
    const itemName = String(item.game_name || '').toLowerCase().trim();
    const cleanItem = cleanGameTitleForSearch(item.game_name || '');
    const hasHours = (item.comp_main || 0) > 0 || (item.comp_plus || 0) > 0 || (item.comp_100 || 0) > 0;

    if (itemName === normRaw || itemName === normCand || (cleanItem && cleanItem === cleanRaw)) {
      bestMatch = item;
      bestScore = 1.0;
      if (hasHours) break;
    }

    const score = Math.max(
      calcDistancePercentage(itemName, normRaw),
      calcDistancePercentage(itemName, normCand),
      calcDistancePercentage(cleanItem, cleanRaw)
    ) + (hasHours ? 0.02 : 0);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = item;
    }
  }

  return formatLiveHltbMatch(bestMatch, rawTitle, Math.min(1, Math.round(bestScore * 100) / 100));
}

// ============================================================================
// CONFIGURATION & ATOMIC DATABASE PERSISTENCE
// ============================================================================

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { STEAM_API_KEY: '', STEAM_ID: '', FAMILY_STEAM_IDS: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return {
      STEAM_API_KEY: parsed.STEAM_API_KEY || '',
      STEAM_ID: parsed.STEAM_ID || '',
      FAMILY_STEAM_IDS: Array.isArray(parsed.FAMILY_STEAM_IDS) ? parsed.FAMILY_STEAM_IDS : []
    };
  } catch (err) {
    console.error('Error reading config.json:', err.message);
    return { STEAM_API_KEY: '', STEAM_ID: '', FAMILY_STEAM_IDS: [] };
  }
}

function isConfigValid(config) {
  return Boolean(
    config.STEAM_API_KEY &&
    config.STEAM_API_KEY !== 'YOUR_STEAM_API_KEY_HERE' &&
    config.STEAM_ID &&
    config.STEAM_ID !== 'YOUR_STEAM_ID_64_HERE'
  );
}

let dbInMemory = null;
let saveTimeout = null;
let dbDirty = false;
let isWritingDb = false;

function loadDb() {
  if (dbInMemory) return dbInMemory;
  if (!fs.existsSync(DB_PATH)) {
    dbInMemory = { games: [], hltb: {}, manualBeaten: [], manualUnbeaten: [], lastSync: 0 };
  } else {
    try {
      dbInMemory = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    } catch (err) {
      console.error('Error reading db.json, initializing clean database:', err.message);
      dbInMemory = { games: [], hltb: {}, manualBeaten: [], manualUnbeaten: [], lastSync: 0 };
    }
  }
  if (!dbInMemory.hltb || typeof dbInMemory.hltb !== 'object') dbInMemory.hltb = {};
  if (!Array.isArray(dbInMemory.games)) dbInMemory.games = [];
  if (!Array.isArray(dbInMemory.manualBeaten)) dbInMemory.manualBeaten = [];
  if (!Array.isArray(dbInMemory.manualUnbeaten)) dbInMemory.manualUnbeaten = [];
  if (typeof dbInMemory.lastSync !== 'number') dbInMemory.lastSync = 0;
  return dbInMemory;
}

async function writeDbAtomicAsync() {
  if (!dbInMemory || !dbDirty || isWritingDb) return;
  isWritingDb = true;
  dbDirty = false;
  const tmpPath = `${DB_PATH}.tmp`;
  try {
    const serialized = JSON.stringify(dbInMemory, null, 2);
    await fsp.writeFile(tmpPath, serialized, 'utf8');
    await fsp.rename(tmpPath, DB_PATH);
  } catch (err) {
    console.error('Error saving db.json:', err.message);
    dbDirty = true;
  } finally {
    isWritingDb = false;
    if (dbDirty) {
      saveDb(dbInMemory);
    }
  }
}

function saveDb(db) {
  dbInMemory = db;
  dbDirty = true;
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    writeDbAtomicAsync();
  }, 600);
}

const flushDbOnExit = () => {
  if (dbInMemory && dbDirty) {
    try {
      const tmpPath = `${DB_PATH}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(dbInMemory, null, 2), 'utf8');
      fs.renameSync(tmpPath, DB_PATH);
      dbDirty = false;
      console.log('Database flushed to disk.');
    } catch (err) {
      console.error('Error flushing db.json on exit:', err.message);
    }
  }
};

if (isElectron) {
  const { app: electronApp } = require('electron');
  electronApp.on('will-quit', flushDbOnExit);
}
process.on('SIGINT', () => { flushDbOnExit(); process.exit(0); });
process.on('SIGTERM', () => { flushDbOnExit(); process.exit(0); });

// ============================================================================
// STEAM WEB API HELPERS
// ============================================================================

let steamAppListCache = null;

async function fetchSteamAppList() {
  if (steamAppListCache) return steamAppListCache;
  try {
    console.log('Fetching global Steam app list for shared game name resolution...');
    const response = await fetchWithTimeout('https://api.steampowered.com/ISteamApps/GetAppList/v2/', {}, 15000);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const apps = data.applist?.apps || [];
    steamAppListCache = new Map();
    for (const item of apps) {
      steamAppListCache.set(item.appid, item.name);
    }
    console.log(`Indexed ${steamAppListCache.size} Steam apps.`);
    return steamAppListCache;
  } catch (err) {
    console.warn('Could not retrieve global Steam app list:', err.message);
    steamAppListCache = new Map();
    return steamAppListCache;
  }
}

async function resolveSteamId(apiKey, inputId) {
  if (!inputId) return '';
  const trimmed = String(inputId).trim();
  if (/^\d{17}$/.test(trimmed)) return trimmed;

  try {
    const url = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${encodeURIComponent(apiKey)}&vanityurl=${encodeURIComponent(trimmed)}`;
    const res = await fetchWithTimeout(url, {}, 10000);
    if (!res.ok) return trimmed;
    const data = await res.json();
    if (data.response?.success === 1 && data.response?.steamid) {
      return data.response.steamid;
    }
  } catch (err) {
    console.warn(`Error resolving vanity URL "${trimmed}":`, err.message);
  }
  return trimmed;
}

async function fetchOwnedGames(apiKey, steamId) {
  const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(apiKey)}&steamid=${encodeURIComponent(steamId)}&include_appinfo=true&include_played_free_games=true&format=json`;
  try {
    const res = await fetchWithTimeout(url, {}, 15000);
    if (!res.ok) {
      console.error(`Failed to fetch owned games for ${steamId} (HTTP ${res.status})`);
      return [];
    }
    const data = await res.json();
    return data.response?.games || [];
  } catch (err) {
    console.error(`Error fetching owned games for ${steamId}:`, err.message);
    return [];
  }
}

async function fetchFamilySharingGames(apiKey, steamId) {
  try {
    const groupUrl = `https://api.steampowered.com/IFamilyGroupsService/GetFamilyGroupForUser/v1/?key=${encodeURIComponent(apiKey)}&steamid=${encodeURIComponent(steamId)}`;
    const groupRes = await fetchWithTimeout(groupUrl, {}, 10000);
    if (!groupRes.ok) return { apps: [], members: [] };

    const groupData = await groupRes.json();
    const familyGroupId = groupData.response?.family_groupid;
    const members = groupData.response?.family_group?.members || [];
    if (!familyGroupId) return { apps: [], members };

    const appsUrl = `https://api.steampowered.com/IFamilyGroupsService/GetSharedLibraryApps/v1/?key=${encodeURIComponent(apiKey)}&family_groupid=${encodeURIComponent(familyGroupId)}&include_cooldown_games=true&include_free_games=true`;
    const appsRes = await fetchWithTimeout(appsUrl, {}, 10000);
    if (!appsRes.ok) return { apps: [], members };

    const appsData = await appsRes.json();
    return { apps: appsData.response?.apps || [], members };
  } catch (err) {
    console.warn('Family groups API unavailable:', err.message);
    return { apps: [], members: [] };
  }
}

function resolveHltbForGame(game, hltbMap) {
  const appidKey = `appid:${game.appid}`;
  const nameKey = game.name ? game.name.trim().toLowerCase() : '';

  // 1. Explicit per-appid override (from manual rematch/refresh)
  if (hltbMap[appidKey]) {
    return mergeDatasetMetadata(hltbMap[appidKey], game.name);
  }

  // 2. Cached entry by game name
  if (nameKey && hltbMap[nameKey]) {
    const cached = hltbMap[nameKey];
    if (!cached.notFound) {
      return mergeDatasetMetadata(cached, game.name);
    }
    return cached;
  }

  // 3. Offline preloaded dataset (instant, zero API calls)
  const preloaded = lookupPreloadedHltb(game.name);
  if (preloaded && hasAnyPlaytime(preloaded)) {
    return preloaded;
  }

  return null;
}

// ============================================================================
// API ROUTES
// ============================================================================

app.get('/api/games', (req, res) => {
  const db = loadDb();
  const config = loadConfig();
  const games = db.games || [];
  const hltbMap = db.hltb || {};

  const gamesWithHltb = games.map(game => ({
    ...game,
    hltb: resolveHltbForGame(game, hltbMap)
  }));

  res.json({
    games: gamesWithHltb,
    lastSync: db.lastSync || 0,
    manualBeaten: db.manualBeaten || [],
    manualUnbeaten: db.manualUnbeaten || [],
    configured: isConfigValid(config)
  });
});

app.post('/api/sync', async (req, res) => {
  const { force } = req.body || {};

  const config = loadConfig();
  if (!isConfigValid(config)) {
    return res.status(400).json({ error: 'Steam API Key and Steam ID must be configured in Settings.' });
  }

  const db = loadDb();
  if (force) {
    console.log('[Sync] Force Full Refresh requested. Clearing cached games & HLTB entries...');
    db.games = [];
    db.hltb = {};
    db.lastSync = 0;
  }

  const apiKey = config.STEAM_API_KEY;
  const familyConfigIds = config.FAMILY_STEAM_IDS || [];

  try {
    const primaryId = await resolveSteamId(apiKey, config.STEAM_ID);

    // Fetch primary library & Steam Families data in parallel
    const [primaryGames, familyData] = await Promise.all([
      fetchOwnedGames(apiKey, primaryId),
      fetchFamilySharingGames(apiKey, primaryId)
    ]);

    const gamesMap = new Map();
    for (const game of primaryGames) {
      gamesMap.set(game.appid, {
        appid: game.appid,
        name: game.name || `Steam App ${game.appid}`,
        playtime_forever: game.playtime_forever || 0,
        img_icon_url: game.img_icon_url || '',
        owner_steamid: primaryId,
        is_owned: true,
        source: 'primary'
      });
    }

    // Merge shared apps from IFamilyGroupsService
    if (familyData.apps && familyData.apps.length > 0) {
      const missingNameApps = familyData.apps.filter(a => !gamesMap.has(a.appid));
      const appList = missingNameApps.length > 0 ? await fetchSteamAppList() : new Map();

      for (const appInfo of familyData.apps) {
        const appid = appInfo.appid;
        const owners = appInfo.owner_steamids || [];
        const owner = owners[0] || 'family';

        if (gamesMap.has(appid)) {
          const existing = gamesMap.get(appid);
          if (owner !== primaryId) {
            existing.is_owned = false;
            existing.owner_steamid = owner;
            existing.source = 'family_api';
          }
        } else {
          gamesMap.set(appid, {
            appid,
            name: appList.get(Number(appid)) || `Unknown Game (${appid})`,
            playtime_forever: 0,
            img_icon_url: '',
            owner_steamid: owner,
            is_owned: false,
            source: 'family_api'
          });
        }
      }
    }

    // Resolve and fetch all configured + discovered family members in parallel
    const resolvedManualFamily = await Promise.all(
      familyConfigIds.map(id => resolveSteamId(apiKey, id))
    );
    const combinedFamilyIds = new Set(resolvedManualFamily.filter(id => id && id !== primaryId));

    if (familyData.members) {
      for (const member of familyData.members) {
        if (member.steamid && member.steamid !== primaryId) {
          combinedFamilyIds.add(member.steamid);
        }
      }
    }

    if (combinedFamilyIds.size > 0) {
      const memberIds = Array.from(combinedFamilyIds);
      const memberLibraries = await Promise.all(
        memberIds.map(async (memberId) => ({
          memberId,
          games: await fetchOwnedGames(apiKey, memberId)
        }))
      );

      for (const { memberId, games: memberGames } of memberLibraries) {
        for (const game of memberGames) {
          if (!gamesMap.has(game.appid)) {
            gamesMap.set(game.appid, {
              appid: game.appid,
              name: game.name || `Steam App ${game.appid}`,
              playtime_forever: 0,
              img_icon_url: game.img_icon_url || '',
              owner_steamid: memberId,
              is_owned: false,
              source: 'family_manual'
            });
          } else {
            // Upgrade placeholder name if family API missed it
            const existing = gamesMap.get(game.appid);
            if (existing.name.startsWith('Unknown Game (') && game.name) {
              existing.name = game.name;
              existing.img_icon_url = game.img_icon_url || existing.img_icon_url;
            }
          }
        }
      }
    }

    const allGames = Array.from(gamesMap.values());
    db.games = allGames;
    db.lastSync = Date.now();
    saveDb(db);

    const gamesWithHltb = allGames.map(game => ({
      ...game,
      hltb: resolveHltbForGame(game, db.hltb)
    }));

    console.log(`[Sync] Aggregated ${allGames.length} total games.`);
    res.json({
      games: gamesWithHltb,
      lastSync: db.lastSync,
      manualBeaten: db.manualBeaten || [],
      manualUnbeaten: db.manualUnbeaten || []
    });
  } catch (err) {
    console.error('[Sync] Error aggregating Steam games:', err);
    res.status(500).json({ error: 'Failed to retrieve Steam games. Check your API Key and profile privacy.' });
  }
});

// Single-game HLTB lookup (with offline dataset check, caching, and deduplication)
app.get('/api/hltb', async (req, res) => {
  const { title, appid, force } = req.query;
  if (!title) {
    return res.status(400).json({ error: 'title parameter is required.' });
  }

  const db = loadDb();
  const forceRefresh = force === '1' || force === 'true';
  const appidKey = appid ? `appid:${appid}` : null;
  const cacheKey = title.trim().toLowerCase();

  if (!forceRefresh) {
    if (appidKey && db.hltb[appidKey]) {
      return res.json(mergeDatasetMetadata(db.hltb[appidKey], title));
    }
    if (db.hltb[cacheKey] !== undefined) {
      return res.json(mergeDatasetMetadata(db.hltb[cacheKey], title));
    }
    const preloaded = lookupPreloadedHltb(title);
    if (preloaded && hasAnyPlaytime(preloaded)) {
      db.hltb[cacheKey] = preloaded;
      saveDb(db);
      return res.json(preloaded);
    }
  }

  // Deduplicate concurrent identical live requests
  const flightKey = `${cacheKey}:${forceRefresh ? '1' : '0'}`;
  if (inFlightHltbRequests.has(flightKey)) {
    try {
      const result = await inFlightHltbRequests.get(flightKey);
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  const lookupPromise = (async () => {
    const liveMatch = await scrapeBestHltbMatch(title);
    let hltbData;

    if (liveMatch) {
      hltbData = mergeDatasetMetadata(liveMatch, title);
      console.log(`[HLTB] Matched "${title}" -> "${hltbData.title}" (${hltbData.gameplayMain}h)`);
    } else {
      // Fallback to preloaded dataset even if 0h (preserves metadata)
      const preloaded = lookupPreloadedHltb(title);
      hltbData = preloaded || { title, notFound: true };
    }

    db.hltb[cacheKey] = hltbData;
    if (appidKey && forceRefresh) {
      db.hltb[appidKey] = hltbData;
    }
    saveDb(db);
    return hltbData;
  })();

  inFlightHltbRequests.set(flightKey, lookupPromise);
  try {
    const data = await lookupPromise;
    res.json(data);
  } catch (err) {
    console.error(`[HLTB] Error querying "${title}":`, err.message);
    res.status(500).json({ error: `HLTB lookup failed: ${err.message}` });
  } finally {
    inFlightHltbRequests.delete(flightKey);
  }
});

// Interactive HLTB search for manual rematching
app.get('/api/hltb/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ results: [] });

  try {
    const liveHits = await queryHltbApi(q, 15);
    if (liveHits && liveHits.length > 0) {
      const results = liveHits.map(item => mergeDatasetMetadata(formatLiveHltbMatch(item, q), item.game_name));
      return res.json({ results, source: 'live' });
    }
  } catch (err) {
    console.warn(`[HLTB Search] Live search failed for "${q}", using offline dataset:`, err.message);
  }

  // Fallback to local preloaded dataset search
  const offlineResults = searchPreloadedDataset(q, 15);
  res.json({ results: offlineResults, source: 'dataset' });
});

// Save a manual HLTB rematch for a specific game
app.post('/api/hltb/rematch', (req, res) => {
  const { appid, gameName, hltb } = req.body || {};
  if (!appid || !hltb) {
    return res.status(400).json({ error: 'appid and hltb payload are required.' });
  }

  const db = loadDb();
  const normalized = mergeDatasetMetadata({
    hltbId: String(hltb.hltbId || ''),
    title: hltb.title || gameName || '',
    gameplayMain: Number(hltb.gameplayMain) || 0,
    gameplayMainExtra: Number(hltb.gameplayMainExtra) || 0,
    gameplayCompletionist: Number(hltb.gameplayCompletionist) || 0,
    releaseYear: hltb.releaseYear || null,
    genres: hltb.genres || '',
    developers: hltb.developers || '',
    publishers: hltb.publishers || '',
    platforms: hltb.platforms || '',
    imageUrl: hltb.imageUrl || '',
    notFound: false,
    manualMatch: true,
    source: 'manual'
  }, gameName);

  db.hltb[`appid:${appid}`] = normalized;
  if (gameName) {
    db.hltb[gameName.trim().toLowerCase()] = normalized;
  }
  saveDb(db);

  res.json({ success: true, hltb: normalized });
});

// Toggle manual beat status override for a game
app.post('/api/games/:appid/beat', (req, res) => {
  const appid = Number(req.params.appid);
  const { state } = req.body || {}; // 'beaten' | 'unbeaten' | 'auto'
  if (!appid || !['beaten', 'unbeaten', 'auto'].includes(state)) {
    return res.status(400).json({ error: 'Valid appid and state (beaten | unbeaten | auto) are required.' });
  }

  const db = loadDb();
  const beatenSet = new Set(db.manualBeaten || []);
  const unbeatenSet = new Set(db.manualUnbeaten || []);

  beatenSet.delete(appid);
  unbeatenSet.delete(appid);

  if (state === 'beaten') beatenSet.add(appid);
  if (state === 'unbeaten') unbeatenSet.add(appid);

  db.manualBeaten = Array.from(beatenSet);
  db.manualUnbeaten = Array.from(unbeatenSet);
  saveDb(db);

  res.json({
    success: true,
    manualBeaten: db.manualBeaten,
    manualUnbeaten: db.manualUnbeaten
  });
});

// Read config (masked API key)
app.get('/api/config', (req, res) => {
  const config = loadConfig();
  const apiKey = config.STEAM_API_KEY || '';
  const maskedKey = apiKey.length > 8
    ? apiKey.slice(0, 4) + '•'.repeat(apiKey.length - 8) + apiKey.slice(-4)
    : apiKey ? '•'.repeat(apiKey.length) : '';

  res.json({
    STEAM_API_KEY_MASKED: maskedKey,
    STEAM_API_KEY_SET: apiKey.length > 0 && apiKey !== 'YOUR_STEAM_API_KEY_HERE',
    STEAM_ID: config.STEAM_ID || '',
    FAMILY_STEAM_IDS: config.FAMILY_STEAM_IDS || []
  });
});

// Update config
app.post('/api/config', (req, res) => {
  const { STEAM_API_KEY, STEAM_ID, FAMILY_STEAM_IDS } = req.body || {};
  const existing = loadConfig();

  if (STEAM_API_KEY && !String(STEAM_API_KEY).includes('•')) {
    existing.STEAM_API_KEY = String(STEAM_API_KEY).trim();
  }
  if (STEAM_ID !== undefined) {
    existing.STEAM_ID = String(STEAM_ID).trim();
  }
  if (Array.isArray(FAMILY_STEAM_IDS)) {
    existing.FAMILY_STEAM_IDS = FAMILY_STEAM_IDS.map(id => String(id).trim()).filter(Boolean);
  }

  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(existing, null, 2), 'utf8');
    console.log('[Config] Updated successfully.');
    res.json({ success: true, message: 'Configuration saved.' });
  } catch (err) {
    console.error('[Config] Write error:', err.message);
    res.status(500).json({ error: 'Failed to save configuration.' });
  }
});

// Static files & SPA fallback
app.use(express.static(path.join(__dirname, 'static')));
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'index.html'));
});

// ============================================================================
// SERVER STARTUP & ELECTRON LAUNCHER
// ============================================================================

function openBrowser(url) {
  if (process.env.NO_OPEN_BROWSER === '1') return;
  const cmd = process.platform === 'win32'
    ? `start "" "${url}"`
    : process.platform === 'darwin'
      ? `open "${url}"`
      : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) console.error(`Failed to open browser: ${err.message}`);
  });
}

function launchElectronWindow(url, serverInstance) {
  const { app: electronApp, BrowserWindow, shell } = require('electron');

  const createWin = () => {
    const win = new BrowserWindow({
      width: 1280,
      height: 840,
      minWidth: 900,
      minHeight: 620,
      title: 'SteamHLTB',
      icon: path.join(__dirname, 'static', 'img', 'SteamHLTB-dark-transparent.png'),
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    win.loadURL(url);
    win.webContents.setVisualZoomLevelLimits(1, 1);
    win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(1));

    win.webContents.setWindowOpenHandler(({ url: extUrl }) => {
      if (extUrl.startsWith('http://localhost') || extUrl.startsWith('http://127.0.0.1')) {
        return { action: 'allow' };
      }
      shell.openExternal(extUrl).catch(err => console.error(`External URL error: ${err.message}`));
      return { action: 'deny' };
    });
  };

  if (electronApp.isReady()) createWin();
  else electronApp.whenReady().then(createWin);

  if (serverInstance) {
    electronApp.on('window-all-closed', () => {
      serverInstance.close(() => electronApp.quit());
    });
  }
}

const listenPort = isElectron ? 0 : PORT;
const server = app.listen(listenPort, () => {
  const actualPort = server.address().port;
  const url = `http://localhost:${actualPort}`;
  console.log('==================================================');
  console.log(`SteamHLTB server running at ${url}`);
  console.log(`Config: ${CONFIG_PATH}`);
  console.log(`Database: ${DB_PATH}`);
  console.log('==================================================');

  if (isElectron) {
    launchElectronWindow(url, server);
  } else {
    openBrowser(url);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const url = `http://localhost:${PORT}`;
    console.log(`Port ${PORT} is already in use. Opening ${url}...`);
    if (isElectron) {
      launchElectronWindow(url, null);
    } else {
      openBrowser(url);
      setTimeout(() => process.exit(0), 800);
    }
  } else {
    console.error('Server error:', err);
  }
});
