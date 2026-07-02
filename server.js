const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable JSON middleware
app.use(express.json());

// Request logger middleware
app.use((req, res, next) => {
  // Only log API requests and primary page requests to keep terminal clean
  if (req.url.startsWith('/api') || req.url === '/' || req.url.endsWith('.html')) {
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  }
  next();
});

// Detect if running under Electron
const isElectron = typeof process.versions.electron !== 'undefined';
let isElectronPackaged = false;
if (isElectron) {
  isElectronPackaged = require('electron').app.isPackaged;
}

// Paths for configuration and caching
const isPackaged = typeof process.pkg !== 'undefined';
const baseDir = (isPackaged || isElectronPackaged) ? path.dirname(process.execPath) : __dirname;
const CONFIG_PATH = path.join(baseDir, 'config.json');
const DB_PATH = path.join(baseDir, 'db.json');

// --- Self-Contained HowLongToBeat Scraper Logic ---
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let hltbAuthCache = null;
let hltbAuthTime = 0;

// Fetch auth headers/honeypot dynamically from `/api/bleed/init`
async function getHltbAuth() {
  const now = Date.now();
  // Reuse credentials for up to 10 minutes (600,000 ms)
  if (hltbAuthCache && (now - hltbAuthTime < 600000)) {
    return hltbAuthCache;
  }
  
  try {
    console.log("Fetching HowLongToBeat security credentials...");
    const res = await fetch(`https://howlongtobeat.com/api/bleed/init?t=${now}`, {
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://howlongtobeat.com/',
        'Origin': 'https://howlongtobeat.com'
      }
    });
    if (!res.ok) throw new Error(`Init failed with status ${res.status}`);
    const data = await res.json();
    hltbAuthCache = {
      token: data.token,
      hpKey: data.hpKey,
      hpVal: data.hpVal
    };
    hltbAuthTime = now;
    return hltbAuthCache;
  } catch (err) {
    console.error("Failed to fetch HLTB auth credentials:", err.message);
    return null;
  }
}

// Scrape HowLongToBeat search API
async function scrapeHltb(gameName) {
  let auth = await getHltbAuth();
  if (!auth) return [];
  
  const executeSearch = async (currentAuth) => {
    const payload = {
      searchType: "games",
      searchTerms: gameName.trim().split(' '),
      searchPage: 1,
      size: 20,
      searchOptions: {
        games: {
          userId: 0,
          platform: "",
          sortCategory: "popular",
          rangeCategory: "main",
          rangeTime: { min: 0, max: 0 },
          gameplay: { perspective: "", flow: "", genre: "", difficulty: "" },
          rangeYear: { min: "", max: "" },
          modifier: ""
        },
        users: { sortCategory: "postcount" },
        lists: { sortCategory: "follows" },
        filter: "",
        sort: 0,
        randomizer: 0
      },
      useCache: true
    };
    
    if (currentAuth.hpKey) {
      payload[currentAuth.hpKey] = currentAuth.hpVal;
    }
    
    const response = await fetch("https://howlongtobeat.com/api/bleed", {
      method: "POST",
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
        'Origin': 'https://howlongtobeat.com',
        'Referer': 'https://howlongtobeat.com/',
        'x-auth-token': currentAuth.token,
        'x-hp-key': currentAuth.hpKey,
        'x-hp-val': currentAuth.hpVal
      },
      body: JSON.stringify(payload)
    });
    
    if (response.status === 403) {
      console.warn("HLTB token expired or rejected. Clearing cache...");
      hltbAuthCache = null;
      return null;
    }
    
    if (!response.ok) {
      throw new Error(`HLTB search POST request failed with status: ${response.status}`);
    }
    
    const data = await response.json();
    return data.data || [];
  };
  
  try {
    let results = await executeSearch(auth);
    if (results === null) {
      auth = await getHltbAuth();
      if (!auth) return [];
      results = await executeSearch(auth);
    }
    return results || [];
  } catch (err) {
    console.error(`Error querying HLTB for "${gameName}":`, err.message);
    return [];
  }
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

// Load configuration
function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return { STEAM_API_KEY: '', STEAM_ID: '', FAMILY_STEAM_IDS: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    console.error('Error reading config.json:', err);
    return { STEAM_API_KEY: '', STEAM_ID: '', FAMILY_STEAM_IDS: [] };
  }
}

let dbInMemory = null;
let saveTimeout = null;

// Load local database
function loadDb() {
  if (dbInMemory) return dbInMemory;
  if (!fs.existsSync(DB_PATH)) {
    dbInMemory = { games: [], hltb: {}, lastSync: 0 };
  } else {
    try {
      dbInMemory = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    } catch (err) {
      console.error('Error reading db.json, returning empty database:', err);
      dbInMemory = { games: [], hltb: {}, lastSync: 0 };
    }
  }
  if (!dbInMemory.hltb) dbInMemory.hltb = {};
  if (!dbInMemory.games) dbInMemory.games = [];
  return dbInMemory;
}

// Save local database (with 500ms debounce to prevent concurrent file write conflicts)
function saveDb(db) {
  dbInMemory = db;
  
  if (saveTimeout) clearTimeout(saveTimeout);
  
  saveTimeout = setTimeout(() => {
    try {
      fs.writeFileSync(DB_PATH, JSON.stringify(dbInMemory, null, 2), 'utf8');
    } catch (err) {
      console.error('Error writing db.json:', err);
    }
  }, 500);
}

// Flush any pending database changes to disk on process exit
const flushDbOnExit = () => {
  if (dbInMemory) {
    try {
      fs.writeFileSync(DB_PATH, JSON.stringify(dbInMemory, null, 2), 'utf8');
      console.log('Database successfully flushed to disk.');
    } catch (err) {
      console.error('Error flushing db.json on exit:', err);
    }
  }
};

if (isElectron) {
  const { app: electronApp } = require('electron');
  electronApp.on('will-quit', () => {
    flushDbOnExit();
  });
}

process.on('SIGINT', () => {
  flushDbOnExit();
  process.exit(0);
});

process.on('SIGTERM', () => {
  flushDbOnExit();
  process.exit(0);
});


// In-memory global Steam app list cache (to map appid -> name for shared apps)
let steamAppListCache = null;
async function fetchSteamAppList() {
  if (steamAppListCache) return steamAppListCache;
  try {
    console.log('Fetching global Steam app list to resolve shared game names...');
    const response = await fetch('https://api.steampowered.com/ISteamApps/GetAppList/v2/');
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    const apps = data.applist.apps;
    steamAppListCache = new Map();
    for (const app of apps) {
      steamAppListCache.set(app.appid, app.name);
    }
    console.log(`Successfully indexed ${steamAppListCache.size} Steam apps.`);
    return steamAppListCache;
  } catch (err) {
    console.error('Failed to retrieve Steam app list:', err);
    return new Map();
  }
}

// Helper to look up a game name by appid
async function getGameName(appid) {
  const list = await fetchSteamAppList();
  return list.get(Number(appid)) || `Unknown Game (${appid})`;
}

// Helper to resolve a Steam vanity URL (e.g., custom URL/username) to a 17-digit SteamID64
async function resolveSteamId(apiKey, inputId) {
  if (!inputId) return '';
  const trimmed = String(inputId).trim();
  // If it's already a 17-digit numeric SteamID64, return it
  if (/^\d{17}$/.test(trimmed)) {
    return trimmed;
  }
  
  console.log(`SteamID "${trimmed}" is not a 17-digit number. Attempting to resolve via ResolveVanityURL...`);
  try {
    const url = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${apiKey}&vanityurl=${trimmed}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`ResolveVanityURL failed for "${trimmed}", status: ${res.status}`);
      return trimmed;
    }
    const data = await res.json();
    if (data.response?.success === 1 && data.response?.steamid) {
      console.log(`Successfully resolved vanity URL "${trimmed}" to SteamID64: ${data.response.steamid}`);
      return data.response.steamid;
    } else {
      console.warn(`Could not resolve vanity URL "${trimmed}" (success code: ${data.response?.success || 'none'}). Using as-is.`);
    }
  } catch (err) {
    console.error(`Error in ResolveVanityURL for "${trimmed}":`, err);
  }
  return trimmed;
}

// Fetch owned games for a Steam ID
async function fetchOwnedGames(apiKey, steamId) {
  const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${steamId}&include_appinfo=true&include_played_free_games=true&format=json`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`Failed to fetch owned games for ${steamId}, status: ${res.status}`);
      return [];
    }
    const data = await res.json();
    return data.response?.games || [];
  } catch (err) {
    console.error(`Error fetching owned games for ${steamId}:`, err);
    return [];
  }
}

// Fetch family sharing games via IFamilyGroupsService
async function fetchFamilySharingGames(apiKey, steamId) {
  try {
    // 1. Get family group for user
    const groupUrl = `https://api.steampowered.com/IFamilyGroupsService/GetFamilyGroupForUser/v1/?key=${apiKey}&steamid=${steamId}`;
    const groupRes = await fetch(groupUrl);
    if (!groupRes.ok) {
      console.warn(`IFamilyGroupsService/GetFamilyGroupForUser not available or rejected. Status: ${groupRes.status}`);
      return { apps: [], members: [] };
    }
    
    const groupData = await groupRes.json();
    const familyGroupId = groupData.response?.family_groupid;
    const members = groupData.response?.family_group?.members || [];
    
    if (!familyGroupId) {
      console.log('No family group ID returned for user.');
      return { apps: [], members };
    }
    
    console.log(`Found Family Group: ${familyGroupId}. Fetching shared library apps...`);
    
    // 2. Get shared apps in the family group
    const appsUrl = `https://api.steampowered.com/IFamilyGroupsService/GetSharedLibraryApps/v1/?key=${apiKey}&family_groupid=${familyGroupId}&include_cooldown_games=true&include_free_games=true`;
    const appsRes = await fetch(appsUrl);
    if (!appsRes.ok) {
      console.warn(`IFamilyGroupsService/GetSharedLibraryApps failed. Status: ${appsRes.status}`);
      return { apps: [], members };
    }
    
    const appsData = await appsRes.json();
    const apps = appsData.response?.apps || [];
    return { apps, members };
  } catch (err) {
    console.warn('Error fetching family sharing games via Steam API:', err.message);
    return { apps: [], members: [] };
  }
}

// API endpoint to fetch the cached aggregated library from local db
app.get('/api/games', (req, res) => {
  const db = loadDb();
  const games = db.games || [];
  const hltb = db.hltb || {};
  
  const gamesWithHltb = games.map(game => {
    const cacheKey = game.name ? game.name.trim().toLowerCase() : '';
    return {
      ...game,
      hltb: hltb[cacheKey] || null
    };
  });
  
  res.json({
    games: gamesWithHltb,
    lastSync: db.lastSync || 0
  });
});

// API endpoint to perform a sync with Steam APIs and update the local db
app.post('/api/sync', async (req, res) => {
  const config = loadConfig();
  const apiKey = config.STEAM_API_KEY;
  let primaryId = config.STEAM_ID;
  const familyConfigIds = config.FAMILY_STEAM_IDS || [];

  if (!apiKey || apiKey === 'YOUR_STEAM_API_KEY_HERE') {
    return res.status(400).json({ error: 'Steam API key is not configured in config.json.' });
  }
  if (!primaryId || primaryId === 'YOUR_STEAM_ID_64_HERE') {
    return res.status(400).json({ error: 'Primary Steam ID is not configured in config.json.' });
  }

  try {
    // Resolve primary Steam ID if it's a vanity URL
    primaryId = await resolveSteamId(apiKey, primaryId);

    console.log(`Fetching games for primary user ${primaryId}...`);
    // Fetch primary user games
    const primaryGames = await fetchOwnedGames(apiKey, primaryId);
    
    // Create a map to deduplicate and aggregate all games
    // Key: appid
    const gamesMap = new Map();
    
    for (const game of primaryGames) {
      gamesMap.set(game.appid, {
        appid: game.appid,
        name: game.name,
        playtime_forever: game.playtime_forever || 0,
        img_icon_url: game.img_icon_url || '',
        owner_steamid: primaryId,
        is_owned: true,
        source: 'primary'
      });
    }

    // Try to fetch games using the Steam Families API
    console.log('Attempting to fetch family sharing games via IFamilyGroupsService...');
    const familyData = await fetchFamilySharingGames(apiKey, primaryId);
    
    // Merge shared apps from Steam Families API
    if (familyData.apps && familyData.apps.length > 0) {
      console.log(`Processing ${familyData.apps.length} family sharing apps...`);
      for (const appInfo of familyData.apps) {
        const appid = appInfo.appid;
        const owners = appInfo.owner_steamids || [];
        const owner = owners[0] || 'family';

        if (gamesMap.has(appid)) {
          // User already has this game in their list (probably played it)
          const existing = gamesMap.get(appid);
          // If the owner is not the primary user, it's shared
          if (owner !== primaryId) {
            existing.is_owned = false;
            existing.owner_steamid = owner;
            existing.source = 'family_api';
          }
        } else {
          // Retrieve game name from the global list
          const gameName = await getGameName(appid);
          gamesMap.set(appid, {
            appid: appid,
            name: gameName,
            playtime_forever: 0,
            img_icon_url: '',
            owner_steamid: owner,
            is_owned: false,
            source: 'family_api'
          });
        }
      }
    }

    // Also fetch games from manual family config IDs (in case API key has no access to IFamilyGroupsService)
    const combinedFamilyIds = new Set();
    for (const id of familyConfigIds) {
      const resolvedId = await resolveSteamId(apiKey, id);
      if (resolvedId && resolvedId !== primaryId) {
        combinedFamilyIds.add(resolvedId);
      }
    }
    // Extract any members from the family API response who aren't the primary user
    if (familyData.members) {
      familyData.members.forEach(member => {
        if (member.steamid && member.steamid !== primaryId) {
          combinedFamilyIds.add(member.steamid);
        }
      });
    }

    if (combinedFamilyIds.size > 0) {
      console.log(`Fetching games for configured/discovered family members: ${Array.from(combinedFamilyIds).join(', ')}`);
      for (const memberId of combinedFamilyIds) {
        const memberGames = await fetchOwnedGames(apiKey, memberId);
        console.log(`Fetched ${memberGames.length} games for member ${memberId}`);
        for (const game of memberGames) {
          const appid = game.appid;
          if (!gamesMap.has(appid)) {
            gamesMap.set(appid, {
              appid: game.appid,
              name: game.name,
              playtime_forever: 0, // Since it's owned by family, primary user playtime is 0 unless they played it too (handled above)
              img_icon_url: game.img_icon_url || '',
              owner_steamid: memberId,
              is_owned: false,
              source: 'family_manual'
            });
          }
        }
      }
    }

    const allGames = Array.from(gamesMap.values());
    console.log(`Total combined games list has ${allGames.length} titles.`);
    
    // Save to local unified db
    const db = loadDb();
    db.games = allGames;
    db.lastSync = Date.now();
    saveDb(db);

    res.json({
      games: allGames,
      lastSync: db.lastSync
    });
  } catch (err) {
    console.error('Error fetching aggregated games list:', err);
    res.status(500).json({ error: 'Failed to retrieve Steam games.' });
  }
});

// API endpoint to query HLTB data for a specific game
app.get('/api/hltb', async (req, res) => {
  const { title } = req.query;
  if (!title) {
    return res.status(400).json({ error: 'title parameter is required.' });
  }

  const db = loadDb();
  if (!db.hltb) db.hltb = {};
  
  // Clean title for keys
  const cacheKey = title.trim().toLowerCase();

  // Check cache
  if (db.hltb[cacheKey] !== undefined) {
    return res.json(db.hltb[cacheKey]);
  }

  try {
    console.log(`Searching HowLongToBeat for: "${title}"...`);
    const results = await scrapeHltb(title);
    
    let hltbData = null;
    
    if (results && results.length > 0) {
      // Find the best match
      // If there is an exact name match, use it. Otherwise, use the first result.
      const exactMatch = results.find(r => r.game_name?.toLowerCase() === cacheKey);
      const match = exactMatch || results[0];
      
      hltbData = {
        hltbId: String(match.game_id),
        title: match.game_name,
        gameplayMain: Math.round((match.comp_main || 0) / 3600),
        gameplayMainExtra: Math.round((match.comp_plus || 0) / 3600),
        gameplayCompletionist: Math.round((match.comp_100 || 0) / 3600),
        imageUrl: match.game_image ? `https://howlongtobeat.com/games/${match.game_image}` : '',
        similarity: calcDistancePercentage(match.game_name, title),
        notFound: false
      };
      console.log(`Found HLTB match: "${match.game_name}" (Main Story: ${hltbData.gameplayMain}h)`);
    } else {
      hltbData = {
        title: title,
        notFound: true
      };
      console.log(`No HLTB results found for: "${title}"`);
    }

    // Save to database cache
    db.hltb[cacheKey] = hltbData;
    saveDb(db);

    res.json(hltbData);
  } catch (err) {
    console.error(`Error querying HLTB for "${title}":`, err.message);
    res.status(500).json({ error: `HLTB lookup failed: ${err.message}` });
  }
});

// API endpoint to read current config (with masked API key for security)
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

// API endpoint to update config
app.post('/api/config', (req, res) => {
  const { STEAM_API_KEY, STEAM_ID, FAMILY_STEAM_IDS } = req.body;
  
  // Load existing config to preserve fields not being updated
  const existing = loadConfig();
  
  // Only overwrite API key if a new one was provided (not the masked placeholder)
  if (STEAM_API_KEY && !STEAM_API_KEY.includes('•')) {
    existing.STEAM_API_KEY = STEAM_API_KEY.trim();
  }
  
  if (STEAM_ID !== undefined) {
    existing.STEAM_ID = String(STEAM_ID).trim();
  }
  
  if (Array.isArray(FAMILY_STEAM_IDS)) {
    existing.FAMILY_STEAM_IDS = FAMILY_STEAM_IDS.map(id => String(id).trim()).filter(Boolean);
  }
  
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(existing, null, 2), 'utf8');
    console.log('Configuration updated successfully.');
    res.json({ success: true, message: 'Configuration saved.' });
  } catch (err) {
    console.error('Error writing config.json:', err);
    res.status(500).json({ error: 'Failed to save configuration.' });
  }
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'static')));

// Fallback for SPA or simple index
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'html', 'index.html'));
});

function openBrowser(url) {
  const startCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : `${startCmd} "${url}"`;
  exec(cmd, (err) => {
    if (err) {
      console.error(`Failed to open browser: ${err.message}`);
    }
  });
}

// Start Server
const listenPort = isElectron ? 0 : PORT;

const server = app.listen(listenPort, () => {
  const actualPort = server.address().port;
  const url = `http://localhost:${actualPort}`;
  console.log(`==================================================`);
  console.log(`Steam HLTB App server running at ${url}`);
  console.log(`Centralized configuration: ${CONFIG_PATH}`);
  console.log(`Local unified database: ${DB_PATH}`);
  console.log(`==================================================`);
  
  if (isElectron) {
    const { app: electronApp, BrowserWindow, shell } = require('electron');
    
    const loadWindow = () => {
      const win = new BrowserWindow({
        width: 1200,
        height: 800,
        title: "SteamHLTB",
        icon: path.join(__dirname, 'static', 'img', 'SteamHLTB-dark-transparent.png'),
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });
      
      win.loadURL(url);
      
      // Disable visual zoom limits (pinch zoom)
      win.webContents.setVisualZoomLevelLimits(1, 1);
      
      // Reset zoom factor to 1 on load
      win.webContents.on('did-finish-load', () => {
        win.webContents.setZoomFactor(1);
      });
      
      // Open external links in default browser instead of the Electron window
      win.webContents.setWindowOpenHandler(({ url: extUrl }) => {
        if (extUrl.startsWith('http://localhost') || extUrl.startsWith('http://127.0.0.1')) {
          return { action: 'allow' };
        }
        shell.openExternal(extUrl).catch(err => {
          console.error(`Failed to open external URL: ${err.message}`);
        });
        return { action: 'deny' };
      });
    };

    if (electronApp.isReady()) {
      loadWindow();
    } else {
      electronApp.whenReady().then(loadWindow);
    }
    
    electronApp.on('window-all-closed', () => {
      server.close(() => {
        electronApp.quit();
      });
    });
  } else {
    openBrowser(url);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} is already in use. Loading Electron/Browser window...`);
    if (isElectron) {
      const { app: electronApp, BrowserWindow, shell } = require('electron');
      const loadWindow = () => {
        const win = new BrowserWindow({
          width: 1200,
          height: 800,
          title: "SteamHLTB",
          icon: path.join(__dirname, 'static', 'img', 'SteamHLTB-dark-transparent.png'),
          autoHideMenuBar: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
          }
        });
        win.loadURL(`http://localhost:${PORT}`);
        
        // Disable visual zoom limits (pinch zoom)
        win.webContents.setVisualZoomLevelLimits(1, 1);
        
        // Reset zoom factor to 1 on load
        win.webContents.on('did-finish-load', () => {
          win.webContents.setZoomFactor(1);
        });
        
        win.webContents.setWindowOpenHandler(({ url: extUrl }) => {
          if (extUrl.startsWith('http://localhost') || extUrl.startsWith('http://127.0.0.1')) {
            return { action: 'allow' };
          }
          shell.openExternal(extUrl).catch(err => {
            console.error(`Failed to open external URL: ${err.message}`);
          });
          return { action: 'deny' };
        });
      };
      
      if (electronApp.isReady()) {
        loadWindow();
      } else {
        electronApp.whenReady().then(loadWindow);
      }
    } else {
      openBrowser(`http://localhost:${PORT}`);
      setTimeout(() => {
        process.exit(0);
      }, 1000);
    }
  } else {
    console.error('Server error:', err);
  }
});
