import { getCurrentProfile } from '../src/config/store.js';

async function main() {
    const profile = getCurrentProfile();
    if (!profile) {
        console.error('No active profile found.');
        return;
    }

    console.log('Active Profile:', {
        server: profile.server,
        account: profile.account,
        apiVersion: profile.config?.apiVersion,
        hasSessionId: !!profile.sessionId,
        hasToken: !!profile.token
    });

    const fileId = '3329';
    const endpoints = [
        // v1 api via index.php
        {
            name: 'v1_index_read',
            url: `${profile.server.replace(/\/+$/, '')}/index.php?m=file&f=read&fileID=${fileId}&zentaosid=${profile.sessionId || ''}`,
            headers: {}
        },
        {
            name: 'v1_index_download',
            url: `${profile.server.replace(/\/+$/, '')}/index.php?m=file&f=download&fileID=${fileId}&zentaosid=${profile.sessionId || ''}`,
            headers: {}
        },
        // v1 REST api
        {
            name: 'v1_rest_download',
            url: `${profile.server.replace(/\/+$/, '')}/api.php/v1/files/${fileId}/download`,
            headers: profile.token ? { 'Token': profile.token } : {}
        },
        {
            name: 'v1_rest_get',
            url: `${profile.server.replace(/\/+$/, '')}/api.php/v1/files/${fileId}`,
            headers: profile.token ? { 'Token': profile.token } : {}
        },
        // v2 api
        {
            name: 'v2_rest_download',
            url: `${profile.server.replace(/\/+$/, '')}/api.php/v2/files/${fileId}/download`,
            headers: profile.token ? { 'Token': profile.token } : {}
        },
        {
            name: 'v2_rest_get',
            url: `${profile.server.replace(/\/+$/, '')}/api.php/v2/files/${fileId}`,
            headers: profile.token ? { 'Token': profile.token } : {}
        },
        // general read.html
        {
            name: 'read_html',
            url: `${profile.server.replace(/\/+$/, '')}/file-read-${fileId}.html`,
            headers: {}
        }
    ];

    for (const ep of endpoints) {
        console.log(`\nTesting: ${ep.name}`);
        console.log(`URL: ${ep.url}`);
        try {
            const res = await fetch(ep.url, {
                method: 'GET',
                headers: ep.headers,
                redirect: 'follow'
            });
            console.log(`Status: ${res.status} ${res.statusText}`);
            console.log(`Content-Type: ${res.headers.get('content-type')}`);
            console.log(`Content-Length: ${res.headers.get('content-length')}`);
            if (res.ok) {
                const contentType = res.headers.get('content-type') || '';
                if (contentType.includes('image') || contentType.includes('application/octet-stream')) {
                    console.log(`SUCCESS: ${ep.name} returned a valid image/binary stream!`);
                } else {
                    const text = await res.text();
                    console.log(`Response text preview: ${text.substring(0, 200)}`);
                }
            }
        } catch (err: any) {
            console.error(`Error testing ${ep.name}:`, err.message);
        }
    }
}

main().catch(console.error);
