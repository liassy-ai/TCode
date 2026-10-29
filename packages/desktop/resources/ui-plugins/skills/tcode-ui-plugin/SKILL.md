---
name: tcode-ui-plugin
description: TCode 桌面端 UI 插件（替换槽位组件）。当用户想改聊天界面里某个组件的样子或行为（工具调用卡、子代理卡、任务列表面板）时使用，比如「改 XX 的样式 / 让 XX 变成 YY / 给 XX 加个功能 / DIY 界面 / 界面能改什么 / 换个视觉风格」。做法：按 SPEC 在 ~/.tcode/ui-plugins/ 下写插件，保存即热重载；最后引导用户在设置里启用。
---

# TCode UI 插件

用户想让聊天界面里的某个组件（工具调用卡、子代理卡、任务列表面板）样子或行为不同时，用 UI 插件。写一个 TSX 插件覆盖对应槽位，宿主会自动构建并热重载。

## 步骤

1. 读规范：~/.tcode/ui-plugins/SPEC.md（槽位表、props 契约、硬约束、样式纪律）和 ~/.tcode/ui-plugins/tcode-ui.d.ts（类型）。两个文件随应用附带。
2. 建插件：在 ~/.tcode/ui-plugins/<name>/ 下创建。该路径是宿主建的软链接，指向 userData 里的真实目录。
   - <name>/plugin.json：name 必须等于目录名，tcodeUi:1，slots 声明覆盖的槽位。
   - <name>/src/index.tsx：入口。用 memo 包裹，只用语义 token，只 import react、@tcode/plugin-api 和相对路径图片。
   - 最快：复制 ~/.tcode/ui-plugins/_examples/terminal-tool-card/ 再改。
3. 保存即构建：宿主监听文件系统，300ms 防抖后自动重建。语法或 import 出错时旧版本继续生效，设置面板显示「构建失败」，改好再存。
4. 引导用户启用（必须，agent 不能代劳，信任门）：让用户打开「设置 → UI 插件」，开总开关，点「启用」，确认。界面立即替换。
5. 迭代：用户确认生效后，继续改 src/index.tsx，保存即热替换，不用重启，也不用重新启用。

## 硬约束（违反就要返工）

- 只能 import react 和 @tcode/plugin-api。其他 npm 包一律禁止，否则构建直接失败。
- 图片例外：用相对路径 import .png、.webp、.gif、.jpg 会被构建器内联成 data URL（素材导入前缩到显示尺寸的 2 倍）。
- 不能用 Node API、fetch、localStorage、window.pi。插件只能访问 window.TcodeUI。
- 只用语义 token（bg-surface、text-ink、border-border 等）。禁止写死 zinc 或白色。深色和浅色主题都要验证。
- 导出的组件必须用 React.memo 包裹。
- plugin.json 的 name 必须匹配 /^[a-z0-9][a-z0-9-]*$/ 且等于目录名。slots 的键必须是 SPEC 表里的槽位名。
