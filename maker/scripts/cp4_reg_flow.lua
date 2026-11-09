-- CP4 全量回归 wrapper · flow（33 断言，含去重后 scene6 + 回滚零残留/通关可达 scene7-9）
-- 输出改指 rebuild/cp4/，CP3 收据冻结不动；LOG_PATH/FPS_PATH 重定向 cp4 防污染 CP3 真窗日志。
-- 跑法：UrhoXRuntime.exe cp4_reg_flow.lua -tapcode_dir=. -tool_mode -graphicsheadless -validate ...
local f = File("scripts/cp3_flow_test.lua", FILE_READ)
if not f:IsOpen() then f = File("E:/taptap/zhubo/maker/scripts/cp3_flow_test.lua", FILE_READ) end
assert(f:IsOpen(), "cp4 reg flow: cp3_flow_test.lua not found")
local src = f:ReadString()
f:Close()
src = src:gsub("rebuild/cp3/", "rebuild/cp4/")
src = src:gsub(";local __origStart = Start", ";local __origStart = Start\nLOG_PATH = \"E:/taptap/zhubo/rebuild/cp4/reg_flow_playthrough_log.json\"\nFPS_PATH = \"E:/taptap/zhubo/rebuild/cp4/reg_flow_fps_preview.json\"")
assert(load(src, "@cp3_flow_test.lua"))()