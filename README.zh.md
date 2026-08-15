# DeepSeek Harness 手机远程控制(Phone Remote)

[English](README.md) | **中文**

通过 **Tailscale** 用手机安全地远程访问 PC 上的 DeepSeek Harness Web GUI,并内置一个**持久化文件/工作区插件**:手机上可以直接浏览、查看、编辑 PC 文件,以及在任何文件夹开始新的会话(解决手机端无法弹系统目录选择框的问题)。

> 部署包:一键部署(`一键部署.cmd`),基于 **Tailscale** → 自动安装缺失的 Node.js / Tailscale(winget,弹 UAC 点"是")→ 引导你完成一次性的 Tailscale 账号登录(唯一手动步骤)→ 自动探测 Tailscale 信息 → 生成启动脚本 → 开启 Tailscale Serve(HTTPS)→ 安装持久插件 → 打印手机访问地址。

## 为什么需要它

- Harness GUI 只绑定 `127.0.0.1`,手机直连不了;
- GUI 的目录选择器是特权方法、仅限本机,手机端弹不出;
- 普通会话随页面消失——本插件是**持久化 loader 条目**,每次打开页面自动加载,无需重新运行。

## 功能

- **一键部署(自动装依赖)**:`install.ps1` 自动安装缺失的 **Node.js** 和 **Tailscale**(winget,弹 UAC 点"是"),引导一次性 Tailscale 登录,然后自动探测 IP/域名、写入 `start_harness.ps1`、启用 `tailscale serve`、安装持久插件;
- **开机自启**:每次登录自动拉起 Harness + 转发器 + 防睡眠;
- **持久化插件**:`remfs-persistent` 以 loader 条目常驻,host 通道 `/remfs` 随 Harness 启动注册,客户端模块随页面加载——刷新无需重新运行;
- **双语界面**:英文 / 中文(自动跟随浏览器语言,工作台头部可切换,记忆选择)。

### 手机端 UI 优化(针对小屏专项适配)

- **侧边栏自动收起**:小屏下 Harness 侧边栏/详情栏自动折叠,会话区占满全宽;屏幕上有一个可**拖动到任意位置的 ☰ 悬浮球**,点一下展开侧边栏、再点一下收起,单手可操作;
- **双标签工作台**:`＋ 新建会话` / `📁 文件浏览` 一个面板搞定,可从会话头部或设置里打开;
- **面包屑导航**:点任意路径段直接跳转;另有**绝对路径输入框 + Go**(手机端弹不出系统目录选择框,这是进入任意目录的方式);
- **toast 反馈**:保存/上传/开始会话/出错等每个操作都有顶部提示;
- **★ 工作区徽标**:已注册工作区的文件夹在列表里带星标,当前目录是工作区时头部也显示;
- **会话标签页文件置灰**:在"新建会话"页点文件会自动跳到"文件浏览"并预览,保证会话页专注在文件夹上;
- **隐藏系统目录**:默认隐藏系统保护目录,⋯ 菜单里可开关;
- **响应式 CSS**:≤700px 自动折叠侧栏,工作台面板适配窄屏。

### 手机读取 PC 本地文件

- **浏览**白名单根目录(默认 `Documents`),面包屑逐级跳转;
- **预览**:文本、图片直接内联预览;二进制文件可**下载**(5MB 上限);
- **编辑**文本文件并保存回 PC;
- **上传**手机里的文本文件到任意允许目录;
- **保护路径**:系统目录、凭据/密钥文件(`.credentials.yaml`、`.ssh`、`id_rsa`、`*.pem` 等)、隐私数据目录(微信/WPS 数据)由 host 层硬性拦截,与白名单无关(见安全章节)。

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

## 实测设备

| 设备 | 屏幕 | 状态 |
|---|---|---|
| OPPO Find X8 Ultra | ~1440×3168 | ✅ 主力测试设备 |
| 其他设备 / 分辨率 | — | 🚧 计划中 |

布局为流式(自适应栅格),但仍在验证更多分辨率。遇到布局问题欢迎开 issue,附上设备型号 + 屏幕分辨率。

## 环境要求

| 项目 | 说明 |
|---|---|
| Windows 10/11 | 64 位;winget 可用(Win11 自带) |
| Node.js ≥ 18 | **一键部署自动安装**(缺失时) |
| Tailscale | **一键部署自动安装**;你只需注册一个自己的(免费)Tailscale 账号——[tailscale.com](https://tailscale.com) |
| HTTPS Certificates | tailnet 后台开启:https://login.tailscale.com/admin/dns → Enable HTTPS Certificates |
| DeepSeek Harness | `npx dsh web` 启动过一次(用于生成 npx 缓存路径) |

## 从 npm 安装

插件已发布到 npm:**[@zetaluolang/remfs-persistent](https://www.npmjs.com/package/@zetaluolang/remfs-persistent)**。如果已有 `dsh web` profile:

```bash
# 1. 把包装进 web profile
dsh plugin --profile web add @zetaluolang/remfs-persistent

# 2. 注册 loader 行(追加到 %USERPROFILE%\.dsh\profiles\web\cordis.patch.yml)
# - insert:
#     - id: remfs-persistent
#       name: '@zetaluolang/remfs-persistent'
#       inject: [connection, fs]

# 3. 重启 dsh web,打开 GUI——工作台出现在会话头部
```

或者直接用下面的一键部署,全自动完成。

## 一键部署

1. 在 PC 上双击 **`一键部署.cmd`**(建议右键"以管理员身份运行",自动安装依赖时需要);
2. 脚本自动安装缺失的 **Node.js** 和 **Tailscale**(winget,弹 UAC 就点"是";需要联网,稍等一两分钟);
3. 如果 Tailscale 还没登录,脚本会打开登录页并**停下来等你**:用自己的(免费)Tailscale 账号登录;同时给**手机**也装上 Tailscale App 并用**同一个账号**登录。完成后按回车;
4. 脚本继续:生成 `%USERPROFILE%\.dsh\launcher\start_harness.ps1` → 开启 HTTPS Serve → 安装持久插件到 `%USERPROFILE%\.dsh\profiles\web` → 打印手机地址;
5. 手机:打开 Tailscale App(确保 **Connected**)→ 浏览器访问打印出的 `https://...ts.net`;
6. 以后开机自动运行;手动启停:
   - 启动:`%USERPROFILE%\.dsh\launcher\start_harness.ps1`
   - 重启:`%USERPROFILE%\.dsh\launcher\restart_harness_once.ps1`
   - 停止:`%USERPROFILE%\.dsh\launcher\stop_harness.ps1`(同时结束防睡眠,电脑恢复可休眠)

### install.ps1 具体做了什么

- 探测 Tailscale IP(`tailscale ip -4`)与 MagicDNS 域名,替换模板占位符生成 `start_harness.ps1`;
- 自动定位 npx 缓存中的 `dsh` 入口(`_npx` 哈希目录会随安装变化,不写死);
- `tailscale serve --bg http://127.0.0.1:3080` 开启 HTTPS;
- 把 `remfs-persistent`(host RPC 通道 + 浏览器模块)装入 web profile:
  - 源码 → `profiles\web\vendor\remfs-persistent\`,并链接/复制到 `node_modules\@zetaluolang\remfs-persistent`;
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

## Roadmap

- [x] Tailscale HTTPS + 转发器访问
- [x] 持久化插件(无需每次运行)
- [x] 双语界面(EN / 中文)
- [x] host 层保护路径拒绝清单
- [ ] 更多设备分辨率验证
- [ ] Tailscale ACL 加固指南
- [ ] README 配图

## License

MIT
