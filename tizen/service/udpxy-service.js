/**
 * Init7 TV — Built-in On-TV Local UDP Multicast-to-HTTP Proxy (Tizen Web Service)
 * Runs inside Samsung Tizen TV's Node.js background service runtime on 127.0.0.1:40223.
 * Joins Init7 TV7 IGMP multicast groups (udp://@233.50.230.x:5000) directly from the TV's
 * network interface and relays MPEG-TS packets over localhost HTTP to Samsung AVPlay.
 */
'use strict';

var server = null;
var LISTEN_PORT = 40223;
var LISTEN_HOST = '127.0.0.1';
var activeStreams = [];

function startLocalUdpxyServer() {
    if (server) return;

    var http;
    var dgram;
    var os;
    try {
        http = require('http');
        dgram = require('dgram');
        os = require('os');
    } catch (err) {
        console.error('[UdpxyService] Node core modules unavailable:', err);
        return;
    }

    function getLocalIpv4() {
        try {
            var nets = os.networkInterfaces() || {};
            var names = Object.keys(nets);
            for (var i = 0; i < names.length; i++) {
                var list = nets[names[i]] || [];
                for (var j = 0; j < list.length; j++) {
                    var item = list[j];
                    if ((item.family === 'IPv4' || item.family === 4) && !item.internal && item.address) {
                        return item.address;
                    }
                }
            }
        } catch (e) {}
        return null;
    }

    function closeAllActiveStreams() {
        while (activeStreams.length > 0) {
            var fn = activeStreams.pop();
            try { fn(); } catch (e) {}
        }
    }

    server = http.createServer(function (req, res) {
        var url = req.url || '/';

        if (url.indexOf('/status') === 0) {
            var body = JSON.stringify({
                status: 'ok',
                service: 'Init7TVApp.UdpxyService',
                port: LISTEN_PORT,
                activeClients: activeStreams.length,
                localIp: getLocalIpv4(),
                nodeVersion: typeof process !== 'undefined' ? process.version : 'unknown'
            });
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Cache-Control': 'no-cache'
            });
            res.end(body);
            return;
        }

        // Match /udp/233.50.230.254:5000 or /rtp/233.50.230.254:5000
        var match = url.match(/^\/(?:udp|rtp)\/([0-9]{1,3}(?:\.[0-9]{1,3}){3}):([0-9]{1,5})/);
        if (!match) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
            return;
        }

        // Only one TV channel plays at a time: clean up any lingering multicast group immediately
        closeAllActiveStreams();

        var mcastGroup = match[1];
        var mcastPort = parseInt(match[2], 10);
        var closed = false;
        var headersSent = false;
        var sock = null;

        try {
            sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        } catch (e) {
            sock = dgram.createSocket('udp4');
        }

        if (req.socket && typeof req.socket.setNoDelay === 'function') {
            try { req.socket.setNoDelay(true); } catch (e) {}
        }

        function cleanup() {
            if (closed) return;
            closed = true;
            var idx = activeStreams.indexOf(cleanup);
            if (idx !== -1) activeStreams.splice(idx, 1);

            if (sock) {
                try {
                    var localIp = getLocalIpv4();
                    if (localIp) {
                        sock.dropMembership(mcastGroup, localIp);
                    } else {
                        sock.dropMembership(mcastGroup);
                    }
                } catch (e) {}
                try {
                    sock.close();
                } catch (e) {}
                sock = null;
            }
            try {
                res.end();
            } catch (e) {}
        }

        activeStreams.push(cleanup);

        req.on('close', cleanup);
        req.on('aborted', cleanup);
        res.on('close', cleanup);
        res.on('error', cleanup);

        sock.on('error', function () {
            cleanup();
        });

        sock.on('message', function (msg) {
            if (closed) return;
            if (!headersSent) {
                headersSent = true;
                res.writeHead(200, {
                    'Content-Type': 'video/mp2t',
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'no-cache, no-store',
                    'Connection': 'close'
                });
            }
            // Strip 12-byte RTP header if packet starts with RTP v2 (0x80) instead of MPEG-TS sync byte (0x47)
            var payload = msg;
            if (msg.length > 12 && msg[0] !== 0x47 && (msg[0] & 0xC0) === 0x80 && msg[12] === 0x47) {
                payload = msg.slice(12);
            }
            try {
                res.write(payload);
            } catch (e) {
                cleanup();
            }
        });

        sock.bind(mcastPort, function () {
            if (closed) return;
            try {
                sock.setBroadcast(true);
            } catch (e) {}
            try {
                sock.setRecvBufferSize(4 * 1024 * 1024);
            } catch (e) {}

            var localIp = getLocalIpv4();
            var joined = false;
            if (localIp) {
                try {
                    sock.addMembership(mcastGroup, localIp);
                    joined = true;
                } catch (e) {}
            }
            if (!joined) {
                try {
                    sock.addMembership(mcastGroup);
                    joined = true;
                } catch (e) {
                    cleanup();
                    return;
                }
            }

            // Send HTTP 200 OK headers immediately so AVPlay never fails on cold IGMP joins
            if (!headersSent) {
                headersSent = true;
                res.writeHead(200, {
                    'Content-Type': 'video/mp2t',
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'no-cache, no-store',
                    'Connection': 'close'
                });
                if (typeof res.flushHeaders === 'function') {
                    try { res.flushHeaders(); } catch (e) {}
                }
            }
        });
    });

    server.on('error', function (err) {
        console.error('[UdpxyService] Server error:', err);
    });

    server.listen(LISTEN_PORT, LISTEN_HOST, function () {
        console.log('[UdpxyService] Listening on http://' + LISTEN_HOST + ':' + LISTEN_PORT);
    });
}

module.exports.onStart = function () {
    startLocalUdpxyServer();
};

module.exports.onRequest = function () {
    startLocalUdpxyServer();
};

module.exports.onStop = function () {
    if (server) {
        try { server.close(); } catch (e) {}
        server = null;
    }
};
