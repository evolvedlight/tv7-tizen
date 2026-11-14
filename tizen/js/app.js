/**
 * Init7 TV — Main Application Controller, Full EPG TV Guide & Samsung Remote Navigation
 * Optimized for 60fps O(1) Channel Scrolling on Samsung QN90AA 55" Tizen TV
 */
(function () {
    'use strict';

    var KEYS = {
        LEFT: 37,
        UP: 38,
        RIGHT: 39,
        DOWN: 40,
        ENTER: 13,
        BACK: 10009,
        ESC: 27,
        BACKSPACE: 8,
        CH_UP: 427,
        CH_DOWN: 428,
        PAGE_UP: 33,
        PAGE_DOWN: 34,
        RED: 403,
        GREEN: 404,
        YELLOW: 405,
        BLUE: 406,
        INFO: 457,
        GUIDE: 458,
        CH_LIST: 10073,
        PLAY: 415,
        PAUSE: 19,
        PLAY_PAUSE: 10252,
        STOP: 413,
        NUM_0: 48,
        NUM_9: 57,
        KEY_F: 70,
        KEY_G: 71,
        KEY_I: 73,
        KEY_C: 67
    };

    var GROUPS = ['all', 'fav', 'de', 'fr', 'it', 'en', 'guide'];
    var GROUP_LABELS = {
        all: 'All Channels',
        fav: '★ Favorite Channels',
        de: 'German (DE)',
        fr: 'French (FR)',
        it: 'Italian (IT)',
        en: 'English (EN)'
    };

    var ITEM_HEIGHT = 72;
    var ITEM_MARGIN = 6;
    var ITEM_STRIDE = ITEM_HEIGHT + ITEM_MARGIN; // 78px per row
    var LIST_TOP_PADDING = 10;

    var GUIDE_VISIBLE_ROWS = 8;
    var GUIDE_WINDOW_MS = 150 * 60 * 1000; // 2.5 hours
    var GUIDE_STEP_MS = 30 * 60 * 1000;    // 30 minutes

    var state = {
        allChannels: [],
        filteredChannels: [],
        quickFavChannels: [],
        channelElements: [],
        favorites: loadFavorites(),
        activeGroup: localStorage.getItem('init7_active_group') || 'all',
        playingChannel: null,
        drawerOpen: true,
        osdVisible: true,
        guideOpen: false,
        focusArea: 'drawer', // 'drawer' | 'fullscreen' | 'osd' | 'quickfavs' | 'guide' | 'modal' | 'error'
        drawerFocusIdx: 0,
        prevDrawerFocusIdx: -1,
        osdFocusIdx: 0,
        quickFavFocusIdx: 0,
        modalFocusIdx: 0,
        errorFocusIdx: 0,
        modalOptions: [],

        // Full EPG TV Guide state
        guideRowIdx: 0,
        guideWindowStartMs: 0,
        guideSelectedTimeMs: 0,
        guideSelectedProg: null,
        guidePrefetchTimer: null,

        // Long-press OK to toggle favorite on QN90AA SolarCell remote
        enterHoldTimer: null,
        enterHoldTriggered: false,

        numpadBuffer: '',
        numpadTimer: null,
        osdTimer: null,
        toastTimer: null,
        epgDebounceTimer: null,
        backExitArmed: false,
        backExitTimer: null
    };

    var els = {
        backdrop: document.getElementById('ui-backdrop'),
        drawer: document.getElementById('channel-drawer'),
        groupTabs: Array.prototype.slice.call(document.querySelectorAll('.group-tab')),
        countAll: document.getElementById('count-all'),
        countFav: document.getElementById('count-fav'),
        channelList: document.getElementById('channel-list'),
        drawerClock: document.getElementById('drawer-clock'),
        networkStatus: document.getElementById('network-status'),

        osdBanner: document.getElementById('osd-banner'),
        osdChNumber: document.getElementById('osd-ch-number'),
        osdChLogo: document.getElementById('osd-ch-logo'),
        osdChFallback: document.getElementById('osd-ch-fallback'),
        osdChName: document.getElementById('osd-ch-name'),
        osdFavStar: document.getElementById('osd-fav-star'),
        osdBadgeHd: document.getElementById('osd-badge-hd'),
        osdBadgeLang: document.getElementById('osd-badge-lang'),
        osdBadgeEngine: document.getElementById('osd-badge-engine'),
        osdNowTime: document.getElementById('osd-now-time'),
        osdNowTitle: document.getElementById('osd-now-title'),
        osdNowCat: document.getElementById('osd-now-cat'),
        osdNowProgress: document.getElementById('osd-now-progress'),
        osdNowDesc: document.getElementById('osd-now-desc'),
        osdNextTime: document.getElementById('osd-next-time'),
        osdNextTitle: document.getElementById('osd-next-title'),
        osdClock: document.getElementById('osd-clock'),
        osdStreamInfo: document.getElementById('osd-stream-info'),
        quickFavsBar: document.getElementById('quick-favs-bar'),
        quickFavsList: document.getElementById('quick-favs-list'),
        osdButtons: Array.prototype.slice.call(document.querySelectorAll('.osd-btn')),
        osdActionFavIcon: document.getElementById('osd-action-fav-icon'),
        osdActionFavLabel: document.getElementById('osd-action-fav-label'),
        osdActionAudioLabel: document.getElementById('osd-action-audio-label'),
        osdActionSubLabel: document.getElementById('osd-action-sub-label'),
        osdActionUdpxyLabel: document.getElementById('osd-action-udpxy-label'),
        osdActionEngineLabel: document.getElementById('osd-action-engine-label'),

        guideOverlay: document.getElementById('epg-guide-overlay'),
        guideSelChNum: document.getElementById('guide-sel-ch-num'),
        guideSelChName: document.getElementById('guide-sel-ch-name'),
        guideSelTime: document.getElementById('guide-sel-time'),
        guideSelCat: document.getElementById('guide-sel-cat'),
        guideSelTitle: document.getElementById('guide-sel-title'),
        guideSelDesc: document.getElementById('guide-sel-desc'),
        guideGroupLabel: document.getElementById('guide-group-label'),
        guideClock: document.getElementById('guide-clock'),
        guideDateLabel: document.getElementById('guide-date-label'),
        guideTimeSlots: document.getElementById('guide-time-slots'),
        guideRowsContainer: document.getElementById('guide-rows-container'),
        guideNowLine: document.getElementById('guide-now-line'),

        loadingOverlay: document.getElementById('loading-overlay'),
        loadingLogo: document.getElementById('loading-logo'),
        loadingTitle: document.getElementById('loading-title'),
        loadingSubtitle: document.getElementById('loading-subtitle'),

        errorOverlay: document.getElementById('error-overlay'),
        errorTitle: document.getElementById('error-title'),
        errorMessage: document.getElementById('error-message'),
        errorButtons: Array.prototype.slice.call(document.querySelectorAll('[data-error-action]')),

        numpadOverlay: document.getElementById('numpad-overlay'),
        numpadDigits: document.getElementById('numpad-digits'),
        numpadPreview: document.getElementById('numpad-preview'),

        toastBanner: document.getElementById('toast-banner'),

        modalOverlay: document.getElementById('modal-overlay'),
        modalTitle: document.getElementById('modal-title'),
        modalBody: document.getElementById('modal-body'),
        modalCloseBtn: document.getElementById('modal-close-btn')
    };

    function loadFavorites() {
        try {
            var raw = localStorage.getItem('init7_favorites');
            if (raw) {
                var arr = JSON.parse(raw);
                if (Array.isArray(arr)) return arr;
            }
        } catch (e) {}
        return [];
    }

    function ensureStarterFavorites(channels) {
        if (state.favorites.length > 0) return;
        var initialized = localStorage.getItem('init7_favs_seeded');
        if (initialized) return;

        // Seed convenient default Quick Favorites so the main menu Quick Favs bar works out of the box
        var starterNames = ['BBC One HD', 'BBC One', 'BBC Two', 'CBBC', 'ITV', 'Channel 4', 'BBC News', 'SRF 1'];
        var seeded = [];
        for (var i = 0; i < starterNames.length; i++) {
            var target = starterNames[i].toLowerCase();
            for (var j = 0; j < channels.length; j++) {
                if (channels[j].name.toLowerCase() === target && seeded.indexOf(channels[j].pk) === -1) {
                    seeded.push(channels[j].pk);
                    break;
                }
            }
        }
        if (seeded.length > 0) {
            state.favorites = seeded;
            try {
                localStorage.setItem('init7_favs_seeded', 'true');
            } catch (e) {}
            saveFavorites();
        }
    }

    function saveFavorites() {
        try {
            localStorage.setItem('init7_favorites', JSON.stringify(state.favorites));
        } catch (e) {}
        if (els.countFav) {
            els.countFav.textContent = String(state.favorites.length);
        }
        renderQuickFavoritesBar();
    }

    function isFavorite(channelPk) {
        return state.favorites.indexOf(channelPk) !== -1;
    }

    function toggleFavorite(channel) {
        if (!channel) return;
        var idx = state.favorites.indexOf(channel.pk);
        var added = false;
        if (idx === -1) {
            state.favorites.push(channel.pk);
            added = true;
        } else {
            state.favorites.splice(idx, 1);
        }
        saveFavorites();
        showToast(added ? ('★ Added ' + channel.name + ' to Quick Favorites') : ('Removed ' + channel.name + ' from Quick Favorites'));

        if (state.activeGroup === 'fav') {
            applyGroupFilter(state.activeGroup, true);
        } else {
            renderChannelList();
        }
        if (state.guideOpen) {
            renderGuideGrid();
        }
        updateOsdChannelMeta();
    }

    function renderQuickFavoritesBar() {
        if (!els.quickFavsList) return;
        els.quickFavsList.innerHTML = '';

        var favList = [];
        for (var i = 0; i < state.favorites.length; i++) {
            var pk = state.favorites[i];
            for (var j = 0; j < state.allChannels.length; j++) {
                if (state.allChannels[j].pk === pk) {
                    favList.push(state.allChannels[j]);
                    break;
                }
            }
        }

        // If user cleared all favorites, show top 6 channels from active group as quick-jump pills
        if (favList.length === 0) {
            favList = state.allChannels.slice(0, 6);
        } else {
            favList = favList.slice(0, 9);
        }

        state.quickFavChannels = favList;
        state.quickFavFocusIdx = Math.max(0, Math.min(state.quickFavFocusIdx, Math.max(0, favList.length - 1)));

        favList.forEach(function (ch, idx) {
            var pill = document.createElement('button');
            pill.className = 'quick-fav-pill';
            if (state.playingChannel && state.playingChannel.pk === ch.pk) {
                pill.classList.add('playing');
            }
            if (state.focusArea === 'quickfavs' && idx === state.quickFavFocusIdx) {
                pill.classList.add('focused');
            }

            var numSpan = document.createElement('span');
            numSpan.className = 'quick-fav-num';
            numSpan.textContent = '#' + ch.number;
            pill.appendChild(numSpan);

            var nameSpan = document.createElement('span');
            nameSpan.textContent = ch.name;
            pill.appendChild(nameSpan);

            pill.addEventListener('click', function () {
                state.quickFavFocusIdx = idx;
                updateOsdFocus();
                selectAndPlayChannel(ch, true);
            });

            els.quickFavsList.appendChild(pill);
        });
    }

    function registerTizenKeys() {
        if (!window.tizen || !window.tizen.tvinputdevice) return;
        var keysToRegister = [
            'ChannelUp', 'ChannelDown', 'ChannelList',
            'Info', 'Guide',
            'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
            'MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop',
            '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
        ];
        keysToRegister.forEach(function (k) {
            try {
                window.tizen.tvinputdevice.registerKey(k);
            } catch (e) {}
        });
    }

    function handleDeepLinkAppControl() {
        if (!window.tizen || !window.tizen.application) return;
        try {
            var reqAppControl = window.tizen.application.getCurrentApplication().getRequestedAppControl();
            if (!reqAppControl || !reqAppControl.appControl || !Array.isArray(reqAppControl.appControl.data)) return;
            var dataArr = reqAppControl.appControl.data;
            for (var i = 0; i < dataArr.length; i++) {
                var entry = dataArr[i];
                if (entry && (entry.key === 'PAYLOAD' || entry.key === 'channelPk') && entry.value && entry.value[0]) {
                    var rawVal = entry.value[0];
                    var targetPk = rawVal;
                    try {
                        var parsed = JSON.parse(rawVal);
                        if (parsed.values) {
                            var inner = typeof parsed.values === 'string' ? JSON.parse(parsed.values) : parsed.values;
                            targetPk = inner.channelPk || inner.pk || targetPk;
                        } else if (parsed.channelPk || parsed.pk) {
                            targetPk = parsed.channelPk || parsed.pk;
                        }
                    } catch (e) {}
                    var matched = state.allChannels.filter(function (c) {
                        return c.pk === targetPk || c.name === targetPk || String(c.number) === String(targetPk);
                    })[0];
                    if (matched) {
                        selectAndPlayChannel(matched, true);
                    }
                }
            }
        } catch (e) {}
    }

    function showToast(msg, durationMs) {
        if (!els.toastBanner) return;
        els.toastBanner.textContent = msg;
        els.toastBanner.classList.remove('hidden');
        if (state.toastTimer) clearTimeout(state.toastTimer);
        state.toastTimer = setTimeout(function () {
            els.toastBanner.classList.add('hidden');
        }, durationMs || 2800);
    }

    function updateClocks() {
        var now = new Date();
        var hh = String(now.getHours()).padStart(2, '0');
        var mm = String(now.getMinutes()).padStart(2, '0');
        var str = hh + ':' + mm;
        if (els.drawerClock) els.drawerClock.textContent = str;
        if (els.osdClock) els.osdClock.textContent = str;
        if (els.guideClock) els.guideClock.textContent = str;
        if (state.guideOpen) {
            updateGuideNowLine();
        }
    }

    function updateBackdrop() {
        var anyVisible = state.drawerOpen || state.osdVisible || state.guideOpen || !els.modalOverlay.classList.contains('hidden');
        if (anyVisible) {
            els.backdrop.classList.add('visible');
        } else {
            els.backdrop.classList.remove('visible');
        }
    }

    function openDrawer() {
        if (state.guideOpen) {
            closeGuide();
        }
        state.drawerOpen = true;
        document.body.classList.remove('drawer-closed');
        els.drawer.classList.add('open');
        state.focusArea = 'drawer';

        if (state.playingChannel) {
            var idx = findChannelIndex(state.filteredChannels, state.playingChannel.pk);
            if (idx !== -1) {
                state.drawerFocusIdx = idx;
            }
        }
        updateDrawerFocus(true);
        updateOsdFocus();
        updateBackdrop();
        schedulePrefetchVisibleEpg();
    }

    function closeDrawer() {
        state.drawerOpen = false;
        document.body.classList.add('drawer-closed');
        els.drawer.classList.remove('open');
        if (state.focusArea === 'drawer') {
            state.focusArea = state.osdVisible ? 'osd' : 'fullscreen';
        }
        updateDrawerFocus(false);
        updateOsdFocus();
        updateBackdrop();
    }

    function showOsd(autoHideMs, focusOsdBar) {
        state.osdVisible = true;
        els.osdBanner.classList.add('visible');
        renderQuickFavoritesBar();
        if (focusOsdBar) {
            state.focusArea = 'osd';
            updateDrawerFocus(false);
            updateOsdFocus();
        }
        updateBackdrop();

        if (state.osdTimer) clearTimeout(state.osdTimer);
        var delay = typeof autoHideMs === 'number' ? autoHideMs : 6000;
        if (delay > 0) {
            state.osdTimer = setTimeout(function () {
                if (state.focusArea !== 'osd' && state.focusArea !== 'quickfavs' && !state.drawerOpen && !state.guideOpen) {
                    hideOsd();
                } else if (!state.drawerOpen && (state.focusArea === 'osd' || state.focusArea === 'quickfavs')) {
                    showOsd(8000, false);
                }
            }, delay);
        }
    }

    function hideOsd() {
        if (state.osdTimer) {
            clearTimeout(state.osdTimer);
            state.osdTimer = null;
        }
        state.osdVisible = false;
        els.osdBanner.classList.remove('visible');
        if (state.focusArea === 'osd' || state.focusArea === 'quickfavs') {
            state.focusArea = state.drawerOpen ? 'drawer' : 'fullscreen';
        }
        updateOsdFocus();
        updateBackdrop();
    }

    // =========================================================================
    // Full Multi-Channel EPG TV Guide Timeline Grid
    // =========================================================================

    function getFloorHalfHourMs(ms) {
        var halfHour = 30 * 60 * 1000;
        return Math.floor(ms / halfHour) * halfHour;
    }

    function openGuide() {
        if (!state.filteredChannels.length) {
            applyGroupFilter('all', false);
        }
        state.guideOpen = true;
        state.drawerOpen = false;
        document.body.classList.add('drawer-closed');
        els.drawer.classList.remove('open');
        els.osdBanner.classList.remove('visible');
        state.osdVisible = false;

        var now = Date.now();
        state.guideWindowStartMs = getFloorHalfHourMs(now);
        state.guideSelectedTimeMs = now;

        var playingIdx = state.playingChannel
            ? findChannelIndex(state.filteredChannels, state.playingChannel.pk)
            : -1;
        state.guideRowIdx = playingIdx !== -1 ? playingIdx : Math.max(0, state.drawerFocusIdx);

        state.focusArea = 'guide';
        els.guideOverlay.classList.remove('hidden');
        if (els.guideGroupLabel) {
            els.guideGroupLabel.textContent = (GROUP_LABELS[state.activeGroup] || 'All Channels') +
                ' (' + state.filteredChannels.length + ')';
        }

        renderGuideTimeAxis();
        renderGuideGrid();
        scheduleGuideEpgPrefetch();
        updateBackdrop();
    }

    function closeGuide(skipOsd) {
        state.guideOpen = false;
        els.guideOverlay.classList.add('hidden');
        if (state.guidePrefetchTimer) {
            clearTimeout(state.guidePrefetchTimer);
            state.guidePrefetchTimer = null;
        }
        state.focusArea = 'fullscreen';
        if (!skipOsd) {
            showOsd(5000, false);
        }
        updateBackdrop();
    }

    function renderGuideTimeAxis() {
        if (!els.guideTimeSlots) return;
        els.guideTimeSlots.innerHTML = '';

        var startMs = state.guideWindowStartMs;
        var d = new Date(startMs);
        var today = new Date();
        var isToday = d.toDateString() === today.toDateString();
        var dayLabel = isToday ? 'Today' : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
        var endMs = startMs + GUIDE_WINDOW_MS;
        els.guideDateLabel.textContent = dayLabel + ' • ' + window.Init7Api.formatHhMm(startMs) + ' – ' + window.Init7Api.formatHhMm(endMs);

        for (var i = 0; i < 5; i++) {
            var slotMs = startMs + (i * GUIDE_STEP_MS);
            var slotDiv = document.createElement('div');
            slotDiv.className = 'guide-time-slot';
            slotDiv.textContent = window.Init7Api.formatHhMm(slotMs);
            els.guideTimeSlots.appendChild(slotDiv);
        }

        updateGuideNowLine();
    }

    function updateGuideNowLine() {
        if (!els.guideNowLine) return;
        var now = Date.now();
        var startMs = state.guideWindowStartMs;
        var endMs = startMs + GUIDE_WINDOW_MS;
        if (now < startMs || now > endMs) {
            els.guideNowLine.classList.add('hidden');
            return;
        }
        els.guideNowLine.classList.remove('hidden');
        var ratio = (now - startMs) / GUIDE_WINDOW_MS;
        // Left channel column is 310px wide; track is the remaining width (1848 - 310 = 1538px)
        els.guideNowLine.style.left = 'calc(310px + (100% - 310px) * ' + ratio.toFixed(4) + ')';
    }

    function getChannelProgramsInWindow(channel, winStartMs, winEndMs) {
        var entries = window.Init7Api.getChannelEpgEntries(channel.pk);
        if (!entries || entries.length === 0) {
            return [{
                isPlaceholder: true,
                title: channel.name + ' Live Broadcast',
                subTitle: '',
                desc: 'Live television stream on ' + channel.name + '. Schedule loading from Init7 EPG...',
                categories: [channel.hd ? 'HD' : 'SD', channel.language.toUpperCase()],
                startMs: winStartMs,
                endMs: winEndMs,
                startFormatted: window.Init7Api.formatHhMm(winStartMs),
                endFormatted: window.Init7Api.formatHhMm(winEndMs)
            }];
        }

        var matching = [];
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            if (e.endMs <= winStartMs) continue;
            if (e.startMs >= winEndMs) break;
            matching.push(e);
        }

        if (matching.length === 0) {
            return [{
                isPlaceholder: true,
                title: channel.name + ' Live',
                subTitle: '',
                desc: 'Direct live broadcast via Init7 TV7.',
                categories: [channel.hd ? 'HD' : 'SD'],
                startMs: winStartMs,
                endMs: winEndMs,
                startFormatted: window.Init7Api.formatHhMm(winStartMs),
                endFormatted: window.Init7Api.formatHhMm(winEndMs)
            }];
        }
        return matching;
    }

    function renderGuideGrid() {
        if (!els.guideRowsContainer) return;
        els.guideRowsContainer.innerHTML = '';

        var list = state.filteredChannels;
        if (!list.length) return;

        var total = list.length;
        state.guideRowIdx = Math.max(0, Math.min(state.guideRowIdx, total - 1));

        var half = Math.floor(GUIDE_VISIBLE_ROWS / 2);
        var startRow = Math.max(0, Math.min(state.guideRowIdx - half, Math.max(0, total - GUIDE_VISIBLE_ROWS)));
        var endRow = Math.min(total, startRow + GUIDE_VISIBLE_ROWS);

        var winStartMs = state.guideWindowStartMs;
        var winEndMs = winStartMs + GUIDE_WINDOW_MS;
        var nowMs = Date.now();
        var frag = document.createDocumentFragment();
        var selectedProgForHeader = null;
        var selectedChannel = list[state.guideRowIdx];

        for (var r = startRow; r < endRow; r++) {
            var ch = list[r];
            var isSelectedRow = (r === state.guideRowIdx);

            var rowEl = document.createElement('div');
            rowEl.className = 'guide-row' + (isSelectedRow ? ' active-row' : '');

            // Left Channel Identity Cell
            var chCell = document.createElement('div');
            chCell.className = 'guide-ch-cell';

            var numEl = document.createElement('div');
            numEl.className = 'guide-ch-num';
            numEl.textContent = String(ch.number);
            chCell.appendChild(numEl);

            var logoBox = document.createElement('div');
            logoBox.className = 'guide-ch-logo-box';
            if (ch.logo) {
                var img = document.createElement('img');
                img.className = 'ch-logo-img';
                img.src = ch.logo;
                img.alt = '';
                img.decoding = 'async';
                img.onerror = function () { this.style.display = 'none'; };
                logoBox.appendChild(img);
            } else {
                var fb = document.createElement('span');
                fb.className = 'ch-logo-fallback';
                fb.textContent = getInitials(ch.name);
                logoBox.appendChild(fb);
            }
            chCell.appendChild(logoBox);

            var nameWrap = document.createElement('div');
            nameWrap.className = 'guide-ch-name-wrap';

            var nameSpan = document.createElement('span');
            nameSpan.className = 'guide-ch-name';
            nameSpan.textContent = ch.name;
            nameWrap.appendChild(nameSpan);

            if (isFavorite(ch.pk)) {
                var favSpan = document.createElement('span');
                favSpan.className = 'ch-fav';
                favSpan.textContent = '★';
                nameWrap.appendChild(favSpan);
            }
            chCell.appendChild(nameWrap);

            if (ch.hd) {
                var hdSpan = document.createElement('span');
                hdSpan.className = 'badge badge-hd';
                hdSpan.textContent = 'HD';
                chCell.appendChild(hdSpan);
            }

            rowEl.appendChild(chCell);

            // Right Timeline Track
            var trackEl = document.createElement('div');
            trackEl.className = 'guide-prog-track';

            var progs = getChannelProgramsInWindow(ch, winStartMs, winEndMs);
            var chosenIdxInRow = -1;

            if (isSelectedRow) {
                for (var p = 0; p < progs.length; p++) {
                    if (progs[p].startMs <= state.guideSelectedTimeMs && progs[p].endMs > state.guideSelectedTimeMs) {
                        chosenIdxInRow = p;
                        break;
                    }
                }
                if (chosenIdxInRow === -1) {
                    chosenIdxInRow = 0;
                }
                selectedProgForHeader = progs[chosenIdxInRow];
            }

            for (var k = 0; k < progs.length; k++) {
                var prog = progs[k];
                var visStart = Math.max(winStartMs, prog.startMs);
                var visEnd = Math.min(winEndMs, prog.endMs);
                var leftPct = ((visStart - winStartMs) / GUIDE_WINDOW_MS) * 100;
                var widthPct = Math.max(2, ((visEnd - visStart) / GUIDE_WINDOW_MS) * 100);

                var block = document.createElement('div');
                block.className = 'guide-prog-block';
                if (prog.startMs <= nowMs && prog.endMs > nowMs) {
                    block.classList.add('airing-now');
                }
                if (isSelectedRow && k === chosenIdxInRow) {
                    block.classList.add('focused');
                }

                block.style.left = leftPct.toFixed(2) + '%';
                block.style.width = 'calc(' + widthPct.toFixed(2) + '% - 4px)';

                var pTitle = document.createElement('div');
                pTitle.className = 'guide-prog-title';
                pTitle.textContent = prog.title;
                block.appendChild(pTitle);

                var pTime = document.createElement('div');
                pTime.className = 'guide-prog-time';
                pTime.textContent = prog.startFormatted + ' – ' + prog.endFormatted +
                    (prog.subTitle ? (' • ' + prog.subTitle) : '');
                block.appendChild(pTime);

                (function (rowIndex, channelObj, progObj) {
                    block.addEventListener('click', function () {
                        state.guideRowIdx = rowIndex;
                        state.guideSelectedTimeMs = Math.max(winStartMs + 60000, Math.min(winEndMs - 60000, progObj.startMs + 60000));
                        renderGuideGrid();
                        closeGuide(true);
                        selectAndPlayChannel(channelObj, true);
                    });
                })(r, ch, prog);

                trackEl.appendChild(block);
            }

            rowEl.appendChild(trackEl);
            frag.appendChild(rowEl);
        }

        els.guideRowsContainer.appendChild(frag);
        state.guideSelectedProg = selectedProgForHeader;
        updateGuideSelectedHeader(selectedChannel, selectedProgForHeader);
    }

    function updateGuideSelectedHeader(channel, prog) {
        if (!channel) return;
        els.guideSelChNum.textContent = '#' + channel.number;
        els.guideSelChName.textContent = channel.name + (isFavorite(channel.pk) ? ' ★' : '');

        if (!prog) {
            els.guideSelTime.textContent = 'LIVE';
            els.guideSelTitle.textContent = channel.name + ' Live Broadcast';
            els.guideSelDesc.textContent = 'Press OK to watch ' + channel.name + '.';
            els.guideSelCat.classList.add('hidden');
            return;
        }

        els.guideSelTime.textContent = prog.startFormatted + ' – ' + prog.endFormatted;
        els.guideSelTitle.textContent = prog.title + (prog.subTitle ? (' — ' + prog.subTitle) : '');
        els.guideSelDesc.textContent = prog.desc || ('Broadcast on ' + channel.name + '. Press OK to tune to this channel.');

        if (prog.categories && prog.categories.length > 0) {
            els.guideSelCat.textContent = prog.categories.slice(0, 3).join(' • ');
            els.guideSelCat.classList.remove('hidden');
        } else {
            els.guideSelCat.classList.add('hidden');
        }
    }

    function moveGuideTimeline(direction) {
        var list = state.filteredChannels;
        if (!list.length) return;
        var ch = list[state.guideRowIdx];
        var entries = window.Init7Api.getChannelEpgEntries(ch.pk);

        if (entries && entries.length > 0 && state.guideSelectedProg && !state.guideSelectedProg.isPlaceholder) {
            if (direction > 0) {
                state.guideSelectedTimeMs = state.guideSelectedProg.endMs + 60000;
            } else {
                state.guideSelectedTimeMs = Math.max(
                    Date.now() - (3 * 3600 * 1000),
                    state.guideSelectedProg.startMs - 60000
                );
            }
        } else {
            state.guideSelectedTimeMs += direction * GUIDE_STEP_MS;
        }

        var winEndMs = state.guideWindowStartMs + GUIDE_WINDOW_MS;
        if (state.guideSelectedTimeMs >= winEndMs) {
            state.guideWindowStartMs = getFloorHalfHourMs(state.guideSelectedTimeMs - GUIDE_STEP_MS);
            renderGuideTimeAxis();
        } else if (state.guideSelectedTimeMs < state.guideWindowStartMs) {
            state.guideWindowStartMs = getFloorHalfHourMs(state.guideSelectedTimeMs);
            renderGuideTimeAxis();
        }

        renderGuideGrid();
    }

    function scheduleGuideEpgPrefetch() {
        if (state.guidePrefetchTimer) {
            clearTimeout(state.guidePrefetchTimer);
        }
        state.guidePrefetchTimer = setTimeout(function () {
            if (!state.guideOpen || !state.filteredChannels.length) return;
            var total = state.filteredChannels.length;
            var half = Math.floor(GUIDE_VISIBLE_ROWS / 2);
            var startRow = Math.max(0, Math.min(state.guideRowIdx - half, Math.max(0, total - GUIDE_VISIBLE_ROWS)));
            var endRow = Math.min(total, startRow + GUIDE_VISIBLE_ROWS + 2);
            var slice = state.filteredChannels.slice(startRow, endRow);

            var i = 0;
            function next() {
                if (!state.guideOpen || i >= slice.length) return;
                var ch = slice[i++];
                window.Init7Api.fetchChannelEpg(ch.pk).then(function (snap) {
                    updateSingleChannelRowEpg(ch.pk, snap);
                    if (state.guideOpen) {
                        renderGuideGrid();
                    }
                    setTimeout(next, 50);
                }).catch(function () {
                    setTimeout(next, 50);
                });
            }
            next();
        }, 220);
    }

    // =========================================================================
    // Channel Drawer List & Filtering
    // =========================================================================

    function findChannelIndex(list, pk) {
        for (var i = 0; i < list.length; i++) {
            if (list[i].pk === pk) return i;
        }
        return -1;
    }

    function applyGroupFilter(groupKey, preserveFocus) {
        if (groupKey === 'guide') {
            openGuide();
            return;
        }
        if (GROUPS.indexOf(groupKey) === -1) groupKey = 'all';
        state.activeGroup = groupKey;
        try {
            localStorage.setItem('init7_active_group', groupKey);
        } catch (e) {}

        els.groupTabs.forEach(function (tab) {
            var isMatch = tab.getAttribute('data-group') === groupKey;
            tab.classList.toggle('active', isMatch);
        });

        state.filteredChannels = state.allChannels.filter(function (ch) {
            if (groupKey === 'all') return true;
            if (groupKey === 'fav') return isFavorite(ch.pk);
            return ch.language === groupKey;
        });

        if (!preserveFocus) {
            var playingIdx = state.playingChannel
                ? findChannelIndex(state.filteredChannels, state.playingChannel.pk)
                : -1;
            state.drawerFocusIdx = playingIdx !== -1 ? playingIdx : 0;
        } else {
            state.drawerFocusIdx = Math.max(0, Math.min(state.drawerFocusIdx, state.filteredChannels.length - 1));
        }

        renderChannelList();
        schedulePrefetchVisibleEpg();
    }

    function getInitials(name) {
        if (!name) return 'TV';
        return name.replace(/[^A-Za-z0-9+]/g, ' ').trim().split(/\s+/).slice(0, 2).map(function (w) {
            return w.charAt(0).toUpperCase();
        }).join('') || 'TV';
    }

    function renderChannelList() {
        var container = els.channelList;
        container.innerHTML = '';
        state.channelElements = [];
        state.prevDrawerFocusIdx = -1;

        if (state.filteredChannels.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'empty-list-msg';
            empty.textContent = state.activeGroup === 'fav'
                ? 'No favorite channels yet. Highlight any channel and press ⏯ Play/Pause (or hold OK) to add it to Quick Favorites.'
                : 'No channels found in this language group.';
            container.appendChild(empty);
            return;
        }

        var frag = document.createDocumentFragment();

        state.filteredChannels.forEach(function (ch, idx) {
            var item = document.createElement('div');
            item.className = 'channel-item';
            item.setAttribute('role', 'option');
            item.setAttribute('data-idx', String(idx));
            item.setAttribute('data-pk', ch.pk);

            if (state.playingChannel && state.playingChannel.pk === ch.pk) {
                item.classList.add('playing');
            }
            if (state.focusArea === 'drawer' && idx === state.drawerFocusIdx) {
                item.classList.add('focused');
                state.prevDrawerFocusIdx = idx;
            }

            var numEl = document.createElement('div');
            numEl.className = 'ch-num';
            numEl.textContent = String(ch.number);
            item.appendChild(numEl);

            var logoBox = document.createElement('div');
            logoBox.className = 'ch-logo-box';
            if (ch.logo) {
                var img = document.createElement('img');
                img.className = 'ch-logo-img';
                img.src = ch.logo;
                img.alt = ch.name;
                img.decoding = 'async';
                img.onerror = function () {
                    img.style.display = 'none';
                    var fb = document.createElement('span');
                    fb.className = 'ch-logo-fallback';
                    fb.textContent = getInitials(ch.name);
                    logoBox.appendChild(fb);
                };
                logoBox.appendChild(img);
            } else {
                var fb2 = document.createElement('span');
                fb2.className = 'ch-logo-fallback';
                fb2.textContent = getInitials(ch.name);
                logoBox.appendChild(fb2);
            }
            item.appendChild(logoBox);

            var info = document.createElement('div');
            info.className = 'ch-info';

            var titleLine = document.createElement('div');
            titleLine.className = 'ch-title-line';

            var nameEl = document.createElement('span');
            nameEl.className = 'ch-name';
            nameEl.textContent = ch.name;
            titleLine.appendChild(nameEl);

            if (isFavorite(ch.pk)) {
                var favEl = document.createElement('span');
                favEl.className = 'ch-fav';
                favEl.textContent = '★';
                titleLine.appendChild(favEl);
            }
            info.appendChild(titleLine);

            var epgSnap = window.Init7Api.getCachedNowNext(ch.pk);
            var epgLine = document.createElement('div');
            epgLine.className = 'ch-epg-line';
            epgLine.id = 'ch-epg-' + ch.pk;
            if (epgSnap && epgSnap.now) {
                epgLine.textContent = epgSnap.now.title;
            } else {
                epgLine.textContent = (ch.hd ? 'HD' : 'SD') + ' Live • ' + ch.language.toUpperCase();
            }
            info.appendChild(epgLine);

            var miniProg = document.createElement('div');
            miniProg.className = 'ch-mini-progress';
            var miniBar = document.createElement('div');
            miniBar.className = 'ch-mini-progress-bar';
            miniBar.id = 'ch-prog-' + ch.pk;
            miniBar.style.width = (epgSnap && epgSnap.now ? epgSnap.progressPct : 0) + '%';
            miniProg.appendChild(miniBar);
            info.appendChild(miniProg);

            item.appendChild(info);

            var badges = document.createElement('div');
            badges.className = 'ch-badges';
            if (ch.hd) {
                var hdBadge = document.createElement('span');
                hdBadge.className = 'badge badge-hd';
                hdBadge.textContent = 'HD';
                badges.appendChild(hdBadge);
            }
            var langBadge = document.createElement('span');
            langBadge.className = 'badge badge-lang';
            langBadge.textContent = ch.language.toUpperCase();
            badges.appendChild(langBadge);
            item.appendChild(badges);

            item.addEventListener('click', function () {
                state.drawerFocusIdx = idx;
                updateDrawerFocus(true);
                selectAndPlayChannel(ch, true);
            });

            state.channelElements.push(item);
            frag.appendChild(item);
        });

        container.appendChild(frag);
        scrollToFocusedChannel();
    }

    function scrollToFocusedChannel() {
        var idx = state.drawerFocusIdx;
        if (idx < 0 || idx >= state.channelElements.length) return;
        var container = els.channelList;
        var viewHeight = container.clientHeight || 820;
        var viewTop = container.scrollTop;
        var viewBottom = viewTop + viewHeight;

        var itemTop = LIST_TOP_PADDING + (idx * ITEM_STRIDE);
        var itemBottom = itemTop + ITEM_HEIGHT;

        if (itemTop < viewTop + ITEM_STRIDE) {
            container.scrollTop = Math.max(0, itemTop - ITEM_STRIDE);
        } else if (itemBottom > viewBottom - ITEM_STRIDE) {
            container.scrollTop = itemBottom - viewHeight + ITEM_STRIDE;
        }
    }

    function updateDrawerFocus(shouldScroll) {
        var items = state.channelElements;
        var prev = state.prevDrawerFocusIdx;
        if (prev >= 0 && prev < items.length && items[prev]) {
            items[prev].classList.remove('focused');
        }
        if (state.focusArea === 'drawer') {
            var cur = state.drawerFocusIdx;
            if (cur >= 0 && cur < items.length && items[cur]) {
                items[cur].classList.add('focused');
                state.prevDrawerFocusIdx = cur;
            }
            if (shouldScroll !== false) {
                scrollToFocusedChannel();
            }
        } else {
            state.prevDrawerFocusIdx = -1;
        }
    }

    function updateOsdFocus() {
        for (var i = 0; i < els.osdButtons.length; i++) {
            var focused = state.focusArea === 'osd' && i === state.osdFocusIdx;
            els.osdButtons[i].classList.toggle('focused', focused);
        }
        if (els.quickFavsList) {
            var pills = els.quickFavsList.querySelectorAll('.quick-fav-pill');
            for (var j = 0; j < pills.length; j++) {
                pills[j].classList.toggle('focused', state.focusArea === 'quickfavs' && j === state.quickFavFocusIdx);
            }
        }
    }

    function updateErrorFocus() {
        for (var i = 0; i < els.errorButtons.length; i++) {
            els.errorButtons[i].classList.toggle('focused', state.focusArea === 'error' && i === state.errorFocusIdx);
        }
    }

    function updateSingleChannelRowEpg(channelPk, snap) {
        if (!snap || !snap.now) return;
        var epgEl = document.getElementById('ch-epg-' + channelPk);
        if (epgEl) {
            epgEl.textContent = snap.now.title;
        }
        var progEl = document.getElementById('ch-prog-' + channelPk);
        if (progEl) {
            progEl.style.width = snap.progressPct + '%';
        }
    }

    function schedulePrefetchVisibleEpg() {
        if (state.epgDebounceTimer) {
            clearTimeout(state.epgDebounceTimer);
        }
        state.epgDebounceTimer = setTimeout(function () {
            prefetchVisibleEpgNow();
        }, 450);
    }

    function prefetchVisibleEpgNow() {
        if (!state.filteredChannels.length || !state.drawerOpen) return;
        var start = Math.max(0, state.drawerFocusIdx - 3);
        var end = Math.min(state.filteredChannels.length, state.drawerFocusIdx + 8);
        var slice = state.filteredChannels.slice(start, end);

        var i = 0;
        function next() {
            if (i >= slice.length || !state.drawerOpen) return;
            var ch = slice[i++];
            window.Init7Api.fetchChannelEpg(ch.pk).then(function (snap) {
                updateSingleChannelRowEpg(ch.pk, snap);
                if (state.playingChannel && state.playingChannel.pk === ch.pk) {
                    renderOsdEpg(snap);
                }
                setTimeout(next, 60);
            }).catch(function () {
                setTimeout(next, 60);
            });
        }
        next();
    }

    function getSourceBadgeText() {
        var uOn = window.Init7Api.isUdpxyEnabled();
        if (!uOn) return 'Source: HLS (102 Ch)';
        var host = window.Init7Api.getUdpxyHost();
        if (host.indexOf('127.0.0.1:') === 0) {
            return 'Source: On-TV (' + (state.allChannels.length || 242) + ' Ch)';
        }
        return 'Source: udpxy (' + (state.allChannels.length || 242) + ' Ch)';
    }

    function updateOsdChannelMeta() {
        var ch = state.playingChannel;
        if (!ch) return;

        els.osdChNumber.textContent = String(ch.number);
        els.osdChName.textContent = ch.name;

        var fav = isFavorite(ch.pk);
        els.osdFavStar.classList.toggle('hidden', !fav);
        els.osdActionFavIcon.textContent = fav ? '★' : '☆';
        els.osdActionFavLabel.textContent = fav ? 'Favorited' : 'Favorite';

        els.osdBadgeHd.classList.toggle('hidden', !ch.hd);
        els.osdBadgeLang.textContent = ch.language.toUpperCase();
        els.osdBadgeEngine.textContent = window.Init7Player.getActiveEngineBadge();
        els.osdActionEngineLabel.textContent = 'Engine: ' + window.Init7Player.getEngineModeLabel();
        if (els.osdActionUdpxyLabel) {
            els.osdActionUdpxyLabel.textContent = getSourceBadgeText();
        }

        if (ch.logo) {
            els.osdChLogo.src = ch.logo;
            els.osdChLogo.classList.remove('hidden');
            els.osdChFallback.classList.add('hidden');
            els.osdChLogo.onerror = function () {
                els.osdChLogo.classList.add('hidden');
                els.osdChFallback.textContent = getInitials(ch.name);
                els.osdChFallback.classList.remove('hidden');
            };
        } else {
            els.osdChLogo.classList.add('hidden');
            els.osdChFallback.textContent = getInitials(ch.name);
            els.osdChFallback.classList.remove('hidden');
        }

        for (var i = 0; i < state.channelElements.length; i++) {
            var el = state.channelElements[i];
            el.classList.toggle('playing', el.getAttribute('data-pk') === ch.pk);
        }
        renderQuickFavoritesBar();
    }

    function renderOsdEpg(snap) {
        if (!snap || !snap.now) {
            els.osdNowTime.textContent = 'LIVE';
            els.osdNowTitle.textContent = state.playingChannel ? state.playingChannel.name + ' Live' : 'Live Broadcast';
            els.osdNowCat.classList.add('hidden');
            els.osdNowProgress.style.width = '100%';
            els.osdNowDesc.textContent = 'Direct live television feed via Init7 TV7.';
            if (snap && snap.next) {
                els.osdNextTime.textContent = snap.next.startFormatted + ' – ' + snap.next.endFormatted;
                els.osdNextTitle.textContent = snap.next.title;
            } else {
                els.osdNextTime.textContent = '--:--';
                els.osdNextTitle.textContent = 'Schedule loading...';
            }
            return;
        }

        var nowProg = snap.now;
        els.osdNowTime.textContent = nowProg.startFormatted + ' – ' + nowProg.endFormatted;
        els.osdNowTitle.textContent = nowProg.title + (nowProg.subTitle ? ' — ' + nowProg.subTitle : '');

        if (nowProg.categories && nowProg.categories.length > 0) {
            els.osdNowCat.textContent = nowProg.categories.slice(0, 2).join(' • ');
            els.osdNowCat.classList.remove('hidden');
        } else {
            els.osdNowCat.classList.add('hidden');
        }

        els.osdNowProgress.style.width = snap.progressPct + '%';
        els.osdNowDesc.textContent = nowProg.desc || 'Live broadcast on ' + (state.playingChannel ? state.playingChannel.name : 'Init7 TV');

        if (snap.next) {
            els.osdNextTime.textContent = snap.next.startFormatted + ' – ' + snap.next.endFormatted;
            els.osdNextTitle.textContent = snap.next.title + (snap.next.subTitle ? ' — ' + snap.next.subTitle : '');
        } else {
            els.osdNextTime.textContent = '--:--';
            els.osdNextTitle.textContent = '—';
        }
    }

    function updateTrackButtonsSummary() {
        var audioTracks = window.Init7Player.getAudioTracks();
        var activeAudio = audioTracks.filter(function (t) { return t.selected; })[0];
        if (activeAudio) {
            els.osdActionAudioLabel.textContent = 'Audio: ' + activeAudio.label;
        } else if (audioTracks.length > 0) {
            els.osdActionAudioLabel.textContent = 'Audio (' + audioTracks.length + ')';
        } else {
            els.osdActionAudioLabel.textContent = 'Audio';
        }

        var subTracks = window.Init7Player.getSubtitleTracks();
        var activeSub = subTracks.filter(function (t) { return t.selected; })[0];
        els.osdActionSubLabel.textContent = 'Subtitles: ' + (activeSub ? activeSub.label : 'Off');
    }

    function selectAndPlayChannel(channel, closeOverlaysOnSelect) {
        if (!channel) return;

        var isSameChannel = state.playingChannel && state.playingChannel.pk === channel.pk && els.errorOverlay.classList.contains('hidden');

        if (!isSameChannel) {
            state.playingChannel = channel;
            try {
                localStorage.setItem('init7_last_channel_pk', channel.pk);
            } catch (e) {}

            els.errorOverlay.classList.add('hidden');
            updateOsdChannelMeta();

            var cachedSnap = window.Init7Api.getCachedNowNext(channel.pk);
            renderOsdEpg(cachedSnap);

            window.Init7Api.fetchChannelEpg(channel.pk).then(function (snap) {
                updateSingleChannelRowEpg(channel.pk, snap);
                if (state.playingChannel && state.playingChannel.pk === channel.pk) {
                    renderOsdEpg(snap);
                }
            });

            window.Init7Player.playChannel(channel);
        }

        if (closeOverlaysOnSelect) {
            if (state.guideOpen) {
                closeGuide(true);
            }
            if (state.drawerOpen) {
                closeDrawer();
            }
            hideOsd();
        } else if (!state.guideOpen) {
            showOsd(6000, false);
        }
    }

    function zapRelativeChannel(delta) {
        var list = state.filteredChannels.length > 0 ? state.filteredChannels : state.allChannels;
        if (!list.length) return;
        var curIdx = state.playingChannel ? findChannelIndex(list, state.playingChannel.pk) : 0;
        if (curIdx === -1) curIdx = 0;
        var nextIdx = (curIdx + delta + list.length) % list.length;
        state.drawerFocusIdx = nextIdx;
        updateDrawerFocus(true);
        selectAndPlayChannel(list[nextIdx], false);
    }

    function handleNumpadDigit(digit) {
        if (state.numpadBuffer.length >= 3) {
            state.numpadBuffer = '';
        }
        state.numpadBuffer += String(digit);
        var targetNum = parseInt(state.numpadBuffer, 10);

        els.numpadDigits.textContent = state.numpadBuffer;
        var matched = state.allChannels.filter(function (c) { return c.number === targetNum; })[0];
        els.numpadPreview.textContent = matched ? matched.name : 'Channel not found';
        els.numpadOverlay.classList.remove('hidden');

        if (state.numpadTimer) clearTimeout(state.numpadTimer);
        state.numpadTimer = setTimeout(function () {
            commitNumpadChannel();
        }, 1400);
    }

    function commitNumpadChannel() {
        if (!state.numpadBuffer) return;
        if (state.numpadTimer) {
            clearTimeout(state.numpadTimer);
            state.numpadTimer = null;
        }
        var targetNum = parseInt(state.numpadBuffer, 10);
        state.numpadBuffer = '';
        els.numpadOverlay.classList.add('hidden');

        var matched = state.allChannels.filter(function (c) { return c.number === targetNum; })[0];
        if (matched) {
            if (state.guideOpen) {
                closeGuide();
            }
            var idxInFiltered = findChannelIndex(state.filteredChannels, matched.pk);
            if (idxInFiltered !== -1) {
                state.drawerFocusIdx = idxInFiltered;
                updateDrawerFocus(true);
            }
            selectAndPlayChannel(matched, false);
        } else {
            showToast('Channel ' + targetNum + ' not available');
        }
    }

    function openTrackModal(title, options, onSelect) {
        els.modalTitle.textContent = title;
        els.modalBody.innerHTML = '';
        state.modalOptions = [];
        state.modalFocusIdx = 0;

        if (!options || options.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'epg-detail-desc';
            empty.textContent = 'No alternate tracks reported for this broadcast.';
            els.modalBody.appendChild(empty);
        } else {
            options.forEach(function (opt, idx) {
                var btn = document.createElement('div');
                btn.className = 'modal-option' + (opt.selected ? ' selected' : '');
                if (opt.selected) state.modalFocusIdx = idx;

                var labelSpan = document.createElement('span');
                labelSpan.textContent = opt.label;
                btn.appendChild(labelSpan);

                var statusSpan = document.createElement('span');
                statusSpan.textContent = opt.selected ? '✓ Active' : '';
                btn.appendChild(statusSpan);

                btn.addEventListener('click', function () {
                    onSelect(opt);
                    closeModal();
                });

                els.modalBody.appendChild(btn);
                state.modalOptions.push({ el: btn, data: opt, onSelect: onSelect });
            });
        }

        els.modalOverlay.classList.remove('hidden');
        state.focusArea = 'modal';
        updateModalFocus();
        updateBackdrop();
    }

    function openProgramDetailsModal(customChannel, customProg) {
        var ch = customChannel || state.playingChannel;
        var snap = (!customProg && ch) ? window.Init7Api.getCachedNowNext(ch.pk) : null;
        var nowProg = customProg || (snap ? snap.now : null);

        els.modalTitle.textContent = nowProg ? nowProg.title : (ch ? ch.name : 'Program Info');
        els.modalBody.innerHTML = '';
        state.modalOptions = [];
        state.modalFocusIdx = 0;

        var meta = document.createElement('div');
        meta.className = 'epg-detail-meta';
        if (nowProg) {
            var parts = [nowProg.startFormatted + ' – ' + nowProg.endFormatted];
            if (ch) parts.unshift(ch.name);
            if (nowProg.subTitle) parts.push(nowProg.subTitle);
            if (nowProg.categories && nowProg.categories.length) parts.push(nowProg.categories.join(', '));
            if (nowProg.country) parts.push(nowProg.country);
            meta.textContent = parts.join('  •  ');
        } else {
            meta.textContent = ch ? (ch.name + ' • Live Feed') : 'Live Feed';
        }
        els.modalBody.appendChild(meta);

        var desc = document.createElement('div');
        desc.className = 'epg-detail-desc';
        desc.textContent = (nowProg && nowProg.desc)
            ? nowProg.desc
            : 'No extended program description published for this broadcast.';
        els.modalBody.appendChild(desc);

        if (nowProg && Array.isArray(nowProg.credits) && nowProg.credits.length > 0) {
            var creditsGrid = document.createElement('div');
            creditsGrid.className = 'epg-credits-grid';
            nowProg.credits.slice(0, 10).forEach(function (c) {
                var cell = document.createElement('div');
                cell.textContent = (c.position ? (c.position.toUpperCase() + ': ') : '') + c.name;
                creditsGrid.appendChild(cell);
            });
            els.modalBody.appendChild(creditsGrid);
        }

        els.modalOverlay.classList.remove('hidden');
        state.focusArea = 'modal';
        updateModalFocus();
        updateBackdrop();
    }

    function updateModalFocus() {
        if (state.modalOptions.length === 0) {
            els.modalCloseBtn.classList.add('focused');
            return;
        }
        els.modalCloseBtn.classList.remove('focused');
        state.modalOptions.forEach(function (item, idx) {
            item.el.classList.toggle('focused', idx === state.modalFocusIdx);
        });
    }

    function closeModal() {
        els.modalOverlay.classList.add('hidden');
        if (state.guideOpen) {
            state.focusArea = 'guide';
        } else if (state.osdVisible) {
            state.focusArea = 'osd';
        } else if (state.drawerOpen) {
            state.focusArea = 'drawer';
        } else {
            state.focusArea = 'fullscreen';
        }
        updateDrawerFocus(false);
        updateOsdFocus();
        updateBackdrop();
    }

    function updateNetworkStatusBanner() {
        var uOn = window.Init7Api.isUdpxyEnabled();
        var host = window.Init7Api.getUdpxyHost();
        var count = state.allChannels.length || (uOn ? 242 : 102);

        if (uOn) {
            var isLocal = host.indexOf('127.0.0.1:') === 0;
            els.networkStatus.textContent = (isLocal ? 'On-TV Multicast • ' : ('udpxy • ' + host + ' • ')) + count + ' Ch';
            if (isLocal) {
                window.Init7Api.ensureLocalUdpxyServiceRunning().then(function (online) {
                    if (!window.Init7Api.isUdpxyEnabled()) return;
                    els.networkStatus.textContent = online
                        ? ('On-TV Multicast Ready • ' + (state.allChannels.length || 242) + ' Ch')
                        : ('Multicast • ' + (state.allChannels.length || 242) + ' Ch');
                });
            } else {
                window.Init7Api.checkUdpxyStatus(host).then(function (online) {
                    if (!window.Init7Api.isUdpxyEnabled()) return;
                    els.networkStatus.textContent = online
                        ? ('udpxy (' + host + ') • ' + (state.allChannels.length || 242) + ' Ch')
                        : ('udpxy Fallback • ' + (state.allChannels.length || 242) + ' Ch');
                });
            }
        } else {
            els.networkStatus.textContent = 'Init7 HLS • ' + count + ' Ch';
        }

        if (els.osdActionUdpxyLabel) {
            els.osdActionUdpxyLabel.textContent = getSourceBadgeText();
        }
    }

    function reloadChannelCatalog(toastPrefix) {
        var prevPk = state.playingChannel ? state.playingChannel.pk : null;
        var prevName = state.playingChannel ? state.playingChannel.name : '';

        window.Init7Api.loadBundledChannels().then(function (channels) {
            if (!channels || !channels.length) return;
            state.allChannels = channels;
            if (els.countAll) els.countAll.textContent = String(channels.length);
            updateNetworkStatusBanner();

            var nextPlaying = null;
            if (prevPk) {
                nextPlaying = channels.filter(function (c) { return c.pk === prevPk; })[0];
            }
            if (!nextPlaying && prevName) {
                var baseName = prevName.replace(/\s+HD$/i, '').trim().toLowerCase();
                nextPlaying = channels.filter(function (c) {
                    return c.name.replace(/\s+HD$/i, '').trim().toLowerCase() === baseName;
                })[0];
            }
            if (!nextPlaying) {
                nextPlaying = channels[0];
            }

            state.playingChannel = null;
            applyGroupFilter(state.activeGroup === 'guide' ? 'all' : state.activeGroup, false);

            var idxInFiltered = findChannelIndex(state.filteredChannels, nextPlaying.pk);
            if (idxInFiltered !== -1) {
                state.drawerFocusIdx = idxInFiltered;
                updateDrawerFocus(true);
            }
            selectAndPlayChannel(nextPlaying, false);

            if (toastPrefix) {
                showToast(toastPrefix + ' (' + channels.length + ' channels)');
            }
        });
    }

    function openUdpxySettingsModal() {
        var curEnabled = window.Init7Api.isUdpxyEnabled();
        var curHost = window.Init7Api.getUdpxyHost();

        var options = [
            {
                id: 'on-tv-local',
                enabled: true,
                host: window.Init7Api.ON_TV_LOCAL_HOST,
                label: 'Built-in On-TV Multicast Receiver (127.0.0.1:40223) • All 242 Channels (Recommended, No External Proxy Needed)',
                selected: curEnabled && curHost === window.Init7Api.ON_TV_LOCAL_HOST
            },
            {
                id: 'on-external-ip',
                enabled: true,
                host: window.Init7Api.EXTERNAL_UDPXY_IP_HOST,
                label: 'External udpxy (' + window.Init7Api.EXTERNAL_UDPXY_IP_HOST + ') • All 242 Channels',
                selected: curEnabled && curHost === window.Init7Api.EXTERNAL_UDPXY_IP_HOST
            },
            {
                id: 'on-external-name',
                enabled: true,
                host: window.Init7Api.EXTERNAL_UDPXY_NAME_HOST,
                label: 'External udpxy (' + window.Init7Api.EXTERNAL_UDPXY_NAME_HOST + ') • All 242 Channels',
                selected: curEnabled && curHost === window.Init7Api.EXTERNAL_UDPXY_NAME_HOST
            },
            {
                id: 'off-hls',
                enabled: false,
                host: curHost,
                label: 'Init7 Direct HLS Only (No Multicast) • 102 Channels',
                selected: !curEnabled
            }
        ];

        openTrackModal('Stream Source (242 Multicast vs 102 HLS)', options, function (selected) {
            window.Init7Api.setUdpxyConfig(selected.enabled, selected.host);
            reloadChannelCatalog(
                selected.enabled
                    ? ('📡 Multicast Source: ' + (selected.host.indexOf('127.0.0.1') === 0 ? 'Built-in On-TV Receiver' : selected.host))
                    : '📡 Switched to Init7 Direct HLS Mode'
            );
        });
    }

    function triggerOsdAction(actionName) {
        switch (actionName) {
            case 'channels':
                if (state.drawerOpen) {
                    closeDrawer();
                } else {
                    openDrawer();
                }
                break;
            case 'guide':
                if (state.guideOpen) {
                    closeGuide();
                } else {
                    openGuide();
                }
                break;
            case 'favorite':
                toggleFavorite(state.playingChannel);
                break;
            case 'audio':
                var audioTracks = window.Init7Player.getAudioTracks();
                openTrackModal('Select Audio Track', audioTracks, function (selected) {
                    window.Init7Player.setAudioTrack(selected);
                    showToast('Audio: ' + selected.label);
                });
                break;
            case 'subtitles':
                var subTracks = window.Init7Player.getSubtitleTracks();
                openTrackModal('Select Subtitles', subTracks, function (selected) {
                    window.Init7Player.setSubtitleTrack(selected);
                    showToast('Subtitles: ' + selected.label);
                });
                break;
            case 'details':
                openProgramDetailsModal();
                break;
            case 'udpxy':
                openUdpxySettingsModal();
                break;
            case 'engine':
                window.Init7Player.cycleEngineMode();
                updateOsdChannelMeta();
                showToast('Player Engine: ' + window.Init7Player.getEngineModeLabel());
                break;
        }
    }

    function triggerErrorAction(actionName) {
        if (actionName === 'retry' && state.playingChannel) {
            els.errorOverlay.classList.add('hidden');
            selectAndPlayChannel(state.playingChannel, false);
        } else if (actionName === 'switch-engine') {
            els.errorOverlay.classList.add('hidden');
            window.Init7Player.cycleEngineMode();
            updateOsdChannelMeta();
            showToast('Switched to ' + window.Init7Player.getEngineModeLabel());
        } else if (actionName === 'channels') {
            els.errorOverlay.classList.add('hidden');
            openDrawer();
        }
    }

    function handleBackKey() {
        if (!els.modalOverlay.classList.contains('hidden')) {
            closeModal();
            return;
        }
        if (state.guideOpen) {
            closeGuide();
            return;
        }
        if (!els.errorOverlay.classList.contains('hidden')) {
            els.errorOverlay.classList.add('hidden');
            openDrawer();
            return;
        }
        if (state.drawerOpen) {
            closeDrawer();
            hideOsd();
            return;
        }
        if (state.osdVisible) {
            hideOsd();
            return;
        }
        if (state.backExitArmed) {
            if (window.tizen && window.tizen.application) {
                try {
                    window.tizen.application.getCurrentApplication().exit();
                    return;
                } catch (e) {}
            }
            openDrawer();
            return;
        }
        state.backExitArmed = true;
        showToast('Press BACK again to exit Init7 TV (or OK for Controls)', 2500);
        if (state.backExitTimer) clearTimeout(state.backExitTimer);
        state.backExitTimer = setTimeout(function () {
            state.backExitArmed = false;
        }, 2500);
    }

    function getContextualChannelForFavorite() {
        if (state.focusArea === 'guide' && state.filteredChannels[state.guideRowIdx]) {
            return state.filteredChannels[state.guideRowIdx];
        }
        if (state.focusArea === 'drawer' && state.filteredChannels[state.drawerFocusIdx]) {
            return state.filteredChannels[state.drawerFocusIdx];
        }
        if (state.focusArea === 'quickfavs' && state.quickFavChannels[state.quickFavFocusIdx]) {
            return state.quickFavChannels[state.quickFavFocusIdx];
        }
        return state.playingChannel;
    }

    function handleKeyUp(e) {
        var code = e.keyCode || e.which;
        if (code !== KEYS.ENTER) return;

        if (state.enterHoldTimer) {
            clearTimeout(state.enterHoldTimer);
            state.enterHoldTimer = null;
        }
        if (state.enterHoldTriggered) {
            state.enterHoldTriggered = false;
            return;
        }

        if (state.focusArea === 'drawer' && state.filteredChannels.length > 0) {
            var ch = state.filteredChannels[state.drawerFocusIdx];
            selectAndPlayChannel(ch, true);
        } else if (state.focusArea === 'guide' && state.filteredChannels.length > 0) {
            var gCh = state.filteredChannels[state.guideRowIdx];
            closeGuide(true);
            selectAndPlayChannel(gCh, true);
        }
    }

    function handleKeyDown(e) {
        var code = e.keyCode || e.which;

        if (code >= KEYS.NUM_0 && code <= KEYS.NUM_9) {
            e.preventDefault();
            handleNumpadDigit(code - KEYS.NUM_0);
            return;
        }

        if (state.numpadBuffer && code === KEYS.ENTER) {
            e.preventDefault();
            commitNumpadChannel();
            return;
        }

        // Play/Pause button on QN90AA SolarCell remote OR Yellow button OR F key toggles ★ Favorite
        if (code === KEYS.YELLOW || code === KEYS.KEY_F || code === KEYS.PLAY_PAUSE || code === KEYS.PLAY || code === KEYS.PAUSE) {
            e.preventDefault();
            toggleFavorite(getContextualChannelForFavorite());
            return;
        }

        // Guide button or G key toggles the Full Multi-Channel EPG TV Guide
        if (code === KEYS.GUIDE || code === KEYS.KEY_G) {
            e.preventDefault();
            if (state.guideOpen) {
                closeGuide();
            } else {
                openGuide();
            }
            return;
        }

        if (code === KEYS.CH_LIST || code === KEYS.KEY_C) {
            e.preventDefault();
            if (state.drawerOpen) {
                closeDrawer();
            } else {
                openDrawer();
            }
            return;
        }

        if (code === KEYS.INFO || code === KEYS.KEY_I) {
            e.preventDefault();
            if (state.guideOpen) {
                var gChan = state.filteredChannels[state.guideRowIdx];
                openProgramDetailsModal(gChan, state.guideSelectedProg);
            } else if (state.osdVisible && state.focusArea === 'osd') {
                openProgramDetailsModal();
            } else {
                showOsd(8000, true);
            }
            return;
        }

        if (code === KEYS.BACK || code === KEYS.ESC || code === KEYS.BACKSPACE) {
            e.preventDefault();
            handleBackKey();
            return;
        }

        if (state.focusArea === 'modal') {
            e.preventDefault();
            if (code === KEYS.UP && state.modalOptions.length > 0) {
                state.modalFocusIdx = (state.modalFocusIdx - 1 + state.modalOptions.length) % state.modalOptions.length;
                updateModalFocus();
            } else if (code === KEYS.DOWN && state.modalOptions.length > 0) {
                state.modalFocusIdx = (state.modalFocusIdx + 1) % state.modalOptions.length;
                updateModalFocus();
            } else if (code === KEYS.ENTER) {
                if (state.modalOptions.length > 0 && state.modalOptions[state.modalFocusIdx]) {
                    var chosen = state.modalOptions[state.modalFocusIdx];
                    chosen.onSelect(chosen.data);
                }
                closeModal();
            }
            return;
        }

        // Full Multi-Channel EPG TV Guide Navigation
        if (state.focusArea === 'guide') {
            e.preventDefault();
            var gLen = state.filteredChannels.length;
            if (!gLen) return;

            if (code === KEYS.UP) {
                state.guideRowIdx = (state.guideRowIdx - 1 + gLen) % gLen;
                renderGuideGrid();
                scheduleGuideEpgPrefetch();
            } else if (code === KEYS.DOWN) {
                state.guideRowIdx = (state.guideRowIdx + 1) % gLen;
                renderGuideGrid();
                scheduleGuideEpgPrefetch();
            } else if (code === KEYS.CH_UP || code === KEYS.PAGE_UP) {
                state.guideRowIdx = Math.max(0, state.guideRowIdx - GUIDE_VISIBLE_ROWS);
                renderGuideGrid();
                scheduleGuideEpgPrefetch();
            } else if (code === KEYS.CH_DOWN || code === KEYS.PAGE_DOWN) {
                state.guideRowIdx = Math.min(gLen - 1, state.guideRowIdx + GUIDE_VISIBLE_ROWS);
                renderGuideGrid();
                scheduleGuideEpgPrefetch();
            } else if (code === KEYS.LEFT) {
                moveGuideTimeline(-1);
            } else if (code === KEYS.RIGHT) {
                moveGuideTimeline(1);
            } else if (code === KEYS.ENTER && !e.repeat) {
                state.enterHoldTriggered = false;
                if (state.enterHoldTimer) clearTimeout(state.enterHoldTimer);
                state.enterHoldTimer = setTimeout(function () {
                    state.enterHoldTriggered = true;
                    toggleFavorite(state.filteredChannels[state.guideRowIdx]);
                }, 550);
            }
            return;
        }

        if (code === KEYS.CH_UP || code === KEYS.PAGE_UP) {
            e.preventDefault();
            zapRelativeChannel(1);
            return;
        }
        if (code === KEYS.CH_DOWN || code === KEYS.PAGE_DOWN) {
            e.preventDefault();
            zapRelativeChannel(-1);
            return;
        }

        if (state.focusArea === 'error') {
            e.preventDefault();
            if (code === KEYS.LEFT) {
                state.errorFocusIdx = (state.errorFocusIdx - 1 + els.errorButtons.length) % els.errorButtons.length;
                updateErrorFocus();
            } else if (code === KEYS.RIGHT) {
                state.errorFocusIdx = (state.errorFocusIdx + 1) % els.errorButtons.length;
                updateErrorFocus();
            } else if (code === KEYS.ENTER) {
                var errBtn = els.errorButtons[state.errorFocusIdx];
                if (errBtn) triggerErrorAction(errBtn.getAttribute('data-error-action'));
            }
            return;
        }

        if (state.focusArea === 'drawer') {
            e.preventDefault();
            var len = state.filteredChannels.length;
            if (code === KEYS.UP && len > 0) {
                state.drawerFocusIdx = (state.drawerFocusIdx - 1 + len) % len;
                updateDrawerFocus(true);
                schedulePrefetchVisibleEpg();
            } else if (code === KEYS.DOWN && len > 0) {
                state.drawerFocusIdx = (state.drawerFocusIdx + 1) % len;
                updateDrawerFocus(true);
                schedulePrefetchVisibleEpg();
            } else if (code === KEYS.LEFT) {
                var curGroupIdx = GROUPS.indexOf(state.activeGroup);
                var prevGroup = GROUPS[(curGroupIdx - 1 + GROUPS.length) % GROUPS.length];
                applyGroupFilter(prevGroup, false);
            } else if (code === KEYS.RIGHT) {
                var curGroupIdx2 = GROUPS.indexOf(state.activeGroup);
                var nextGroup = GROUPS[(curGroupIdx2 + 1) % GROUPS.length];
                applyGroupFilter(nextGroup, false);
            } else if (code === KEYS.ENTER && len > 0 && !e.repeat) {
                // Support holding OK for 550ms to toggle ★ Favorite, or short press OK (on keyup) to tune
                state.enterHoldTriggered = false;
                if (state.enterHoldTimer) clearTimeout(state.enterHoldTimer);
                state.enterHoldTimer = setTimeout(function () {
                    state.enterHoldTriggered = true;
                    toggleFavorite(state.filteredChannels[state.drawerFocusIdx]);
                }, 550);
            }
            return;
        }

        // Quick Favorites Strip Navigation on Main OSD Menu
        if (state.focusArea === 'quickfavs') {
            e.preventDefault();
            var qLen = state.quickFavChannels.length;
            if (code === KEYS.LEFT && qLen > 0) {
                state.quickFavFocusIdx = (state.quickFavFocusIdx - 1 + qLen) % qLen;
                updateOsdFocus();
                showOsd(7000, false);
            } else if (code === KEYS.RIGHT && qLen > 0) {
                state.quickFavFocusIdx = (state.quickFavFocusIdx + 1) % qLen;
                updateOsdFocus();
                showOsd(7000, false);
            } else if (code === KEYS.DOWN) {
                state.focusArea = 'osd';
                updateOsdFocus();
                showOsd(7000, true);
            } else if (code === KEYS.UP) {
                openDrawer();
            } else if (code === KEYS.ENTER && qLen > 0) {
                var qCh = state.quickFavChannels[state.quickFavFocusIdx];
                if (qCh) selectAndPlayChannel(qCh, true);
            }
            return;
        }

        if (state.focusArea === 'osd') {
            e.preventDefault();
            if (code === KEYS.LEFT) {
                state.osdFocusIdx = (state.osdFocusIdx - 1 + els.osdButtons.length) % els.osdButtons.length;
                updateOsdFocus();
                showOsd(7000, true);
            } else if (code === KEYS.RIGHT) {
                state.osdFocusIdx = (state.osdFocusIdx + 1) % els.osdButtons.length;
                updateOsdFocus();
                showOsd(7000, true);
            } else if (code === KEYS.UP) {
                if (state.quickFavChannels.length > 0) {
                    state.focusArea = 'quickfavs';
                    updateOsdFocus();
                    showOsd(7000, false);
                } else {
                    openDrawer();
                }
            } else if (code === KEYS.DOWN) {
                hideOsd();
            } else if (code === KEYS.ENTER) {
                var btn = els.osdButtons[state.osdFocusIdx];
                if (btn) triggerOsdAction(btn.getAttribute('data-action'));
            }
            return;
        }

        if (state.focusArea === 'fullscreen') {
            e.preventDefault();
            if (code === KEYS.UP) {
                zapRelativeChannel(1);
            } else if (code === KEYS.DOWN) {
                zapRelativeChannel(-1);
            } else if (code === KEYS.LEFT) {
                openDrawer();
            } else if (code === KEYS.ENTER || code === KEYS.RIGHT) {
                showOsd(7000, true);
            }
        }
    }

    function wireClickHandlers() {
        els.groupTabs.forEach(function (tab) {
            tab.addEventListener('click', function () {
                applyGroupFilter(tab.getAttribute('data-group'), false);
            });
        });

        els.osdButtons.forEach(function (btn, idx) {
            btn.addEventListener('click', function () {
                state.osdFocusIdx = idx;
                updateOsdFocus();
                triggerOsdAction(btn.getAttribute('data-action'));
            });
        });

        els.errorButtons.forEach(function (btn, idx) {
            btn.addEventListener('click', function () {
                state.errorFocusIdx = idx;
                updateErrorFocus();
                triggerErrorAction(btn.getAttribute('data-error-action'));
            });
        });

        if (els.modalCloseBtn) {
            els.modalCloseBtn.addEventListener('click', closeModal);
        }
    }

    function wirePlayerCallbacks() {
        window.Init7Player.setCallbacks({
            onBufferingStart: function (channel, engineLabel) {
                els.loadingTitle.textContent = 'Tuning ' + channel.name + '...';
                els.loadingSubtitle.textContent = 'Init7 TV7 Live • ' + engineLabel;
                if (channel.logo) {
                    els.loadingLogo.src = channel.logo;
                    els.loadingLogo.classList.remove('hidden');
                } else {
                    els.loadingLogo.classList.add('hidden');
                }
                els.loadingOverlay.classList.remove('hidden');
                els.osdStreamInfo.textContent = 'Buffering...';
                updateOsdChannelMeta();
            },
            onBufferingComplete: function (channel, engineLabel) {
                els.loadingOverlay.classList.add('hidden');
                els.osdStreamInfo.textContent = 'LIVE • ' + engineLabel;
                updateOsdChannelMeta();
            },
            onStreamPlaying: function (channel, engineLabel) {
                els.loadingOverlay.classList.add('hidden');
                els.errorOverlay.classList.add('hidden');
                els.osdStreamInfo.textContent = 'LIVE • ' + engineLabel;
                updateOsdChannelMeta();
                updateTrackButtonsSummary();
            },
            onTracksUpdated: function () {
                updateTrackButtonsSummary();
            },
            onError: function (errMsg) {
                els.loadingOverlay.classList.add('hidden');
                els.errorTitle.textContent = state.playingChannel
                    ? ('Unable to play ' + state.playingChannel.name)
                    : 'Stream Error';
                els.errorMessage.textContent = errMsg || 'Please check your Init7 network connection.';
                els.errorOverlay.classList.remove('hidden');
                state.focusArea = 'error';
                state.errorFocusIdx = 0;
                updateErrorFocus();
            }
        });
    }

    function initializeChannels(channels) {
        if (!channels || !channels.length) return;
        state.allChannels = channels;
        ensureStarterFavorites(channels);

        if (els.countAll) els.countAll.textContent = String(channels.length);
        if (els.countFav) els.countFav.textContent = String(state.favorites.length);
        updateNetworkStatusBanner();

        if (state.activeGroup === 'fav' && state.favorites.length === 0) {
            state.activeGroup = 'all';
        }
        if (state.activeGroup === 'guide') {
            state.activeGroup = 'all';
        }

        applyGroupFilter(state.activeGroup, false);
        renderQuickFavoritesBar();

        if (!state.playingChannel) {
            var lastPk = null;
            try {
                lastPk = localStorage.getItem('init7_last_channel_pk');
            } catch (e) {}
            var initialChannel = (lastPk && channels.filter(function (c) { return c.pk === lastPk; })[0]) || channels[0];
            var idxInFiltered = findChannelIndex(state.filteredChannels, initialChannel.pk);
            if (idxInFiltered !== -1) {
                state.drawerFocusIdx = idxInFiltered;
                updateDrawerFocus(true);
            }
            selectAndPlayChannel(initialChannel, false);
            handleDeepLinkAppControl();
        }
    }

    function init() {
        registerTizenKeys();
        wireClickHandlers();
        wirePlayerCallbacks();
        updateClocks();

        // Start built-in On-TV Multicast Receiver background service automatically
        window.Init7Api.ensureLocalUdpxyServiceRunning();

        setInterval(updateClocks, 10000);
        setInterval(function () {
            if (state.playingChannel) {
                var snap = window.Init7Api.getCachedNowNext(state.playingChannel.pk);
                if (snap) renderOsdEpg(snap);
            }
            if (state.drawerOpen) {
                schedulePrefetchVisibleEpg();
            }
            if (state.guideOpen) {
                renderGuideGrid();
            }
        }, 30000);

        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('keyup', handleKeyUp);
        window.addEventListener('appcontrol', handleDeepLinkAppControl);

        window.Init7Api.loadBundledChannels().then(function (bundled) {
            if (bundled && bundled.length > 0) {
                initializeChannels(bundled);
            }
            return window.Init7Api.fetchLiveChannels();
        }).then(function (liveChannels) {
            if (liveChannels && liveChannels.length > 0) {
                if (!state.allChannels.length) {
                    initializeChannels(liveChannels);
                } else {
                    updateNetworkStatusBanner();
                }
            }
        }).catch(function () {
            updateNetworkStatusBanner();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
