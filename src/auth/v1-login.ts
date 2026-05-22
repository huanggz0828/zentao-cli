import { ZentaoError } from '../errors.js';
import type { ServerConfig } from '../types/index.js';

export interface V1SessionResult {
    sessionId: string;
    serverConfig: ServerConfig;
}

export interface V1LoginResult {
    sessionId?: string;
    token?: string;
    user?: Record<string, unknown>;
    serverConfig?: ServerConfig;
}

/**
 * v1 获取 sessionID。依次尝试探测 GET 和 PATH_INFO 等常见路由模式。
 */
export async function getV1SessionId(
    serverUrl: string,
    options?: { insecure?: boolean; timeout?: number }
): Promise<V1SessionResult> {
    const baseUrl = serverUrl.replace(/\/+$/, '');
    const detectList = [
        {
            url: `${baseUrl}/index.php?m=api&f=getSessionID&t=json`,
            requestType: 'GET',
            requestFix: '-'
        },
        {
            url: `${baseUrl}/api-getsessionid.json`,
            requestType: 'PATH_INFO',
            requestFix: '-'
        },
        {
            url: `${baseUrl}/api-getSessionID.json`,
            requestType: 'PATH_INFO',
            requestFix: '-'
        },
        {
            url: `${baseUrl}/api/getSessionID.json`,
            requestType: 'PATH_INFO',
            requestFix: '/'
        },
        {
            url: `${baseUrl}/api/getsessionid.json`,
            requestType: 'PATH_INFO',
            requestFix: '/'
        }
    ];

    if (options?.insecure) {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }

    let lastError: any = null;

    try {
        for (const item of detectList) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), options?.timeout ?? 10000);

            try {
                const response = await fetch(item.url, { signal: controller.signal });
                clearTimeout(timer);

                if (!response.ok) {
                    continue;
                }

                const responseText = await response.text();
                let data: { status: string; data: string };
                try {
                    data = JSON.parse(responseText);
                } catch {
                    lastError = new ZentaoError('E2008', { url: item.url, status: String(response.status), serverResponse: responseText.slice(0, 500) });
                    continue;
                }

                if (data.status !== 'success' || !data.data) {
                    continue;
                }

                const innerData = JSON.parse(data.data) as { sessionID: string };
                const sessionId = innerData.sessionID;
                if (!sessionId) {
                    continue;
                }

                const serverConfig: ServerConfig = {
                    version: '',
                    systemMode: '',
                    sprintConcept: '',
                    requestType: item.requestType,
                    requestFix: item.requestFix,
                    moduleVar: 'm',
                    methodVar: 'f',
                    viewVar: 't',
                    sessionVar: 'zentaosid',
                };

                return { sessionId, serverConfig };
            } catch (error) {
                clearTimeout(timer);
                lastError = error;
            }
        }
    } finally {
        if (options?.insecure) {
            delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        }
    }

    if (lastError instanceof ZentaoError) {
        throw lastError;
    }
    const fallbackUrl = `${baseUrl}/index.php?m=api&f=getSessionID&t=json`;
    if (lastError && (lastError as Error).name === 'AbortError') {
        throw new ZentaoError('E5001');
    }
    const msg = lastError ? String((lastError as Error).message ?? lastError) : '';
    if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('fetch failed')) {
        throw new ZentaoError('E1002', { url: fallbackUrl });
    }
    throw new ZentaoError('E2008', { url: fallbackUrl, status: 'Unknown', serverResponse: msg || 'All session detection URLs failed' });
}

/**
 * v1 用户登录流程
 */
export async function v1Login(
    serverUrl: string,
    account: string,
    password: string,
    options?: { insecure?: boolean; timeout?: number }
): Promise<V1LoginResult> {
    const baseUrl = serverUrl.replace(/\/+$/, '');
    const restfulV1Url = `${baseUrl}/api.php/v1/tokens`;

    if (options?.insecure) {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }

    // 优先尝试 RESTful API v1 (api.php/v1/tokens) 登录获取 token
    try {
        throw new Error("Force session login");
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options?.timeout ?? 10000);
        const response = await fetch(restfulV1Url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ account, password }),
            signal: controller.signal,
        });
        clearTimeout(timer);

        if (response.ok) {
            const responseText = await response.text();
            let data: { token?: string; status?: string; message?: string } | undefined;
            try {
                data = JSON.parse(responseText);
            } catch {
                // ignore
            }
            if (data && data.token) {
                return { token: data.token };
            }
            if (data && data.status === 'fail') {
                throw new ZentaoError('E1003');
            }
        } else if (response.status === 401 || response.status === 403) {
            throw new ZentaoError('E1003');
        }
    } catch (error) {
        if (error instanceof ZentaoError) throw error;
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new ZentaoError('E5001');
        }
        // 其他错误（如 404）表示不支持该接口，落入下方的传统 session 模式降级
    }

    try {
        const { sessionId, serverConfig } = await getV1SessionId(serverUrl, options);

        let loginUrl: string;
        const baseUrl = serverUrl.replace(/\/+$/, '');
        if (serverConfig.requestType === 'PATH_INFO') {
            loginUrl = `${baseUrl}/user${serverConfig.requestFix}login.json?${serverConfig.sessionVar}=${sessionId}`;
        } else {
            loginUrl = `${baseUrl}/index.php?m=user&f=login&t=json&${serverConfig.sessionVar}=${sessionId}`;
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options?.timeout ?? 10000);

        const response = await fetch(loginUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ account, password }),
            signal: controller.signal,
        });
        clearTimeout(timer);

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                throw new ZentaoError('E1003');
            }
            throw new ZentaoError('E1002', { url: loginUrl });
        }

        const responseText = await response.text();
        let data: { status: string; user?: Record<string, unknown> };
        try {
            data = JSON.parse(responseText);
        } catch {
            throw new ZentaoError('E2008', { url: loginUrl, status: String(response.status), serverResponse: responseText.slice(0, 500) });
        }

        if (data.status !== 'success') {
            throw new ZentaoError('E1003');
        }

        return { sessionId, user: data.user, serverConfig };
    } catch (error) {
        if (error instanceof ZentaoError) throw error;
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new ZentaoError('E5001');
        }
        const msg = (error as Error).message ?? '';
        if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('fetch failed')) {
            throw new ZentaoError('E1002', { url: serverUrl });
        }
        throw error;
    } finally {
        if (options?.insecure) {
            delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        }
    }
}
