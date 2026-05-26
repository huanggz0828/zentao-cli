import { describe, test, expect } from 'bun:test';
import { translateV2PathToV1, ZentaoV1Client } from '../src/api/v1-client';
import { ZentaoError } from '../src/errors';
import type { ServerConfig } from '../src/types';

describe('translateV2PathToV1', () => {
    test('Format 1: list commands', () => {
        expect(translateV2PathToV1('GET', '/bugs')).toEqual({
            module: 'bug',
            action: 'browse',
        });
        expect(translateV2PathToV1('GET', 'products/')).toEqual({
            module: 'product',
            action: 'browse',
        });
    });

    test('Format 1: create commands', () => {
        expect(translateV2PathToV1('POST', '/bugs')).toEqual({
            module: 'bug',
            action: 'create',
        });
    });

    test('Format 2: detail commands (GET)', () => {
        expect(translateV2PathToV1('GET', '/bugs/123')).toEqual({
            module: 'bug',
            action: 'view',
            id: 123,
        });
        expect(translateV2PathToV1('GET', '/bugs/{id}')).toEqual({
            module: 'bug',
            action: 'view',
            id: undefined,
        });
    });

    test('Format 2: update commands (PUT/POST)', () => {
        expect(translateV2PathToV1('PUT', '/bugs/123')).toEqual({
            module: 'bug',
            action: 'edit',
            id: 123,
        });
        expect(translateV2PathToV1('POST', '/bugs/123')).toEqual({
            module: 'bug',
            action: 'edit',
            id: 123,
        });
    });

    test('Format 2: delete commands (DELETE)', () => {
        expect(translateV2PathToV1('DELETE', '/bugs/123')).toEqual({
            module: 'bug',
            action: 'delete',
            id: 123,
        });
    });

    test('Format 3: actions on resources', () => {
        expect(translateV2PathToV1('POST', '/bugs/123/resolve')).toEqual({
            module: 'bug',
            action: 'resolve',
            id: 123,
        });
        expect(translateV2PathToV1('POST', '/bugs/123/close')).toEqual({
            module: 'bug',
            action: 'close',
            id: 123,
        });
    });

    test('Format 4: associated sub-resources list', () => {
        expect(translateV2PathToV1('GET', '/products/123/bugs')).toEqual({
            module: 'bug',
            action: 'browse',
            id: 123,
            assocParams: {
                productID: 123,
            },
        });
    });

    test('fallback to default', () => {
        expect(translateV2PathToV1('GET', '/custom-module/custom-action')).toEqual({
            module: 'custom-module',
            action: 'custom-module/custom-action',
        });
    });
});

describe('ZentaoV1Client initialization', () => {
    test('constructs correct base URL and removes trailing slashes', () => {
        const client1 = new ZentaoV1Client('https://zentao.example.com', 'session123');
        expect(client1.serverUrl).toBe('https://zentao.example.com');
        expect(client1.baseUrl).toBe('https://zentao.example.com/index.php');

        const client2 = new ZentaoV1Client('https://zentao.example.com///', 'session123');
        expect(client2.serverUrl).toBe('https://zentao.example.com');
        expect(client2.baseUrl).toBe('https://zentao.example.com/index.php');
    });

    test('accepts serverConfig in constructor options', async () => {
        const customConfig: ServerConfig = {
            version: '18.0',
            requestType: 'PATH_INFO',
            requestFix: '-',
            sessionVar: 'zentaosid',
        };
        const client = new ZentaoV1Client('https://zentao.example.com', 'session123', {
            serverConfig: customConfig,
        });
        const config = await client.getServerConfig();
        expect(config).toEqual(customConfig);
    });
});

describe('ZentaoV1Client HTTP & functionality', () => {
    function createMockServer(handler: (req: Request) => Response | Promise<Response>) {
        return Bun.serve({
            port: 0,
            fetch: handler,
        });
    }

    test('getServerConfig fetches config if not cached', async () => {
        let fetchCount = 0;
        const serverConfig: ServerConfig = {
            version: '18.0',
            requestType: 'GET',
            requestFix: '-',
            sessionVar: 'sid',
        };

        const server = createMockServer((req) => {
            const url = new URL(req.url);
            if (url.searchParams.get('mode') === 'getconfig') {
                fetchCount++;
                return Response.json(serverConfig);
            }
            return new Response('Not Found', { status: 404 });
        });

        try {
            const client = new ZentaoV1Client(server.url.toString(), 'sess123');
            const config1 = await client.getServerConfig();
            expect(config1).toEqual(serverConfig);
            expect(fetchCount).toBe(1);

            // should use cache for the second call
            const config2 = await client.getServerConfig();
            expect(config2).toEqual(serverConfig);
            expect(fetchCount).toBe(1);
        } finally {
            server.stop();
        }
    });

    test('getServerConfig throws ZentaoError when request fails', async () => {
        const server = createMockServer(() => {
            return new Response('Error', { status: 500 });
        });

        try {
            const client = new ZentaoV1Client(server.url.toString(), 'sess123');
            await expect(client.getServerConfig()).rejects.toThrow(ZentaoError);
        } finally {
            server.stop();
        }
    });

    test('buildUrl - GET mode', async () => {
        let receivedUrl: string | undefined;
        const server = createMockServer((req) => {
            receivedUrl = req.url;
            return Response.json({
                status: 'success',
                data: JSON.stringify({ status: 'success', value: 42 })
            });
        });

        const serverConfig: ServerConfig = {
            version: '18.0',
            requestType: 'GET',
            requestFix: '-',
            sessionVar: 'zentaosid',
        };

        try {
            const client = new ZentaoV1Client(server.url.toString(), 'session123', {
                serverConfig,
            });
            const result = await client.get('/bugs/123', { foo: 'bar' });
            expect(result).toEqual({ status: 'success', value: 42 });

            const parsedUrl = new URL(receivedUrl!);
            expect(parsedUrl.pathname).toBe('/index.php');
            expect(parsedUrl.searchParams.get('m')).toBe('bug');
            expect(parsedUrl.searchParams.get('f')).toBe('view');
            expect(parsedUrl.searchParams.get('t')).toBe('json');
            expect(parsedUrl.searchParams.get('id')).toBe('123');
            expect(parsedUrl.searchParams.get('foo')).toBe('bar');
            expect(parsedUrl.searchParams.get('zentaosid')).toBe('session123');
        } finally {
            server.stop();
        }
    });

    test('buildUrl - PATH_INFO mode with dash fix', async () => {
        let receivedUrl: string | undefined;
        const server = createMockServer((req) => {
            receivedUrl = req.url;
            return Response.json({
                status: 'success',
                data: JSON.stringify({ status: 'success' })
            });
        });

        const serverConfig: ServerConfig = {
            version: '18.0',
            requestType: 'PATH_INFO',
            requestFix: '-',
            sessionVar: 'zentaosid',
        };

        try {
            const client = new ZentaoV1Client(server.url.toString(), 'session123', {
                serverConfig,
            });
            await client.get('/bugs/123', { foo: 'bar' });

            const parsedUrl = new URL(receivedUrl!);
            // path should end with /bug-view-123.json
            expect(parsedUrl.pathname).toEndWith('/bug-view-123.json');
            expect(parsedUrl.searchParams.get('zentaosid')).toBe('session123');
            expect(parsedUrl.searchParams.get('foo')).toBe('bar');
            expect(parsedUrl.searchParams.has('id')).toBe(false); // id was moved to path
        } finally {
            server.stop();
        }
    });

    test('buildUrl - PATH_INFO mode with slash fix', async () => {
        let receivedUrl: string | undefined;
        const server = createMockServer((req) => {
            receivedUrl = req.url;
            return Response.json({
                status: 'success',
                data: JSON.stringify({ status: 'success' })
            });
        });

        const serverConfig: ServerConfig = {
            version: '18.0',
            requestType: 'PATH_INFO',
            requestFix: '/',
            sessionVar: 'zentaosid',
        };

        try {
            const client = new ZentaoV1Client(server.url.toString(), 'session123', {
                serverConfig,
            });
            await client.get('/bugs/123');

            const parsedUrl = new URL(receivedUrl!);
            expect(parsedUrl.pathname).toEndWith('/bug/view/123.json');
        } finally {
            server.stop();
        }
    });

    test('POST request with x-www-form-urlencoded body mapping', async () => {
        let receivedHeaders: Headers | undefined;
        let receivedBody: string | undefined;
        const server = createMockServer(async (req) => {
            receivedHeaders = req.headers;
            receivedBody = await req.text();
            return Response.json({
                status: 'success',
                data: JSON.stringify({ status: 'success' })
            });
        });

        const serverConfig: ServerConfig = {
            version: '18.0',
            requestType: 'GET',
            sessionVar: 'zentaosid',
        };

        try {
            const client = new ZentaoV1Client(server.url.toString(), 'session123', {
                serverConfig,
            });
            await client.post('/bugs', {
                title: 'Test bug',
                priority: 3,
                empty: null,
                ignored: undefined,
                nested: { a: 1 }
            });

            expect(receivedHeaders?.get('Content-Type')).toBe('application/x-www-form-urlencoded');
            const searchParams = new URLSearchParams(receivedBody);
            expect(searchParams.get('title')).toBe('Test bug');
            expect(searchParams.get('priority')).toBe('3');
            expect(searchParams.get('nested')).toBe(JSON.stringify({ a: 1 }));
            expect(searchParams.has('empty')).toBe(false);
            expect(searchParams.has('ignored')).toBe(false);
        } finally {
            server.stop();
        }
    });

    test('throws error if sessionId is empty', async () => {
        const client = new ZentaoV1Client('https://zentao.example.com', '');
        await expect(client.get('/bugs')).rejects.toThrow(
            new ZentaoError('E1004')
        );
    });

    test('setSessionId updates session ID', async () => {
        let receivedUrl: string | undefined;
        const server = createMockServer((req) => {
            receivedUrl = req.url;
            return Response.json({
                status: 'success',
                data: JSON.stringify({ status: 'success' })
            });
        });

        const serverConfig: ServerConfig = {
            version: '18.0',
            requestType: 'GET',
            sessionVar: 'zentaosid',
        };

        try {
            const client = new ZentaoV1Client(server.url.toString(), 'session123', {
                serverConfig,
            });
            client.setSessionId('session456');
            await client.get('/bugs');

            const parsedUrl = new URL(receivedUrl!);
            expect(parsedUrl.searchParams.get('zentaosid')).toBe('session456');
        } finally {
            server.stop();
        }
    });

    test('HTTP error codes mapping', async () => {
        const handlers = [
            { status: 401, expectedCode: '1004' },
            { status: 403, expectedCode: '2006' },
            { status: 500, expectedCode: '2008' },
        ];

        for (const handler of handlers) {
            const server = createMockServer(() => {
                return new Response('Error text', { status: handler.status });
            });

            try {
                const client = new ZentaoV1Client(server.url.toString(), 'sess123', {
                    serverConfig: { version: '18.0', requestType: 'GET' }
                });
                await expect(client.get('/bugs')).rejects.toThrow(
                    expect.objectContaining({ code: handler.expectedCode })
                );
            } finally {
                server.stop();
            }
        }
    });

    test('throws E2008 when response fails parsing or has fail status', async () => {
        const badResponses = [
            Response.json({ status: 'fail', data: 'Some error' }),
            new Response('Plain text not JSON', { status: 200 }),
            Response.json({ status: 'success' }), // missing data key
            Response.json({ status: 'success', data: 'not-json-inside' }), // inner not JSON
        ];

        for (const resp of badResponses) {
            const server = createMockServer(() => resp.clone());
            try {
                const client = new ZentaoV1Client(server.url.toString(), 'sess123', {
                    serverConfig: { version: '18.0', requestType: 'GET' }
                });
                await expect(client.get('/bugs')).rejects.toThrow(
                    expect.objectContaining({ code: '2008' })
                );
            } finally {
                server.stop();
            }
        }
    });

    test('throws E1004 when response is text/html starting with <', async () => {
        const server = createMockServer(() => {
            return new Response('<html><body>Login Page</body></html>', {
                status: 200,
                headers: { 'Content-Type': 'text/html' }
            });
        });
        try {
            const client = new ZentaoV1Client(server.url.toString(), 'sess123', {
                serverConfig: { version: '18.0', requestType: 'GET' }
            });
            await expect(client.get('/bugs')).rejects.toThrow(
                expect.objectContaining({ code: '1004' })
            );
        } finally {
            server.stop();
        }
    });

    test('resolves and formats inner pager data correctly', async () => {
        const pagerData = {
            recTotal: '15',
            recPerPage: '5',
            pageID: '2',
        };
        const server = createMockServer(() => {
            return Response.json({
                status: 'success',
                data: JSON.stringify({
                    status: 'success',
                    pager: pagerData,
                    bugs: []
                })
            });
        });

        try {
            const client = new ZentaoV1Client(server.url.toString(), 'sess123', {
                serverConfig: { version: '18.0', requestType: 'GET' }
            });
            const result = await client.get('/bugs');
            expect(result.status).toBe('success');
            expect((result as any).recTotal).toBe(15);
            expect((result as any).recPerPage).toBe(5);
            expect((result as any).pageID).toBe(2);
        } finally {
            server.stop();
        }
    });

    test('converts object to array for compatible module data', async () => {
        const server = createMockServer(() => {
            return Response.json({
                status: 'success',
                data: JSON.stringify({
                    status: 'success',
                    products: {
                        '1': 'Product One',
                        '2': { name: 'Product Two', desc: 'Second' }
                    },
                    users: {
                        '10': 'User Ten'
                    }
                })
            });
        });

        try {
            const client = new ZentaoV1Client(server.url.toString(), 'sess123', {
                serverConfig: { version: '18.0', requestType: 'GET' }
            });
            const result = await client.get('/products');
            expect(result.status).toBe('success');
            expect((result as any).products).toEqual([
                { id: 1, name: 'Product One' },
                { id: 2, name: 'Product Two', desc: 'Second' }
            ]);
            expect((result as any).users).toEqual([
                { id: 10, name: 'User Ten' }
            ]);
        } finally {
            server.stop();
        }
    });

    test('HTTP methods methods delegation (put/del)', async () => {
        let receivedMethod: string | undefined;
        const server = createMockServer((req) => {
            receivedMethod = req.method;
            return Response.json({
                status: 'success',
                data: JSON.stringify({ status: 'success' })
            });
        });

        try {
            const client = new ZentaoV1Client(server.url.toString(), 'sess123', {
                serverConfig: { version: '18.0', requestType: 'GET' }
            });
            await client.put('/bugs/1', { title: 'New title' });
            expect(receivedMethod).toBe('POST'); // PUT falls back to POST under the hood in request() for non-GET body

            // del uses POST method under the hood due to targetMethod logic in request()
            await client.del('/bugs/1');
            expect(receivedMethod).toBe('POST');
        } finally {
            server.stop();
        }
    });
});
