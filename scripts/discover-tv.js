#!/usr/bin/env node
/**
 * Scans the local subnet (default 192.168.1.0/24) for Samsung Tizen Smart TVs
 * Checks both port 8001 (Samsung SmartView REST API) and port 26101 (SDB Developer Mode).
 */
'use strict';

const http = require('http');
const net = require('net');

const SUBNET_PREFIX = process.env.TV_SUBNET || '192.168.1.';

function checkPort(ip, port, timeoutMs = 650) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let done = false;
        const finish = (ok) => {
            if (done) return;
            done = true;
            socket.destroy();
            resolve(ok);
        };
        socket.setTimeout(timeoutMs);
        socket.once('connect', () => finish(true));
        socket.once('timeout', () => finish(false));
        socket.once('error', () => finish(false));
        socket.connect(port, ip);
    });
}

function fetchTvMetadata(ip, timeoutMs = 900) {
    return new Promise((resolve) => {
        const req = http.get(`http://${ip}:8001/api/v2/`, { timeout: timeoutMs }, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    resolve(data);
                } catch (e) {
                    resolve(null);
                }
            });
        });
        req.on('timeout', () => { req.destroy(); resolve(null); });
        req.on('error', () => resolve(null));
    });
}

async function discoverSamsungTvs() {
    const found = [];
    const batchSize = 45;
    const ips = [];
    for (let i = 1; i <= 254; i++) {
        ips.push(`${SUBNET_PREFIX}${i}`);
    }

    for (let offset = 0; offset < ips.length; offset += batchSize) {
        const slice = ips.slice(offset, offset + batchSize);
        await Promise.all(slice.map(async (ip) => {
            const [sdbOpen, apiOpen] = await Promise.all([
                checkPort(ip, 26101, 600),
                checkPort(ip, 8001, 600)
            ]);
            if (sdbOpen || apiOpen) {
                const meta = apiOpen ? await fetchTvMetadata(ip) : null;
                found.push({
                    ip,
                    sdbOpen,
                    apiOpen,
                    name: (meta && meta.device && meta.device.name) || (meta && meta.name) || 'Samsung Tizen TV',
                    model: (meta && meta.device && meta.device.modelName) || '',
                    developerMode: (meta && meta.device && meta.device.developerMode) || (sdbOpen ? '1' : 'unknown'),
                    developerIp: (meta && meta.device && meta.device.developerIP) || ''
                });
            }
        }));
    }

    return found;
}

if (require.main === module) {
    console.log(`Scanning ${SUBNET_PREFIX}1-254 for Samsung Smart TVs...`);
    discoverSamsungTvs().then((tvs) => {
        if (tvs.length === 0) {
            console.log('No powered-on Samsung TVs responded on port 8001 or 26101.');
            console.log('Make sure your Samsung QN90AA is turned ON and connected to your local network.');
            process.exit(1);
        }
        for (const tv of tvs) {
            console.log(`- Found: ${tv.name} (${tv.model || 'Tizen'}) at ${tv.ip}`);
            console.log(`  SDB Port 26101: ${tv.sdbOpen ? 'OPEN (Ready to install!)' : 'CLOSED (Enable Developer Mode on TV)'}`);
            if (tv.developerIp) {
                console.log(`  Configured Host PC IP on TV: ${tv.developerIp}`);
            }
        }
    });
}

module.exports = { discoverSamsungTvs };
