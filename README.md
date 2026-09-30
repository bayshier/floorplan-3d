# 🏠 户型装修设计 · 2D/3D

纯前端的户型装修设计工具：在 **2D 平面图**上摆放家具、拆改非承重墙，一键切换 **Three.js 3D 场景**——可以鸟瞰整套户型，也可以第一人称漫游。

单页应用，无构建，打开即用。

**🎮 在线使用**：<https://bayshier.github.io/floorplan-3d/>

> Three.js 通过 jsDelivr CDN 加载，首次进入 3D 场景需要联网；2D 编辑完全离线可用。

## ✨ 功能

**2D 平面布置**
- 内置两室两厅示例户型（mm 标注），房间自动统计面积
- 家具库 23 种（卧室 / 客厅 / 餐厨 / 卫浴 / 书房），点击添加、拖动摆放
- 旋转（R 90°，按钮 ±15°）、复制（Ctrl+D）、删除
- 📐 测量工具、🔨 拆改非承重墙（承重墙带斜纹标示、不可拆）
- 网格 / 房间名 / 家具标签随缩放自适应

**3D 场景**
- 鸟瞰（OrbitControls）与**第一人称漫游**（WASD + 鼠标视角；触屏左半屏摇杆 + 右半屏转向）
- 日照时间滑块（太阳方位随时间移动，实时投影）+ 夜景模式（暖光点灯）
- 全高墙 / 剖切墙切换
- 参数化家具建模：床品、沙发软包、马桶、淋浴房、绿植、发光电视…
- 点击右侧房间列表飞到对应房间

**方案与统计**
- 房间面积 / 套内使用面积自动统计
- 每个房间可换地板材料（木地板、地砖、大理石、水磨石、地毯），按面积加 5% 损耗估算造价
- 撤销 / 重做（Ctrl+Z / Ctrl+Shift+Z），方案自动保存浏览器本地
- 导出 / 导入方案 JSON，导出 PNG

## 🚀 快速开始

```bash
git clone https://github.com/bayshier/floorplan-3d.git
cd floorplan-3d
python3 -m http.server 8000
# 访问 http://localhost:8000
```

也可直接访问线上地址。Three.js 走 CDN，2D 编辑离线可用。

## ⌨ 快捷键

| 按键 | 作用 |
| --- | --- |
| `T` | 切换 2D / 3D |
| `V` / `M` / `X` | 选择 / 测量 / 拆墙 |
| `R` / `Shift+R` | 选中家具顺 / 逆时针旋转 90° |
| `Delete` / `Backspace` | 删除选中家具 |
| `Ctrl/⌘ + D` | 复制选中家具 |
| `Ctrl/⌘ + Z`，`Ctrl/⌘ + Shift + Z` | 撤销，重做 |
| `F` | 适应窗口 |
| `Esc` | 退出漫游 / 取消工具 |

漫游：`WASD` 或方向键移动，`Shift` 快走，`Esc` 退出。

## 📁 结构

```
floorplan-3d/
├── index.html     页面 + 2D 编辑器 + UI（内联）
└── js/scene3d.js  Three.js 3D 场景模块
```

## 📄 说明与致谢

- 灵感致敬 [wy51ai/floorplan-3d](https://github.com/wy51ai/floorplan-3d)（该仓库未附许可证）。
  本项目为**独立净室实现**：全部代码从零编写，未复制原仓库的任何代码与素材。
- 本仓库代码以 MIT License 提供。

---

✍ **Easin** · [GitHub](https://github.com/bayshier) · [主页](https://bayshier.github.io/GYZApp/easin.html)
