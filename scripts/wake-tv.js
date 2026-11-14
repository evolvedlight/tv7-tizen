#!/usr/bin/env node
/**
 * Sends a Wake-on-LAN (WoL) magic packet to a Samsung Tizen TV.
 * Usage: TV_MAC=aa:bb:cc:dd:ee:ff TV_IP=192.168.1.50 node scripts/wake-tv.js
 *    or: node scripts/wake-tv.js <TV_MAC> [TV_IP] [BROADCAST_IP]
 */
'use strict';

const dgram = require('dgram');

const TV_MAC = process.argv[2] || process.env.TV_MAC || '';
const TV_IP = process.argv[3] || process.env.TV_IP || '';
const BROADCAST_IP = process.argv[4] || process.env.TV_BROADCAST || '255.255.255.255';

if (!TV_MAC) {
    console.error('Usage: TV_MAC=<aa:bb:cc:dd:ee:ff> [TV_IP=<ip>] node scripts/wake-tv.js');
    process.exit(1);
}

function createMagicPacket(macStr) {
    const clean = macStr.replace(/[^0-9a-fA-F]/g, '');
    if (clean.length !== 12) {
        throw new Error(`Invalid MAC address: ${macStr}`);
    }
    const macBytes = Buffer.from(clean, 'hex');
    const packet = Buffer.alloc(6 + 16 * 6, 0xff);
    for (let i = 0; i < 16; i++) {
        macBytes.copy(packet, 6 + i * 6);
    }
    return packet;
}

const packet = createMagicPacket(TV_MAC);
const sock = dgram.createSocket('udp4');

sock.bind(() => {
    sock.setBroadcast(true);
    sock.send(packet, 9, BROADCAST_IP, () => {
        if (TV_IP) {
            sock.send(packet, 9, TV_IP, () => {
                console.log(`Sent Wake-on-LAN magic packet to Samsung TV (${TV_MAC} / ${TV_IP})`);
                sock.close();
            });
        } else {
            console.log(`Sent Wake-on-LAN magic packet to Samsung TV (${TV_MAC} via ${BROADCAST_IP})`);
            sock.close();
        }
    });
});
