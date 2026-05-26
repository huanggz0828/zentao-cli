import { describe, expect, test } from 'bun:test';
import type { ZentaoClient } from '../src/api/client';
import { DEFAULT_CONFIG } from '../src/config/defaults';
import { ZentaoError } from '../src/errors';
import { getModule } from '../src/modules';
import { executeModuleCommand, executeResolvedModuleCommand } from '../src/modules/executor';

describe('module executor', () => {
    test('executes list commands and applies shared result processing', async () => {
        const requests: Array<{ method: string; path: string; options: unknown }> = [];
        const client = {
            async request(method: string, path: string, options: unknown) {
                requests.push({ method, path, options });
                return {
                    status: 'success',
                    products: [
                        { id: 1, name: '保留', status: 'active', desc: '<p>Hello</p>' },
                        { id: 2, name: '丢弃', status: 'closed', desc: '<p>Bye</p>' },
                    ],
                    pager: { recTotal: 2, recPerPage: 20, pageID: 1 },
                };
            },
        } as unknown as ZentaoClient;

        const result = await executeModuleCommand(
            client,
            getModule('product')!,
            'list',
            [],
            {
                filter: ['status:active'],
                search: ['保留'],
                pick: 'id,name,desc',
                page: '1',
                recPerPage: '20',
            },
            DEFAULT_CONFIG,
        );

        expect(requests).toEqual([
            {
                method: 'get',
                path: '/products',
                options: {
                    query: {
                        browseType: 'all',
                        orderBy: 'id_asc',
                        recPerPage: '20',
                        pageID: '1',
                    },
                    body: undefined,
                },
            },
        ]);
        expect(result.isList).toBe(true);
        expect(result.fields).toEqual(['id', 'name', 'desc']);
        expect(result.pager).toEqual({ recTotal: 2, recPerPage: 20, pageID: 1 });
        expect(result.data).toEqual([
            { id: 1, name: '保留', desc: 'Hello' },
        ]);
    });

    test('executes get commands and applies object post-processing', async () => {
        const client = {
            async request() {
                return {
                    status: 'success',
                    user: { id: 1, realname: 'Admin', bio: '<p>Hello</p>' },
                };
            },
        } as unknown as ZentaoClient;

        const result = await executeModuleCommand(
            client,
            getModule('user')!,
            'get',
            ['1'],
            { pick: 'id,bio' },
            DEFAULT_CONFIG,
        );

        expect(result.isList).toBe(false);
        expect(result.fields).toEqual(['id', 'bio']);
        expect(result.data).toEqual({ id: 1, bio: 'Hello' });
        expect(result.rawResponse).toEqual({
            status: 'success',
            user: { id: 1, realname: 'Admin', bio: '<p>Hello</p>' },
        });
    });

    test('skips HTML conversion when disabled', async () => {
        const client = {
            async request() {
                return {
                    status: 'success',
                    products: [
                        { id: 1, name: '产品', desc: '<p>Hello</p>' },
                    ],
                };
            },
        } as unknown as ZentaoClient;

        const result = await executeModuleCommand(
            client,
            getModule('product')!,
            'list',
            [],
            { pick: 'id,desc' },
            { ...DEFAULT_CONFIG, htmlToMarkdown: false },
        );

        expect(result.data).toEqual([
            { id: 1, desc: '<p>Hello</p>' },
        ]);
    });

    test('executes write commands and retains raw response', async () => {
        const requests: Array<{ method: string; path: string; options: unknown }> = [];
        const rawResponse = { status: 'success', id: 7, message: 'created' };
        const client = {
            async request(method: string, path: string, options: unknown) {
                requests.push({ method, path, options });
                return rawResponse;
            },
        } as unknown as ZentaoClient;

        const result = await executeModuleCommand(
            client,
            getModule('user')!,
            'create',
            [],
            {
                account: 'dev1',
                realname: 'Dev One',
                password: 'secret',
            } as any,
            DEFAULT_CONFIG,
        );

        expect(requests).toEqual([
            {
                method: 'post',
                path: '/users',
                options: {
                    query: {},
                    body: {
                        account: 'dev1',
                        realname: 'Dev One',
                        password: 'secret',
                    },
                },
            },
        ]);
        expect(result.data).toEqual(rawResponse);
        expect(result.rawResponse).toEqual(rawResponse);
    });

    test('throws when required write parameters are missing', async () => {
        const client = {
            async request() {
                throw new Error('should not request');
            },
        } as unknown as ZentaoClient;

        expect(executeModuleCommand(
            client,
            getModule('user')!,
            'create',
            [],
            { account: 'dev1', realname: 'Dev One' } as any,
            DEFAULT_CONFIG,
        )).rejects.toThrow('必须提供参数值');
    });

    test('update auto-fills missing fields from current object', async () => {
        const requests: Array<{ method: string; path: string; options: unknown }> = [];
        const client = {
            async request(method: string, path: string, options: unknown) {
                requests.push({ method, path, options });
                if (method === 'get') {
                    return {
                        status: 'success',
                        user: {
                            id: 1,
                            account: 'admin',
                            realname: 'Admin',
                            dept: { id: 5, name: 'IT' },
                            email: 'admin@example.com',
                            group: ['1', '2'],
                            mobile: '13800000000',
                        },
                    };
                }
                return { status: 'success', id: 1 };
            },
        } as unknown as ZentaoClient;

        await executeModuleCommand(
            client,
            getModule('user')!,
            'update',
            ['1'],
            { email: 'new@example.com' } as any,
            DEFAULT_CONFIG,
        );

        expect(requests).toHaveLength(2);
        expect(requests[0]).toEqual({
            method: 'get',
            path: '/users/1',
            options: {},
        });
        expect(requests[1]).toEqual({
            method: 'put',
            path: '/users/1',
            options: {
                query: {},
                body: {
                    realname: 'Admin',
                    dept: 5,
                    email: 'new@example.com',
                    group: ['1', '2'],
                    mobile: '13800000000',
                },
            },
        });
    });

    test('update keeps user-supplied values and strips undefined fields', async () => {
        const requests: Array<{ method: string; path: string; options: unknown }> = [];
        const client = {
            async request(method: string, path: string, options: unknown) {
                requests.push({ method, path, options });
                if (method === 'get') {
                    return {
                        status: 'success',
                        user: { id: 1, realname: 'Old' },
                    };
                }
                return { status: 'success' };
            },
        } as unknown as ZentaoClient;

        await executeModuleCommand(
            client,
            getModule('user')!,
            'update',
            ['1'],
            { realname: 'New', dept: '12' } as any,
            DEFAULT_CONFIG,
        );

        const putReq = requests.find((r) => r.method === 'put')!;
        expect(putReq.options).toEqual({
            query: {},
            body: { realname: 'New', dept: 12 },
        });
    });

    test('update skips GET when all schema fields are provided', async () => {
        const requests: Array<{ method: string; path: string }> = [];
        const client = {
            async request(method: string, path: string) {
                requests.push({ method, path });
                return { status: 'success' };
            },
        } as unknown as ZentaoClient;

        await executeModuleCommand(
            client,
            getModule('user')!,
            'update',
            ['1'],
            {
                realname: 'Full',
                dept: '1',
                join: '2026-01-01',
                group: '1,2',
                email: 'full@example.com',
                visions: 'rnd',
                mobile: '13800000000',
                weixin: 'wx',
                password: 'secret',
            } as any,
            DEFAULT_CONFIG,
        );

        expect(requests).toEqual([{ method: 'put', path: '/users/1' }]);
    });

    test('update preserves current values instead of schema defaults', async () => {
        const requests: Array<{ method: string; path: string; options: unknown }> = [];
        const client = {
            async request(method: string, path: string, options: unknown) {
                requests.push({ method, path, options });
                if (method === 'get') {
                    return {
                        status: 'success',
                        product: {
                            id: 1,
                            name: 'Old Product',
                            program: 0,
                            line: 0,
                            type: 'normal',
                            acl: 'private',
                        },
                    };
                }
                return { status: 'success' };
            },
        } as unknown as ZentaoClient;

        await executeModuleCommand(
            client,
            getModule('product')!,
            'update',
            ['1'],
            { name: 'New Product' } as any,
            DEFAULT_CONFIG,
        );

        const putReq = requests.find((r) => r.method === 'put')!;
        expect(putReq.options).toEqual({
            query: {},
            body: {
                name: 'New Product',
                program: 0,
                line: 0,
                type: 'normal',
                acl: 'private',
            },
        });
    });

    test('update auto-fill ignores null values extracted from objects', async () => {
        const requests: Array<{ method: string; path: string; options: unknown }> = [];
        const client = {
            async request(method: string, path: string, options: unknown) {
                requests.push({ method, path, options });
                if (method === 'get') {
                    return {
                        status: 'success',
                        user: {
                            realname: 'Old',
                            dept: { id: null },
                            manager: { id: null },
                        },
                    };
                }
                return { status: 'success' };
            },
        } as unknown as ZentaoClient;

        await executeResolvedModuleCommand(
            client,
            {
                module: 'user',
                action: {
                    name: 'update',
                    type: 'update',
                    method: 'put',
                    path: '/users/:userID',
                    requestBody: {
                        schema: {
                            type: 'object',
                            properties: {
                                realname: { type: 'string' },
                                dept: { type: 'integer' },
                                manager: { type: 'string' },
                            },
                        },
                    },
                    resultType: 'object',
                },
                params: {},
                path: '/users/1',
                query: {},
                data: { realname: 'New' },
                id: 1,
            },
            {},
            DEFAULT_CONFIG,
        );

        expect(requests[1]).toEqual({
            method: 'put',
            path: '/users/1',
            options: {
                query: {},
                body: { realname: 'New' },
            },
        });
    });

    test('update auto-fill drops numeric arrays with invalid items', async () => {
        const requests: Array<{ method: string; path: string; options: unknown }> = [];
        const client = {
            async request(method: string, path: string, options: unknown) {
                requests.push({ method, path, options });
                if (method === 'get') {
                    return {
                        status: 'success',
                        user: {
                            realname: 'Old',
                            validIds: ['1', '2'],
                            invalidIds: ['1', 'bad'],
                        },
                    };
                }
                return { status: 'success' };
            },
        } as unknown as ZentaoClient;

        await executeResolvedModuleCommand(
            client,
            {
                module: 'user',
                action: {
                    name: 'update',
                    type: 'update',
                    method: 'put',
                    path: '/users/:userID',
                    requestBody: {
                        schema: {
                            type: 'object',
                            properties: {
                                realname: { type: 'string' },
                                validIds: { type: 'array', items: { type: 'integer' } },
                                invalidIds: { type: 'array', items: { type: 'integer' } },
                            },
                        },
                    },
                    resultType: 'object',
                },
                params: {},
                path: '/users/1',
                query: {},
                data: { realname: 'New' },
                id: 1,
            },
            {},
            DEFAULT_CONFIG,
        );

        expect(requests[1]).toEqual({
            method: 'put',
            path: '/users/1',
            options: {
                query: {},
                body: { realname: 'New', validIds: [1, 2] },
            },
        });
    });

    test('update throws E2009 when required field still missing after GET', async () => {
        const client = {
            async request(method: string) {
                if (method === 'get') {
                    return { status: 'success', user: { realname: 'Old' } };
                }
                return { status: 'success' };
            },
        } as unknown as ZentaoClient;

        await expect(executeResolvedModuleCommand(
            client,
            {
                module: 'user',
                action: {
                    name: 'update',
                    type: 'update',
                    method: 'put',
                    path: '/users/:userID',
                    requestBody: {
                        schema: {
                            type: 'object',
                            required: ['dept'],
                            properties: {
                                realname: { type: 'string' },
                                dept: { type: 'integer' },
                            },
                        },
                    },
                    resultType: 'object',
                },
                params: {},
                path: '/users/1',
                query: {},
                data: { realname: 'New' },
                id: 1,
            },
            {},
            DEFAULT_CONFIG,
        )).rejects.toThrow('必须提供参数值');
    });

    test('update rethrows non-not-found GET errors instead of swallowing', async () => {
        const client = {
            async request(method: string) {
                if (method === 'get') {
                    throw new ZentaoError('E1004');
                }
                return { status: 'success' };
            },
        } as unknown as ZentaoClient;

        await expect(executeModuleCommand(
            client,
            getModule('user')!,
            'update',
            ['1'],
            { realname: 'New' } as any,
            DEFAULT_CONFIG,
        )).rejects.toThrow();
    });

    test('non-update operations do not trigger auto-fill GET', async () => {
        const requests: Array<{ method: string }> = [];
        const client = {
            async request(method: string) {
                requests.push({ method });
                return { status: 'success', id: 99 };
            },
        } as unknown as ZentaoClient;

        await executeModuleCommand(
            client,
            getModule('user')!,
            'create',
            [],
            {
                realname: 'New',
                dept: '1',
                join: '2026-01-01',
                group: '1',
                email: 'a@b.c',
                visions: 'rnd',
                mobile: '13800000000',
                weixin: 'wx',
                password: 'secret',
                account: 'new',
            } as any,
            DEFAULT_CONFIG,
        );

        expect(requests.every((r) => r.method !== 'get')).toBe(true);
    });

    test('update short-circuits when command has no id', async () => {
        const requests: Array<{ method: string }> = [];
        const client = {
            async request(method: string) {
                requests.push({ method });
                return { status: 'success' };
            },
        } as unknown as ZentaoClient;

        await executeResolvedModuleCommand(
            client,
            {
                module: 'user',
                action: {
                    name: 'update',
                    type: 'update',
                    method: 'put',
                    path: '/users/:userID',
                    requestBody: {
                        schema: {
                            type: 'object',
                            properties: {
                                realname: { type: 'string' },
                            },
                        },
                    },
                    resultType: 'object',
                },
                params: {},
                path: '/users/0',
                query: {},
                data: { realname: 'New' },
                id: undefined,
            },
            {},
            DEFAULT_CONFIG,
        );

        expect(requests.every((r) => r.method !== 'get')).toBe(true);
    });
});
