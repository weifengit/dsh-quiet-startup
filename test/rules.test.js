/**
 * 分类规则的单测：每条规则都要有「该收」与「不该收」两个方向。
 *
 * 最重要的那条是「expired 必须放行」——收掉登录失效提示等于让用户对着一个
 * 静默坏掉的账号面板干瞪眼。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classify, DEFAULT_OPTIONS } from '../src/rules.js'

const on = { ...DEFAULT_OPTIONS }

test('model listing 成功行被收掉', () => {
  assert.deepEqual(
    classify('[llm-deepseek-api-key] model listing from https://api.deepseek.com/models loaded 2 model(s), skipped 0 row(s)', on),
    { action: 'drop' },
  )
  assert.equal(
    classify('[llm-deepseek-account] model listing from https://api.deepseek.com/models loaded 2 model(s), skipped 0 row(s)', on).action,
    'drop',
  )
})

test('model listing 失败行放行（那是真错误）', () => {
  const verdict = classify('[llm-deepseek-api-key] model listing from https://api.deepseek.com/models failed (Error: ECONNRESET); using the bundled catalog', on)
  assert.equal(verdict.action, 'pass')
})

test('alignPreserved 调参日志被收掉', () => {
  assert.deepEqual(
    classify('[alignPreserved] effective=50000000 (heap_limit=4496293888); DP budget cap = floor(heap/32); default hard cap = 50000000', on),
    { action: 'drop' },
  )
})

test('cline 目录回退被收掉', () => {
  assert.deepEqual(
    classify('[cline] models.dev 目录拉取失败（缺的模型与图片能力退回本地兜底表）：The operation was aborted due to timeout', on),
    { action: 'drop' },
  )
})

test('账号 network 失败折叠成一句人话，且只显示一次', () => {
  const block = "[deepseek-account] request failed {\n  path: '/auth-api/v0/users/current',\n  status: 403,\n  errorCode: 'network'\n}\n"
  const verdict = classify(block, on)
  assert.equal(verdict.action, 'replace')
  assert.equal(verdict.key, 'account:/auth-api/v0/users/current')
  assert.match(verdict.text, /账号接口暂不可用/)
  assert.match(verdict.text, /HTTP 403/)
  assert.ok(!verdict.text.includes('token'), '解释里不能带凭证')
})

test('no-response 走另一句解释', () => {
  const block = "[deepseek-account] request failed {\n  path: '/api/v0/users/get_user_summary',\n  errorCode: 'no-response',\n  aborted: false\n}\n"
  const verdict = classify(block, on)
  assert.equal(verdict.action, 'replace')
  assert.match(verdict.text, /没有响应/)
})

test('expired（登录态失效）绝不收', () => {
  const block = "[deepseek-account] request failed {\n  path: '/auth-api/v0/users/current',\n  status: 401,\n  errorCode: 'expired'\n}\n"
  assert.equal(classify(block, on).action, 'pass')
})

test('response rejected / schema rejected 一律放行', () => {
  assert.equal(classify('[deepseek-account] response rejected {\n  path: \'/x\',\n  stage: \'parse-json\'\n}', on).action, 'pass')
  assert.equal(classify('[deepseek-account] profile schema rejected { issues: [] }', on).action, 'pass')
})

test('未知日志原样放行', () => {
  assert.equal(classify('[dsh-remote-anynet] 远程接入已就绪: http://192.168.1.5:3080（管理与说明见 /remote-anynet）', on).action, 'pass')
  assert.equal(classify('error: unknown option \'--patch\'', on).action, 'pass')
})

test('每类都能单独关掉', () => {
  assert.equal(classify('[alignPreserved] effective=1 (heap_limit=2); DP budget cap = floor(heap/32); default hard cap = 3', { ...on, alignPreserved: false }).action, 'pass')
  assert.equal(classify('[llm-deepseek-api-key] model listing from https://api.deepseek.com/models loaded 2 model(s), skipped 0 row(s)', { ...on, modelListing: false }).action, 'pass')
  const block = "[deepseek-account] request failed {\n  path: '/x',\n  status: 403,\n  errorCode: 'network'\n}"
  assert.equal(classify(block, { ...on, accountNetwork: false }).action, 'pass')
})
