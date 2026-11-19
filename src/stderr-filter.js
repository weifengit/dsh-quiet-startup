/**
 * 在进程出口处拦 stderr 写入。
 *
 * 为什么是 stderr：console.log 走 stdout（ACP 模式把它留给协议），而
 * console.error / console.warn / process.emitWarning 都落到 stderr——
 * 前面那些噪声全部在这里，一个入口就能覆盖。
 *
 * 写入语义必须和原 stream 一致：Buffer 原样透传、encoding 可以是回调、
 * 被吞掉的块也要异步回调，否则调用方 await callback 的代码会挂住。
 */

import { classify, DEFAULT_OPTIONS } from './rules.js'

/**
 * 归一化配置：只认布尔，缺省按默认开。
 * @param {Record<string, unknown> | undefined} config - 插件配置。
 * @returns {typeof DEFAULT_OPTIONS} 完整开关表。
 */
export function resolveOptions(config) {
  const resolved = { ...DEFAULT_OPTIONS }
  for (const key of Object.keys(DEFAULT_OPTIONS)) {
    const value = config?.[key]
    if (typeof value === 'boolean') resolved[key] = value
  }
  return resolved
}

/**
 * 安装过滤器。
 * @param {NodeJS.WriteStream | { write: Function }} stream - 目标流，测试可传假流。
 * @param {Record<string, unknown>} [config] - 开关表。
 * @returns {{ dispose: () => void, stats: () => Record<string, number> }} 卸载与计数。
 */
export function installStderrFilter(stream, config) {
  const options = resolveOptions(config)
  const original = stream.write
  const onceSeen = new Set()
  const stats = { dropped: 0, collapsed: 0, passed: 0 }

  /** 被吞/被替换的块也要像真写入一样回调，避免调用方等不到完成。 */
  const settle = (callback) => {
    if (typeof callback === 'function') queueMicrotask(() => callback())
    return true
  }

  const write = function patchedWrite(chunk, encoding, callback) {
    const cb = typeof encoding === 'function' ? encoding : callback
    const text = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)

    let verdict
    try {
      verdict = classify(text, options)
    } catch {
      // 过滤器自己出错绝不能吞掉日志：退回原样放行。
      verdict = { action: 'pass' }
    }

    if (verdict.action === 'drop') {
      stats.dropped += 1
      return settle(cb)
    }
    if (verdict.action === 'replace') {
      if (onceSeen.has(verdict.key)) {
        stats.dropped += 1
        return settle(cb)
      }
      onceSeen.add(verdict.key)
      stats.collapsed += 1
      return original.call(stream, `${verdict.text}\n`, 'utf8', cb)
    }

    stats.passed += 1
    return original.call(stream, chunk, encoding, callback)
  }

  stream.write = write

  return {
    dispose() {
      // 别人在我们之后又包了一层时不要抢回去，否则会把它的包装顶掉。
      if (stream.write === write) stream.write = original
    },
    stats: () => ({ ...stats }),
  }
}
