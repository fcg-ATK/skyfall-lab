# 崩塌实验室 · 动态散架版

面向手机浏览器的 3D 建筑破坏小游戏。使用 Three.js 和 WebGL 2，支持火箭、陨石、铁球三种撞击物，以及不对称失稳、楼体下压与持续散架。全部运行资源在仓库内，无外部 CDN、账号或后端服务依赖。

当前版本：v7。仓库：[fcg-ATK/skyfall-lab](https://github.com/fcg-ATK/skyfall-lab)。

计划试玩地址：[GitHub Pages](https://fcg-atk.github.io/skyfall-lab/)。首次部署完成后才可访问。

## 操作

- 单指拖动：环绕建筑并调整俯仰；双指捏合：缩放；双指整体上下移动：升降观察高度。
- 轻点建筑：选择撞击点。金色箭头显示发射方向，绕楼可以改变方向。
- 「瞄准」：设置撞击高度与倾角；正角度从高处俯射，可用的上仰角随高度变化。
- 火箭：高速贯穿与连锁爆破；陨石：大范围贯穿粉碎；铁球：集中重击贯穿。只有实际撞到建筑才造成损坏。
- 命中时短暂慢动作；本轮结束后可以继续观察废墟，也可以重建再试。
- 默认「平衡」最高 30 帧；「省电」降低像素与细粒并关闭实时阴影；「精细」最高 60 帧。持续运行缓慢时会自动降低画质。
- 电脑也支持鼠标拖动与滚轮。音效在首次主动操作后启用。

横竖屏均可使用。需要支持 WebGL 2 的现代浏览器；手机内置浏览器无法启动时，可以改用系统浏览器。若设备发热或掉帧，请切换「省电」。

## 本地运行

安装 Node.js 22 或更新版本。在仓库根目录运行：

```sh
node tools/serve.cjs
```

在浏览器打开 [本地预览](http://127.0.0.1:5178/)。停止服务时按 `Ctrl+C`。该服务仅监听本机。

不需要 `npm install` 或构建步骤。`dist/` 中的游戏 JavaScript、HTML、CSS 可以直接编辑，刷新页面即可看到结果。由于浏览器资源加载限制，请通过 HTTP 服务打开页面，不要直接双击 `index.html`。

运行自动检查：

```sh
node --test tests/*.test.cjs
```

测试覆盖规则、结构支撑、碎块数据与运动、三种发射物、打空零伤害、重置、音效触发、触控处理及固定资源预算。图形相关测试使用真实模型与 Three.js，但 WebGL 渲染器和部分浏览器对象使用替身；这些测试不验证真实 GPU 图像、浏览器触摸事件链或手机帧率。

## 发布到 GitHub Pages

仓库附带 `.github/workflows/deploy-pages.yml`：

1. 在仓库的 **Settings → Pages → Build and deployment** 中，把 **Source** 设为 **GitHub Actions**。
2. 向 `main` 分支推送更新，或在 **Actions → Deploy GitHub Pages → Run workflow** 手动运行。
3. 工作流先运行测试，再将完整 `dist/` 发布为网站。部署完成后，在 Pages 设置或工作流的 deployment 链接中打开网站。

详细配置见 [GitHub Pages 官方文档](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。普通静态托管服务也可以直接使用完整 `dist/` 文件夹；不要只上传入口 HTML 或压缩包。

## 目录

```text
dist/
  index.html / style.css / app.js  界面与输入
  engine.js                       游戏场景与运行循环
  physics.js / collapse-solver.js  规则、支撑与失稳
  structural-fragments.js          实体碎块与接触运动
  environment.js                  街区环境
  powder.js / impact-fx.js         细颗粒与撞击效果
  audio.js                        Web Audio 合成音效
  three-local.js                  本地 Three.js 核心
  three-addons-local.js            本地加载器等扩展
  assets/                         完整模型、碎块数据与纹理
  THIRD-PARTY-LICENSE.txt          保留的第三方许可全文
  THIRD-PARTY-NOTICES.md           当前实际使用范围与资源来源
tests/                            Node.js 自动检查
tools/serve.cjs                    本地静态预览服务
.github/workflows/deploy-pages.yml
LICENSE                           项目 MIT 许可
```

## 模型与物理边界

完整楼体分为 48 个结构区域，破碎时使用 3,337 块结构碎片与 2,296 块玻璃，共 5,633 块、194,181 个三角形。碎块继承建筑的平移与旋转，经过简化接触、滑动与滚动后保留为废墟，直至重建；渲染使用两批合并网格和共享变换纹理。

本项目采用游戏近似：支撑关系、承重连接、倾斜承托面和废墟堆积均经过简化，碎块之间没有逐对精确碰撞。它不用于建筑工程分析。帧率档位是上限，不代表所有设备都能达到；尚未完成真实 Android 与 iPhone 设备的帧率测量。

仓库提供运行所需的完整模型与纹理，可直接运行、修改游戏逻辑和替换兼容资产。原始 Blender/PC 制作工程及依赖这些工程的导出脚本没有随本仓库分发，因此本仓库不提供从原始 DCC 工程重建全部美术资源的流水线。资产格式与来源见 [建筑说明](dist/assets/ARCHITECTURAL-ASSETS.md)、[碎块说明](dist/assets/PC-FRAGMENTS.md) 和 [环境来源](dist/assets/env-SOURCES.md)。

## 贡献与许可

欢迎通过 Issue 报告问题或提交 Pull Request。报告手机问题时，请附上设备型号、系统与浏览器版本、画质档位、复现步骤及可选截图。修改游戏逻辑后请运行测试；涉及画面或触控的更改还应在浏览器中验证。新增第三方素材时请一并记录来源与适用许可。

本项目自有代码及随项目发布的自有内容采用 [MIT License](LICENSE)。第三方内容保持各自原有许可：Three.js 为 MIT，Poly Haven 纹理为 CC0。项目 MIT 许可不替代第三方许可，详见 [当前依赖及素材说明](dist/THIRD-PARTY-NOTICES.md) 与 [第三方许可全文](dist/THIRD-PARTY-LICENSE.txt)。