# Zentao CLI 二次开发更新日志 (Changelog)

为了解决官方原版 `zentao-cli` 只支持禅道 v2.0 RESTful API，导致很多使用旧版禅道（如未开启 v2 接口）的团队无法使用的问题，我们对该工具进行了深度二次开发。以下是本次二次开发所做的修改及与官方原版的对比。

---

## 1. 核心改进与特性

### 1.1 禅道 v1.0 API 协议兼容 (API v1.0 Compatibility)
* **官方原版**：仅支持 `/api.php/v2` 接口及对应的 Token 校验，无法访问旧版禅道或未开启 v2 接口的服务器。
* **二次开发**：
  * 在登录命令中增加了 `--v1` 参数，同时在用户配置（Profile）中扩展了 `apiVersion: 'v1'` 配置项。
  * **两级降级登录探测机制**：对于 v1 协议，首先尝试使用较新的 RESTful v1 (`/api.php/v1/tokens`) 进行登录；如果服务器不支持，则自动降级为传统会话机制，通过多种路由模式探测（如 `index.php?m=api&f=getSessionID` 或 `/api-getsessionid.json`）取得 `zentaosid`，并使用 SessionID 降级完成传统 JSON-RPC 登录。
  * **动态路由翻译**：新增了 [ZentaoV1Client](file:///c:/ICTNJ/zentao-cli-workspace/zentao-cli/src/api/v1-client.ts)，能够自动将上层业务发起的 v2 RESTful 路径（例如 `/bugs`, `/users` 等）拦截并动态翻译为 v1 对应的接口参数（例如 `module=bug`, `method=browse` 等），无需修改上层业务命令代码。

### 1.2 Bug 列表的客户端兜底过滤与 `browseType` 支持
* **官方原版**：不支持客户端对 `browseType`（如“指派给我”、“我开启的”等）进行过滤，只依赖服务端的 v2 过滤字段。
* **二次开发**：
  * 在 [register-modules.ts](file:///c:/ICTNJ/zentao-cli-workspace/zentao-cli/src/commands/register-modules.ts) 注册了全局的 `--browseType` 命令行选项。
  * 在 [executor.ts](file:///c:/ICTNJ/zentao-cli-workspace/zentao-cli/src/modules/executor.ts) 中，当客户端处于 v1 接口模式时，对 `bug` 列表查询执行客户端兜底过滤，实现了对 `assignedtome`（指派给我）、`unclosed`（未关闭）、`openedbyme`（我开启的）三种常用浏览类型的模拟过滤。

### 1.3 数据筛选器增强 (Filter Operators Enhanced)
* **官方原版**：`--filter` 筛选表达式只支持 `:` 运算符（例如 `--filter status:active`）。
* **二次开发**：在 [data.ts](file:///c:/ICTNJ/zentao-cli-workspace/zentao-cli/src/utils/data.ts) 中扩展了 `=` 关系运算符（支持如 `--filter status=active`），提供更加符合日常使用直觉的语法规则。

### 1.4 富文本图片直接访问与分析规范
* **官方原版**：导出的 Markdown 文件中，禅道的富文本图片均呈现为服务器端的内部大括号占位符（如 `![]({3329.png})`）或相对路径（如 `![](/file-read-3334.png)`）。
* **二次开发及调整**：
  * **删除冗余的下载脚本**：经测试，禅道中的富文本图片如 `![](/file-read-3334.png)` 或 `![]({3334.png})`，均可直接通过拼接禅道服务地址 `ZENTAO_URL` 组成完整 URL（如 `http://192.168.208.11:8080/file-read-3334.png`）直接访问或下载。因此废弃并删除了此前新增的冗余本地图片下载脚本 `download-images.ts` 和 `test-download.ts`。
  * **强化图片分析规范**：在新创的 Bug 修复指导技能 [zentao-bug-fixing/SKILL.md](file:///c:/ICTNJ/zentao-cli-workspace/zentao-cli/skills/zentao-bug-fixing/SKILL.md) 中明确规定，AI 在排查和修复 Bug 的过程中，**绝对不能仅看 Bug 的文字描述，必须主动分析其中包含的图片**，通过拼接得到的 URL 获取并分析图片内容（如报错截图、日志等），以保证 Bug 修复的准确性。

---

## 2. 修改文件列表及改动内容说明

| 修改/新增文件 | 类型 | 改动说明 |
| :--- | :--- | :--- |
| [package.json](file:///c:/ICTNJ/zentao-cli-workspace/zentao-cli/package.json) | 修改 | 引入并注册了 `turndown` HTML 转换库类型定义，更新版本为适配版。 |
| [src/api/client.ts](file:///c:/ICTNJ/zentao-cli-workspace/zentao-cli/src/api/client.ts) | 修改 | `ZentaoClient` 构造函数适配 `apiVersion: 'v1'`，若指定则桥接至 `ZentaoV1Client` 实例；路由刷新与配置获取同步路由至 v1 处理器。 |
| [src/api/v1-client.ts](file:///c:/ICTNJ/zentao-cli-workspace/zentao-cli/src/api/v1-client.ts) | **新增** | 实现 v1 版 API 客户端逻辑。提供 `translateV2PathToV1` 动态映射翻译引擎，以及 Session 和 URL 参数的拼接机制。 |
| [src/auth/flow.ts](file:///c:/ICTNJ/zentao-cli-workspace/zentao-cli/src/auth/flow.ts) | 修改 | 扩展凭证鉴权工作流。支持在环境变量检测、Token 检测和密码检测逻辑中传递并存留 `apiVersion`、`sessionId`，并兼容其保存到 Profile 中。 |
| [src/auth/login.ts](file:///c:/ICTNJ/zentao-cli-workspace/zentao-cli/src/auth/login.ts) | 修改 | 密码登录主入口方法改造，若指定 `apiVersion === 'v1'` 则分流至 `v1Login` 实现。 |
| [src/auth/v1-login.ts](file:///c:/ICTNJ/zentao-cli-workspace/zentao-cli/src/auth/v1-login.ts) | **新增** | 编写 v1 版的登录与多重降级探测逻辑，负责获取 `zentaosid` 以及校验密码身份。 |
| [src/commands/login.ts](file:///c:/ICTNJ/zentao-cli-workspace/zentao-cli/src/commands/login.ts) | 修改 | 登录命令行增加 `--v1` 选选项，支持在登录时手动指定使用 v1 API 协议登录旧版禅道。 |
| [src/commands/register-modules.ts](file:///c:/ICTNJ/zentao-cli-workspace/zentao-cli/src/commands/register-modules.ts) | 修改 | 为数据列表操作注册全局 `--browseType` 命令行选项参数支持。 |
| [src/config/defaults.ts](file:///c:/ICTNJ/zentao-cli-workspace/zentao-cli/src/config/defaults.ts) | 修改 | 在默认用户配置 `DEFAULT_CONFIG` 中默认增加 `apiVersion: 'v1'`。 |
| [src/config/store.ts](file:///c:/ICTNJ/zentao-cli-workspace/zentao-cli/src/config/store.ts) | 修改 | `buildProfile` 辅助函数扩展，支持在合并配置和构建用户 Profile 时保留并记录 `apiVersion` 和 `sessionId`。 |
| [src/modules/executor.ts](file:///c:/ICTNJ/zentao-cli-workspace/zentao-cli/src/modules/executor.ts) | 修改 | 在执行命令拦截点上，对 v1 客户端列表 Bug 的动作注入客户端级别 `browseType`（指派给我/我开启/未关闭）过滤器。 |
| [src/types/commands.ts](file:///c:/ICTNJ/zentao-cli-workspace/zentao-cli/src/types/commands.ts) | 修改 | `ModuleActionOptions` 接口增加可选的 `browseType` 字段定义。 |
| [src/types/config.ts](file:///c:/ICTNJ/zentao-cli-workspace/zentao-cli/src/types/config.ts) | 修改 | `Profile` 接口增加 `sessionId`，`UserConfig` 接口增加 `apiVersion` 属性类型定义。 |
| [src/utils/data.ts](file:///c:/ICTNJ/zentao-cli-workspace/zentao-cli/src/utils/data.ts) | 修改 | 扩展内置筛选器支持 `=` 操作符，增强过滤条件的通用性。 |
| [scripts/download-images.ts](file:///c:/ICTNJ/zentao-cli-workspace/zentao-cli/scripts/download-images.ts) | **删除** | （已废弃并删除）原批量图片下载与 Markdown 链接相对化重写脚本，改为直接通过 URL 访问。 |
| [scripts/test-download.ts](file:///c:/ICTNJ/zentao-cli-workspace/zentao-cli/scripts/test-download.ts) | **删除** | （已废弃并删除）原大括号附件/图片下载地址兼容性测试探测脚本。 |
| [skills/zentao-bug-fixing/SKILL.md](file:///c:/ICTNJ/zentao-cli-workspace/zentao-cli/skills/zentao-bug-fixing/SKILL.md) | **新增** | 新增禅道 Bug 排查与修复指导技能，包含富文本图片强制分析与解决 Bug 流程。 |
