import { ZentaoClient } from '../api/client.js';
import type { LoginResponse, ApiResponse, ServerConfig } from '../types/index.js';
import { ZentaoError } from '../errors.js';
import { v1Login } from './v1-login.js';

/** 密码登录成功后的结果 */
export interface LoginResult {
    token: string;
    user?: Record<string, unknown>;
    serverConfig?: ServerConfig;
    sessionId?: string;
    apiVersion?: 'v1' | 'v2';
}

/** 从环境变量读取的凭证片段（任一字段可能缺失） */
export interface EnvCredentials {
    url?: string;
    account?: string;
    password?: string;
    token?: string;
}

/**
 * 使用账号密码调用 `/users/login` 获取 Token，并尽力拉取当前账号的用户详情。
 * 用户列表拉取失败不视为致命错误（Token 仍然有效）。
 */
export async function login(
    serverUrl: string,
    account: string,
    password: string,
    options?: { insecure?: boolean; timeout?: number; apiVersion?: 'v1' | 'v2' },
): Promise<LoginResult> {
    if (options?.apiVersion !== 'v2') {
        const v1Result = await v1Login(serverUrl, account, password, options);
        const tokenVal = v1Result.token ?? v1Result.sessionId ?? '';
        const client = new ZentaoClient(serverUrl, tokenVal, {
            ...options,
            apiVersion: 'v1',
            sessionId: v1Result.sessionId,
            serverConfig: v1Result.serverConfig
        });
        let user: Record<string, unknown> | undefined = v1Result.user;
        let serverConfig: ServerConfig | undefined = v1Result.serverConfig;
        try {
            const fetchedConfig = await client.getServerConfig();
            serverConfig = { ...serverConfig, ...fetchedConfig };
            if (!user) {
                const usersResp = await client.get<ApiResponse>('/users', { browseType: 'inside', recPerPage: 100 });
                const users = usersResp.users as Array<Record<string, unknown>> | undefined;
                user = users?.find((u) => u.account === account);
            }
        } catch (error) {
            // Ignore
        }
        return {
            token: tokenVal,
            sessionId: v1Result.sessionId,
            user,
            serverConfig,
            apiVersion: 'v1',
        };
    }

    const url = serverUrl.replace(/\/+$/, '');
    const baseUrl = `${url}/api.php/v2`;

    const controller = new AbortController();
    const timeout = options?.timeout ?? 10000;
    const timer = setTimeout(() => controller.abort(), timeout);

    if (options?.insecure) {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }

    try {
        const response = await fetch(`${baseUrl}/users/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ account, password }),
            signal: controller.signal,
        });
        clearTimeout(timer);

        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                throw new ZentaoError('E1003');
            }
            throw new ZentaoError('E1002', { url });
        }

        const data = await response.json() as LoginResponse;
        if (data.status !== 'success' || !data.token) {
            throw new ZentaoError('E1003');
        }

        const client = new ZentaoClient(url, data.token, options);
        let user: Record<string, unknown> | undefined;
        let serverConfig: ServerConfig | undefined;
        try {
            serverConfig = await client.getServerConfig();
            const usersResp = await client.get<ApiResponse>('/users', { browseType: 'inside', recPerPage: 100 });
            const users = usersResp.users as Array<Record<string, unknown>> | undefined;
            user = users?.find((u) => u.account === account);
        } catch(error) {
            // Token valid but couldn't fetch user details - not fatal
        }

        return { token: data.token, user, serverConfig, apiVersion: 'v2' };
    } catch (error) {
        clearTimeout(timer);
        if (error instanceof ZentaoError) throw error;
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new ZentaoError('E5001');
        }
        const msg = (error as Error).message ?? '';
        if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('fetch failed')) {
            throw new ZentaoError('E1002', { url });
        }
        throw error;
    } finally {
        if (options?.insecure) {
            delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        }
    }
}

/** 读取 `ZENTAO_URL` / `ZENTAO_ACCOUNT` / `ZENTAO_PASSWORD` / `ZENTAO_TOKEN` */
export function getEnvCredentials(): EnvCredentials {
    return {
        url: process.env.ZENTAO_URL,
        account: process.env.ZENTAO_ACCOUNT,
        password: process.env.ZENTAO_PASSWORD,
        token: process.env.ZENTAO_TOKEN,
    };
}
