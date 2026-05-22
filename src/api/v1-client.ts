import { ZentaoError } from '../errors.js';
import type { ApiResponse, RequestOptions, ServerConfig } from '../types/index.js';

/**
 * 自动将 v2 接口路径翻译为 v1 接口参数
 */
export interface V1ActionConfig {
    module: string;
    action: string;
    id?: number;
    assocParams?: Record<string, string | number>;
}

export function translateV2PathToV1(method: string, path: string): V1ActionConfig {
    const cleanPath = path.replace(/^\/+|\/+$/g, '');
    const parts = cleanPath.split('/');

    const pluralToSingular: Record<string, string> = {
        users: 'user',
        bugs: 'bug',
        products: 'product',
        projects: 'project',
        executions: 'execution',
        tasks: 'task',
        stories: 'story',
        programs: 'program',
    };

    const firstPart = parts[0] || '';
    const module = pluralToSingular[firstPart] || firstPart;

    const v1ActionMap: Record<string, Record<string, string>> = {
        product: { list: 'browse', get: 'view', create: 'create', update: 'edit' },
        bug: { list: 'browse', get: 'view', create: 'create', update: 'edit', resolve: 'resolve', close: 'close', activate: 'activate' },
        story: { list: 'browse', get: 'view', create: 'create', update: 'edit' },
        task: { list: 'browse', get: 'view', create: 'create', update: 'edit' },
        project: { list: 'browse', get: 'view', create: 'create', update: 'edit' },
        user: { list: 'getUserList', get: 'view', create: 'create', update: 'edit' },
        execution: { list: 'browse', get: 'view', create: 'create', update: 'edit' },
        program: { list: 'browse', get: 'view', create: 'create', update: 'edit' },
    };

    const getAction = (act: string) => {
        return v1ActionMap[module]?.[act] ?? act;
    };

    const m = method.toUpperCase();

    // 格式 1: /bugs 或者是 /users
    if (parts.length === 1) {
        if (m === 'GET') {
            return { module, action: getAction('list') };
        }
        if (m === 'POST') {
            return { module, action: getAction('create') };
        }
    }

    // 格式 2: /bugs/{id} 或者是 /bugs/123
    if (parts.length === 2) {
        const idPart = parts[1];
        const isId = /^\d+$/.test(idPart) || (idPart.startsWith('{') && idPart.endsWith('}'));
        const id = /^\d+$/.test(idPart) ? Number(idPart) : undefined;

        if (isId) {
            if (m === 'GET') {
                return { module, action: getAction('get'), id };
            }
            if (m === 'PUT' || m === 'POST') {
                return { module, action: getAction('update'), id };
            }
            if (m === 'DELETE') {
                return { module, action: getAction('delete'), id };
            }
        }
    }

    // 格式 3: /bugs/{id}/resolve 或者是 /bugs/123/resolve
    if (parts.length === 3) {
        const idPart = parts[1];
        const isId = /^\d+$/.test(idPart) || (idPart.startsWith('{') && idPart.endsWith('}'));
        const id = /^\d+$/.test(idPart) ? Number(idPart) : undefined;
        const lastPart = parts[2];

        if (isId) {
            return { module, action: getAction(lastPart), id };
        }
    }

    // 格式 4: /products/{productID}/bugs 这种关联查询
    if (parts.length === 3 && pluralToSingular[parts[2]]) {
        const idPart = parts[1];
        const assocId = /^\d+$/.test(idPart) ? Number(idPart) : undefined;
        const subModule = pluralToSingular[parts[2]];
        const assocKey = module + 'ID';

        return {
            module: subModule,
            action: v1ActionMap[subModule]?.list ?? 'browse',
            assocParams: assocId ? { [assocKey]: assocId } : undefined
        };
    }

    // 回退默认值
    return { module, action: cleanPath };
}

export class ZentaoV1Client {
    readonly serverUrl: string;
    readonly baseUrl: string;
    private sessionId: string;
    private timeout: number;
    private insecure: boolean;
    private serverConfig?: ServerConfig;

    constructor(
        serverUrl: string,
        sessionId: string,
        options?: { timeout?: number; insecure?: boolean; serverConfig?: ServerConfig }
    ) {
        this.serverUrl = serverUrl.replace(/\/+$/, '');
        this.baseUrl = `${this.serverUrl}/index.php`;
        this.sessionId = sessionId;
        this.timeout = options?.timeout ?? 10000;
        this.insecure = options?.insecure ?? false;
        this.serverConfig = options?.serverConfig;
    }

    setSessionId(sessionId: string): void {
        this.sessionId = sessionId;
    }

    /**
     * 获取禅道服务端配置
     */
    async getServerConfig(): Promise<ServerConfig> {
        if (this.serverConfig) {
            return this.serverConfig;
        }
        const url = `${this.serverUrl}/?mode=getconfig`;
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
            throw new ZentaoError('E1002', { url });
        }

        this.serverConfig = await response.json() as ServerConfig;
        return this.serverConfig;
    }

    /**
     * 发起 V1 请求，并在内部执行路由翻译与响应解包
     */
    async request<T extends ApiResponse = ApiResponse>(
        method: string,
        path: string,
        options?: RequestOptions
    ): Promise<T> {
        if (!this.sessionId) {
            throw new ZentaoError('E1004');
        }

        // 确保获取了服务器配置（由于需要判断 GET 或 PATH_INFO 路由模式）
        const config = await this.getServerConfig();

        // 翻译路径
        const translation = translateV2PathToV1(method, path);

        // 合并查询参数
        const queryParams = { ...options?.query };
        if (translation.id !== undefined) {
            queryParams.id = translation.id;
        }
        if (translation.assocParams) {
            Object.assign(queryParams, translation.assocParams);
        }

        // 构建请求 URL
        const url = this.buildUrl(translation.module, translation.action, config, queryParams);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options?.timeout ?? this.timeout);

        const headers: Record<string, string> = {};
        let body: string | URLSearchParams | undefined;

        if (options?.body && !['GET', 'HEAD'].includes(method.toUpperCase())) {
            // v1 通常采用 form-urlencoded 提交
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
            const params = new URLSearchParams();
            for (const [key, value] of Object.entries(options.body as Record<string, unknown>)) {
                if (value === undefined || value === null) continue;
                params.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
            }
            body = params;
        }

        const targetMethod = ['GET', 'HEAD'].includes(method.toUpperCase()) ? method.toUpperCase() : 'POST';
        const fetchOptions: globalThis.RequestInit = {
            method: targetMethod,
            headers,
            signal: controller.signal,
        };
        if (body) {
            fetchOptions.body = body;
        }


        if (this.insecure) {
            process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
        }

        try {
            const response = await fetch(url, fetchOptions);
            clearTimeout(timer);

            if (!response.ok) {
                if (response.status === 401) throw new ZentaoError('E1004');
                if (response.status === 403) throw new ZentaoError('E2006');
                throw new ZentaoError('E2008', { url: response.url, status: String(response.status) });
            }

            const responseText = await response.text();
            let outerData: { status: string; data?: string; md5?: string };
            try {
                outerData = JSON.parse(responseText);
            } catch {
                const contentType = response.headers.get('content-type') ?? '';
                if (contentType.includes('text/html') || responseText.trim().startsWith('<')) {
                    throw new ZentaoError('E1004');
                }
                throw new ZentaoError('E2008', { url: response.url, status: String(response.status), serverResponse: responseText });
            }

            if (outerData.status === 'fail') {
                throw new ZentaoError('E2008', { url: response.url, status: String(response.status), serverResponse: JSON.stringify(outerData.data || outerData) });
            }

            if (outerData.data === undefined) {
                throw new ZentaoError('E2008', { url: response.url, status: String(response.status), serverResponse: responseText });
            }

            let innerData: any;
            try {
                innerData = JSON.parse(outerData.data);
            } catch {
                throw new ZentaoError('E2008', { url: response.url, status: String(response.status), serverResponse: outerData.data });
            }

            // 对分页信息和响应状态做兼容，使得与 v2 外层结构一致
            if (innerData && typeof innerData === 'object') {
                if (!('status' in innerData)) {
                    innerData.status = 'success';
                }
                // 如果含有 pager，将分页属性提取到最顶层供 v2 的 extractPager 读取
                if (innerData.pager && typeof innerData.pager === 'object') {
                    const pagerObj = innerData.pager;
                    if ('recTotal' in pagerObj) innerData.recTotal = Number(pagerObj.recTotal);
                    if ('recPerPage' in pagerObj) innerData.recPerPage = Number(pagerObj.recPerPage);
                    if ('pageID' in pagerObj) innerData.pageID = Number(pagerObj.pageID);
                }
            }

            return innerData as T;
        } catch (error) {
            clearTimeout(timer);
            if (error instanceof ZentaoError) throw error;
            if (error instanceof DOMException && error.name === 'AbortError') {
                throw new ZentaoError('E5001');
            }
            const msg = (error as Error).message ?? '';
            if (msg.includes('SSL') || msg.includes('TLS') || msg.includes('certificate')) {
                throw new ZentaoError('E5002');
            }
            if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('fetch failed')) {
                throw new ZentaoError('E1002', { url });
            }
            throw error;
        } finally {
            if (this.insecure) {
                delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
            }
        }
    }

    async get<T extends ApiResponse = ApiResponse>(path: string, query?: Record<string, string | number>): Promise<T> {
        return this.request<T>('GET', path, { query });
    }

    async post<T extends ApiResponse = ApiResponse>(path: string, body?: unknown): Promise<T> {
        return this.request<T>('POST', path, { body });
    }

    async put<T extends ApiResponse = ApiResponse>(path: string, body?: unknown): Promise<T> {
        return this.request<T>('PUT', path, { body });
    }

    async del<T extends ApiResponse = ApiResponse>(path: string): Promise<T> {
        return this.request<T>('DELETE', path);
    }

    private buildUrl(
        module: string,
        action: string,
        config: ServerConfig,
        query?: Record<string, any>
    ): string {
        const reqType = config.requestType || 'GET';
        const reqFix = config.requestFix || '-';
        const sessionVar = config.sessionVar || 'zentaosid';

        const params = new URLSearchParams();
        params.set(sessionVar, this.sessionId);
        if (query) {
            for (const [k, v] of Object.entries(query)) {
                if (v !== undefined && v !== null) {
                    params.set(k, String(v));
                }
            }
        }

        if (reqType === 'PATH_INFO') {
            // PATH_INFO 模式
            const id = params.get('id');
            if (id !== null) {
                params.delete('id');
            }

            let path = id !== null
                ? `${module}${reqFix}${action}${reqFix}${id}.json`
                : `${module}${reqFix}${action}.json`;

            if (reqFix === '/') {
                path = id !== null
                    ? `${module}/${action}/${id}.json`
                    : `${module}/${action}.json`;
            }

            const queryStr = params.toString();
            return queryStr ? `${this.serverUrl}/${path}?${queryStr}` : `${this.serverUrl}/${path}`;
        } else {
            // GET 模式
            params.set('m', module);
            params.set('f', action);
            params.set('t', 'json');
            return `${this.serverUrl}/index.php?${params.toString()}`;
        }
    }
}
