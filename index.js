/**
 * dsh-quiet-startup — 把启动期那些「有用信息为零、噪音量极大」的 stderr 行收掉。
 *
 * 为什么需要独立插件：这些输出全部由**别人**的代码直接写 stderr，不经 ctx.logger，
 * 也没有配置开关（核心包 dsh-llm-deepseek / dsh-deepseek-account 是硬编码
 * console.error；hashline、our-free-model 是第三方包）。宿主不提供日志级别，
 * 唯一能覆盖全部写入点的地方就是 stderr 本身。
 *
 * 收什么、为什么可以收，见 src/rules.js 的清单；真错误一律放行。
 * 本插件只碰 stderr，不碰 stdout（ACP 模式把 stdout 留给协议），也不改任何业务行为。
 *
 * @module dsh-quiet-startup
 */

import { installStderrFilter } from './src/stderr-filter.js'

export const name = 'dsh-quiet-startup'

/** 进程级只装一次：多个 profile 行挂同一个插件时，第二层会重复包装。 */
let installed

export function apply(ctx, config = {}) {
  if (installed === undefined) {
    installed = installStderrFilter(process.stderr, config)
    ctx.effect(() => () => {
      installed?.dispose()
      installed = undefined
    }, 'quiet-startup: stderr filter')
  }
}
