# 《从小主播到顶流》Maker 可玩版工程归档

本目录为 TapTap Maker / UrhoX 客户端可玩版完整工程资产归档，对齐阶段 2 验收与 Orange 六轮复核裁定（commit `d2527b5`）。

---

## 1. 目录结构

```
zhubo/maker/
├── assets/
│   └── data/                       # 冻结版 JSON 数据集（对齐 zhubo/data/）
│       ├── cards.json              # 213 张事件卡
│       ├── config_and_screens.json # 九屏配置、主线闸门、排班与全局规则
│       ├── endings_and_talents.json# 50 结局与前世天赋映射
│       └── state_dictionary.json   # 37 个状态变量字典与快照定义
├── Data/                           # UrhoX 资源挂载锚点（内含 .gitkeep，杜绝挂载报错）
├── scripts/                        # 客户端 Lua 源码
│   ├── main.lua                    # 九屏流转、NanoVG 时机条、翻样辨真、快照回滚主逻辑
│   ├── spike_timing_retest.lua     # 时机条扫条测试
│   ├── test_playable_full_loop.lua # 客户端 9 屏无头走测脚本
│   └── test_time.lua               # 时间步进基准测试
└── play_zhubo.bat                  # 一键自验启动脚本（双击或终端运行）
```

---

## 2. 启动与试玩方式

### 方式 A：双击一键运行（推荐）
直接双击运行 `play_zhubo.bat`。

脚本会自动：
1. 检查并确保本地 `Data/` 目录存在；
2. 自动定位引擎 `UrhoXRuntime.exe`（优先查找本地 `.cli\`，其次查找同级 `maker-demo-clone\.cli\`，再次查找系统 `PATH`）；
3. 携带 `-tool_mode` 和 `-tapcode_dir=.` 参数启动游戏窗口，绝不闪退或报 `Failed to add resource path 'Data'`。

### 方式 B：终端命令行启动
在 `maker` 目录或工程根目录下执行：
```powershell
# 若本地有 UrhoXRuntime.exe
.\.cli\UrhoXRuntime.exe scripts\main.lua -tapcode_dir=. -tool_mode

# 或引用开发套件运行
e:\taptap\maker-demo-clone\.cli\UrhoXRuntime.exe scripts\main.lua -tapcode_dir=. -tool_mode
```

### 方式 C：无头自动化验证
验证客户端全量逻辑与断言：
```powershell
e:\taptap\maker-demo-clone\.cli\UrhoXRuntime.exe scripts\test_playable_full_loop.lua -tapcode_dir=. -tool_mode -validate
```
