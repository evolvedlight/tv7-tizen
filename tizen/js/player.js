/**
 * Init7 TV — Hardware-Accelerated Video Player for Samsung Tizen (QN90AA)
 * - udpxy Mode (Optional, 242 Channels): Native Samsung AVPlay HTTP MPEG-TS via udpxy (e.g. http://127.0.0.1:40223 or external udpxy)
 * - HD HLS Channels (H.264 / HEVC): Native Samsung AVPlay HLS (.m3u8) Engine
 * - SD HLS Channels (MPEG-2 Video / MP2 Audio): Native Samsung AVPlay Direct MPEG-TS (.ts) Streamer
 * - Fallback / Browser Preview: HTML5 MSE with HLS.js
 */
(function (global) {
    'use strict';

    var hasNativeAvPlay = Boolean(
        global.webapis &&
        global.webapis.avplay &&
        typeof global.webapis.avplay.open === 'function'
    );

    var engineMode = localStorage.getItem('init7_engine_mode') || 'auto';
    var activeEngine = 'none'; // 'avplay-udpxy' | 'avplay' | 'avplay-ts' | 'hls'
    var hlsInstance = null;
    var currentChannel = null;
    var playSessionId = 0;
    var selectedAudioIdx = 0;
    var selectedSubtitleIdx = -1;

    var tsStreamState = {
        pollTimer: null,
        nextTimer: null,
        prepareWatchdog: null,
        queue: [],
        seenUrls: {},
        firstSegmentPlayed: false,
        segStartTime: 0
    };

    var callbacks = {
        onBufferingStart: function () {},
        onBufferingComplete: function () {},
        onStreamPlaying: function () {},
        onTracksUpdated: function () {},
        onError: function () {}
    };

    function getVideoElement() {
        return document.getElementById('html5-player');
    }

    function setCallbacks(cb) {
        for (var k in cb) {
            if (Object.prototype.hasOwnProperty.call(cb, k)) {
                callbacks[k] = cb[k];
            }
        }
    }

    function clearTsStreamTimers() {
        if (tsStreamState.pollTimer) {
            clearInterval(tsStreamState.pollTimer);
            tsStreamState.pollTimer = null;
        }
        if (tsStreamState.nextTimer) {
            clearTimeout(tsStreamState.nextTimer);
            tsStreamState.nextTimer = null;
        }
        if (tsStreamState.prepareWatchdog) {
            clearTimeout(tsStreamState.prepareWatchdog);
            tsStreamState.prepareWatchdog = null;
        }
        tsStreamState.queue = [];
        tsStreamState.seenUrls = {};
        tsStreamState.firstSegmentPlayed = false;
        tsStreamState.segStartTime = 0;
    }

    function stopAvPlaySafe() {
        if (!hasNativeAvPlay) return;
        try {
            var state = global.webapis.avplay.getState();
            if (state === 'PLAYING' || state === 'PAUSED' || state === 'READY') {
                global.webapis.avplay.stop();
            }
        } catch (e) {}
        try {
            global.webapis.avplay.close();
        } catch (e) {}
    }

    function stopHlsSafe() {
        if (hlsInstance) {
            try {
                hlsInstance.destroy();
            } catch (e) {}
            hlsInstance = null;
        }
        var video = getVideoElement();
        if (video) {
            try {
                video.pause();
                video.removeAttribute('src');
                video.load();
            } catch (e) {}
        }
    }

    function stopAll() {
        clearTsStreamTimers();
        stopAvPlaySafe();
        stopHlsSafe();
        activeEngine = 'none';
    }

    function fetchManifestSegments(manifestUrl) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', manifestUrl, true);
            xhr.timeout = 5000;
            xhr.onreadystatechange = function () {
                if (xhr.readyState !== 4) return;
                if (xhr.status >= 200 && xhr.status < 300) {
                    var lines = xhr.responseText.split(/\r?\n/);
                    var urls = [];
                    for (var i = 0; i < lines.length; i++) {
                        var line = lines[i].trim();
                        if (line && line.charAt(0) !== '#' && /^https?:\/\//i.test(line)) {
                            urls.push(line);
                        }
                    }
                    resolve(urls);
                } else {
                    reject(new Error('Manifest HTTP ' + xhr.status));
                }
            };
            xhr.onerror = function () { reject(new Error('Manifest network error')); };
            xhr.ontimeout = function () { reject(new Error('Manifest timeout')); };
            xhr.send();
        });
    }

    /**
     * Native Samsung AVPlay Continuous MPEG-TS via udpxy (e.g. http://127.0.0.1:40223 or external udpxy)
     * Supports all 242 Init7 multicast channels (including CBBC, BBC One HD, BBC Two, ITV, Channel 4, etc.)
     * with hardware H.264 & MPEG-2 decoding, AC-3 / MP2 audio, and DVB subtitles.
     */
    function playWithAvPlayUdpxy(channel, session, attempt) {
        attempt = attempt || 1;
        clearTsStreamTimers();
        stopHlsSafe();
        activeEngine = 'avplay-udpxy';
        document.body.classList.remove('using-html5');
        document.body.classList.add('avplay-transparent');

        var avplay = global.webapis.avplay;
        var streamUrl = (attempt >= 3 && channel.udpxyFallbackUrl)
            ? channel.udpxyFallbackUrl
            : channel.udpxyUrl;

        var isLocalOnTv = streamUrl.indexOf('127.0.0.1:') !== -1;
        var engineLabel = isLocalOnTv ? 'On-TV Multicast HW' : 'udpxy Multicast HW';
        var isPlaying = false;
        var retried = false;

        if (attempt === 1) {
            callbacks.onBufferingStart(channel, engineLabel);
        }

        function handleUdpxyFailure(reason) {
            if (session !== playSessionId || retried) return;
            retried = true;
            clearTsStreamTimers();

            if (attempt < 3) {
                tsStreamState.nextTimer = setTimeout(function () {
                    if (session !== playSessionId) return;
                    playWithAvPlayUdpxy(channel, session, attempt + 1);
                }, 250);
                return;
            }

            if (channel.hasHls && channel.hlsUrl) {
                if (channel.hd) {
                    playWithAvPlayHls(channel, session, true);
                } else {
                    playWithAvPlayTsStream(channel, session);
                }
                return;
            }

            callbacks.onError(
                'Multicast stream unreachable (' + reason + '). Ensure your TV is connected to Init7 with multicast enabled.'
            );
        }

        function openAndPrepare() {
            if (session !== playSessionId) return;
            stopAvPlaySafe();

            try {
                avplay.open(streamUrl);
                avplay.setDisplayRect(0, 0, 1920, 1080);
                try {
                    avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO');
                } catch (e) {}

                try {
                    avplay.setBufferingParam('PLAYER_BUFFER_FOR_PLAY', 'PLAYER_BUFFER_SIZE_IN_SECOND', 1);
                    avplay.setBufferingParam('PLAYER_BUFFER_FOR_RESUME', 'PLAYER_BUFFER_SIZE_IN_SECOND', 2);
                } catch (e) {}

                avplay.setListener({
                    onbufferingstart: function () {
                        if (session !== playSessionId) return;
                        callbacks.onBufferingStart(channel, engineLabel);
                    },
                    onbufferingprogress: function () {},
                    onbufferingcomplete: function () {
                        if (session !== playSessionId) return;
                        callbacks.onBufferingComplete(channel, engineLabel);
                    },
                    oncurrentplaytime: function () {},
                    onevent: function () {},
                    onstreamcompleted: function () {
                        if (session !== playSessionId) return;
                        playWithAvPlayUdpxy(channel, session, 1);
                    },
                    onerror: function (errType) {
                        if (session !== playSessionId) return;
                        if (!isPlaying) {
                            handleUdpxyFailure(String(errType));
                        } else {
                            tsStreamState.nextTimer = setTimeout(function () {
                                if (session !== playSessionId) return;
                                playWithAvPlayUdpxy(channel, session, 1);
                            }, 300);
                        }
                    }
                });

                tsStreamState.prepareWatchdog = setTimeout(function () {
                    if (session !== playSessionId || isPlaying) return;
                    handleUdpxyFailure('Prepare timeout');
                }, 4500);

                avplay.prepareAsync(
                    function () {
                        if (session !== playSessionId) {
                            stopAvPlaySafe();
                            return;
                        }
                        isPlaying = true;
                        clearTsStreamTimers();
                        try {
                            avplay.setDisplayRect(0, 0, 1920, 1080);
                            avplay.play();
                            try { avplay.setVideoStillMode('true'); } catch (e) {}
                            selectedAudioIdx = 0;
                            selectedSubtitleIdx = -1;
                            callbacks.onBufferingComplete(channel, engineLabel);
                            callbacks.onStreamPlaying(channel, engineLabel);
                            callbacks.onTracksUpdated();
                        } catch (playErr) {
                            handleUdpxyFailure(playErr.message || String(playErr));
                        }
                    },
                    function (prepErr) {
                        if (session !== playSessionId) return;
                        handleUdpxyFailure(prepErr && prepErr.name ? prepErr.name : String(prepErr));
                    }
                );
            } catch (openErr) {
                handleUdpxyFailure(openErr.message || String(openErr));
            }
        }

        if (isLocalOnTv && global.Init7Api && typeof global.Init7Api.ensureLocalUdpxyServiceRunning === 'function') {
            global.Init7Api.ensureLocalUdpxyServiceRunning().then(function () {
                if (session !== playSessionId) return;
                openAndPrepare();
            });
        } else {
            openAndPrepare();
        }
    }

    /**
     * Direct MPEG-TS Segment Streamer for Samsung AVPlay
     * Plays MPEG-2 SD HLS channels (like BBC One when udpxy is disabled) in hardware.
     */
    function playWithAvPlayTsStream(channel, session) {
        clearTsStreamTimers();
        stopHlsSafe();
        activeEngine = 'avplay-ts';
        document.body.classList.remove('using-html5');
        document.body.classList.add('avplay-transparent');

        var avplay = global.webapis.avplay;
        var manifestUrl = channel.rawHlsUrl || channel.hlsUrl;
        if (!manifestUrl) {
            callbacks.onError(channel.name + ' requires udpxy Multicast mode (no HLS stream published by Init7).');
            return;
        }

        callbacks.onBufferingStart(channel, 'AVPlay MPEG-2 HW');

        function enqueueNewSegments(urls, isInitial) {
            if (!urls || !urls.length) return;
            var startIdx = isInitial ? Math.max(0, urls.length - 3) : 0;
            for (var i = startIdx; i < urls.length; i++) {
                var u = urls[i];
                if (!tsStreamState.seenUrls[u]) {
                    tsStreamState.seenUrls[u] = true;
                    tsStreamState.queue.push(u);
                }
            }
        }

        function scheduleNextSegment(delayMs) {
            if (session !== playSessionId) return;
            if (tsStreamState.nextTimer) clearTimeout(tsStreamState.nextTimer);
            tsStreamState.nextTimer = setTimeout(function () {
                if (session !== playSessionId) return;
                playNextTsSegment();
            }, delayMs);
        }

        function playNextTsSegment() {
            if (session !== playSessionId) return;
            var nextUrl = tsStreamState.queue.shift();

            if (!nextUrl) {
                fetchManifestSegments(manifestUrl).then(function (urls) {
                    if (session !== playSessionId) return;
                    enqueueNewSegments(urls, false);
                    scheduleNextSegment(tsStreamState.queue.length > 0 ? 50 : 800);
                }).catch(function () {
                    scheduleNextSegment(1000);
                });
                return;
            }

            tsStreamState.segStartTime = Date.now();

            try {
                avplay.stop();
            } catch (e) {}
            try {
                avplay.close();
            } catch (e) {}

            try {
                avplay.open(nextUrl);
                avplay.setDisplayRect(0, 0, 1920, 1080);
                try {
                    avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO');
                } catch (e) {}

                avplay.setListener({
                    onbufferingstart: function () {},
                    onbufferingprogress: function () {},
                    onbufferingcomplete: function () {},
                    oncurrentplaytime: function () {},
                    onevent: function () {},
                    onstreamcompleted: function () {
                        if (session !== playSessionId) return;
                        var elapsed = Date.now() - tsStreamState.segStartTime;
                        scheduleNextSegment(elapsed < 500 ? 500 : 20);
                    },
                    onerror: function () {
                        if (session !== playSessionId) return;
                        scheduleNextSegment(600);
                    }
                });

                avplay.prepareAsync(
                    function () {
                        if (session !== playSessionId) {
                            stopAvPlaySafe();
                            return;
                        }
                        try {
                            avplay.setDisplayRect(0, 0, 1920, 1080);
                            avplay.play();
                            try { avplay.setVideoStillMode('true'); } catch (e) {}

                            if (!tsStreamState.firstSegmentPlayed) {
                                tsStreamState.firstSegmentPlayed = true;
                                callbacks.onBufferingComplete(channel, 'AVPlay MPEG-2 HW');
                                callbacks.onStreamPlaying(channel, 'AVPlay MPEG-2 HW');
                                callbacks.onTracksUpdated();
                            }
                        } catch (playErr) {
                            scheduleNextSegment(600);
                        }
                    },
                    function () {
                        if (session !== playSessionId) return;
                        scheduleNextSegment(600);
                    }
                );
            } catch (openErr) {
                scheduleNextSegment(600);
            }
        }

        fetchManifestSegments(manifestUrl).then(function (urls) {
            if (session !== playSessionId) return;
            if (!urls || urls.length === 0) {
                callbacks.onError('No live segments found for ' + channel.name);
                return;
            }
            enqueueNewSegments(urls, true);
            playNextTsSegment();

            tsStreamState.pollTimer = setInterval(function () {
                if (session !== playSessionId) {
                    clearTsStreamTimers();
                    return;
                }
                fetchManifestSegments(manifestUrl).then(function (latestUrls) {
                    if (session !== playSessionId) return;
                    enqueueNewSegments(latestUrls, false);
                }).catch(function () {});
            }, 3000);
        }).catch(function (err) {
            if (session !== playSessionId) return;
            callbacks.onError('Could not load stream playlist: ' + (err.message || err));
        });
    }

    /**
     * Native Samsung AVPlay HLS (.m3u8) Engine for HD H.264 / HEVC channels
     */
    function playWithAvPlayHls(channel, session, allowFallback) {
        clearTsStreamTimers();
        stopHlsSafe();
        activeEngine = 'avplay';
        document.body.classList.remove('using-html5');
        document.body.classList.add('avplay-transparent');

        var streamUrl = channel.hlsUrl;
        if (!streamUrl) {
            if (channel.udpxyUrl) {
                playWithAvPlayUdpxy(channel, session, 1);
                return;
            }
            callbacks.onError(channel.name + ' has no HLS URL.');
            return;
        }

        var avplay = global.webapis.avplay;
        var prepared = false;
        var bufferingStarted = false;

        stopAvPlaySafe();

        try {
            avplay.open(streamUrl);
            avplay.setDisplayRect(0, 0, 1920, 1080);
            try {
                avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO');
            } catch (e) {}

            try {
                avplay.setBufferingParam('PLAYER_BUFFER_FOR_PLAY', 'PLAYER_BUFFER_SIZE_IN_SECOND', 2);
                avplay.setBufferingParam('PLAYER_BUFFER_FOR_RESUME', 'PLAYER_BUFFER_SIZE_IN_SECOND', 3);
            } catch (e) {}

            avplay.setListener({
                onbufferingstart: function () {
                    if (session !== playSessionId) return;
                    bufferingStarted = true;
                    callbacks.onBufferingStart(channel, 'AVPlay HW');
                },
                onbufferingprogress: function () {},
                onbufferingcomplete: function () {
                    if (session !== playSessionId) return;
                    callbacks.onBufferingComplete(channel, 'AVPlay HW');
                },
                oncurrentplaytime: function () {},
                onevent: function () {},
                onstreamcompleted: function () {
                    if (session !== playSessionId) return;
                    playChannel(channel);
                },
                onerror: function (errType) {
                    if (session !== playSessionId) return;
                    clearTsStreamTimers();
                    if (allowFallback) {
                        playWithAvPlayTsStream(channel, session);
                    } else {
                        callbacks.onError('AVPlay Error: ' + String(errType));
                    }
                }
            });

            callbacks.onBufferingStart(channel, 'AVPlay HW');

            tsStreamState.prepareWatchdog = setTimeout(function () {
                if (session !== playSessionId || prepared || bufferingStarted) return;
                playWithAvPlayTsStream(channel, session);
            }, 2500);

            avplay.prepareAsync(
                function () {
                    if (session !== playSessionId) {
                        stopAvPlaySafe();
                        return;
                    }
                    prepared = true;
                    clearTsStreamTimers();
                    try {
                        avplay.setDisplayRect(0, 0, 1920, 1080);
                        avplay.play();
                        try { avplay.setVideoStillMode('true'); } catch (e) {}
                        selectedAudioIdx = 0;
                        selectedSubtitleIdx = -1;
                        callbacks.onBufferingComplete(channel, 'AVPlay HW');
                        callbacks.onStreamPlaying(channel, 'AVPlay HW');
                        callbacks.onTracksUpdated();
                    } catch (playErr) {
                        if (allowFallback) {
                            playWithAvPlayTsStream(channel, session);
                        } else {
                            callbacks.onError('AVPlay start failed: ' + (playErr.message || playErr));
                        }
                    }
                },
                function (prepErr) {
                    if (session !== playSessionId) return;
                    clearTsStreamTimers();
                    if (allowFallback) {
                        playWithAvPlayTsStream(channel, session);
                    } else {
                        callbacks.onError('AVPlay prepare failed: ' + (prepErr && prepErr.name ? prepErr.name : prepErr));
                    }
                }
            );
        } catch (openErr) {
            clearTsStreamTimers();
            if (allowFallback) {
                playWithAvPlayTsStream(channel, session);
            } else {
                callbacks.onError('AVPlay open failed: ' + (openErr.message || openErr));
            }
        }
    }

    function playWithHlsJs(channel, session) {
        stopAll();

        activeEngine = 'hls';
        document.body.classList.add('using-html5');

        var video = getVideoElement();
        var streamUrl = channel.browserHlsUrl || channel.hlsUrl;
        if (!streamUrl) {
            callbacks.onError(channel.name + ' is a multicast-only channel and requires Samsung AVPlay + udpxy.');
            return;
        }

        callbacks.onBufferingStart(channel, 'HLS.js MSE');

        if (global.Hls && global.Hls.isSupported()) {
            hlsInstance = new global.Hls({
                enableWorker: true,
                lowLatencyMode: false,
                backBufferLength: 15,
                maxBufferLength: 25,
                liveSyncDurationCount: 3
            });

            hlsInstance.loadSource(streamUrl);
            hlsInstance.attachMedia(video);

            hlsInstance.on(global.Hls.Events.MANIFEST_PARSED, function () {
                if (session !== playSessionId) return;
                selectedAudioIdx = 0;
                selectedSubtitleIdx = -1;
                var playPromise = video.play();
                if (playPromise && typeof playPromise.then === 'function') {
                    playPromise.then(function () {
                        if (session !== playSessionId) return;
                        callbacks.onBufferingComplete(channel, 'HLS.js MSE');
                        callbacks.onStreamPlaying(channel, 'HLS.js MSE');
                        callbacks.onTracksUpdated();
                    }).catch(function () {
                        video.muted = false;
                        callbacks.onBufferingComplete(channel, 'HLS.js MSE');
                        callbacks.onStreamPlaying(channel, 'HLS.js MSE');
                    });
                } else {
                    callbacks.onBufferingComplete(channel, 'HLS.js MSE');
                    callbacks.onStreamPlaying(channel, 'HLS.js MSE');
                }
            });

            hlsInstance.on(global.Hls.Events.AUDIO_TRACKS_UPDATED, function () {
                if (session !== playSessionId) return;
                callbacks.onTracksUpdated();
            });

            hlsInstance.on(global.Hls.Events.SUBTITLE_TRACKS_UPDATED, function () {
                if (session !== playSessionId) return;
                callbacks.onTracksUpdated();
            });

            hlsInstance.on(global.Hls.Events.ERROR, function (event, data) {
                if (session !== playSessionId) return;
                if (data && data.fatal) {
                    switch (data.type) {
                        case global.Hls.ErrorTypes.NETWORK_ERROR:
                            if (streamUrl !== channel.hlsUrl && channel.hlsUrl) {
                                streamUrl = channel.hlsUrl;
                                hlsInstance.loadSource(streamUrl);
                                hlsInstance.startLoad();
                            } else {
                                callbacks.onError('Network error loading Init7 HLS stream.');
                            }
                            break;
                        case global.Hls.ErrorTypes.MEDIA_ERROR:
                            hlsInstance.recoverMediaError();
                            break;
                        default:
                            callbacks.onError('Fatal stream error (' + data.details + ').');
                            break;
                    }
                }
            });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = streamUrl;
            video.onloadedmetadata = function () {
                if (session !== playSessionId) return;
                video.play();
                callbacks.onBufferingComplete(channel, 'Native HTML5');
                callbacks.onStreamPlaying(channel, 'Native HTML5');
            };
            video.onerror = function () {
                if (session !== playSessionId) return;
                callbacks.onError('Unable to play HLS stream.');
            };
        } else {
            callbacks.onError('Neither Samsung AVPlay nor HLS MSE is supported in this environment.');
        }
    }

    function isAvPlayActive() {
        return activeEngine === 'avplay' || activeEngine === 'avplay-ts' || activeEngine === 'avplay-udpxy';
    }

    function playChannel(channel) {
        if (!channel) return;
        currentChannel = channel;
        playSessionId += 1;
        var session = playSessionId;
        selectedAudioIdx = 0;
        selectedSubtitleIdx = -1;

        stopAll();

        if (!hasNativeAvPlay || (engineMode === 'hls' && channel.hd && channel.hasHls)) {
            playWithHlsJs(channel, session);
            return;
        }

        var udpxyOn = global.Init7Api && typeof global.Init7Api.isUdpxyEnabled === 'function' && global.Init7Api.isUdpxyEnabled();

        // When udpxy is enabled (or channel is multicast-only) and engineMode is auto or udpxy, stream via udpxy!
        if (channel.udpxyUrl && (engineMode === 'udpxy' || (udpxyOn && engineMode === 'auto') || !channel.hasHls)) {
            playWithAvPlayUdpxy(channel, session, 1);
            return;
        }

        if (!channel.hd || engineMode === 'ts') {
            playWithAvPlayTsStream(channel, session);
            return;
        }

        playWithAvPlayHls(channel, session, true);
    }

    function parseAvPlayExtraInfo(extraStr) {
        if (!extraStr) return {};
        try {
            return JSON.parse(extraStr);
        } catch (e) {
            return {};
        }
    }

    function getAudioTracks() {
        var tracks = [];
        if (isAvPlayActive() && hasNativeAvPlay) {
            try {
                var raw = global.webapis.avplay.getTotalTrackInfo() || [];
                var audioOrdinal = 0;
                for (var i = 0; i < raw.length; i++) {
                    if (raw[i].type === 'AUDIO') {
                        var info = parseAvPlayExtraInfo(raw[i].extra_info);
                        var lang = info.language || info.track_lang || ('Track ' + (audioOrdinal + 1));
                        var codec = info.fourCC || '';
                        var bitrateKbps = info.bit_rate ? Math.round(Number(info.bit_rate) / 1000) + 'k' : '';
                        var meta = [codec, bitrateKbps].filter(Boolean).join(' ');
                        var label = lang.toUpperCase() + (meta ? ' (' + meta + ')' : '');
                        tracks.push({
                            index: Number(raw[i].index),
                            ordinal: audioOrdinal,
                            label: label,
                            selected: audioOrdinal === selectedAudioIdx
                        });
                        audioOrdinal += 1;
                    }
                }
            } catch (e) {}
        } else if (activeEngine === 'hls' && hlsInstance && Array.isArray(hlsInstance.audioTracks)) {
            tracks = hlsInstance.audioTracks.map(function (t, idx) {
                var label = (t.name || t.lang || ('Audio ' + (idx + 1)));
                if (t.lang && t.name && t.name.toLowerCase() !== t.lang.toLowerCase()) {
                    label = t.name + ' (' + t.lang.toLowerCase() + ')';
                }
                return {
                    index: idx,
                    ordinal: idx,
                    label: label,
                    selected: hlsInstance.audioTrack === idx
                };
            });
        }
        return tracks;
    }

    function setAudioTrack(trackObj) {
        if (!trackObj) return false;
        if (isAvPlayActive() && hasNativeAvPlay) {
            try {
                global.webapis.avplay.setSelectTrack('AUDIO', trackObj.index);
                selectedAudioIdx = trackObj.ordinal;
                callbacks.onTracksUpdated();
                return true;
            } catch (e) {
                return false;
            }
        } else if (activeEngine === 'hls' && hlsInstance) {
            hlsInstance.audioTrack = trackObj.index;
            selectedAudioIdx = trackObj.ordinal;
            callbacks.onTracksUpdated();
            return true;
        }
        return false;
    }

    function getSubtitleTracks() {
        var tracks = [
            { index: -1, ordinal: -1, label: 'Off', selected: selectedSubtitleIdx === -1 }
        ];
        if (isAvPlayActive() && hasNativeAvPlay) {
            try {
                var raw = global.webapis.avplay.getTotalTrackInfo() || [];
                var subOrdinal = 0;
                for (var i = 0; i < raw.length; i++) {
                    if (raw[i].type === 'TEXT') {
                        var info = parseAvPlayExtraInfo(raw[i].extra_info);
                        var lang = info.track_lang || info.language || ('Subtitle ' + (subOrdinal + 1));
                        tracks.push({
                            index: Number(raw[i].index),
                            ordinal: subOrdinal,
                            label: lang.toUpperCase(),
                            selected: selectedSubtitleIdx === subOrdinal
                        });
                        subOrdinal += 1;
                    }
                }
            } catch (e) {}
        } else if (activeEngine === 'hls' && hlsInstance && Array.isArray(hlsInstance.subtitleTracks)) {
            for (var j = 0; j < hlsInstance.subtitleTracks.length; j++) {
                var st = hlsInstance.subtitleTracks[j];
                tracks.push({
                    index: j,
                    ordinal: j,
                    label: st.name || st.lang || ('Subtitle ' + (j + 1)),
                    selected: hlsInstance.subtitleTrack === j
                });
            }
        }
        return tracks;
    }

    function setSubtitleTrack(trackObj) {
        if (!trackObj) return false;
        if (isAvPlayActive() && hasNativeAvPlay) {
            try {
                if (trackObj.index === -1) {
                    global.webapis.avplay.setSilentSubtitle(true);
                    selectedSubtitleIdx = -1;
                } else {
                    global.webapis.avplay.setSilentSubtitle(false);
                    global.webapis.avplay.setSelectTrack('TEXT', trackObj.index);
                    selectedSubtitleIdx = trackObj.ordinal;
                }
                callbacks.onTracksUpdated();
                return true;
            } catch (e) {
                return false;
            }
        } else if (activeEngine === 'hls' && hlsInstance) {
            hlsInstance.subtitleTrack = trackObj.index;
            selectedSubtitleIdx = trackObj.ordinal;
            callbacks.onTracksUpdated();
            return true;
        }
        return false;
    }

    function cycleEngineMode() {
        var order = ['auto', 'udpxy', 'ts', 'hls'];
        var idx = order.indexOf(engineMode);
        engineMode = order[(idx + 1) % order.length];
        try {
            localStorage.setItem('init7_engine_mode', engineMode);
        } catch (e) {}
        if (currentChannel) {
            playChannel(currentChannel);
        }
        return engineMode;
    }

    function getEngineModeLabel() {
        if (engineMode === 'udpxy') return 'udpxy Multicast';
        if (engineMode === 'ts') return 'AVPlay Direct TS';
        if (engineMode === 'hls') return 'HLS.js MSE';
        return 'Auto (' + getActiveEngineBadge() + ')';
    }

    function getActiveEngineBadge() {
        if (activeEngine === 'avplay-udpxy') return 'udpxy HW';
        if (activeEngine === 'avplay-ts') return 'AVPlay MPEG-2 HW';
        if (activeEngine === 'avplay') return 'AVPlay HW';
        return 'HLS.js MSE';
    }

    document.addEventListener('visibilitychange', function () {
        if (!hasNativeAvPlay || !isAvPlayActive()) return;
        try {
            if (document.hidden) {
                global.webapis.avplay.suspend();
            } else {
                global.webapis.avplay.restore();
            }
        } catch (e) {}
    });

    global.Init7Player = {
        setCallbacks: setCallbacks,
        playChannel: playChannel,
        stopAll: stopAll,
        getAudioTracks: getAudioTracks,
        setAudioTrack: setAudioTrack,
        getSubtitleTracks: getSubtitleTracks,
        setSubtitleTrack: setSubtitleTrack,
        cycleEngineMode: cycleEngineMode,
        getEngineModeLabel: getEngineModeLabel,
        getActiveEngineBadge: getActiveEngineBadge,
        hasNativeAvPlay: function () { return hasNativeAvPlay; }
    };
})(window);
