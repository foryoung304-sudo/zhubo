-- CP4 全量回归 wrapper · gaps（30 断言，四项 Lua 缺口按 Node 口径）
-- 输出改指 rebuild/cp4/，CP3 收据冻结不动。gaps 载 main.lua（无 dumpLog），无需 LOG_PATH 重定向。
-- 跑法：UrhoXRuntime.exe cp4_reg_gaps.lua -tapcode_dir=. -tool_mode -graphicsheadless -validate ...
local f = File("scripts/cp3_gaps_test.lua", FILE_READ)
if not f:IsOpen() then f = File("E:/taptap/zhubo/maker/scripts/cp3_gaps_test.lua", FILE_READ) end
assert(f:IsOpen(), "cp4 reg gaps: cp3_gaps_test.lua not found")
local src = f:ReadString()
f:Close()
src = src:gsub("rebuild/cp3/", "rebuild/cp4/")
assert(load(src, "@cp3_gaps_test.lua"))()