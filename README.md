# dsh-work-habits

把**你的工作习惯**注入 system prompt，并在「设置」里给你一页随时增删改的编辑界面。
装一次，之后每个会话里的 agent 都按你本来的方式解读需求、执行和交付，不用每次重新交代。

宿主半区不导入任何 `@deepseek-ai/*` 值；`systemPrompt` 与 `webServer` 都是软依赖。

> 详细使用文档（安装 / 设置页逐项 / 配置 / HTTP 接口 / 排错 / 卸载）：[docs/USAGE.md](docs/USAGE.md)

## 它解决什么

从你自己 494 个 `.md` 里引用你原话的 57 行反推出来的习惯，写成了 agent 可执行的规则。
不装这个插件时，agent 的默认行为是「不确定就问」和「面面俱到地汇报」——这两条都和你的
实际习惯相反。

## 设置里的编辑页

设置面板左侧导航会多一项**工作习惯**（slot `settings.section`，order 30，
排在 agent-presets 之后、better-sidebar 之前）。这一页可以：

| 操作 | 说明 |
|---|---|
| 总开关 | 关掉后**注销** system prompt section，不是渲染成空文本 |
| 逐条开关 | 某条规则临时不生效，但内容留着 |
| 改文本 | 直接编辑，改动 **400ms 防抖后自动保存** |
| 上移 / 下移 | 只在本分组内换位 |
| 删除 | 删掉这条规则 |
| 添加 | 每个分组底部有「+ 添加一条到「xxx」」 |
| 补充约束 | 末尾追加一段自由文本 |

页面底部显示保存状态（已保存 / 保存中… / 保存失败+原因）和数据文件绝对路径。

空文本的条目在保存时会被宿主丢弃（界面上刚点「添加」还没写内容的行就是这种情况）。

## 注入的内容

规则存成一个有序列表，按三个分组渲染成 system prompt 的一个 section
（`work-habits:profile`，order `650`，位于 `TEAM_POLICY=600` 与 `PTC_ONLY=800` 之间）。

首次运行播种这 16 条：

**解读输入（9）**
- 极短命令式（「继续」「都看」「不修」「启动服务器」）本身就是完整指令：直接执行，不反问、不复述确认。
- 「继续」= 接着推进既定的未完成工作，不重新确认方向、不重开话题。
- 单个字母或数字（a、b、1、c）是对你上一轮所列选项的作答：按该选项执行。
- 按语义理解错别字与口语（「柔和」=融合、「那个全」=哪个全、「龙时」=龙之），不纠正、不追问。
- 只发截图或图片时，从图中读取信息并直接行动。
- 用户只给「操作 → 现象」，不给原因也不给修法；不要把用户的因果猜测当作结论，自己找根因。
- 同一现象被重复贴出，说明上次没修好：换验证方法，不要重复解释或重复同一修法。
- 用户后续的澄清覆盖先前的说法，以最新一条为准。
- 用户给的是精确值与坐标（30 格、-248 4 -328、99999 点券）：按精确值执行，交付也用精确值。

**执行（3）**
- 「你自己想办法」「我只要实现」= 不提方案让用户挑，直接实现到能用。
- 用户明确说出的「不做什么」是硬边界，优先级高于「要做什么」。
- 一次提出多条要求时，逐条处理并逐条给出状态。

**交付（4）**
- 产出物写入用户指定的绝对路径；未指定时沿用本项目既有目录，不新建平行目录。
- 每轮工作留一份 markdown 记录：用户原话 / 做了什么 / 结果 / 备注（含未解决项）。
- 自写产物沿用用户既有命名约定：自写插件后缀 `-zuao`，正式包用 `dsh-` 前缀，临时或内部产物用 `_` 前缀。
- 只报可核查的事实：精确数字、绝对路径、行号、命令与实际输出；未验证项独立成节，不写「应该没问题」。

（你删掉的那条「用 `/` 当分隔符」不在里面。）

## 数据存在哪

默认 `$DSH_HOME/work-habits.json`（本机即 `C:\Users\momol\.dsh\work-habits.json`）。
原子写入：先写 `.tmp` 再改名，不会留下半截文件。设置页底部显示实际路径。

宿主通过 `GET/POST /work-habits/state` 把它开放给设置页：

```
GET  /work-habits/state   → 200 {ok:true, value:{enabled, extra, groups, habits[], file}}
POST /work-habits/state   → 200 {ok:true, value:{...}} | 400 {ok:false, error:{code,message}}
其他路径 → 404     其他方法 → 405
```

## 配置

本行的 `config` 全部可选。要改就在 profile 的 `cordis.patch.yml` 里覆写同名 id
（patch 是**整行替换** `config`，覆写时要写全想保留的字段）：

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

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `enabled` | boolean | `true` | `false` 则整行不挂载（不是只关注入） |
| `order` | number | `650` | section 排序位；必须有限 |
| `pluginSuffix` | string | `'-zuao'` | 播种时写进命名约定那条 |
| `internalPrefix` | string | `'_'` | 同上 |
| `extra` | string | `''` | 补充约束的**初始值** |
| `storePath` | string | `''` | 状态文件绝对路径；留空用 `$DSH_HOME/work-habits.json` |

未知键会**抛错并点名**，不会静默忽略。

> `pluginSuffix` / `internalPrefix` / `extra` 只在**首次播种**时起作用——之后以
> 设置页里的内容为准（否则你每次改配置都会覆盖掉界面上编辑过的规则）。

## 依赖

`systemPrompt`（注册 section）与 `webServer`（设置页数据路由）都是**软依赖**
（`ctx.inject`）。缺哪一个就少哪一项能力，不会加载失败。

## 安装

```
plugin_manager install_bundle target=D:\ai aegit\deepseek\dsh-work-habits
```

浏览器半区是新的客户端模块，**装完需要刷新一次页面**才能在设置里看到那一页。

## 卸载

```
plugin_manager remove_bundle target=dsh-work-habits
```

卸载不会删除 `$DSH_HOME/work-habits.json`，你的规则留着。
