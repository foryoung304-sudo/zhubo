-- CP4 全量回归 wrapper · meme（11 断言）+ 全套意图审计（941/1320/459）
-- 输出改指 rebuild/cp4/（meme_test.json + intent_audit.json），CP3/CP2 收据与工具冻结不动。
-- 跑法：UrhoXRuntime.exe cp4_reg_meme.lua -tapcode_dir=. -tool_mode -graphicsheadless -validate ...
local f = File("scripts/cp3_meme_test.lua", FILE_READ)
if not f:IsOpen() then f = File("E:/taptap/zhubo/maker/scripts/cp3_meme_test.lua", FILE_READ) end
assert(f:IsOpen(), "cp4 reg meme: cp3_meme_test.lua not found")
local src = f:ReadString()
f:Close()
src = src:gsub("rebuild/cp3/", "rebuild/cp4/")
assert(load(src, "@cp3_meme_test.lua"))()