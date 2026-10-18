/**
 * dsh-work-habits — 把用户的工作习惯注入 system prompt，并提供一个可在
 * 设置面板里随时增删改的编辑界面。
 *
 * 职责分工：
 * - 本文件（宿主半区）：持有习惯状态、持久化到磁盘、通过 HTTP 路由暴露给
 *   浏览器半区、把状态渲染成 system prompt 的一个 section。
 * - `client.js`（浏览器半区）：在「设置 → 侧边栏」注册一个页面，读写这些数据。
 *
 * 设计约束（照 `dsh-ops` 的取舍）：
 * 本文件**不导入任何 `@deepseek-ai/*` 值**，也不导出 Schemastery `Config`。
 * profile loader 会提供那些名字，但每多一个导入就多一种加载失败的方式；
 * 配置改为在这里显式校验，出错时点名具体的键。
 *
 * `systemPrompt` 与 `webServer` 都是软依赖（`ctx.inject`）：缺少它们的
 * profile 会安静跳过对应能力，而不是加载失败。
 *
 * @module dsh-work-habits
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** system prompt 里本 section 的名字；同名重复注册会在同一层抛错。 */
const SECTION_NAME = 'work-habits:profile'

/**
 * 默认排序位。取自 `@deepseek-ai/dsh-system-prompt` 的 SECTION_ORDERS：
 * HARNESS_IDENTITY=-1000、DEPLOYMENT_PERSONA_PREFIX=0、PLAN_POLICY=500、
 * TEAM_POLICY=600、PTC_ONLY=800、FILE_REFERENCE=900、TOOL_*=1000+。
 * 650 落在 TEAM_POLICY 与 PTC_ONLY 之间：作为「怎么解读用户」的框架性
 * 策略，要排在具体工具说明之前被读到。
 */
const DEFAULT_ORDER = 650

/** HTTP 路由前缀。固定值：浏览器半区按它取数，不做成可配置项。 */
const ROUTE_PREFIX = '/work-habits'

/** 状态文件名，落在 $DSH_HOME 下（与 .dshw-*.json 等插件数据同级）。 */
const STORE_FILE = 'work-habits.json'

/** 单个习惯文本的长度上限，防止把 prompt 撑爆。 */
const MAX_HABIT_LENGTH = 2000

/** 习惯条数上限。 */
const MAX_HABITS = 500

/** 请求体上限。 */
const MAX_BODY = 1 << 20

/** 默认分组，顺序即渲染顺序。 */
const DEFAULT_GROUPS = Object.freeze(['解读输入', '执行', '交付'])

const DEFAULTS = Object.freeze({
  enabled: true,
  order: DEFAULT_ORDER,
  pluginSuffix: '-zuao',
  internalPrefix: '_',
  extra: '',
  storePath: '',
})

/**
 * 首次运行时写入的初始习惯。文本里嵌入了 `pluginSuffix` / `internalPrefix`，
 * 所以它是函数：配置改了，重新播种的内容跟着变。
 *
 * @param {ReturnType<typeof resolveConfig>} config
 * @returns {Array<{text: string, group: string}>}
 */
function seedHabits(config) {
  const g = DEFAULT_GROUPS
  return [
    { group: g[0], text: '极短命令式（「继续」「都看」「不修」「启动服务器」）本身就是完整指令：直接执行，不反问、不复述确认。' },
    { group: g[0], text: '「继续」= 接着推进既定的未完成工作，不重新确认方向、不重开话题。' },
    { group: g[0], text: '单个字母或数字（a、b、1、c）是对你上一轮所列选项的作答：按该选项执行。' },
    { group: g[0], text: '按语义理解错别字与口语（「柔和」=融合、「那个全」=哪个全、「龙时」=龙之），不纠正、不追问。' },
    { group: g[0], text: '只发截图或图片时，从图中读取信息并直接行动。' },
    { group: g[0], text: '用户只给「操作 → 现象」，不给原因也不给修法；不要把用户的因果猜测当作结论，自己找根因。' },
    { group: g[0], text: '同一现象被重复贴出，说明上次没修好：换验证方法，不要重复解释或重复同一修法。' },
    { group: g[0], text: '用户后续的澄清覆盖先前的说法，以最新一条为准。' },
    { group: g[0], text: '用户给的是精确值与坐标（30 格、-248 4 -328、99999 点券）：按精确值执行，交付也用精确值。' },
    { group: g[1], text: '「你自己想办法」「我只要实现」= 不提方案让用户挑，直接实现到能用。' },
    { group: g[1], text: '用户明确说出的「不做什么」是硬边界，优先级高于「要做什么」。' },
    { group: g[1], text: '一次提出多条要求时，逐条处理并逐条给出状态。' },
    { group: g[2], text: '产出物写入用户指定的绝对路径；未指定时沿用本项目既有目录，不新建平行目录。' },
    { group: g[2], text: '每轮工作留一份 markdown 记录：用户原话 / 做了什么 / 结果 / 备注（含未解决项）。' },
    { group: g[2], text: `自写产物沿用用户既有命名约定：自写插件后缀 \`${config.pluginSuffix}\`，正式包用 \`dsh-\` 前缀，临时或内部产物用 \`${config.internalPrefix}\` 前缀。` },
    { group: g[2], text: '只报可核查的事实：精确数字、绝对路径、行号、命令与实际输出；未验证项独立成节，不写「应该没问题」。' },
  ]
}

/**
 * 校验并归一化本行的 config。未知键直接抛错并点名，行为与 loader 自己的
 * schema 校验一致（fail loud，不静默吞掉拼错的配置）。
 *
 * @param {unknown} raw 行上的 config
 */
function resolveConfig(raw) {
  if (raw === undefined || raw === null) return { ...DEFAULTS }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('dsh-work-habits: config 必须是一个映射（mapping）')
  }
  const resolved = { ...DEFAULTS }
  for (const [key, value] of Object.entries(raw)) {
    if (!Object.hasOwn(DEFAULTS, key)) {
      throw new Error(
        `dsh-work-habits: 未知的 config 键 "${key}"（可用：${Object.keys(DEFAULTS).join(', ')}）`,
      )
    }
    if (key === 'enabled') {
      if (typeof value !== 'boolean') throw new Error('dsh-work-habits: config.enabled 必须是 boolean')
    } else if (key === 'order') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error('dsh-work-habits: config.order 必须是有限数字')
      }
    } else if (typeof value !== 'string') {
      throw new Error(`dsh-work-habits: config.${key} 必须是 string`)
    }
    resolved[key] = value
  }
  return resolved
}

/** 状态文件的绝对路径。 */
function resolveStorePath(config) {
  if (config.storePath) return config.storePath
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, STORE_FILE)
}

/**
 * 校验并归一化一份状态。
 *
 * 宽进严出：文本为空的条目直接丢弃（界面上刚加的空行就是这种情况），
 * 其余非法输入抛错并点名，不做静默兜底。
 *
 * @param {unknown} raw
 * @returns {{enabled: boolean, extra: string, groups: string[], habits: Array<{id: string, text: string, on: boolean, group: string}>}}
 */
function normalizeState(raw) {
  if (raw === undefined || raw === null) return { enabled: true, extra: '', groups: [...DEFAULT_GROUPS], habits: [] }
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('state 必须是对象')

  const enabled = raw.enabled === undefined ? true : raw.enabled
  if (typeof enabled !== 'boolean') throw new Error('state.enabled 必须是 boolean')

  const extra = raw.extra === undefined ? '' : raw.extra
  if (typeof extra !== 'string') throw new Error('state.extra 必须是 string')

  let groups = DEFAULT_GROUPS
  if (raw.groups !== undefined) {
    if (!Array.isArray(raw.groups) || raw.groups.length === 0) throw new Error('state.groups 必须是非空数组')
    for (const [i, name] of raw.groups.entries()) {
      if (typeof name !== 'string' || name.trim() === '') throw new Error(`state.groups[${i}] 必须是非空字符串`)
    }
    groups = raw.groups.map((name) => name.trim())
  }

  if (!Array.isArray(raw.habits)) throw new Error('state.habits 必须是数组')
  if (raw.habits.length > MAX_HABITS) throw new Error(`state.habits 最多 ${MAX_HABITS} 条`)

  const habits = []
  for (const [i, item] of raw.habits.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`state.habits[${i}] 必须是对象`)
    const text = typeof item.text === 'string' ? item.text.trim() : ''
    if (text === '') continue // 空行 = 还没写内容，直接丢
    if (text.length > MAX_HABIT_LENGTH) throw new Error(`state.habits[${i}].text 超过 ${MAX_HABIT_LENGTH} 字`)
    if (item.on !== undefined && typeof item.on !== 'boolean') throw new Error(`state.habits[${i}].on 必须是 boolean`)
    const group = typeof item.group === 'string' && groups.includes(item.group) ? item.group : groups[0]
    habits.push({
      id: typeof item.id === 'string' && item.id !== '' ? item.id : randomUUID(),
      text,
      on: item.on !== false,
      group,
    })
  }

  return { enabled, extra, groups: [...groups], habits }
}

/**
 * 建一个状态仓库：内存里是唯一事实来源，每次变更同步落盘。
 *
 * @param {ReturnType<typeof resolveConfig>} config
 */
function createStore(config) {
  const file = resolveStorePath(config)
  let state

  try {
    const text = readFileSync(file, 'utf8')
    state = normalizeState(JSON.parse(text))
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      // 文件存在但读不动/解析失败：不能静默用默认值盖掉用户数据。
      throw new Error(`dsh-work-habits: 无法读取状态文件 ${file}：${error.message}`)
    }
    // 首次运行：按配置播种。
    state = normalizeState({
      enabled: true,
      extra: config.extra,
      groups: [...DEFAULT_GROUPS],
      habits: seedHabits(config),
    })
  }

  const listeners = new Set()

  /** 原子落盘：先写临时文件再改名，避免半截文件。 */
  function persist() {
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    renameSync(tmp, file)
  }

  // 首次播种的结果也要落盘，否则每次启动都会重新播种、丢掉顺序。
  try {
    persist()
  } catch {
    // 落盘失败不影响本次运行（内存态照常工作），下次变更会再试。
  }

  return {
    file,
    get state() {
      return state
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    /** 整体替换状态并广播。 */
    replace(next) {
      state = next
      persist()
      for (const listener of [...listeners]) listener()
    },
  }
}

/**
 * 把状态渲染成要注入的 section 正文。
 *
 * 关掉时返回空串——调用方据此决定是否注册 section。
 *
 * @param {ReturnType<typeof normalizeState>} state
 * @returns {string}
 */
function renderHabits(state) {
  const lines = [
    '## 用户工作习惯（按此解读需求与交付）',
    '',
    '本用户的输入极短、口语化、常带错别字。以下规则优先于默认的澄清与汇报习惯。',
  ]
  for (const group of state.groups) {
    const items = state.habits.filter((habit) => habit.on && habit.group === group)
    if (items.length === 0) continue
    lines.push('', `### ${group}`, '')
    for (const item of items) lines.push(`- ${item.text}`)
  }
  const extra = state.extra.trim()
  if (extra) lines.push('', extra)
  return lines.join('\n')
}

/** 发一个 JSON 响应。 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/** 读请求体（带上限）。 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * 插件入口。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文
 * @param {unknown} rawConfig 本行的 config
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)
  if (!config.enabled) return

  const store = createStore(config)

  // 1) system prompt section：状态一变，正文跟着变。
  ctx.inject(['systemPrompt'], (scoped) => {
    let disposeSection = null
    let lastEnabled = null

    const sync = () => {
      if (store.state.enabled === lastEnabled) return
      lastEnabled = store.state.enabled
      if (disposeSection) {
        disposeSection()
        disposeSection = null
      }
      if (!store.state.enabled) return
      disposeSection = scoped.systemPrompt.section({
        name: SECTION_NAME,
        order: config.order,
        // 正文里含反引号与用户原话，关掉 {{...}} 插值以免误伤。
        interpolate: false,
        text: () => renderHabits(store.state),
      })
    }

    scoped.effect(
      () => {
        sync()
        const unsubscribe = store.subscribe(sync)
        return () => {
          unsubscribe()
          if (disposeSection) {
            disposeSection()
            disposeSection = null
          }
        }
      },
      'dsh-work-habits: 用户工作习惯 section',
    )
  })

  // 2) HTTP 路由：浏览器半区（设置页）读写状态。
  ctx.inject(['webServer'], (scoped) => {
    scoped.effect(
      () =>
        scoped.webServer.register({
          kind: 'prefix',
          path: ROUTE_PREFIX,
          handler: async (req, res) => {
            let pathname
            try {
              pathname = new URL(req.url ?? '/', 'http://localhost').pathname
            } catch {
              sendJson(res, 400, { ok: false, error: { code: 'bad-url', message: '无法解析请求 URL' } })
              return
            }

            if (pathname !== `${ROUTE_PREFIX}/state`) {
              sendJson(res, 404, { ok: false, error: { code: 'not-found', message: `未知路径 ${pathname}` } })
              return
            }

            if (req.method === 'GET') {
              sendJson(res, 200, { ok: true, value: { ...store.state, file: store.file } })
              return
            }

            if (req.method !== 'POST') {
              sendJson(res, 405, { ok: false, error: { code: 'method-not-allowed', message: `不支持 ${req.method}` } })
              return
            }

            try {
              const body = await readBody(req)
              const parsed = JSON.parse(body)
              store.replace(normalizeState(parsed))
            } catch (error) {
              sendJson(res, 400, {
                ok: false,
                error: { code: 'invalid-state', message: error instanceof Error ? error.message : String(error) },
              })
              return
            }

            sendJson(res, 200, { ok: true, value: { ...store.state, file: store.file } })
          },
        }),
      'dsh-work-habits: 设置页数据路由',
    )
  })
}
