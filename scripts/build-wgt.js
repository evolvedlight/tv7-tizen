#!/usr/bin/env node
/**
 * Builds and cryptographically signs the Samsung Tizen .wgt package (dist/Init7TV.wgt)
 * Works in headless Linux / WSL2 without requiring GNOME keyring or Tizen Studio GUI.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const TizenCertManager = require('@tizentv/webide-common-tizentv/lib/tizenCertificateManager');
const PackageSigner = require('@tizentv/webide-common-tizentv/lib/packageSigner');
const cryptUtil = require('@tizentv/webide-common-tizentv/lib/cryptUtil');

const ROOT_DIR = path.resolve(__dirname, '..');
const TIZEN_APP_DIR = path.resolve(ROOT_DIR, 'tizen');
const DIST_DIR = path.resolve(ROOT_DIR, 'dist');
const CERT_RESOURCE_DIR = path.resolve(ROOT_DIR, '.tizen-certs');
const OUTPUT_WGT = path.resolve(DIST_DIR, 'Init7TV.wgt');

const AUTHOR_KEY_NAME = process.env.TIZEN_CERT_NAME || 'init7tv_author';
const AUTHOR_PASSWORD = process.env.TIZEN_CERT_PASSWORD || 'init7tvpassword';

function cleanSignatures() {
    ['author-signature.xml', 'signature1.xml', 'signature2.xml', 'Init7TV.wgt'].forEach((file) => {
        const p = path.resolve(TIZEN_APP_DIR, file);
        if (fs.existsSync(p)) {
            fs.unlinkSync(p);
        }
    });
}

async function ensureCertificates() {
    fs.mkdirSync(CERT_RESOURCE_DIR, { recursive: true });
    const certMgr = new TizenCertManager(CERT_RESOURCE_DIR);
    await certMgr.init();

    const authorP12Path = path.resolve(CERT_RESOURCE_DIR, 'Author', `${AUTHOR_KEY_NAME}.p12`);
    if (!fs.existsSync(authorP12Path)) {
        console.log('[build-wgt] Generating Tizen Author Certificate...');
        certMgr.createCert({
            keyFileName: AUTHOR_KEY_NAME,
            authorName: 'Init7TVDeveloper',
            authorPassword: AUTHOR_PASSWORD,
            countryInfo: 'CH',
            stateInfo: 'ZH',
            cityInfo: 'Winterthur',
            organizationInfo: 'Init7TV',
            departmentInfo: 'TV',
            emailInfo: 'tv@example.com'
        });
    }

    const distProfile = certMgr.getTizenDistributorProfile('public');
    return {
        authorP12Path,
        authorPassword: AUTHOR_PASSWORD,
        distributorP12Path: distProfile.distributorCertPath,
        distributorPassword: distProfile.distributorPassword
    };
}

async function createZipArchive(sourceDir, outWgtPath) {
    fs.mkdirSync(path.dirname(outWgtPath), { recursive: true });
    if (fs.existsSync(outWgtPath)) {
        fs.unlinkSync(outWgtPath);
    }

    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(outWgtPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => resolve(archive.pointer()));
        archive.on('error', (err) => reject(err));
        archive.pipe(output);

        function walk(currentDir) {
            const entries = fs.readdirSync(currentDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name.startsWith('.') || entry.name.endsWith('.wgt')) continue;
                const fullPath = path.resolve(currentDir, entry.name);
                if (entry.isDirectory()) {
                    walk(fullPath);
                } else {
                    const relPath = path.relative(sourceDir, fullPath).replace(/\\/g, '/');
                    archive.file(fullPath, { name: relPath });
                }
            }
        }

        walk(sourceDir);
        archive.finalize();
    });
}

async function build() {
    console.log('=== Building Samsung Tizen Package (Init7TV.wgt) ===');
    cleanSignatures();

    const certs = await ensureCertificates();
    const signer = new PackageSigner();
    signer.profileInfo.author = cryptUtil.parseP12File(certs.authorP12Path, certs.authorPassword);
    signer.profileInfo.distributor1 = cryptUtil.parseP12File(certs.distributorP12Path, certs.distributorPassword);

    console.log('[build-wgt] Signing widget files (author-signature.xml & signature1.xml)...');
    signer.signPackage(TIZEN_APP_DIR, '');

    console.log('[build-wgt] Packaging zip archive ->', OUTPUT_WGT);
    const bytes = await createZipArchive(TIZEN_APP_DIR, OUTPUT_WGT);
    cleanSignatures();

    console.log(`[build-wgt] Success! Created ${OUTPUT_WGT} (${(bytes / 1024).toFixed(1)} KB)`);
}

if (require.main === module) {
    build().catch((err) => {
        console.error('[build-wgt] Build failed:', err);
        process.exit(1);
    });
}

module.exports = { build, OUTPUT_WGT };
