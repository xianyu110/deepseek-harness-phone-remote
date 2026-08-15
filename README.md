# DeepSeek Harness 手机远程控制(Phone Remote)

通过 **Tailscale** 用手机安全地远程访问 PC 上的 DeepSeek Harness Web GUI,并内置一个**持久化文件/工作区插件**:手机上可以直接浏览、查看、编辑 PC 文件,以及在任何文件夹开始新的会话(解决手机端无法弹系统目录选择框的问题)。

> 部署包:一键部署(`一键部署.cmd`)→ 自动探测 Tailscale 信息 → 生成启动脚本 → 开启 Tailscale Serve(HTTPS)→ 安装持久插件 → 打印手机访问地址。

## 架构

```
手机 (OPPO / 任意 Android / iOS)
  │  Tailscale App(已登录同一 tailnet)
  ├─ https://<电脑名>.<tailnet>.ts.net      ← Tailscale Serve(HTTPS,推荐)
  └─ http://<TailscaleIP>:3080              ← 备用:TCP 转发器 tailscale_forward.js
        │
        ▼
PC(仅监听本机 + tailnet,不监听 0.0.0.0)
  ├─ 127.0.0.1:3080        dsh web(GUI,仅本机)
  └─ 100.x.y.z:3080        tailscale_forward.js → 转发到 127.0.0.1:3080
```

- Harness GUI 只绑定 `127.0.0.1`,局域网/公网默认不可达;
- 手机通过 **Tailscale WireGuard 加密隧道**访问,HTTPS 由 tailnet 证书提供;
- `/api` 与插件 RPC 走浏览器信任围栏:仅接受 loopback 与 `--trusted-host` 声明的主机。

## 功能

- **一键部署**:`install.ps1` 自动探测 Tailscale IP/域名、写入 `start_harness.ps1`、启用 `tailscale serve`、安装持久插件;
- **开机自启**:安装后每次登录自动拉起 Harness + 转发器 + 防睡眠;
- **手机文件工作台**:
  - 会话标签页:列出已有工作区一键打开;或在任意文件夹"在这里开始会话";
  - 文件标签页:浏览、面包屑导航、文本预览/编辑/下载、上传、图片预览;
  - 可访问目录管理(白名单,默认 `Documents`,可增减);
  - 侧边栏展开按钮、可拖动悬浮球(小屏适配);
- **持久化插件**:`remfs-persistent` 以 loader 条目方式常驻,刷新页面**无需重新运行**,host 通道 `/remfs` 随 Harness 启动即注册。

## 环境要求

| 项目 | 说明 |
|---|---|
| Windows + Node.js ≥ 18 | 运行 `dsh web` |
| Tailscale | 手机与 PC 登录同一账号,见 [tailscale.com/download](https://tailscale.com/download) |
| HTTPS Certificates | tailnet 后台开启:https://login.tailscale.com/admin/dns → Enable HTTPS Certificates |
| DeepSeek Harness | `npx dsh web` 启动过一次(用于生成 npx 缓存路径) |

## 一键部署

1. 在 PC 上双击 **`一键部署.cmd`**(或右键以管理员运行,便于读取 Tailscale IP / 配置 Serve);
2. 脚本自动完成:检查环境 → 读取 Tailscale 信息 → 生成 `%USERPROFILE%\.dsh\launcher\start_harness.ps1` → 开启 HTTPS Serve → 安装持久插件到 `%USERPROFILE%\.dsh\profiles\web` → 打印手机地址;
3. 手机:打开 Tailscale App(确保 **Connected**)→ 浏览器访问打印出的 `https://...ts.net`;
4. 以后开机自动运行;手动启停:
   - 启动:`%USERPROFILE%\.dsh\launcher\start_harness.ps1`
   - 重启:`%USERPROFILE%\.dsh\launcher\restart_harness_once.ps1`
   - 停止:`%USERPROFILE%\.dsh\launcher\stop_harness.ps1`(同时结束防睡眠,电脑恢复可休眠)

### install.ps1 具体做了什么

- 探测 Tailscale IP(`tailscale ip -4`)与 MagicDNS 域名,替换模板占位符生成 `start_harness.ps1`;
- 自动定位 npx 缓存中的 `dsh` 入口(`_npx` 哈希目录会随安装变化,不写死);
- `tailscale serve --bg http://127.0.0.1:3080` 开启 HTTPS;
- 把 `remfs-persistent`(host RPC 通道 + 浏览器模块)装入 web profile:
  - 源码 → `profiles\web\vendor\remfs-persistent\`,并链接/复制到 `node_modules\@zeta\remfs-persistent`;
  - 幂等写入 `profiles\web\cordis.patch.yml` 的 loader 条目(含 `inject: [connection, fs]`);
- 脚本统一安装到 `%USERPROFILE%\.dsh\launcher\`(**不在 Documents 内**,见安全章节)。

## ⚠️ 安全须知(务必阅读)

- **没有登录/密码/2FA。** GUI 与文件插件的信任边界 = **"能连上你 tailnet 的设备"**。任何加入该 tailnet 的设备都能无登录读写你的文件、驱动 agent 执行命令。**不要共享 tailnet、不要加未知设备、手机丢失请立即在 tailnet 后台移除该设备**。
- **允许目录只是 UI 护栏,不是安全边界。** "管理可访问目录"可以扩大到任意路径。
- **host 层保护路径(不可绕过):** 系统目录(`Windows`、`System Volume Information`、`$Recycle.Bin`、`Program Files`、`ProgramData` 等)、凭据/密钥文件(`.credentials.yaml`、`.ssh`、`id_rsa`、`*.pem/.key/.pfx`、`ntuser.dat`、C 盘系统 hive)、隐私数据目录(`xwechat_files`、`KingsoftData`、`WPSCloudSvr`、`Tencent Files`)。白名单扩到 `C:\` 也读不到这些。已注册工作区若位于受保护目录内(如微信文件工作区)仍可访问。
- **DeepSeek API Key** 明文位于 `%USERPROFILE%\.dsh\.credentials.yaml`。保护路径已拦截它;请勿把该文件放进任何会被上传的目录。
- 新会话默认权限为受限(`workspace-write` + 操作需确认);个别会话可按需切换,但请保持默认。
- 明文 HTTP 回退路径(`http://<IP>:3080`)仅用于 tailnet 内部(WireGuard 已加密),日常请用 HTTPS。

## 目录结构

```
dsh-remote/
├─ 一键部署.cmd              一键部署入口
├─ install.ps1               部署脚本(探测/生成/安装)
├─ start_harness.template.ps1  启动脚本模板(占位符由 install.ps1 填充)
├─ tailscale_forward.js      TCP 转发器(tailnet IP → 127.0.0.1:3080)
├─ restart_harness.ps1       重启(杀 3080 监听后重新拉起)
├─ stop_harness.ps1          停止 Harness + 转发器 + 防睡眠
├─ keep_awake.ps1            防睡眠(ES_SYSTEM_REQUIRED 循环)
└─ remfs-persistent/         持久插件(host RPC 通道 + 浏览器工作台)
   ├─ package.json           dsh.client 清单 + exports
   ├─ lib/host.js            /remfs RPC 通道(信任围栏 + 白名单 + 保护路径)
   └─ lib/client.js          手机工作台 UI(会话/文件双标签、toast、悬浮球)
```

## 常见问题

| 现象 | 处理 |
|---|---|
| 手机打不开页面 | 手机 Tailscale 是否 Connected;PC 侧 `start_harness.ps1` 是否已跑(3080 监听) |
| 手机访问显示 403 | 访问地址的 Host 不在信任列表;HTTPS 请用 `<电脑名>.<tailnet>.ts.net`,HTTP 用 PC 的 Tailscale IP |
| HTTPS 证书报错 | tailnet 后台开启 HTTPS Certificates 后重跑 install.ps1 |
| 手机端无法浏览某些目录 | 该目录不在白名单(可"管理可访问目录"添加);系统/凭据/隐私目录被保护路径硬性拦截 |
| 会话没反应/插件不见了 | 刷新页面(持久插件随页面自动加载,无需重新运行) |
| 升级 dsh 后启动失败 | npx 缓存路径变化,重跑一次 `一键部署.cmd` 重新探测 |

## 发布到 GitHub

```bash
# 1. 安装 GitHub CLI(如未安装)
winget install --id GitHub.cli

# 2. 登录
gh auth login

# 3. 创建并推送仓库(已在 dsh-remote 目录)
cd dsh-remote
git init
git add .
git commit -m "DeepSeek Harness phone remote access + persistent file plugin"
gh repo create dsh-phone-remote --public --source=. --push
```

发布前确认 `.gitignore` 生效(忽略 `*.log`、`.remfs-roots.json`、`*.pid`、`node_modules/`),仓库内不含任何真实 Tailscale IP、域名或本机路径(部署脚本使用占位符与自动探测)。

## License

MIT
