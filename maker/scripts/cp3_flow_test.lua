-- CP3 全流程无头回归驱动：load live_rebuild.lua 源码 + 同作用域测试钩子（磁盘零改动）
-- 覆盖：加点→排班→直播逐卡→下播行动8选1/Ops-B→结算→加时赛→多章推进→暴毙复活(零残留)→即时彩蛋→体面收官
--       + 时机条嵌回(甜区×1.15) + 翻样辨真内嵌(C4-M02 命中落B选项唯一写计数，CP4去重)
-- 驱动口径：菜单屏走 engine.renderMenu()+engine.clickButton(真实按钮委托)；直播事件走 startEvent+sendReply(真实匹配器+原引擎)；
--           轻操作走 handleClick(设计坐标)。闸门分支用测试夹具设状态 forcing（非玩法数值改动，登记于 payload）。
-- 跑法：UrhoXRuntime.exe cp3_flow_test.lua -tapcode_dir=. -tool_mode -graphicsheadless -validate -validate-frames=30 ...

local f = File("scripts/live_rebuild.lua", FILE_READ)
if not f:IsOpen() then f = File("E:/taptap/zhubo/maker/scripts/live_rebuild.lua", FILE_READ) end
assert(f:IsOpen(), "flow test: live_rebuild.lua not found")
local src = f:ReadString()
f:Close()

local extra = [[
;local __origStart = Start
local __A = {}
local function __assert(name, ok, detail)
    table.insert(__A, { name = name, pass = ok and true or false, detail = detail })
end
local function __cardById(id)
    for _, c in ipairs(engine.cardsData) do if c.card_id == id then return c end end
    return nil
end
-- 菜单屏真实按钮委托：先 renderMenu 注册当前屏按钮，再 clickButton
local function __click(btnId)
    engine.renderMenu()
    return engine.clickButton(btnId)
end
-- 直播事件：激活第 i 卡，尝试各意图 chip 直到命中（推进/换屏）；全锁则中性推进
local function __playCardHit(i)
    startEvent(i)
    local card = GS.chapterQueue[i]
    local def = INTENTS_BY_ID[card.card_id]
    local beforeIdx, beforeScreen = GS.currentCardIndex, GS.screen
    for _, it in ipairs(def.intents or {}) do
        if it.chips and it.chips[1] then
            sendReply(it.chips[1], "test")
            if GS.currentCardIndex ~= beforeIdx or GS.screen ~= beforeScreen then return "hit" end
        end
    end
    advanceNeutral()
    afterEventClosed()
    return "neutral"
end
local function __replyOpt(cardId, optKey)
    local def = INTENTS_BY_ID[cardId]
    for _, it in ipairs(def.intents or {}) do
        if it.opt_key == optKey and it.chips and it.chips[1] then
            sendReply(it.chips[1], "test")
            return true
        end
    end
    return false
end
local function __fixtureLive(cardId)
    local card = __cardById(cardId)
    GS.chapterQueue = { card }
    GS.currentCardIndex = 1
    GS.currentCard = card
    GS.screen = "Screen-03"
    runner.state = "menu"
    initTimingForCard(card)
    return card
end

local function __runTests()
    -- ===== Scene 1: 加点 → 排班 → 直播入口 =====
    engine.resetGameState()
    runner.state = "menu"
    __assert("s1_boot_screen01", GS.screen == "Screen-01", GS.screen)
    __click("btn_start_schedule")
    __assert("s1_to_schedule", GS.screen == "Screen-02", GS.screen)
    __click("mode_才艺"); __click("slot_slot_prime"); __click("dur_4")
    __assert("s1_schedule_set", GS.schedule.mode == "才艺" and GS.schedule.timeSlot == "slot_prime" and GS.schedule.duration == 4, GS.schedule)
    __click("btn_start_live")
    __assert("s1_to_live_queue5", GS.screen == "Screen-03" and #GS.chapterQueue == 5, { screen = GS.screen, queue = #GS.chapterQueue })

    -- ===== Scene 2: 直播逐卡 → 下播行动 =====
    local guard, results = 0, {}
    while GS.screen == "Screen-03" and guard < 12 do
        guard = guard + 1
        local i = GS.currentCardIndex
        if i > #GS.chapterQueue then break end
        results[#results + 1] = __playCardHit(i)
    end
    __assert("s2_reach_screen04", GS.screen == "Screen-04", { screen = GS.screen, played = results, ending = GS.triggeredEnding })

    -- ===== Scene 3: 下播行动 act_1(泡澡早睡) → 结算 =====
    if GS.screen == "Screen-04" then
        local stBefore = GS.fiveDim.stamina
        __click("btn_act_1")
        __assert("s3_act1_settle", GS.screen == "Screen-05" and GS.settleResult ~= nil, { screen = GS.screen, staminaBefore = stBefore, staminaAfter = GS.fiveDim.stamina })
    else
        __assert("s3_act1_settle", false, "not on Screen-04: " .. tostring(GS.screen))
    end

    -- ===== Scene 4a: 闸门通过 → 下一章（夹具 forcing 粉丝达标）=====
    engine.resetGameState()
    GS.currentChapter = 1
    GS.fiveDim.fans = 999999 -- 测试夹具：forcing 闸门通过，非玩法数值
    engine.settleCurrentChapter(false)
    __assert("s4a_gate_passed", GS.screen == "Screen-05" and GS.settleResult.gatePassed == true, GS.settleResult)
    __click("btn_next_chapter")
    __assert("s4a_next_chapter", GS.currentChapter == 2 and GS.screen == "Screen-02", { chapter = GS.currentChapter, screen = GS.screen })
    __click("btn_start_live")
    __assert("s4a_ch2_queue5", GS.screen == "Screen-03" and #GS.chapterQueue == 5 and GS.currentChapter == 2, { queue = #GS.chapterQueue, chapter = GS.currentChapter })

    -- ===== Scene 4b: 闸门未达 → 加时赛 3 卡 → 二次结算 → 体面收官 =====
    engine.resetGameState()
    GS.currentChapter = 1
    GS.fiveDim.fans = 0
    GS.fiveDim.rep = 60
    engine.settleCurrentChapter(false)
    __assert("s4b_can_overtime", GS.settleResult.canOvertime == true and GS.overtimeActive == true, GS.settleResult)
    __click("btn_start_overtime")
    __assert("s4b_overtime_queue3", GS.screen == "Screen-03" and #GS.chapterQueue == 3, { screen = GS.screen, queue = #GS.chapterQueue })
    guard = 0
    while GS.screen == "Screen-03" and guard < 8 do
        guard = guard + 1
        local i = GS.currentCardIndex
        if i > #GS.chapterQueue then break end
        __playCardHit(i)
    end
    __assert("s4b_overtime_settled", GS.screen == "Screen-05" and GS.settleResult.canOvertime == false, { screen = GS.screen, sr = GS.settleResult, ending = GS.triggeredEnding })
    __assert("s4b_graceful_ending", GS.triggeredEnding == "M04" or GS.triggeredEnding == "M12" or GS.triggeredEnding == "H07", GS.triggeredEnding)
    __click("btn_overtime_fail")
    __assert("s4b_to_screen07", GS.screen == "Screen-07", GS.screen)

    -- ===== Scene 4c: 下播行动 act_5 → Ops-B 翻样辨真 → 结算 =====
    engine.resetGameState()
    GS.screen = "Screen-04"
    __click("btn_act_5")
    __assert("s4c_to_opsb", GS.screen == "Ops-B" and GS.inspectInstance.active == true, { screen = GS.screen, inst = GS.inspectInstance })
    -- 翻开掺假件（夹具已知 fakeIndex），验证命中写键
    local fake = GS.inspectInstance.fakeIndex
    __click("flip_" .. fake)
    __assert("s4c_opsb_hit", GS.inspectInstance.success == true and tonumber(GS.variables["Count_验货命中"]) == 1 and tonumber(GS.variables["Flag_选品减伤"]) == 1, { success = GS.inspectInstance.success, count = GS.variables["Count_验货命中"], flag = GS.variables["Flag_选品减伤"] })
    __click("btn_finish_inspect")
    __assert("s4c_opsb_settle", GS.screen == "Screen-05" and GS.settleResult ~= nil, GS.screen)

    -- ===== Scene 5: 时机条嵌回（C1-M05 甜区 ×1.15）=====
    engine.resetGameState()
    local tcard = __fixtureLive("C1-M05")
    startEvent(1)
    __assert("s5_timing_active", GS.timingInstance.active == true and tcard.ops_type == "timing_bar", GS.timingInstance)
    -- 夹具：游标置甜区中点，点击点停按钮（设计坐标）
    GS.timingInstance.cursorPos = (GS.timingInstance.sweetStart + GS.timingInstance.sweetEnd) / 2
    handleClick(TIMING_TAP.x + 10, TIMING_TAP.y + 10)
    __assert("s5_timing_sweet", GS.timingInstance.isResolved == true and GS.timingInstance.resultZone == "SWEET" and GS.timingInstance.multiplier == 1.15, { zone = GS.timingInstance.resultZone, mult = GS.timingInstance.multiplier })
    local wBefore = GS.fiveDim.wallet
    __replyOpt("C1-M05", "A")
    __assert("s5_timing_consumed", GS.currentCardIndex == 2 or GS.screen ~= "Screen-03", { idx = GS.currentCardIndex, screen = GS.screen, walletBefore = wBefore, walletAfter = GS.fiveDim.wallet })

    -- ===== Scene 6: 翻样辨真内嵌（CP4 去重：C4-M02 命中落 B，计数由选项唯一写）=====
    engine.resetGameState()
    __fixtureLive("C4-M02")
    startEvent(1)
    __assert("s6_inline_inspect_active", inlineInspect ~= nil and GS.inspectInstance.active == true, { inline = inlineInspect, inst = GS.inspectInstance })
    local fake2 = GS.inspectInstance.fakeIndex
    local sx, sy, sw, sh = inspectRect(fake2)
    handleClick(sx + 10, sy + 10)
    __assert("s6_inline_hit_lands_B", GS.inspectInstance.success == true and tonumber(GS.variables["Count_验货命中"]) == 1 and tonumber(GS.variables["Flag_选品减伤"]) == 1, { count = GS.variables["Count_验货命中"], flag = GS.variables["Flag_选品减伤"], note = "CP4 去重 Orange 5d672f2：命中只决定落 B，计数/减伤旗标由选项 B 唯一写" })
    __assert("s6_no_double_write", tonumber(GS.variables["Count_验货命中"]) == 1 and GS.screen ~= "Screen-03", { count = GS.variables["Count_验货命中"], screen = GS.screen, note = "内嵌不再直写计数，选项落支后事件收口，旧叠加=2 缺陷已除" })

    -- ===== Scene 7a: 暴毙 D20 → 复活零残留（卡前既有标记合法保留） =====
    engine.resetGameState()
    GS.variables["Flag_卖惨人设"] = 1 -- 卡前夹具：快照合法捕获为1，复活后应保留而非抹除
    __fixtureLive("C5-M08")
    startEvent(1)
    __replyOpt("C5-M08", "B")
    __assert("s7_death_d20", GS.triggeredEnding == "D20" and GS.isDead == true and GS.screen == "Screen-06", { ending = GS.triggeredEnding, dead = GS.isDead, screen = GS.screen })
    __assert("s7_snapshot_exists", GS.snapshot ~= nil and GS.adUsage.reviveOrRepick == 0, { snap = GS.snapshot ~= nil, revive = GS.adUsage.reviveOrRepick })
    __click("btn_revive_ad")
    __assert("s7_revive_zero_residue", GS.triggeredEnding == nil and GS.isDead == false and GS.screen == "Screen-03" and GS.adUsage.reviveOrRepick == 1, { ending = GS.triggeredEnding, dead = GS.isDead, screen = GS.screen, revive = GS.adUsage.reviveOrRepick })
    __assert("s7_precard_flag_kept", tonumber(GS.variables["Flag_卖惨人设"]) == 1, { flag = GS.variables["Flag_卖惨人设"], note = "卡前已置1，快照捕获为1，回滚正确保留卡前状态" })

    -- ===== Scene 7b: 卡自身写入后暴毙 D03 → 复活回滚卡写入（既有键） =====
    engine.resetGameState()
    GS.variables["Flag_安保习惯"] = 0 -- 既有键夹具：卡写1→死→复活应回0（新增键不删属阶段4镜像④，不在本测）
    GS.fiveDim.rep = 40 -- 夹具：C6-M02 B 否则支 rep-50 → 0 → D03
    __fixtureLive("C6-M02")
    startEvent(1)
    __replyOpt("C6-M02", "B")
    __assert("s7b_card_write_then_death", GS.triggeredEnding == "D03" and GS.isDead == true and GS.screen == "Screen-06" and tonumber(GS.variables["Flag_安保习惯"]) == 1, { ending = GS.triggeredEnding, dead = GS.isDead, screen = GS.screen, flag = GS.variables["Flag_安保习惯"], rep = GS.fiveDim.rep })
    __click("btn_revive_ad")
    __assert("s7b_revive_zero_residue", GS.triggeredEnding == nil and GS.isDead == false and GS.screen == "Screen-03" and GS.adUsage.reviveOrRepick == 1, { ending = GS.triggeredEnding, dead = GS.isDead, screen = GS.screen, revive = GS.adUsage.reviveOrRepick })
    __assert("s7b_card_write_rolled_back", tonumber(GS.variables["Flag_安保习惯"]) == 0 and GS.fiveDim.rep == 40, { flag = GS.variables["Flag_安保习惯"], rep = GS.fiveDim.rep })

    -- ===== Scene 8: 即时彩蛋 H01 → 加冕屏 =====
    engine.resetGameState()
    GS.variables["Count_黑粉不对线"] = 3
    GS.attributes["情商"] = 7
    __fixtureLive("X-EGG-04")
    startEvent(1)
    __replyOpt("X-EGG-04", "A")
    __assert("s8_h01_cleared", GS.triggeredEnding == "H01" and GS.isCleared == true and GS.screen == "Screen-07" and tonumber(GS.variables["Qualified_H01"]) == 1, { ending = GS.triggeredEnding, cleared = GS.isCleared, screen = GS.screen, qualified = GS.variables["Qualified_H01"] })

    -- ===== Scene 9: 重开零残留（Screen-08 轮回 → 加点屏）=====
    __click("btn_share_card_clear")
    __assert("s9_to_share", GS.screen == "Screen-08", GS.screen)
    __click("btn_play_again")
    __assert("s9_new_run_reset", GS.screen == "Screen-01" and GS.triggeredEnding == nil and GS.fiveDim.fans == 0 and GS.currentChapter == 1, { screen = GS.screen, ending = GS.triggeredEnding, fans = GS.fiveDim.fans, chapter = GS.currentChapter })

    -- ===== 汇总导出 =====
    local pass, fail = 0, 0
    for _, a in ipairs(__A) do if a.pass then pass = pass + 1 else fail = fail + 1 end end
    local payload = {
        test = "cp3 full-flow headless regression (menu delegation + live ops + endings + revive)",
        pass = (fail == 0),
        total = #__A, passed = pass, failed = fail,
        assertions = __A,
        fixtures_note = "闸门分支用测试夹具 forcing 粉丝/标记状态（999999/0/Flag_卖惨人设/Count_黑粉不对线），非玩法数值改动；时机条游标置甜区中点为夹具。S7b：Flag_安保习惯 预置0、rep=40 为既有键回滚夹具（C6-M02 B 否则支 rep-50→D03）；复活新增键不删属阶段4镜像④ rollback 全量语义，不在本测。",
        semantic_note = "C4-M02 内嵌翻样辨真 CP4 去重（Orange 5d672f2）：命中只决定落 B，计数/减伤旗标由选项 B 唯一写，内嵌不再直写，旧叠加=2 缺陷已除；命名三例见 cp4_dedupe_test.lua。",
        exported_at = os.date("%Y-%m-%dT%H:%M:%S"),
    }
    local ok, encoded = pcall(cjson.encode, payload)
    if ok then
        local out = File("E:/taptap/zhubo/rebuild/cp3/flow_test.json", FILE_WRITE)
        if out:IsOpen() then out:WriteString(encoded) out:Flush() out:Close() end
        print("[CP3_FLOW_SUMMARY] passed=" .. pass .. "/" .. #__A .. " failed=" .. fail)
    end
    dumpLog()
end
Start = function()
    __origStart()
    __runTests()
end
]]

local chunk = assert(load(src .. extra, "@live_rebuild.lua"))
chunk()