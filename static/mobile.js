(() => {
  'use strict';

  const BATCH_SIZE = 40;
  const MAX_CONCURRENT_SYNC = 4;

  const isMobileApp = Boolean(
    typeof window !== 'undefined' &&
    window.Capacitor &&
    window.Capacitor.Plugins &&
    window.Capacitor.Plugins.Preferences
  );

  const state = {
    games: [],
    gamesById: new Map(),
    filteredGames: [],
    gridGames: [],
    currentFilter: 'all',
    currentSort: 'playtime_desc',
    filterMinHours: null,
    filterMaxHours: null,
    currentGenre: 'all',
    currentDeveloper: 'all',
    currentPlatform: 'all',
    visibleCardCount: BATCH_SIZE,
    manuallyCompleted: new Set(),
    manuallyUnbeaten: new Set(),
    activeAppId: null,
    preloadedHltb: {},
    syncQueue: [],
    activeWorkers: 0,
    rematchResults: [],
    nextUpAppId: null
  };

  // DOM References
  const el = {
    themeBtn: document.getElementById('mobile-theme-btn'),
    settingsBtn: document.getElementById('mobile-settings-btn'),
    contentArea: document.getElementById('mobile-content'),

    statBacklogCount: document.getElementById('stat-backlog-count'),
    statBacklogHours: document.getElementById('stat-backlog-hours'),
    statCompletedCount: document.getElementById('stat-completed-count'),
    statCompletedHours: document.getElementById('stat-completed-hours'),
    statNextUpCard: document.getElementById('stat-next-up-card'),
    statNextUpName: document.getElementById('stat-next-up-name'),
    statNextUpTime: document.getElementById('stat-next-up-time'),

    searchInput: document.getElementById('mobile-search-input'),
    syncBtn: document.getElementById('mobile-sync-btn'),
    filterChips: document.querySelectorAll('.filter-chip'),
    progressSection: document.getElementById('progress-games-section'),
    progressGrid: document.getElementById('progress-games-grid'),
    gamesGrid: document.getElementById('mobile-games-grid'),
    setupView: document.getElementById('mobile-setup-view'),
    emptyView: document.getElementById('mobile-empty-view'),
    noMatchesView: document.getElementById('mobile-no-matches-view'),
    allGamesHeader: document.getElementById('all-games-header'),
    visibleCount: document.getElementById('mobile-visible-count'),

    syncToast: document.getElementById('mobile-sync-toast'),
    syncToastPct: document.getElementById('mobile-sync-hud-pct-toast'),
    syncToastMin: document.getElementById('mobile-sync-toast-minimize'),

    firstSyncOverlay: document.getElementById('mobile-first-sync-overlay'),
    firstSyncBar: document.getElementById('first-sync-progress-bar'),
    firstSyncStatus: document.getElementById('first-sync-status-text'),
    firstSyncPct: document.getElementById('first-sync-pct-text'),
    firstSyncBgBtn: document.getElementById('first-sync-background-btn'),

    filterHudTrigger: document.getElementById('mobile-filter-hud-trigger'),
    filterBadge: document.getElementById('mobile-filter-badge'),
    filterOverlay: document.getElementById('mobile-filter-sheet-overlay'),
    closeFilterBtn: document.getElementById('close-filter-sheet-btn'),
    filterSort: document.getElementById('filter-sheet-sort'),
    filterMinHours: document.getElementById('filter-sheet-min-hours'),
    filterMaxHours: document.getElementById('filter-sheet-max-hours'),
    filterGenre: document.getElementById('filter-sheet-genre'),
    filterDeveloper: document.getElementById('filter-sheet-developer'),
    filterPlatform: document.getElementById('filter-sheet-platform'),
    filterClearBtn: document.getElementById('filter-sheet-clear-btn'),
    filterApplyBtn: document.getElementById('filter-sheet-apply-btn'),

    settingsOverlay: document.getElementById('mobile-settings-overlay'),
    closeSettingsBtn: document.getElementById('close-sheet-btn'),
    settingsForm: document.getElementById('mobile-settings-form'),
    settingsApiKey: document.getElementById('mobile-settings-api-key'),
    settingsSteamId: document.getElementById('mobile-settings-steam-id'),
    settingsFamilyIds: document.getElementById('mobile-settings-family-ids'),

    detailsOverlay: document.getElementById('mobile-details-overlay'),
    closeDetailsBtn: document.getElementById('close-details-btn'),
    detailsRematchBtn: document.getElementById('details-rematch-btn'),
    detailsRefreshBtn: document.getElementById('details-refresh-btn'),
    detailsMarkBtn: document.getElementById('details-mark-complete-btn'),

    rematchOverlay: document.getElementById('mobile-rematch-overlay'),
    closeRematchBtn: document.getElementById('close-rematch-sheet-btn'),
    rematchInput: document.getElementById('rematch-search-input'),
    rematchBtn: document.getElementById('rematch-search-btn'),
    rematchList: document.getElementById('rematch-results-list'),

    syncModal: document.getElementById('mobile-sync-modal'),
    diceModal: document.getElementById('mobile-dice-modal'),
    toastContainer: document.getElementById('mobile-toast-container')
  };

  // ==========================================================================
  // UTILITIES & TOASTS
  // ==========================================================================

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function debounce(fn, wait) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function showToast(msg) {
    const node = document.createElement('div');
    node.className = 'mobile-toast';
    node.textContent = msg;
    el.toastContainer.appendChild(node);
    setTimeout(() => {
      node.style.opacity = '0';
      node.style.transition = 'opacity 0.2s ease';
      setTimeout(() => node.remove(), 220);
    }, 2600);
  }

  function cleanGameTitleForSearch(title) {
    if (!title) return '';
    let cleaned = String(title).toLowerCase().trim();
    const hasAscii = /[a-z0-9]/.test(cleaned);
    const hasNonAscii = /[^\x00-\x7F]/.test(cleaned);
    if (hasAscii && hasNonAscii) {
      cleaned = cleaned.replace(/[^\x00-\x7F]/g, ' ');
    }
    cleaned = cleaned.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ');
    cleaned = cleaned.replace(/[™®©\-–—/\\_.,:!?'"~`@#$%^&*(){}\[\]<>+=|]/g, ' ');
    cleaned = cleaned.replace(/([a-z])([0-9])/g, '$1 $2');
    cleaned = cleaned.replace(/([0-9])([a-z])/g, '$1 $2');
    return cleaned.replace(/\s+/g, ' ').trim();
  }

  function isGameBeaten(game) {
    if (state.manuallyUnbeaten.has(game.appid)) return false;
    if (state.manuallyCompleted.has(game.appid)) return true;
    if (!game.hltb || game.hltb.notFound) return false;
    const playHrs = (game.playtime_forever || 0) / 60;
    const mainHrs = game.hltb.gameplayMain || 0;
    return mainHrs > 0 && playHrs >= mainHrs;
  }

  function indexGames(list) {
    state.games = list.map(g => ({ ...g, hltb: g.hltb || null, hltbLoading: false, hltbError: false }));
    state.gamesById.clear();
    for (const g of state.games) state.gamesById.set(g.appid, g);
  }

  // ==========================================================================
  // STORAGE HELPERS (Capacitor Preferences or Web Server Fallback)
  // ==========================================================================

  async function getConfig() {
    if (isMobileApp) {
      const { Preferences } = window.Capacitor.Plugins;
      try {
        const { value } = await Preferences.get({ key: 'config' });
        return value ? JSON.parse(value) : null;
      } catch { return null; }
    }
    const res = await fetch('/api/config');
    return res.ok ? await res.json() : null;
  }

  async function saveConfig(cfg) {
    if (isMobileApp) {
      const { Preferences } = window.Capacitor.Plugins;
      await Preferences.set({ key: 'config', value: JSON.stringify(cfg) });
      return;
    }
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg)
    });
    if (!res.ok) throw new Error('Failed to save settings.');
  }

  async function getLibrary() {
    if (isMobileApp) {
      const { Preferences } = window.Capacitor.Plugins;
      try {
        const { value } = await Preferences.get({ key: 'library' });
        return value ? JSON.parse(value) : { games: [], lastSync: 0 };
      } catch { return { games: [], lastSync: 0 }; }
    }
    const res = await fetch('/api/games');
    return res.ok ? await res.json() : { games: [], lastSync: 0 };
  }

  let pendingSaveTimer = null;
  function scheduleSaveLibrary() {
    if (!isMobileApp) return;
    clearTimeout(pendingSaveTimer);
    pendingSaveTimer = setTimeout(async () => {
      const { Preferences } = window.Capacitor.Plugins;
      try {
        await Preferences.set({
          key: 'library',
          value: JSON.stringify({ games: state.games, lastSync: Date.now() })
        });
      } catch (err) {
        console.error('Failed to persist mobile library:', err);
      }
    }, 800);
  }

  async function saveLibraryImmediate(data) {
    if (!isMobileApp) return;
    clearTimeout(pendingSaveTimer);
    const { Preferences } = window.Capacitor.Plugins;
    await Preferences.set({ key: 'library', value: JSON.stringify(data) });
  }

  async function loadManualBeatenSets() {
    if (!isMobileApp) return;
    const { Preferences } = window.Capacitor.Plugins;
    try {
      const [c, u] = await Promise.all([
        Preferences.get({ key: 'manuallyCompleted' }),
        Preferences.get({ key: 'manuallyUnbeaten' })
      ]);
      if (c.value) state.manuallyCompleted = new Set(JSON.parse(c.value));
      if (u.value) state.manuallyUnbeaten = new Set(JSON.parse(u.value));
    } catch { /* ignore */ }
  }

  async function saveManualBeatenSets(appid, nextState) {
    if (isMobileApp) {
      const { Preferences } = window.Capacitor.Plugins;
      await Promise.all([
        Preferences.set({ key: 'manuallyCompleted', value: JSON.stringify([...state.manuallyCompleted]) }),
        Preferences.set({ key: 'manuallyUnbeaten', value: JSON.stringify([...state.manuallyUnbeaten]) })
      ]);
    } else if (appid && nextState) {
      await fetch(`/api/games/${appid}/beat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: nextState })
      });
    }
  }

  async function loadPreloadedHltb() {
    try {
      const res = await fetch('js/preloaded_hltb.json');
      if (res.ok) state.preloadedHltb = await res.json();
    } catch { /* optional */ }
  }

  // ==========================================================================
  // RESILIENT MOBILE HLTB CLIENT (Multi-endpoint + Cached Auth)
  // ==========================================================================

  const HLTB_ENDPOINTS = [
    { search: 'https://howlongtobeat.com/api/search/site', init: 'https://howlongtobeat.com/api/search/site/init' },
    { search: 'https://howlongtobeat.com/api/bleed', init: 'https://howlongtobeat.com/api/bleed/init' },
    { search: 'https://howlongtobeat.com/api/find', init: 'https://howlongtobeat.com/api/find/init' }
  ];
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  let mobileAuthCache = null;
  let mobileAuthPromise = null;

  async function getMobileHltbAuth(force = false) {
    if (!force && mobileAuthCache && (Date.now() - mobileAuthCache.ts < 600000)) {
      return mobileAuthCache;
    }
    if (mobileAuthPromise) return mobileAuthPromise;

    const { CapacitorHttp } = window.Capacitor.Plugins;
    mobileAuthPromise = (async () => {
      for (const ep of HLTB_ENDPOINTS) {
        try {
          const res = await CapacitorHttp.get({
            url: `${ep.init}?t=${Date.now()}`,
            headers: { 'User-Agent': UA, Referer: 'https://howlongtobeat.com/', Origin: 'https://howlongtobeat.com' }
          });
          if (res.status === 200 && res.data && res.data.token) {
            mobileAuthCache = { ...res.data, ep, ts: Date.now() };
            return mobileAuthCache;
          }
        } catch { /* try next */ }
      }
      mobileAuthCache = null;
      return null;
    })();

    try { return await mobileAuthPromise; } finally { mobileAuthPromise = null; }
  }

  async function scrapeHltbMobile(query) {
    if (!isMobileApp) {
      const res = await fetch(`/api/hltb/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) return [];
      const json = await res.json();
      return (json.results || []).map(r => ({
        game_id: r.hltbId,
        game_name: r.title,
        comp_main: (r.gameplayMain || 0) * 3600,
        comp_plus: (r.gameplayMainExtra || 0) * 3600,
        comp_100: (r.gameplayCompletionist || 0) * 3600,
        release_world: r.releaseYear,
        game_image: ''
      }));
    }

    const { CapacitorHttp } = window.Capacitor.Plugins;
    const run = async (auth) => {
      const payload = {
        searchType: 'games',
        searchTerms: query.trim().split(/\s+/).filter(Boolean),
        searchPage: 1,
        size: 15,
        searchOptions: {
          games: { userId: 0, platform: '', sortCategory: 'popular', rangeCategory: 'main', rangeTime: { min: 0, max: 0 }, gameplay: { perspective: '', flow: '', genre: '', difficulty: '' }, rangeYear: { min: '', max: '' }, modifier: '' },
          users: { sortCategory: 'postcount' },
          lists: { sortCategory: 'follows' },
          filter: '', sort: 0, randomizer: 0
        },
        useCache: true
      };
      if (auth.hpKey) payload[auth.hpKey] = auth.hpVal;

      return CapacitorHttp.post({
        url: auth.ep.search,
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/json',
          Origin: 'https://howlongtobeat.com',
          Referer: 'https://howlongtobeat.com/',
          'x-auth-token': auth.token,
          ...(auth.hpKey ? { 'x-hp-key': auth.hpKey, 'x-hp-val': auth.hpVal } : {})
        },
        data: payload
      });
    };

    let auth = await getMobileHltbAuth(false);
    if (!auth) return [];
    let res = await run(auth);
    if (res.status === 403 || res.status === 404) {
      auth = await getMobileHltbAuth(true);
      if (!auth) return [];
      res = await run(auth);
    }
    return (res.status === 200 && res.data) ? (res.data.data || []) : [];
  }

  async function fetchHltbForGame(game, force = false) {
    if (!isMobileApp) {
      const res = await fetch(`/api/hltb?title=${encodeURIComponent(game.name)}&appid=${game.appid}${force ? '&force=1' : ''}`);
      if (!res.ok) throw new Error('HLTB fetch failed');
      return await res.json();
    }

    const cleaned = cleanGameTitleForSearch(game.name);
    if (!force && cleaned && state.preloadedHltb[cleaned]) {
      const e = state.preloadedHltb[cleaned];
      if ((e.gameplayMain || 0) > 0 || (e.gameplayMainExtra || 0) > 0 || (e.gameplayCompletionist || 0) > 0) {
        return { ...e, notFound: false, source: 'dataset' };
      }
    }

    let results = await scrapeHltbMobile(game.name);
    if ((!results || results.length === 0) && cleaned && cleaned !== game.name.toLowerCase().trim()) {
      results = await scrapeHltbMobile(cleaned);
    }
    if (results && results.length > 0) {
      const lower = game.name.toLowerCase().trim();
      const match = results.find(r => r.game_name?.toLowerCase() === lower) || results[0];
      const base = {
        hltbId: String(match.game_id),
        title: match.game_name,
        gameplayMain: Math.round((match.comp_main || 0) / 3600),
        gameplayMainExtra: Math.round((match.comp_plus || 0) / 3600),
        gameplayCompletionist: Math.round((match.comp_100 || 0) / 3600),
        releaseYear: match.release_world || null,
        imageUrl: match.game_image ? `https://howlongtobeat.com/games/${match.game_image}` : '',
        notFound: false
      };
      const meta = cleaned ? state.preloadedHltb[cleaned] : null;
      if (meta) {
        base.genres = meta.genres || '';
        base.developers = meta.developers || '';
        base.platforms = meta.platforms || '';
        base.releaseYear = base.releaseYear || meta.releaseYear || null;
      }
      return base;
    }
    return { title: game.name, notFound: true };
  }

  // ==========================================================================
  // LIBRARY LOAD & SYNC
  // ==========================================================================

  async function fetchLibrary() {
    el.setupView.hidden = true;
    el.emptyView.hidden = true;
    el.noMatchesView.hidden = true;

    try {
      const config = await getConfig();
      const hasCreds = config && ((config.STEAM_API_KEY || config.STEAM_API_KEY_SET) && config.STEAM_ID);
      if (!hasCreds) {
        el.setupView.hidden = false;
        el.gamesGrid.innerHTML = '';
        el.progressSection.hidden = true;
        return;
      }

      const data = await getLibrary();
      if (!isMobileApp && data.manualBeaten) state.manuallyCompleted = new Set(data.manualBeaten);
      if (!isMobileApp && data.manualUnbeaten) state.manuallyUnbeaten = new Set(data.manualUnbeaten);

      if (!data.games || data.games.length === 0) {
        el.emptyView.hidden = false;
        el.gamesGrid.innerHTML = '';
        el.progressSection.hidden = true;
        return;
      }

      indexGames(data.games);
      updateStats();
      populateFilterDropdowns();
      handleSearchAndFilter();
    } catch (err) {
      console.error('Mobile fetchLibrary failed:', err);
      el.emptyView.hidden = false;
    }
  }

  async function performMobileSync(force, onProgress) {
    if (!isMobileApp) {
      if (onProgress) onProgress('Syncing via server...', 40);
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed.');
      return data;
    }

    const { CapacitorHttp } = window.Capacitor.Plugins;
    const config = await getConfig();
    if (!config || !config.STEAM_API_KEY || !config.STEAM_ID) {
      throw new Error('Configure your Steam API Key and Steam ID first.');
    }

    const apiKey = config.STEAM_API_KEY;
    let primaryId = config.STEAM_ID;
    const familyIds = config.FAMILY_STEAM_IDS || [];

    if (onProgress) onProgress('Resolving Steam ID...', 8);
    if (!/^\d{17}$/.test(primaryId)) {
      const r = await CapacitorHttp.get({ url: `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${apiKey}&vanityurl=${encodeURIComponent(primaryId)}` });
      if (r.status === 200 && r.data?.response?.steamid) primaryId = r.data.response.steamid;
      else throw new Error('Could not resolve Steam vanity URL.');
    }

    const fetchOwned = async (sid) => {
      const r = await CapacitorHttp.get({ url: `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${sid}&include_appinfo=true&include_played_free_games=true&format=json` });
      return r.status === 200 ? (r.data?.response?.games || []) : [];
    };

    if (onProgress) onProgress('Importing Steam library...', 20);
    const primaryGames = await fetchOwned(primaryId);
    const gamesMap = new Map();
    for (const g of primaryGames) {
      gamesMap.set(g.appid, { appid: g.appid, name: g.name, playtime_forever: g.playtime_forever || 0, img_icon_url: g.img_icon_url || '', owner_steamid: primaryId, is_owned: true });
    }

    for (const mId of familyIds) {
      let sid = mId;
      if (!/^\d{17}$/.test(sid)) {
        const r = await CapacitorHttp.get({ url: `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${apiKey}&vanityurl=${encodeURIComponent(sid)}` });
        if (r.status === 200 && r.data?.response?.steamid) sid = r.data.response.steamid;
      }
      const mGames = await fetchOwned(sid);
      for (const g of mGames) {
        if (!gamesMap.has(g.appid)) {
          gamesMap.set(g.appid, { appid: g.appid, name: g.name, playtime_forever: 0, img_icon_url: g.img_icon_url || '', owner_steamid: sid, is_owned: false });
        }
      }
    }

    const existingMap = new Map();
    if (!force) {
      const cur = await getLibrary();
      (cur.games || []).forEach(g => { if (g.hltb) existingMap.set(g.appid, g.hltb); });
    }

    const merged = Array.from(gamesMap.values()).map(g => {
      let hltb = existingMap.get(g.appid) || null;
      if (!hltb) {
        const cleaned = cleanGameTitleForSearch(g.name);
        const ds = cleaned ? state.preloadedHltb[cleaned] : null;
        if (ds && ((ds.gameplayMain || 0) > 0 || (ds.gameplayMainExtra || 0) > 0 || (ds.gameplayCompletionist || 0) > 0)) {
          hltb = { ...ds, notFound: false, source: 'dataset' };
        }
      }
      return { ...g, hltb };
    });

    const libraryData = { games: merged, lastSync: Date.now() };
    await saveLibraryImmediate(libraryData);
    return libraryData;
  }

  async function startLibrarySync(force) {
    const isFirstSync = state.games.length === 0;
    el.emptyView.hidden = true;

    if (isFirstSync) {
      el.firstSyncBar.style.width = '0%';
      el.firstSyncStatus.textContent = 'Contacting Steam...';
      el.firstSyncPct.textContent = '0%';
      el.firstSyncOverlay.hidden = false;
    } else {
      el.syncToastPct.textContent = '0%';
      el.syncToast.hidden = false;
    }

    try {
      const data = await performMobileSync(force, (msg, pct) => {
        if (isFirstSync) {
          el.firstSyncStatus.textContent = msg;
          el.firstSyncBar.style.width = `${pct}%`;
          el.firstSyncPct.textContent = `${pct}%`;
        }
      });

      indexGames(data.games || []);
      updateStats();
      populateFilterDropdowns();
      handleSearchAndFilter();

      state.syncQueue = state.games.filter(g => !g.hltb);
      if (state.syncQueue.length > 0) {
        const workers = Math.min(MAX_CONCURRENT_SYNC - state.activeWorkers, state.syncQueue.length);
        for (let i = 0; i < workers; i++) runMobileHltbWorker(isFirstSync);
      } else {
        el.firstSyncOverlay.hidden = true;
        el.syncToast.hidden = true;
        showToast(`Synced ${state.games.length} titles.`);
      }
    } catch (err) {
      el.firstSyncOverlay.hidden = true;
      el.syncToast.hidden = true;
      showToast(err.message || 'Sync failed.');
      await fetchLibrary();
    }
  }

  const debouncedUiRefresh = debounce(() => {
    updateStats();
    populateFilterDropdowns();
    handleSearchAndFilter();
  }, 600);

  async function runMobileHltbWorker(isFirstSync) {
    if (state.syncQueue.length === 0) {
      if (state.activeWorkers === 0) {
        el.firstSyncOverlay.hidden = true;
        el.syncToast.hidden = true;
        updateStats();
        populateFilterDropdowns();
        handleSearchAndFilter();
        showToast('HLTB sync complete.');
      }
      return;
    }

    state.activeWorkers++;
    const game = state.syncQueue.shift();

    try {
      game.hltb = await fetchHltbForGame(game, false);
      scheduleSaveLibrary();
      debouncedUiRefresh();
    } catch { /* continue */ }

    const total = state.games.length;
    const processed = state.games.filter(g => g.hltb !== null).length;
    const pct = total > 0 ? Math.round((processed / total) * 100) : 100;

    if (isFirstSync && !el.firstSyncOverlay.hidden) {
      el.firstSyncStatus.textContent = `Matching HLTB: ${processed}/${total}`;
      el.firstSyncBar.style.width = `${pct}%`;
      el.firstSyncPct.textContent = `${pct}%`;
    }
    el.syncToastPct.textContent = `${pct}%`;

    state.activeWorkers--;
    runMobileHltbWorker(isFirstSync);
  }

  // ==========================================================================
  // STATS, FILTERING & RENDERING (Appending Infinite Scroll!)
  // ==========================================================================

  function updateStats() {
    const completed = state.games.filter(isGameBeaten);
    const backlog = state.games.filter(g => !isGameBeaten(g));

    el.statBacklogCount.textContent = String(backlog.length);
    const totalMins = backlog.reduce((s, g) => s + (g.playtime_forever || 0), 0);
    el.statBacklogHours.textContent = `${Math.round(totalMins / 60)}h played`;

    el.statCompletedCount.textContent = String(completed.length);
    const beatenHrs = completed.reduce((s, g) => s + (g.hltb?.gameplayMain || 0), 0);
    el.statCompletedHours.textContent = `${beatenHrs}h beaten`;

    const eligible = backlog
      .filter(g => g.hltb && !g.hltb.notFound && g.hltb.gameplayMain > 0)
      .sort((a, b) => a.hltb.gameplayMain - b.hltb.gameplayMain);

    if (eligible.length > 0) {
      state.nextUpAppId = eligible[0].appid;
      el.statNextUpName.textContent = eligible[0].name;
      el.statNextUpTime.textContent = `${eligible[0].hltb.gameplayMain}h main story`;
    } else {
      state.nextUpAppId = null;
      el.statNextUpName.textContent = 'None';
      el.statNextUpTime.textContent = '—';
    }
  }

  function populateFilterDropdowns() {
    const genres = new Set();
    const devs = new Set();
    const plats = new Set();

    for (const g of state.games) {
      if (!g.hltb || g.hltb.notFound) continue;
      if (g.hltb.genres) g.hltb.genres.split(',').forEach(v => v.trim() && genres.add(v.trim()));
      if (g.hltb.developers) g.hltb.developers.split(',').forEach(v => v.trim() && devs.add(v.trim()));
      if (g.hltb.platforms) g.hltb.platforms.split(',').forEach(v => v.trim() && plats.add(v.trim()));
    }

    const fill = (select, label, set, current) => {
      const sorted = Array.from(set).sort((a, b) => a.localeCompare(b));
      select.innerHTML = `<option value="all">${label}</option>` +
        sorted.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
      select.value = sorted.includes(current) ? current : 'all';
    };

    fill(el.filterGenre, 'All Genres', genres, state.currentGenre);
    fill(el.filterDeveloper, 'All Developers', devs, state.currentDeveloper);
    fill(el.filterPlatform, 'All Platforms', plats, state.currentPlatform);
  }

  function updateFilterBadge() {
    let count = 0;
    if (state.filterMinHours !== null) count++;
    if (state.filterMaxHours !== null) count++;
    if (state.currentGenre !== 'all') count++;
    if (state.currentDeveloper !== 'all') count++;
    if (state.currentPlatform !== 'all') count++;
    el.filterBadge.textContent = String(count);
    el.filterBadge.hidden = count === 0;
  }

  function handleSearchAndFilter() {
    updateFilterBadge();
    const q = el.searchInput.value.toLowerCase().trim();

    state.filteredGames = state.games.filter(game => {
      if (q && !game.name.toLowerCase().includes(q)) return false;

      const playHrs = (game.playtime_forever || 0) / 60;
      const beaten = isGameBeaten(game);

      if (state.filterMinHours !== null || state.filterMaxHours !== null) {
        if (!game.hltb || game.hltb.notFound) return false;
        const hrs = game.hltb.gameplayMain || 0;
        if (hrs <= 0) return false;
        if (state.filterMinHours !== null && hrs < state.filterMinHours) return false;
        if (state.filterMaxHours !== null && hrs > state.filterMaxHours) return false;
      }

      if (state.currentGenre !== 'all') {
        if (!game.hltb?.genres?.split(',').map(s => s.trim()).includes(state.currentGenre)) return false;
      }
      if (state.currentDeveloper !== 'all') {
        if (!game.hltb?.developers?.split(',').map(s => s.trim()).includes(state.currentDeveloper)) return false;
      }
      if (state.currentPlatform !== 'all') {
        if (!game.hltb?.platforms?.split(',').map(s => s.trim()).includes(state.currentPlatform)) return false;
      }

      switch (state.currentFilter) {
        case 'owned': return game.is_owned;
        case 'shared': return !game.is_owned;
        case 'played': return playHrs > 0.1 && !beaten;
        case 'unplayed': return playHrs <= 0.1;
        case 'completed': return beaten;
        default: return true;
      }
    });

    state.filteredGames.sort((a, b) => {
      const mVal = (g, fb) => (g.hltb && !g.hltb.notFound && g.hltb.gameplayMain > 0) ? g.hltb.gameplayMain : fb;
      switch (state.currentSort) {
        case 'playtime_asc': return (a.playtime_forever || 0) - (b.playtime_forever || 0);
        case 'name_asc': return a.name.localeCompare(b.name);
        case 'name_desc': return b.name.localeCompare(a.name);
        case 'hltb_main_asc': return mVal(a, Infinity) - mVal(b, Infinity);
        case 'hltb_main_desc': return mVal(b, -Infinity) - mVal(a, -Infinity);
        default: return (b.playtime_forever || 0) - (a.playtime_forever || 0);
      }
    });

    renderInitialGrids();
  }

  function createSmallCardHtml(game) {
    const playHrs = ((game.playtime_forever || 0) / 60).toFixed(1);
    const imgUrl = `https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/header.jpg`;
    const beaten = isGameBeaten(game);

    let badge = '';
    if (beaten) {
      badge = '<span class="small-card-badge is-beaten">Beaten</span>';
    } else if (game.hltb && !game.hltb.notFound && game.hltb.gameplayMain > 0) {
      badge = `<span class="small-card-badge">${game.hltb.gameplayMain}h</span>`;
    }

    return `
      <article class="small-card${beaten ? ' beaten' : ''}" data-appid="${game.appid}">
        <div class="small-card-cover">
          <img src="${imgUrl}" alt="${escapeHtml(game.name)}" loading="lazy" decoding="async" data-cover-name="${escapeHtml(game.name)}">
        </div>
        <div class="small-card-body">
          <h3 class="small-card-title">${escapeHtml(game.name)}</h3>
          <div class="small-card-meta">
            <span>${playHrs}h played</span>
            ${badge}
          </div>
        </div>
      </article>
    `;
  }

  function renderInitialGrids() {
    el.noMatchesView.hidden = true;
    const hasAdv = state.filterMinHours !== null || state.filterMaxHours !== null ||
      state.currentGenre !== 'all' || state.currentDeveloper !== 'all' || state.currentPlatform !== 'all';

    const showInProgress = state.currentFilter === 'all' && !el.searchInput.value.trim() && !hasAdv;
    const inProgress = showInProgress
      ? state.filteredGames.filter(g => ((g.playtime_forever || 0) / 60) > 0.1 && g.hltb?.gameplayMain > 0 && !isGameBeaten(g)).slice(0, 4)
      : [];

    if (inProgress.length > 0) {
      el.progressSection.hidden = false;
      el.progressGrid.innerHTML = inProgress.map(g => {
        const playHrs = ((g.playtime_forever || 0) / 60).toFixed(1);
        const mainHrs = g.hltb.gameplayMain;
        const pct = Math.min(100, Math.round((parseFloat(playHrs) / mainHrs) * 100));
        return `
          <article class="progress-card" data-appid="${g.appid}">
            <div class="progress-card-banner">
              <img src="https://cdn.akamai.steamstatic.com/steam/apps/${g.appid}/header.jpg" alt="${escapeHtml(g.name)}" loading="lazy" data-cover-name="${escapeHtml(g.name)}">
            </div>
            <div class="progress-card-details">
              <div>
                <h3 class="progress-game-title">${escapeHtml(g.name)}</h3>
                <span class="progress-game-hours">${playHrs}h played</span>
              </div>
              <div class="progress-bar-inline">
                <div class="progress-bar-inline-meta">
                  <span>Main ${mainHrs}h</span>
                  <strong>${pct}%</strong>
                </div>
                <div class="progress-mini-track">
                  <div class="progress-mini-fill" style="width:${pct}%"></div>
                </div>
              </div>
            </div>
          </article>
        `;
      }).join('');
    } else {
      el.progressSection.hidden = true;
    }

    const progIds = new Set(inProgress.map(g => g.appid));
    state.gridGames = inProgress.length > 0
      ? state.filteredGames.filter(g => !progIds.has(g.appid))
      : state.filteredGames;

    el.visibleCount.textContent = `${state.filteredGames.length} titles`;

    if (state.filteredGames.length === 0) {
      el.noMatchesView.hidden = false;
      el.gamesGrid.innerHTML = '';
      el.allGamesHeader.hidden = true;
      return;
    }

    el.allGamesHeader.hidden = false;
    el.allGamesHeader.textContent = state.currentFilter === 'all' ? 'Your Library' : `Filtered (${state.currentFilter})`;
    state.visibleCardCount = BATCH_SIZE;
    el.gamesGrid.innerHTML = state.gridGames.slice(0, state.visibleCardCount).map(createSmallCardHtml).join('');
  }

  function appendNextMobileBatch() {
    if (state.visibleCardCount >= state.gridGames.length) return;
    const next = state.gridGames.slice(state.visibleCardCount, state.visibleCardCount + BATCH_SIZE);
    state.visibleCardCount += BATCH_SIZE;
    const frag = document.createRange().createContextualFragment(next.map(createSmallCardHtml).join(''));
    el.gamesGrid.appendChild(frag);
  }

  // ==========================================================================
  // DETAILS, REMATCH & DICE SHEETS
  // ==========================================================================

  function openGameDetailsSheet(appid) {
    const game = state.gamesById.get(Number(appid));
    if (!game) return;
    state.activeAppId = game.appid;

    const scroll = el.detailsOverlay.querySelector('.details-sheet-scrollable');
    if (scroll) scroll.scrollTop = 0;

    document.getElementById('details-game-name').textContent = game.name;
    document.getElementById('details-game-img').src = `https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/header.jpg`;
    document.getElementById('details-owner-badge').textContent = game.is_owned ? 'Owned' : 'Borrowed';

    const playHrs = ((game.playtime_forever || 0) / 60).toFixed(1);
    document.getElementById('details-playtime-val').textContent = `${playHrs}h`;

    const beaten = isGameBeaten(game);
    const statusEl = document.getElementById('details-status-val');
    statusEl.textContent = beaten ? 'Beaten' : (parseFloat(playHrs) > 0.1 ? 'In Progress' : 'Unplayed');
    statusEl.style.color = beaten ? 'var(--success)' : 'var(--text-primary)';
    el.detailsMarkBtn.textContent = beaten ? 'Unmark as Beaten' : 'Mark as Beaten';

    const h = game.hltb;
    document.getElementById('details-hltb-main').textContent = h && !h.notFound && h.gameplayMain ? `${h.gameplayMain}h` : '—';
    document.getElementById('details-hltb-extra').textContent = h && !h.notFound && h.gameplayMainExtra ? `${h.gameplayMainExtra}h` : '—';
    document.getElementById('details-hltb-100').textContent = h && !h.notFound && h.gameplayCompletionist ? `${h.gameplayCompletionist}h` : '—';

    const metaSec = document.getElementById('details-metadata-section');
    if (h && !h.notFound && (h.genres || h.developers || h.releaseYear || h.platforms)) {
      document.getElementById('details-meta-genres').textContent = h.genres || '—';
      document.getElementById('details-meta-developer').textContent = h.developers || '—';
      document.getElementById('details-meta-release').textContent = h.releaseYear ? String(h.releaseYear) : '—';
      document.getElementById('details-meta-platforms').textContent = h.platforms || '—';
      metaSec.hidden = false;
    } else {
      metaSec.hidden = true;
    }

    document.getElementById('details-steam-link').href = `https://store.steampowered.com/app/${game.appid}`;
    document.getElementById('details-hltb-link').href = h?.hltbId
      ? `https://howlongtobeat.com/game/${h.hltbId}`
      : `https://howlongtobeat.com/?q=${encodeURIComponent(game.name)}`;

    el.detailsOverlay.hidden = false;
  }

  async function toggleMobileBeat() {
    const game = state.gamesById.get(state.activeAppId);
    if (!game) return;
    const beaten = isGameBeaten(game);
    let nextState;
    if (beaten) {
      state.manuallyCompleted.delete(game.appid);
      state.manuallyUnbeaten.add(game.appid);
      nextState = 'unbeaten';
    } else {
      state.manuallyUnbeaten.delete(game.appid);
      state.manuallyCompleted.add(game.appid);
      nextState = 'beaten';
    }
    await saveManualBeatenSets(game.appid, nextState);
    updateStats();
    handleSearchAndFilter();
    openGameDetailsSheet(game.appid);
    showToast(beaten ? 'Marked as not beaten.' : 'Marked as beaten.');
  }

  async function performRematchSearch() {
    const q = el.rematchInput.value.trim();
    if (!q) return;
    el.rematchList.innerHTML = '<div class="rematch-no-results"><i class="fa-solid fa-circle-notch fa-spin"></i> Searching...</div>';

    try {
      const results = await scrapeHltbMobile(q);
      state.rematchResults = results || [];
      if (state.rematchResults.length === 0) {
        el.rematchList.innerHTML = `<div class="rematch-no-results">No results for "${escapeHtml(q)}"</div>`;
        return;
      }

      el.rematchList.innerHTML = state.rematchResults.map((r, idx) => {
        const m = Math.round((r.comp_main || 0) / 3600);
        const e = Math.round((r.comp_plus || 0) / 3600);
        const c = Math.round((r.comp_100 || 0) / 3600);
        return `
          <button type="button" class="rematch-result-item" data-rematch-idx="${idx}">
            <div class="rematch-result-info">
              <span class="rematch-result-title">${escapeHtml(r.game_name)}</span>
              <span class="rematch-result-hours">Main ${m}h · Extra ${e}h · 100% ${c}h</span>
            </div>
          </button>
        `;
      }).join('');
    } catch {
      el.rematchList.innerHTML = '<div class="rematch-no-results">Search failed. Try again.</div>';
    }
  }

  async function applyRematch(idx) {
    const r = state.rematchResults[idx];
    const game = state.gamesById.get(state.activeAppId);
    if (!r || !game) return;

    const updated = {
      hltbId: String(r.game_id),
      title: r.game_name,
      gameplayMain: Math.round((r.comp_main || 0) / 3600),
      gameplayMainExtra: Math.round((r.comp_plus || 0) / 3600),
      gameplayCompletionist: Math.round((r.comp_100 || 0) / 3600),
      releaseYear: r.release_world || null,
      imageUrl: r.game_image ? `https://howlongtobeat.com/games/${r.game_image}` : '',
      notFound: false
    };

    if (isMobileApp) {
      game.hltb = updated;
      await saveLibraryImmediate({ games: state.games, lastSync: Date.now() });
    } else {
      const res = await fetch('/api/hltb/rematch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appid: game.appid, gameName: game.name, hltb: updated })
      });
      if (res.ok) {
        const data = await res.json();
        game.hltb = data.hltb;
      }
    }

    el.rematchOverlay.hidden = true;
    updateStats();
    handleSearchAndFilter();
    openGameDetailsSheet(game.appid);
    showToast(`Matched to ${updated.title}.`);
  }

  function triggerDicePicker() {
    const candidates = state.filteredGames.filter(g => !isGameBeaten(g));
    if (candidates.length === 0) {
      showToast('No unfinished games in current filter.');
      return;
    }

    let totalWeight = 0;
    const weighted = candidates.map(g => {
      const hrs = (g.hltb && !g.hltb.notFound && g.hltb.gameplayMain > 0) ? g.hltb.gameplayMain : 15;
      const w = 100 / Math.max(1, hrs);
      totalWeight += w;
      return { game: g, w };
    });

    let roll = Math.random() * totalWeight;
    let pick = candidates[0];
    for (const item of weighted) {
      roll -= item.w;
      if (roll <= 0) { pick = item.game; break; }
    }

    const playHrs = ((pick.playtime_forever || 0) / 60).toFixed(1);
    document.getElementById('dice-game-title').textContent = pick.name;
    document.getElementById('dice-playtime-val').textContent = `${playHrs}h`;
    document.getElementById('dice-hltb-main-val').textContent = pick.hltb?.gameplayMain ? `${pick.hltb.gameplayMain}h` : '—';

    const img = document.getElementById('dice-game-img');
    img.hidden = false;
    img.src = `https://cdn.akamai.steamstatic.com/steam/apps/${pick.appid}/header.jpg`;
    img.onerror = () => { img.hidden = true; };

    document.getElementById('dice-open-details-btn').onclick = () => {
      el.diceModal.hidden = true;
      openGameDetailsSheet(pick.appid);
    };

    el.diceModal.hidden = false;
  }

  // ==========================================================================
  // SWIPE-TO-DISMISS & EVENTS
  // ==========================================================================

  function makeSheetSwipable(overlay) {
    if (!overlay) return;
    const content = overlay.querySelector('.bottom-sheet-content');
    if (!content) return;

    let startY = 0;
    let deltaY = 0;
    let dragging = false;

    content.addEventListener('touchstart', (e) => {
      const scrollable = content.querySelector('.details-sheet-scrollable, .rematch-results-scrollable');
      if (scrollable && scrollable.scrollTop > 0) return;
      startY = e.touches[0].clientY;
      deltaY = 0;
      dragging = true;
      content.style.transition = 'none';
    }, { passive: true });

    content.addEventListener('touchmove', (e) => {
      if (!dragging) return;
      deltaY = e.touches[0].clientY - startY;
      if (deltaY > 0) content.style.transform = `translateY(${deltaY}px)`;
    }, { passive: true });

    content.addEventListener('touchend', () => {
      if (!dragging) return;
      dragging = false;
      content.style.transition = 'transform 0.25s ease';
      if (deltaY > 110) overlay.hidden = true;
      content.style.transform = '';
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.hidden = true;
    });
  }

  function setupEvents() {
    el.themeBtn.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      if (isDark) {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('theme', 'light');
      } else {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
      }
    });

    el.searchInput.addEventListener('input', debounce(handleSearchAndFilter, 200));

    el.filterChips.forEach(chip => {
      chip.addEventListener('click', () => {
        el.filterChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.currentFilter = chip.dataset.filter;
        handleSearchAndFilter();
      });
    });

    // Delegated card clicks & safe cover error fallback
    const onCardClick = (e) => {
      const card = e.target.closest('[data-appid]');
      if (card) openGameDetailsSheet(card.dataset.appid);
    };
    el.gamesGrid.addEventListener('click', onCardClick);
    el.progressGrid.addEventListener('click', onCardClick);

    const onImgError = (e) => {
      const img = e.target;
      if (img && img.tagName === 'IMG' && img.dataset.coverName) {
        const ph = document.createElement('div');
        ph.className = 'small-card-placeholder';
        ph.textContent = img.dataset.coverName;
        img.replaceWith(ph);
      }
    };
    el.gamesGrid.addEventListener('error', onImgError, true);
    el.progressGrid.addEventListener('error', onImgError, true);

    el.statNextUpCard.addEventListener('click', () => {
      if (state.nextUpAppId) openGameDetailsSheet(state.nextUpAppId);
    });

    // Infinite scroll (append-only!)
    el.contentArea.addEventListener('scroll', () => {
      if (el.contentArea.scrollTop + el.contentArea.clientHeight >= el.contentArea.scrollHeight - 280) {
        appendNextMobileBatch();
      }
    }, { passive: true });

    // Settings
    const openSettings = async () => {
      el.settingsOverlay.hidden = false;
      const cfg = await getConfig();
      if (cfg) {
        el.settingsApiKey.value = '';
        el.settingsApiKey.placeholder = (cfg.STEAM_API_KEY || cfg.STEAM_API_KEY_SET) ? '••••••••••••••••••••••••' : 'Enter Steam Web API Key';
        el.settingsSteamId.value = cfg.STEAM_ID || '';
        el.settingsFamilyIds.value = (cfg.FAMILY_STEAM_IDS || []).join(', ');
      }
    };
    el.settingsBtn.addEventListener('click', openSettings);
    document.getElementById('mobile-setup-trigger-btn').addEventListener('click', openSettings);
    el.closeSettingsBtn.addEventListener('click', () => { el.settingsOverlay.hidden = true; });
    el.settingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const cur = await getConfig() || {};
        const key = el.settingsApiKey.value.trim();
        const payload = {
          STEAM_ID: el.settingsSteamId.value.trim(),
          FAMILY_STEAM_IDS: el.settingsFamilyIds.value.split(',').map(s => s.trim()).filter(Boolean),
          STEAM_API_KEY: (key && !key.includes('•')) ? key : (cur.STEAM_API_KEY || '')
        };
        await saveConfig(payload);
        el.settingsOverlay.hidden = true;
        showToast('Settings saved.');
        await fetchLibrary();
      } catch (err) {
        showToast(err.message || 'Save failed.');
      }
    });

    // Sync
    el.syncBtn.addEventListener('click', () => { el.syncModal.hidden = false; });
    document.getElementById('mobile-empty-sync-btn').addEventListener('click', () => { el.syncModal.hidden = false; });
    document.getElementById('close-sync-sheet-btn').addEventListener('click', () => { el.syncModal.hidden = true; });
    document.getElementById('mobile-sync-quick-btn').addEventListener('click', () => { el.syncModal.hidden = true; startLibrarySync(false); });
    document.getElementById('mobile-sync-force-btn').addEventListener('click', () => { el.syncModal.hidden = true; startLibrarySync(true); });
    el.syncToastMin.addEventListener('click', () => { el.syncToast.hidden = true; });
    el.firstSyncBgBtn.addEventListener('click', () => { el.firstSyncOverlay.hidden = true; el.syncToast.hidden = false; });

    // Details & Rematch
    el.closeDetailsBtn.addEventListener('click', () => { el.detailsOverlay.hidden = true; });
    el.detailsMarkBtn.addEventListener('click', toggleMobileBeat);
    el.detailsRematchBtn.addEventListener('click', () => {
      const game = state.gamesById.get(state.activeAppId);
      if (!game) return;
      el.rematchInput.value = game.name;
      el.rematchList.innerHTML = '';
      el.rematchOverlay.hidden = false;
      performRematchSearch();
    });
    el.detailsRefreshBtn.addEventListener('click', async () => {
      const game = state.gamesById.get(state.activeAppId);
      if (!game) return;
      el.detailsRefreshBtn.disabled = true;
      try {
        game.hltb = await fetchHltbForGame(game, true);
        if (isMobileApp) await saveLibraryImmediate({ games: state.games, lastSync: Date.now() });
        updateStats();
        handleSearchAndFilter();
        openGameDetailsSheet(game.appid);
        showToast('Refreshed HLTB times.');
      } catch {
        showToast('Refresh failed.');
      } finally {
        el.detailsRefreshBtn.disabled = false;
      }
    });

    el.closeRematchBtn.addEventListener('click', () => { el.rematchOverlay.hidden = true; });
    el.rematchBtn.addEventListener('click', performRematchSearch);
    el.rematchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') performRematchSearch(); });
    el.rematchList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-rematch-idx]');
      if (btn) applyRematch(Number(btn.dataset.rematchIdx));
    });

    // Filter sheet
    el.filterHudTrigger.addEventListener('click', () => {
      el.filterSort.value = state.currentSort;
      el.filterMinHours.value = state.filterMinHours ?? '';
      el.filterMaxHours.value = state.filterMaxHours ?? '';
      el.filterGenre.value = state.currentGenre;
      el.filterDeveloper.value = state.currentDeveloper;
      el.filterPlatform.value = state.currentPlatform;
      el.filterOverlay.hidden = false;
    });
    el.closeFilterBtn.addEventListener('click', () => { el.filterOverlay.hidden = true; });
    el.filterClearBtn.addEventListener('click', () => {
      state.filterMinHours = null;
      state.filterMaxHours = null;
      state.currentGenre = 'all';
      state.currentDeveloper = 'all';
      state.currentPlatform = 'all';
      el.filterOverlay.hidden = true;
      handleSearchAndFilter();
    });
    el.filterApplyBtn.addEventListener('click', () => {
      state.currentSort = el.filterSort.value;
      const minV = parseFloat(el.filterMinHours.value);
      const maxV = parseFloat(el.filterMaxHours.value);
      state.filterMinHours = Number.isFinite(minV) ? minV : null;
      state.filterMaxHours = Number.isFinite(maxV) ? maxV : null;
      state.currentGenre = el.filterGenre.value;
      state.currentDeveloper = el.filterDeveloper.value;
      state.currentPlatform = el.filterPlatform.value;
      el.filterOverlay.hidden = true;
      handleSearchAndFilter();
    });

    // Dice
    document.getElementById('mobile-dice-btn').addEventListener('click', triggerDicePicker);
    document.getElementById('close-dice-sheet-btn').addEventListener('click', () => { el.diceModal.hidden = true; });
    document.getElementById('dice-reroll-btn').addEventListener('click', triggerDicePicker);

    [
      el.settingsOverlay,
      el.detailsOverlay,
      el.syncModal,
      el.diceModal,
      el.rematchOverlay,
      el.filterOverlay
    ].forEach(makeSheetSwipable);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    await loadManualBeatenSets();
    await loadPreloadedHltb();
    setupEvents();
    await fetchLibrary();
  });
})();
