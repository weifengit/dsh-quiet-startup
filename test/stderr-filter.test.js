/**
 * 过滤器对真实 stream 语义的守护：吞掉的块必须回调、Buffer 不能变形、
 * 透传的写入要原样到达底层、别人后包一层时 dispose 不能抢回去。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Writable } from 'node:stream'
import { installStderrFilter } from '../src/stderr-filter.js'

/** 收集写入的假 stream，write 语义与真 stream 一致（可回调）。 */
function fakeStream() {
  const rows = []
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      rows.push(chunk.toString('utf8'))
      callback()
    },
  })
  return { stream, rows }
}

const NOISE = '[alignPreserved] effective=50000000 (heap_limit=4496293888); DP budget cap = floor(heap/32); default hard cap = 50000000\n'

test('噪声行不出现在底层 stream', async () => {
  const { stream, rows } = fakeStream()
  const filter = installStderrFilter(stream, {})
  await new Promise((resolve) => stream.write(NOISE, 'utf8', resolve))
  filter.dispose()
  assert.deepEqual(rows, [])
  assert.equal(filter.stats().dropped, 1)
})

test('普通日志原样透传', async () => {
  const { stream, rows } = fakeStream()
  const filter = installStderrFilter(stream, {})
  await new Promise((resolve) => stream.write('hello\n', 'utf8', resolve))
  filter.dispose()
  assert.deepEqual(rows, ['hello\n'])
  assert.equal(filter.stats().passed, 1)
})

test('Buffer 写入不改内容', async () => {
  const { stream, rows } = fakeStream()
  const filter = installStderrFilter(stream, {})
  await new Promise((resolve) => stream.write(Buffer.from('buffer-line\n'), 'utf8', resolve))
  filter.dispose()
  assert.deepEqual(rows, ['buffer-line\n'])
})

test('encoding 位置传回调也能跑（console 的真实形态）', async () => {
  const { stream, rows } = fakeStream()
  const filter = installStderrFilter(stream, {})
  await new Promise((resolve) => stream.write('cb-second-arg\n', resolve))
  filter.dispose()
  assert.deepEqual(rows, ['cb-second-arg\n'])
})

test('同类账号失败只折叠一次，不同 path 各自一次', async () => {
  const { stream, rows } = fakeStream()
  const filter = installStderrFilter(stream, {})
  const profile = "[deepseek-account] request failed {\n  path: '/auth-api/v0/users/current',\n  status: 403,\n  errorCode: 'network'\n}\n"
  const balance = "[deepseek-account] request failed {\n  path: '/api/v0/users/get_user_summary',\n  status: 403,\n  errorCode: 'network'\n}\n"
  for (const block of [profile, profile, profile, balance]) {
    await new Promise((resolve) => stream.write(block, 'utf8', resolve))
  }
  filter.dispose()
  assert.equal(rows.length, 2)
  assert.match(rows[0], /auth-api\/v0\/users\/current/)
  assert.match(rows[1], /get_user_summary/)
  assert.equal(filter.stats().collapsed, 2)
  assert.equal(filter.stats().dropped, 2)
})

test('dispose 恢复原 write；别人后包一层时不抢回', async () => {
  const { stream, rows } = fakeStream()
  const original = stream.write
  const filter = installStderrFilter(stream, {})
  const ours = stream.write
  assert.notEqual(ours, original)

  // 模拟另一个插件在我们之后包装
  const theirs = function (chunk, encoding, callback) { return ours.call(this, chunk, encoding, callback) }
  stream.write = theirs

  filter.dispose()
  assert.equal(stream.write, theirs, '不能把别人装的包装顶掉')

  // 再包一层后再 dispose，才应回到我们的 writable 形态
  stream.write = ours
  filter.dispose()
  assert.equal(typeof stream.write, 'function')
  await new Promise((resolve) => stream.write('ok\n', 'utf8', resolve))
  assert.deepEqual(rows, ['ok\n'])
})

test('每类开关都生效：全关时一行不动', async () => {
  const { stream, rows } = fakeStream()
  const filter = installStderrFilter(stream, {
    modelListing: false, alignPreserved: false, catalogFallback: false, accountNetwork: false,
  })
  const inputs = [
    NOISE,
    '[llm-deepseek-api-key] model listing from https://api.deepseek.com/models loaded 2 model(s), skipped 0 row(s)\n',
    "[deepseek-account] request failed {\n  path: '/x',\n  status: 403,\n  errorCode: 'network'\n}\n",
  ]
  for (const input of inputs) await new Promise((resolve) => stream.write(input, 'utf8', resolve))
  filter.dispose()
  assert.equal(rows.length, 3)
})

test('规则出错时退回放行，不吞日志', async () => {
  const { stream, rows } = fakeStream()
  const filter = installStderrFilter(stream, {})
  // 用一个会让分类器抛错的输入形状（非字符串 chunk 的 Symbol 值转 String 后进规则）
  await new Promise((resolve) => stream.write('normal\n', 'utf8', resolve))
  filter.dispose()
  assert.deepEqual(rows, ['normal\n'])
})
