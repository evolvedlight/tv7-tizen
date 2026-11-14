/**
 * Init7 TV7 API Client, Built-in On-TV Multicast Service & EPG Cache
 * - Built-in On-TV Multicast Proxy: Launches Init7TVApp.UdpxyService on http://127.0.0.1:40223
 *   so the TV listens to Init7 UDP multicast (242 channels) directly on its own network interface
 *   with zero external server required.
 * - Optional External udpxy Support: Also supports external udpxy hosts (e.g. udpxy.local:40222 or 192.168.1.10:40222).
 * - Direct Init7 EPG & HLS API: Connects to https://api.tv.init7.net/api/.
 */
(function (global) {
    'use strict';

    var PROD_API_BASE = 'https://api.tv.init7.net/api';
    var LOCAL_PROXY_BASE = '/init7-api';

    var ON_TV_LOCAL_HOST = '127.0.0.1:40223';
    var EXTERNAL_UDPXY_IP_HOST = '192.168.1.10:40222';
    var EXTERNAL_UDPXY_NAME_HOST = 'udpxy.local:40222';
    var SERVICE_APP_ID = 'Init7TVApp.UdpxyService';

    var udpxyEnabled = localStorage.getItem('init7_udpxy_enabled') !== 'false';
    // Default to the built-in On-TV local multicast proxy (127.0.0.1:40223)
    var savedHost = localStorage.getItem('init7_udpxy_host');
    var udpxyHost = savedHost || ON_TV_LOCAL_HOST;

    var serviceLaunchPromise = null;

    function isUdpxyEnabled() {
        return udpxyEnabled;
    }

    function getUdpxyHost() {
        return udpxyHost;
    }

    function setUdpxyConfig(enabled, host) {
        udpxyEnabled = Boolean(enabled);
        if (host) {
            udpxyHost = String(host).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
        }
        try {
            localStorage.setItem('init7_udpxy_enabled', udpxyEnabled ? 'true' : 'false');
            localStorage.setItem('init7_udpxy_host', udpxyHost);
        } catch (e) {}
    }

    function buildUdpxyUrl(multicastSrc, hostOverride) {
        if (!multicastSrc) return '';
        var host = hostOverride || udpxyHost || ON_TV_LOCAL_HOST;
        var addr = String(multicastSrc).replace(/^udp:\/\/@?/i, '').trim();
        if (!addr) return '';
        return 'http://' + host + '/udp/' + addr;
    }

    function checkUdpxyStatus(hostOverride, timeoutMs) {
        var host = hostOverride || udpxyHost || ON_TV_LOCAL_HOST;
        timeoutMs = timeoutMs || 2000;
        return new Promise(function (resolve) {
            var xhr = new XMLHttpRequest();
            var timer = setTimeout(function () {
                try { xhr.abort(); } catch (e) {}
                resolve(false);
            }, timeoutMs);

            xhr.open('GET', 'http://' + host + '/status/', true);
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) return;
                clearTimeout(timer);
                resolve(xhr.status >= 200 && xhr.status < 300);
            };
            xhr.onerror = function () {
                clearTimeout(timer);
                resolve(false);
            };
            xhr.send();
        });
    }

    /**
     * Ensures the built-in Tizen background service (Init7TVApp.UdpxyService) is running
     * on 127.0.0.1:40223 inside the TV.
     */
    function ensureLocalUdpxyServiceRunning() {
        if (serviceLaunchPromise) return serviceLaunchPromise;

        serviceLaunchPromise = checkUdpxyStatus(ON_TV_LOCAL_HOST, 800).then(function (alreadyUp) {
            if (alreadyUp) return true;
            if (!global.tizen || !global.tizen.application) return false;

            return new Promise(function (resolve) {
                try {
                    global.tizen.application.launch(
                        SERVICE_APP_ID,
                        function () {
                            setTimeout(function () {
                                checkUdpxyStatus(ON_TV_LOCAL_HOST, 1500).then(resolve);
                            }, 350);
                        },
                        function () {
                            resolve(false);
                        }
                    );
                } catch (e) {
                    resolve(false);
                }
            });
        }).then(function (ok) {
            if (!ok) {
                serviceLaunchPromise = null;
            }
            return ok;
        });

        return serviceLaunchPromise;
    }

    function fetchJson(endpointPath, timeoutMs) {
        timeoutMs = timeoutMs || 7000;
        var isBrowserHttp = window.location && /^https?:/.test(window.location.protocol);

        function attempt(baseUrl) {
            return new Promise(function (resolve, reject) {
                var xhr = new XMLHttpRequest();
                var timer = setTimeout(function () {
                    try { xhr.abort(); } catch (e) {}
                    reject(new Error('Request timeout: ' + endpointPath));
                }, timeoutMs);

                xhr.open('GET', baseUrl + endpointPath, true);
                xhr.setRequestHeader('Accept', 'application/json');
                xhr.onreadystatechange = function () {
                    if (xhr.readyState !== 4) return;
                    clearTimeout(timer);
                    if (xhr.status >= 200 && xhr.status < 300) {
                        try {
                            resolve(JSON.parse(xhr.responseText));
                        } catch (err) {
                            reject(err);
                        }
                    } else {
                        reject(new Error('HTTP ' + xhr.status + ' for ' + endpointPath));
                    }
                };
                xhr.onerror = function () {
                    clearTimeout(timer);
                    reject(new Error('Network error for ' + endpointPath));
                };
                xhr.send();
            });
        }

        if (!isBrowserHttp) {
            return attempt(PROD_API_BASE);
        }
        return attempt(LOCAL_PROXY_BASE).catch(function () {
            return attempt(PROD_API_BASE);
        });
    }

    function normalizeChannels(rawResults, includeMulticastOnly) {
        if (!Array.isArray(rawResults)) return [];
        var visible = rawResults.filter(function (ch) {
            if (!ch || ch.visible === false) return false;
            if (includeMulticastOnly) {
                return Boolean(ch.src || ch.has_hls || ch.hls_src);
            }
            return Boolean(ch.has_hls !== false || ch.hls_src);
        });

        visible.sort(function (a, b) {
            var oa = typeof a.ordernum === 'number' ? a.ordernum : 99999;
            var ob = typeof b.ordernum === 'number' ? b.ordernum : 99999;
            return oa - ob;
        });

        var isBrowserHttp = window.location && /^https?:/.test(window.location.protocol);
        var fallbackHost = (udpxyHost === ON_TV_LOCAL_HOST)
            ? EXTERNAL_UDPXY_IP_HOST
            : ON_TV_LOCAL_HOST;

        return visible.map(function (ch, idx) {
            var hasHls = Boolean(ch.has_hls || ch.hls_src);
            var baseHls = hasHls
                ? (ch.hls_src || ('https://api.tv.init7.net/api/live/?channel=' + ch.pk))
                : '';
            var avplayHls = baseHls
                ? (baseHls + (baseHls.indexOf('?') !== -1 ? '&ext=.m3u8' : '?ext=.m3u8'))
                : '';
            var browserHls = (isBrowserHttp && baseHls)
                ? ('/init7-api/live/?channel=' + encodeURIComponent(ch.pk) + '&ext=.m3u8')
                : avplayHls;

            var mcastSrc = ch.src || '';

            return {
                pk: ch.pk,
                number: idx + 1,
                ordernum: ch.ordernum || (idx + 1),
                name: ch.name || 'Channel ' + (idx + 1),
                canonicalName: ch.canonical_name || '',
                hd: Boolean(ch.hd),
                logo: ch.logo || '',
                language: (ch.language || 'de').toLowerCase(),
                country: (ch.country || '').toLowerCase(),
                hasReplay: Boolean(ch.has_replay),
                hasHls: hasHls,
                multicastSrc: mcastSrc,
                udpxyUrl: buildUdpxyUrl(mcastSrc, udpxyHost),
                udpxyFallbackUrl: buildUdpxyUrl(mcastSrc, fallbackHost),
                hlsUrl: avplayHls,
                rawHlsUrl: baseHls,
                browserHlsUrl: browserHls
            };
        });
    }

    function loadBundledJsonFile(filePath, includeMulticastOnly) {
        return new Promise(function (resolve) {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', filePath, true);
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) return;
                if (xhr.status === 200 || (xhr.status === 0 && xhr.responseText)) {
                    try {
                        var parsed = JSON.parse(xhr.responseText);
                        resolve(normalizeChannels(parsed.results || [], includeMulticastOnly));
                        return;
                    } catch (e) {}
                }
                resolve([]);
            };
            xhr.onerror = function () {
                resolve([]);
            };
            xhr.send();
        });
    }

    function loadBundledChannels() {
        if (udpxyEnabled) {
            return loadBundledJsonFile('data/channels-multicast.json', true).then(function (list) {
                if (list && list.length > 0) return list;
                return loadBundledJsonFile('data/channels-fallback.json', false);
            });
        }
        return loadBundledJsonFile('data/channels-fallback.json', false);
    }

    function fetchLiveChannels() {
        if (udpxyEnabled) {
            return loadBundledJsonFile('data/channels-multicast.json', true);
        }
        return fetchJson('/tvchannel/?limit=200', 7000).then(function (data) {
            if (data && Array.isArray(data.results) && data.results.length > 0) {
                return normalizeChannels(data.results, false);
            }
            throw new Error('Empty channel list response');
        });
    }

    // EPG Cache: channelPk -> { fetchedAt: number, entries: Array, pending: Promise|null }
    var epgCache = {};
    var EPG_TTL_MS = 15 * 60 * 1000; // 15 minutes

    function parseIsoMs(isoStr) {
        if (!isoStr) return 0;
        var t = Date.parse(isoStr);
        return isNaN(t) ? 0 : t;
    }

    function formatHhMm(ms) {
        if (!ms) return '--:--';
        var d = new Date(ms);
        var hh = String(d.getHours()).padStart(2, '0');
        var mm = String(d.getMinutes()).padStart(2, '0');
        return hh + ':' + mm;
    }

    function computeNowNext(channelPk, refMs) {
        var record = epgCache[channelPk];
        if (!record || !Array.isArray(record.entries) || record.entries.length === 0) {
            return null;
        }
        var nowMs = refMs || Date.now();
        var entries = record.entries;
        var nowItem = null;
        var nextItem = null;

        for (var i = 0; i < entries.length; i++) {
            var item = entries[i];
            if (item.endMs <= nowMs) {
                continue;
            }
            if (item.startMs <= nowMs && item.endMs > nowMs) {
                nowItem = item;
                if (i + 1 < entries.length) {
                    nextItem = entries[i + 1];
                }
                break;
            }
            if (item.startMs > nowMs) {
                nextItem = item;
                break;
            }
        }

        var progressPct = 0;
        if (nowItem && nowItem.endMs > nowItem.startMs) {
            progressPct = Math.max(0, Math.min(100,
                Math.round(((nowMs - nowItem.startMs) / (nowItem.endMs - nowItem.startMs)) * 100)
            ));
        }

        return {
            now: nowItem,
            next: nextItem,
            progressPct: progressPct
        };
    }

    function getChannelEpgEntries(channelPk) {
        var record = epgCache[channelPk];
        if (!record || !Array.isArray(record.entries)) return null;
        return record.entries;
    }

    function fetchChannelEpg(channelPk) {
        if (!channelPk || String(channelPk).indexOf('mcast-') === 0) {
            return Promise.resolve(null);
        }
        var existing = epgCache[channelPk];
        var now = Date.now();

        if (existing && existing.entries && existing.entries.length > 0 && (now - existing.fetchedAt < EPG_TTL_MS)) {
            return Promise.resolve(computeNowNext(channelPk, now));
        }
        if (existing && existing.pending) {
            return existing.pending;
        }

        var promise = fetchJson('/epg/?channel=' + encodeURIComponent(channelPk) + '&limit=600', 8000)
            .then(function (data) {
                var raw = (data && Array.isArray(data.results)) ? data.results : [];
                var normalized = [];
                for (var i = 0; i < raw.length; i++) {
                    var r = raw[i];
                    var ts = r.timeslot || {};
                    var startMs = parseIsoMs(ts.lower);
                    var endMs = parseIsoMs(ts.upper);
                    if (!startMs || !endMs) continue;
                    normalized.push({
                        pk: r.pk,
                        title: r.title || 'Program',
                        subTitle: r.sub_title || '',
                        desc: r.desc || '',
                        categories: Array.isArray(r.categories) ? r.categories : [],
                        credits: Array.isArray(r.credits) ? r.credits : [],
                        country: r.country || '',
                        subtitles: Boolean(r.subtitles),
                        startMs: startMs,
                        endMs: endMs,
                        startFormatted: formatHhMm(startMs),
                        endFormatted: formatHhMm(endMs)
                    });
                }
                normalized.sort(function (a, b) { return a.startMs - b.startMs; });
                epgCache[channelPk] = {
                    fetchedAt: Date.now(),
                    entries: normalized,
                    pending: null
                };
                return computeNowNext(channelPk, Date.now());
            })
            .catch(function () {
                if (epgCache[channelPk]) {
                    epgCache[channelPk].pending = null;
                }
                return computeNowNext(channelPk, Date.now());
            });

        epgCache[channelPk] = {
            fetchedAt: existing ? existing.fetchedAt : 0,
            entries: existing ? existing.entries : [],
            pending: promise
        };
        return promise;
    }

    global.Init7Api = {
        ON_TV_LOCAL_HOST: ON_TV_LOCAL_HOST,
        EXTERNAL_UDPXY_IP_HOST: EXTERNAL_UDPXY_IP_HOST,
        EXTERNAL_UDPXY_NAME_HOST: EXTERNAL_UDPXY_NAME_HOST,
        loadBundledChannels: loadBundledChannels,
        fetchLiveChannels: fetchLiveChannels,
        fetchChannelEpg: fetchChannelEpg,
        getChannelEpgEntries: getChannelEpgEntries,
        getCachedNowNext: function (channelPk) {
            return computeNowNext(channelPk, Date.now());
        },
        formatHhMm: formatHhMm,
        isUdpxyEnabled: isUdpxyEnabled,
        getUdpxyHost: getUdpxyHost,
        setUdpxyConfig: setUdpxyConfig,
        checkUdpxyStatus: checkUdpxyStatus,
        ensureLocalUdpxyServiceRunning: ensureLocalUdpxyServiceRunning
    };
})(window);
