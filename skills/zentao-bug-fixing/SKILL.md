---
name: zentao-bug-fixing
description: 禅道 Bug 排查与修复指导。包含通过 zentao-cli 进行 Bug 筛选、查看详情、富文本图片拼接下载与强制分析规范，以及解决 Bug 并完成状态流转的开发工作流。
license: MIT
metadata:
  author: Huang GuanZhong
  repository: https://github.com/huanggz0828/zentao-cli
  keywords: [zentao, 禅道, bug, resolve, debug, image-analysis]
  version: 0.1.0
---

# 禅道 Bug 排查与修复指导

本技能用于指导 AI 代理或开发人员如何高效、准确地处理禅道（ZenTao）中的 Bug。包含从 Bug 认领与查看、富文本图片的拼接访问与下载分析，到 Bug 的状态流转与解决的完整规范流程。

## 1. 查看、指派与认领 Bug

在处理 Bug 之前，首先需要获取指派给当前账号且处于激活（`active`）状态的 Bug 列表。

```bash
# 查看指派给我的活跃 Bug 列表
zentao bug --product=<产品ID> --filter='assignedTo:<当前账号>,status:active' --pick=id,title,severity,pri
```

根据列表，选择需要优先处理的 Bug，并获取其详细信息以进行排查：

```bash
# 查看具体 Bug 的详情和复现步骤
zentao bug <id>
```

在排查后，如果发现此 Bug 不属于当前账号的工作范围，或者需要转交他人（例如需要另一个开发、测试或项目经理协同），可以执行指派操作：

```bash
# 将 Bug 指派给其他人（例如指派给账号 testuser）
zentao bug update <id> --assignedTo=testuser
```

同理，若要认领其他人的 Bug 或者将未分配的 Bug 重新指派给自己：

```bash
# 将 Bug 指派/重新指派给自己
zentao bug update <id> --assignedTo=<当前账号>
```

---

## 2. 富文本图片获取与分析规范（强制性要求）

在禅道的数据（例如 Bug 描述、步骤、需求描述等）中，可能包含图片链接，通常形式为 `![](/file-read-3334.png)` 或 `![]({3334.png})` 等。图片中往往包含关键的报错信息、异常 UI 表现、控制台日志或特定重现步骤截图。

为了确保 Bug 修复的准确性，在排查和修复过程中必须遵循以下规范：

### 2.1 严禁仅看文字描述
在排查、修改和修复 Bug 的过程中，AI **绝对不能只查看 Bug 的文字描述**，极易漏掉核心线索或产生误判。

### 2.2 必须分析图片
如果 Bug 描述、复现步骤或附件中包含任何图片链接，AI **必须主动获取该图片并对图片内容进行深度分析**。

### 2.3 图片地址拼接与下载方法
- 禅道中的图片可以直接通过拼接禅道服务地址 `ZENTAO_URL` 加上图片相对路径来访问或下载。
- 比如图片 `![](/file-read-3334.png)` 或 `![]({3334.png})`，若配置的禅道服务地址 `ZENTAO_URL` 为 `http://192.168.208.11:8080`，则该图片的完整访问或下载链接为 `http://192.168.208.11:8080/file-read-3334.png`（其中 `{3334.png}` 大括号格式也可翻译为 `/file-read-3334.png`）。
- 若 AI 需要下载图片到本地以进行查看和分析，可以使用 `curl` 等命令行工具直接下载，例如：
  ```bash
  curl -o local_image.png http://192.168.208.11:8080/file-read-3334.png
  ```
  下载完成后，使用 `view_file` 工具查看并分析下载的图片。

---

## 3. 解决与流转 Bug

在定位到 Bug 的根源并完成代码修改后，需要通过 `resolve` 操作来将 Bug 推送至“已解决”状态：

```bash
# 解决 Bug，默认标记为已解决（fixed）
zentao bug resolve <id> --resolution=fixed
```

除了 `fixed`（已解决）之外，还应该根据实际排查情况，选择最适合的 `resolution` 解决方案参数：

| `resolution` 选项 | 含义 | 适用场景 |
|-------------------|------|---------|
| `fixed` | 已解决 | 成功修复了代码或配置问题 |
| `duplicate` | 重复 Bug | 该 Bug 与其他已提交的 Bug 重复 |
| `external` | 外部原因 | 非本系统代码问题，如第三方服务异常或外部依赖故障 |
| `bydesign` | 设计如此 | 系统表现符合既定需求或设计方案 |
| `notrepro` | 无法重现 | 尝试后无法复现 Bug，通常需要向测试人员进一步确认 |
| `postponed` | 延期处理 | 暂时不影响核心流程，计划延期至后续迭代解决 |
| `willnotfix` | 不予解决 | 经沟通，此 Bug 不需要或不值得被修复 |

### 4. 流程与回顾

完成 Bug 解决动作后，该 Bug 会流转至解决状态（`resolved`），后续将由测试人员确认是否关闭（`closed`）或重新激活（`active`）。

**关键回顾**：
真实工作和 Bug 修复中，必须确保：
1. **结合图片分析**（确保没有遗漏任何截图线索）；
2. **定位准确修复**（编写健壮、可维护的代码）；
3. **状态及解决原因准确流转**（将 `resolution` 字段写准，有助于后续的项目统计和质量报表生成）。
