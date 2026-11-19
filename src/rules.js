/**
 * 「哪些 stderr 输出该收、怎么收」的唯一清单。
 *
 * 这些消息全部来自**不能改**的位置：核心包 dsh-llm-deepseek / dsh-deepseek-account
 * 直接 console.error，第三方插件（hashline、our-free-model）也各自 console，都不经
 * ctx.logger，没有开关可调。所以只在进程出口处按文案归类。
 *
 * 两条硬约束：
 *   1. 只收「已知的、可预期的、不影响功能」的三类：成功日志、调参日志、可降级的外部失败；
 *   2. 真错误一律放行——尤其 `errorCode: 'expired'`（登录态失效）必须让用户看见。
 */

/** 成功也算日志：两条 DeepSeek 路由各打一次，且每次目录刷新都重复。 */
const MODEL_LISTING_LOADED = /^\[llm-deepseek-[^\]]+\] model listing from \S+ loaded \d+ model\(s\), skipped \d+ row\(s\)$/

/** hashline 编辑器的 DP 预算一次性调参日志（0.10.1 与 0.11.4 都还在打）。 */
const ALIGN_PRESERVED = /^\[alignPreserved\] effective=\d+ \(heap_limit=\d+\); DP budget cap = floor\(heap\/32\); default hard cap = \d+$/

/** our-free-model 内置 pack：models.dev 目录超时后已退回本地兜底表，功能不缺。 */
const CATALOG_FALLBACK = /^\[cline\] models\.dev 目录拉取失败/

/** 账号接口失败是 util.inspect 出来的多行对象；按整块匹配，别按行。 */
const ACCOUNT_FAILURE = /^\[deepseek-account\] request failed (\{[\s\S]*\})\s*$/

/** 从 inspect 文本里取字段，不求值。 */
function field(objectText, name) {
  const matched = new RegExp(`\\b${name}: '([^']*)'`).exec(objectText)
  return matched === null ? undefined : matched[1]
}

/**
 * 参数化消息的人话解释；只带 path，绝不带 token。
 * @param {string} path - 出错端点路径。
 * @param {string | undefined} status - HTTP 状态码。
 * @param {string | undefined} errorCode - 插件自己的归类码。
 * @returns {string} 一行可读说明。
 */
function accountSummary(path, status, errorCode) {
  const cause = errorCode === 'no-response'
    ? '请求没有响应（超时或网络中断）'
    : `HTTP ${status ?? '?'}`
  return `[quiet-startup] 账号接口暂不可用（${path} → ${cause}）；同类报错只显示这一次。`
    + '账号面板/余额可能暂时读不到，对话与模型调用不受影响。'
}

/**
 * 判定一次 stderr 写入的处置方式。
 * @param {string} text - 一次写入的完整文本。
 * @param {Record<string, boolean>} options - 每个类别是否启用。
 * @returns {{ action: 'drop' } | { action: 'replace', text: string } | { action: 'pass', key?: string }}
 *   drop=整块吞掉；replace=换成一句人话；pass=原样放行（key 用于一次性去重）。
 */
export function classify(text, options) {
  const body = text.replace(/\n$/, '')

  if (options.modelListing && MODEL_LISTING_LOADED.test(body)) return { action: 'drop' }
  if (options.alignPreserved && ALIGN_PRESERVED.test(body)) return { action: 'drop' }
  if (options.catalogFallback && CATALOG_FALLBACK.test(body)) return { action: 'drop' }

  if (options.accountNetwork) {
    const matched = ACCOUNT_FAILURE.exec(body)
    if (matched !== null) {
      const errorCode = field(matched[1], 'errorCode')
      // expired=登录态失效，是用户必须处理的真错误。
      if (errorCode === 'network' || errorCode === 'no-response') {
        const path = field(matched[1], 'path') ?? 'account'
        const status = /\bstatus: (\d+)/.exec(matched[1])?.[1]
        return { action: 'replace', text: accountSummary(path, status, errorCode), key: `account:${path}` }
      }
    }
  }

  return { action: 'pass' }
}

export const DEFAULT_OPTIONS = Object.freeze({
  modelListing: true,
  alignPreserved: true,
  catalogFallback: true,
  accountNetwork: true,
})
