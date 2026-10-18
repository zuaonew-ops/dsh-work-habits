/**
 * dsh-work-habits — 浏览器半区。
 *
 * 在「设置」左侧导航里注册一个页面（slot `settings.section`），用来增删改
 * 注入 system prompt 的工作习惯规则。数据由宿主半区通过 `/work-habits/state`
 * 提供并持久化，本文件只做读写与渲染。
 *
 * 形态说明：这是一个手写的浏览器模块，走 `window.__ModuleLoader__.load`
 * 的惰性工厂协议，`react` 从浏览器模块表里 `require`。没有构建步骤，
 * 因此不用 JSX，全部用 `React.createElement`。
 *
 * @module dsh-work-habits/client
 */

window.__ModuleLoader__.load({
  id: 'dsh-work-habits',

  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** 宿主半区暴露的数据端点（固定路径，与 index.js 的 ROUTE_PREFIX 对齐）。 */
    const ROUTE = '/work-habits/state'

    /**
     * 界面文案。自带一份字典而不是走客户端 locale 服务：本插件的
     * `bind()` 返回签名没有实测过，不想拿一个猜的 API 去换一个不确定的
     * 失败点。语言按浏览器偏好选，缺键回落到中文。
     */
    const DICT = {
      zh: {
        nav: '工作习惯',
        intro: '这些规则会注入每个会话的 system prompt。改动自动保存。',
        enable: '启用（关掉后不再注入）',
        add: (group) => `添加一条到「${group}」`,
        extra: '补充约束（追加在末尾）',
        extraPlaceholder: '可选：再加一段你自己的要求',
        remove: '删除',
        up: '上移',
        down: '下移',
        placeholder: '写一条规则…',
        loading: '载入中…',
        saved: '已保存',
        saving: '保存中…',
        error: '保存失败',
        empty: '这个分组还没有规则',
        store: '数据文件',
        retry: '重试',
      },
      en: {
        nav: 'Work habits',
        intro: 'These rules are injected into every session\u2019s system prompt. Changes save automatically.',
        enable: 'Enabled (turns the injection off)',
        add: (group) => `Add a rule to \u201c${group}\u201d`,
        extra: 'Extra constraints (appended last)',
        extraPlaceholder: 'Optional: one more requirement of your own',
        remove: 'Delete',
        up: 'Move up',
        down: 'Move down',
        placeholder: 'Write a rule\u2026',
        loading: 'Loading\u2026',
        saved: 'Saved',
        saving: 'Saving\u2026',
        error: 'Save failed',
        empty: 'No rules in this group yet',
        store: 'Data file',
        retry: 'Retry',
      },
    }

    const LANG = (
      (typeof navigator !== 'undefined' && navigator.language) ||
      'zh'
    ).toLowerCase().startsWith('zh')
      ? 'zh'
      : 'en'

    /** 取一条文案；带函数的值按参数调用。 */
    function t(key, ...args) {
      const value = DICT[LANG][key] ?? DICT.zh[key]
      return typeof value === 'function' ? value(...args) : value
    }

    /** 稳定的本地 id（宿主也会补，但界面上要立刻有 key）。 */
    let seq = 0
    function localId() {
      seq += 1
      return `local-${Date.now().toString(36)}-${seq}`
    }

    const TOKEN = {
      text: 'var(--dsw-alias-label-primary)',
      dim: 'var(--dsw-alias-label-secondary)',
      border: 'var(--dsw-alias-border-l1)',
      borderStrong: 'var(--dsw-alias-border-l2)',
      surface: 'var(--dsw-alias-bg-layer-1)',
      nested: 'var(--dsw-alias-bg-layer-2)',
      brand: 'var(--dsw-alias-brand-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
      success: 'var(--dsw-alias-state-success-primary)',
    }

    /** 一个小的图标按钮。 */
    function IconButton(props) {
      return h('button', {
        type: 'button',
        title: props.title,
        'aria-label': props.title,
        disabled: props.disabled,
        onClick: props.onClick,
        style: {
          flex: '0 0 auto',
          width: 28,
          height: 28,
          lineHeight: '24px',
          padding: 0,
          fontSize: 14,
          cursor: props.disabled ? 'default' : 'pointer',
          opacity: props.disabled ? 0.35 : 1,
          color: props.danger ? TOKEN.error : TOKEN.dim,
          background: 'transparent',
          border: `1px solid ${TOKEN.border}`,
          borderRadius: 6,
          font: 'inherit',
        },
      }, props.children)
    }

    /** 设置页主体。 */
    function WorkHabitsSection() {
      const [data, setData] = React.useState(null)
      const [file, setFile] = React.useState('')
      const [status, setStatus] = React.useState('loading')
      const [message, setMessage] = React.useState('')

      // 当前状态的镜像：变更函数从 ref 读，避免在 setState 更新器里做副作用
      // （StrictMode 下更新器可能被调用两次，那样会重复发保存请求）。
      const current = React.useRef(null)
      const timer = React.useRef(null)
      const alive = React.useRef(true)

      const load = React.useCallback(() => {
        setStatus('loading')
        setMessage('')
        return fetch(ROUTE)
          .then((response) => response.json())
          .then((envelope) => {
            if (!alive.current) return
            if (!envelope || envelope.ok !== true) {
              throw new Error((envelope && envelope.error && envelope.error.message) || 'HTTP error')
            }
            current.current = envelope.value
            setData(envelope.value)
            setFile(envelope.value.file || '')
            setStatus('saved')
          })
          .catch((error) => {
            if (!alive.current) return
            setStatus('error')
            setMessage(String((error && error.message) || error))
          })
      }, [])

      React.useEffect(() => {
        alive.current = true
        load()
        return () => {
          alive.current = false
          if (timer.current) clearTimeout(timer.current)
        }
      }, [load])

      /** 把整份状态发回宿主；连点会被 400ms 的防抖合并成一次。 */
      const save = React.useCallback((next) => {
        setStatus('saving')
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => {
          fetch(ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(next),
          })
            .then((response) => response.json())
            .then((envelope) => {
              if (!alive.current) return
              if (!envelope || envelope.ok !== true) {
                throw new Error((envelope && envelope.error && envelope.error.message) || 'HTTP error')
              }
              setStatus('saved')
              setMessage('')
            })
            .catch((error) => {
              if (!alive.current) return
              setStatus('error')
              setMessage(String((error && error.message) || error))
            })
        }, 400)
      }, [])

      /** 应用一次纯变更：更新本地、发保存。 */
      const commit = React.useCallback((mutate) => {
        const base = current.current
        if (!base) return
        const next = mutate({
          ...base,
          habits: base.habits.map((habit) => ({ ...habit })),
          groups: [...base.groups],
        })
        current.current = next
        setData(next)
        save(next)
      }, [save])

      if (status === 'loading' && !data) {
        return h('div', { style: { padding: '16px 20px', color: TOKEN.dim } }, t('loading'))
      }

      if (!data) {
        return h('div', { style: { padding: '16px 20px', color: TOKEN.error } },
          h('div', null, `${t('error')}: ${message}`),
          h('button', {
            type: 'button',
            onClick: load,
            style: {
              marginTop: 8, padding: '4px 12px', cursor: 'pointer', font: 'inherit',
              color: TOKEN.text, background: TOKEN.surface,
              border: `1px solid ${TOKEN.border}`, borderRadius: 6,
            },
          }, t('retry')),
        )
      }

      const rows = []

      // 总开关
      rows.push(h('label', {
        key: 'enable',
        style: { display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 16px', cursor: 'pointer' },
      },
        h('input', {
          type: 'checkbox',
          checked: data.enabled !== false,
          onChange: () => commit((next) => { next.enabled = next.enabled === false; return next }),
        }),
        h('span', null, t('enable')),
      ))

      for (const group of data.groups) {
        const items = data.habits.filter((habit) => habit.group === group)
        rows.push(h('div', {
          key: `g-${group}`,
          style: { margin: '0 0 6px', fontSize: 13, fontWeight: 600, color: TOKEN.dim },
        }, group))

        if (items.length === 0) {
          rows.push(h('div', {
            key: `empty-${group}`,
            style: { margin: '0 0 12px', fontSize: 12, color: TOKEN.dim, opacity: 0.75 },
          }, t('empty')))
        }

        items.forEach((habit, index) => {
          const patch = (fields) => commit((next) => {
            const target = next.habits.find((candidate) => candidate.id === habit.id)
            if (target) Object.assign(target, fields)
            return next
          })

          /** 在本分组内上下移动：与同组的相邻项交换。 */
          const move = (delta) => commit((next) => {
            const siblings = next.habits.filter((candidate) => candidate.group === group)
            const at = siblings.findIndex((candidate) => candidate.id === habit.id)
            const to = at + delta
            if (at < 0 || to < 0 || to >= siblings.length) return next
            const a = next.habits.indexOf(siblings[at])
            const b = next.habits.indexOf(siblings[to])
            const swap = next.habits[a]
            next.habits[a] = next.habits[b]
            next.habits[b] = swap
            return next
          })

          rows.push(h('div', {
            key: habit.id,
            style: { display: 'flex', alignItems: 'flex-start', gap: 6, margin: '0 0 6px' },
          },
            h('input', {
              type: 'checkbox',
              checked: habit.on !== false,
              title: habit.on !== false ? 'on' : 'off',
              onChange: () => patch({ on: habit.on === false }),
              style: { marginTop: 8, flex: '0 0 auto' },
            }),
            h('textarea', {
              value: habit.text,
              rows: 2,
              spellCheck: false,
              placeholder: t('placeholder'),
              onChange: (event) => patch({ text: event.target.value }),
              style: {
                flex: '1 1 auto', minWidth: 0, resize: 'vertical', font: 'inherit', fontSize: 13,
                lineHeight: 1.5, padding: '6px 8px', color: TOKEN.text, background: TOKEN.nested,
                border: `1px solid ${TOKEN.border}`, borderRadius: 6,
                opacity: habit.on === false ? 0.55 : 1,
              },
            }),
            h(IconButton, { title: t('up'), disabled: index === 0, onClick: () => move(-1) }, '\u2191'),
            h(IconButton, { title: t('down'), disabled: index === items.length - 1, onClick: () => move(1) }, '\u2193'),
            h(IconButton, {
              title: t('remove'),
              danger: true,
              onClick: () => commit((next) => {
                next.habits = next.habits.filter((candidate) => candidate.id !== habit.id)
                return next
              }),
            }, '\u00d7'),
          ))
        })

        rows.push(h('button', {
          key: `add-${group}`,
          type: 'button',
          onClick: () => commit((next) => {
            next.habits.push({ id: localId(), text: '', on: true, group })
            return next
          }),
          style: {
            margin: '2px 0 18px', padding: '4px 10px', cursor: 'pointer', font: 'inherit', fontSize: 12,
            color: TOKEN.text, background: 'transparent',
            border: `1px dashed ${TOKEN.borderStrong}`, borderRadius: 6,
          },
        }, `+ ${t('add', group)}`))
      }

      rows.push(h('div', {
        key: 'extra-label',
        style: { margin: '0 0 6px', fontSize: 13, fontWeight: 600, color: TOKEN.dim },
      }, t('extra')))
      rows.push(h('textarea', {
        key: 'extra',
        value: data.extra || '',
        rows: 3,
        spellCheck: false,
        placeholder: t('extraPlaceholder'),
        onChange: (event) => commit((next) => { next.extra = event.target.value; return next }),
        style: {
          width: '100%', boxSizing: 'border-box', resize: 'vertical', font: 'inherit', fontSize: 13,
          lineHeight: 1.5, padding: '6px 8px', color: TOKEN.text, background: TOKEN.nested,
          border: `1px solid ${TOKEN.border}`, borderRadius: 6,
        },
      }))

      const statusColor = status === 'error'
        ? TOKEN.error
        : status === 'saved' ? TOKEN.success : TOKEN.dim
      const statusText = status === 'error'
        ? `${t('error')}: ${message}`
        : status === 'saving' ? t('saving') : t('saved')

      rows.push(h('div', {
        key: 'status',
        style: { marginTop: 12, fontSize: 12, color: statusColor },
      }, statusText))
      if (file) {
        rows.push(h('div', {
          key: 'file',
          style: { marginTop: 4, fontSize: 11, color: TOKEN.dim, wordBreak: 'break-all' },
        }, `${t('store')}: ${file}`))
      }

      return h('div', {
        style: {
          padding: '16px 20px 24px',
          color: TOKEN.text,
          font: 'inherit',
          fontSize: 13,
        },
      },
        h('div', { style: { margin: '0 0 12px', color: TOKEN.dim } }, t('intro')),
        ...rows,
      )
    }

    return {
      inject: ['slots'],

      apply(ctx) {
        // slots.inject 会等 `settings.section` 的声明落到 ledger 上再执行回调，
        // 所以设置外壳还没挂载时也不会注册失败。
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'work-habits',
          order: 30,
          label: () => t('nav'),
        }, WorkHabitsSection))
      },
    }
  },
})
