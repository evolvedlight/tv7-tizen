#!/usr/bin/env node
/**
 * Builds Init7TV.wgt and deploys/launches it directly on a Samsung Tizen TV via SDB.
 * Usage:
 *   npm run deploy -- <TV_IP>
 *   (or npm run deploy to auto-discover your Samsung QN90AA on 192.168.1.x)
 */
'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const tools = require('@tizentv/tools');
const { build, OUTPUT_WGT } = require('./build-wgt');
const { discoverSamsungTvs } = require('./discover-tv');
const http = require('http');

const execFileAsync = promisify(execFile);
const DEFAULT_TV_IP = '';
const APP_ID = 'Init7TVApp.Init7TV';
const REMOTE_TMP_DIR = '/home/owner/share/tmp/sdk_tools/tmp/';
const REMOTE_WGT_PATH = `${REMOTE_TMP_DIR}Init7TV.wgt`;

function checkTvInfo(ip) {
    return new Promise((resolve) => {
        const req = http.get(`http://${ip}:8001/api/v2/`, { timeout: 2500 }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => {
                try { resolve(JSON.parse(body)); } catch (e) { resolve(null); }
            });
        });
        req.on('timeout', () => { req.destroy(); resolve(null); });
        req.on('error', () => resolve(null));
    });
}

async function runSdb(sdbPath, args) {
    console.log(`[sdb] ${args.join(' ')}`);
    const { stdout, stderr } = await execFileAsync(sdbPath, args, { timeout: 45000 });
    if (stdout && stdout.trim()) console.log(stdout.trim());
    if (stderr && stderr.trim()) console.error(stderr.trim());
    return { stdout: stdout || '', stderr: stderr || '' };
}

async function deploy() {
    let tvIp = process.argv[2] || process.env.TV_IP || DEFAULT_TV_IP;

    await build();
    const sdbPath = await tools.getSdbPath();

    if (!tvIp) {
        console.log('\n[deploy] No TV IP specified — scanning local network for your Samsung QN90AA...');
        const tvs = await discoverSamsungTvs();
        if (tvs.length === 0) {
            console.error('\n[deploy] Could not auto-discover a powered-on Samsung TV.');
            console.error('Please pass your TV IP explicitly once it is powered on:');
            console.error('  npm run deploy -- <YOUR_TV_IP>');
            process.exit(1);
        }
        const preferred = tvs.find((t) => t.sdbOpen) || tvs[0];
        tvIp = preferred.ip;
        console.log(`[deploy] Selected ${preferred.name} (${preferred.model}) at ${tvIp}`);
        if (!preferred.sdbOpen) {
            console.error(`\n[deploy] Note: TV found at ${tvIp}, but Developer Mode port (26101) is closed.`);
            console.error('Enable Developer Mode on the TV (Apps -> press 12345 -> Developer Mode ON -> Host PC IP: <YOUR_PC_LAN_IP> -> Reboot TV).');
            process.exit(1);
        }
    }

    const cleanIp = tvIp.split(':')[0];
    const target = tvIp.includes(':') ? tvIp : `${tvIp}:26101`;

    const info = await checkTvInfo(cleanIp);
    if (info && info.device) {
        console.log(`\n=== TV Status (${info.device.name} / ${info.device.modelName}) ===`);
        console.log(`  Power State   : ${info.device.PowerState}`);
        console.log(`  Network Type  : ${info.device.networkType}`);
        console.log(`  Developer Mode: ${info.device.developerMode === '1' ? 'ON (1)' : 'OFF (0)'}`);
        console.log(`  Developer IP  : ${info.device.developerIP}`);
        if (info.device.developerMode !== '1') {
            throw new Error(
                `TV reports developerMode="0" and developerIP="${info.device.developerIP}".\n` +
                `On your TV:\n` +
                `  1. Open Smart Hub -> "Apps" (select the Apps icon on the left sidebar)\n` +
                `  2. Press the "123" (number/gear) button on your remote, enter 12345, and press Done\n` +
                `  3. Set Developer Mode to ON and enter Host PC IP: <YOUR_PC_LAN_IP>\n` +
                `  4. Hold the Power button on your remote for 5 seconds until the TV reboots.`
            );
        }
    }

    console.log(`\n=== Connecting to Samsung TV at ${target} ===`);
    const conn = await runSdb(sdbPath, ['connect', target]);
    if (conn.stdout.includes('failed') || conn.stdout.includes('error')) {
        throw new Error(`Failed to connect to ${target}. Verify Developer Mode is ON, Host PC IP is set to your PC's LAN IP, and the TV has been rebooted.`);
    }

    console.log('\n=== Pushing Init7TV.wgt to TV ===');
    await runSdb(sdbPath, ['-s', target, 'push', OUTPUT_WGT, REMOTE_TMP_DIR]);

    console.log('\n=== Installing Init7 TV on Samsung QN90AA ===');
    const installRes = await runSdb(sdbPath, [
        '-s', target,
        'shell', '0', 'vd_appinstall', APP_ID, REMOTE_WGT_PATH
    ]);

    if (installRes.stdout.includes('failed')) {
        throw new Error(`Installation reported failure:\n${installRes.stdout}`);
    }

    console.log('\n=== Launching Init7 TV on TV Screen ===');
    try {
        await runSdb(sdbPath, ['-s', target, 'shell', '0', 'execute', APP_ID]);
    } catch (e) {
        console.log('App installed! You can launch "Init7 TV" directly from your TV Smart Hub -> Apps.');
    }

    console.log('\n✅ Init7 TV is installed and running on your Samsung TV!');
}

if (require.main === module) {
    deploy().catch((err) => {
        console.error('\n[deploy] Error:', err.message || err);
        process.exit(1);
    });
}
