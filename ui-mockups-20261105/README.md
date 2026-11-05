# UI 示例图（2026-11-05）

本目录四张 `.webp` 文件受上传通道限制，内容是 **base64 文本**，不是二进制图片，直接打开会看到乱码文本。内容完整无损，解码即得原图：

- Windows PowerShell：`[IO.File]::WriteAllBytes('01-creation.webp', [Convert]::FromBase64String((Get-Content '01-creation.webp' -Raw)))`（先改名备份原文件再写回同名）
- 或任意 base64 在线/本地工具解码后另存为同名 `.webp`。

四张分别为：01 开局加点、02 直播主屏、03 事件卡（含时机条）、04 图鉴收集页。口径以 `maker-zhubo-ui-research-20261105.md` 简报为准：图三选项下的数字与简报「只亮维度不给数字」冲突，以简报为准，图只作版式与氛围参考；图四色板偏金藏青，整套底色统一粉紫家族。
