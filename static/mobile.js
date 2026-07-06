// State Management
let games = [];
let filteredGames = [];
let currentFilter = 'all';
let currentSort = 'playtime_desc';
let hltbSyncQueue = [];
let activeSyncWorkers = 0;
const MAX_CONCURRENT_SYNC = 4;
let visibleCardCount = 40;
const BATCH_SIZE = 40;
let manuallyCompleted = new Set(); // appids the user has manually marked as beaten
let manuallyUnbeaten = new Set(); // appids the user has manually marked as NOT beaten
let rematchActiveAppid = null; // appid currently being manually matched
let preloadedHltbData = {}; // Enriched preloaded HLTB metadata cache

// Unified Filter States
let filterMinHours = null;
let filterMaxHours = null;
let currentGenre = 'all';
let currentDeveloper = 'all';
let currentPlatform = 'all';

const isMobileApp = typeof window !== 'undefined' && window.Capacitor !== undefined && window.Capacitor.Plugins !== undefined && window.Capacitor.Plugins.Preferences !== undefined;

// DOM Elements
const statBacklogCount = document.getElementById('stat-backlog-count');
const statBacklogHours = document.getElementById('stat-backlog-hours');
const statCompletedCount = document.getElementById('stat-completed-count');
const statCompletedHours = document.getElementById('stat-completed-hours');
const statNextUpName = document.getElementById('stat-next-up-name');
const statNextUpTime = document.getElementById('stat-next-up-time');
const mobileSearchInput = document.getElementById('mobile-search-input');
const filterChips = document.querySelectorAll('.filter-chip');
const progressGamesSection = document.getElementById('progress-games-section');
const progressGamesGrid = document.getElementById('progress-games-grid');
const mobileGamesGrid = document.getElementById('mobile-games-grid');
const mobileSetupView = document.getElementById('mobile-setup-view');
const mobileEmptyView = document.getElementById('mobile-empty-view');
const mobileNoMatchesView = document.getElementById('mobile-no-matches-view');
const allGamesHeader = document.getElementById('all-games-header');

// Floating sync toast & progress elements
const mobileSyncToast = document.getElementById('mobile-sync-toast');
const mobileSyncHudPctToast = document.getElementById('mobile-sync-hud-pct-toast');
const mobileSyncToastMinimize = document.getElementById('mobile-sync-toast-minimize');

const mobileFirstSyncOverlay = document.getElementById('mobile-first-sync-overlay');
const firstSyncProgressBar = document.getElementById('first-sync-progress-bar');
const firstSyncStatusText = document.getElementById('first-sync-status-text');
const firstSyncPctText = document.getElementById('first-sync-pct-text');
const firstSyncBackgroundBtn = document.getElementById('first-sync-background-btn');

// Rematch Overlay elements
const mobileRematchOverlay = document.getElementById('mobile-rematch-overlay');
const closeRematchSheetBtn = document.getElementById('close-rematch-sheet-btn');
const rematchSearchInput = document.getElementById('rematch-search-input');
const rematchSearchBtn = document.getElementById('rematch-search-btn');
const rematchResultsList = document.getElementById('rematch-results-list');
const detailsRematchBtn = document.getElementById('details-rematch-btn');
const detailsRefreshBtn = document.getElementById('details-refresh-btn');

// Unified Filter elements
const mobileFilterSheetOverlay = document.getElementById('mobile-filter-sheet-overlay');
const closeFilterSheetBtn = document.getElementById('close-filter-sheet-btn');
const mobileFilterHudTrigger = document.getElementById('mobile-filter-hud-trigger');
const filterSheetSort = document.getElementById('filter-sheet-sort');
const filterSheetMinHours = document.getElementById('filter-sheet-min-hours');
const filterSheetMaxHours = document.getElementById('filter-sheet-max-hours');
const filterSheetGenre = document.getElementById('filter-sheet-genre');
const filterSheetDeveloper = document.getElementById('filter-sheet-developer');
const filterSheetPlatform = document.getElementById('filter-sheet-platform');
const filterSheetClearBtn = document.getElementById('filter-sheet-clear-btn');
const filterSheetApplyBtn = document.getElementById('filter-sheet-apply-btn');

// Modals
const mobileSettingsOverlay = document.getElementById('mobile-settings-overlay');
const mobileDetailsOverlay = document.getElementById('mobile-details-overlay');
const mobileSyncModal = document.getElementById('mobile-sync-modal');
const mobileDiceModal = document.getElementById('mobile-dice-modal');

// Forms & Inputs
const mobileSettingsForm = document.getElementById('mobile-settings-form');
const settingsApiKey = document.getElementById('mobile-settings-api-key');
const settingsSteamId = document.getElementById('mobile-settings-steam-id');
const settingsFamilyIds = document.getElementById('mobile-settings-family-ids');

// ============================================================================
// PREFERENCES STORAGE HELPERS
// ============================================================================

async function getMobileConfig() {
  if (!isMobileApp) return null;
  const { Preferences } = window.Capacitor.Plugins;
  try {
    const { value } = await Preferences.get({ key: 'config' });
    return value ? JSON.parse(value) : null;
  } catch (err) {
    console.error('Error reading mobile config:', err);
    return null;
  }
}

async function saveMobileConfig(config) {
  if (!isMobileApp) return;
  const { Preferences } = window.Capacitor.Plugins;
  await Preferences.set({ key: 'config', value: JSON.stringify(config) });
}

async function getMobileLibrary() {
  if (!isMobileApp) return { games: [], lastSync: 0 };
  const { Preferences } = window.Capacitor.Plugins;
  try {
    const { value } = await Preferences.get({ key: 'library' });
    return value ? JSON.parse(value) : { games: [], lastSync: 0 };
  } catch (err) {
    console.error('Error reading mobile library:', err);
    return { games: [], lastSync: 0 };
  }
}

async function saveMobileLibrary(libraryData) {
  if (!isMobileApp) return;
  const { Preferences } = window.Capacitor.Plugins;
  await Preferences.set({ key: 'library', value: JSON.stringify(libraryData) });
}

async function loadManualBeatenSets() {
  if (!isMobileApp) return;
  const { Preferences } = window.Capacitor.Plugins;
  try {
    const resComp = await Preferences.get({ key: 'manuallyCompleted' });
    if (resComp.value) {
      manuallyCompleted = new Set(JSON.parse(resComp.value));
    }
    const resUncomp = await Preferences.get({ key: 'manuallyUnbeaten' });
    if (resUncomp.value) {
      manuallyUnbeaten = new Set(JSON.parse(resUncomp.value));
    }
  } catch (err) {
    console.error('Error reading manual beaten/unbeaten sets:', err);
  }
}

async function saveManualBeatenSets() {
  if (!isMobileApp) return;
  const { Preferences } = window.Capacitor.Plugins;
  try {
    await Preferences.set({ key: 'manuallyCompleted', value: JSON.stringify([...manuallyCompleted]) });
    await Preferences.set({ key: 'manuallyUnbeaten', value: JSON.stringify([...manuallyUnbeaten]) });
  } catch (err) {
    console.error('Error saving manual beaten/unbeaten sets:', err);
  }
}

async function loadPreloadedHltb() {
  try {
    const res = await fetch('js/preloaded_hltb.json');
    if (res.ok) {
      preloadedHltbData = await res.json();
    }
  } catch (err) {
    console.warn('Could not load preloaded HLTB dataset:', err);
  }
}

// ============================================================================
// GAME BEAT STATUS HELPER
// ============================================================================

function isGameBeaten(game) {
  if (manuallyUnbeaten.has(game.appid)) return false;
  if (manuallyCompleted.has(game.appid)) return true;
  if (!game.hltb || game.hltb.notFound) return false;
  const playHours = (game.playtime_forever || 0) / 60;
  const beatHours = game.hltb.gameplayMain || 0;
  return beatHours > 0 && playHours >= beatHours;
}

// ============================================================================
// TITLE CLEANING
// ============================================================================

function cleanGameTitleForSearch(title) {
  if (!title) return '';
  let cleaned = title.toLowerCase().trim();
  const hasAscii = /[a-z0-9]/.test(cleaned);
  const hasNonAscii = /[^\x00-\x7F]/.test(cleaned);
  if (hasAscii && hasNonAscii) {
    cleaned = cleaned.replace(/[^\x00-\x7F]/g, ' ');
  }
  cleaned = cleaned.replace(/[™®©\-–—/\\_.,]/g, ' ');
  cleaned = cleaned.replace(/\([^)]*\)/g, '');
  if (cleaned.includes(':')) {
    cleaned = cleaned.split(':')[0];
  }
  cleaned = cleaned.replace(/([a-z])([0-9])/g, '$1 $2');
  cleaned = cleaned.replace(/([0-9])([a-z])/g, '$1 $2');
  cleaned = cleaned.replace(/\s+/g, ' ');
  return cleaned.trim();
}

function extractYear(releaseStr) {
  if (!releaseStr) return null;
  const parts = releaseStr.split('-');
  const lastPart = parts[parts.length - 1].trim();
  if (lastPart.length === 4 && !isNaN(lastPart)) {
    return parseInt(lastPart);
  }
  if (lastPart.length === 2 && !isNaN(lastPart)) {
    const val = parseInt(lastPart);
    return val >= 50 ? 1900 + val : 2000 + val;
  }
  const match = releaseStr.match(/\b(19\d\d|20\d\d)\b/);
  if (match) {
    return parseInt(match[1]);
  }
  return null;
}

// ============================================================================
// STEAM STORE DETAILS METADATA ON-DEMAND FETCH
// ============================================================================

async function fetchSteamStoreMetadata(appid) {
  if (!isMobileApp) return null;
  const { CapacitorHttp } = window.Capacitor.Plugins;
  try {
    // Force English language response with l=english parameter
    const response = await CapacitorHttp.get({
      url: `https://store.steampowered.com/api/appdetails?appids=${appid}&l=english`
    });
    if (response.status === 200 && response.data && response.data[appid] && response.data[appid].success) {
      const data = response.data[appid].data;
      return {
        developers: (data.developers || []).join(', '),
        publishers: (data.publishers || []).join(', '),
        genres: (data.genres || []).map(g => g.description).join(', '),
        platforms: Object.keys(data.platforms || {}).filter(k => data.platforms[k]).map(k => k.toUpperCase()).join(', '),
        releaseYear: data.release_date ? extractYear(data.release_date.date) : null
      };
    }
  } catch (err) {
    console.warn('Failed to fetch Steam Store details on-demand:', err);
  }
  return null;
}

// ============================================================================
// HLTB MOBILE SCRAPER
// ============================================================================

async function scrapeHltbMobile(gameName) {
  if (!isMobileApp) return null;
  const { CapacitorHttp } = window.Capacitor.Plugins;
  const now = Date.now();
  const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  
  try {
    const initRes = await CapacitorHttp.get({
      url: `https://howlongtobeat.com/api/bleed/init?t=${now}`,
      headers: { 'User-Agent': USER_AGENT, 'Referer': 'https://howlongtobeat.com/', 'Origin': 'https://howlongtobeat.com' }
    });
    if (initRes.status !== 200 || !initRes.data) return null;
    
    const auth = initRes.data;
    const payload = {
      searchType: "games",
      searchTerms: gameName.trim().split(' '),
      searchPage: 1,
      size: 20,
      searchOptions: {
        games: { userId: 0, platform: "", sortCategory: "popular", rangeCategory: "main", rangeTime: { min: 0, max: 0 }, gameplay: { perspective: "", flow: "", genre: "", difficulty: "" }, rangeYear: { min: "", max: "" }, modifier: "" },
        users: { sortCategory: "postcount" },
        lists: { sortCategory: "follows" },
        filter: "", sort: 0, randomizer: 0
      },
      useCache: true
    };
    if (auth.hpKey) payload[auth.hpKey] = auth.hpVal;
    
    const queryRes = await CapacitorHttp.post({
      url: "https://howlongtobeat.com/api/bleed",
      headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/json', 'Origin': 'https://howlongtobeat.com', 'Referer': 'https://howlongtobeat.com/', 'x-auth-token': auth.token, 'x-hp-key': auth.hpKey, 'x-hp-val': auth.hpVal },
      data: payload
    });
    
    if (queryRes.status !== 200 || !queryRes.data) return null;
    return queryRes.data.data || [];
  } catch (err) {
    console.error('Mobile HLTB query error:', err);
    return null;
  }
}

// ============================================================================
// STEAM LIBRARY SYNC
// ============================================================================

async function performMobileSync(force, onProgressCallback) {
  if (!isMobileApp) return null;
  const { CapacitorHttp } = window.Capacitor.Plugins;
  
  const config = await getMobileConfig();
  if (!config || !config.STEAM_API_KEY || !config.STEAM_ID) {
    throw new Error('Steam credentials are not configured.');
  }
  
  const apiKey = config.STEAM_API_KEY;
  let primaryId = config.STEAM_ID;
  const familyIds = config.FAMILY_STEAM_IDS || [];
  
  if (onProgressCallback) onProgressCallback('Resolving Steam URL...', 5);
  
  if (isNaN(primaryId)) {
    const resolveRes = await CapacitorHttp.get({ url: `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${apiKey}&vanityurl=${primaryId}` });
    if (resolveRes.status === 200 && resolveRes.data?.response?.steamid) {
      primaryId = resolveRes.data.response.steamid;
    } else {
      throw new Error('Failed to resolve Steam Vanity URL.');
    }
  }
  
  const fetchGames = async (steamId) => {
    const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${steamId}&include_appinfo=true&include_played_free_games=true&format=json`;
    const response = await CapacitorHttp.get({ url });
    if (response.status !== 200) throw new Error(`Failed to fetch games for SteamID ${steamId}`);
    return response.data?.response?.games || [];
  };
  
  if (onProgressCallback) onProgressCallback('Importing primary Steam library...', 10);
  const primaryGames = await fetchGames(primaryId);
  const gamesMap = new Map();
  for (const game of primaryGames) {
    gamesMap.set(game.appid, { appid: game.appid, name: game.name, playtime_forever: game.playtime_forever || 0, img_icon_url: game.img_icon_url || '', owner_steamid: primaryId, is_owned: true, source: 'primary' });
  }
  
  let step = 0;
  for (const memberId of familyIds) {
    step++;
    if (onProgressCallback) onProgressCallback(`Importing family member ${step}/${familyIds.length} library...`, 10 + Math.round((step / familyIds.length) * 10));
    let resolvedMemberId = memberId;
    if (isNaN(memberId)) {
      const resolveRes = await CapacitorHttp.get({ url: `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${apiKey}&vanityurl=${memberId}` });
      if (resolveRes.status === 200 && resolveRes.data?.response?.steamid) {
        resolvedMemberId = resolveRes.data.response.steamid;
      }
    }
    try {
      const memberGames = await fetchGames(resolvedMemberId);
      for (const game of memberGames) {
        if (!gamesMap.has(game.appid)) {
          gamesMap.set(game.appid, { appid: game.appid, name: game.name, playtime_forever: 0, img_icon_url: game.img_icon_url || '', owner_steamid: resolvedMemberId, is_owned: false, source: 'family_manual' });
        }
      }
    } catch (err) {
      console.error(`Failed to fetch games for family member ${memberId}:`, err);
    }
  }
  
  const allGames = Array.from(gamesMap.values());
  let existingHltbMap = new Map();
  if (!force) {
    const currentLibrary = await getMobileLibrary();
    (currentLibrary.games || []).forEach(g => { if (g.hltb) existingHltbMap.set(g.appid, g.hltb); });
  }
  
  const mergedGames = allGames.map(game => ({ ...game, hltb: existingHltbMap.get(game.appid) || null }));
  
  // --- Dataset-first enrichment ---
  // Attach HLTB times + metadata from the preloaded dataset for every game
  // that doesn't already have HLTB data (or on force sync).
  if (preloadedHltbData && Object.keys(preloadedHltbData).length > 0) {
    let datasetHits = 0;
    for (const game of mergedGames) {
      if (game.hltb && !force) continue; // already has data and not force-syncing
      const cleanedTitle = cleanGameTitleForSearch(game.name);
      const datasetEntry = cleanedTitle ? preloadedHltbData[cleanedTitle] : null;
      if (datasetEntry) {
        game.hltb = {
          hltbId: datasetEntry.hltbId || '',
          title: datasetEntry.title || game.name,
          gameplayMain: datasetEntry.gameplayMain || 0,
          gameplayMainExtra: datasetEntry.gameplayMainExtra || 0,
          gameplayCompletionist: datasetEntry.gameplayCompletionist || 0,
          imageUrl: datasetEntry.imageUrl || '',
          notFound: false,
          genres: datasetEntry.genres || '',
          developers: datasetEntry.developers || '',
          publishers: datasetEntry.publishers || '',
          platforms: datasetEntry.platforms || '',
          releaseYear: datasetEntry.releaseYear || null,
          source: 'dataset'
        };
        datasetHits++;
      }
    }
    console.log(`Dataset-first enrichment: ${datasetHits}/${mergedGames.length} games matched from preloaded dataset.`);
  }
  
  const libraryData = { games: mergedGames, lastSync: Date.now() };
  await saveMobileLibrary(libraryData);
  return libraryData;
}

// ============================================================================
// HLTB DATA FETCHER
// ============================================================================

async function fetchHltbData(game) {
  const cleanedTitle = cleanGameTitleForSearch(game.name);
  if (!cleanedTitle) return { title: game.name, notFound: true };
  
  let results = await scrapeHltbMobile(game.name);
  if (!results || results.length === 0) {
    if (cleanedTitle !== game.name.toLowerCase().trim()) {
      results = await scrapeHltbMobile(cleanedTitle);
    }
  }
  
  if (results && results.length > 0) {
    const cacheKey = game.name.trim().toLowerCase();
    const exactMatch = results.find(r => r.game_name?.toLowerCase() === cacheKey);
    const match = exactMatch || results[0];
    return {
      hltbId: String(match.game_id),
      title: match.game_name,
      gameplayMain: Math.round((match.comp_main || 0) / 3600),
      gameplayMainExtra: Math.round((match.comp_plus || 0) / 3600),
      gameplayCompletionist: Math.round((match.comp_100 || 0) / 3600),
      imageUrl: match.game_image ? `https://howlongtobeat.com/games/${match.game_image}` : '',
      notFound: false
    };
  }
  return { title: game.name, notFound: true };
}

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  await loadManualBeatenSets();
  await loadPreloadedHltb();
  await fetchLibrary();
  setupEventListeners();
  
  // Register touch-swipe-to-close behavior on bottom sheets
  makeBottomSheetSwipable('mobile-settings-overlay', '.bottom-sheet-content');
  makeBottomSheetSwipable('mobile-details-overlay', '.bottom-sheet-content');
  makeBottomSheetSwipable('mobile-sync-modal', '.bottom-sheet-content');
  makeBottomSheetSwipable('mobile-dice-modal', '.bottom-sheet-content');
  makeBottomSheetSwipable('mobile-first-sync-overlay', '.bottom-sheet-content');
  makeBottomSheetSwipable('mobile-rematch-overlay', '.bottom-sheet-content');
  makeBottomSheetSwipable('mobile-filter-sheet-overlay', '.bottom-sheet-content');
});

function makeBottomSheetSwipable(overlayId, contentSelector) {
  const overlay = document.getElementById(overlayId);
  if (!overlay) return;
  const content = overlay.querySelector(contentSelector);
  if (!content) return;

  let startY = 0;
  let currentY = 0;
  let isDragging = false;

  content.addEventListener('touchstart', (e) => {
    const scrollable = content.querySelector('.details-sheet-scrollable');
    if (scrollable && scrollable.scrollTop > 0) {
      return;
    }
    startY = e.touches[0].clientY;
    isDragging = true;
    content.style.transition = 'none';
  }, { passive: true });

  content.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    currentY = e.touches[0].clientY;
    const deltaY = currentY - startY;
    if (deltaY > 0) {
      content.style.transform = `translateY(${deltaY}px)`;
    } else {
      content.style.transform = '';
    }
  }, { passive: true });

  content.addEventListener('touchend', () => {
    if (!isDragging) return;
    isDragging = false;
    content.style.transition = 'transform 0.3s cubic-bezier(0.1, 0.76, 0.55, 0.94)';
    const deltaY = currentY - startY;
    if (deltaY > 120) {
      overlay.style.display = 'none';
    }
    content.style.transform = '';
    startY = 0;
    currentY = 0;
  });
}

async function fetchLibrary() {
  try {
    mobileSetupView.style.display = 'none';
    mobileEmptyView.style.display = 'none';
    mobileGamesGrid.style.display = 'grid';
    
    const config = await getMobileConfig();
    if (!config || !config.STEAM_API_KEY || !config.STEAM_ID) {
      mobileSetupView.style.display = 'flex';
      mobileGamesGrid.style.display = 'none';
      progressGamesSection.style.display = 'none';
      return;
    }
    
    const data = await getMobileLibrary();
    if (data.lastSync === 0 || !data.games || data.games.length === 0) {
      mobileEmptyView.style.display = 'flex';
      mobileGamesGrid.style.display = 'none';
      progressGamesSection.style.display = 'none';
      return;
    }
    
    games = data.games.map(g => ({ ...g, hltb: g.hltb || null, hltbLoading: false, hltbError: false }));
    
    updateStats();
    populateFilterDropdowns();
    handleSearchAndFilter();
  } catch (err) {
    console.error('Failed to load library:', err);
  }
}

// ============================================================================
// STATS
// ============================================================================

function updateStats() {
  const completedGames = games.filter(g => isGameBeaten(g));
  const backlogGames = games.filter(g => !isGameBeaten(g));
  
  statBacklogCount.innerHTML = `${backlogGames.length} <span class="stat-card-sub">Games</span>`;
  const totalMins = backlogGames.reduce((sum, g) => sum + (g.playtime_forever || 0), 0);
  statBacklogHours.textContent = `${Math.round(totalMins / 60)}h Total`;
  
  statCompletedCount.innerHTML = `${completedGames.length} <span class="stat-card-sub">Games</span>`;
  const completedHrs = completedGames.reduce((sum, g) => sum + (g.hltb?.gameplayMain || 0), 0);
  statCompletedHours.textContent = `${completedHrs}h Beaten`;
  
  const eligible = backlogGames.filter(g => g.hltb && !g.hltb.notFound && g.hltb.gameplayMain > 0);
  if (eligible.length > 0) {
    eligible.sort((a, b) => a.hltb.gameplayMain - b.hltb.gameplayMain);
    statNextUpName.textContent = eligible[0].name;
    statNextUpTime.textContent = `${eligible[0].hltb.gameplayMain}h main story`;
  } else {
    statNextUpName.textContent = 'None';
    statNextUpTime.textContent = '0h';
  }
}

// ============================================================================
// FILTER & SORT DYNAMIC DROPDOWNS
// ============================================================================

function populateFilterDropdowns() {
  const genresSet = new Set();
  const developersSet = new Set();
  const platformsSet = new Set();
  
  games.forEach(g => {
    if (g.hltb && !g.hltb.notFound) {
      if (g.hltb.genres) {
        g.hltb.genres.split(',').forEach(genre => {
          if (genre.trim()) genresSet.add(genre.trim());
        });
      }
      if (g.hltb.developers) {
        g.hltb.developers.split(',').forEach(dev => {
          if (dev.trim()) developersSet.add(dev.trim());
        });
      }
      if (g.hltb.platforms) {
        g.hltb.platforms.split(',').forEach(plat => {
          if (plat.trim()) platformsSet.add(plat.trim());
        });
      }
    }
  });
  
  if (filterSheetGenre) {
    filterSheetGenre.innerHTML = '<option value="all">All Genres</option>' + 
      Array.from(genresSet).sort().map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
    filterSheetGenre.value = currentGenre;
  }
  if (filterSheetDeveloper) {
    filterSheetDeveloper.innerHTML = '<option value="all">All Developers</option>' + 
      Array.from(developersSet).sort().map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
    filterSheetDeveloper.value = currentDeveloper;
  }
  if (filterSheetPlatform) {
    filterSheetPlatform.innerHTML = '<option value="all">All Platforms</option>' + 
      Array.from(platformsSet).sort().map(p => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
    filterSheetPlatform.value = currentPlatform;
  }
}

function handleSearchAndFilter() {
  const query = mobileSearchInput.value.toLowerCase().trim();
  
  filteredGames = games.filter(game => {
    if (query && !game.name.toLowerCase().includes(query)) return false;
    
    const playHours = (game.playtime_forever || 0) / 60;
    const beaten = isGameBeaten(game);
    
    // Hour filters check
    if (filterMinHours !== null || filterMaxHours !== null) {
      if (!game.hltb || game.hltb.notFound) return false;
      const targetTime = game.hltb.gameplayMain || 0;
      if (filterMinHours !== null && targetTime < filterMinHours) return false;
      if (filterMaxHours !== null && targetTime > filterMaxHours) return false;
    }
    
    // Genre filter check
    if (currentGenre !== 'all') {
      if (!game.hltb || !game.hltb.genres) return false;
      const genresArray = game.hltb.genres.split(',').map(g => g.trim());
      if (!genresArray.includes(currentGenre)) return false;
    }
    
    // Developer filter check
    if (currentDeveloper !== 'all') {
      if (!game.hltb || !game.hltb.developers) return false;
      const devsArray = game.hltb.developers.split(',').map(d => d.trim());
      if (!devsArray.includes(currentDeveloper)) return false;
    }
    
    // Platform filter check
    if (currentPlatform !== 'all') {
      if (!game.hltb || !game.hltb.platforms) return false;
      const platsArray = game.hltb.platforms.split(',').map(p => p.trim());
      if (!platsArray.includes(currentPlatform)) return false;
    }
    
    switch (currentFilter) {
      case 'owned': return game.is_owned;
      case 'shared': return !game.is_owned;
      case 'played': return playHours > 0.1;
      case 'unplayed': return playHours <= 0.1;
      case 'completed': return beaten;
      default: return true;
    }
  });
  
  sortGames();
  visibleCardCount = BATCH_SIZE;
  renderMobileGrids();
}

function sortGames() {
  filteredGames.sort((a, b) => {
    switch (currentSort) {
      case 'playtime_asc': return (a.playtime_forever || 0) - (b.playtime_forever || 0);
      case 'name_asc': return a.name.localeCompare(b.name);
      case 'name_desc': return b.name.localeCompare(a.name);
      case 'hltb_main_asc': {
        const tA = a.hltb && !a.hltb.notFound ? a.hltb.gameplayMain : Infinity;
        const tB = b.hltb && !b.hltb.notFound ? b.hltb.gameplayMain : Infinity;
        return tA - tB;
      }
      case 'hltb_main_desc': {
        const tA = a.hltb && !a.hltb.notFound ? a.hltb.gameplayMain : -Infinity;
        const tB = b.hltb && !b.hltb.notFound ? b.hltb.gameplayMain : -Infinity;
        return tB - tA;
      }
      case 'playtime_desc':
      default: return (b.playtime_forever || 0) - (a.playtime_forever || 0);
    }
  });
}

// ============================================================================
// RENDERING
// ============================================================================

function renderMobileGrids() {
  mobileNoMatchesView.style.display = 'none';
  mobileGamesGrid.style.display = 'grid';
  
  // "Games in Progress" — only on "all" filter with no search query and no hour or dropdown filters active
  const hasAdvancedFilters = filterMinHours !== null || filterMaxHours !== null || currentGenre !== 'all' || currentDeveloper !== 'all' || currentPlatform !== 'all';
  const showProgress = currentFilter === 'all' && !mobileSearchInput.value && !hasAdvancedFilters;
  const inProgress = showProgress ? filteredGames.filter(g => {
    const playHours = (g.playtime_forever || 0) / 60;
    const beatHours = g.hltb && !g.hltb.notFound ? g.hltb.gameplayMain : 0;
    return playHours > 0.1 && beatHours > 0 && !isGameBeaten(g);
  }) : [];
  
  if (inProgress.length > 0) {
    progressGamesSection.style.display = 'block';
    const shown = inProgress.slice(0, 5);
    progressGamesGrid.innerHTML = shown.map(game => {
      const playHours = ((game.playtime_forever || 0) / 60).toFixed(1);
      const mainHrs = game.hltb.gameplayMain;
      const pct = Math.min(100, Math.round((parseFloat(playHours) / mainHrs) * 100));
      const radius = 18;
      const circ = 2 * Math.PI * radius;
      const offset = circ - (pct / 100) * circ;
      const imgUrl = `https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/header.jpg`;
      
      return `
        <div class="progress-card" onclick="openGameDetailsSheet(${game.appid})">
          <div class="progress-card-banner">
            <img src="${imgUrl}" alt="${escapeHtml(game.name)}" loading="lazy">
            <div class="progress-card-banner-overlay"></div>
          </div>
          <div class="progress-card-details">
            <div class="progress-card-top">
              <h4 class="progress-game-title">${escapeHtml(game.name)}</h4>
              <span class="progress-game-hours"><i class="fa-solid fa-clock"></i> ${playHours} hrs</span>
            </div>
            <div class="progress-card-bottom">
              <span class="progress-hltb-label">HLTB: ${mainHrs}h</span>
              <div class="progress-ring-mini">
                <svg width="44" height="44">
                  <circle class="track" cx="22" cy="22" r="18"></circle>
                  <circle class="fill" cx="22" cy="22" r="18" stroke-dasharray="${circ}" stroke-dashoffset="${offset}"></circle>
                </svg>
                <span class="percent-text">${pct}%</span>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } else {
    progressGamesSection.style.display = 'none';
  }
  
  // Build the general backlog grid
  let gridGames = filteredGames;
  if (inProgress.length > 0) {
    const progressIds = new Set(inProgress.slice(0, 5).map(g => g.appid));
    gridGames = filteredGames.filter(g => !progressIds.has(g.appid));
  }
  
  if (gridGames.length === 0 && inProgress.length === 0) {
    mobileNoMatchesView.style.display = 'flex';
    mobileGamesGrid.innerHTML = '';
    allGamesHeader.style.display = 'none';
    return;
  }
  
  if (gridGames.length === 0) {
    mobileGamesGrid.innerHTML = '';
    allGamesHeader.style.display = 'none';
    return;
  }
  
  allGamesHeader.style.display = 'block';
  allGamesHeader.textContent = currentFilter === 'all' ? 'YOUR BACKLOG' : `FILTERED: ${currentFilter.toUpperCase()}`;
  
  const batch = gridGames.slice(0, visibleCardCount);
  mobileGamesGrid.innerHTML = batch.map(game => createSmallCardHtml(game)).join('');
}

function createSmallCardHtml(game) {
  const playHours = ((game.playtime_forever || 0) / 60).toFixed(1);
  const imgUrl = `https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/header.jpg`;
  const beaten = isGameBeaten(game);
  
  let badgeHtml = '';
  if (beaten) {
    badgeHtml = `<span style="font-size: 0.6rem; color: var(--accent-green);">✓</span>`;
  } else if (game.hltb && !game.hltb.notFound && game.hltb.gameplayMain > 0) {
    const pct = Math.min(100, Math.round((parseFloat(playHours) / game.hltb.gameplayMain) * 100));
    badgeHtml = `<span style="font-family: var(--font-mono); font-size: 0.6rem; color: var(--accent-orange-light); font-weight: 700;">${pct}%</span>`;
  }
  
  return `
    <div class="small-card${beaten ? ' beaten' : ''}" onclick="openGameDetailsSheet(${game.appid})">
      <div class="small-card-cover">
        <img src="${imgUrl}" alt="${escapeHtml(game.name)}" onerror="handleCoverError(this, '${escapeHtml(game.name)}')" loading="lazy">
      </div>
      <h4 class="small-card-title" title="${escapeHtml(game.name)}">${escapeHtml(game.name)}</h4>
      <div class="small-card-meta">
        <span class="small-card-hours">${playHours}h</span>
        ${badgeHtml}
      </div>
    </div>
  `;
}

function handleCoverError(img, name) {
  const container = img.parentElement;
  const placeholder = document.createElement('div');
  placeholder.className = 'small-card-placeholder';
  placeholder.innerHTML = `<span>${escapeHtml(name)}</span>`;
  img.style.display = 'none';
  container.appendChild(placeholder);
}

// ============================================================================
// INFINITE SCROLL
// ============================================================================

const contentArea = document.querySelector('.mobile-content');
if (contentArea) {
  contentArea.addEventListener('scroll', () => {
    if (contentArea.scrollTop + contentArea.clientHeight >= contentArea.scrollHeight - 250) {
      if (visibleCardCount < filteredGames.length) {
        visibleCardCount += BATCH_SIZE;
        renderMobileGrids();
      }
    }
  });
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

function setupEventListeners() {
  mobileSearchInput.addEventListener('input', debounce(handleSearchAndFilter, 250));
  
  filterChips.forEach(chip => {
    chip.addEventListener('click', () => {
      filterChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.getAttribute('data-filter');
      handleSearchAndFilter();
    });
  });
  
  // Settings
  document.getElementById('mobile-settings-btn').addEventListener('click', openSettingsSheet);
  document.getElementById('mobile-setup-trigger-btn')?.addEventListener('click', openSettingsSheet);
  document.getElementById('close-sheet-btn').addEventListener('click', () => { mobileSettingsOverlay.style.display = 'none'; });
  mobileSettingsForm.addEventListener('submit', saveSettingsMobile);
  
  // Sync modal
  document.getElementById('mobile-sync-btn').addEventListener('click', () => { mobileSyncModal.style.display = 'flex'; });
  document.getElementById('mobile-empty-sync-btn')?.addEventListener('click', () => { mobileSyncModal.style.display = 'flex'; });
  document.getElementById('close-sync-sheet-btn').addEventListener('click', () => { mobileSyncModal.style.display = 'none'; });
  document.getElementById('mobile-sync-quick-btn').addEventListener('click', () => { mobileSyncModal.style.display = 'none'; startLibrarySyncMobile(false); });
  document.getElementById('mobile-sync-force-btn').addEventListener('click', () => { mobileSyncModal.style.display = 'none'; startLibrarySyncMobile(true); });
  
  // Floating sync top toast
  if (mobileSyncToastMinimize) {
    mobileSyncToastMinimize.addEventListener('click', () => {
      mobileSyncToast.style.display = 'none';
    });
  }
  
  // First-time sync background action button
  if (firstSyncBackgroundBtn) {
    firstSyncBackgroundBtn.addEventListener('click', () => {
      mobileFirstSyncOverlay.style.display = 'none';
      mobileSyncToast.style.display = 'flex';
    });
  }
  
  // Details Sheet Buttons
  document.getElementById('close-details-btn').addEventListener('click', () => { mobileDetailsOverlay.style.display = 'none'; });
  
  if (detailsRematchBtn) {
    detailsRematchBtn.addEventListener('click', () => {
      const appid = rematchActiveAppid;
      if (appid) openRematchOverlay(appid);
    });
  }
  
  if (detailsRefreshBtn) {
    detailsRefreshBtn.addEventListener('click', async () => {
      const appid = rematchActiveAppid;
      if (!appid) return;
      
      const gameIdx = games.findIndex(g => g.appid === appid);
      if (gameIdx === -1) return;
      
      detailsRefreshBtn.disabled = true;
      detailsRefreshBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Refreshing...';
      
      try {
        const game = games[gameIdx];
        const hltbData = await fetchHltbData(game);
        games[gameIdx].hltb = hltbData;
        await saveMobileLibrary({ games: games, lastSync: Date.now() });
        updateStats();
        handleSearchAndFilter();
        openGameDetailsSheet(appid);
        alert(`Successfully refreshed HLTB data for "${game.name}"!`);
      } catch (err) {
        console.error('Failed to force refresh game:', err);
        alert('Failed to refresh data from HowLongToBeat.');
      } finally {
        detailsRefreshBtn.disabled = false;
        detailsRefreshBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Force Refresh HLTB Data';
      }
    });
  }
  
  // Rematch Sheet Buttons
  if (closeRematchSheetBtn) {
    closeRematchSheetBtn.addEventListener('click', () => {
      mobileRematchOverlay.style.display = 'none';
    });
  }
  if (rematchSearchBtn) {
    rematchSearchBtn.addEventListener('click', performRematchSearch);
  }
  if (rematchSearchInput) {
    rematchSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        performRematchSearch();
      }
    });
  }
  
  // Unified Filter Sheet Event bindings
  if (mobileFilterHudTrigger) {
    mobileFilterHudTrigger.addEventListener('click', () => {
      // Sync inputs with current filter state before showing sheet
      filterSheetSort.value = currentSort;
      filterSheetMinHours.value = filterMinHours !== null ? filterMinHours : '';
      filterSheetMaxHours.value = filterMaxHours !== null ? filterMaxHours : '';
      filterSheetGenre.value = currentGenre;
      filterSheetDeveloper.value = currentDeveloper;
      filterSheetPlatform.value = currentPlatform;
      
      mobileFilterSheetOverlay.style.display = 'flex';
    });
  }
  
  if (closeFilterSheetBtn) {
    closeFilterSheetBtn.addEventListener('click', () => {
      mobileFilterSheetOverlay.style.display = 'none';
    });
  }
  
  if (filterSheetClearBtn) {
    filterSheetClearBtn.addEventListener('click', () => {
      filterSheetMinHours.value = '';
      filterSheetMaxHours.value = '';
      filterSheetGenre.value = 'all';
      filterSheetDeveloper.value = 'all';
      filterSheetPlatform.value = 'all';
      
      // Clear state and close
      filterMinHours = null;
      filterMaxHours = null;
      currentGenre = 'all';
      currentDeveloper = 'all';
      currentPlatform = 'all';
      
      mobileFilterSheetOverlay.style.display = 'none';
      handleSearchAndFilter();
    });
  }
  
  if (filterSheetApplyBtn) {
    filterSheetApplyBtn.addEventListener('click', () => {
      currentSort = filterSheetSort.value;
      filterMinHours = filterSheetMinHours.value ? parseFloat(filterSheetMinHours.value) : null;
      filterMaxHours = filterSheetMaxHours.value ? parseFloat(filterSheetMaxHours.value) : null;
      currentGenre = filterSheetGenre.value;
      currentDeveloper = filterSheetDeveloper.value;
      currentPlatform = filterSheetPlatform.value;
      
      mobileFilterSheetOverlay.style.display = 'none';
      handleSearchAndFilter();
    });
  }
  
  // Dice
  document.getElementById('mobile-dice-btn').addEventListener('click', triggerDicePickerMobile);
  document.getElementById('close-dice-sheet-btn').addEventListener('click', () => { mobileDiceModal.style.display = 'none'; });
  document.getElementById('dice-reroll-btn').addEventListener('click', triggerDicePickerMobile);
}

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

// ============================================================================
// SETTINGS SHEET
// ============================================================================

async function openSettingsSheet() {
  mobileSettingsOverlay.style.display = 'flex';
  const config = await getMobileConfig();
  if (config) {
    settingsApiKey.value = '';
    settingsApiKey.placeholder = config.STEAM_API_KEY ? '••••••••••••••••••••••••••••••••' : 'Enter Steam API Key';
    settingsSteamId.value = config.STEAM_ID || '';
    settingsFamilyIds.value = (config.FAMILY_STEAM_IDS || []).join(', ');
  }
}

async function saveSettingsMobile(e) {
  e.preventDefault();
  const apiKey = settingsApiKey.value.trim();
  const steamId = settingsSteamId.value.trim();
  const familyIdsStr = settingsFamilyIds.value.trim();
  const familyIds = familyIdsStr ? familyIdsStr.split(',').map(id => id.trim()).filter(Boolean) : [];
  
  try {
    const current = await getMobileConfig() || {};
    const configToSave = {
      STEAM_ID: steamId,
      FAMILY_STEAM_IDS: familyIds,
      STEAM_API_KEY: (apiKey && !apiKey.includes('•')) ? apiKey : (current.STEAM_API_KEY || ''),
    };
    configToSave.STEAM_API_KEY_SET = !!configToSave.STEAM_API_KEY;
    
    await saveMobileConfig(configToSave);
    mobileSettingsOverlay.style.display = 'none';
    await fetchLibrary();
  } catch (err) {
    alert(`Failed to save settings: ${err.message}`);
  }
}

// ============================================================================
// LIBRARY SYNC
// ============================================================================

async function startLibrarySyncMobile(force) {
  const isFirstSync = (games.length === 0);
  
  try {
    mobileEmptyView.style.display = 'none';
    
    if (isFirstSync) {
      if (firstSyncProgressBar) firstSyncProgressBar.style.width = '0%';
      if (firstSyncStatusText) firstSyncStatusText.textContent = 'Contacting Steam...';
      if (firstSyncPctText) firstSyncPctText.textContent = '0%';
      if (mobileFirstSyncOverlay) mobileFirstSyncOverlay.style.display = 'flex';
    } else {
      if (mobileSyncToast) {
        mobileSyncHudPctToast.textContent = '0%';
        mobileSyncToast.style.display = 'flex';
      }
    }
    
    const libraryData = await performMobileSync(force, (statusText, pct) => {
      if (isFirstSync) {
        if (firstSyncStatusText) firstSyncStatusText.textContent = statusText;
        if (firstSyncProgressBar) firstSyncProgressBar.style.width = `${pct}%`;
        if (firstSyncPctText) firstSyncPctText.textContent = `${pct}%`;
      }
    });
    
    games = libraryData.games.map(g => ({ ...g, hltb: g.hltb || null, hltbLoading: false, hltbError: false }));
    
    updateStats();
    populateFilterDropdowns();
    handleSearchAndFilter();
    
    // Kick off HLTB background sync
    hltbSyncQueue = games.filter(g => !g.hltb);
    if (hltbSyncQueue.length > 0) {
      startHltbSyncMobile(isFirstSync);
    } else {
      if (mobileFirstSyncOverlay) mobileFirstSyncOverlay.style.display = 'none';
      if (mobileSyncToast) mobileSyncToast.style.display = 'none';
    }
  } catch (err) {
    alert(`Sync failed: ${err.message}`);
    if (mobileFirstSyncOverlay) mobileFirstSyncOverlay.style.display = 'none';
    if (mobileSyncToast) mobileSyncToast.style.display = 'none';
    await fetchLibrary();
  }
}

function startHltbSyncMobile(isFirstSync) {
  const workersNeeded = Math.min(MAX_CONCURRENT_SYNC - activeSyncWorkers, hltbSyncQueue.length);
  for (let i = 0; i < workersNeeded; i++) { processNextQueueItemMobile(isFirstSync); }
}

async function processNextQueueItemMobile(isFirstSync) {
  if (hltbSyncQueue.length === 0) {
    if (activeSyncWorkers === 0) {
      if (mobileFirstSyncOverlay) mobileFirstSyncOverlay.style.display = 'none';
      if (mobileSyncToast) mobileSyncToast.style.display = 'none';
      
      updateStats();
      populateFilterDropdowns();
      handleSearchAndFilter();
    }
    return;
  }
  
  activeSyncWorkers++;
  const game = hltbSyncQueue.shift();
  const cleanedTitle = cleanGameTitleForSearch(game.name);
  
  try {
    let hltbData = null;
    const datasetEntry = (cleanedTitle && preloadedHltbData) ? preloadedHltbData[cleanedTitle] : null;
    if (datasetEntry) {
      hltbData = {
        hltbId: datasetEntry.hltbId || '',
        title: datasetEntry.title || game.name,
        gameplayMain: datasetEntry.gameplayMain || 0,
        gameplayMainExtra: datasetEntry.gameplayMainExtra || 0,
        gameplayCompletionist: datasetEntry.gameplayCompletionist || 0,
        imageUrl: datasetEntry.imageUrl || '',
        notFound: false,
        genres: datasetEntry.genres || '',
        developers: datasetEntry.developers || '',
        publishers: datasetEntry.publishers || '',
        platforms: datasetEntry.platforms || '',
        releaseYear: datasetEntry.releaseYear || null,
        source: 'dataset'
      };
    } else {
      hltbData = await fetchHltbData(game);
    }
    
    const index = games.findIndex(g => g.appid === game.appid);
    if (index !== -1) {
      games[index].hltb = hltbData;
      await saveMobileLibrary({ games: games, lastSync: Date.now() });
      
      updateStats();
      handleSearchAndFilter();
    }
  } catch (err) {
    console.error(`Failed to get HLTB times for ${game.name}:`, err);
  }
  
  const total = games.length;
  const processed = games.filter(g => g.hltb !== null).length;
  const pct = total > 0 ? Math.round((processed / total) * 100) : 100;
  
  if (isFirstSync && mobileFirstSyncOverlay.style.display !== 'none') {
    if (firstSyncStatusText) firstSyncStatusText.textContent = `Matching HLTB times: ${processed}/${total} games`;
    if (firstSyncProgressBar) firstSyncProgressBar.style.width = `${pct}%`;
    if (firstSyncPctText) firstSyncPctText.textContent = `${pct}%`;
  }
  
  if (mobileSyncHudPctToast) {
    mobileSyncHudPctToast.textContent = `${pct}%`;
  }
  
  activeSyncWorkers--;
  processNextQueueItemMobile(isFirstSync);
}

// ============================================================================
// GAME DETAILS SHEET
// ============================================================================

function openGameDetailsSheet(appid) {
  const game = games.find(g => g.appid === appid);
  if (!game) return;
  
  rematchActiveAppid = appid;
  
  // Explicitly reset the details sheet scroll container to top!
  const scrollable = document.querySelector('.details-sheet-scrollable');
  if (scrollable) scrollable.scrollTop = 0;
  
  document.getElementById('details-game-name').textContent = game.name;
  document.getElementById('details-game-img').src = `https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/header.jpg`;
  
  const ownerBadge = document.getElementById('details-owner-badge');
  ownerBadge.textContent = game.is_owned ? 'Owned' : 'Borrowed';
  
  const playHours = ((game.playtime_forever || 0) / 60).toFixed(1);
  document.getElementById('details-playtime-val').textContent = `${playHours} hrs`;
  
  // Beat status
  const beaten = isGameBeaten(game);
  const statusEl = document.getElementById('details-status-val');
  statusEl.textContent = beaten ? 'Beaten ✓' : (parseFloat(playHours) > 0.1 ? 'In Progress' : 'Not Started');
  statusEl.style.color = beaten ? 'var(--accent-green)' : 'var(--text-primary)';
  
  // Mark as complete / override button
  const markBtn = document.getElementById('details-mark-complete-btn');
  if (markBtn) {
    if (beaten) {
      markBtn.textContent = 'Unmark as Beaten (Keep In Progress)';
      markBtn.style.display = 'block';
      markBtn.onclick = async () => {
        if (manuallyCompleted.has(game.appid)) {
          manuallyCompleted.delete(game.appid);
        } else {
          manuallyUnbeaten.add(game.appid);
        }
        await saveManualBeatenSets();
        updateStats();
        handleSearchAndFilter();
        openGameDetailsSheet(appid);
      };
    } else {
      markBtn.textContent = 'Mark as Beaten';
      markBtn.style.display = 'block';
      markBtn.onclick = async () => {
        if (manuallyUnbeaten.has(game.appid)) {
          manuallyUnbeaten.delete(game.appid);
        } else {
          manuallyCompleted.add(game.appid);
        }
        await saveManualBeatenSets();
        updateStats();
        handleSearchAndFilter();
        openGameDetailsSheet(appid);
      };
    }
  }
  
  // HLTB
  if (game.hltb && !game.hltb.notFound) {
    document.getElementById('details-hltb-main').textContent = `${game.hltb.gameplayMain}h`;
    document.getElementById('details-hltb-extra').textContent = `${game.hltb.gameplayMainExtra}h`;
    document.getElementById('details-hltb-100').textContent = `${game.hltb.gameplayCompletionist}h`;
  } else {
    document.getElementById('details-hltb-main').textContent = '--';
    document.getElementById('details-hltb-extra').textContent = '--';
    document.getElementById('details-hltb-100').textContent = '--';
  }
  
  // Rich Metadata Panel
  const metaSection = document.getElementById('details-metadata-section');
  if (metaSection) {
    const hasMeta = game.hltb && !game.hltb.notFound && (game.hltb.genres || game.hltb.developers || game.hltb.releaseYear || game.hltb.platforms);
    if (hasMeta) {
      document.getElementById('details-meta-genres').textContent = game.hltb.genres || 'Unknown';
      document.getElementById('details-meta-developer').textContent = game.hltb.developers || 'Unknown';
      document.getElementById('details-meta-release').textContent = game.hltb.releaseYear || 'Unknown';
      document.getElementById('details-meta-platforms').textContent = game.hltb.platforms || 'Unknown';
      metaSection.style.display = 'flex';
    } else {
      metaSection.style.display = 'none';
      
      // On-demand metadata: check preloaded dataset FIRST, then Steam API as fallback
      if (game.hltb && !game.hltb.notFound) {
        const cleanedTitle = cleanGameTitleForSearch(game.name);
        const datasetEntry = (cleanedTitle && preloadedHltbData) ? preloadedHltbData[cleanedTitle] : null;
        
        if (datasetEntry && (datasetEntry.genres || datasetEntry.developers)) {
          // Use dataset metadata directly — no API call needed
          game.hltb.genres = datasetEntry.genres || '';
          game.hltb.developers = datasetEntry.developers || '';
          game.hltb.publishers = datasetEntry.publishers || '';
          game.hltb.platforms = datasetEntry.platforms || '';
          game.hltb.releaseYear = datasetEntry.releaseYear || null;
          
          saveMobileLibrary({ games: games, lastSync: Date.now() });
          
          document.getElementById('details-meta-genres').textContent = datasetEntry.genres || 'Unknown';
          document.getElementById('details-meta-developer').textContent = datasetEntry.developers || 'Unknown';
          document.getElementById('details-meta-release').textContent = datasetEntry.releaseYear || 'Unknown';
          document.getElementById('details-meta-platforms').textContent = datasetEntry.platforms || 'Unknown';
          metaSection.style.display = 'flex';
        } else {
          // Fallback: hit Steam Store API (only for games not in dataset)
          fetchSteamStoreMetadata(game.appid).then(async (meta) => {
            if (meta && rematchActiveAppid === appid) {
              game.hltb.developers = meta.developers;
              game.hltb.publishers = meta.publishers;
              game.hltb.genres = meta.genres;
              game.hltb.platforms = meta.platforms;
              game.hltb.releaseYear = meta.releaseYear;
              
              await saveMobileLibrary({ games: games, lastSync: Date.now() });
              
              document.getElementById('details-meta-genres').textContent = meta.genres || 'Unknown';
              document.getElementById('details-meta-developer').textContent = meta.developers || 'Unknown';
              document.getElementById('details-meta-release').textContent = meta.releaseYear || 'Unknown';
              document.getElementById('details-meta-platforms').textContent = meta.platforms || 'Unknown';
              metaSection.style.display = 'flex';
            }
          });
        }
    }
  }
  
  document.getElementById('details-steam-link').href = `https://store.steampowered.com/app/${game.appid}`;
  document.getElementById('details-hltb-link').href = game.hltb?.hltbId
    ? `https://howlongtobeat.com/game/${game.hltb.hltbId}`
    : `https://howlongtobeat.com/?q=${encodeURIComponent(cleanGameTitleForSearch(game.name))}`;
    
  mobileDetailsOverlay.style.display = 'flex';
}

// ============================================================================
// REMATCH ACTIONS
// ============================================================================

function openRematchOverlay(appid) {
  const game = games.find(g => g.appid === appid);
  if (!game) return;
  
  rematchActiveAppid = appid;
  rematchSearchInput.value = game.name;
  rematchResultsList.innerHTML = '';
  mobileRematchOverlay.style.display = 'flex';
}

async function performRematchSearch() {
  const query = rematchSearchInput.value.trim();
  if (!query) return;
  
  rematchResultsList.innerHTML = `
    <div class="rematch-no-results">
      <i class="fa-solid fa-circle-notch fa-spin"></i> Searching HowLongToBeat...
    </div>
  `;
  
  try {
    const results = await scrapeHltbMobile(query);
    if (!results || results.length === 0) {
      rematchResultsList.innerHTML = `
        <div class="rematch-no-results">No games found matching "${escapeHtml(query)}"</div>
      `;
      return;
    }
    
    rematchResultsList.innerHTML = results.map(r => {
      const mainHrs = Math.round((r.comp_main || 0) / 3600);
      const imgUrl = r.game_image ? `https://howlongtobeat.com/games/${r.game_image}` : '';
      
      return `
        <div class="rematch-result-item" onclick="confirmRematchLink(${r.game_id}, '${escapeHtml(r.game_name)}', ${mainHrs}, '${escapeHtml(r.game_image)}')">
          <img class="rematch-result-thumb" src="${imgUrl}" onerror="this.style.display='none'">
          <div class="rematch-result-info">
            <span class="rematch-result-title">${escapeHtml(r.game_name)}</span>
            <span class="rematch-result-hours">Main Story: ${mainHrs}h</span>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Rematch search error:', err);
    rematchResultsList.innerHTML = `
      <div class="rematch-no-results" style="color: var(--accent-red);">Error: Failed to fetch search results.</div>
    `;
  }
}

async function confirmRematchLink(hltbId, title, mainHrs, imgName) {
  const appid = rematchActiveAppid;
  if (!appid) return;
  
  const gameIdx = games.findIndex(g => g.appid === appid);
  if (gameIdx === -1) return;
  
  const updatedHltb = {
    hltbId: String(hltbId),
    title: title,
    gameplayMain: mainHrs,
    gameplayMainExtra: mainHrs,
    gameplayCompletionist: mainHrs,
    imageUrl: imgName ? `https://howlongtobeat.com/games/${imgName}` : '',
    notFound: false
  };
  
  games[gameIdx].hltb = updatedHltb;
  
  // Fetch metadata: check preloaded dataset first, then Steam API as fallback
  const rematchCleanedTitle = cleanGameTitleForSearch(games[gameIdx].name);
  const rematchDatasetEntry = (rematchCleanedTitle && preloadedHltbData) ? preloadedHltbData[rematchCleanedTitle] : null;
  
  if (rematchDatasetEntry && (rematchDatasetEntry.genres || rematchDatasetEntry.developers)) {
    games[gameIdx].hltb.genres = rematchDatasetEntry.genres || '';
    games[gameIdx].hltb.developers = rematchDatasetEntry.developers || '';
    games[gameIdx].hltb.publishers = rematchDatasetEntry.publishers || '';
    games[gameIdx].hltb.platforms = rematchDatasetEntry.platforms || '';
    games[gameIdx].hltb.releaseYear = rematchDatasetEntry.releaseYear || null;
  } else {
    const meta = await fetchSteamStoreMetadata(appid);
    if (meta) {
      games[gameIdx].hltb.developers = meta.developers;
      games[gameIdx].hltb.publishers = meta.publishers;
      games[gameIdx].hltb.genres = meta.genres;
      games[gameIdx].hltb.platforms = meta.platforms;
      games[gameIdx].hltb.releaseYear = meta.releaseYear;
    }
  }
  
  // Save to mobile storage
  await saveMobileLibrary({ games: games, lastSync: Date.now() });
  
  // Update UI and Stats
  updateStats();
  handleSearchAndFilter();
  
  // Close rematch overlay and refresh details overlay
  mobileRematchOverlay.style.display = 'none';
  openGameDetailsSheet(appid);
}

// ============================================================================
// DICE PICKER
// ============================================================================

function triggerDicePickerMobile() {
  if (filteredGames.length === 0) {
    alert('No games match the active filters to pick from!');
    return;
  }
  
  const idx = Math.floor(Math.random() * filteredGames.length);
  const game = filteredGames[idx];
  const playHours = ((game.playtime_forever || 0) / 60).toFixed(1);
  const mainHrs = game.hltb && !game.hltb.notFound ? `${game.hltb.gameplayMain}h` : '--';
  
  document.getElementById('dice-game-title').textContent = game.name;
  document.getElementById('dice-playtime-val').textContent = `${playHours}h`;
  document.getElementById('dice-hltb-main-val').textContent = mainHrs;
  
  const diceImg = document.getElementById('dice-game-img');
  if (diceImg) {
    diceImg.style.display = 'block';
    diceImg.src = `https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/header.jpg`;
    diceImg.onerror = () => {
      diceImg.style.display = 'none';
    };
  }
  
  document.getElementById('dice-open-details-btn').onclick = () => {
    mobileDiceModal.style.display = 'none';
    openGameDetailsSheet(game.appid);
  };
  
  mobileDiceModal.style.display = 'flex';
}

// ============================================================================
// UTILS
// ============================================================================

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
