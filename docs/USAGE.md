# dsh-work-habits 使用文档

> 本文是 [README.md](../README.md) 的详细展开版。README 是概览，本文逐项说明安装、设置页、数据文件、
> 配置、HTTP 接口、排错与卸载。**文中所有事实均取自本目录源码**（`index.js` / `client.js` /
> `package.json` / `cordis.patch.yml`），并标注了源码行号；HTTP 部分附本机实测输出。

---

## 目录

| # | 部分 |
|---|---|
| 1 | [这是什么 / 解决什么问题](#1-这是什么--解决什么问题) |
| 2 | [安装](#2-安装) |
| 3 | [设置页逐项说明](#3-设置页逐项说明) |
| 4 | [规则怎么进 system prompt](#4-规则怎么进-system-prompt) |
| 5 | [数据文件](#5-数据文件) |
| 6 | [配置项](#6-配置项) |
| 7 | [HTTP 接口](#7-http-接口) |
| 8 | [首次播种的 16 条规则（全文）](#8-首次播种的-16-条规则全文) |
| 9 | [常见问题 / 排错](#9-常见问题--排错) |
| 10 | [卸载](#10-卸载) |
| 11 | [开发 / 结构说明](#11-开发--结构说明) |

---

## 1. 这是什么 / 解决什么问题

**一句话：把你自己的工作习惯写成一串规则，注入每个会话的 system prompt，让 agent 按你本来的方式
解读需求、执行和交付。**

不装这个插件时，agent 的默认行为是「不确定就问」和「面面俱到地汇报」——这两条与实际习惯相反。
装上之后，agent 会：

- 把「继续」「都看」「不修」这类极短输入当成**完整指令**，直接执行，不反问、不复述确认；
- 用户只给「操作 → 现象」时，自己找根因，而不是把用户的因果猜测当结论；
- 交付时只报可核查的事实（精确数字、绝对路径、行号、命令与实际输出）。

插件由两个半区组成：

| 半区 | 文件 | 职责 |
|---|---|---|
| 宿主半区 | `index.js` | 持有习惯状态、持久化到磁盘、暴露 HTTP 路由、把状态渲染成 system prompt 的一个 section |
| 浏览器半区 | `client.js` | 在「设置 → 侧边栏」注册一页，读写这些数据（`settings.section`，id `work-habits`，order 30） |

两者之间的唯一通道是 HTTP 路由 `/work-habits/state`（`index.js:39`、`client.js:23`）。

---

## 2. 安装

### 2.1 安装命令

```
plugin_manager install_bundle target=D:\ai aegit\deepseek\dsh-work-habits
```

安装后宿主行由 `cordis.patch.yml` 的 `insert` 提供，浏览器半区由 `package.json` 的 `dsh.client`
声明加载（`package.json:24-35`）。

### 2.2 ⚠️ 装完必须重启一次 DSH 宿主

**实测结论：安装完成后要重启一次 DSH 宿主进程，设置面板左侧才会出现「工作习惯」那一页。
只刷新浏览器页面不够。**

原因是宿主对客户端模块的扫描是**增量**的，而且「这个包不是客户端包」这个**否定结论会被缓存到
进程重启**——热装那一刻的扫描结果里，本包被判为「非客户端模块」，这个否定结论会一直留在缓存里，
所以那一行会**永久漏掉**，不会因为等待或刷新页面而补上。

> 备注：README.md 第 119 行写的是「装完需要刷新一次页面」。按实测，刷新页面**不足以**让页面出现，
> 必须重启宿主。以本文为准。

重启后确认路径：

1. 打开 DSH Web GUI（端口见浏览器地址栏）；
2. 进入**设置**；
3. 左侧导航应出现一项**工作习惯**（英文界面为 `Work habits`）。

### 2.3 安装前检查

| 检查项 | 命令 / 位置 | 期望 |
|---|---|---|
| 包能被识别为 bundle | `package.json` 的 `dsh.bundle.patch` | `./cordis.patch.yml` |
| 浏览器半区声明存在 | `package.json` 的 `dsh.client` | `platform: web`、`immediately: true`、`inject: ['@deepseek-ai/dsh-client-ui-slots']` |
| 宿主行 id | `cordis.patch.yml` | `id: work-habits`、`name: 'dsh-work-habits'`、`config: {}` |
| 已装 bundle 列表 | `plugin_manager` 的 `list_bundles` | 能看到本 bundle |

---

## 3. 设置页逐项说明

页面文案自带一份字典，**不经过客户端 locale 服务**：语言按 `navigator.language` 是否以 `zh` 开头
选择，缺键回落中文（`client.js:71-82`）。因此中文系统上所有控件都是中文。

页面顶部固定一行说明（`client.js:33`）：

> 这些规则会注入每个会话的 system prompt。改动自动保存。

### 3.1 控件一览（点了会怎样）

| 控件 | 界面文字 | 位置 | 点击/编辑后的行为 |
|---|---|---|---|
| 总开关 | 启用（关掉后不再注入） | 页面顶部 | 勾选框。切换后写入 `enabled`；**关掉是注销 system prompt section，不是渲染空文本**（见第 4 节） |
| 逐条开关 | 无文字，每行左侧勾选框 | 每条规则左侧 | 切换该条的 `on`。关掉的条目**内容保留**，只是不进 prompt；输入框透明度降到 0.55 作为视觉提示 |
| 规则文本框 | 占位符「写一条规则…」 | 每条规则中间 | 多行文本框（`rows: 2`，可纵向拉伸）。编辑即触发保存，**400ms 防抖后自动提交** |
| 上移 | ↑ | 每条规则右侧 | 与**同一分组内**的上一条交换位置；该分组第一条时按钮禁用 |
| 下移 | ↓ | 每条规则右侧 | 与**同一分组内**的下一条交换位置；该分组最后一条时按钮禁用 |
| 删除 | ×（红色） | 每条规则右侧 | 从状态里按 `id` 删除该条，立即保存 |
| 添加 | `+ 添加一条到「xxx」` | 每个分组底部 | 在该分组末尾插入一条空规则（`{id: 本地 id, text: '', on: true, group}`），立即保存 |
| 补充约束 | 补充约束（追加在末尾） | 页面底部 | 多行文本框（`rows: 3`）。内容写入 `extra`，**渲染时追加在整个 section 正文的最后** |
| 保存状态行 | 已保存 / 保存中… / 保存失败：原因 | 页面最底部 | 只读。绿色=已保存，灰色=保存中，红色=失败并附原因 |
| 数据文件行 | `数据文件: <绝对路径>` | 状态行下方 | 只读。路径来自 `GET /work-habits/state` 返回的 `file` 字段；`file` 为空时不显示 |
| 重试 | 重试 | 载入失败时 | 首次载入失败（`!data`）时页面只剩错误行 + 「重试」按钮，点击重新 `GET` |

### 3.2 保存机制

- 每次改动都是**整份状态**回传：`commit()` 先做一次浅拷贝，改完把整份对象 `POST` 给宿主
  （`client.js:201-212`）。
- `POST` 被 **400ms 防抖**合并：连续敲字只在停手 400ms 后发一次请求（`client.js:174-198`）。
- 状态行含义：
  - `载入中…`：首次 `GET` 还没回来；
  - `保存中…`：已排入防抖队列或请求在飞；
  - `已保存`：最近一次 `GET`/`POST` 成功；
  - `保存失败: <原因>`：请求失败或宿主返回 `ok !== true`，原因取自 `error.message`。
- 空文本条目：新点「添加」产生的空行，在宿主端 `normalizeState` 里会被**直接丢弃**
  （`index.js:167-168`），所以刷新页面后空行消失，这是预期行为。

### 3.3 分组与顺序

- 分组顺序即 `state.groups` 的顺序，默认 `解读输入` → `执行` → `交付`（`index.js:54`）。
- 页面按分组依次渲染：分组标题 → 该组规则 → 该组「+ 添加」按钮。
- 某分组为空时显示「这个分组还没有规则」。
- 上移/下移**只在本分组内**生效，跨分组不换位（`client.js:270-281`）。
- 渲染进 prompt 时也按分组顺序输出，但**顺序取的是 `state.habits` 数组顺序**（见第 4 节）。

---

## 4. 规则怎么进 system prompt

### 4.1 注册方式

宿主半区通过 `ctx.inject(['systemPrompt'], ...)` 注册一个 section（`index.js:312-347`）：

| 属性 | 值 | 来源 |
|---|---|---|
| `name` | `work-habits:profile` | `index.js:27` |
| `order` | `650`（可由 config `order` 覆写） | `index.js:36` |
| `interpolate` | `false` | `index.js:328` |
| `text` | `() => renderHabits(store.state)` | `index.js:329` |

- `order: 650` 落在 `TEAM_POLICY=600` 与 `PTC_ONLY=800` 之间。源码注释里列出的相邻档位：
  `HARNESS_IDENTITY=-1000`、`DEPLOYMENT_PERSONA_PREFIX=0`、`PLAN_POLICY=500`、`TEAM_POLICY=600`、
  `PTC_ONLY=800`、`FILE_REFERENCE=900`、`TOOL_*=1000+`（`index.js:30-35`）。
  选 650 的意图：作为「怎么解读用户」的框架性策略，排在具体工具说明之前被读到。
- `interpolate: false`：正文里含反引号和用户原话，关掉 `{{...}}` 插值以免误伤。
- `text` 是**惰性函数**：宿主每次需要正文时才会调用它，所以改文本 / 切逐条开关**不需要重建 section**，
  下次取正文就是新的。

### 4.2 总开关关闭时是「注销 section」

`sync()` 里维护一个 `lastEnabled` 守卫（`index.js:316-331`）：

1. 若 `store.state.enabled` 与上次相同 → 直接返回，不做任何事；
2. 若不同：先 `disposeSection()` 注销旧 section，再判断——`enabled === false` 时**直接返回，不注册**；
3. `enabled === true` 时重新 `systemPrompt.section({...})`。

所以总开关关闭的效果是**这个 section 根本不存在**，而不是存在但正文为空。再次打开会重新注册
（先注销再注册，避免同名重复注册抛错；`index.js:26` 注释说明同名重复注册会在同一层抛错）。

### 4.3 正文渲染规则（`renderHabits`）

固定开头三行（`index.js:253-257`）：

```
## 用户工作习惯（按此解读需求与交付）

本用户的输入极短、口语化、常带错别字。以下规则优先于默认的澄清与汇报习惯。
```

之后按 `state.groups` 的顺序逐组输出：

- 只取 `on === true` 且 `group` 等于该组的条目；
- 该组一条都没有 → **整组跳过**（连 `### 组名` 标题都不输出）；
- 有条目 → 先空行，再 `### <组名>`，再空行，然后每条一行 `- <text>`；
- 最后：`extra.trim()` 非空时，追加一个空行 + `extra` 原文（**不做任何前缀或标题包装**）。

真实渲染结果示例（总开关开、16 条全开、`extra` 为空时，正文形如）：

```
## 用户工作习惯（按此解读需求与交付）

本用户的输入极短、口语化、常带错别字。以下规则优先于默认的澄清与汇报习惯。

### 解读输入

- 极短命令式（「继续」「都看」「不修」「启动服务器」）本身就是完整指令：直接执行，不反问、不复述确认。
- 「继续」= 接着推进既定的未完成工作，不重新确认方向、不重开话题。
（……其余 7 条……）

### 执行

- 「你自己想办法」「我只要实现」= 不提方案让用户挑，直接实现到能用。
（……其余 2 条……）

### 交付

- 产出物写入用户指定的绝对路径；未指定时沿用本项目既有目录，不新建平行目录。
（……其余 3 条……）
```

### 4.4 生效时机

- 磁盘与内存态在保存成功的瞬间就是新的；
- 但**已经组装好的 system prompt 不会回溯更新**。若改动后没看到效果，先确认保存状态行是
  「已保存」，然后**新开一个会话**再确认。

---

## 5. 数据文件

### 5.1 路径

默认路径由 `resolveStorePath` 决定（`index.js:127-131`）：

1. 若 config `storePath` 非空 → 用它（绝对路径）；
2. 否则取环境变量 `DSH_HOME`；
3. `DSH_HOME` 为空 → `join(homedir(), '.dsh')`；
4. 文件名固定 `work-habits.json`（`index.js:42`）。

即默认 `$DSH_HOME/work-habits.json`；本机实测为 `C:\Users\momol\.dsh\work-habits.json`。
设置页底部显示的正是这个实际路径。

### 5.2 结构

```
{
  enabled: boolean,                     // 总开关
  extra:   string,                      // 补充约束，渲染在正文末尾
  groups:  string[],                    // 非空数组，顺序即渲染顺序
  habits:  Array<{ id, text, on, group }>
}
```

`id` 为非空字符串（缺失或空串时宿主补 `randomUUID()`），`text` 为去首尾空白后的字符串，
`on` 为 boolean（缺省视为 `true`），`group` 必须命中 `groups` 里的某一项。

### 5.3 真实 JSON 示例

`persist()` 写盘的格式是 `JSON.stringify(state, null, 2) + '\n'`（`index.js:215`），
即两空格缩进、末尾一个换行。示例（为省篇幅只列 4 条，实际首次播种 16 条）：

```json
{
  "enabled": true,
  "extra": "",
  "groups": [
    "解读输入",
    "执行",
    "交付"
  ],
  "habits": [
    {
      "id": "ef126c65-8f72-4bf5-b3f9-69518b0efb05",
      "text": "极短命令式（「继续」「都看」「不修」「启动服务器」）本身就是完整指令：直接执行，不反问、不复述确认。",
      "on": true,
      "group": "解读输入"
    },
    {
      "id": "a3eeedc2-6ae9-4e58-82ac-11bc452d4bc8",
      "text": "「继续」= 接着推进既定的未完成工作，不重新确认方向、不重开话题。",
      "on": true,
      "group": "解读输入"
    },
    {
      "id": "c24ba492-a63d-4d3d-b759-17183f7bd7f6",
      "text": "用户明确说出的「不做什么」是硬边界，优先级高于「要做什么」。",
      "on": true,
      "group": "执行"
    },
    {
      "id": "2d0a9f27-ef12-4bed-894e-40dff10b50ed",
      "text": "只报可核查的事实：精确数字、绝对路径、行号、命令与实际输出；未验证项独立成节，不写「应该没问题」。",
      "on": false,
      "group": "交付"
    }
  ]
}
```

上面第 4 条 `on: false` 用来演示「逐条关闭」：它在文件里保留，但不会进 prompt。

### 5.4 写入方式与限制

| 项 | 行为 | 来源 |
|---|---|---|
| 原子写入 | 先写 `<file>.tmp`，再 `renameSync` 覆盖正式文件，不会留下半截文件 | `index.js:211-217` |
| 目录自动创建 | 写之前 `mkdirSync(dirname(file), { recursive: true })` | `index.js:213` |
| 首次播种立即落盘 | 首次运行播种后立刻 `persist()`，否则每次启动都会重新播种、丢掉顺序 | `index.js:219-224` |
| 启动落盘失败 | 被 `catch {}` 吞掉：内存态照常工作，下次变更时再试 | `index.js:220-224` |
| 文件读不动（非 ENOENT） | **抛错** `dsh-work-habits: 无法读取状态文件 <file>：<msg>`，绝不用默认值盖掉用户数据 | `index.js:195-199` |
| 文件不存在（ENOENT） | 按配置**播种 16 条**（`seedHabits`） | `index.js:200-207` |
| 空文本条目 | 保存时直接丢弃（不报错） | `index.js:167-168` |
| 条数上限 | 500 条（`MAX_HABITS`），超出抛 `state.habits 最多 500 条` | `index.js:48,162` |
| 单条长度上限 | 2000 字（`MAX_HABIT_LENGTH`，`text.length`），超出抛 `state.habits[i].text 超过 2000 字` | `index.js:45,169` |
| 分组兜底 | `group` 不在 `groups` 里 → 归到 `groups[0]` | `index.js:171` |
| `on` 缺省 | 视为 `true`（只有显式 `false` 才是关） | `index.js:175` |
| `id` 缺省 | 生成 `randomUUID()` | `index.js:173` |

### 5.5 常量表

| 常量 | 值 | 来源 |
|---|---|---|
| `SECTION_NAME` | `work-habits:profile` | `index.js:27` |
| `DEFAULT_ORDER` | `650` | `index.js:36` |
| `ROUTE_PREFIX` | `/work-habits`（固定值，不可配置） | `index.js:39` |
| `STORE_FILE` | `work-habits.json` | `index.js:42` |
| `MAX_HABIT_LENGTH` | `2000` | `index.js:45` |
| `MAX_HABITS` | `500` | `index.js:48` |
| `MAX_BODY` | `1 << 20`（1048576 字节 = 1 MiB） | `index.js:51` |
| `DEFAULT_GROUPS` | `['解读输入', '执行', '交付']`（冻结） | `index.js:54` |

---

## 6. 配置项

配置写在宿主行的 `config` 上。本 bundle 的 `cordis.patch.yml` 里 `config: {}` 留空，
调参要在 **profile 的 `cordis.patch.yml`** 里覆写同名 id 的行。

| 键 | 类型 | 默认 | 作用 | 生效时机 |
|---|---|---|---|---|
| `enabled` | boolean | `true` | `false` 时 `apply()` 直接 `return`，**整行不挂载**（不是只关注入） | 每次加载 |
| `order` | number（必须有限） | `650` | system prompt section 的排序位 | 每次加载 |
| `pluginSuffix` | string | `'-zuao'` | 播种时写进「自写插件后缀」那条规则的文本 | **仅首次播种** |
| `internalPrefix` | string | `'_'` | 播种时写进「临时/内部产物前缀」那条规则的文本 | **仅首次播种** |
| `extra` | string | `''` | 补充约束的**初始值** | **仅首次播种** |
| `storePath` | string | `''` | 状态文件绝对路径；留空用 `$DSH_HOME/work-habits.json` | 每次加载（决定读哪个文件） |

### 6.1 校验规则（fail loud）

`resolveConfig`（`index.js:100-124`）的行为：

- `config` 为 `undefined` / `null` → 全用默认值；
- `config` 不是映射（是数组或标量）→ 抛 `dsh-work-habits: config 必须是一个映射（mapping）`；
- **未知键 → 抛错并点名**：
  `dsh-work-habits: 未知的 config 键 "xxx"（可用：enabled, order, pluginSuffix, internalPrefix, extra, storePath）`；
- `enabled` 非 boolean → 抛 `config.enabled 必须是 boolean`；
- `order` 非有限数字 → 抛 `config.order 必须是有限数字`；
- 其余键非 string → 抛 `config.<key> 必须是 string`。

配置错误会让宿主行加载失败（`fail loud`，不静默忽略拼错的键）。

### 6.2 为什么 `pluginSuffix` / `internalPrefix` / `extra` 只在首次播种时生效

`seedHabits(config)` 只在**状态文件不存在**时被调用（`index.js:200-207`）。一旦文件存在，
内容以文件（也就是设置页里编辑过的内容）为准。否则你每次改配置都会覆盖掉界面上编辑过的规则。

### 6.3 profile 覆写示例

在 profile 的 `cordis.patch.yml` 里：

```yaml
- id: work-habits
  name: 'dsh-work-habits'
  config:
    enabled: true
    order: 650
    pluginSuffix: '-zuao'
    internalPrefix: '_'
    extra: ''
    storePath: ''
```

⚠️ **patch 是整行替换 `config`**，所以覆写时要把你想保留的字段**全部写全**——只写 `order`
会让其余字段回到默认值（`pluginSuffix` 等只在首次播种时才有影响，所以主要影响的是 `enabled`、
`order`、`storePath`）。

### 6.4 常见用法

| 需求 | 做法 |
|---|---|
| 临时整体停用注入 | profile 里设 `config.enabled: false`（整行不挂载）；或在设置页关总开关（注销 section） |
| 让规则排在更靠前/靠后 | 改 `order`，例如 `640` 排到 `TEAM_POLICY` 之前 |
| 状态文件放到别处（如随项目走） | `storePath: 'D:\somewhere\work-habits.json'` |
| 首次播种就把自己的约束写进去 | 播种前设 `extra`，或删除状态文件后重启 |

---

## 7. HTTP 接口

设置页就是靠这两个端点读写的；脚本也可以直接用。

### 7.1 路由

宿主用 `webServer.register({ kind: 'prefix', path: '/work-habits', handler })` 注册
（`index.js:350-397`）。前缀固定 `/work-habits`，不做成可配置项。

| 方法 | 路径 | 成功响应 |
|---|---|---|
| `GET` | `/work-habits/state` | `200 {ok:true, value:{enabled, extra, groups, habits[], file}}` |
| `POST` | `/work-habits/state` | `200 {ok:true, value:{...}}`（返回保存后的状态） |
| 其他方法 | `/work-habits/state` | `405 {ok:false, error:{code:'method-not-allowed', message:'不支持 <方法>'}}` |
| 任意方法 | 其他路径 | `404 {ok:false, error:{code:'not-found', message:'未知路径 <path>'}}` |
| 任意方法 | URL 无法解析 | `400 {ok:false, error:{code:'bad-url', message:'无法解析请求 URL'}}` |
| `POST` | 坏 JSON 或坏结构 | `400 {ok:false, error:{code:'invalid-state', message:'<具体原因>'}}` |

响应头固定为 `content-type: application/json; charset=utf-8`、`cache-control: no-store`
（`index.js:270-278`）。

### 7.2 `POST` 的语义

- 请求体是**整份状态**（不是增量 patch）；宿主用 `normalizeState` 归一化后**整体替换**并立即落盘
  （`index.js:383`）。
- **`habits` 是必填数组**：`{}` 会返回 400 `state.habits 必须是数组`（实测见下）。
- `enabled` / `extra` / `groups` 可缺省，分别默认 `true` / `''` / 三个默认分组。
- 空 `text` 的条目会被静默丢弃，所以 `POST` 回来时条目数可能比发出去的少。
- 请求体上限 **1 MiB**（`MAX_BODY = 1 << 20`）。超限时宿主中止读取（`req.destroy()`）并在
  `catch` 里回 `400 invalid-state`、message 为 `请求体过大`（`index.js:281-297, 384-390`）；
  由于连接已被销毁，客户端**可能只看到连接中断而不是 400**。

### 7.3 实测输出（本机，2026-10-18）

```
$ curl.exe -s -o - -w "\nHTTP=%{http_code}\n" http://127.0.0.1:64204/work-habits/nope
{"ok":false,"error":{"code":"not-found","message":"未知路径 /work-habits/nope"}}
HTTP=404

$ curl.exe -s -o - -w "\nHTTP=%{http_code}\n" -X PUT http://127.0.0.1:64204/work-habits/state
{"ok":false,"error":{"code":"method-not-allowed","message":"不支持 PUT"}}
HTTP=405

$ curl.exe -s -o - -w "\nHTTP=%{http_code}\n" -X POST -H "content-type: application/json" --data-binary "{bad json" http://127.0.0.1:64204/work-habits/state
{"ok":false,"error":{"code":"invalid-state","message":"Expected property name or '}' in JSON at position 1 (line 1 column 2)"}}
HTTP=400

$ curl.exe -s -o - -w "\nHTTP=%{http_code}\n" -X POST -H "content-type: application/json" --data-binary "{}" http://127.0.0.1:64204/work-habits/state
{"ok":false,"error":{"code":"invalid-state","message":"state.habits 必须是数组"}}
HTTP=400

$ curl.exe -s http://127.0.0.1:64204/work-habits/state
{"ok":true,"value":{"enabled":true,"extra":"","groups":["解读输入","执行","交付"],"habits":[…16 条…],"file":"C:\\Users\\momol\\.dsh\\work-habits.json"}}
HTTP=200
```

> 端口说明：`64204` 是**本次运行的 DSH Web 端口**，每次启动可能不同。请以浏览器地址栏里的
> 地址为准（设置页与接口同源）。

### 7.4 curl 调用示例

```bash
# 读状态
curl -s http://127.0.0.1:<端口>/work-habits/state

# 写状态（整份覆盖；文件里是 UTF-8 中文 JSON）
curl -s -X POST \
  -H "content-type: application/json" \
  --data-binary @D:\state.json \
  http://127.0.0.1:<端口>/work-habits/state
```

`--data-binary @文件` 不做转义，适合中文 JSON；`-d` 在某些 shell 下会吃掉换行。

### 7.5 PowerShell 调用示例

```powershell
$base = 'http://127.0.0.1:<端口>/work-habits'

# 读状态
$state = Invoke-RestMethod -Uri "$base/state"
$state.value.habits.Count      # 16
$state.value.file              # C:\Users\momol\.dsh\work-habits.json

# 写状态：必须显式按 UTF-8 取字节，否则中文会乱码
$json  = [IO.File]::ReadAllText('D:\state.json', [Text.Encoding]::UTF8)
$bytes = [Text.Encoding]::UTF8.GetBytes($json)
Invoke-RestMethod -Method Post -Uri "$base/state" `
  -ContentType 'application/json; charset=utf-8' -Body $bytes
```

⚠️ 两个编码坑：

- PowerShell 5.1 的 `Invoke-RestMethod` 默认按 ISO-8859-1 编码请求体 → **必须传字节数组**
  （PowerShell 7 默认 UTF-8，传字符串也可以）；
- PowerShell 5.1 的 `Get-Content` 读 UTF-8 中文会按 GBK 解码出错 → 用
  `[IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)` 或 `Get-Content -Encoding UTF8 -Raw`。

### 7.6 错误码与 message 对照

`POST` 的结构校验错误全部走 `invalid-state`，`message` 直接来自 `normalizeState`（`index.js:142-181`）：

| 触发条件 | message |
|---|---|
| body 不是 JSON | 来自 `JSON.parse`，如 `Expected property name or '}' in JSON at position 1 (line 1 column 2)` |
| 顶层不是对象或是数组 | `state 必须是对象` |
| `enabled` 非 boolean | `state.enabled 必须是 boolean` |
| `extra` 非 string | `state.extra 必须是 string` |
| `groups` 非数组或为空 | `state.groups 必须是非空数组` |
| `groups[i]` 非字符串或空白 | `state.groups[i] 必须是非空字符串` |
| `habits` 不是数组 | `state.habits 必须是数组` |
| `habits` 超过 500 条 | `state.habits 最多 500 条` |
| `habits[i]` 不是对象 | `state.habits[i] 必须是对象` |
| `habits[i].text` 超过 2000 字 | `state.habits[i].text 超过 2000 字` |
| `habits[i].on` 非 boolean | `state.habits[i].on 必须是 boolean` |

---

## 8. 首次播种的 16 条规则（全文）

状态文件不存在时，宿主写入以下 16 条，分 3 组（`解读输入` 9 条 / `执行` 3 条 / `交付` 4 条），
顺序即渲染顺序（`index.js:72-92`）。

### 解读输入（9 条）

1. 极短命令式（「继续」「都看」「不修」「启动服务器」）本身就是完整指令：直接执行，不反问、不复述确认。
2. 「继续」= 接着推进既定的未完成工作，不重新确认方向、不重开话题。
3. 单个字母或数字（a、b、1、c）是对你上一轮所列选项的作答：按该选项执行。
4. 按语义理解错别字与口语（「柔和」=融合、「那个全」=哪个全、「龙时」=龙之），不纠正、不追问。
5. 只发截图或图片时，从图中读取信息并直接行动。
6. 用户只给「操作 → 现象」，不给原因也不给修法；不要把用户的因果猜测当作结论，自己找根因。
7. 同一现象被重复贴出，说明上次没修好：换验证方法，不要重复解释或重复同一修法。
8. 用户后续的澄清覆盖先前的说法，以最新一条为准。
9. 用户给的是精确值与坐标（30 格、-248 4 -328、99999 点券）：按精确值执行，交付也用精确值。

### 执行（3 条）

10. 「你自己想办法」「我只要实现」= 不提方案让用户挑，直接实现到能用。
11. 用户明确说出的「不做什么」是硬边界，优先级高于「要做什么」。
12. 一次提出多条要求时，逐条处理并逐条给出状态。

### 交付（4 条）

13. 产出物写入用户指定的绝对路径；未指定时沿用本项目既有目录，不新建平行目录。
14. 每轮工作留一份 markdown 记录：用户原话 / 做了什么 / 结果 / 备注（含未解决项）。
15. 自写产物沿用用户既有命名约定：自写插件后缀 `-zuao`，正式包用 `dsh-` 前缀，临时或内部产物用 `_` 前缀。
16. 只报可核查的事实：精确数字、绝对路径、行号、命令与实际输出；未验证项独立成节，不写「应该没问题」。

> 第 15 条里的 `-zuao` 与 `_` 来自 config `pluginSuffix` / `internalPrefix`——播种时按配置拼进去，
> 所以改配置后**删掉状态文件重新播种**，这条文本会跟着变。

---

## 9. 常见问题 / 排错

### 9.1 设置里看不到「工作习惯」那一页

**按顺序检查：**

1. **重启一次 DSH 宿主**。这是最常见原因：宿主对客户端模块的扫描是增量的，「不是客户端包」的
   否定结论会缓存到进程重启，热装那一行会**永久漏掉**，刷新页面不会补上（见第 2.2 节）。
2. 确认 bundle 真的装上了：`plugin_manager` 的 `list_bundles` 里能看到本 bundle。
3. 确认 `package.json` 里 `dsh.client` 还在（`platform: 'web'`、`immediately: true`、
   `inject: ['@deepseek-ai/dsh-client-ui-slots']`）——被改坏会导致浏览器半区不加载。
4. 确认宿主行加载没报错：`index.js` 的配置校验是 fail loud 的，未知 config 键会让整行加载失败，
   表现为「页面没有 + 数据接口也没有」。
5. 打开浏览器开发者工具看 `/work-habits/state` 请求是否 200；404 说明宿主行没挂上。

### 9.2 改了规则但没生效

| 检查 | 说明 |
|---|---|
| 保存状态行 | 必须是「已保存」。显示「保存失败: …」时先解决报错 |
| 总开关 | 关掉时 section 被**注销**，整段规则都不进 prompt |
| 逐条开关 | 关掉的条目内容还在文件里，但不渲染 |
| 分组是否为空 | 某组条目全关 → 该组标题和内容都不输出 |
| 会话开始时间 | 改动**不会回溯**已经组装好的 system prompt；新开一个会话再确认 |
| `order` | 只影响读取顺序，不影响是否注入 |

### 9.3 保存失败

- 页面底部状态行会显示 `保存失败: <原因>`，原因来自宿主的 `error.message` 或网络错误。
- 常见原因与处理：

| 现象 | 可能原因 | 处理 |
|---|---|---|
| `保存失败: state.habits 必须是数组` 等 | 客户端与宿主版本不匹配（老客户端发新结构） | 升级到同一版本后重启宿主 |
| 保存失败且提示路径 | `$DSH_HOME` 目录不可写 / 磁盘满 / 路径不存在且无法创建 | 确认目录存在且可写；`$DSH_HOME` 未设时用 `~/.dsh` |
| 载入时失败并只剩「重试」 | 状态文件损坏或读不动 → 宿主抛 `无法读取状态文件 <file>：<msg>` | 修好或删掉该 JSON（删掉会重新播种 16 条），再重启宿主 |
| 请求一直失败 | 端口变了（换了 DSH 实例） | 用当前 GUI 地址重新打开设置页 |

### 9.4 数据文件被删了会怎样

- **宿主启动时**发现文件不存在（ENOENT）→ 按配置重新播种 16 条，并立即落盘。
- **运行中**删掉文件：内存态还在，宿主不会立刻重播种；下一次任何变更落盘时会把内存态写回去。
- 文件存在但**解析失败**时不会重新播种，而是抛错（保护用户数据）。

### 9.5 多个 profile 共用同一份数据文件

默认路径是 `$DSH_HOME/work-habits.json`，**不含 profile 名**，所以：

- 所有 profile（desktop 等）**共用同一份规则**——一个 profile 里改了，另一个 profile 也变；
- 两个 profile 同时运行时，各自持有自己的内存副本，落盘是**整体覆盖（last write wins）**，
  不会合并，也没有文件监听/热重载；
- 想让某个 profile 用独立的规则文件 → 在该 profile 的行 config 里设 `storePath`。

### 9.6 其他

- **同一 section 名重复注册**会在同一层抛错。本插件已先 `disposeSection()` 再注册，正常不会触发；
  若你另写插件也用 `work-habits:profile` 这个名字，会冲突。
- `systemPrompt` / `webServer` 缺失时插件**不会加载失败**，只是少一项能力（见 11.3）。

---

## 10. 卸载

```
plugin_manager remove_bundle target=dsh-work-habits
```

- **不会删除** `$DSH_HOME/work-habits.json`，你的规则留着（`README.md:127`）。
- 卸载后「工作习惯」页消失，system prompt 里不再有 `work-habits:profile` section。
- 想彻底清干净：先卸载，再手动删除 `$DSH_HOME/work-habits.json`（以及可能残留的
  `work-habits.json.tmp`）。
- 重装后行为：若状态文件还在，**直接沿用**文件内容（不重新播种）；想让配置里的
  `pluginSuffix` / `internalPrefix` / `extra` 重新生效，需先删掉状态文件。

---

## 11. 开发 / 结构说明

### 11.1 文件职责

| 文件 | 作用 |
|---|---|
| `index.js` | **宿主半区**。状态 + 持久化 + HTTP 路由 + system prompt section。导出 `apply(ctx, rawConfig)`；内部含 `seedHabits` / `resolveConfig` / `resolveStorePath` / `normalizeState` / `createStore` / `renderHabits` / `sendJson` / `readBody` |
| `client.js` | **浏览器半区**。走 `window.__ModuleLoader__.load({ id, factory(require) })` 的惰性工厂协议，`react` 从浏览器模块表 `require`；无构建步骤，因此**不用 JSX**，全部 `React.createElement`；注册 `settings.section`（id `work-habits`、order `30`、label 取字典 `nav`） |
| `package.json` | 包元数据与 DSH 声明：`type: module`、`main: index.js`、`exports`（`.` / `./client` / `./locale/*.json` / `./icon` / `./package.json`）、`files`、`dsh.bundle.patch`、`dsh.client` |
| `cordis.patch.yml` | bundle 的 Cordis patch。**只出现 `insert`**，不覆写 DSH 已发布的任何行；插入 `id: work-habits` / `name: 'dsh-work-habits'` / `config: {}`，并在注释里列出可调项 |
| `locale/zh.json`、`locale/en.json` | 只有 `meta.title` 与 `meta.description` 两个字段（`工作习惯画像` / `Work Habits Profile`）。**设置页的界面文案不走它**，走 `client.js` 里自带的 `DICT` |
| `icon.svg` | 48×48 图标（蓝色文档 + 黄色对勾），`aria-label="Work habits profile"` |

### 11.2 `package.json` 的 DSH 声明

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {
    "platform": "web",
    "immediately": true,
    "inject": ["@deepseek-ai/dsh-client-ui-slots"]
  }
}
```

- `platform: 'web'` + `immediately: true`：页面启动时就把浏览器半区纳入模块图；
- `inject` 里的 id 是浏览器半区依赖的客户端模块表条目；
- 宿主半区的入口来自 bundle patch 插入的那一行（`main: index.js`）。

> 备注：`files` 数组是 `index.js / client.js / cordis.patch.yml / locale/*.json / icon.svg / README.md`，
> **不含 `docs/`**。所以 `npm pack` 不会打包本文件；以 git 仓库分发时不受影响。

### 11.3 设计约束

- **宿主半区不 import 任何 `@deepseek-ai/*` 值**，也不导出 Schemastery `Config`（`index.js:10-13`）。
  profile loader 会提供那些名字，但每多一个导入就多一种加载失败的方式；配置改为在
  `resolveConfig` 里显式校验，出错时点名具体的键。
- **`systemPrompt` 与 `webServer` 都是软依赖**，通过 `ctx.inject` 挂载（`index.js:312, 350`）：
  - 缺 `systemPrompt` → 不注册 section，规则不进 prompt，但设置页照常能编辑；
  - 缺 `webServer` → 没有 `/work-habits/state` 路由，设置页会载入失败（只剩「重试」）；
  - 两者都缺也不会加载失败，只是功能缺失。
- 宿主半区只用 Node 内置模块：`node:crypto`、`node:fs`、`node:os`、`node:path`（`index.js:21-24`）。
- 浏览器半区**不注册**客户端 locale 服务：源码注释说明本插件的 `bind()` 返回签名没有实测过，
  不想拿猜的 API 去换不确定的失败点，所以自带字典（`client.js:25-29`）。

### 11.4 数据流

```
设置页（client.js）
   │  GET  /work-habits/state        ← 读全量状态 + file 路径
   │  POST /work-habits/state        ← 整份状态覆盖（400ms 防抖）
   ▼
宿主行（index.js）
   ├─ createStore：内存态唯一事实来源
   │     └─ persist()：写 <file>.tmp → renameSync → work-habits.json（原子）
   ├─ webServer.register：前缀路由 /work-habits
   └─ systemPrompt.section({ name:'work-habits:profile', order:650, interpolate:false, text:()=>renderHabits(state) })
         └─ store.subscribe(sync)：总开关变化时注销 / 重新注册 section
```

### 11.5 改代码时的注意点

| 改动 | 影响 |
|---|---|
| 改 `ROUTE_PREFIX`（`index.js:39`） | 必须同步改 `client.js:23` 的 `ROUTE`，否则设置页 404 |
| 改 `SECTION_NAME` | 与别的插件重名会在同一层抛错 |
| 改 `DEFAULT_GROUPS` | 只影响首次播种；已存在的状态文件里 `groups` 以文件为准 |
| 改 `MAX_*` 常量 | 校验与上限随之变化，注意与已有数据兼容 |
| 改设置页文案 | 改 `client.js` 的 `DICT`（zh 与 en 两份），缺键回落中文 |
| 改 `client.js` | 无构建步骤，改完刷新页面即可（宿主对客户端模块的扫描是增量的，新模块仍需重启宿主） |

---

## 附：一页速查

| 想做的事 | 命令 / 操作 |
|---|---|
| 安装 | `plugin_manager install_bundle target=D:\ai aegit\deepseek\dsh-work-habits`，然后**重启 DSH 宿主** |
| 打开编辑页 | 设置 → 左侧「工作习惯」 |
| 临时停用注入 | 设置页总开关，或 profile 里 `config.enabled: false` |
| 看状态 | `curl -s http://127.0.0.1:<端口>/work-habits/state` |
| 改状态（脚本） | `curl -s -X POST -H "content-type: application/json" --data-binary @state.json http://127.0.0.1:<端口>/work-habits/state` |
| 恢复出厂 16 条 | 停掉宿主 → 删除 `$DSH_HOME/work-habits.json` → 重启宿主 |
| 卸载 | `plugin_manager remove_bundle target=dsh-work-habits`（不删数据文件） |
| 数据文件 | `$DSH_HOME/work-habits.json`（本机 `C:\Users\momol\.dsh\work-habits.json`） |
