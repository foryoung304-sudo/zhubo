-- CP3 四项实玩 Lua 缺口修复 · 引擎级无头断言（Node 为准绳）
-- 装载 main.lua 源码 + 同作用域钩子；断言在 Start 覆盖里跑（main Start 先加载冻结数据/重置状态），
-- 直驱 selectCardOption / settleCurrentChapter，逐条验落支与状态写入。
-- 跑法：UrhoXRuntime.exe cp3_gaps_test.lua -tapcode_dir=. -tool_mode -graphicsheadless -validate -validate-frames=30 -validate-timeout=120 -validate-output=...
-- 口径：每条断言独立 resetGameState；随机分支（D09/H03 掷骰）用 math.random 定值桩确定性化。

local cjson = require("cjson")
local f = File("scripts/main.lua", FILE_READ)
if not f:IsOpen() then f = File("E:/taptap/zhubo/maker/scripts/main.lua", FILE_READ) end
assert(f:IsOpen(), "cp3 gaps test: main.lua not found")
local src = f:ReadString()
f:Close()

local extra = [[
;local __origStart = Start
local __A = {}
local function __assert(name, ok, detail)
    table.insert(__A, { name = name, pass = ok and true or false, detail = detail })
    print("[CP3_GAP] " .. (ok and "PASS " or "FAIL ") .. name)
end
local function __card(id)
    for _, c in ipairs(cardsData) do if c.card_id == id then return c end end
    return nil
end
local function __play(id, opt)
    gameState.currentCard = __card(id)
    gameState.currentCardIndex = 1
    selectCardOption(opt)
end
local function __reset()
    resetGameState()
    gameState.schedule = { mode = "才艺", timeSlot = "slot_prime", duration = 4 }
    gameState.currentChapter = 1
end
local function __runTests()
    -- ===== 缺口① 单「+」写入（Node gameState.mjs:205-207）=====
    __reset()
    applyStateWrite("Count_黑粉不对线 + 1")
    __assert("gap1_plus_single_increments", tonumber(gameState.variables["Count_黑粉不对线"]) == 1, gameState.variables["Count_黑粉不对线"])
    applyStateWrite("Count_黑粉不对线 + 1")
    __assert("gap1_plus_accumulates", tonumber(gameState.variables["Count_黑粉不对线"]) == 2, gameState.variables["Count_黑粉不对线"])
    applyStateWrite("Count_猫上镜 += 1")
    __assert("gap1_pluseq_still_works", tonumber(gameState.variables["Count_猫上镜"]) == 1, gameState.variables["Count_猫上镜"])
    applyStateWrite("Flag_零粉快乐 = 1")
    __assert("gap1_assign_numeric", tonumber(gameState.variables["Flag_零粉快乐"]) == 1, gameState.variables["Flag_零粉快乐"])
    applyStateWrite("Tag_流派 = 整活")
    __assert("gap1_assign_string", gameState.variables["Tag_流派"] == "整活", gameState.variables["Tag_流派"])
    -- 真实卡路径：C1-M07:B 写 Count_黑粉不对线 + 1（修复前实落为空）
    __reset()
    __play("C1-M07", "B")
    __assert("gap1_realcard_C1M07B_count", tonumber(gameState.variables["Count_黑粉不对线"]) == 1, gameState.variables["Count_黑粉不对线"])

    -- ===== 缺口② delta_attrs 结算（Node cardEngine.mjs:36/292-294）=====
    __reset()
    local __kouBefore = gameState.attributes["口才"]
    __play("C1-M07", "A")
    __assert("gap2_delta_attrs_C1M07A", gameState.attributes["口才"] == __kouBefore + 1, { before = __kouBefore, after = gameState.attributes["口才"] })
    -- X-EGG-09:A 全属性 +1（同时落 H12，验属性与落支并存）
    __reset()
    __play("X-EGG-09", "A")
    local __allPlus = true
    for _, a in ipairs({ "颜值", "嗓音", "才艺", "游戏技术", "口才", "情商", "体力", "心态", "运气" }) do
        if gameState.attributes[a] ~= 6 then __allPlus = false end
    end
    __assert("gap2_delta_attrs_all9_XEGG09A", __allPlus, gameState.attributes)

    -- ===== 缺口③ H01 局内即时落支（Node cardEngine.mjs:375-379）=====
    __reset()
    gameState.variables["Count_黑粉不对线"] = 3
    gameState.attributes["情商"] = 7
    __play("X-EGG-04", "A")
    __assert("gap3_H01_lands", gameState.triggeredEnding == "H01", gameState.triggeredEnding)
    __assert("gap3_H01_cleared", gameState.isCleared == true and gameState.isDead == false, { isCleared = gameState.isCleared, isDead = gameState.isDead })
    __assert("gap3_H01_screen07", gameState.screen == "Screen-07", gameState.screen)
    __assert("gap3_H01_qualified", tonumber(gameState.variables["Qualified_H01"]) == 1, gameState.variables["Qualified_H01"])

    -- ===== 缺口③ H07 局终体面收场前评（Node stageSettlement.mjs:157-168 / 482fe7a 裁定）=====
    __reset()
    __play("C1-M10", "A")
    __assert("gap3_H07_flag_written", tonumber(gameState.variables["Flag_零粉快乐"]) == 1, gameState.variables["Flag_零粉快乐"])
    __assert("gap3_H07_not_immediate", gameState.triggeredEnding == nil, gameState.triggeredEnding)
    gameState.fiveDim.fans = 200
    gameState.fiveDim.rep = 92
    gameState.overtimePlayed[1] = true
    settleCurrentChapter(false)
    __assert("gap3_H07_settle_lands", gameState.triggeredEnding == "H07", gameState.triggeredEnding)
    __assert("gap3_H07_settle_cleared", gameState.isCleared == true, gameState.isCleared)
    __reset()
    gameState.variables["Flag_零粉快乐"] = 1
    gameState.fiveDim.fans = 200
    gameState.fiveDim.rep = 89
    gameState.overtimePlayed[1] = true
    settleCurrentChapter(false)
    __assert("gap3_H07_boundary_rep89_M04", gameState.triggeredEnding == "M04", gameState.triggeredEnding)
    __reset()
    gameState.fiveDim.fans = 200
    gameState.fiveDim.rep = 92
    gameState.overtimePlayed[1] = true
    settleCurrentChapter(false)
    __assert("gap3_H07_boundary_noflag_M04", gameState.triggeredEnding == "M04", gameState.triggeredEnding)

    -- ===== 缺口④ 落支即停 + 首满足落支 + 落定格（Node cardEngine.mjs:355-364 / gameState.mjs:102-105,327-328）=====
    __reset()
    gameState.currentChapter = 5
    gameState.variables["Flag_卖惨人设"] = 1
    gameState.variables["Flag_造假剧本"] = 1
    local __idxBefore = gameState.currentCardIndex
    __play("C5-M08", "B")
    __assert("gap4_first_satisfied_D20", gameState.triggeredEnding == "D20", gameState.triggeredEnding)
    __assert("gap4_death_screen06", gameState.screen == "Screen-06" and gameState.isDead == true, { screen = gameState.screen, isDead = gameState.isDead })
    __assert("gap4_loop_exit_no_advance", gameState.currentCardIndex == __idxBefore, { before = __idxBefore, after = gameState.currentCardIndex })
    local __endBefore = gameState.triggeredEnding
    local __idxLocked = gameState.currentCardIndex
    gameState.variables["Flag_卖惨人设"] = 0
    __play("C5-M08", "B")
    __assert("gap4_landed_ending_locked", gameState.triggeredEnding == __endBefore, { before = __endBefore, after = gameState.triggeredEnding })
    __assert("gap4_landed_no_advance", gameState.currentCardIndex == __idxLocked, { before = __idxLocked, after = gameState.currentCardIndex })
    __reset()
    gameState.currentChapter = 5
    gameState.variables["Flag_造假剧本"] = 1
    __play("C5-M08", "B")
    __assert("gap4_second_satisfied_D21", gameState.triggeredEnding == "D21", gameState.triggeredEnding)

    -- ===== 即时彩蛋累积满 3 落支（H04/H10，与 H01 同族；Node cardEngine.mjs:380-387）=====
    __reset()
    gameState.variables["Count_猫上镜"] = 2
    __play("C3-S01", "A")
    __assert("gap34_H04_count3_lands", gameState.triggeredEnding == "H04", { ending = gameState.triggeredEnding, count = gameState.variables["Count_猫上镜"] })
    __assert("gap34_H04_cleared", gameState.isCleared == true, gameState.isCleared)
    __reset()
    gameState.variables["Count_猫上镜"] = 1
    __play("C3-S01", "A")
    __assert("gap34_H04_count2_not_land", gameState.triggeredEnding == nil, gameState.triggeredEnding)
    __reset()
    gameState.variables["Count_考编"] = 2
    __play("C4-S16", "A")
    __assert("gap34_H10_count3_lands", gameState.triggeredEnding == "H10", { ending = gameState.triggeredEnding, count = gameState.variables["Count_考编"] })

    -- ===== D09/H03 50% 互斥落支（Node cardEngine.mjs:338-345,393-396；掷骰桩确定性化）=====
    local __origRandom = math.random
    math.random = function() return 0.3 end
    __reset()
    gameState.currentChapter = 6
    __play("C6-M06", "A")
    __assert("gap34_D09_roll_low", gameState.triggeredEnding == "D09", gameState.triggeredEnding)
    math.random = function() return 0.7 end
    __reset()
    gameState.currentChapter = 6
    __play("C6-M06", "A")
    __assert("gap34_H03_roll_high", gameState.triggeredEnding == "H03", { ending = gameState.triggeredEnding, isCleared = gameState.isCleared })
    math.random = __origRandom

    -- ===== 汇总导出 =====
    local __pass, __fail = 0, 0
    for _, a in ipairs(__A) do if a.pass then __pass = __pass + 1 else __fail = __fail + 1 end end
    local __payload = {
        test = "cp3 four playability Lua gaps (Node reference)",
        pass = (__fail == 0),
        total = #__A, passed = __pass, failed = __fail,
        assertions = __A,
        scope = "gap1 single+ write; gap2 delta_attrs; gap3 H01 immediate + H07 settlement pre-check; gap4 first-satisfied/loop-exit/landing-lock (+H04/H10/H03 same-family immediate eggs)",
        out_of_scope = "ch6 chain rebuild / full Qualified semantics / landing-order / X-EGG-03 生路 / rollbackSnapshot / MiSans = 阶段4 镜像清单②③④⑤⑥",
        validate_noise_note = "validate_gaps.json: lua_errors 0; resource_errors 1 = MiSans (CP4); engine_errors 4 = main.lua loadJson first-candidate probes maker-demo-clone/assets/data/* miss, data then loads OK from assets/data/ (canon-matching hashes). CP2 baseline showed 0 only because live_rebuild __rbLoad used different candidates.",
        exported_at = os.date("%Y-%m-%dT%H:%M:%S"),
    }
    local __ok, __encoded = pcall(cjson.encode, __payload)
    if __ok then
        local out = File("E:/taptap/zhubo/rebuild/cp3/gaps_test.json", FILE_WRITE)
        if out:IsOpen() then out:WriteString(__encoded) out:Flush() out:Close() end
        print("[CP3_GAPS_SUMMARY] passed=" .. __pass .. "/" .. #__A .. " failed=" .. __fail)
    end
end
Start = function()
    __origStart()
    __runTests()
end
]]

local chunk = assert(load(src .. extra, "@main.lua"))
chunk()