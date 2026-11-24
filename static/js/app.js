(() => {
  'use strict';

  // ==========================================================================
  // STATE
  // ==========================================================================

  const BATCH_SIZE = 48;
  const MAX_CONCURRENT_SYNC = 4;

  const state = {
    games: [],
    gamesById: new Map(),
    filteredGames: [],
    manualBeaten: new Set(),
    manualUnbeaten: new Set(),
    filter: 'all',
    sort: 'playtime_desc',
    search: '',
    timeCategory: 'main',
    minTime: null,
    maxTime: null,
    genre: 'all',
    hideZero: false,
    weeklyPace: 5,
    visibleCount: BATCH_SIZE,
    activeDetailAppId: null,
    lastSync: 0,
    syncQueue: [],
    activeWorkers: 0,
    syncTotal: 0,
    syncDone: 0
  };

  // Endless / utility blocklist for backlog calculations & dice picker
  const ENDLESS_BLOCKLIST = [
    'team fortress 2', 'counter-strike', 'dota 2', 'pubg', 'apex legends',
    'destiny 2', 'warframe', 'rust', "garry's mod", 'left 4 dead',
    'dead by daylight', 'payday 2', 'payday 3', 'valorant', 'league of legends',
    'world of warcraft', 'overwatch', 'teamfight tactics', 'hearthstone',
    'brawlhalla', 'rocket league', 'smite', 'paladins', 'vrchat',
    'factorio', 'satisfactory', 'rimworld', 'civilization', 'hearts of iron',
    'stellaris', 'crusader kings', 'europa universalis', 'the sims',
    'cities: skylines', 'euro truck simulator', 'american truck simulator',
    'assetto corsa', 'iracing', 'killing floor'
  ];

  const NON_STORY_KEYWORDS = [
    'dedicated server', 'test server', 'public test', 'benchmark',
    'soundtrack', 'sdk', 'wallpaper engine'
  ];

  // ==========================================================================
  // DOM REFERENCES
  // ==========================================================================

  const el = {
    themeToggle: document.getElementById('theme-toggle'),
    configStatus: document.getElementById('config-status'),
    lastSyncTime: document.getElementById('last-sync-time'),
    syncBtn: document.getElementById('sync-btn'),
    settingsBtn: document.getElementById('settings-btn'),

    statTotalGames: document.getElementById('stat-total-games'),
    statTotalPlaytime: document.getElementById('stat-total-playtime'),
    statSharedGames: document.getElementById('stat-shared-games'),
    statCompletedGames: document.getElementById('stat-completed-games'),

    insightsSection: document.getElementById('insights-section'),
    insightBacklogGames: document.getElementById('insight-backlog-games'),
    insightBacklogHours: document.getElementById('insight-backlog-hours'),
    insightClearTime: document.getElementById('insight-clear-time'),
    insightPaceNote: document.getElementById('insight-pace-note'),
    insightNeglectedBtn: document.getElementById('insight-neglected-btn'),
    insightNeglectedName: document.getElementById('insight-neglected-name'),
    insightNeglectedTime: document.getElementById('insight-neglected-time'),
    suggestNextBtn: document.getElementById('suggest-next-btn'),
    suggestedGameBtn: document.getElementById('suggested-game-btn'),
    suggestedGameName: document.getElementById('suggested-game-name'),
    suggestedGameTime: document.getElementById('suggested-game-time'),
    pacePills: document.querySelectorAll('.pace-pill'),

    loadingView: document.getElementById('loading-view'),
    loadingTitle: document.getElementById('loading-title'),
    loadingSubtitle: document.getElementById('loading-subtitle'),
    errorView: document.getElementById('error-view'),
    errorTitle: document.getElementById('error-title'),
    errorMessage: document.getElementById('error-message'),
    errorOpenSettingsBtn: document.getElementById('error-open-settings-btn'),
    errorRetryBtn: document.getElementById('error-retry-btn'),

    librarySection: document.getElementById('library-section'),
    searchInput: document.getElementById('search-input'),
    searchClearBtn: document.getElementById('search-clear-btn'),
    sortSelect: document.getElementById('sort-select'),
    toggleAdvancedBtn: document.getElementById('toggle-advanced-btn'),
    activeFilterCount: document.getElementById('active-filter-count'),
    advancedDrawer: document.getElementById('advanced-filters-drawer'),
    filterPills: document.querySelectorAll('.filter-pill'),
    hltbTimeCategory: document.getElementById('hltb-time-category'),
    hltbMinTime: document.getElementById('hltb-min-time'),
    hltbMaxTime: document.getElementById('hltb-max-time'),
    genreSelect: document.getElementById('genre-filter-select'),
    hideZeroCheckbox: document.getElementById('hide-zero-hours-checkbox'),
    resetFiltersBtn: document.getElementById('reset-filters-btn'),
    hltbSyncStatus: document.getElementById('hltb-sync-status'),
    hltbSyncPercent: document.getElementById('hltb-sync-percent'),
    visibleGamesCount: document.getElementById('visible-games-count'),
    gamesGrid: document.getElementById('games-grid'),
    scrollSentinel: document.getElementById('scroll-sentinel'),

    settingsModal: document.getElementById('settings-modal'),
    closeSettingsBtn: document.getElementById('close-settings-btn'),
    cancelSettingsBtn: document.getElementById('cancel-settings-btn'),
    settingsForm: document.getElementById('settings-form'),
    settingsApiKey: document.getElementById('settings-api-key'),
    settingsSteamId: document.getElementById('settings-steam-id'),
    settingsFamilyIds: document.getElementById('settings-family-ids'),
    themePickerGrid: document.getElementById('theme-picker-grid'),
    settingsSoundToggle: document.getElementById('settings-sound-toggle'),
    saveSettingsBtn: document.getElementById('save-settings-btn'),

    syncModal: document.getElementById('sync-options-modal'),
    closeSyncModalBtn: document.getElementById('close-sync-modal-btn'),
    quickSyncBtn: document.getElementById('quick-sync-btn'),
    fullSyncBtn: document.getElementById('full-sync-btn'),

    rematchModal: document.getElementById('rematch-modal'),
    closeRematchBtn: document.getElementById('close-rematch-btn'),
    rematchSubtitle: document.getElementById('rematch-subtitle'),
    rematchSearchInput: document.getElementById('rematch-search-input'),
    rematchSearchBtn: document.getElementById('rematch-search-btn'),
    rematchResults: document.getElementById('rematch-results'),

    detailPanel: document.getElementById('game-detail-panel'),
    panelOverlay: document.getElementById('panel-overlay'),
    closeDetailBtn: document.getElementById('close-detail-btn'),
    detailCover: document.getElementById('detail-cover'),
    detailCoverFallback: document.getElementById('detail-cover-fallback'),
    detailPlaytimeBadge: document.getElementById('detail-playtime-badge'),
    detailTitle: document.getElementById('detail-title'),
    detailBadges: document.getElementById('detail-badges'),
    detailBeatToggleBtn: document.getElementById('detail-beat-toggle-btn'),
    detailRematchBtn: document.getElementById('detail-rematch-btn'),
    detailRefreshBtn: document.getElementById('detail-refresh-btn'),
    detailHltbState: document.getElementById('detail-hltb-state'),
    detailHltbStats: document.getElementById('detail-hltb-stats'),
    detailTimeMain: document.getElementById('detail-time-main'),
    detailTimeExtra: document.getElementById('detail-time-extra'),
    detailTimeComp: document.getElementById('detail-time-completionist'),
    detailProgressMain: document.getElementById('detail-progress-main'),
    detailProgressExtra: document.getElementById('detail-progress-extra'),
    detailProgressComp: document.getElementById('detail-progress-completionist'),
    detailMetaSection: document.getElementById('detail-meta-section'),
    detailMetaGenres: document.getElementById('detail-meta-genres'),
    detailMetaDev: document.getElementById('detail-meta-dev'),
    detailMetaYear: document.getElementById('detail-meta-year'),
    detailMetaGenreRow: document.getElementById('detail-meta-genre-row'),
    detailMetaDevRow: document.getElementById('detail-meta-dev-row'),
    detailMetaYearRow: document.getElementById('detail-meta-year-row'),
    detailSteamLink: document.getElementById('detail-steam-link'),
    detailHltbLink: document.getElementById('detail-hltb-link'),

    toastContainer: document.getElementById('toast-container')
  };

  // ==========================================================================
  // UTILITIES
  // ==========================================================================

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function throttle(fn, wait) {
    let last = 0;
    let timer = null;
    return (...args) => {
      const now = Date.now();
      const remaining = wait - (now - last);
      if (remaining <= 0) {
        clearTimeout(timer);
        timer = null;
        last = now;
        fn(...args);
      } else if (!timer) {
        timer = setTimeout(() => {
          last = Date.now();
          timer = null;
          fn(...args);
        }, remaining);
      }
    };
  }

  function showToast(message, type = 'info') {
    const icon = type === 'success'
      ? 'fa-circle-check'
      : type === 'error'
        ? 'fa-circle-exclamation'
        : 'fa-circle-info';

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<i class="fa-solid ${icon}"></i><span>${escapeHtml(message)}</span>`;
    el.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(6px)';
      toast.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      setTimeout(() => toast.remove(), 220);
    }, 3200);
  }

  function formatRelativeSync(timestamp) {
    if (!timestamp) return '';
    const diffSec = Math.floor((Date.now() - timestamp) / 1000);
    if (diffSec < 60) return 'Synced just now';
    if (diffSec < 3600) return `Synced ${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `Synced ${Math.floor(diffSec / 3600)}h ago`;
    return `Synced ${new Date(timestamp).toLocaleDateString()}`;
  }

  function isEndlessOrUtility(name) {
    const lower = String(name || '').toLowerCase().trim();
    if (ENDLESS_BLOCKLIST.some(b => lower === b || lower.includes(b))) return true;
    return NON_STORY_KEYWORDS.some(k => lower.includes(k));
  }

  function isGameBeaten(game) {
    if (state.manualUnbeaten.has(game.appid)) return false;
    if (state.manualBeaten.has(game.appid)) return true;
    if (!game.hltb || game.hltb.notFound) return false;
    const playHrs = (game.playtime_forever || 0) / 60;
    const mainHrs = game.hltb.gameplayMain || 0;
    return playHrs > 0 && mainHrs > 0 && playHrs >= mainHrs;
  }

  function hasHltbHours(hltb) {
    if (!hltb || hltb.notFound) return false;
    return (hltb.gameplayMain || 0) > 0 || (hltb.gameplayMainExtra || 0) > 0 || (hltb.gameplayCompletionist || 0) > 0;
  }

  function setControlsEnabled(enabled) {
    el.searchInput.disabled = !enabled;
    el.sortSelect.disabled = !enabled;
    el.hltbTimeCategory.disabled = !enabled;
    el.hltbMinTime.disabled = !enabled;
    el.hltbMaxTime.disabled = !enabled;
    el.genreSelect.disabled = !enabled;
    el.hideZeroCheckbox.disabled = !enabled;
    syncAllCustomSelects();
  }

  function setStatusPill(status, label) {
    el.configStatus.className = `status-pill status-${status}`;
    el.configStatus.querySelector('.status-label').textContent = label;
  }

  // ==========================================================================
  // WEB AUDIO SOUND ENGINE (Buttons-Only, Wii U-Inspired Mood Profiles)
  // ==========================================================================

  const SoundFX = (() => {
    let ctx = null;
    let enabled = localStorage.getItem('soundEnabled') !== 'false';
    let lastHoverAt = 0;
    let hoverToggle = false;

    function getTheme() {
      return document.documentElement.getAttribute('data-theme') || 'ceramic';
    }

    function ensureContext(allowCreate = true) {
      if (!enabled) return null;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      if (!ctx && allowCreate) ctx = new AudioCtx();
      if (ctx && ctx.state === 'suspended' && allowCreate) {
        ctx.resume().catch(() => {});
      }
      return ctx;
    }

    // Warm filtered voice: soft rounded attack, smooth exponential tail, gentle 2nd harmonic
    function note(ac, {
      freq = 660,
      endFreq = null,
      dur = 0.11,
      gain = 0.07,
      delay = 0,
      cutoff = 2400,
      type = 'sine',
      overtone = 0.18
    } = {}) {
      const now = ac.currentTime + delay;
      const filter = ac.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(cutoff, now);
      filter.Q.setValueAtTime(0.7, now);

      const env = ac.createGain();
      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(gain, now + 0.014);
      env.gain.exponentialRampToValueAtTime(0.0001, now + dur);

      const osc1 = ac.createOscillator();
      osc1.type = type;
      osc1.frequency.setValueAtTime(freq, now);
      if (endFreq) {
        osc1.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), now + dur * 0.85);
      }
      osc1.connect(filter);

      if (overtone > 0) {
        const osc2 = ac.createOscillator();
        const g2 = ac.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(freq * 2, now);
        if (endFreq) {
          osc2.frequency.exponentialRampToValueAtTime(Math.max(80, endFreq * 2), now + dur * 0.85);
        }
        g2.gain.setValueAtTime(overtone, now);
        osc2.connect(g2);
        g2.connect(filter);
        osc2.start(now);
        osc2.stop(now + dur + 0.02);
      }

      filter.connect(env);
      env.connect(ac.destination);
      osc1.start(now);
      osc1.stop(now + dur + 0.02);
    }

    const PROFILES = {
      // Wii Ceramic: sunny Nintendo Wii U Menu ceramic marimba & porcelain
      ceramic: {
        hover(ac, shift) {
          note(ac, { freq: 520 * shift, endFreq: 640 * shift, dur: 0.042, gain: 0.017, cutoff: 1550, overtone: 0.08 });
        },
        cardHover(ac, shift) {
          note(ac, { freq: 440 * shift, endFreq: 510 * shift, dur: 0.036, gain: 0.012, cutoff: 1250, overtone: 0.05 });
        },
        primary(ac) {
          note(ac, { freq: 587.33, dur: 0.11, gain: 0.065, cutoff: 2300, overtone: 0.2 });
          note(ac, { freq: 880.00, dur: 0.16, gain: 0.055, delay: 0.048, cutoff: 2500, overtone: 0.15 });
        },
        secondary(ac) {
          note(ac, { freq: 659.25, endFreq: 783.99, dur: 0.095, gain: 0.05, cutoff: 2200, overtone: 0.14 });
        },
        tab(ac) {
          note(ac, { freq: 783.99, dur: 0.075, gain: 0.042, cutoff: 2100, overtone: 0.12 });
        },
        back(ac) {
          note(ac, { freq: 783.99, dur: 0.09, gain: 0.05, cutoff: 2100, overtone: 0.14 });
          note(ac, { freq: 523.25, dur: 0.14, gain: 0.05, delay: 0.05, cutoff: 1900, overtone: 0.1 });
        },
        toggle(ac) {
          note(ac, { freq: 523.25, dur: 0.12, gain: 0.05, cutoff: 2400, overtone: 0.16 });
          note(ac, { freq: 659.25, dur: 0.14, gain: 0.05, delay: 0.055, cutoff: 2400, overtone: 0.16 });
          note(ac, { freq: 783.99, dur: 0.19, gain: 0.052, delay: 0.11, cutoff: 2600, overtone: 0.18 });
        }
      },

      // Crystal Vista (Frutiger Aero): aquatic glass bells & eShop crystal chimes
      aero: {
        hover(ac, shift) {
          note(ac, { freq: 660 * shift, endFreq: 860 * shift, dur: 0.048, gain: 0.017, cutoff: 2100, overtone: 0.14 });
        },
        cardHover(ac, shift) {
          note(ac, { freq: 560 * shift, endFreq: 710 * shift, dur: 0.042, gain: 0.012, cutoff: 1700, overtone: 0.09 });
        },
        primary(ac) {
          note(ac, { freq: 659.25, endFreq: 783.99, dur: 0.13, gain: 0.06, cutoff: 3200, overtone: 0.24 });
          note(ac, { freq: 1174.66, dur: 0.21, gain: 0.048, delay: 0.045, cutoff: 3600, overtone: 0.18 });
        },
        secondary(ac) {
          note(ac, { freq: 493.88, endFreq: 739.99, dur: 0.11, gain: 0.052, cutoff: 3000, overtone: 0.2 });
        },
        tab(ac) {
          note(ac, { freq: 880.00, endFreq: 1046.50, dur: 0.09, gain: 0.044, cutoff: 3100, overtone: 0.18 });
        },
        back(ac) {
          note(ac, { freq: 880.00, dur: 0.1, gain: 0.048, cutoff: 2800, overtone: 0.18 });
          note(ac, { freq: 587.33, dur: 0.16, gain: 0.048, delay: 0.05, cutoff: 2500, overtone: 0.14 });
        },
        toggle(ac) {
          note(ac, { freq: 587.33, dur: 0.14, gain: 0.048, cutoff: 3200, overtone: 0.22 });
          note(ac, { freq: 739.99, dur: 0.16, gain: 0.048, delay: 0.055, cutoff: 3300, overtone: 0.22 });
          note(ac, { freq: 880.00, dur: 0.18, gain: 0.048, delay: 0.11, cutoff: 3400, overtone: 0.22 });
          note(ac, { freq: 1174.66, dur: 0.26, gain: 0.045, delay: 0.165, cutoff: 3600, overtone: 0.2 });
        }
      },

      // Noir Editorial (Dark Default): warm muted felt-piano / quiet late-night study key
      obsidian: {
        hover(ac, shift) {
          note(ac, { freq: 245 * shift, endFreq: 205 * shift, dur: 0.036, gain: 0.015, cutoff: 760, overtone: 0.04 });
        },
        cardHover(ac, shift) {
          note(ac, { freq: 210 * shift, endFreq: 185 * shift, dur: 0.032, gain: 0.011, cutoff: 620, overtone: 0.02 });
        },
        primary(ac) {
          note(ac, { freq: 293.66, dur: 0.12, gain: 0.055, cutoff: 1100, overtone: 0.1 });
          note(ac, { freq: 440.00, dur: 0.16, gain: 0.048, delay: 0.05, cutoff: 1200, overtone: 0.08 });
        },
        secondary(ac) {
          note(ac, { freq: 329.63, endFreq: 293.66, dur: 0.085, gain: 0.045, cutoff: 1000, overtone: 0.08 });
        },
        tab(ac) {
          note(ac, { freq: 392.00, dur: 0.07, gain: 0.038, cutoff: 980, overtone: 0.06 });
        },
        back(ac) {
          note(ac, { freq: 440.00, dur: 0.09, gain: 0.042, cutoff: 1050, overtone: 0.08 });
          note(ac, { freq: 293.66, dur: 0.14, gain: 0.042, delay: 0.05, cutoff: 900, overtone: 0.06 });
        },
        toggle(ac) {
          note(ac, { freq: 293.66, dur: 0.14, gain: 0.045, cutoff: 1100, overtone: 0.08 });
          note(ac, { freq: 349.23, dur: 0.16, gain: 0.045, delay: 0.06, cutoff: 1150, overtone: 0.08 });
          note(ac, { freq: 440.00, dur: 0.2, gain: 0.045, delay: 0.12, cutoff: 1200, overtone: 0.1 });
        }
      },

      // Cyber Chrome (Y2K): sleek rounded console glass-synth & holographic chimes
      y2k: {
        hover(ac, shift) {
          note(ac, { freq: 470 * shift, endFreq: 575 * shift, dur: 0.036, gain: 0.015, cutoff: 1650, type: 'sine', overtone: 0.06 });
        },
        cardHover(ac, shift) {
          note(ac, { freq: 380 * shift, endFreq: 455 * shift, dur: 0.032, gain: 0.011, cutoff: 1350, type: 'sine', overtone: 0.04 });
        },
        primary(ac) {
          note(ac, { freq: 523.25, dur: 0.11, gain: 0.05, cutoff: 2600, type: 'triangle', overtone: 0.14 });
          note(ac, { freq: 987.77, dur: 0.18, gain: 0.044, delay: 0.045, cutoff: 2800, type: 'sine', overtone: 0.2 });
        },
        secondary(ac) {
          note(ac, { freq: 440.00, endFreq: 659.25, dur: 0.085, gain: 0.042, cutoff: 2400, type: 'triangle', overtone: 0.1 });
        },
        tab(ac) {
          note(ac, { freq: 739.99, dur: 0.068, gain: 0.038, cutoff: 2400, type: 'triangle', overtone: 0.1 });
        },
        back(ac) {
          note(ac, { freq: 783.99, dur: 0.085, gain: 0.042, cutoff: 2300, type: 'triangle', overtone: 0.1 });
          note(ac, { freq: 493.88, dur: 0.14, gain: 0.042, delay: 0.048, cutoff: 2000, type: 'sine', overtone: 0.1 });
        },
        toggle(ac) {
          note(ac, { freq: 392.00, dur: 0.12, gain: 0.042, cutoff: 2600, type: 'triangle', overtone: 0.12 });
          note(ac, { freq: 587.33, dur: 0.14, gain: 0.044, delay: 0.055, cutoff: 2700, type: 'sine', overtone: 0.16 });
          note(ac, { freq: 987.77, dur: 0.22, gain: 0.042, delay: 0.11, cutoff: 2900, type: 'sine', overtone: 0.2 });
        }
      }
    };

    function play(kind) {
      if (!enabled) return;
      const isHover = kind === 'hover' || kind === 'cardHover';
      if (isHover) {
        const nowMs = performance.now();
        const cooldown = kind === 'cardHover' ? 95 : 75;
        if (nowMs - lastHoverAt < cooldown) return;
        lastHoverAt = nowMs;
      }

      const ac = ensureContext(!isHover);
      if (!ac) return;
      if (isHover && ac.state !== 'running') return;

      const fire = () => {
        const profile = PROFILES[getTheme()] || PROFILES.ceramic;
        const fn = profile[kind] || profile.secondary;
        if (isHover) {
          hoverToggle = !hoverToggle;
          fn(ac, hoverToggle ? 1.0 : 1.045);
        } else {
          fn(ac);
        }
      };

      if (ac.state === 'running') {
        fire();
      } else {
        ac.resume().then(fire).catch(() => {});
      }
    }

    function init() {
      const unlock = () => ensureContext(true);
      window.addEventListener('pointerdown', unlock, { passive: true });
      window.addEventListener('keydown', unlock, { passive: true });

      const HOVER_BTN_SELECTOR = '.btn, .filter-pill, .pace-pill, .btn-icon, .drawer-close-btn, .theme-switch, .theme-option-card, .choice-card, .text-action-btn, .rematch-item, .search-clear-btn, .select-trigger, .select-option';
      const HOVER_SOFT_SELECTOR = '.game-card, .insight-link-btn, .setup-steps a, .field-hint a, .checkbox-field, .kpi-tile';

      document.addEventListener('pointerover', (e) => {
        const target = e.target instanceof Element ? e.target : null;
        if (!target) return;

        const btn = target.closest(HOVER_BTN_SELECTOR);
        if (btn) {
          const fromBtn = e.relatedTarget instanceof Element ? e.relatedTarget.closest(HOVER_BTN_SELECTOR) : null;
          if (fromBtn === btn || btn.disabled) return;
          play('hover');
          return;
        }

        const soft = target.closest(HOVER_SOFT_SELECTOR);
        if (soft) {
          const fromSoft = e.relatedTarget instanceof Element ? e.relatedTarget.closest(HOVER_SOFT_SELECTOR) : null;
          if (fromSoft === soft || soft.disabled) return;
          if (soft.classList.contains('kpi-tile') && getTheme() !== 'aero') return;
          play('cardHover');
        }
      });

      document.addEventListener('click', (e) => {
        const target = e.target instanceof Element ? e.target : null;
        if (!target) return;

        // Theme toggle & theme picker cards play their own 'toggle' chime
        if (target.closest('#theme-toggle, .theme-option-card')) return;

        if (target.closest('.drawer-close-btn, #close-settings-btn, #close-sync-modal-btn, #close-rematch-btn, #cancel-settings-btn')) {
          play('back');
        } else if (target.closest('.filter-pill, .pace-pill, .select-option')) {
          play('tab');
        } else if (target.closest('.btn-primary, #suggest-next-btn, .choice-card, .insight-link-btn:not(:disabled)')) {
          play('primary');
        } else if (target.closest('.btn-secondary, .btn-ghost, .btn-icon, .text-action-btn, .rematch-item, .search-clear-btn, .select-trigger')) {
          play('secondary');
        }
      });
    }

    return {
      isEnabled: () => enabled,
      setEnabled(val) {
        enabled = Boolean(val);
        localStorage.setItem('soundEnabled', String(enabled));
      },
      play,
      init
    };
  })();

  // ==========================================================================
  // THEME MANAGEMENT (4 Themes + Mix-and-Match Light/Dark Pairs)
  // ==========================================================================

  const THEME_LABELS = {
    ceramic: 'Wii Ceramic',
    obsidian: 'Noir Editorial',
    aero: 'Crystal Vista',
    y2k: 'Cyber Chrome'
  };

  function initTheme() {
    const legacy = localStorage.getItem('theme');
    let themeMode = localStorage.getItem('themeMode') || (legacy === 'dark' ? 'dark' : 'light');
    let lightTheme = localStorage.getItem('lightTheme') || 'ceramic';
    let darkTheme = localStorage.getItem('darkTheme') || 'obsidian';

    if (lightTheme !== 'ceramic' && lightTheme !== 'aero') lightTheme = 'ceramic';
    if (darkTheme !== 'obsidian' && darkTheme !== 'y2k') darkTheme = 'obsidian';
    if (themeMode !== 'light' && themeMode !== 'dark') themeMode = 'light';

    const applyTheme = () => {
      const activeTheme = themeMode === 'dark' ? darkTheme : lightTheme;
      document.documentElement.setAttribute('data-mode', themeMode);
      document.documentElement.setAttribute('data-theme', activeTheme);
      localStorage.setItem('themeMode', themeMode);
      localStorage.setItem('lightTheme', lightTheme);
      localStorage.setItem('darkTheme', darkTheme);
      localStorage.setItem('theme', themeMode);

      el.themeToggle.setAttribute('aria-checked', String(themeMode === 'dark'));
      el.themeToggle.title = `Switch between ${THEME_LABELS[lightTheme]} and ${THEME_LABELS[darkTheme]}`;

      if (el.themePickerGrid) {
        el.themePickerGrid.querySelectorAll('.theme-option-card').forEach((btn) => {
          const choice = btn.dataset.themeChoice;
          btn.classList.toggle('is-active', choice === activeTheme);
          btn.classList.toggle('is-paired', choice === lightTheme || choice === darkTheme);
        });
      }
    };

    applyTheme();

    el.themeToggle.addEventListener('click', () => {
      themeMode = themeMode === 'dark' ? 'light' : 'dark';
      applyTheme();
      SoundFX.play('toggle');
    });

    if (el.themePickerGrid) {
      el.themePickerGrid.addEventListener('click', (e) => {
        const card = e.target.closest('.theme-option-card');
        if (!card) return;
        const choice = card.dataset.themeChoice;
        const polarity = card.dataset.themePolarity;
        if (polarity === 'dark') {
          darkTheme = choice;
          themeMode = 'dark';
        } else {
          lightTheme = choice;
          themeMode = 'light';
        }
        applyTheme();
        SoundFX.play('toggle');
      });
    }

    if (el.settingsSoundToggle) {
      el.settingsSoundToggle.checked = SoundFX.isEnabled();
      el.settingsSoundToggle.addEventListener('change', () => {
        SoundFX.setEnabled(el.settingsSoundToggle.checked);
        if (el.settingsSoundToggle.checked) {
          SoundFX.play('tab');
        }
      });
    }

    // Restrict pinch/zoom only in Electron wrapper, never break normal browser zoom
    if (document.documentElement.classList.contains('is-electron')) {
      window.addEventListener('keydown', (e) => {
        if (e.ctrlKey && ['=', '-', '+', '0'].includes(e.key)) e.preventDefault();
      });
    }
  }

  // ==========================================================================
  // DATA LOADING & SYNCING
  // ==========================================================================

  function indexGames(list) {
    state.games = list.map(g => ({
      ...g,
      hltb: g.hltb || null,
      hltbLoading: false,
      hltbError: false
    }));
    state.gamesById.clear();
    for (const g of state.games) {
      state.gamesById.set(g.appid, g);
    }
  }

  async function fetchLibrary() {
    el.loadingView.hidden = false;
    el.errorView.hidden = true;
    el.librarySection.hidden = true;
    el.loadingTitle.textContent = 'Loading your library';
    el.loadingSubtitle.textContent = 'Reading cached games and playtime data...';

    try {
      const res = await fetch('/api/games');
      if (!res.ok) throw new Error('Could not reach local server.');
      const data = await res.json();

      state.manualBeaten = new Set(data.manualBeaten || []);
      state.manualUnbeaten = new Set(data.manualUnbeaten || []);
      state.lastSync = data.lastSync || 0;
      indexGames(data.games || []);

      if (!data.configured && state.games.length === 0) {
        setStatusPill('error', 'Setup needed');
        el.syncBtn.hidden = true;
        el.loadingView.hidden = true;
        el.errorView.hidden = false;
        el.errorTitle.textContent = 'Connect Your Steam Account';
        el.errorMessage.textContent = 'Add your Steam Web API Key and Steam ID in Settings to import your library and Family Sharing games.';
        return;
      }

      setStatusPill('connected', 'Steam Connected');
      el.syncBtn.hidden = false;
      if (state.lastSync > 0) {
        el.lastSyncTime.textContent = formatRelativeSync(state.lastSync);
        el.lastSyncTime.hidden = false;
      } else {
        el.lastSyncTime.hidden = true;
      }

      el.loadingView.hidden = true;
      el.librarySection.hidden = false;

      if (state.games.length === 0) {
        setControlsEnabled(false);
        updateStatsAndInsights();
        renderUnsyncedState();
      } else {
        setControlsEnabled(true);
        populateGenreDropdown();
        updateStatsAndInsights();
        applyFiltersAndRender();
      }
    } catch (err) {
      console.error('Library load failed:', err);
      setStatusPill('error', 'Offline');
      el.loadingView.hidden = true;
      el.errorView.hidden = false;
      el.errorTitle.textContent = 'Connection Error';
      el.errorMessage.textContent = err.message || 'Could not load library from server.';
    }
  }

  function renderUnsyncedState() {
    el.visibleGamesCount.textContent = '0';
    el.gamesGrid.innerHTML = `
      <div class="state-card" style="grid-column: 1 / -1;">
        <div class="state-icon"><i class="fa-solid fa-cloud-arrow-down"></i></div>
        <h3>Your library is ready to sync</h3>
        <p>Import your owned and Steam Family Sharing games along with HowLongToBeat durations.</p>
        <button type="button" class="btn btn-primary" data-action="sync-now">
          <i class="fa-solid fa-arrows-rotate"></i> Sync Library Now
        </button>
      </div>
    `;
  }

  async function triggerSync(force = false) {
    el.syncModal.hidden = true;
    el.syncBtn.disabled = true;
    el.syncBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i><span>Syncing...</span>';

    const wasEmpty = state.games.length === 0;
    if (wasEmpty) {
      el.loadingView.hidden = false;
      el.loadingTitle.textContent = 'Syncing Steam library';
      el.loadingSubtitle.textContent = 'Fetching owned and Family Sharing titles from Steam...';
      el.librarySection.hidden = true;
      el.errorView.hidden = true;
    }

    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Steam sync failed.');

      state.manualBeaten = new Set(data.manualBeaten || []);
      state.manualUnbeaten = new Set(data.manualUnbeaten || []);
      state.lastSync = data.lastSync || Date.now();
      indexGames(data.games || []);

      el.lastSyncTime.textContent = formatRelativeSync(state.lastSync);
      el.lastSyncTime.hidden = false;
      setStatusPill('connected', 'Steam Connected');

      el.loadingView.hidden = true;
      el.librarySection.hidden = false;
      setControlsEnabled(state.games.length > 0);

      populateGenreDropdown();
      updateStatsAndInsights();
      applyFiltersAndRender();
      showToast(`Synced ${state.games.length} titles from Steam.`, 'success');

      startHltbSync();
    } catch (err) {
      console.error('Sync failed:', err);
      showToast(err.message || 'Sync failed.', 'error');
      if (wasEmpty) {
        el.loadingView.hidden = true;
        el.errorView.hidden = false;
        el.errorTitle.textContent = 'Sync Failed';
        el.errorMessage.textContent = err.message || 'Verify your Steam API key and profile privacy settings.';
      }
    } finally {
      el.syncBtn.disabled = false;
      el.syncBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i><span>Sync Library</span>';
    }
  }

  // ==========================================================================
  // HLTB BACKGROUND QUEUE (Throttled UI Updates)
  // ==========================================================================

  const throttledStatsUpdate = throttle(() => {
    updateStatsAndInsights();
    populateGenreDropdown();
  }, 600);

  function startHltbSync() {
    const missing = state.games.filter(g => !g.hltb);
    if (missing.length === 0) {
      el.hltbSyncStatus.hidden = true;
      return;
    }

    // Prioritize games the user has played
    missing.sort((a, b) => (b.playtime_forever || 0) - (a.playtime_forever || 0));
    state.syncQueue = missing;
    state.syncTotal = missing.length;
    state.syncDone = 0;

    el.hltbSyncStatus.hidden = false;
    updateSyncBadge();

    const toSpawn = Math.min(MAX_CONCURRENT_SYNC - state.activeWorkers, state.syncQueue.length);
    for (let i = 0; i < toSpawn; i++) {
      runSyncWorker();
    }
  }

  async function runSyncWorker() {
    if (state.syncQueue.length === 0) {
      if (state.activeWorkers === 0) {
        updateStatsAndInsights();
        populateGenreDropdown();
        updateSyncBadge();
      }
      return;
    }

    state.activeWorkers++;
    const game = state.syncQueue.shift();
    game.hltbLoading = true;
    patchGameCard(game);

    try {
      const res = await fetch(`/api/hltb?title=${encodeURIComponent(game.name)}&appid=${game.appid}`);
      if (!res.ok) throw new Error('HLTB fetch error');
      game.hltb = await res.json();
      game.hltbError = false;
    } catch (err) {
      console.warn(`HLTB sync failed for "${game.name}":`, err.message);
      game.hltbError = true;
    } finally {
      game.hltbLoading = false;
      state.syncDone++;
      state.activeWorkers--;
    }

    patchGameCard(game);
    if (state.activeDetailAppId === game.appid) {
      renderDetailDrawer(game);
    }
    throttledStatsUpdate();
    updateSyncBadge();

    if (state.syncQueue.length > 0) {
      setTimeout(runSyncWorker, 120);
    } else if (state.activeWorkers === 0) {
      updateStatsAndInsights();
      populateGenreDropdown();
      setTimeout(() => {
        if (state.syncQueue.length === 0 && state.activeWorkers === 0) {
          el.hltbSyncStatus.hidden = true;
        }
      }, 2400);
    }
  }

  function updateSyncBadge() {
    const pct = state.syncTotal > 0 ? Math.min(100, Math.round((state.syncDone / state.syncTotal) * 100)) : 100;
    el.hltbSyncPercent.textContent = `${pct}%`;
  }

  // ==========================================================================
  // STATS & INSIGHTS
  // ==========================================================================

  function updateStatsAndInsights() {
    const total = state.games.length;
    const totalMins = state.games.reduce((sum, g) => sum + (g.playtime_forever || 0), 0);
    const shared = state.games.filter(g => !g.is_owned).length;
    const completed = state.games.filter(g => isGameBeaten(g)).length;

    el.statTotalGames.textContent = total.toLocaleString();
    el.statTotalPlaytime.textContent = `${Math.round(totalMins / 60).toLocaleString()}h`;
    el.statSharedGames.textContent = shared.toLocaleString();
    el.statCompletedGames.textContent = completed.toLocaleString();

    if (total === 0) {
      el.insightsSection.hidden = true;
      return;
    }
    el.insightsSection.hidden = false;

    // Active backlog (owned, unfinished, non-endless)
    const backlog = state.games.filter(g => {
      if (!g.is_owned || isEndlessOrUtility(g.name) || isGameBeaten(g)) return false;
      if (!g.hltb || g.hltb.notFound) return (g.playtime_forever || 0) === 0;
      return true;
    });

    const backlogHours = Math.round(backlog.reduce((sum, g) => {
      const played = (g.playtime_forever || 0) / 60;
      const main = (g.hltb && !g.hltb.notFound && g.hltb.gameplayMain > 0) ? g.hltb.gameplayMain : 8;
      return sum + Math.max(0, main - played);
    }, 0));

    el.insightBacklogGames.textContent = `${backlog.length.toLocaleString()} games`;
    el.insightBacklogHours.textContent = `${backlogHours.toLocaleString()}h estimated remaining`;

    // Clearance estimate
    const weeks = backlogHours / state.weeklyPace;
    const months = Math.ceil(weeks / 4.33);
    if (backlogHours === 0) {
      el.insightClearTime.textContent = 'Cleared';
    } else if (months < 1) {
      el.insightClearTime.textContent = '< 1 month';
    } else if (months < 18) {
      el.insightClearTime.textContent = `~${months} ${months === 1 ? 'month' : 'months'}`;
    } else {
      const years = (months / 12).toFixed(1);
      el.insightClearTime.textContent = `~${years} years`;
    }
    el.insightPaceNote.textContent = `At ${state.weeklyPace} hrs/week`;

    // Longest unplayed owned gem
    const unplayed = state.games
      .filter(g => g.is_owned && (g.playtime_forever || 0) === 0 && g.hltb && !g.hltb.notFound && g.hltb.gameplayMain > 0 && !isEndlessOrUtility(g.name))
      .sort((a, b) => b.hltb.gameplayMain - a.hltb.gameplayMain);

    if (unplayed.length > 0) {
      const gem = unplayed[0];
      el.insightNeglectedName.textContent = gem.name;
      el.insightNeglectedTime.textContent = `${gem.hltb.gameplayMain}h main story`;
      el.insightNeglectedBtn.disabled = false;
      el.insightNeglectedBtn.dataset.appid = String(gem.appid);
    } else {
      el.insightNeglectedName.textContent = 'None found';
      el.insightNeglectedTime.textContent = 'Every rated game has been started';
      el.insightNeglectedBtn.disabled = true;
      delete el.insightNeglectedBtn.dataset.appid;
    }
  }

  function suggestNextGame() {
    const candidates = state.filteredGames.filter(g =>
      !isGameBeaten(g) &&
      !isEndlessOrUtility(g.name) &&
      g.hltb && !g.hltb.notFound && g.hltb.gameplayMain > 0
    );

    if (candidates.length === 0) {
      el.suggestedGameBtn.hidden = true;
      el.suggestedGameTime.textContent = 'No unfinished games with HLTB times in current view';
      return;
    }

    // Weight shorter unfinished games higher for quick backlog wins
    let totalWeight = 0;
    const weighted = candidates.map(g => {
      const remaining = Math.max(1, g.hltb.gameplayMain - ((g.playtime_forever || 0) / 60));
      const weight = 100 / remaining;
      totalWeight += weight;
      return { game: g, weight };
    });

    let roll = Math.random() * totalWeight;
    let pick = candidates[0];
    for (const entry of weighted) {
      roll -= entry.weight;
      if (roll <= 0) {
        pick = entry.game;
        break;
      }
    }

    el.suggestedGameName.textContent = pick.name;
    el.suggestedGameBtn.dataset.appid = String(pick.appid);
    el.suggestedGameBtn.hidden = false;
    el.suggestedGameTime.textContent = `${pick.hltb.gameplayMain}h main story · ${((pick.playtime_forever || 0) / 60).toFixed(1)}h played`;
  }

  // ==========================================================================
  // FILTERING, SORTING & INCREMENTAL RENDERING
  // ==========================================================================

  function normalizeGenreKey(raw) {
    return String(raw || '')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[-–—]+/g, '-')
      .toLowerCase();
  }

  function formatGenreLabel(raw) {
    const cleaned = String(raw || '').trim().replace(/\s+/g, ' ').replace(/[-–—]+/g, '-');
    if (!cleaned) return '';
    const lowercaseWords = new Set(['and', 'or', 'of', 'the', 'in', 'on', 'to', 'for', "'em", 'em']);
    return cleaned
      .split(' ')
      .map((word, idx) =>
        word
          .split('-')
          .map((part, pIdx) => {
            if (!part) return '';
            if (part.length <= 4 && part === part.toUpperCase() && /[A-Z]/.test(part)) return part;
            const lower = part.toLowerCase();
            if (idx > 0 && pIdx === 0 && lowercaseWords.has(lower)) return lower;
            return lower.replace(/[a-z]/, c => c.toUpperCase());
          })
          .join('-')
      )
      .join(' ');
  }

  function populateGenreDropdown() {
    const genreMap = new Map();
    for (const g of state.games) {
      if (g.hltb && g.hltb.genres) {
        for (const item of g.hltb.genres.split(',')) {
          const key = normalizeGenreKey(item);
          if (!key) continue;
          const formatted = formatGenreLabel(item);
          const existing = genreMap.get(key);
          // Prefer formatted label, or an existing uppercase-initial variant
          if (!existing || (existing === existing.toLowerCase() && formatted !== formatted.toLowerCase())) {
            genreMap.set(key, formatted);
          }
        }
      }
    }

    const sorted = Array.from(genreMap.entries()).sort((a, b) => a[1].localeCompare(b[1]));
    const currentKey = state.genre === 'all' ? 'all' : normalizeGenreKey(state.genre);
    el.genreSelect.innerHTML = '<option value="all">All Genres</option>' +
      sorted.map(([key, label]) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`).join('');
    if (genreMap.has(currentKey)) {
      state.genre = currentKey;
      el.genreSelect.value = currentKey;
    } else {
      state.genre = 'all';
      el.genreSelect.value = 'all';
    }
    syncCustomSelect(el.genreSelect);
  }

  function updateAdvancedBadge() {
    let count = 0;
    if (state.minTime !== null) count++;
    if (state.maxTime !== null) count++;
    if (state.genre !== 'all') count++;
    if (state.hideZero) count++;
    el.activeFilterCount.textContent = String(count);
    el.activeFilterCount.hidden = count === 0;
  }

  function applyFiltersAndRender() {
    updateAdvancedBadge();
    const q = state.search.toLowerCase().trim();

    state.filteredGames = state.games.filter(game => {
      if (q && !game.name.toLowerCase().includes(q)) return false;

      const playMins = game.playtime_forever || 0;
      const beaten = isGameBeaten(game);

      switch (state.filter) {
        case 'owned': if (!game.is_owned) return false; break;
        case 'shared': if (game.is_owned) return false; break;
        case 'in_progress': if (!(playMins > 0 && !beaten)) return false; break;
        case 'unplayed': if (playMins > 0) return false; break;
        case 'completed': if (!beaten) return false; break;
      }

      if (state.hideZero && !hasHltbHours(game.hltb)) return false;

      if (state.minTime !== null || state.maxTime !== null) {
        if (!game.hltb || game.hltb.notFound) return false;
        const hrs = state.timeCategory === 'extra'
          ? (game.hltb.gameplayMainExtra || 0)
          : state.timeCategory === 'completionist'
            ? (game.hltb.gameplayCompletionist || 0)
            : (game.hltb.gameplayMain || 0);
        if (hrs <= 0) return false;
        if (state.minTime !== null && hrs < state.minTime) return false;
        if (state.maxTime !== null && hrs > state.maxTime) return false;
      }

      if (state.genre !== 'all') {
        if (!game.hltb || !game.hltb.genres) return false;
        const targetGenre = normalizeGenreKey(state.genre);
        const list = game.hltb.genres.split(',').map(normalizeGenreKey);
        if (!list.includes(targetGenre)) return false;
      }

      return true;
    });

    sortFilteredGames();
    el.visibleGamesCount.textContent = state.filteredGames.length.toLocaleString();
    renderGridInitial();
  }

  function sortFilteredGames() {
    const getHltbVal = (g, field, fallback) => {
      if (!g.hltb || g.hltb.notFound) return fallback;
      const val = g.hltb[field] || 0;
      return val > 0 ? val : fallback;
    };

    const byName = (a, b) => a.name.localeCompare(b.name);

    state.filteredGames.sort((a, b) => {
      let diff = 0;
      switch (state.sort) {
        case 'playtime_asc': {
          // Put played games (> 0m) ascending first, Unplayed (0m) after
          const pa = (a.playtime_forever || 0) > 0 ? a.playtime_forever : Infinity;
          const pb = (b.playtime_forever || 0) > 0 ? b.playtime_forever : Infinity;
          diff = pa - pb;
          break;
        }
        case 'name_asc': return byName(a, b);
        case 'name_desc': return byName(b, a);
        case 'hltb_main_asc':
          diff = getHltbVal(a, 'gameplayMain', Infinity) - getHltbVal(b, 'gameplayMain', Infinity);
          break;
        case 'hltb_main_desc':
          diff = getHltbVal(b, 'gameplayMain', -Infinity) - getHltbVal(a, 'gameplayMain', -Infinity);
          break;
        case 'hltb_extra_asc':
          diff = getHltbVal(a, 'gameplayMainExtra', Infinity) - getHltbVal(b, 'gameplayMainExtra', Infinity);
          break;
        case 'hltb_extra_desc':
          diff = getHltbVal(b, 'gameplayMainExtra', -Infinity) - getHltbVal(a, 'gameplayMainExtra', -Infinity);
          break;
        case 'hltb_completionist_asc':
          diff = getHltbVal(a, 'gameplayCompletionist', Infinity) - getHltbVal(b, 'gameplayCompletionist', Infinity);
          break;
        case 'hltb_completionist_desc':
          diff = getHltbVal(b, 'gameplayCompletionist', -Infinity) - getHltbVal(a, 'gameplayCompletionist', -Infinity);
          break;
        case 'playtime_desc':
        default:
          diff = (b.playtime_forever || 0) - (a.playtime_forever || 0);
          break;
      }
      return diff !== 0 ? diff : byName(a, b);
    });
  }

  function createCardHtml(game) {
    const playHrsNum = (game.playtime_forever || 0) / 60;
    const playHrsText = playHrsNum > 0 ? `${playHrsNum.toFixed(1)}h` : 'Unplayed';
    const beaten = isGameBeaten(game);
    const imgUrl = `https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/header.jpg`;

    // Completion bar percentage
    let progressHtml = '';
    if (game.hltb && !game.hltb.notFound && game.hltb.gameplayMain > 0 && (playHrsNum > 0 || beaten)) {
      const pct = beaten ? 100 : Math.min(100, Math.round((playHrsNum / game.hltb.gameplayMain) * 100));
      progressHtml = `<div class="card-progress-bar"><div class="card-progress-fill" style="width:${pct}%"></div></div>`;
    }

    // Subtle subtitle (Year · First Genre)
    const subParts = [];
    if (game.hltb && game.hltb.releaseYear) subParts.push(String(game.hltb.releaseYear));
    if (game.hltb && game.hltb.genres) {
      const firstGenre = game.hltb.genres.split(',')[0].trim();
      if (firstGenre) subParts.push(firstGenre);
    }

    // HLTB strip
    let hltbHtml;
    if (game.hltbLoading) {
      hltbHtml = '<div class="hltb-status-row"><i class="fa-solid fa-circle-notch fa-spin"></i><span>Fetching times...</span></div>';
    } else if (game.hltbError) {
      hltbHtml = '<div class="hltb-status-row"><i class="fa-solid fa-circle-exclamation"></i><span>Lookup failed</span></div>';
    } else if (!game.hltb || game.hltb.notFound || !hasHltbHours(game.hltb)) {
      hltbHtml = '<div class="hltb-status-row"><span>No HLTB duration</span></div>';
    } else {
      const m = game.hltb.gameplayMain || 0;
      const e = game.hltb.gameplayMainExtra || 0;
      const c = game.hltb.gameplayCompletionist || 0;
      hltbHtml = `
        <div class="hltb-strip">
          <div class="hltb-cell ${m > 0 ? 'is-main' : 'is-empty'}">
            <span class="hltb-label">Main</span>
            <span class="hltb-val">${m > 0 ? `${m}h` : '—'}</span>
          </div>
          <div class="hltb-cell ${e > 0 ? 'is-extra' : 'is-empty'}">
            <span class="hltb-label">Extra</span>
            <span class="hltb-val">${e > 0 ? `${e}h` : '—'}</span>
          </div>
          <div class="hltb-cell ${c > 0 ? 'is-comp' : 'is-empty'}">
            <span class="hltb-label">100%</span>
            <span class="hltb-val">${c > 0 ? `${c}h` : '—'}</span>
          </div>
        </div>
      `;
    }

    return `
      <article class="game-card${beaten ? ' beaten' : ''}" data-appid="${game.appid}" tabindex="0" role="button" aria-label="${escapeHtml(game.name)}">
        <div class="card-media">
          <img src="${imgUrl}" alt="${escapeHtml(game.name)}" loading="lazy" decoding="async" data-cover-name="${escapeHtml(game.name)}">
          <div class="card-badges-top">
            ${!game.is_owned ? '<span class="pill-badge pill-shared"><i class="fa-solid fa-users"></i> Shared</span>' : ''}
            ${beaten ? '<span class="pill-badge pill-beaten"><i class="fa-solid fa-check"></i> Beaten</span>' : ''}
          </div>
          <span class="card-playtime">${playHrsText}</span>
          ${progressHtml}
        </div>
        <div class="card-body">
          <div class="card-title-row">
            <h3 class="game-title" title="${escapeHtml(game.name)}">${escapeHtml(game.name)}</h3>
            <span class="game-subtitle">${escapeHtml(subParts.join(' · '))}</span>
          </div>
          ${hltbHtml}
        </div>
      </article>
    `;
  }

  function renderGridInitial() {
    state.visibleCount = BATCH_SIZE;
    if (state.filteredGames.length === 0) {
      el.gamesGrid.innerHTML = `
        <div class="state-card" style="grid-column: 1 / -1;">
          <div class="state-icon"><i class="fa-regular fa-folder-open"></i></div>
          <h3>No matching titles</h3>
          <p>Try broadening your search or clearing active filters.</p>
          <button type="button" class="btn btn-secondary" data-action="reset-filters">Clear filters</button>
        </div>
      `;
      return;
    }

    const batch = state.filteredGames.slice(0, state.visibleCount);
    el.gamesGrid.innerHTML = batch.map(createCardHtml).join('');
  }

  function appendNextBatch() {
    if (state.visibleCount >= state.filteredGames.length) return;
    const next = state.filteredGames.slice(state.visibleCount, state.visibleCount + BATCH_SIZE);
    state.visibleCount += BATCH_SIZE;

    const fragment = document.createRange().createContextualFragment(next.map(createCardHtml).join(''));
    el.gamesGrid.appendChild(fragment);
  }

  function patchGameCard(game) {
    const existing = el.gamesGrid.querySelector(`.game-card[data-appid="${game.appid}"]`);
    if (!existing) return;
    const fragment = document.createRange().createContextualFragment(createCardHtml(game).trim());
    existing.replaceWith(fragment);
  }

  function initInfiniteScroll() {
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        appendNextBatch();
      }
    }, { rootMargin: '420px 0px' });
    observer.observe(el.scrollSentinel);
  }

  // ==========================================================================
  // GAME DETAIL DRAWER & MANUAL ACTIONS (Beat Toggle / Rematch / Refresh)
  // ==========================================================================

  function openGameDetail(appid) {
    const game = state.gamesById.get(Number(appid));
    if (!game) return;
    state.activeDetailAppId = game.appid;
    renderDetailDrawer(game);
    el.detailPanel.classList.add('open');
    el.detailPanel.setAttribute('aria-hidden', 'false');
    el.panelOverlay.hidden = false;
  }

  function closeGameDetail() {
    state.activeDetailAppId = null;
    el.detailPanel.classList.remove('open');
    el.detailPanel.setAttribute('aria-hidden', 'true');
    el.panelOverlay.hidden = true;
  }

  function renderDetailDrawer(game) {
    const imgUrl = `https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/header.jpg`;
    el.detailCoverFallback.hidden = true;
    el.detailCoverFallback.textContent = game.name;
    el.detailCover.hidden = false;
    el.detailCover.src = imgUrl;
    el.detailCover.alt = game.name;

    const playHrs = (game.playtime_forever || 0) / 60;
    el.detailPlaytimeBadge.textContent = `${playHrs.toFixed(1)}h played`;
    el.detailTitle.textContent = game.name;

    const beaten = isGameBeaten(game);
    const badges = [];
    badges.push(game.is_owned
      ? '<span class="drawer-chip">Owned</span>'
      : '<span class="drawer-chip chip-accent">Family Shared</span>');
    if (beaten) {
      badges.push('<span class="drawer-chip chip-success">Beaten</span>');
    } else if (playHrs > 0) {
      badges.push('<span class="drawer-chip">In Progress</span>');
    } else {
      badges.push('<span class="drawer-chip">Unplayed</span>');
    }
    el.detailBadges.innerHTML = badges.join('');

    el.detailBeatToggleBtn.innerHTML = beaten
      ? '<i class="fa-solid fa-rotate-left"></i><span>Unmark as Beaten</span>'
      : '<i class="fa-solid fa-check"></i><span>Mark as Beaten</span>';

    // HLTB progress bars
    const h = game.hltb;
    if (game.hltbLoading) {
      el.detailHltbState.textContent = 'Fetching HowLongToBeat times...';
      el.detailHltbState.hidden = false;
      el.detailHltbStats.hidden = true;
    } else if (!h || h.notFound || !hasHltbHours(h)) {
      el.detailHltbState.textContent = 'No HowLongToBeat times recorded. Try Re-match or Refresh.';
      el.detailHltbState.hidden = false;
      el.detailHltbStats.hidden = true;
    } else {
      el.detailHltbState.hidden = true;
      el.detailHltbStats.hidden = false;

      const setBar = (valEl, barEl, targetHrs) => {
        if (targetHrs > 0) {
          const pct = Math.min(100, Math.round((playHrs / targetHrs) * 100));
          valEl.textContent = `${targetHrs}h (${pct}%)`;
          barEl.style.width = `${pct}%`;
        } else {
          valEl.textContent = '—';
          barEl.style.width = '0%';
        }
      };

      setBar(el.detailTimeMain, el.detailProgressMain, h.gameplayMain || 0);
      setBar(el.detailTimeExtra, el.detailProgressExtra, h.gameplayMainExtra || 0);
      setBar(el.detailTimeComp, el.detailProgressComp, h.gameplayCompletionist || 0);
    }

    // Metadata
    const hasMeta = h && (h.genres || h.developers || h.releaseYear);
    if (hasMeta) {
      el.detailMetaSection.hidden = false;
      el.detailMetaGenreRow.hidden = !h.genres;
      el.detailMetaGenres.textContent = h.genres || '';
      el.detailMetaDevRow.hidden = !h.developers;
      el.detailMetaDev.textContent = h.developers || '';
      el.detailMetaYearRow.hidden = !h.releaseYear;
      el.detailMetaYear.textContent = h.releaseYear ? String(h.releaseYear) : '';
    } else {
      el.detailMetaSection.hidden = true;
    }

    el.detailSteamLink.href = `https://store.steampowered.com/app/${game.appid}`;
    el.detailHltbLink.href = (h && h.hltbId)
      ? `https://howlongtobeat.com/game/${h.hltbId}`
      : `https://howlongtobeat.com/?q=${encodeURIComponent(game.name)}`;
  }

  async function toggleBeatStatus() {
    const appid = state.activeDetailAppId;
    if (!appid) return;
    const game = state.gamesById.get(appid);
    if (!game) return;

    const currentlyBeaten = isGameBeaten(game);
    const nextState = currentlyBeaten ? 'unbeaten' : 'beaten';

    try {
      const res = await fetch(`/api/games/${appid}/beat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: nextState })
      });
      if (!res.ok) throw new Error('Could not update beat status.');
      const data = await res.json();
      state.manualBeaten = new Set(data.manualBeaten || []);
      state.manualUnbeaten = new Set(data.manualUnbeaten || []);

      patchGameCard(game);
      renderDetailDrawer(game);
      updateStatsAndInsights();
      showToast(currentlyBeaten ? 'Marked as not beaten.' : 'Marked as beaten.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function forceRefreshGameHltb() {
    const appid = state.activeDetailAppId;
    const game = state.gamesById.get(appid);
    if (!game) return;

    game.hltbLoading = true;
    renderDetailDrawer(game);
    patchGameCard(game);

    try {
      const res = await fetch(`/api/hltb?title=${encodeURIComponent(game.name)}&appid=${game.appid}&force=1`);
      if (!res.ok) throw new Error('HLTB refresh failed.');
      game.hltb = await res.json();
      game.hltbError = false;
      showToast(`Refreshed HLTB data for ${game.name}.`, 'success');
    } catch (err) {
      game.hltbError = true;
      showToast(err.message, 'error');
    } finally {
      game.hltbLoading = false;
      patchGameCard(game);
      if (state.activeDetailAppId === game.appid) renderDetailDrawer(game);
      updateStatsAndInsights();
    }
  }

  // ==========================================================================
  // MANUAL REMATCH MODAL
  // ==========================================================================

  let currentRematchResults = [];

  function openRematchModal() {
    const game = state.gamesById.get(state.activeDetailAppId);
    if (!game) return;
    el.rematchSubtitle.textContent = `Search HowLongToBeat to assign the best match for "${game.name}".`;
    el.rematchSearchInput.value = game.name;
    el.rematchResults.innerHTML = '';
    el.rematchModal.hidden = false;
    el.rematchSearchInput.focus();
    runRematchSearch();
  }

  async function runRematchSearch() {
    const q = el.rematchSearchInput.value.trim();
    if (!q) return;

    el.rematchResults.innerHTML = '<div class="rematch-empty"><i class="fa-solid fa-circle-notch fa-spin"></i> Searching...</div>';

    try {
      const res = await fetch(`/api/hltb/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error('Search failed.');
      const data = await res.json();
      currentRematchResults = data.results || [];

      if (currentRematchResults.length === 0) {
        el.rematchResults.innerHTML = `<div class="rematch-empty">No matches found for "${escapeHtml(q)}".</div>`;
        return;
      }

      el.rematchResults.innerHTML = currentRematchResults.map((item, idx) => `
        <button type="button" class="rematch-item" data-rematch-idx="${idx}">
          <div class="rematch-item-info">
            <span class="rematch-item-title">${escapeHtml(item.title)}${item.releaseYear ? ` (${item.releaseYear})` : ''}</span>
            <span class="rematch-item-sub">Main ${item.gameplayMain || 0}h · Extra ${item.gameplayMainExtra || 0}h · 100% ${item.gameplayCompletionist || 0}h</span>
          </div>
          <i class="fa-solid fa-check" style="color: var(--accent);"></i>
        </button>
      `).join('');
    } catch (err) {
      el.rematchResults.innerHTML = `<div class="rematch-empty">${escapeHtml(err.message)}</div>`;
    }
  }

  async function applyRematch(idx) {
    const chosen = currentRematchResults[idx];
    const game = state.gamesById.get(state.activeDetailAppId);
    if (!chosen || !game) return;

    try {
      const res = await fetch('/api/hltb/rematch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appid: game.appid, gameName: game.name, hltb: chosen })
      });
      if (!res.ok) throw new Error('Failed to save rematch.');
      const data = await res.json();
      game.hltb = data.hltb;
      game.hltbError = false;

      el.rematchModal.hidden = true;
      patchGameCard(game);
      renderDetailDrawer(game);
      updateStatsAndInsights();
      populateGenreDropdown();
      showToast(`Matched to "${chosen.title}".`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ==========================================================================
  // SETTINGS MODAL
  // ==========================================================================

  async function openSettingsModal() {
    el.settingsModal.hidden = false;
    try {
      const res = await fetch('/api/config');
      if (!res.ok) return;
      const data = await res.json();
      el.settingsApiKey.value = data.STEAM_API_KEY_MASKED || '';
      el.settingsApiKey.placeholder = data.STEAM_API_KEY_SET ? '••••••••••••••••••••••••••••••••' : 'Enter your Steam Web API Key';
      el.settingsSteamId.value = data.STEAM_ID || '';
      el.settingsFamilyIds.value = (data.FAMILY_STEAM_IDS || []).join(', ');
    } catch (err) {
      console.error('Could not load config:', err);
    }
  }

  async function saveSettings(e) {
    e.preventDefault();
    const apiKey = el.settingsApiKey.value.trim();
    const steamId = el.settingsSteamId.value.trim();
    const familyIds = el.settingsFamilyIds.value.split(',').map(s => s.trim()).filter(Boolean);

    const payload = { STEAM_ID: steamId, FAMILY_STEAM_IDS: familyIds };
    if (apiKey && !apiKey.includes('•')) {
      payload.STEAM_API_KEY = apiKey;
    }

    el.saveSettingsBtn.disabled = true;
    el.saveSettingsBtn.textContent = 'Saving...';

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save settings.');

      el.settingsModal.hidden = true;
      showToast('Settings saved.', 'success');
      fetchLibrary();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      el.saveSettingsBtn.disabled = false;
      el.saveSettingsBtn.textContent = 'Save Settings';
    }
  }

  // ==========================================================================
  // EVENT WIRING (Delegated & Quote-Safe)
  // ==========================================================================

  function resetAllFilters() {
    state.filter = 'all';
    state.search = '';
    state.minTime = null;
    state.maxTime = null;
    state.genre = 'all';
    state.hideZero = false;
    state.timeCategory = 'main';

    el.searchInput.value = '';
    el.searchClearBtn.hidden = true;
    el.hltbMinTime.value = '';
    el.hltbMaxTime.value = '';
    el.hltbTimeCategory.value = 'main';
    el.genreSelect.value = 'all';
    el.hideZeroCheckbox.checked = false;
    syncAllCustomSelects();

    el.filterPills.forEach(p => p.classList.toggle('active', p.dataset.filter === 'all'));
    applyFiltersAndRender();
  }

  // ==========================================================================
  // CUSTOM THEME-NATIVE DROPDOWNS
  // ==========================================================================

  const customSelectControllers = new Map();

  function syncCustomSelect(selectEl) {
    const ctrl = customSelectControllers.get(selectEl);
    if (ctrl) ctrl.sync();
  }

  function syncAllCustomSelects() {
    for (const ctrl of customSelectControllers.values()) {
      ctrl.sync();
    }
  }

  function closeAllCustomSelects(except = null) {
    for (const ctrl of customSelectControllers.values()) {
      if (ctrl !== except) ctrl.close();
    }
  }

  function initCustomSelects() {
    document.querySelectorAll('.select-field').forEach((wrapper) => {
      const selectEl = wrapper.querySelector('select');
      if (!selectEl || customSelectControllers.has(selectEl)) return;

      wrapper.classList.add('has-custom-select');
      selectEl.tabIndex = -1;
      selectEl.setAttribute('aria-hidden', 'true');

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'select-trigger';
      trigger.setAttribute('aria-haspopup', 'listbox');
      trigger.setAttribute('aria-expanded', 'false');

      const labelSpan = document.createElement('span');
      labelSpan.className = 'select-trigger-label';
      const caret = document.createElement('i');
      caret.className = 'fa-solid fa-chevron-down select-caret';
      caret.setAttribute('aria-hidden', 'true');
      trigger.append(labelSpan, caret);

      const menu = document.createElement('div');
      menu.className = 'select-menu';
      menu.setAttribute('role', 'listbox');
      menu.hidden = true;

      wrapper.append(trigger, menu);

      const ctrl = {
        open() {
          if (selectEl.disabled) return;
          closeAllCustomSelects(ctrl);
          wrapper.classList.add('is-open');
          menu.hidden = false;
          trigger.setAttribute('aria-expanded', 'true');
          const active = menu.querySelector('.select-option.is-selected');
          if (active) active.scrollIntoView({ block: 'nearest' });
        },
        close() {
          wrapper.classList.remove('is-open');
          menu.hidden = true;
          trigger.setAttribute('aria-expanded', 'false');
        },
        sync() {
          trigger.disabled = selectEl.disabled;
          if (selectEl.disabled) ctrl.close();
          const selectedOpt = selectEl.options[selectEl.selectedIndex];
          labelSpan.textContent = selectedOpt ? selectedOpt.textContent : '';

          menu.innerHTML = '';
          Array.from(selectEl.options).forEach((opt) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'select-option';
            btn.setAttribute('role', 'option');
            btn.dataset.value = opt.value;
            const isSel = opt.value === selectEl.value;
            btn.classList.toggle('is-selected', isSel);
            btn.setAttribute('aria-selected', String(isSel));
            btn.innerHTML = `<span>${escapeHtml(opt.textContent)}</span><i class="fa-solid fa-check" aria-hidden="true"></i>`;
            btn.addEventListener('click', () => {
              if (selectEl.value !== opt.value) {
                selectEl.value = opt.value;
                selectEl.dispatchEvent(new Event('change', { bubbles: true }));
              }
              ctrl.sync();
              ctrl.close();
              trigger.focus();
            });
            menu.appendChild(btn);
          });
        }
      };

      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (menu.hidden) ctrl.open();
        else ctrl.close();
      });

      trigger.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const opts = Array.from(selectEl.options);
          const idx = Math.max(0, opts.findIndex(o => o.value === selectEl.value));
          const nextIdx = e.key === 'ArrowDown'
            ? Math.min(opts.length - 1, idx + 1)
            : Math.max(0, idx - 1);
          if (opts[nextIdx] && opts[nextIdx].value !== selectEl.value) {
            selectEl.value = opts[nextIdx].value;
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
            ctrl.sync();
            SoundFX.play('tab');
          }
        } else if (e.key === 'Escape') {
          ctrl.close();
        }
      });

      customSelectControllers.set(selectEl, ctrl);
      ctrl.sync();
    });

    document.addEventListener('click', (e) => {
      if (!(e.target instanceof Element) || !e.target.closest('.select-field')) {
        closeAllCustomSelects();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAllCustomSelects();
    });
  }

  function setupEvents() {
    // Search
    const debouncedFilter = debounce(applyFiltersAndRender, 180);
    el.searchInput.addEventListener('input', () => {
      state.search = el.searchInput.value;
      el.searchClearBtn.hidden = state.search.length === 0;
      debouncedFilter();
    });

    el.searchClearBtn.addEventListener('click', () => {
      state.search = '';
      el.searchInput.value = '';
      el.searchClearBtn.hidden = true;
      el.searchInput.focus();
      applyFiltersAndRender();
    });

    // Quick filter pills
    el.filterPills.forEach(pill => {
      pill.addEventListener('click', () => {
        el.filterPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        state.filter = pill.dataset.filter;
        applyFiltersAndRender();
      });
    });

    // Sort & Advanced filters
    el.sortSelect.addEventListener('change', () => {
      state.sort = el.sortSelect.value;
      applyFiltersAndRender();
    });

    el.toggleAdvancedBtn.addEventListener('click', () => {
      const open = el.advancedDrawer.hidden;
      el.advancedDrawer.hidden = !open;
      el.toggleAdvancedBtn.setAttribute('aria-expanded', String(open));
    });

    el.hltbTimeCategory.addEventListener('change', () => {
      state.timeCategory = el.hltbTimeCategory.value;
      applyFiltersAndRender();
    });

    el.hltbMinTime.addEventListener('input', debounce(() => {
      const v = parseFloat(el.hltbMinTime.value);
      state.minTime = Number.isFinite(v) ? v : null;
      applyFiltersAndRender();
    }, 200));

    el.hltbMaxTime.addEventListener('input', debounce(() => {
      const v = parseFloat(el.hltbMaxTime.value);
      state.maxTime = Number.isFinite(v) ? v : null;
      applyFiltersAndRender();
    }, 200));

    el.genreSelect.addEventListener('change', () => {
      state.genre = el.genreSelect.value;
      applyFiltersAndRender();
    });

    el.hideZeroCheckbox.addEventListener('change', () => {
      state.hideZero = el.hideZeroCheckbox.checked;
      applyFiltersAndRender();
    });

    el.resetFiltersBtn.addEventListener('click', resetAllFilters);

    // Pace selector in Insights
    el.pacePills.forEach(btn => {
      btn.addEventListener('click', () => {
        el.pacePills.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.weeklyPace = Number(btn.dataset.pace) || 5;
        updateStatsAndInsights();
      });
    });

    // Insights interactive links
    el.insightNeglectedBtn.addEventListener('click', () => {
      if (el.insightNeglectedBtn.dataset.appid) {
        openGameDetail(el.insightNeglectedBtn.dataset.appid);
      }
    });
    el.suggestNextBtn.addEventListener('click', suggestNextGame);
    el.suggestedGameBtn.addEventListener('click', () => {
      if (el.suggestedGameBtn.dataset.appid) {
        openGameDetail(el.suggestedGameBtn.dataset.appid);
      }
    });

    // Delegated clicks & keyboard activation on Games Grid
    el.gamesGrid.addEventListener('click', (e) => {
      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        if (actionBtn.dataset.action === 'sync-now') triggerSync(false);
        if (actionBtn.dataset.action === 'reset-filters') resetAllFilters();
        return;
      }
      const card = e.target.closest('.game-card');
      if (card && card.dataset.appid) {
        openGameDetail(card.dataset.appid);
      }
    });

    el.gamesGrid.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const card = e.target.closest('.game-card');
        if (card && card.dataset.appid) {
          e.preventDefault();
          openGameDetail(card.dataset.appid);
        }
      }
    });

    // Safe delegated image fallback (zero inline onerror XSS/quote bugs!)
    el.gamesGrid.addEventListener('error', (e) => {
      const img = e.target;
      if (img && img.tagName === 'IMG' && img.dataset.coverName) {
        const fallback = document.createElement('div');
        fallback.className = 'card-cover-fallback';
        fallback.textContent = img.dataset.coverName;
        img.replaceWith(fallback);
      }
    }, true);

    el.detailCover.addEventListener('error', () => {
      el.detailCover.hidden = true;
      el.detailCoverFallback.hidden = false;
    });

    // Header & Error buttons
    el.syncBtn.addEventListener('click', () => {
      if (state.games.length > 0) el.syncModal.hidden = false;
      else triggerSync(false);
    });
    el.settingsBtn.addEventListener('click', openSettingsModal);
    el.errorOpenSettingsBtn.addEventListener('click', openSettingsModal);
    el.errorRetryBtn.addEventListener('click', fetchLibrary);

    // Modals
    el.closeSettingsBtn.addEventListener('click', () => { el.settingsModal.hidden = true; });
    el.cancelSettingsBtn.addEventListener('click', () => { el.settingsModal.hidden = true; });
    el.settingsModal.addEventListener('click', (e) => {
      if (e.target === el.settingsModal) el.settingsModal.hidden = true;
    });
    el.settingsForm.addEventListener('submit', saveSettings);

    el.closeSyncModalBtn.addEventListener('click', () => { el.syncModal.hidden = true; });
    el.syncModal.addEventListener('click', (e) => {
      if (e.target === el.syncModal) el.syncModal.hidden = true;
    });
    el.quickSyncBtn.addEventListener('click', () => triggerSync(false));
    el.fullSyncBtn.addEventListener('click', () => triggerSync(true));

    el.closeRematchBtn.addEventListener('click', () => { el.rematchModal.hidden = true; });
    el.rematchModal.addEventListener('click', (e) => {
      if (e.target === el.rematchModal) el.rematchModal.hidden = true;
    });
    el.rematchSearchBtn.addEventListener('click', runRematchSearch);
    el.rematchSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        runRematchSearch();
      }
    });
    el.rematchResults.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-rematch-idx]');
      if (btn) applyRematch(Number(btn.dataset.rematchIdx));
    });

    // Detail Drawer
    el.closeDetailBtn.addEventListener('click', closeGameDetail);
    el.panelOverlay.addEventListener('click', closeGameDetail);
    el.detailBeatToggleBtn.addEventListener('click', toggleBeatStatus);
    el.detailRematchBtn.addEventListener('click', openRematchModal);
    el.detailRefreshBtn.addEventListener('click', forceRefreshGameHltb);

    // Global keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!el.rematchModal.hidden) { el.rematchModal.hidden = true; return; }
        if (!el.settingsModal.hidden) { el.settingsModal.hidden = true; return; }
        if (!el.syncModal.hidden) { el.syncModal.hidden = true; return; }
        closeGameDetail();
      } else if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = document.activeElement?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && !el.searchInput.disabled) {
          e.preventDefault();
          el.searchInput.focus();
        }
      }
    });
  }

  // ==========================================================================
  // BOOT
  // ==========================================================================

  document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initCustomSelects();
    SoundFX.init();
    setupEvents();
    initInfiniteScroll();
    fetchLibrary();
  });
})();
