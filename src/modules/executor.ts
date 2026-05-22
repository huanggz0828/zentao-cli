import type { ZentaoClient } from '../api/client.js';
import type {
    ListPagerInfo,
    ModuleActionName,
    ModuleActionOptions,
    ModuleDefinition,
    ResolvedModuleCommand,
    UserConfig,
} from '../types/index.js';
import { filterData, pickFields, pickFieldsSingle, searchData, sortData } from '../utils/data.js';
import { convertHtmlFields, convertHtmlFieldsInArray } from '../utils/html.js';
import { extractPager, extractResult, resolveModuleCommand } from './resolver.js';
import { getCurrentProfile } from '../config/store.js';

export interface ModuleExecutionResult {
    command: ResolvedModuleCommand;
    data: unknown;
    rawResponse: Record<string, unknown>;
    pager?: ListPagerInfo;
    fields?: string[];
    isList: boolean;
}

function parseFields(fields?: string): string[] | undefined {
    const parsed = fields?.split(',').map((field) => field.trim()).filter(Boolean);
    return parsed && parsed.length > 0 ? parsed : undefined;
}

export async function executeModuleCommand(
    client: ZentaoClient,
    module: ModuleDefinition,
    actionName: ModuleActionName,
    args: string[],
    options: ModuleActionOptions,
    config: UserConfig,
): Promise<ModuleExecutionResult> {
    const command = resolveModuleCommand(module, actionName, options, args);
    return executeResolvedModuleCommand(client, command, options, config);
}

export async function executeResolvedModuleCommand(
    client: ZentaoClient,
    command: ResolvedModuleCommand,
    options: ModuleActionOptions,
    config: UserConfig,
): Promise<ModuleExecutionResult> {
    const rawResponse = await client.request(command.action.method, command.path, {
        query: command.query,
        body: command.data,
    }) as Record<string, unknown>;
    const fields = parseFields(options.pick);

    if (command.action.type === 'list') {
        let data = extractResult(command.action, rawResponse) as Record<string, unknown>[];
        const pager = extractPager(command.action, rawResponse);

        if (config.htmlToMarkdown !== false) {
            data = convertHtmlFieldsInArray(data);
        }
        
        // 针对禅道 v1 API 的 browseType 兼容处理：由于 v1 接口通常不支持在服务端通过 browseType 过滤，我们在客户端进行模拟过滤
        const isV1 = !!(client as any).v1Client || client.baseUrl.endsWith('/api.php/v1') || client.baseUrl.endsWith('/index.php');
        if (isV1 && command.module === 'bug' && command.action.name === 'list') {
            const browseType = command.query?.browseType ?? 'unclosed';
            if (browseType !== 'all') {
                if (browseType === 'unclosed') {
                    data = data.filter((item) => item.status !== 'closed');
                } else if (browseType === 'assignedtome' || browseType === 'openedbyme') {
                    const profile = getCurrentProfile();
                    const account = profile?.account;
                    if (account) {
                        if (browseType === 'assignedtome') {
                            data = data.filter((item) => String(item.assignedTo ?? '') === account);
                        } else if (browseType === 'openedbyme') {
                            data = data.filter((item) => String(item.openedBy ?? '') === account);
                        }
                    }
                }
            }
        }

        if (options.filter?.length) {
            data = filterData(data, options.filter);
        }
        if (options.search?.length) {
            data = searchData(data, options.search, options.searchFields?.split(','));
        }
        if (options.sort) {
            data = sortData(data, options.sort);
        }
        if (options.limit && Number(options.limit) < data.length) {
            data = data.slice(0, Number(options.limit));
        }
        if (fields) {
            data = pickFields(data, fields);
        }

        return { command, data, rawResponse, pager, fields, isList: true };
    }

    if (command.action.type === 'get') {
        let data = (extractResult(command.action, rawResponse) ?? rawResponse) as Record<string, unknown>;
        if (config.htmlToMarkdown !== false) {
            data = convertHtmlFields(data);
        }
        if (fields) {
            data = pickFieldsSingle(data, fields);
        }

        return { command, data, rawResponse, fields, isList: false };
    }

    const data = extractResult(command.action, rawResponse);
    return { command, data, rawResponse, fields, isList: false };
}
