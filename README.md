# dsh-quiet-startup

DSH 启动时会把几类**已知的、不影响功能**的信息写到 stderr，而且都没有开关可关：

| 输出 | 来源 | 为什么可以收 |
|---|---|---|
| `[llm-deepseek-api-key\|-account] model listing ... loaded 2 model(s)` | `@deepseek-ai/dsh-llm-deepseek` 的 `host.ts` 里硬编码 `console.error` | 成功信息，两条路由各打一次，每次目录刷新都重复 |
| `[alignPreserved] effective=… DP budget cap = …` | `dsh-hashline-edittool` 的 `align-bounded.js` | 一次性调参日志（0.11.4 仍在打） |
| `[cline] models.dev 目录拉取失败…` | `dsh-our-free-model` 内置 pack | 已退回本地兜底表，模型清单不缺 |
| `[deepseek-account] request failed { status: 403, errorCode: 'network' }` | `@deepseek-ai/dsh-deepseek-account` 的 `protocol.ts` | 真的失败，但同一端点每次轮询都打一条；收敛成一句人话并去重 |

这些行全部由**别人的代码**直接写 stderr，不经 `ctx.logger`，宿主也没有日志级别。唯一能覆盖所有写入点的位置就是 stderr 本身，所以用一个极小的宿主插件在进程出口处按文案归类。

## 不放行的（故意的）

- `errorCode: 'expired'`（登录态失效）——用户必须处理，收掉等于让账号面板静默坏掉；
- `response rejected` / `schema rejected` / `model listing ... failed`；
- 任何没进清单的输出：默认原样透传，逐字节不改。

## 安装

```bash
cd ~/.dsh/profiles/web
pnpm add link:$HOME/code/dsh-quiet-startup
```

再把包名加进 `package.json` 的 `dsh.profile.bundles`，重启 `dsh web`。
不想要时从 bundles 里删掉即可，插件不留任何持久化状态。

## 配置

`cordis.patch.yml` 里那一行可带 config，四类各自可关（默认全开）：

```yaml
- insert:
    - id: quiet-startup
      name: dsh-quiet-startup
      config:
        modelListing: true      # 成功日志
        alignPreserved: true    # DP 预算调参日志
        catalogFallback: true   # models.dev 目录回退
        accountNetwork: true    # 账号接口网络失败折叠
```

## 设计要点

- **只碰 stderr**：stdout 在 ACP 模式下留给协议。
- **写入语义一致**：Buffer 原样透传、`encoding` 位可以是回调、被吞掉的块也异步回调（否则 `await` 写入的调用方会挂住）。
- **不抢别人的包装**：`dispose` 只在最外层仍是我们时才恢复原 `write`。
- **自己出错就放行**：分类器抛异常时退回原样输出，绝不静默吞日志。

## 测试

```bash
node --test "test/*.test.js"
```
