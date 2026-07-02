// State Management
let games = [];
let filteredGames = [];
let currentFilter = 'all';
let currentSort = 'playtime_desc';
let hltbSyncQueue = [];
let activeSyncWorkers = 0;
const MAX_CONCURRENT_SYNC = 4; // limit concurrent HLTB requests to avoid throttling
let visibleCardCount = 40;
const BATCH_SIZE = 40;

// Mobile Environment Detection
const isMobileApp = typeof window !== 'undefined' && window.Capacitor !== undefined && window.Capacitor.Plugins !== undefined && window.Capacitor.Plugins.Preferences !== undefined;

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

// CJK / Punctuation / Digit-boundary cleaner for mobile search queries
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

// Mobile-specific HLTB query executor
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

// Mobile-specific local sync processor
async function performMobileSync(force) {
  if (!isMobileApp) return null;
  const { Preferences, CapacitorHttp } = window.Capacitor.Plugins;
  
  const config = await getMobileConfig();
  if (!config || !config.STEAM_API_KEY || !config.STEAM_ID) {
    throw new Error('Steam API Key or Steam ID is missing in settings.');
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

// Fetch single game HLTB details on mobile or desktop
async function fetchHltbData(game) {
  if (isMobileApp) {
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
  } else {
    const res = await fetch(`/api/hltb?title=${encodeURIComponent(game.name)}`);
    if (!res.ok) throw new Error('HLTB fetch failed');
    return await res.json();
  }
}

// DOM Elements
const configStatus = document.getElementById('config-status');
const statTotalGames = document.getElementById('stat-total-games');
const statTotalPlaytime = document.getElementById('stat-total-playtime');
const statSharedGames = document.getElementById('stat-shared-games');
const statCompletedGames = document.getElementById('stat-completed-games');
const searchInput = document.getElementById('search-input');
const sortSelect = document.getElementById('sort-select');
const filterBtns = document.querySelectorAll('.filter-btn');
const loadingView = document.getElementById('loading-view');
const loadingTitle = document.getElementById('loading-title');
const loadingSubtitle = document.getElementById('loading-subtitle');
const errorView = document.getElementById('error-view');
const errorMessage = document.getElementById('error-message');
const librarySection = document.getElementById('library-section');
const gamesGrid = document.getElementById('games-grid');
const visibleGamesCount = document.getElementById('visible-games-count');
const hltbSyncStatus = document.getElementById('hltb-sync-status');
const hltbSyncPercent = document.getElementById('hltb-sync-percent');
const syncBtn = document.getElementById('sync-btn');
const lastSyncTime = document.getElementById('last-sync-time');
const hideZeroCheckbox = document.getElementById('hide-zero-hours-checkbox');
const hltbTimeCategory = document.getElementById('hltb-time-category');
const hltbMinTime = document.getElementById('hltb-min-time');
const hltbMaxTime = document.getElementById('hltb-max-time');

// Theme and Electron environment: Apply preferences immediately to avoid flash
(function() {
  const saved = localStorage.getItem('theme');
  if (saved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
  
  // Detect if running under Electron
  const isElectron = navigator.userAgent.toLowerCase().includes('electron');
  if (isElectron) {
    document.documentElement.classList.add('is-electron');
  }

  // Disable keyboard zoom (Ctrl+/Ctrl-/Ctrl0) and mouse wheel zoom
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && (e.key === '=' || e.key === '-' || e.key === '+' || e.key === '0')) {
      e.preventDefault();
    }
  });
  window.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
    }
  }, { passive: false });
})();

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  fetchLibrary();
  setupEventListeners();
  initThemeToggle();
});

// Setup Event Listeners
function setupEventListeners() {
  searchInput.addEventListener('input', debounce(handleSearchAndFilter, 250));
  sortSelect.addEventListener('change', (e) => {
    currentSort = e.target.value;
    renderGrid();
  });
  
  filterBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      filterBtns.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentFilter = e.target.dataset.filter;
      handleSearchAndFilter();
    });
  });

  if (syncBtn) {
    syncBtn.addEventListener('click', () => {
      if (games.length > 0) {
        const syncModal = document.getElementById('sync-options-modal');
        if (syncModal) syncModal.style.display = 'flex';
      } else {
        triggerSync(false);
      }
    });
  }

  // Sync Modal listeners
  const closeSyncModalBtn = document.getElementById('close-sync-modal-btn');
  const quickSyncBtn = document.getElementById('quick-sync-btn');
  const fullSyncBtn = document.getElementById('full-sync-btn');
  const syncModal = document.getElementById('sync-options-modal');

  if (closeSyncModalBtn && syncModal) {
    closeSyncModalBtn.addEventListener('click', () => {
      syncModal.style.display = 'none';
    });
  }
  if (quickSyncBtn) {
    quickSyncBtn.addEventListener('click', () => {
      triggerSync(false);
    });
  }
  if (fullSyncBtn) {
    fullSyncBtn.addEventListener('click', () => {
      triggerSync(true);
    });
  }

  if (hideZeroCheckbox) {
    hideZeroCheckbox.addEventListener('change', handleSearchAndFilter);
  }

  if (hltbTimeCategory) hltbTimeCategory.addEventListener('change', handleSearchAndFilter);
  if (hltbMinTime) hltbMinTime.addEventListener('input', debounce(handleSearchAndFilter, 250));
  if (hltbMaxTime) hltbMaxTime.addEventListener('input', debounce(handleSearchAndFilter, 250));

  const toggleControlsBtn = document.getElementById('toggle-controls-btn');
  const controlsSection = document.querySelector('.controls-section');
  if (toggleControlsBtn && controlsSection) {
    toggleControlsBtn.addEventListener('click', () => {
      controlsSection.classList.toggle('collapsed');
      toggleControlsBtn.classList.toggle('expanded');
      const led = toggleControlsBtn.querySelector('.toggle-led');
      if (led) {
        led.classList.toggle('active');
      }
    });
  }

  // Settings Modal Listeners
  const settingsBtn = document.getElementById('settings-btn');
  const closeSettingsBtn = document.getElementById('close-settings-btn');
  const settingsModal = document.getElementById('settings-modal');
  const settingsForm = document.getElementById('settings-form');
  
  if (settingsBtn && settingsModal) {
    settingsBtn.addEventListener('click', openSettingsModal);
  }
  if (closeSettingsBtn && settingsModal) {
    closeSettingsBtn.addEventListener('click', () => {
      settingsModal.style.display = 'none';
    });
  }
  if (settingsForm) {
    settingsForm.addEventListener('submit', handleSettingsSave);
  }

  // Suggest Next Game Listener
  const suggestNextBtn = document.getElementById('suggest-next-btn');
  if (suggestNextBtn) {
    suggestNextBtn.addEventListener('click', suggestNextGame);
  }

  // Detail Panel Listeners
  const closeDetailBtn = document.getElementById('close-detail-btn');
  const panelOverlay = document.getElementById('panel-overlay');
  const detailPanel = document.getElementById('game-detail-panel');
  
  if (closeDetailBtn && detailPanel) {
    closeDetailBtn.addEventListener('click', closeGameDetail);
  }
  if (panelOverlay && detailPanel) {
    panelOverlay.addEventListener('click', closeGameDetail);
  }

  // Close modals on Escape key
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (settingsModal) settingsModal.style.display = 'none';
      if (syncModal) syncModal.style.display = 'none';
      closeGameDetail();
    }
  });

  // Infinite scroll listener to load games in batches as user scrolls down
  window.addEventListener('scroll', () => {
    if ((window.innerHeight + window.scrollY) >= (document.documentElement.scrollHeight - 300)) {
      loadNextGamesBatch();
    }
  });
}

// Theme Toggle: Switch between light (Y2K Aero) and dark (Retro Pixel)
function initThemeToggle() {
  const toggleBtn = document.getElementById('capsule-theme-toggle');
  if (!toggleBtn) return;

  // Set correct aria state on load
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  toggleBtn.setAttribute('aria-checked', isDark ? 'true' : 'false');

  toggleBtn.addEventListener('click', () => {
    const currentlyDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (currentlyDark) {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('theme', 'light');
      toggleBtn.setAttribute('aria-checked', 'false');
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
      toggleBtn.setAttribute('aria-checked', 'true');
    }
  });

  // Allow keyboard toggling
  toggleBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleBtn.click();
    }
  });
}

// Format Last Sync Time into relative/absolute format
function formatLastSyncTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return `Last synced: ${date.toLocaleString()}`;
}

// Trigger Steam API Sync and import games
async function triggerSync(force = false) {
  if (!syncBtn) return;
  
  // Close the sync options modal if open
  const syncModal = document.getElementById('sync-options-modal');
  if (syncModal) syncModal.style.display = 'none';
  
  // Disable button and controls while syncing
  syncBtn.disabled = true;
  const originalHtml = syncBtn.innerHTML;
  syncBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i> Syncing...';
  
  const isInitialSync = games.length === 0;
  if (isInitialSync) {
    loadingView.style.display = 'flex';
    loadingTitle.textContent = 'Syncing Steam Library...';
    loadingSubtitle.textContent = 'Contacting Steam Web APIs and importing games list';
    librarySection.style.display = 'none';
    errorView.style.display = 'none';
  }
  
  try {
    let data;
    if (isMobileApp) {
      data = await performMobileSync(force);
    } else {
      const res = await fetch('/api/sync', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to sync with Steam.');
      }
      data = await res.json();
    }
    
    // Map new games list and keep existing client-side HLTB cache if available
    const existingHltbMap = new Map();
    if (!force) {
      games.forEach(g => {
        if (g.hltb) {
          existingHltbMap.set(g.appid, g.hltb);
        }
      });
    }
    
    games = data.games.map(game => ({
      ...game,
      hltb: existingHltbMap.get(game.appid) || game.hltb || null,
      hltbLoading: false,
      hltbError: false
    }));
    
    // Update last sync text
    if (lastSyncTime) {
      lastSyncTime.textContent = formatLastSyncTime(data.lastSync);
      lastSyncTime.style.display = 'inline';
    }
    
    // Re-enable search controls
    searchInput.disabled = false;
    sortSelect.disabled = false;
    if (hideZeroCheckbox) hideZeroCheckbox.disabled = false;
    if (hltbTimeCategory) hltbTimeCategory.disabled = false;
    if (hltbMinTime) hltbMinTime.disabled = false;
    if (hltbMaxTime) hltbMaxTime.disabled = false;
    
    // Hide loader, show library
    loadingView.style.display = 'none';
    librarySection.style.display = 'block';
    
    // Update UI
    updateStats();
    handleSearchAndFilter();
    
    // Trigger HLTB sync queue
    startHltbSync();
    
  } catch (err) {
    console.error('Sync failed:', err);
    alert(`Sync failed: ${err.message || 'Check server logs.'}`);
    
    if (isInitialSync) {
      loadingView.style.display = 'none';
      errorView.style.display = 'flex';
      errorMessage.textContent = err.message || 'Sync failed. Verify config.json.';
    }
  } finally {
    // Restore button state
    syncBtn.disabled = false;
    syncBtn.innerHTML = originalHtml;
  }
}

// Fetch Games from Local Server API
async function fetchLibrary() {
  try {
    // Show spinner initially
    loadingView.style.display = 'flex';
    loadingTitle.textContent = 'Loading library...';
    loadingSubtitle.textContent = 'Fetching games list from local database';
    
    let data;
    if (isMobileApp) {
      const mobileConfig = await getMobileConfig();
      if (!mobileConfig || !mobileConfig.STEAM_API_KEY || !mobileConfig.STEAM_ID) {
        throw new Error('Steam credentials are not configured.');
      }
      data = await getMobileLibrary();
    } else {
      const res = await fetch('/api/games');
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to fetch library.');
      }
      data = await res.json();
    }
    
    // Set up status badge
    configStatus.className = 'status-badge status-connected';
    configStatus.innerHTML = '<i class="fa-solid fa-circle-check"></i> Connected to Steam';
    
    // Show sync button since we are connected
    if (syncBtn) {
      syncBtn.style.display = 'inline-flex';
    }
    
    // Set up last sync text if available
    if (data.lastSync > 0) {
      if (lastSyncTime) {
        lastSyncTime.textContent = formatLastSyncTime(data.lastSync);
        lastSyncTime.style.display = 'inline';
      }
    } else {
      if (lastSyncTime) {
        lastSyncTime.style.display = 'none';
      }
    }
    
    games = data.games.map(game => ({
      ...game,
      hltb: game.hltb || null,
      hltbLoading: false,
      hltbError: false
    }));

    // Hide initial page loader
    loadingView.style.display = 'none';
    librarySection.style.display = 'block';

    if (data.lastSync === 0 && games.length === 0) {
      // Library is empty and not synced yet. Disable inputs, display instructions
      searchInput.disabled = true;
      sortSelect.disabled = true;
      if (hideZeroCheckbox) hideZeroCheckbox.disabled = true;
      if (hltbTimeCategory) hltbTimeCategory.disabled = true;
      if (hltbMinTime) hltbMinTime.disabled = true;
      if (hltbMaxTime) hltbMaxTime.disabled = true;
      updateStats();
      
      gamesGrid.innerHTML = `
        <div class="status-view" style="grid-column: 1 / -1; padding: 4rem 2rem;">
          <i class="fa-solid fa-cloud-arrow-down" style="font-size: 3rem; color: var(--steam-light-blue); margin-bottom: 1rem; opacity: 0.8;"></i>
          <h3 style="font-family: var(--font-display); font-size: 1.5rem; margin-bottom: 0.5rem;">Library Not Synced</h3>
          <p style="color: var(--text-secondary); max-width: 450px; margin: 0 auto 1.5rem auto; line-height: 1.5;">Your local library database is empty. Click the <strong>Sync Library</strong> button in the top right to import your games from Steam.</p>
          <button class="retry-btn" onclick="triggerSync()" style="margin: 0 auto;"><i class="fa-solid fa-arrows-rotate"></i> Sync Library Now</button>
        </div>
      `;
      visibleGamesCount.textContent = '0';
      hltbSyncStatus.style.display = 'none';
    } else {
      // Enable controls
      searchInput.disabled = false;
      sortSelect.disabled = false;
      if (hideZeroCheckbox) hideZeroCheckbox.disabled = false;
      if (hltbTimeCategory) hltbTimeCategory.disabled = false;
      if (hltbMinTime) hltbMinTime.disabled = false;
      if (hltbMaxTime) hltbMaxTime.disabled = false;
      
      // Compute stats
      updateStats();
      
      // Run initial search/filter
      handleSearchAndFilter();
      
      // NOTE: Do NOT call startHltbSync() here.
      // HLTB data is loaded from the server's db.json cache.
      // A fresh HLTB sync only runs when the user explicitly clicks "Sync Library".
    }
  } catch (err) {
    console.error('Error fetching library:', err);
    configStatus.className = 'status-badge status-error';
    configStatus.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> Connection Error';
    if (isMobileApp) {
      errorMessage.textContent = 'Could not fetch Steam library. Please configure your Steam API Key and Steam ID.';
      const helpBox = document.querySelector('#error-view .help-box');
      if (helpBox) {
        helpBox.innerHTML = `
          <h3>How to get started:</h3>
          <ol>
            <li>Tap the <strong>Gear Icon</strong> (<i class="fa-solid fa-gear"></i>) in the top-right corner.</li>
            <li>Enter your <strong>Steam API Key</strong> and <strong>Steam ID</strong>.</li>
            <li>Tap <strong>Save Settings</strong>.</li>
            <li>Tap <strong>Sync Library</strong> in the header to import your games!</li>
          </ol>
        `;
      }
    } else {
      errorMessage.textContent = err.message || 'Could not connect to server or Steam API.';
    }
    loadingView.style.display = 'none';
    errorView.style.display = 'flex';
  }
}


// Update Dashboard Statistics
function updateStats() {
  statTotalGames.textContent = games.length;
  
  // Total playtime
  const totalPlaytimeMins = games.reduce((sum, g) => sum + (g.playtime_forever || 0), 0);
  const totalHours = Math.round(totalPlaytimeMins / 60);
  statTotalPlaytime.textContent = `${totalHours.toLocaleString()}h`;
  
  // Shared games
  const sharedCount = games.filter(g => !g.is_owned).length;
  statSharedGames.textContent = sharedCount;
  
  // Completed games based on HLTB
  const completedCount = games.filter(g => {
    if (!g.hltb || g.hltb.notFound) return false;
    const playHours = (g.playtime_forever || 0) / 60;
    const storyHours = g.hltb.gameplayMain || 0;
    return playHours > 0 && storyHours > 0 && playHours >= storyHours;
  }).length;
  statCompletedGames.textContent = completedCount;

  // Update insights
  computeInsights();
}

// Handle Search and Filter logic combined
function handleSearchAndFilter() {
  const query = searchInput.value.toLowerCase().trim();
  
  filteredGames = games.filter(game => {
    // 1. Text Search Filter
    const matchesSearch = game.name.toLowerCase().includes(query);
    if (!matchesSearch) return false;
    
    // 2. Button Filters
    const playHours = (game.playtime_forever || 0) / 60;
    let passButtonFilter = true;
    switch (currentFilter) {
      case 'owned':
        passButtonFilter = game.is_owned;
        break;
      case 'shared':
        passButtonFilter = !game.is_owned;
        break;
      case 'played':
        passButtonFilter = game.playtime_forever > 0;
        break;
      case 'unplayed':
        passButtonFilter = game.playtime_forever === 0;
        break;
      case 'completed':
        if (!game.hltb || game.hltb.notFound) {
          passButtonFilter = false;
        } else {
          passButtonFilter = playHours > 0 && game.hltb.gameplayMain > 0 && playHours >= game.hltb.gameplayMain;
        }
        break;
      default:
        passButtonFilter = true;
        break;
    }
    if (!passButtonFilter) return false;
    
    // 3. Hide 0h HLTB Checkbox Filter
    const hideZero = hideZeroCheckbox && hideZeroCheckbox.checked;
    if (hideZero) {
      const hasHltbTimes = game.hltb && !game.hltb.notFound && (
        (game.hltb.gameplayMain || 0) > 0 ||
        (game.hltb.gameplayMainExtra || 0) > 0 ||
        (game.hltb.gameplayCompletionist || 0) > 0
      );
      if (!hasHltbTimes) return false;
    }
    
    // 4. Time Range Filter
    if (hltbTimeCategory && hltbMinTime && hltbMaxTime) {
      const minVal = parseFloat(hltbMinTime.value);
      const maxVal = parseFloat(hltbMaxTime.value);
      
      // If either min or max is provided, we filter
      if (!isNaN(minVal) || !isNaN(maxVal)) {
        if (!game.hltb || game.hltb.notFound) return false;
        
        let targetTime = 0;
        switch (hltbTimeCategory.value) {
          case 'main':
            targetTime = game.hltb.gameplayMain || 0;
            break;
          case 'extra':
            targetTime = game.hltb.gameplayMainExtra || 0;
            break;
          case 'completionist':
            targetTime = game.hltb.gameplayCompletionist || 0;
            break;
        }
        
        // If the game has 0 hours for this category and a filter is active, hide it
        if (targetTime === 0) return false;
        
        if (!isNaN(minVal) && targetTime < minVal) return false;
        if (!isNaN(maxVal) && targetTime > maxVal) return false;
      }
    }
    
    return true;
  });
  
  visibleGamesCount.textContent = filteredGames.length;
  renderGrid();
}

// Render Games Grid
function renderGrid() {
  // Sort games list
  sortGames(filteredGames);
  
  if (filteredGames.length === 0) {
    gamesGrid.innerHTML = `
      <div class="status-view" style="grid-column: 1 / -1; padding: 3rem;">
        <i class="fa-solid fa-folder-open" style="font-size: 2.5rem; color: var(--text-muted);"></i>
        <h3>No games match the criteria</h3>
        <p>Try clearing your search or filters.</p>
        <p>THE APP IS STILL IN BETA</p>
      </div>
    `;
    return;
  }
  
  // Reset scroll page limit for new renders
  visibleCardCount = BATCH_SIZE;
  
  // Render only the first batch of games
  const batch = filteredGames.slice(0, visibleCardCount);
  gamesGrid.innerHTML = batch.map(game => createCardHtml(game)).join('');
}

// Load the next batch of games for infinite scrolling
function loadNextGamesBatch() {
  if (visibleCardCount >= filteredGames.length) return;
  
  const nextBatch = filteredGames.slice(visibleCardCount, visibleCardCount + BATCH_SIZE);
  visibleCardCount += BATCH_SIZE;
  
  // Create elements and append
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = nextBatch.map(game => createCardHtml(game)).join('');
  
  while (tempDiv.firstChild) {
    gamesGrid.appendChild(tempDiv.firstChild);
  }
}

// Client Side Game Cover Fallback Generator
function handleImageError(img, name) {
  const container = img.parentElement;
  // Replace the image with a gorgeous gradient placeholder
  const placeholder = document.createElement('div');
  placeholder.className = 'game-cover-placeholder';
  placeholder.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, #1d2636 0%, #0f141d 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    text-align: center;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  `;
  placeholder.innerHTML = `
    <span style="
      font-family: var(--font-display);
      font-weight: 700;
      font-size: 0.9rem;
      color: var(--text-secondary);
      line-height: 1.3;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    ">${name}</span>
  `;
  img.remove();
  container.appendChild(placeholder);
}

// Sort Algorithm
function sortGames(list) {
  list.sort((a, b) => {
    switch (currentSort) {
      case 'playtime_desc':
        return (b.playtime_forever || 0) - (a.playtime_forever || 0);
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
      case 'hltb_completionist_asc': {
        const tA = a.hltb && !a.hltb.notFound ? a.hltb.gameplayCompletionist : Infinity;
        const tB = b.hltb && !b.hltb.notFound ? b.hltb.gameplayCompletionist : Infinity;
        return tA - tB;
      }
      case 'hltb_completionist_desc': {
        const tA = a.hltb && !a.hltb.notFound ? a.hltb.gameplayCompletionist : -Infinity;
        const tB = b.hltb && !b.hltb.notFound ? b.hltb.gameplayCompletionist : -Infinity;
        return tB - tA;
      }
      default:
        return 0;
    }
  });
}

// HLTB Queue-based Syncing
function startHltbSync() {
  // Push games that don't have HLTB data yet to sync queue
  hltbSyncQueue = games.filter(g => !g.hltb);
  
  if (hltbSyncQueue.length === 0) {
    hltbSyncStatus.style.display = 'none';
    updateStats();
    return;
  }
  
  // Sort queue so played games get HLTB data first (prioritize what the user plays!)
  hltbSyncQueue.sort((a, b) => (b.playtime_forever || 0) - (a.playtime_forever || 0));
  
  hltbSyncStatus.style.display = 'flex';
  updateSyncProgress();
  
  // Spawn workers up to MAX_CONCURRENT_SYNC, taking into account already active workers
  const targetWorkers = Math.min(MAX_CONCURRENT_SYNC, hltbSyncQueue.length);
  const workersNeeded = targetWorkers - activeSyncWorkers;
  for (let i = 0; i < workersNeeded; i++) {
    processNextQueueItem();
  }
}

async function processNextQueueItem() {
  if (hltbSyncQueue.length === 0) {
    if (activeSyncWorkers === 0) {
      // Completed all syncing
      updateStats();
      updateSyncProgress();
    }
    return;
  }
  
  activeSyncWorkers++;
  const game = hltbSyncQueue.shift();
  
  // Mark game as loading
  game.hltbLoading = true;
  updateGameInUI(game);
  
  try {
    const hltbData = await fetchHltbData(game);
    
    game.hltb = hltbData;
    game.hltbLoading = false;
    
    if (isMobileApp) {
      await saveMobileLibrary({
        games: games,
        lastSync: Date.now()
      });
    }
  } catch (err) {
    console.error(`Failed to get HLTB for ${game.name}:`, err);
    game.hltbError = true;
    game.hltbLoading = false;
  }
  
  // Refresh card in UI and global stats
  updateGameInUI(game);
  updateStats();
  updateSyncProgress();
  
  activeSyncWorkers--;
  
  // Fetch next item
  // Add a small delay (e.g. 150ms) to spacing out HLTB request rates
  setTimeout(processNextQueueItem, 150);
}

function updateSyncProgress() {
  const total = games.length;
  const processed = total - hltbSyncQueue.length - activeSyncWorkers;
  const percent = total > 0 ? Math.round((processed / total) * 100) : 100;
  
  if (percent < 100) {
    hltbSyncStatus.innerHTML = `<i class="fa-solid fa-arrows-spin fa-spin"></i> HLTB syncing: <span id="hltb-sync-percent">${percent}%</span>`;
  } else {
    hltbSyncStatus.innerHTML = '<i class="fa-solid fa-check"></i> HLTB synced';
    setTimeout(() => {
      if (hltbSyncQueue.length === 0 && activeSyncWorkers === 0) {
        hltbSyncStatus.style.display = 'none';
      }
    }, 3000);
  }
}

// Update a single game card in the DOM without rebuilding the whole grid
function updateGameInUI(game) {
  // Update state in main game array
  const index = games.findIndex(g => g.appid === game.appid);
  if (index !== -1) {
    games[index] = game;
  }
  
  // Find card in DOM
  const card = document.querySelector(`.game-card[data-appid="${game.appid}"]`);
  
  // If we have finished loading HLTB data and need to re-run filter based on checkbox
  if (game.hltb && !game.hltbLoading) {
    const hideZero = hideZeroCheckbox && hideZeroCheckbox.checked;
    const hasHltbTimes = !game.hltb.notFound && (
      (game.hltb.gameplayMain || 0) > 0 ||
      (game.hltb.gameplayMainExtra || 0) > 0 ||
      (game.hltb.gameplayCompletionist || 0) > 0
    );
    
    if (hideZero) {
      if (!hasHltbTimes && card) {
        // Game has 0 hours but card is visible: re-run search/filter to hide it
        handleSearchAndFilter();
        return;
      } else if (hasHltbTimes && !card) {
        // Game has >0 hours but card is hidden: re-run search/filter to show it
        handleSearchAndFilter();
        return;
      }
    }
  }
  
  if (!card) return;
  
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = createCardHtml(game).trim();
  const newCard = tempDiv.firstChild;
  card.replaceWith(newCard);
}

// Helpers
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

const ENDLESS_GAMES_BLOCKLIST = [
  'team fortress 2',
  'counter-strike',
  'counter-strike 2',
  'counter-strike: global offensive',
  'dota 2',
  'pubg: battlegrounds',
  'apex legends',
  'destiny 2',
  'warframe',
  'rust',
  'garry\'s mod',
  'gmod',
  'left 4 dead',
  'left 4 dead 2',
  'dead by daylight',
  'payday 2',
  'payday 3',
  'valorant',
  'league of legends',
  'world of warcraft',
  'overwatch',
  'overwatch 2',
  'tft',
  'teamfight tactics',
  'hearthstone',
  'brawlhalla',
  'rocket league',
  'smite',
  'paladins',
  'vrchat',
  'terraria',
  'minecraft',
  'subnautica',
  'factorio',
  'satisfactory',
  'rimworld',
  'civilization v',
  'civilization vi',
  'sid meier\'s civilization',
  'hearts of iron iv',
  'stellaris',
  'crusader kings iii',
  'europa universalis iv',
  'the sims',
  'the sims 3',
  'the sims 4',
  'stardew valley',
  'cities: skylines',
  'cities: skylines ii',
  'euro truck simulator 2',
  'american truck simulator',
  'assetto corsa',
  'iracing',
  'dead island',
  'dead island 2',
  'killing floor',
  'killing floor 2'
];

function isEndlessOrMultiplayer(gameName) {
  const nameLower = gameName.toLowerCase().trim();
  
  if (ENDLESS_GAMES_BLOCKLIST.some(blocked => nameLower === blocked || nameLower.includes(blocked))) {
    return true;
  }
  
  const keywords = [
    'dedicated server', 
    'test server', 
    'public test', 
    'beta', 
    'demo', 
    'benchmarking', 
    'tool', 
    'sdk',
    'soundtrack',
    'multiplayer'
  ];
  if (keywords.some(kw => nameLower.includes(kw))) {
    return true;
  }
  
  return false;
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Generates game card HTML with owner badge, beat status, and HLTB completion ring
function createCardHtml(game) {
  const playHours = ((game.playtime_forever || 0) / 60).toFixed(1);
  
  // Check if beaten
  let isBeaten = false;
  if (game.hltb && !game.hltb.notFound && game.hltb.gameplayMain > 0) {
    isBeaten = (game.playtime_forever / 60) >= game.hltb.gameplayMain;
  }
  
  // Image element
  const imgUrl = game.appid 
    ? `https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/header.jpg`
    : '';
    
  // Badges
  const ownerBadge = game.is_owned 
    ? `<span class="owner-badge owned"><i class="fa-solid fa-user"></i> Owned</span>`
    : `<span class="owner-badge shared"><i class="fa-solid fa-people-group"></i> Borrowed</span>`;
    
  // Calculate progress ring
  let progressRingHtml = '';
  if (game.hltb && !game.hltb.notFound && game.hltb.gameplayMain > 0) {
    const playHrs = (game.playtime_forever || 0) / 60;
    const mainHrs = game.hltb.gameplayMain;
    const pct = Math.min(100, Math.round((playHrs / mainHrs) * 100));
    
    const radius = 13;
    const circumference = 2 * Math.PI * radius; // ~81.68
    const strokeDashoffset = circumference - (pct / 100) * circumference;
    
    let ringClass = 'ring-started';
    if (pct >= 100) {
      ringClass = 'ring-completed';
    } else if (pct >= 50) {
      ringClass = 'ring-half';
    }
    
    const ringText = pct >= 100 ? '<i class="fa-solid fa-check" style="color: #166534;"></i>' : `${pct}%`;
    
    progressRingHtml = `
      <div class="progress-ring-badge ${ringClass}" title="Completion: ${pct}%" onclick="event.stopPropagation(); openGameDetail(${game.appid});">
        <svg width="34" height="34">
          <circle class="ring-track" cx="17" cy="17" r="13"></circle>
          <circle class="ring-fill" cx="17" cy="17" r="13" 
            stroke-dasharray="${circumference}" 
            stroke-dashoffset="${strokeDashoffset}"></circle>
        </svg>
        <span class="ring-text">${ringText}</span>
      </div>
    `;
  }
  
  // HLTB Content
  let hltbContent = '';
  if (game.hltbLoading) {
    hltbContent = `
      <div class="hltb-loading-placeholder">
        <i class="fa-solid fa-circle-notch fa-spin"></i>
        <span>Retrieving times...</span>
      </div>
    `;
  } else if (game.hltbError) {
    hltbContent = `
      <div class="hltb-not-found">
        <i class="fa-solid fa-circle-exclamation"></i> HLTB error
      </div>
    `;
  } else if (game.hltb === null) {
    hltbContent = `
      <div class="hltb-not-found">
        <i class="fa-solid fa-circle-minus"></i> No HLTB data
      </div>
    `;
  } else if (game.hltb.notFound) {
    hltbContent = `
      <div class="hltb-not-found">
        <i class="fa-solid fa-ban"></i> No HLTB times found
      </div>
    `;
  } else {
    hltbContent = `
      <div class="hltb-grid">
        <div class="hltb-metric main" title="Main Story">
          <span class="metric-label">Main</span>
          <span class="metric-value">${game.hltb.gameplayMain}h</span>
        </div>
        <div class="hltb-metric extra" title="Main + Extra Content">
          <span class="metric-label">Extra</span>
          <span class="metric-value">${game.hltb.gameplayMainExtra}h</span>
        </div>
        <div class="hltb-metric completionist" title="100% Completionist">
          <span class="metric-label">100%</span>
          <span class="metric-value">${game.hltb.gameplayCompletionist}h</span>
        </div>
      </div>
    `;
  }

  return `
    <div class="game-card ${isBeaten ? 'beaten' : ''}" data-appid="${game.appid}" onclick="openGameDetail(${game.appid})">
      ${ownerBadge}
      <div class="card-screw screw-bl"></div>
      <div class="card-screw screw-br"></div>
      <div class="card-header-img">
        <img src="${imgUrl}" alt="${escapeHtml(game.name)}" loading="lazy" onerror="handleImageError(this, '${escapeHtml(game.name)}')">
        <span class="playtime-badge"><i class="fa-solid fa-clock"></i> ${playHours} hrs</span>
        ${progressRingHtml}
      </div>
      <div class="card-content">
        <h3 class="game-title" title="${escapeHtml(game.name)}">${escapeHtml(game.name)}</h3>
        ${hltbContent}
      </div>
    </div>
  `;
}

// Compute and render insights panel data
function computeInsights() {
  const insightsSection = document.getElementById('insights-section');
  if (!insightsSection) return;
  
  if (games.length === 0) {
    insightsSection.style.display = 'none';
    return;
  }
  
  insightsSection.style.display = 'block';
  
  // 1. Backlog Games & Hours (Owned games that are not completed or unplayed)
  const backlogGames = games.filter(g => {
    if (!g.is_owned) return false;
    if (isEndlessOrMultiplayer(g.name)) return false;
    if (!g.hltb || g.hltb.notFound) return g.playtime_forever === 0;
    const playHours = (g.playtime_forever || 0) / 60;
    return playHours < (g.hltb.gameplayMain || 1);
  });
  
  const backlogCount = backlogGames.length;
  const backlogHours = Math.round(backlogGames.reduce((sum, g) => {
    const playHours = (g.playtime_forever || 0) / 60;
    const hltbHours = (g.hltb && !g.hltb.notFound) ? (g.hltb.gameplayMain || 0) : 0;
    const remaining = Math.max(0, hltbHours - playHours);
    return sum + (remaining || 10); // default to 10h if no HLTB data
  }, 0));
  
  document.getElementById('insight-backlog-games').textContent = `${backlogCount} Games`;
  document.getElementById('insight-backlog-hours').textContent = `${backlogHours.toLocaleString()}h remaining`;
  
  // 2. Clearance Estimate (At average of 5 hours per week)
  const hrsPerWeek = 5;
  const weeksToClear = backlogHours / hrsPerWeek;
  const monthsToClear = Math.ceil(weeksToClear / 4.33);
  
  let clearText = '-';
  if (backlogHours === 0) {
    clearText = 'Backlog cleared!';
  } else if (monthsToClear < 1) {
    clearText = '< 1 month';
  } else if (monthsToClear === 1) {
    clearText = '1 month';
  } else {
    clearText = `~${monthsToClear} months`;
  }
  document.getElementById('insight-clear-time').textContent = clearText;
  
  // 3. Neglected Backlog Gem (Owned game, 0 playtime, longest HLTB gameplayMain)
  const unplayedOwned = games.filter(g => g.is_owned && (g.playtime_forever || 0) === 0 && g.hltb && !g.hltb.notFound && g.hltb.gameplayMain > 0 && !isEndlessOrMultiplayer(g.name));
  const gemElement = document.getElementById('insight-neglected-name');
  if (unplayedOwned.length > 0) {
    unplayedOwned.sort((a, b) => b.hltb.gameplayMain - a.hltb.gameplayMain);
    const gem = unplayedOwned[0];
    gemElement.textContent = gem.name;
    gemElement.title = `Click to view details for ${gem.name}`;
    gemElement.className = 'insight-clickable-link';
    gemElement.onclick = () => openGameDetail(gem.appid);
    document.getElementById('insight-neglected-time').textContent = `${gem.hltb.gameplayMain}h main story`;
  } else {
    gemElement.textContent = 'None found';
    gemElement.className = '';
    gemElement.onclick = null;
    gemElement.title = '';
    document.getElementById('insight-neglected-time').textContent = 'All owned games played!';
  }
}

// Suggest a random backlog game weighted by shortest HLTB time (gamification!)
function suggestNextGame() {
  const backlogGames = filteredGames.filter(g => {
    if (!g.is_owned) return false;
    if (isEndlessOrMultiplayer(g.name)) return false;
    const playHours = (g.playtime_forever || 0) / 60;
    const isCompleted = g.hltb && !g.hltb.notFound && playHours >= g.hltb.gameplayMain;
    return !isCompleted && g.hltb && !g.hltb.notFound && g.hltb.gameplayMain > 0;
  });
  
  const resultDiv = document.getElementById('suggestion-result');
  const btn = document.getElementById('suggest-next-btn');
  
  if (backlogGames.length === 0) {
    btn.textContent = 'No options!';
    resultDiv.style.display = 'none';
    return;
  }
  
  // Weighted selection: weight = 100 / gameplayMain (shorter games have higher weight)
  let totalWeight = 0;
  const weightedList = backlogGames.map(g => {
    const weight = 100 / (g.hltb.gameplayMain || 1);
    totalWeight += weight;
    return { game: g, weight };
  });
  
  let randomVal = Math.random() * totalWeight;
  let selected = backlogGames[0];
  
  for (const item of weightedList) {
    randomVal -= item.weight;
    if (randomVal <= 0) {
      selected = item.game;
      break;
    }
  }
  
  if (selected) {
    const nameElement = document.getElementById('suggested-game-name');
    nameElement.textContent = selected.name;
    nameElement.title = `Click to view details for ${selected.name}`;
    nameElement.className = 'insight-clickable-link';
    nameElement.onclick = () => openGameDetail(selected.appid);
    
    document.getElementById('suggested-game-time').textContent = `Main Story: ${selected.hltb.gameplayMain}h`;
    
    btn.textContent = 'Roll Again 🎲';
    resultDiv.style.display = 'block';
  }
}

// Settings Modal functions
async function openSettingsModal() {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;
  
  modal.style.display = 'flex';
  
  try {
    let data;
    if (isMobileApp) {
      data = await getMobileConfig() || {};
    } else {
      const res = await fetch('/api/config');
      if (!res.ok) throw new Error('Failed to fetch settings');
      data = await res.json();
    }
    
    const apiKeyInput = document.getElementById('settings-api-key');
    const steamIdInput = document.getElementById('settings-steam-id');
    const familyIdsInput = document.getElementById('settings-family-ids');
    
    if (apiKeyInput) {
      apiKeyInput.value = data.STEAM_API_KEY_MASKED || '';
      apiKeyInput.placeholder = data.STEAM_API_KEY_SET ? '••••••••••••••••••••••••••••••••' : 'Enter Steam Web API Key';
    }
    if (steamIdInput) {
      steamIdInput.value = data.STEAM_ID || '';
    }
    if (familyIdsInput) {
      familyIdsInput.value = (data.FAMILY_STEAM_IDS || []).join(', ');
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

async function handleSettingsSave(e) {
  e.preventDefault();
  
  const apiKey = document.getElementById('settings-api-key').value.trim();
  const steamId = document.getElementById('settings-steam-id').value.trim();
  const familyIdsStr = document.getElementById('settings-family-ids').value.trim();
  
  const familyIds = familyIdsStr ? familyIdsStr.split(',').map(id => id.trim()).filter(Boolean) : [];
  
  const saveBtn = document.getElementById('save-settings-btn');
  const originalHtml = saveBtn.innerHTML;
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';
  
  try {
    const payload = {
      STEAM_ID: steamId,
      FAMILY_STEAM_IDS: familyIds
    };
    
    if (apiKey && !apiKey.includes('•')) {
      payload.STEAM_API_KEY = apiKey;
    }
    
    if (isMobileApp) {
      const currentConfig = await getMobileConfig() || {};
      const finalPayload = {
        ...payload,
        STEAM_API_KEY: payload.STEAM_API_KEY || currentConfig.STEAM_API_KEY || ''
      };
      finalPayload.STEAM_API_KEY_SET = !!finalPayload.STEAM_API_KEY;
      finalPayload.STEAM_API_KEY_MASKED = finalPayload.STEAM_API_KEY ? '••••••••••••••••••••••••••••••••' : '';
      
      await saveMobileConfig(finalPayload);
      document.getElementById('settings-modal').style.display = 'none';
      fetchLibrary();
    } else {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save settings');
      }
      
      document.getElementById('settings-modal').style.display = 'none';
      fetchLibrary();
    }
  } catch (err) {
    console.error('Failed to save settings:', err);
    alert(`Failed to save settings: ${err.message}`);
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = originalHtml;
  }
}

// Game Detail slide-out functions
function openGameDetail(appid) {
  const game = games.find(g => g.appid === Number(appid));
  if (!game) return;
  
  const panel = document.getElementById('game-detail-panel');
  const overlay = document.getElementById('panel-overlay');
  if (!panel || !overlay) return;
  
  const imgUrl = game.appid 
    ? `https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/header.jpg`
    : '';
  
  document.getElementById('detail-cover').src = imgUrl;
  document.getElementById('detail-cover').onerror = function() {
    this.src = '';
    this.style.display = 'none';
    let textFallback = this.nextElementSibling;
    if (!textFallback || !textFallback.classList.contains('detail-cover-fallback')) {
      textFallback = document.createElement('div');
      textFallback.className = 'detail-cover-fallback';
      textFallback.style.cssText = `
        height: 120px;
        background: linear-gradient(135deg, #1d2636 0%, #0f141d 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: var(--font-display);
        font-weight: 700;
        color: var(--text-secondary);
        padding: 1rem;
        text-align: center;
      `;
      this.parentElement.appendChild(textFallback);
    }
    textFallback.textContent = game.name;
    textFallback.style.display = 'flex';
  };
  
  const fallback = document.querySelector('.detail-cover-fallback');
  if (fallback) fallback.style.display = 'none';
  document.getElementById('detail-cover').style.display = 'block';
  
  const playHours = ((game.playtime_forever || 0) / 60).toFixed(1);
  document.getElementById('detail-playtime-badge').innerHTML = `<i class="fa-solid fa-clock"></i> ${playHours} hrs`;
  document.getElementById('detail-title').textContent = game.name;
  
  const ownerBadgeContainer = document.getElementById('detail-owner-badge');
  ownerBadgeContainer.innerHTML = game.is_owned 
    ? `<span class="owner-badge owned"><i class="fa-solid fa-user"></i> Owned</span>`
    : `<span class="owner-badge shared"><i class="fa-solid fa-people-group"></i> Borrowed</span>`;
    
  if (!game.is_owned) {
    const ownerSubtext = document.createElement('span');
    ownerSubtext.className = 'detail-owner-subtext';
    ownerSubtext.textContent = ` (Family Shared)`;
    ownerBadgeContainer.appendChild(ownerSubtext);
  }
  
  document.getElementById('detail-steam-link').href = `steam://store/${game.appid}`;
  document.getElementById('detail-steam-link').setAttribute('data-web-url', `https://store.steampowered.com/app/${game.appid}`);
  
  const loading = document.getElementById('detail-hltb-loading');
  const error = document.getElementById('detail-hltb-error');
  const none = document.getElementById('detail-hltb-none');
  const stats = document.getElementById('detail-hltb-stats');
  const hltbLink = document.getElementById('detail-hltb-link');
  
  loading.style.display = 'none';
  error.style.display = 'none';
  none.style.display = 'none';
  stats.style.display = 'none';
  hltbLink.style.display = 'none';
  
  if (game.hltbLoading) {
    loading.style.display = 'block';
  } else if (game.hltbError) {
    error.style.display = 'block';
  } else if (game.hltb === null || game.hltb.notFound) {
    none.style.display = 'block';
  } else {
    stats.style.display = 'block';
    hltbLink.style.display = 'inline-flex';
    hltbLink.href = `https://howlongtobeat.com/game/${game.hltb.hltbId}`;
    
    document.getElementById('detail-time-main').textContent = `${game.hltb.gameplayMain}h`;
    document.getElementById('detail-time-extra').textContent = `${game.hltb.gameplayMainExtra}h`;
    document.getElementById('detail-time-completionist').textContent = `${game.hltb.gameplayCompletionist}h`;
    
    const hoursPlayed = (game.playtime_forever || 0) / 60;
    
    const pctMain = game.hltb.gameplayMain > 0 ? Math.min(100, (hoursPlayed / game.hltb.gameplayMain) * 100) : 0;
    const pctExtra = game.hltb.gameplayMainExtra > 0 ? Math.min(100, (hoursPlayed / game.hltb.gameplayMainExtra) * 100) : 0;
    const pctComp = game.hltb.gameplayCompletionist > 0 ? Math.min(100, (hoursPlayed / game.hltb.gameplayCompletionist) * 100) : 0;
    
    document.getElementById('detail-progress-main').style.width = `${pctMain}%`;
    document.getElementById('detail-progress-extra').style.width = `${pctExtra}%`;
    document.getElementById('detail-progress-completionist').style.width = `${pctComp}%`;
  }
  
  panel.classList.add('open');
  overlay.classList.add('active');
}

function closeGameDetail() {
  const panel = document.getElementById('game-detail-panel');
  const overlay = document.getElementById('panel-overlay');
  if (panel) panel.classList.remove('open');
  if (overlay) overlay.classList.remove('active');
}
