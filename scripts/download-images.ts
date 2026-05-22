import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { getCurrentProfile } from '../src/config/store.js';

async function downloadImage(server: string, fileId: string, destPath: string, token?: string, sessionId?: string): Promise<boolean> {
    const urls = [
        {
            url: `${server.replace(/\/+$/, '')}/file-read-${fileId}.html`,
            headers: {}
        },
        {
            url: `${server.replace(/\/+$/, '')}/index.php?m=file&f=read&fileID=${fileId}${sessionId ? `&zentaosid=${sessionId}` : ''}`,
            headers: {}
        },
        {
            url: `${server.replace(/\/+$/, '')}/api.php/v2/files/${fileId}/download`,
            headers: token ? { 'Token': token } : {}
        }
    ];

    for (const item of urls) {
        try {
            const res = await fetch(item.url, {
                method: 'GET',
                headers: item.headers,
                redirect: 'follow'
            });

            if (res.ok) {
                const contentType = res.headers.get('content-type') || '';
                if (contentType.includes('image') || contentType.includes('application/octet-stream')) {
                    const arrayBuffer = await res.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);
                    writeFileSync(destPath, buffer);
                    return true;
                }
            }
        } catch (err: any) {
            // 继续尝试下一个 url
        }
    }
    return false;
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0) {
        console.log('用法: npx tsx scripts/download-images.ts <markdown文件路径>');
        console.log('示例: npx tsx scripts/download-images.ts bugs.md');
        return;
    }

    const mdPath = resolve(args[0]);
    if (!existsSync(mdPath)) {
        console.error(`错误: 文件不存在 -> ${mdPath}`);
        process.exit(1);
    }

    const profile = getCurrentProfile();
    if (!profile) {
        console.error('错误: 未找到当前登录的禅道配置，请先登录。');
        process.exit(1);
    }

    const server = profile.server;
    const token = profile.token;
    const sessionId = profile.sessionId;

    console.log(`正在读取 Markdown 文件: ${mdPath}`);
    let content = readFileSync(mdPath, 'utf8');

    // 匹配如 ![]({3329.png}) 的占位符
    const regex = /!\[(.*?)\]\(\{(\d+)\.(png|jpg|jpeg|gif)\}\)/g;
    const matches: { full: string; alt: string; id: string; ext: string }[] = [];
    let match;

    while ((match = regex.exec(content)) !== null) {
        matches.push({
            full: match[0],
            alt: match[1],
            id: match[2],
            ext: match[3]
        });
    }

    if (matches.length === 0) {
        console.log('未在 Markdown 中找到图片占位符（格式如 ![]({3329.png})）。');
        return;
    }

    console.log(`共找到 ${matches.length} 个图片占位符。`);

    // 在 markdown 同级目录下创建 images 目录
    const mdDir = dirname(mdPath);
    const imagesDir = join(mdDir, 'images');
    if (!existsSync(imagesDir)) {
        mkdirSync(imagesDir, { recursive: true });
    }

    let successCount = 0;
    for (const item of matches) {
        const fileName = `${item.id}.${item.ext}`;
        const destPath = join(imagesDir, fileName);
        const relPath = `images/${fileName}`;

        console.log(`正在下载图片 ${item.id} -> ${relPath} ...`);
        const success = await downloadImage(server, item.id, destPath, token, sessionId);

        if (success) {
            console.log(`  [成功] 已保存至 ${destPath}`);
            // 替换 markdown 里的占位符
            content = content.replace(item.full, `![${item.alt}](${relPath})`);
            successCount++;
        } else {
            console.error(`  [失败] 无法下载图片 ${item.id}`);
        }
    }

    writeFileSync(mdPath, content, 'utf8');
    console.log(`\n处理完成！共成功下载并替换了 ${successCount}/${matches.length} 张图片。`);
    console.log(`已修改 Markdown 文件: ${mdPath}`);
}

main().catch(console.error);
