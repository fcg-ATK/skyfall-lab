# 当前第三方依赖与素材

本文件说明公开手机版本实际使用的内容及其许可。项目根目录的 MIT 许可不改变第三方内容的原有许可。

## Three.js

- 文件：`three-local.js`、`three-addons-local.js`。
- 核心包标识：Three.js r187；扩展随本地资源打包使用。
- 许可：MIT，Copyright 2010–2026 Three.js Authors。
- 上游：[Three.js](https://github.com/mrdoob/three.js)。
- 官方许可：[r187 LICENSE](https://github.com/mrdoob/three.js/blob/r187/LICENSE)。
- 此仓库使用适配本地命名空间的打包文件；原许可头与许可全文均保留。

## Poly Haven 纹理（CC0）

| 本地资源 | 原始资源及处理 |
| --- | --- |
| `assets/architectural-concrete.jpg`、`assets/architectural-concrete-normal.png`，以及建筑 GLB 内嵌贴图 | [Concrete](https://polyhaven.com/a/concrete)，缩小并调整纹理强度 |
| `assets/env-asphalt.jpg` | [Asphalt 02](https://polyhaven.com/a/asphalt_02)，缩小 |
| `assets/env-concrete.jpg` | [Asphalt 02](https://polyhaven.com/a/asphalt_02)，低对比度中性集料派生纹理 |
| `assets/env-city-light.jpg` | [Urban Street 01](https://polyhaven.com/a/urban_street_01)，由 HDR 转换为运行时环境纹理 |

Concrete 与 Asphalt 02 作者为 Rob Tuytel，Urban Street 01 作者为 Andreas Mischok。Poly Haven 的资产许可为 [CC0，官方说明](https://polyhaven.com/license)，参见 [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/)。纹理的调整不改变原素材的许可。

## 项目内容与历史许可记录

建筑及预切碎块由本项目已有制作工程导出。环境几何、道路标线与安全隔离设施由项目代码生成；当前碰撞及爆炸声效由 `audio.js` 通过 Web Audio 合成。

`THIRD-PARTY-LICENSE.txt` 原样保留原项目的许可记录与全文，其中还包含电脑版历史使用的 Rapier、MPFB/MakeHuman 角色和人声录音说明。当前手机版本的运行文件不包含 Rapier、人物模型或该人声录音，也不在运行时请求这些内容；这些历史条目不表示本版本依赖它们。保留记录不会把任何第三方内容重新许可为本项目的 MIT。
