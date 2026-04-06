/* ============================================================================
   Quran Radio Cairo — LG webOS TV App
   ============================================================================ */
(function () {
    'use strict';

    /* ======================================================================
       Logger
       ====================================================================== */
    const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
    const LOG_LEVEL = LOG_LEVELS.INFO;
    const log = {
        debug: function () { if (LOG_LEVEL <= LOG_LEVELS.DEBUG) console.log.apply(console, ['[DEBUG]'].concat([].slice.call(arguments))); },
        info: function () { if (LOG_LEVEL <= LOG_LEVELS.INFO) console.log.apply(console, ['[INFO]'].concat([].slice.call(arguments))); },
        warn: function () { if (LOG_LEVEL <= LOG_LEVELS.WARN) console.warn.apply(console, ['[WARN]'].concat([].slice.call(arguments))); },
        error: function () { if (LOG_LEVEL <= LOG_LEVELS.ERROR) console.error.apply(console, ['[ERROR]'].concat([].slice.call(arguments))); }
    };

    /* ======================================================================
       Constants
       ====================================================================== */
    const STREAM_URL = 'https://service.webvideocore.net/CL1olYogIrDWvwqiIKK7eCxOS4PStqG9DuEjAr2ZjZQtvS3d4y9r0cvRhvS17SGN/a_7a4vuubc6mo8.m3u8';
    const FALLBACK_URL = 'https://stream.zeno.fm/tv0x28xvyc9uv';
    const SCHEDULE_API = 'https://API.misrquran.gov.eg/api/RadioProgrammeSchedule/GetByDay';
    const PRAYER_API_BASE = 'https://API.misrquran.gov.eg/api/PrayerTimes/GetTodaysTimes';
    const ALADHAN_API = 'https://api.aladhan.com/v1/timings';
    const NOMINATIM_API = 'https://nominatim.openstreetmap.org/reverse';
    const IP_GEO_APIS = [
        { url: 'https://ipapi.co/json/', extract: function (d) {
            return d && d.latitude && d.longitude
                ? { lat: d.latitude, lng: d.longitude, city: d.city, country: d.country_name }
                : null;
        }},
        { url: 'https://ipwho.is/', extract: function (d) {
            return d && d.success && d.latitude && d.longitude
                ? { lat: d.latitude, lng: d.longitude, city: d.city, country: d.country }
                : null;
        }},
        { url: 'https://freeipapi.com/api/json', extract: function (d) {
            return d && d.latitude && d.longitude
                ? { lat: d.latitude, lng: d.longitude, city: d.cityName, country: d.countryName }
                : null;
        }},
        { url: 'https://get.geojs.io/v1/ip/geo.json', extract: function (d) {
            return d && d.latitude && d.longitude
                ? { lat: parseFloat(d.latitude), lng: parseFloat(d.longitude), city: d.city, country: d.country }
                : null;
        }}
    ];

    const CAIRO_TZ = 'Africa/Cairo';
    const CAIRO_LOCATION = { lat: 30.0444, lng: 31.2357, name: 'القاهرة' };

    const STORAGE_KEY = 'misrquran_state_v2';
    const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
    const MAX_RESPONSE_SIZE = 2 * 1024 * 1024; // 2 MB
    const PRE_AZAN_MINUTES = 5;
    const SCHEDULE_POLL_MS = 60 * 1000;
    const AZAN_CHECK_MS = 30 * 1000;
    const PROGRESS_UPDATE_MS = 30 * 1000;

    const MUEZZINS = {
        naqshbandi: { file: 'azan_naqshbandi.mp3', name: 'الشيخ سيد النقشبندي' },
        ismail: { file: 'azan_ismail.mp3', name: 'الشيخ مصطفى إسماعيل' },
        refaat: { file: 'azan_refaat.mp3', name: 'الشيخ محمد رفعت' }
    };

    // UI status strings (deduplicated)
    const STATUS = {
        READY: 'اضغط للتشغيل',
        CONNECTING: '...جاري الاتصال',
        BUFFERING: '...جاري التحميل',
        LIVE: 'بث مباشر',
        AZAN: 'الأذان - Paused for prayer',
        DUA: 'الدعاء بعد الأذان',
        STREAM_ERROR: 'خطأ في البث - اضغط للمحاولة'
    };

    /* webOS remote key codes */
    const KEY = {
        ENTER: 13,
        UP: 38,
        DOWN: 40,
        LEFT: 37,
        RIGHT: 39,
        BACK: 10009,
        RED: 403,
        GREEN: 404,
        YELLOW: 405,
        BLUE: 406,
        PLAY: 415,
        PAUSE: 19,
        STOP: 413,
        PLAY_PAUSE: 10252
    };

    /* ======================================================================
       Utilities
       ====================================================================== */

    /** Convert Western digits (0-9) to Eastern Arabic (٠-٩) */
    const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
    function toArabicDigits(s) {
        if (s == null) return '';
        return String(s).replace(/[0-9]/g, function (d) { return ARABIC_DIGITS[d]; });
    }

    /** Convert "AM/PM" to Arabic ص/م and Arabize digits */
    function arabizeTime(s) {
        if (s == null) return '';
        return toArabicDigits(String(s).replace(/AM/i, 'ص').replace(/PM/i, 'م'));
    }

    /** Escape HTML to prevent XSS from API responses */
    function escapeHtml(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /** Get current time in an IANA timezone as {h, m, s, minutes} */
    function getNowInTz(tz) {
        try {
            const fmt = new Intl.DateTimeFormat('en-US', {
                timeZone: tz,
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            const parts = fmt.formatToParts(new Date());
            let h = parseInt(parts.find(function (p) { return p.type === 'hour'; }).value);
            const m = parseInt(parts.find(function (p) { return p.type === 'minute'; }).value);
            const s = parseInt(parts.find(function (p) { return p.type === 'second'; }).value);
            h = h % 24;
            return { h: h, m: m, s: s, minutes: h * 60 + m };
        } catch (e) {
            const d = new Date();
            return { h: d.getHours(), m: d.getMinutes(), s: d.getSeconds(), minutes: d.getHours() * 60 + d.getMinutes() };
        }
    }

    /** Get today's date string (YYYY-MM-DD) in a timezone */
    function getTodayKeyInTz(tz) {
        try {
            return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
        } catch (e) {
            return new Date().toDateString();
        }
    }

    /** Debounce a function */
    function debounce(fn, ms) {
        let timer = null;
        return function () {
            const args = arguments;
            const ctx = this;
            clearTimeout(timer);
            timer = setTimeout(function () { fn.apply(ctx, args); }, ms);
        };
    }

    /** Unified XHR helper with error handling and size limits */
    function httpRequest(opts) {
        const xhr = new XMLHttpRequest();
        xhr.open(opts.method || 'GET', opts.url, true);
        if (opts.headers) {
            for (const k in opts.headers) xhr.setRequestHeader(k, opts.headers[k]);
        }
        xhr.timeout = opts.timeout || 15000;
        xhr.onload = function () {
            // Size limit check
            if (xhr.responseText && xhr.responseText.length > MAX_RESPONSE_SIZE) {
                log.warn('Response too large:', opts.url, xhr.responseText.length);
                if (opts.onError) opts.onError('response_too_large');
                return;
            }
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    const parsed = opts.parse === false ? xhr.responseText : JSON.parse(xhr.responseText);
                    if (opts.onSuccess) opts.onSuccess(parsed);
                } catch (e) {
                    log.error('Parse error:', opts.url, e);
                    if (opts.onError) opts.onError('parse_error', e);
                }
            } else {
                log.warn('HTTP error:', opts.url, xhr.status);
                if (opts.onError) opts.onError('http_error', xhr.status);
            }
        };
        xhr.onerror = function () {
            log.warn('Network error:', opts.url);
            if (opts.onError) opts.onError('network_error');
        };
        xhr.ontimeout = function () {
            log.warn('Timeout:', opts.url);
            if (opts.onError) opts.onError('timeout');
        };
        xhr.send(opts.body || null);
        return xhr;
    }

    /* ======================================================================
       Storage + Cache
       ====================================================================== */

    /** Load persistent state */
    function loadState() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
        catch (e) { return {}; }
    }

    /** Save persistent state (merge) */
    function saveState(patch) {
        try {
            const cur = loadState();
            localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.assign(cur, patch)));
        } catch (e) { log.warn('saveState failed', e); }
    }

    /** Get cached value (returns null if expired or missing) */
    function getCached(key) {
        const state = loadState();
        const entry = state[key];
        if (!entry || !entry.t || !entry.v) return null;
        if (Date.now() - entry.t > CACHE_TTL_MS) return null;
        return entry.v;
    }

    /** Set cached value with timestamp */
    function setCached(key, value) {
        const patch = {};
        patch[key] = { t: Date.now(), v: value };
        saveState(patch);
    }

    /* ======================================================================
       Application State
       ====================================================================== */
    const state = {
        // Playback
        audio: null,
        hls: null,
        playing: false,
        stoppingManually: false,
        retryAttempt: 0,
        maxRetries: 3,

        // Location
        currentLocation: Object.assign({}, CAIRO_LOCATION),
        useMyLocation: false,

        // Data
        cachedPrayerData: null,
        cachedSchedule: null,
        scheduleHash: '',
        currentProgramIdx: -1,
        midnightTimer: null,

        // Azan
        azanAudio: null,
        azanPlaying: false,
        wasPlayingBeforeAzan: false,
        azanTriggered: { _day: getTodayKeyInTz(CAIRO_TZ) },
        preAzanShown: { _day: getTodayKeyInTz(CAIRO_TZ) },
        activeMuezzin: 'ismail',
        azanEnabledPerPrayer: { fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true },

        // Timers
        intervals: [],
        sleepTimerId: null,
        sleepTimerEnd: null,

        // UI
        focusIndex: 0,
        isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
        isHidden: false,
        dialogOpen: false,
        settingsOpen: false,

        // Clock drift correction
        lastClockTick: 0
    };

    /* ======================================================================
       DOM refs (populated in init)
       ====================================================================== */
    let els = {};
    function $(id) { return document.getElementById(id); }

    /* ======================================================================
       Player
       ====================================================================== */

    function handlePlayPromise(promise) {
        if (!promise || typeof promise.then !== 'function') return;
        promise.catch(function (err) {
            log.warn('audio.play() rejected:', err && err.name);
            if (err && err.name === 'NotAllowedError') {
                stopPlayback();
                els.status.textContent = STATUS.READY;
                els.status.className = 'status';
                els.status.setAttribute('aria-label', 'اضغط للتشغيل');
            }
        });
    }

    /** Stop the radio stream without triggering the error handler (used by stop btn and azan). */
    function pauseRadioSilently() {
        state.stoppingManually = true;
        if (state.hls) { state.hls.destroy(); state.hls = null; }
        try { state.audio.pause(); state.audio.src = ''; } catch (e) {}
        state.playing = false;
        els.playBtn.classList.remove('playing');
        els.playBtn.setAttribute('aria-pressed', 'false');
        els.btnIcon.className = 'icon-play';
        setTimeout(function () { state.stoppingManually = false; }, 200);
    }

    function stopPlayback() { pauseRadioSilently(); }

    /** Hide azan overlay and either resume the radio or show the idle state. */
    function resumeAfterAzan() {
        state.azanPlaying = false;
        els.azanOverlay.style.display = 'none';
        setBackdrop(false);
        if (state.wasPlayingBeforeAzan) {
            startPlayback(STREAM_URL, 0);
        } else {
            els.status.textContent = STATUS.READY;
            els.status.className = 'status';
        }
    }

    function startPlayback(url, attempt) {
        attempt = attempt || 0;
        state.retryAttempt = attempt;
        els.status.textContent = attempt > 0 ? 'إعادة المحاولة...' : STATUS.CONNECTING;
        els.status.className = 'status';
        state.playing = true;
        els.playBtn.classList.add('playing');
        els.playBtn.setAttribute('aria-pressed', 'true');
        els.btnIcon.className = 'icon-stop';

        if (url.indexOf('.m3u8') !== -1 && typeof Hls !== 'undefined' && Hls.isSupported()) {
            state.hls = new Hls();
            state.hls.loadSource(url);
            state.hls.attachMedia(state.audio);
            state.hls.on(Hls.Events.MANIFEST_PARSED, function () {
                handlePlayPromise(state.audio.play());
            });
            state.hls.on(Hls.Events.ERROR, function (event, data) {
                if (data.fatal) {
                    log.warn('HLS fatal error:', data.type, data.details);
                    handlePlaybackError(url, attempt);
                }
            });
        } else {
            state.audio.src = url;
            handlePlayPromise(state.audio.play());
        }
    }

    /** Exponential backoff retry */
    function handlePlaybackError(url, attempt) {
        stopPlayback();
        if (attempt < state.maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
            els.status.textContent = toArabicDigits('إعادة المحاولة بعد ' + Math.round(delay / 1000) + ' ث');
            log.info('Retry scheduled in', delay, 'ms (attempt', attempt + 1, ')');
            setTimeout(function () {
                if (!state.playing && !state.azanPlaying) {
                    startPlayback(url, attempt + 1);
                }
            }, delay);
        } else if (url !== FALLBACK_URL) {
            log.info('Primary stream exhausted, trying fallback');
            startPlayback(FALLBACK_URL, 0);
        } else {
            els.status.textContent = STATUS.STREAM_ERROR;
            els.status.className = 'status';
        }
    }

    function togglePlayback() {
        if (state.playing) {
            stopPlayback();
            els.status.textContent = STATUS.READY;
            els.status.className = 'status';
        } else {
            startPlayback(STREAM_URL, 0);
        }
    }

    /* ======================================================================
       Schedule
       ====================================================================== */

    function parseTimeToMinutes(timeStr) {
        if (!timeStr) return -1;
        const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
        if (!match) return -1;
        let h = parseInt(match[1]);
        const m = parseInt(match[2]);
        const ampm = match[3].toUpperCase();
        if (ampm === 'PM' && h !== 12) h += 12;
        if (ampm === 'AM' && h === 12) h = 0;
        return h * 60 + m;
    }

    function getCairoMinutesNow() {
        return getNowInTz(CAIRO_TZ).minutes;
    }

    function renderSkeletonSchedule() {
        let html = '';
        for (let i = 0; i < 8; i++) {
            html += '<div class="skeleton skeleton-item"></div>';
        }
        els.scheduleList.innerHTML = html;
    }

    function renderScheduleError(message) {
        els.scheduleList.innerHTML = '<div class="error-msg">' + escapeHtml(message) + '</div>';
    }

    function renderSchedule(programs) {
        if (!programs || programs.length === 0) {
            renderScheduleError('لا توجد فقرات متاحة اليوم');
            state.currentProgramIdx = -1;
            return;
        }
        const nowMins = getCairoMinutesNow();
        let currentProgram = null;
        state.currentProgramIdx = -1;
        const parts = [];
        for (let i = 0; i < programs.length; i++) {
            const p = programs[i];
            const fromMins = parseTimeToMinutes(p.fromTime);
            const toMins = parseTimeToMinutes(p.toTime);
            let isCurrent = false;
            if (fromMins >= 0 && toMins >= 0) {
                if (toMins <= fromMins) {
                    isCurrent = (nowMins >= fromMins || nowMins < toMins);
                } else {
                    isCurrent = (nowMins >= fromMins && nowMins < toMins);
                }
                if (isCurrent) { currentProgram = p; state.currentProgramIdx = i; }
            }
            const imgHtml = p.imageURL
                ? '<img class="prog-img" src="' + escapeHtml(p.imageURL) + '" onerror="this.style.display=\'none\'" alt="">'
                : '';
            parts.push(
                '<div class="schedule-item' + (isCurrent ? ' active' : '') + '"' +
                (isCurrent ? ' id="currentProgram"' : '') + ' role="listitem">' +
                imgHtml +
                '<div class="prog-meta">' +
                '<span class="time">' + escapeHtml(arabizeTime(p.fromTime)) + ' - ' + escapeHtml(arabizeTime(p.toTime)) + '</span>' +
                '<span class="prog-title">' + escapeHtml(p.title) + '</span>' +
                (isCurrent
                    ? '<div class="prog-progress"><div class="prog-progress-bar" id="progBar" style="width:0%"></div></div>'
                    : '') +
                '</div>' +
                '<span class="live-badge">الآن</span>' +
                '</div>'
            );
        }
        // Fade transition
        els.scheduleList.style.opacity = '0';
        setTimeout(function () {
            els.scheduleList.innerHTML = parts.join('');
            els.scheduleList.style.opacity = '1';
            setTimeout(function () {
                const currentEl = document.getElementById('currentProgram');
                if (currentEl) currentEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }, 500);
            updateMainTitle(currentProgram);
            updateCurrentProgramProgress(currentProgram);
        }, 200);
    }

    function updateMainTitle(currentProgram) {
        if (currentProgram) {
            els.mainTitle.innerHTML =
                '<span style="font-size:26px;color:#e74c3c;display:block;margin-bottom:8px">يعرض الآن</span>' +
                escapeHtml(currentProgram.title);
            els.mainSubtitle.textContent = arabizeTime(currentProgram.fromTime) + ' - ' + arabizeTime(currentProgram.toTime);
        } else {
            els.mainTitle.textContent = 'إذاعة القرآن الكريم من القاهرة';
            els.mainSubtitle.textContent = 'Holy Quran Radio - Cairo';
        }
    }

    /** Update the progress bar of the currently playing program */
    function updateCurrentProgramProgress(program) {
        const bar = document.getElementById('progBar');
        if (!bar || !program) return;
        const fromMins = parseTimeToMinutes(program.fromTime);
        const toMins = parseTimeToMinutes(program.toTime);
        if (fromMins < 0 || toMins < 0) return;
        const nowMins = getCairoMinutesNow();
        let total = toMins - fromMins;
        if (total <= 0) total += 24 * 60;
        let elapsed = nowMins - fromMins;
        if (elapsed < 0) elapsed += 24 * 60;
        const pct = Math.max(0, Math.min(100, (elapsed / total) * 100));
        bar.style.width = pct + '%';
    }

    /** Cheap hash of an array of objects (used to skip no-op re-renders). */
    function shallowHash(arr) {
        if (!arr || !arr.length) return '';
        let h = arr.length + '|';
        for (let i = 0; i < arr.length; i++) {
            const p = arr[i];
            h += (p.id || p.title || '') + ':' + (p.fromTime || '') + ':' + (p.toTime || '') + '|';
        }
        return h;
    }

    function fetchSchedule() {
        if (state.isHidden) return;
        httpRequest({
            method: 'POST',
            url: SCHEDULE_API,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ Date: null }),
            onSuccess: function (resp) {
                const programs = (resp && resp.data) || [];
                const newHash = shallowHash(programs);
                state.cachedSchedule = programs;
                setCached('schedule', { programs: programs, date: getTodayKeyInTz(CAIRO_TZ) });
                if (newHash === state.scheduleHash) {
                    // Still need to refresh "current program" highlight because time moved
                    reapplyCurrentHighlight(programs);
                    return;
                }
                state.scheduleHash = newHash;
                renderSchedule(programs);
            },
            onError: function (reason) {
                log.warn('Schedule fetch failed:', reason);
                const cached = getCached('schedule');
                if (cached && cached.programs) {
                    state.cachedSchedule = cached.programs;
                    renderSchedule(cached.programs);
                    showInfo('تعذر الاتصال — يتم عرض بيانات محفوظة');
                } else {
                    renderScheduleError('تعذر تحميل فقرات اليوم — يرجى التحقق من الاتصال');
                }
            }
        });
    }

    /** When data is unchanged but minute rolled over, just move the "active" class. */
    function reapplyCurrentHighlight(programs) {
        const nowMins = getCairoMinutesNow();
        let currentIdx = -1;
        for (let i = 0; i < programs.length; i++) {
            const p = programs[i];
            const fromMins = parseTimeToMinutes(p.fromTime);
            const toMins = parseTimeToMinutes(p.toTime);
            if (fromMins < 0 || toMins < 0) continue;
            const isCurrent = toMins <= fromMins
                ? (nowMins >= fromMins || nowMins < toMins)
                : (nowMins >= fromMins && nowMins < toMins);
            if (isCurrent) { currentIdx = i; break; }
        }
        if (currentIdx === state.currentProgramIdx) {
            if (currentIdx >= 0) updateCurrentProgramProgress(programs[currentIdx]);
            return;
        }
        state.currentProgramIdx = currentIdx;
        // Rebuild to move the highlight
        renderSchedule(programs);
    }

    /* ======================================================================
       Prayer Times
       ====================================================================== */

    const prayerNames = [
        { key: 'fajr', name: 'الفجر' },
        { key: 'sunrise', name: 'الشروق' },
        { key: 'dhuhr', name: 'الظهر' },
        { key: 'asr', name: 'العصر' },
        { key: 'maghrib', name: 'المغرب' },
        { key: 'isha', name: 'العشاء' }
    ];

    function formatTo12h(time24) {
        const parts = time24.split(':');
        const h = parseInt(parts[0]);
        const m = parts[1];
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        return h12 + ':' + m + ' ' + ampm;
    }

    function getLocationNowMinutes() {
        if (state.useMyLocation) {
            const d = new Date();
            return d.getHours() * 60 + d.getMinutes();
        }
        return getNowInTz(CAIRO_TZ).minutes;
    }

    function getLocationNowHM() {
        if (state.useMyLocation) {
            const d = new Date();
            return { h: d.getHours(), m: d.getMinutes(), s: d.getSeconds() };
        }
        return getNowInTz(CAIRO_TZ);
    }

    function getNextPrayer(data) {
        if (!data) return null;
        const nowMinutes = getLocationNowMinutes();
        for (let i = 0; i < prayerNames.length; i++) {
            const key = prayerNames[i].key;
            if (!data[key]) continue;
            const parts = data[key].split(':');
            const prayerMinutes = parseInt(parts[0]) * 60 + parseInt(parts[1]);
            if (prayerMinutes > nowMinutes) return key;
        }
        return 'fajr';
    }

    function renderSkeletonPrayer() {
        let html = '';
        for (let i = 0; i < 6; i++) html += '<div class="skeleton skeleton-prayer-item"></div>';
        els.prayerGrid.innerHTML = html;
    }

    function renderPrayerError(message) {
        els.prayerGrid.innerHTML = '<div class="error-msg error-msg-small">' + escapeHtml(message) + '</div>';
    }

    function renderPrayerGrid() {
        if (!state.cachedPrayerData) return;
        const nextPrayer = getNextPrayer(state.cachedPrayerData);
        const parts = [];
        for (let i = 0; i < prayerNames.length; i++) {
            const p = prayerNames[i];
            const timeVal = state.cachedPrayerData[p.key] ? arabizeTime(formatTo12h(state.cachedPrayerData[p.key])) : '--';
            const isNext = p.key === nextPrayer;
            const isMuted = !state.azanEnabledPerPrayer[p.key] && p.key !== 'sunrise';
            parts.push(
                '<div class="prayer-item' + (isNext ? ' next' : '') + (isMuted ? ' muted' : '') + '"' +
                ' role="listitem" aria-label="' + escapeHtml(p.name + ' ' + timeVal) + '">' +
                '<div class="prayer-name">' + p.name + '</div>' +
                '<div class="prayer-time-val">' + escapeHtml(timeVal) + '</div>' +
                '</div>'
            );
        }
        els.prayerGrid.style.opacity = '0';
        setTimeout(function () {
            els.prayerGrid.innerHTML = parts.join('');
            els.prayerGrid.style.opacity = '1';
        }, 150);

        // Update TZ label
        els.prayerTzLabel.textContent = state.useMyLocation
            ? 'بالتوقيت المحلي'
            : 'بتوقيت القاهرة';
    }

    function misrqToLocal(utcTime) {
        if (!utcTime) return null;
        const parts = utcTime.split(':');
        const h = (parseInt(parts[0]) + 2 + 24) % 24;
        return (h < 10 ? '0' : '') + h + ':' + parts[1];
    }

    function fetchPrayerTimes() {
        if (state.isHidden) return;
        if (state.useMyLocation) {
            const url = ALADHAN_API + '?latitude=' + state.currentLocation.lat +
                '&longitude=' + state.currentLocation.lng + '&method=4';
            httpRequest({
                url: url,
                onSuccess: function (resp) {
                    if (!resp || !resp.data || !resp.data.timings) {
                        tryPrayerCache();
                        return;
                    }
                    const t = resp.data.timings;
                    state.cachedPrayerData = {
                        fajr: t.Fajr, sunrise: t.Sunrise, dhuhr: t.Dhuhr,
                        asr: t.Asr, maghrib: t.Maghrib, isha: t.Isha
                    };
                    const hijri = resp.data.date && resp.data.date.hijri;
                    if (hijri) {
                        const monthName = (hijri.month && hijri.month.ar) || (hijri.month && hijri.month.en) || '';
                        els.hijriDate.textContent = toArabicDigits(hijri.day + ' ' + monthName + ' ' + hijri.year + ' هـ');
                    }
                    setCached('prayer_' + (state.useMyLocation ? 'my' : 'cairo'), {
                        data: state.cachedPrayerData,
                        hijri: els.hijriDate.textContent,
                        date: getTodayKeyInTz(CAIRO_TZ)
                    });
                    renderPrayerGrid();
                },
                onError: function () { tryPrayerCache(); }
            });
        } else {
            const url = PRAYER_API_BASE + '?lat=30.0444&lng=31.2357&dayLightSaving=false';
            httpRequest({
                url: url,
                onSuccess: function (data) {
                    if (!data || !data.fajr) { tryPrayerCache(); return; }
                    state.cachedPrayerData = {
                        fajr: misrqToLocal(data.fajr),
                        sunrise: misrqToLocal(data.sunrise),
                        dhuhr: misrqToLocal(data.dhuhr),
                        asr: misrqToLocal(data.asr),
                        maghrib: misrqToLocal(data.maghrib),
                        isha: misrqToLocal(data.isha)
                    };
                    if (data.hijriDate) els.hijriDate.textContent = toArabicDigits(data.hijriDate);
                    setCached('prayer_cairo', {
                        data: state.cachedPrayerData,
                        hijri: els.hijriDate.textContent,
                        date: getTodayKeyInTz(CAIRO_TZ)
                    });
                    renderPrayerGrid();
                },
                onError: function () { tryPrayerCache(); }
            });
        }
    }

    function tryPrayerCache() {
        const key = 'prayer_' + (state.useMyLocation ? 'my' : 'cairo');
        const cached = getCached(key);
        if (cached && cached.data) {
            log.info('Using cached prayer data');
            state.cachedPrayerData = cached.data;
            if (cached.hijri) els.hijriDate.textContent = cached.hijri;
            renderPrayerGrid();
            showInfo('مواقيت الصلاة من البيانات المحفوظة');
        } else {
            renderPrayerError('تعذر تحميل مواقيت الصلاة');
        }
    }

    /* ======================================================================
       Azan
       ====================================================================== */

    function dailyResetCheck() {
        const todayKey = getTodayKeyInTz(CAIRO_TZ);
        if (state.azanTriggered._day !== todayKey) {
            state.azanTriggered = { _day: todayKey };
            state.preAzanShown = { _day: todayKey };
        }
    }

    /** Schedule midnight rollover: resets state and refreshes prayer times. */
    function scheduleMidnightReset() {
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setHours(24, 0, 0, 0);
        const ms = tomorrow.getTime() - now.getTime() + 2000; // +2s safety margin
        state.midnightTimer = setTimeout(function () {
            dailyResetCheck();
            fetchPrayerTimes();
            fetchSchedule();
            scheduleMidnightReset();
        }, ms);
    }

    const AZAN_PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

    function checkAzanTime() {
        dailyResetCheck();
        if (!state.cachedPrayerData || state.azanPlaying) return;
        const nowObj = getLocationNowHM();
        const nowMins = nowObj.h * 60 + nowObj.m;

        for (let i = 0; i < AZAN_PRAYERS.length; i++) {
            const key = AZAN_PRAYERS[i];
            const enabled = state.azanEnabledPerPrayer[key];
            const timeStr = state.cachedPrayerData[key];
            if (!timeStr) continue;
            const parts = timeStr.split(':');
            const pH = parseInt(parts[0]);
            const pM = parseInt(parts[1]);
            const pMins = pH * 60 + pM;
            const diff = pMins - nowMins;

            // Pre-azan banner (5 minutes before)
            if (enabled && !state.preAzanShown[key] && diff > 0 && diff <= PRE_AZAN_MINUTES) {
                state.preAzanShown[key] = true;
                showPreAzanBanner(key, diff);
            }

            // Exact azan minute
            if (!state.azanTriggered[key]) {
                if (!enabled) { state.azanTriggered[key] = true; continue; }
                if (nowObj.h === pH && nowObj.m === pM) {
                    state.azanTriggered[key] = true;
                    playAzan(key);
                    return;
                }
            }
        }
    }

    const prayerNamesAr = { fajr: 'الفجر', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء' };

    /** Show/hide the dim backdrop behind overlays */
    function setBackdrop(visible) {
        if (!els.dimBackdrop) return;
        els.dimBackdrop.classList.toggle('visible', !!visible);
    }

    function showPreAzanBanner(prayerKey, minutesLeft) {
        const prayerName = prayerNamesAr[prayerKey] || '';
        const minsAr = toArabicDigits(String(minutesLeft));
        els.preAzanOverlay.innerHTML =
            'صلاة ' + escapeHtml(prayerName) + ' بعد ' + minsAr + ' دقائق' +
            '<br><span style="font-size:22px;color:#e0f7f4">' + escapeHtml(state.currentLocation.name) + '</span>';
        els.preAzanOverlay.style.display = 'block';
        setBackdrop(true);
        setTimeout(function () {
            els.preAzanOverlay.style.display = 'none';
            // Only hide backdrop if azan isn't also showing
            if (els.azanOverlay.style.display !== 'flex') setBackdrop(false);
        }, 10000);
    }

    function playAzan(prayerKey) {
        state.azanPlaying = true;
        state.wasPlayingBeforeAzan = state.playing;
        if (state.playing) pauseRadioSilently();
        els.status.textContent = STATUS.AZAN;
        els.status.className = 'status live';

        const prayerName = prayerNamesAr[prayerKey] || '';
        const locationLabel = state.currentLocation.name || 'القاهرة';
        const enName = prayerKey.charAt(0).toUpperCase() + prayerKey.slice(1);
        els.azanOverlayText.innerHTML =
            'أذان ' + escapeHtml(prayerName) + ' - ' + escapeHtml(locationLabel) +
            '<br><span style="font-size:24px;color:#ffe6e0">Now Playing: Azan ' + escapeHtml(enName) + '</span>';
        els.azanOverlay.style.display = 'flex';
        setBackdrop(true);

        // Use selected muezzin
        try {
            state.azanAudio.src = MUEZZINS[state.activeMuezzin].file;
        } catch (e) {
            state.azanAudio.src = 'azan.mp3';
        }
        state.azanAudio.currentTime = 0;
        handlePlayPromise(state.azanAudio.play());
    }

    /* ======================================================================
       Location
       ====================================================================== */

    function fetchLocationName(lat, lng) {
        httpRequest({
            url: NOMINATIM_API + '?lat=' + lat + '&lon=' + lng + '&format=json&accept-language=ar',
            onSuccess: function (data) {
                if (!data.address) return;
                const city = data.address.city || data.address.town || data.address.county || data.address.state || '';
                const country = data.address.country || '';
                if (city && country) state.currentLocation.name = city + '، ' + country;
                else if (country) state.currentLocation.name = country;
                els.locationName.textContent = state.currentLocation.name;
                saveState({ location: { lat: lat, lng: lng, name: state.currentLocation.name } });
            },
            onError: function () { /* silent */ }
        });
    }

    function fetchIpLocation(onSuccess, onError, attempt) {
        attempt = attempt || 0;
        if (attempt >= IP_GEO_APIS.length) {
            log.warn('All IP geolocation providers failed');
            if (onError) onError();
            return;
        }
        const provider = IP_GEO_APIS[attempt];
        log.info('Trying IP geolocation provider:', provider.url);
        httpRequest({
            url: provider.url,
            timeout: 6000,
            onSuccess: function (data) {
                const loc = provider.extract(data);
                if (loc) {
                    const cityParts = [];
                    if (loc.city) cityParts.push(loc.city);
                    if (loc.country) cityParts.push(loc.country);
                    onSuccess({
                        lat: loc.lat,
                        lng: loc.lng,
                        name: cityParts.join('، ') || 'موقعي'
                    });
                } else {
                    fetchIpLocation(onSuccess, onError, attempt + 1);
                }
            },
            onError: function () {
                fetchIpLocation(onSuccess, onError, attempt + 1);
            }
        });
    }

    function applyLocation(loc) {
        state.useMyLocation = true;
        state.currentLocation = { lat: loc.lat, lng: loc.lng, name: loc.name };
        els.locationName.textContent = state.currentLocation.name;
        els.locationBtn.textContent = 'القاهرة';
        state.azanTriggered = { _day: getTodayKeyInTz(CAIRO_TZ) };
        state.preAzanShown = { _day: getTodayKeyInTz(CAIRO_TZ) };
        saveState({ useMyLocation: true, location: loc });
        fetchPrayerTimes();
    }

    function revertToCairo() {
        state.useMyLocation = false;
        state.currentLocation = Object.assign({}, CAIRO_LOCATION);
        els.locationName.textContent = state.currentLocation.name;
        els.locationBtn.textContent = 'موقعي';
        state.azanTriggered = { _day: getTodayKeyInTz(CAIRO_TZ) };
        state.preAzanShown = { _day: getTodayKeyInTz(CAIRO_TZ) };
        saveState({ useMyLocation: false });
        fetchPrayerTimes();
    }

    /** Start location detection flow (used by button and auto-init) */
    function detectLocation(onDone) {
        els.locationBtn.textContent = '...';
        const onGotCoords = function (lat, lng, fallbackName) {
            // Always reverse-geocode to get Arabic city name
            applyLocation({ lat: lat, lng: lng, name: fallbackName || 'موقعي' });
            fetchLocationName(lat, lng);
            if (onDone) onDone(true);
        };
        const onFail = function () {
            els.locationBtn.textContent = 'موقعي';
            showInfo('تعذر تحديد الموقع - يرجى التحقق من الاتصال');
            if (onDone) onDone(false);
        };
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                function (pos) { onGotCoords(pos.coords.latitude, pos.coords.longitude, 'موقعي'); },
                function () {
                    fetchIpLocation(
                        function (loc) { onGotCoords(loc.lat, loc.lng, loc.name); },
                        onFail
                    );
                },
                { timeout: 8000, maximumAge: 600000 }
            );
        } else {
            fetchIpLocation(
                function (loc) { onGotCoords(loc.lat, loc.lng, loc.name); },
                onFail
            );
        }
    }

    const toggleLocation = debounce(function () {
        if (state.useMyLocation) { revertToCairo(); return; }
        detectLocation();
    }, 500);

    /* ======================================================================
       Toasts
       ====================================================================== */
    let infoToastTimer = null;
    function showInfo(text) {
        els.infoToast.textContent = text;
        els.infoToast.style.display = 'block';
        clearTimeout(infoToastTimer);
        infoToastTimer = setTimeout(function () { els.infoToast.style.display = 'none'; }, 4000);
    }

    let toastTimer = null;
    function showToast(state_, title, body, bodyEn) {
        els.toast.className = 'toast ' + state_;
        els.toastTitle.textContent = title;
        els.toastBody.textContent = body;
        els.toastBodyEn.textContent = bodyEn || '';
        els.toast.style.display = 'block';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { els.toast.style.display = 'none'; }, 5000);
    }

    /* ======================================================================
       Clock + Next Salah (drift-corrected)
       ====================================================================== */
    let lastClockText = '';
    let lastNextSalahText = '';
    let lastNextSalahPct = -1;

    function updateClock() {
        const hm = getLocationNowHM();
        const h = hm.h, m = hm.m, s = hm.s;
        const ampm = h >= 12 ? 'م' : 'ص';
        const h12 = h % 12 || 12;
        const clockText = toArabicDigits(
            h12 + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s + ' ' + ampm
        );
        if (clockText !== lastClockText) {
            els.currentTime.textContent = clockText;
            lastClockText = clockText;
        }

        // Next salah countdown only changes when the minute changes
        if (s !== 0 && lastNextSalahText) return;
        if (!state.cachedPrayerData) return;

        const nextKey = getNextPrayer(state.cachedPrayerData);
        const timeStr = state.cachedPrayerData[nextKey];
        if (!timeStr) return;
        const parts = timeStr.split(':');
        const prayerMins = parseInt(parts[0]) * 60 + parseInt(parts[1]);
        const nowMins = h * 60 + m;
        let diff = prayerMins - nowMins;
        if (diff < 0) diff += 24 * 60;
        const diffH = Math.floor(diff / 60);
        const diffM = diff % 60;
        const remaining = (diffH > 0 ? diffH + ' س ' : '') + diffM + ' د';
        const salahText = toArabicDigits('صلاة ' + prayerNamesAr[nextKey] + ' بعد ' + remaining);
        if (salahText !== lastNextSalahText) {
            els.nextSalahText.textContent = salahText;
            lastNextSalahText = salahText;
        }

        const maxWindow = 3 * 60;
        const pct = Math.max(0, Math.min(100, (1 - diff / maxWindow) * 100));
        if (Math.abs(pct - lastNextSalahPct) > 0.5) {
            els.nextSalahBarFill.style.width = pct + '%';
            lastNextSalahPct = pct;
        }
    }

    /* Drift-corrected tick: uses setTimeout + actual time */
    function clockTick() {
        updateClock();
        const now = Date.now();
        const nextTick = 1000 - (now % 1000);
        setTimeout(clockTick, nextTick);
    }

    /* ======================================================================
       Focus / Navigation
       ====================================================================== */
    let focusables = [];

    function setupFocus() {
        focusables = [els.playBtn, els.locationBtn, els.settingsBtn];
        setFocus(0);
    }

    /** Toggle .focused on a list of elements, setting index. */
    function applyFocusClass(list, idx) {
        for (let i = 0; i < list.length; i++) list[i].classList.remove('focused');
        if (list[idx]) list[idx].classList.add('focused');
    }

    function setFocus(idx) {
        if (state.dialogOpen || state.settingsOpen) return;
        if (idx < 0) idx = focusables.length - 1;
        if (idx >= focusables.length) idx = 0;
        state.focusIndex = idx;
        applyFocusClass(focusables, idx);
        if (focusables[idx]) focusables[idx].focus();
    }

    function moveFocus(delta) {
        setFocus(state.focusIndex + delta);
    }

    function activateFocus() {
        const el = focusables[state.focusIndex];
        if (!el) return;
        el.click();
    }

    /* ======================================================================
       Back button dialog
       ====================================================================== */
    let dialogFocusIdx = 0;
    const dialogButtons = []; // populated in init

    function openExitDialog() {
        if (state.dialogOpen) return;
        state.dialogOpen = true;
        els.dialogBackdrop.classList.add('visible');
        dialogFocusIdx = 1; // default to "لا"
        updateDialogFocus();
    }

    function closeExitDialog() {
        state.dialogOpen = false;
        els.dialogBackdrop.classList.remove('visible');
    }

    function updateDialogFocus() {
        applyFocusClass(dialogButtons, dialogFocusIdx);
    }

    function confirmExit() {
        if (typeof webOS !== 'undefined' && webOS.platformBack) {
            webOS.platformBack();
        } else {
            window.close();
        }
    }

    /* ======================================================================
       Settings menu
       ====================================================================== */
    const settingsFocusables = [];
    let settingsFocusIdx = 0;

    function buildSettingsMenu() {
        const menu = els.settingsMenu;
        menu.innerHTML = '';

        // Header with title + big close button
        const header = document.createElement('div');
        header.className = 'settings-header';

        const title = document.createElement('h2');
        title.textContent = 'الإعدادات';
        header.appendChild(title);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'settings-close-btn';
        closeBtn.setAttribute('aria-label', 'إغلاق الإعدادات');
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', closeSettingsMenu);
        header.appendChild(closeBtn);

        menu.appendChild(header);

        // Body container for scrollable sections
        const body = document.createElement('div');
        body.className = 'settings-body';
        menu.appendChild(body);

        // Muezzin section
        const muezzinSection = document.createElement('div');
        muezzinSection.className = 'settings-section';
        muezzinSection.innerHTML = '<h3>صوت الأذان</h3>';
        // (all sections are appended to body now)
        const muezzinOpts = {};
        for (const key in MUEZZINS) {
            const btn = document.createElement('button');
            btn.className = 'settings-option' + (state.activeMuezzin === key ? ' active' : '');
            btn.textContent = MUEZZINS[key].name;
            btn.setAttribute('data-muezzin', key);
            btn.addEventListener('click', function () {
                state.activeMuezzin = key;
                saveState({ muezzin: key });
                // Refresh buttons
                for (const k in muezzinOpts) {
                    muezzinOpts[k].classList.toggle('active', k === key);
                }
                showInfo('تم اختيار ' + MUEZZINS[key].name);
            });
            muezzinSection.appendChild(btn);
            muezzinOpts[key] = btn;
        }
        body.appendChild(muezzinSection);

        // Sleep timer section
        const sleepSection = document.createElement('div');
        sleepSection.className = 'settings-section';
        sleepSection.innerHTML = '<h3>مؤقت النوم</h3>';
        const sleepOpts = [
            { mins: 0, label: 'إيقاف' },
            { mins: 15, label: '١٥ دقيقة' },
            { mins: 30, label: '٣٠ دقيقة' },
            { mins: 60, label: 'ساعة' },
            { mins: 120, label: 'ساعتان' }
        ];
        sleepOpts.forEach(function (opt) {
            const btn = document.createElement('button');
            btn.className = 'settings-option';
            btn.textContent = opt.label;
            btn.addEventListener('click', function () {
                setSleepTimer(opt.mins);
                // Update UI
                [].slice.call(sleepSection.querySelectorAll('.settings-option')).forEach(function (b) {
                    b.classList.remove('active');
                });
                btn.classList.add('active');
            });
            sleepSection.appendChild(btn);
        });
        body.appendChild(sleepSection);

        // Azan per prayer section
        const azanSection = document.createElement('div');
        azanSection.className = 'settings-section';
        azanSection.innerHTML = '<h3>تفعيل الأذان</h3>';
        const azanKeys = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
        azanKeys.forEach(function (key) {
            const btn = document.createElement('button');
            btn.className = 'settings-option' + (state.azanEnabledPerPrayer[key] ? ' active' : '');
            btn.textContent = prayerNamesAr[key];
            btn.addEventListener('click', function () {
                state.azanEnabledPerPrayer[key] = !state.azanEnabledPerPrayer[key];
                btn.classList.toggle('active', state.azanEnabledPerPrayer[key]);
                saveState({ azanEnabledPerPrayer: state.azanEnabledPerPrayer });
                renderPrayerGrid();
            });
            azanSection.appendChild(btn);
        });
        body.appendChild(azanSection);

        // Azan volume section
        const volSection = document.createElement('div');
        volSection.className = 'settings-section';
        volSection.innerHTML = '<h3>مستوى صوت الأذان</h3>';
        const volContainer = document.createElement('div');
        volContainer.style.cssText = 'display:flex;gap:8px;align-items:center;direction:ltr';
        [0.25, 0.5, 0.75, 1.0].forEach(function (v) {
            const btn = document.createElement('button');
            btn.className = 'settings-option' + (state.azanAudio && state.azanAudio.volume === v ? ' active' : '');
            btn.style.flex = '1';
            btn.textContent = toArabicDigits(Math.round(v * 100) + '٪');
            btn.addEventListener('click', function () {
                if (state.azanAudio) state.azanAudio.volume = v;
                saveState({ azanVolume: v });
                [].slice.call(volContainer.querySelectorAll('.settings-option')).forEach(function (b) {
                    b.classList.remove('active');
                });
                btn.classList.add('active');
            });
            volContainer.appendChild(btn);
        });
        volSection.appendChild(volContainer);
        body.appendChild(volSection);
    }

    function openSettingsMenu() {
        state.settingsOpen = true;
        els.settingsMenu.classList.add('visible');
        settingsFocusIdx = 0;
        updateSettingsFocus();
    }

    function closeSettingsMenu() {
        state.settingsOpen = false;
        els.settingsMenu.classList.remove('visible');
        setFocus(state.focusIndex);
    }

    function getSettingsFocusables() {
        const closeBtn = els.settingsMenu.querySelector('.settings-close-btn');
        const opts = [].slice.call(els.settingsMenu.querySelectorAll('.settings-option'));
        return closeBtn ? [closeBtn].concat(opts) : opts;
    }

    function updateSettingsFocus() {
        const list = getSettingsFocusables();
        applyFocusClass(list, settingsFocusIdx);
        if (list[settingsFocusIdx]) list[settingsFocusIdx].scrollIntoView({ block: 'nearest' });
    }

    function moveSettingsFocus(delta) {
        const list = getSettingsFocusables();
        settingsFocusIdx += delta;
        if (settingsFocusIdx < 0) settingsFocusIdx = list.length - 1;
        if (settingsFocusIdx >= list.length) settingsFocusIdx = 0;
        updateSettingsFocus();
    }

    function activateSettingsFocus() {
        const list = getSettingsFocusables();
        if (list[settingsFocusIdx]) list[settingsFocusIdx].click();
    }

    /* ======================================================================
       Sleep Timer
       ====================================================================== */
    function setSleepTimer(minutes) {
        if (state.sleepTimerId) {
            clearTimeout(state.sleepTimerId);
            state.sleepTimerId = null;
            state.sleepTimerEnd = null;
        }
        if (minutes > 0) {
            const ms = minutes * 60 * 1000;
            state.sleepTimerEnd = Date.now() + ms;
            state.sleepTimerId = setTimeout(function () {
                if (state.playing) stopPlayback();
                state.sleepTimerId = null;
                state.sleepTimerEnd = null;
                showInfo('تم إيقاف التشغيل - مؤقت النوم');
            }, ms);
            showInfo(toArabicDigits('مؤقت النوم: ' + minutes + ' دقيقة'));
        } else {
            showInfo('تم إلغاء مؤقت النوم');
        }
    }

    /* ======================================================================
       Keyboard / Remote handling
       ====================================================================== */
    function handleKeyDown(e) {
        const code = e.keyCode;

        // Dialog mode
        if (state.dialogOpen) {
            e.preventDefault();
            if (code === KEY.LEFT) { dialogFocusIdx = (dialogFocusIdx + 1) % 2; updateDialogFocus(); }
            else if (code === KEY.RIGHT) { dialogFocusIdx = (dialogFocusIdx - 1 + 2) % 2; updateDialogFocus(); }
            else if (code === KEY.ENTER) {
                if (dialogFocusIdx === 0) confirmExit();
                else closeExitDialog();
            }
            else if (code === KEY.BACK) closeExitDialog();
            return;
        }

        // Settings menu mode
        if (state.settingsOpen) {
            e.preventDefault();
            if (code === KEY.UP) moveSettingsFocus(-1);
            else if (code === KEY.DOWN) moveSettingsFocus(1);
            else if (code === KEY.ENTER) activateSettingsFocus();
            else if (code === KEY.BACK || code === KEY.RED) closeSettingsMenu();
            return;
        }

        // Main mode
        switch (code) {
            case KEY.ENTER:
                e.preventDefault();
                activateFocus();
                break;
            case KEY.UP:
            case KEY.LEFT:
                e.preventDefault();
                moveFocus(-1);
                break;
            case KEY.DOWN:
            case KEY.RIGHT:
                e.preventDefault();
                moveFocus(1);
                break;
            case KEY.BACK:
                e.preventDefault();
                openExitDialog();
                break;
            case KEY.PLAY:
                e.preventDefault();
                if (!state.playing) togglePlayback();
                break;
            case KEY.PAUSE:
            case KEY.STOP:
                e.preventDefault();
                if (state.playing) togglePlayback();
                break;
            case KEY.PLAY_PAUSE:
                e.preventDefault();
                togglePlayback();
                break;
            case KEY.RED:
                e.preventDefault();
                openSettingsMenu();
                break;
            case KEY.GREEN:
                e.preventDefault();
                toggleLocation();
                break;
            case KEY.YELLOW:
                e.preventDefault();
                // Sleep timer 30min
                setSleepTimer(30);
                break;
            case KEY.BLUE:
                e.preventDefault();
                // Cycle muezzin
                const keys = Object.keys(MUEZZINS);
                const idx = keys.indexOf(state.activeMuezzin);
                state.activeMuezzin = keys[(idx + 1) % keys.length];
                saveState({ muezzin: state.activeMuezzin });
                showInfo('صوت الأذان: ' + MUEZZINS[state.activeMuezzin].name);
                break;
        }
    }

    /* ======================================================================
       Visibility / Network handling
       ====================================================================== */
    function onVisibilityChange() {
        state.isHidden = document.hidden;
        log.info('Visibility:', state.isHidden ? 'hidden' : 'visible');
        if (!state.isHidden) {
            // Refresh data when becoming visible
            fetchSchedule();
            fetchPrayerTimes();
        }
    }

    function onOnline() {
        state.isOnline = true;
        els.offlineBanner.style.display = 'none';
        log.info('Network: online');
        fetchSchedule();
        fetchPrayerTimes();
    }

    function onOffline() {
        state.isOnline = false;
        els.offlineBanner.style.display = 'block';
        log.warn('Network: offline');
    }

    /* ======================================================================
       Init
       ====================================================================== */
    function init() {
        // Build DOM refs
        els = {
            scheduleList: $('scheduleList'),
            mainTitle: $('mainTitle'),
            mainSubtitle: $('mainSubtitle'),
            playBtn: $('playBtn'),
            btnIcon: $('btnIcon'),
            status: $('status'),
            prayerGrid: $('prayerGrid'),
            prayerTzLabel: $('prayerTzLabel'),
            hijriDate: $('hijriDate'),
            locationName: $('locationName'),
            locationBtn: $('locationBtn'),
            settingsBtn: $('settingsBtn'),
            currentTime: $('currentTimeDisplay'),
            nextSalahText: $('nextSalahText'),
            nextSalahBarFill: $('nextSalahBarFill'),
            azanOverlay: $('azanOverlay'),
            azanOverlayText: $('azanOverlayText'),
            preAzanOverlay: $('preAzanOverlay'),
            dimBackdrop: $('dimBackdrop'),
            toast: $('toast'),
            toastTitle: $('toastTitle'),
            toastBody: $('toastBody'),
            toastBodyEn: $('toastBodyEn'),
            infoToast: $('infoToast'),
            offlineBanner: $('offlineBanner'),
            dialogBackdrop: $('dialogBackdrop'),
            dialogYes: $('dialogYes'),
            dialogNo: $('dialogNo'),
            settingsMenu: $('settingsMenu')
        };

        // Start keep-alive video to prevent webOS screen saver
        const keepAliveVideo = $('keepAliveVideo');
        if (keepAliveVideo) {
            const tryPlay = function () {
                const p = keepAliveVideo.play();
                if (p && p.catch) p.catch(function () {
                    // Retry after user interaction if autoplay was blocked
                    setTimeout(tryPlay, 2000);
                });
            };
            tryPlay();
        }

        // Initialize audio
        state.audio = document.createElement('audio');
        state.audio.addEventListener('playing', function () {
            els.status.textContent = STATUS.LIVE;
            els.status.className = 'status live';
        });
        state.audio.addEventListener('waiting', function () {
            els.status.textContent = STATUS.BUFFERING;
            els.status.className = 'status';
        });
        state.audio.addEventListener('error', function () {
            if (state.stoppingManually) return;
            handlePlaybackError(state.audio.src || STREAM_URL, state.retryAttempt || 0);
        });

        state.azanAudio = new Audio();
        state.duaAudio = new Audio('dua_after_azan.mp3');

        // After azan ends, play the dua, then resume radio
        state.azanAudio.addEventListener('ended', function () {
            els.azanOverlay.style.display = 'none';
            // Show dua overlay (keep backdrop visible)
            els.azanOverlayText.innerHTML =
                'دعاء بعد الأذان<br>' +
                '<span style="font-size:26px;color:#ffe6e0">اللهم رب هذه الدعوة التامة - الشيخ الشعراوي</span>';
            els.azanOverlay.style.display = 'flex';
            setBackdrop(true);
            els.status.textContent = STATUS.DUA;
            els.status.className = 'status live';
            state.duaAudio.currentTime = 0;
            // Match azan volume for consistency
            if (typeof state.azanAudio.volume === 'number') {
                state.duaAudio.volume = state.azanAudio.volume;
            }
            handlePlayPromise(state.duaAudio.play());
        });

        state.duaAudio.addEventListener('ended', resumeAfterAzan);
        state.duaAudio.addEventListener('error', resumeAfterAzan);

        // Restore persisted state
        const saved = loadState();
        const hasLocationPref = typeof saved.useMyLocation === 'boolean';
        if (saved.useMyLocation && saved.location && saved.location.lat && saved.location.lng) {
            state.useMyLocation = true;
            state.currentLocation = {
                lat: saved.location.lat,
                lng: saved.location.lng,
                name: saved.location.name || 'موقعي'
            };
            els.locationName.textContent = state.currentLocation.name;
            els.locationBtn.textContent = 'القاهرة';
        }
        if (saved.muezzin && MUEZZINS[saved.muezzin]) {
            state.activeMuezzin = saved.muezzin;
        }
        if (saved.azanEnabledPerPrayer) {
            state.azanEnabledPerPrayer = Object.assign(state.azanEnabledPerPrayer, saved.azanEnabledPerPrayer);
        }
        if (typeof saved.azanVolume === 'number') {
            state.azanAudio.volume = saved.azanVolume;
        }

        // Event listeners
        els.playBtn.addEventListener('click', togglePlayback);
        els.locationBtn.addEventListener('click', toggleLocation);
        els.settingsBtn.addEventListener('click', openSettingsMenu);

        els.dialogYes.addEventListener('click', confirmExit);
        els.dialogNo.addEventListener('click', closeExitDialog);
        dialogButtons.push(els.dialogYes, els.dialogNo);

        document.addEventListener('keydown', handleKeyDown);

        // Visibility and network events
        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);
        if (!state.isOnline) onOffline();

        // Setup focus and skeletons
        setupFocus();
        renderSkeletonSchedule();
        renderSkeletonPrayer();
        buildSettingsMenu();

        // Initial data fetch
        fetchSchedule();
        // On first launch (no saved preference), default to "My Location"
        if (!hasLocationPref) {
            log.info('First launch - auto-detecting location');
            detectLocation(function (ok) {
                if (!ok) fetchPrayerTimes(); // fall back to Cairo
            });
        } else {
            fetchPrayerTimes();
        }

        // Timers (tracked for cleanup)
        state.intervals.push(setInterval(fetchSchedule, SCHEDULE_POLL_MS));
        state.intervals.push(setInterval(checkAzanTime, AZAN_CHECK_MS));
        scheduleMidnightReset(); // Fires once at next midnight (Cairo TZ), reschedules itself
        state.intervals.push(setInterval(function () {
            if (state.currentProgramIdx >= 0 && state.cachedSchedule) {
                updateCurrentProgramProgress(state.cachedSchedule[state.currentProgramIdx]);
            }
        }, PROGRESS_UPDATE_MS));

        // Drift-corrected clock
        clockTick();

        // Auto-play after initial data load
        setTimeout(function () {
            if (!state.playing && !state.azanPlaying) togglePlayback();
        }, 1500);

        log.info('App initialized');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
