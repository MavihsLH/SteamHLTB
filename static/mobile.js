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

const isMobileApp = typeof window !== 'undefined' && window.Capacitor !== undefined && window.Capacitor.Plugins !== undefined && window.Capacitor.Plugins.Preferences !== undefined;

// DOM Elements
const mobileStatusIndicator = document.getElementById('mobile-status-indicator');
const statBacklogCount = document.getElementById('stat-backlog-count');
const statBacklogHours = document.getElementById('stat-backlog-hours');
const statCompletedCount = document.getElementById('stat-completed-count');
const statCompletedHours = document.getElementById('stat-completed-hours');
const statNextUpName = document.getElementById('stat-next-up-name');
const statNextUpTime = document.getElementById('stat-next-up-time');
const mobileSearchInput = document.getElementById('mobile-search-input');
const mobileSortSelect = document.getElementById('mobile-sort-select');
const filterChips = document.querySelectorAll('.filter-chip');
const progressGamesSection = document.getElementById('progress-games-section');
const progressGamesGrid = document.getElementById('progress-games-grid');
const mobileGamesGrid = document.getElementById('mobile-games-grid');
const mobileSetupView = document.getElementById('mobile-setup-view');
const mobileEmptyView = document.getElementById('mobile-empty-view');
const mobileNoMatchesView = document.getElementById('mobile-no-matches-view');
const allGamesHeader = document.getElementById('all-games-header');
const mobileSyncHudBadge = document.getElementById('mobile-sync-hud-badge');
const mobileSyncHudPct = document.getElementById('mobile-sync-hud-pct');
const mobileLastSyncTime = document.getElementById('mobile-last-sync-time');

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

// Native Preference Storage Helpers for Mobile
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
  await Preferences.set({
    key: 'config',
    value: JSON.stringify(config)
  });
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
  await Preferences.set({
    key: 'library',
    value: JSON.stringify(libraryData)
  });
}

// Clean title
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

// Scrape HLTB times
async function scrapeHltbMobile(gameName) {
  if (!isMobileApp) return null;
  const { CapacitorHttp } = window.Capacitor.Plugins;
  const now = Date.now();
  const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  
  try {
    const initUrl = `https://howlongtobeat.com/api/bleed/init?t=${now}`;
    const initRes = await CapacitorHttp.get({
      url: initUrl,
      headers: {
        'User-Agent': USER_AGENT,
        'Referer': 'https://howlongtobeat.com/',
        'Origin': 'https://howlongtobeat.com'
      }
    });
    if (initRes.status !== 200 || !initRes.data) return null;
    
    const auth = initRes.data;
    const searchTerms = gameName.trim().split(' ');
    const payload = {
      searchType: "games",
      searchTerms: searchTerms,
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
    
    if (auth.hpKey) {
      payload[auth.hpKey] = auth.hpVal;
    }
    
    const queryRes = await CapacitorHttp.post({
      url: "https://howlongtobeat.com/api/bleed",
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
        'Origin': 'https://howlongtobeat.com',
        'Referer': 'https://howlongtobeat.com/',
        'x-auth-token': auth.token,
        'x-hp-key': auth.hpKey,
        'x-hp-val': auth.hpVal
      },
      data: payload
    });
    
    if (queryRes.status !== 200 || !queryRes.data) return null;
    return queryRes.data.data || [];
  } catch (err) {
    console.error('Mobile HLTB query error:', err);
    return null;
  }
}

// Mobile sync fetch
async function performMobileSync(force) {
  if (!isMobileApp) return null;
  const { Preferences, CapacitorHttp } = window.Capacitor.Plugins;
  
  const config = await getMobileConfig();
  if (!config || !config.STEAM_API_KEY || !config.STEAM_ID) {
    throw new Error('Steam credentials are not configured.');
  }
  
  const apiKey = config.STEAM_API_KEY;
  let primaryId = config.STEAM_ID;
  const familyIds = config.FAMILY_STEAM_IDS || [];
  
  if (isNaN(primaryId)) {
    const resolveUrl = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${apiKey}&vanityurl=${primaryId}`;
    const resolveRes = await CapacitorHttp.get({ url: resolveUrl });
    if (resolveRes.status === 200 && resolveRes.data && resolveRes.data.response && resolveRes.data.response.steamid) {
      primaryId = resolveRes.data.response.steamid;
    } else {
      throw new Error('Failed to resolve Steam Vanity URL.');
    }
  }
  
  const fetchGames = async (steamId) => {
    const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${steamId}&include_appinfo=true&include_played_free_games=true&format=json`;
    const response = await CapacitorHttp.get({ url });
    if (response.status !== 200) {
      throw new Error(`Failed to fetch games for SteamID ${steamId}`);
    }
    return response.data?.response?.games || [];
  };
  
  const primaryGames = await fetchGames(primaryId);
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
  
  for (const memberId of familyIds) {
    let resolvedMemberId = memberId;
    if (isNaN(memberId)) {
      const resolveUrl = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${apiKey}&vanityurl=${memberId}`;
      const resolveRes = await CapacitorHttp.get({ url: resolveUrl });
      if (resolveRes.status === 200 && resolveRes.data?.response?.steamid) {
        resolvedMemberId = resolveRes.data.response.steamid;
      }
    }
    
    try {
      const memberGames = await fetchGames(resolvedMemberId);
      for (const game of memberGames) {
        if (!gamesMap.has(game.appid)) {
          gamesMap.set(game.appid, {
            appid: game.appid,
            name: game.name,
            playtime_forever: 0,
            img_icon_url: game.img_icon_url || '',
            owner_steamid: resolvedMemberId,
            is_owned: false,
            source: 'family_manual'
          });
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
    (currentLibrary.games || []).forEach(g => {
      if (g.hltb) existingHltbMap.set(g.appid, g.hltb);
    });
  }
  
  const mergedGames = allGames.map(game => ({
    ...game,
    hltb: existingHltbMap.get(game.appid) || null
  }));
  
  const libraryData = {
    games: mergedGames,
    lastSync: Date.now()
  };
  
  await saveMobileLibrary(libraryData);
  return libraryData;
}

// Fetch single HLTB item
async function fetchHltbData(game) {
  const cleanedTitle = cleanGameTitleForSearch(game.name);
  if (!cleanedTitle) return { title: game.name, notFound: true };
  
  console.log(`Searching HowLongToBeat (mobile) for: "${game.name}" (Cleaned: "${cleanedTitle}")...`);
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
  } else {
    return {
      title: game.name,
      notFound: true
    };
  }
}

// Load App
document.addEventListener('DOMContentLoaded', async () => {
  await fetchLibrary();
  setupEventListeners();
});

// Fetch Library and state check
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
      mobileStatusIndicator.className = 'status-dot led-orange';
      return;
    }
    
    const data = await getMobileLibrary();
    mobileStatusIndicator.className = 'status-dot led-green';
    
    if (data.lastSync === 0 || !data.games || data.games.length === 0) {
      mobileEmptyView.style.display = 'flex';
      mobileGamesGrid.style.display = 'none';
      progressGamesSection.style.display = 'none';
      mobileLastSyncTime.textContent = 'Not Synced';
      return;
    }
    
    // Loaded games state
    games = data.games.map(g => ({
      ...g,
      hltb: g.hltb || null,
      hltbLoading: false,
      hltbError: false
    }));
    
    mobileLastSyncTime.textContent = formatLastSyncTime(data.lastSync);
    
    updateStats();
    handleSearchAndFilter();
  } catch (err) {
    console.error('Failed to load library:', err);
    mobileStatusIndicator.className = 'status-dot led-red';
  }
}

// Formats timestamp
function formatLastSyncTime(timestamp) {
  if (!timestamp) return 'Never';
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

// Update stats
function updateStats() {
  const backlogGames = games.filter(g => {
    if (!g.hltb || g.hltb.notFound) return true; // default backlog
    const playtimeHrs = (g.playtime_forever || 0) / 60;
    const beatTimeHrs = g.hltb.gameplayMain || 0;
    return beatTimeHrs === 0 || playtimeHrs < beatTimeHrs;
  });
  
  statBacklogCount.innerHTML = `${backlogGames.length} <span class="stat-card-sub">Games</span>`;
  
  const totalMins = backlogGames.reduce((sum, g) => sum + (g.playtime_forever || 0), 0);
  statBacklogHours.textContent = `${Math.round(totalMins / 60)}h Total`;
  
  const completedGames = games.filter(g => {
    if (!g.hltb || g.hltb.notFound) return false;
    const playtimeHrs = (g.playtime_forever || 0) / 60;
    const beatTimeHrs = g.hltb.gameplayMain || 0;
    return beatTimeHrs > 0 && playtimeHrs >= beatTimeHrs;
  });
  
  statCompletedCount.innerHTML = `${completedGames.length} <span class="stat-card-sub">Games</span>`;
  
  const completedHrs = completedGames.reduce((sum, g) => {
    const main = g.hltb?.gameplayMain || 0;
    return sum + main;
  }, 0);
  statCompletedHours.textContent = `${completedHrs}h Beaten`;
  
  // Next Up Backlog recommendation
  const eligible = backlogGames.filter(g => g.hltb && !g.hltb.notFound && g.hltb.gameplayMain > 0);
  if (eligible.length > 0) {
    // Sort by short playtime
    eligible.sort((a, b) => (a.hltb.gameplayMain) - (b.hltb.gameplayMain));
    statNextUpName.textContent = eligible[0].name;
    statNextUpTime.textContent = `${eligible[0].hltb.gameplayMain}h main story`;
  } else {
    statNextUpName.textContent = 'None';
    statNextUpTime.textContent = '0h';
  }
}

// Filter and Sort logic
function handleSearchAndFilter() {
  const query = mobileSearchInput.value.toLowerCase().trim();
  
  filteredGames = games.filter(game => {
    // 1. Text Search
    if (query && !game.name.toLowerCase().includes(query)) return false;
    
    // 2. Chip Filters
    const playHours = (game.playtime_forever || 0) / 60;
    const beatHours = game.hltb && !game.hltb.notFound ? game.hltb.gameplayMain : 0;
    
    switch (currentFilter) {
      case 'owned':
        return game.is_owned;
      case 'shared':
        return !game.is_owned;
      case 'played':
        return playHours > 0.1;
      case 'unplayed':
        return playHours <= 0.1;
      case 'completed':
        return beatHours > 0 && playHours >= beatHours;
      default:
        return true;
    }
  });
  
  // Sort
  sortGames();
  
  // Render
  renderMobileGrids();
}

function sortGames() {
  filteredGames.sort((a, b) => {
    switch (currentSort) {
      case 'playtime_asc':
        return (a.playtime_forever || 0) - (b.playtime_forever || 0);
      case 'name_asc':
        return a.name.localeCompare(b.name);
      case 'name_desc':
        return b.name.localeCompare(a.name);
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
      default:
        return (b.playtime_forever || 0) - (a.playtime_forever || 0);
    }
  });
}

// Render cards
function renderMobileGrids() {
  mobileNoMatchesView.style.display = 'none';
  
  // 1. Separate "Games in Progress" (played, but main story not beaten yet)
  const inProgress = filteredGames.filter(g => {
    const playHours = (g.playtime_forever || 0) / 60;
    const beatHours = g.hltb && !g.hltb.notFound ? g.hltb.gameplayMain : 0;
    return playHours > 0.1 && beatHours > 0 && playHours < beatHours;
  });
  
  if (inProgress.length > 0 && currentFilter === 'all' && !mobileSearchInput.value) {
    progressGamesSection.style.display = 'block';
    progressGamesGrid.innerHTML = inProgress.slice(0, 3).map((game, idx) => {
      const playHours = ((game.playtime_forever || 0) / 60).toFixed(1);
      const mainHrs = game.hltb.gameplayMain;
      const pct = Math.min(100, Math.round((playHours / mainHrs) * 100));
      const isFocus = idx === 0;
      
      const radius = 18;
      const circ = 2 * Math.PI * radius; // 113.1
      const offset = circ - (pct / 100) * circ;
      
      const imgUrl = `https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/header.jpg`;
      
      return `
        <div class="progress-card ${isFocus ? 'focus-game' : ''}" onclick="openGameDetailsSheet(${game.appid})">
          <div class="progress-card-banner">
            <img src="${imgUrl}" alt="${escapeHtml(game.name)}" loading="lazy">
            <div class="progress-card-banner-overlay"></div>
          </div>
          <div class="progress-card-details">
            <div class="progress-card-top">
              <h4 class="progress-game-title">${escapeHtml(game.name)}</h4>
              <span class="progress-game-hours"><i class="fa-solid fa-clock"></i> ${playHours} hrs played</span>
            </div>
            <div class="progress-card-bottom">
              <span class="progress-hltb-label">HLTB Story: ${mainHrs}h</span>
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
  
  // 2. Render remaining grid
  // Filter out the inProgress items rendered in the progress section to avoid duplicate lists
  let gridGames = filteredGames;
  if (inProgress.length > 0 && currentFilter === 'all' && !mobileSearchInput.value) {
    const progressIds = new Set(inProgress.slice(0, 3).map(g => g.appid));
    gridGames = filteredGames.filter(g => !progressIds.has(g.appid));
  }
  
  if (filteredGames.length === 0) {
    mobileNoMatchesView.style.display = 'flex';
    mobileGamesGrid.innerHTML = '';
    allGamesHeader.style.display = 'none';
    return;
  }
  
  allGamesHeader.style.display = 'block';
  allGamesHeader.textContent = currentFilter === 'all' ? 'YOUR BACKLOG' : `FILTERED: ${currentFilter.toUpperCase()}`;
  
  // Load limited visible batch initially
  const batch = gridGames.slice(0, visibleCardCount);
  mobileGamesGrid.innerHTML = batch.map(game => {
    const playHours = ((game.playtime_forever || 0) / 60).toFixed(1);
    const imgUrl = `https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/header.jpg`;
    
    // Check progress
    let ringHtml = '';
    if (game.hltb && !game.hltb.notFound && game.hltb.gameplayMain > 0) {
      const mainHrs = game.hltb.gameplayMain;
      const pct = Math.min(100, Math.round((playHours / mainHrs) * 100));
      ringHtml = `<span style="font-family: var(--font-mono); font-size: 0.65rem; color: var(--accent-orange-light); font-weight: 700;">${pct}%</span>`;
    }
    
    return `
      <div class="small-card" onclick="openGameDetailsSheet(${game.appid})">
        <div class="small-card-cover">
          <img src="${imgUrl}" alt="${escapeHtml(game.name)}" onerror="handleCoverError(this, '${escapeHtml(game.name)}')" loading="lazy">
        </div>
        <h4 class="small-card-title" title="${escapeHtml(game.name)}">${escapeHtml(game.name)}</h4>
        <div class="small-card-meta">
          <span class="small-card-hours">${playHours}h</span>
          ${ringHtml}
        </div>
      </div>
    `;
  }).join('');
}

// Error handle for cards
function handleCoverError(img, name) {
  const container = img.parentElement;
  const placeholder = document.createElement('div');
  placeholder.className = 'small-card-placeholder';
  placeholder.innerHTML = `<span>${escapeHtml(name)}</span>`;
  img.style.display = 'none';
  container.appendChild(placeholder);
}

// Scroll incremental batch loader
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

// Event Listeners registration
function setupEventListeners() {
  // Search
  mobileSearchInput.addEventListener('input', () => {
    visibleCardCount = BATCH_SIZE;
    handleSearchAndFilter();
  });
  
  // Sort
  mobileSortSelect.addEventListener('change', (e) => {
    currentSort = e.target.value;
    visibleCardCount = BATCH_SIZE;
    handleSearchAndFilter();
  });
  
  // Filter chips click
  filterChips.forEach(chip => {
    chip.addEventListener('click', () => {
      filterChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.getAttribute('data-filter');
      visibleCardCount = BATCH_SIZE;
      handleSearchAndFilter();
    });
  });
  
  // Settings bottom sheet triggers
  document.getElementById('mobile-settings-btn').addEventListener('click', openSettingsSheet);
  document.getElementById('mobile-setup-trigger-btn').addEventListener('click', openSettingsSheet);
  document.getElementById('close-sheet-btn').addEventListener('click', () => {
    mobileSettingsOverlay.style.display = 'none';
  });
  
  // Settings save submit
  mobileSettingsForm.addEventListener('submit', saveSettingsMobile);
  
  // Sync Choices overlay modal triggers
  document.getElementById('mobile-sync-btn').addEventListener('click', () => {
    mobileSyncModal.style.display = 'flex';
  });
  document.getElementById('mobile-empty-sync-btn').addEventListener('click', () => {
    mobileSyncModal.style.display = 'flex';
  });
  document.getElementById('close-sync-sheet-btn').addEventListener('click', () => {
    mobileSyncModal.style.display = 'none';
  });
  
  // Choices bindings
  document.getElementById('mobile-sync-quick-btn').addEventListener('click', () => {
    mobileSyncModal.style.display = 'none';
    startLibrarySyncMobile(false);
  });
  document.getElementById('mobile-sync-force-btn').addEventListener('click', () => {
    mobileSyncModal.style.display = 'none';
    startLibrarySyncMobile(true);
  });
  
  // Details overlays close triggers
  document.getElementById('close-details-btn').addEventListener('click', () => {
    mobileDetailsOverlay.style.display = 'none';
  });
  
  // Dice recommender picker trigger
  document.getElementById('mobile-dice-btn').addEventListener('click', triggerDicePickerMobile);
  document.getElementById('close-dice-sheet-btn').addEventListener('click', () => {
    mobileDiceModal.style.display = 'none';
  });
  document.getElementById('dice-reroll-btn').addEventListener('click', triggerDicePickerMobile);
}

// Settings bottom sheet popup
async function openSettingsSheet() {
  mobileSettingsOverlay.style.display = 'flex';
  const config = await getMobileConfig();
  if (config) {
    settingsApiKey.value = config.STEAM_API_KEY_MASKED || '';
    settingsApiKey.placeholder = config.STEAM_API_KEY_SET ? '••••••••••••••••••••••••••••••••' : 'Enter Steam API Key';
    settingsSteamId.value = config.STEAM_ID || '';
    settingsFamilyIds.value = (config.FAMILY_STEAM_IDS || []).join(', ');
  }
}

// Save mobile settings
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
      FAMILY_STEAM_IDS: familyIds
    };
    
    if (apiKey && !apiKey.includes('•')) {
      configToSave.STEAM_API_KEY = apiKey;
    } else {
      configToSave.STEAM_API_KEY = current.STEAM_API_KEY || '';
    }
    
    configToSave.STEAM_API_KEY_SET = !!configToSave.STEAM_API_KEY;
    configToSave.STEAM_API_KEY_MASKED = configToSave.STEAM_API_KEY ? '••••••••••••••••••••••••••••••••' : '';
    
    await saveMobileConfig(configToSave);
    mobileSettingsOverlay.style.display = 'none';
    
    await fetchLibrary();
  } catch (err) {
    alert(`Failed to save settings: ${err.message}`);
  }
}

// Start mobile sync
async function startLibrarySyncMobile(force) {
  try {
    mobileEmptyView.style.display = 'none';
    mobileGamesGrid.style.display = 'none';
    progressGamesSection.style.display = 'none';
    
    mobileLastSyncTime.textContent = 'Syncing...';
    
    const libraryData = await performMobileSync(force);
    
    games = libraryData.games.map(g => ({
      ...g,
      hltb: g.hltb || null,
      hltbLoading: false,
      hltbError: false
    }));
    
    mobileLastSyncTime.textContent = formatLastSyncTime(libraryData.lastSync);
    
    updateStats();
    handleSearchAndFilter();
    
    // Kickoff HLTB background sync queue
    hltbSyncQueue = games.filter(g => !g.hltb);
    if (hltbSyncQueue.length > 0) {
      mobileSyncHudBadge.style.display = 'flex';
      mobileSyncHudPct.textContent = '0%';
      startHltbSyncMobile();
    }
  } catch (err) {
    alert(`Sync failed: ${err.message}`);
    await fetchLibrary();
  }
}

// HLTB sync pipeline
function startHltbSyncMobile() {
  const workersNeeded = Math.min(MAX_CONCURRENT_SYNC - activeSyncWorkers, hltbSyncQueue.length);
  for (let i = 0; i < workersNeeded; i++) {
    processNextQueueItemMobile();
  }
}

async function processNextQueueItemMobile() {
  if (hltbSyncQueue.length === 0) {
    if (activeSyncWorkers === 0) {
      mobileSyncHudBadge.style.display = 'none';
      updateStats();
      handleSearchAndFilter();
    }
    return;
  }
  
  activeSyncWorkers++;
  const game = hltbSyncQueue.shift();
  
  try {
    const hltbData = await fetchHltbData(game);
    
    const index = games.findIndex(g => g.appid === game.appid);
    if (index !== -1) {
      games[index].hltb = hltbData;
      
      // Save continuously to preference storage
      await saveMobileLibrary({
        games: games,
        lastSync: Date.now()
      });
    }
  } catch (err) {
    console.error(`Failed to get HLTB times for ${game.name}:`, err);
  }
  
  // Progress tracker
  const total = games.length;
  const processed = games.filter(g => g.hltb !== null).length;
  const pct = Math.round((processed / total) * 100);
  mobileSyncHudPct.textContent = `${pct}%`;
  
  updateStats();
  
  activeSyncWorkers--;
  processNextQueueItemMobile();
}

// Open game details modal
function openGameDetailsSheet(appid) {
  const game = games.find(g => g.appid === appid);
  if (!game) return;
  
  document.getElementById('details-game-name').textContent = game.name;
  
  const imgUrl = `https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/header.jpg`;
  document.getElementById('details-game-img').src = imgUrl;
  
  // Owner info
  const ownerBadge = document.getElementById('details-owner-badge');
  ownerBadge.textContent = game.is_owned ? 'Owned' : 'Borrowed';
  ownerBadge.className = `details-owner-badge ${game.is_owned ? 'owned' : 'shared'}`;
  
  // Playtime
  const playHours = ((game.playtime_forever || 0) / 60).toFixed(1);
  document.getElementById('details-playtime-val').textContent = `${playHours} hrs`;
  
  // Beat status
  let beatStatus = 'Not Beaten';
  if (game.hltb && !game.hltb.notFound && game.hltb.gameplayMain > 0) {
    const isBeaten = (game.playtime_forever / 60) >= game.hltb.gameplayMain;
    beatStatus = isBeaten ? 'Beaten 🎉' : 'In Progress ⏳';
  }
  document.getElementById('details-status-val').textContent = beatStatus;
  
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
  
  // Links
  document.getElementById('details-steam-link').href = `https://store.steampowered.com/app/${game.appid}`;
  document.getElementById('details-hltb-link').href = game.hltb && game.hltb.hltbId 
    ? `https://howlongtobeat.com/game/${game.hltb.hltbId}`
    : `https://howlongtobeat.com/?q=${encodeURIComponent(cleanGameTitleForSearch(game.name))}`;
    
  mobileDetailsOverlay.style.display = 'flex';
}

// Trigger suggestion dice roll picker
function triggerDicePickerMobile() {
  if (filteredGames.length === 0) {
    alert('No games match the active filters to pick from!');
    return;
  }
  
  // Pick random game
  const idx = Math.floor(Math.random() * filteredGames.length);
  const game = filteredGames[idx];
  
  const playHours = ((game.playtime_forever || 0) / 60).toFixed(1);
  const mainHrs = game.hltb && !game.hltb.notFound ? `${game.hltb.gameplayMain}h` : 'No HLTB times';
  
  document.getElementById('dice-game-title').textContent = game.name;
  document.getElementById('dice-playtime-val').textContent = `${playHours}h`;
  document.getElementById('dice-hltb-main-val').textContent = mainHrs;
  
  const imgUrl = `https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/header.jpg`;
  document.getElementById('dice-game-img').src = imgUrl;
  
  // Open details click binding
  const openDetailsBtn = document.getElementById('dice-open-details-btn');
  openDetailsBtn.onclick = () => {
    mobileDiceModal.style.display = 'none';
    openGameDetailsSheet(game.appid);
  };
  
  mobileDiceModal.style.display = 'flex';
}

// Escapes special characters
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
