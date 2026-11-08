-- 意图匹配演示测试台（headless 证据工具，随小样一次性看待）
-- 与按钮/chips 同一 sendReply 入口注入玩家自拟回复；每事件 ≥6 句 + 超时没接住 + chips 全量 + 连续全流程。
-- 跑法：UrhoXRuntime test_spike_intents.lua -tapcode_dir=<maker> -tool_mode -graphicsheadless -validate ...
-- 产出：E:/taptap/zhubo/spike/intent_demo_log.json（含每句命中意图/选项/前后状态 diff/继承效果集原文）

local cjson = require("cjson")

local function readAll(candidates)
    for _, p in ipairs(candidates) do
        local f = File(p, FILE_READ)
        if f:IsOpen() then
            local s = f:ReadString()
            f:Close()
            if s and #s > 0 then return s end
        end
    end
    error("test_spike_intents: source not found: " .. table.concat(candidates, ", "))
end

local src = readAll({ "scripts/spike_live.lua", "spike_live.lua", "E:/taptap/zhubo/maker/scripts/spike_live.lua" })
local extra = [[
;return {
    sendReply = sendReply, runner = runner, engine = engine, GS = GS,
    EVENT_DEFS = EVENT_DEFS, rebuildQueue = rebuildQueue, startEvent = startEvent,
    runnerTick = runnerTick, settlementLog = settlementLog,
}
]]
local S = assert(load(src .. extra, "@spike_live.lua"))()

local IDX = { ["C1-M01"] = 1, ["C1-M05"] = 2, ["C1-M07"] = 3, ["C1-M10"] = 4, ["C1-S01"] = 5 }
local IDS = { "C1-M01", "C1-M05", "C1-M07", "C1-M10", "C1-S01" }

local demo = {
    test = "stage2 spike intent-matching demo (5 real chapter-1 cards)",
    method = "headless harness; replies injected through the SAME sendReply pipeline as button/chips; effects settled by unmodified main.lua selectCardOption; per-case fresh resetGameState",
    seed = 42,
    records = {},
    continuous = {},
    summary = {},
}
local failures = {}
local function check(cond, label)
    if not cond then table.insert(failures, label) end
end

local function lastEntry()
    return S.settlementLog.entries[#S.settlementLog.entries]
end

local function fresh(idx)
    S.engine.resetGameState()
    S.rebuildQueue()
    S.startEvent(idx)
end

local function snap()
    local fd, vars = {}, {}
    for k, v in pairs(S.GS.fiveDim) do fd[k] = v end
    for k, v in pairs(S.GS.variables) do vars[k] = tostring(v) end
    return { fiveDim = fd, variables = vars }
end

local function diff(a, b)
    local d = { fiveDim = {}, variables = {} }
    for k, v in pairs(b.fiveDim) do
        if a.fiveDim[k] ~= v then d.fiveDim[k] = { a.fiveDim[k], v } end
    end
    for k, v in pairs(b.variables) do
        if a.variables[k] ~= v then d.variables[k] = { a.variables[k], v } end
    end
    return d
end

-- 玩家自拟回复（非 chips 文案）：每事件覆盖全部意图 + 至少 4 句未命中
local CASES = {
    { card = "C1-M01", text = "我想踏实唱歌走才艺路线", expect = "hit", opt = "A" },
    { card = "C1-M01", text = "主播打游戏吧，用技术说话", expect = "hit", opt = "B" },
    { card = "C1-M01", text = "穿玩偶服抽象整活先火再说", expect = "hit", opt = "C" },
    { card = "C1-M01", text = "今天吃了吗", expect = "miss" },
    { card = "C1-M01", text = "随便看看", expect = "miss" },
    { card = "C1-M01", text = "哈哈哈哈", expect = "miss" },
    { card = "C1-M01", text = "路过", expect = "miss" },
    { card = "C1-M01", text = "天气不错", expect = "miss" },
    { card = "C1-M01", text = "嗯嗯", expect = "miss" },
    { card = "C1-M05", text = "汪汪！十块钱也是大哥", expect = "hit", opt = "A" },
    { card = "C1-M05", text = "感谢礼物，才艺可以点", expect = "hit", opt = "B" },
    { card = "C1-M05", text = "这礼物多少钱", expect = "miss" },
    { card = "C1-M05", text = "主播看看我", expect = "miss" },
    { card = "C1-M05", text = "今天播多久", expect = "miss" },
    { card = "C1-M05", text = "加油", expect = "miss" },
    { card = "C1-M07", text = "截图怼回去：你行你上啊键盘侠", expect = "hit", opt = "A" },
    { card = "C1-M07", text = "骂得准，欢迎继续挑刺", expect = "hit", opt = "B" },
    { card = "C1-M07", text = "这黑粉谁啊", expect = "miss" },
    { card = "C1-M07", text = "弹幕别吵", expect = "miss" },
    { card = "C1-M07", text = "主播别哭", expect = "miss" },
    { card = "C1-M07", text = "抱抱", expect = "miss" },
    { card = "C1-M10", text = "关掉推荐当树洞自娱自乐", expect = "hit", opt = "A" },
    { card = "C1-M10", text = "灌冰美式抄作业继续卷", expect = "hit", opt = "B" },
    { card = "C1-M10", text = "粉丝多少了", expect = "miss" },
    { card = "C1-M10", text = "在的", expect = "miss" },
    { card = "C1-M10", text = "主播加油", expect = "miss" },
    { card = "C1-M10", text = "别放弃", expect = "miss" },
    { card = "C1-S01", text = "抱开猫继续讲准备好的稿子", expect = "hit", opt = "A" },
    { card = "C1-S01", text = "递麦给猫，打赏归你买罐头", expect = "hit", opt = "B" },
    { card = "C1-S01", text = "猫好可爱", expect = "miss" },
    { card = "C1-S01", text = "橘猫胖吗", expect = "miss" },
    { card = "C1-S01", text = "看猫看猫", expect = "miss" },
    { card = "C1-S01", text = "猫呢", expect = "miss" },
}

-- chips 全量过同一匹配器（第三句为故意未命中项）
local CHIP_CASES = {
    { card = "C1-M01", text = "唱跳才艺慢工出细活", expect = "hit", opt = "A" },
    { card = "C1-M01", text = "死磕游戏用技术说话", expect = "hit", opt = "B" },
    { card = "C1-M01", text = "玩偶服抽象整活", expect = "hit", opt = "C" },
    { card = "C1-M05", text = "汪汪两声逗乐全场", expect = "hit", opt = "A" },
    { card = "C1-M05", text = "感谢礼物才艺可以点", expect = "hit", opt = "B" },
    { card = "C1-M05", text = "今天天气不错啊", expect = "miss" },
    { card = "C1-M07", text = "你行你上啊键盘侠", expect = "hit", opt = "A" },
    { card = "C1-M07", text = "骂得准欢迎挑刺", expect = "hit", opt = "B" },
    { card = "C1-M07", text = "弹幕护体", expect = "miss" },
    { card = "C1-M10", text = "关推荐当树洞自娱自乐", expect = "hit", opt = "A" },
    { card = "C1-M10", text = "冰美式抄作业继续卷", expect = "hit", opt = "B" },
    { card = "C1-M10", text = "主播今天好看", expect = "miss" },
    { card = "C1-S01", text = "抱开猫继续讲稿子", expect = "hit", opt = "A" },
    { card = "C1-S01", text = "递麦给猫买罐头", expect = "hit", opt = "B" },
    { card = "C1-S01", text = "猫猫可爱", expect = "miss" },
}

local function runCase(case, source)
    fresh(IDX[case.card])
    S.sendReply(case.text, source)
    local e = lastEntry()
    local label = case.card .. " «" .. case.text .. "»(" .. source .. ")"
    check(e and e.kind == "REPLY", label .. " 无 REPLY 记录")
    check(e and e.result == case.expect, label .. " 期望 " .. case.expect .. " 实得 " .. tostring(e and e.result))
    if case.expect == "hit" then
        check(e and e.opt_key == case.opt, label .. " 期望选项 " .. case.opt .. " 实得 " .. tostring(e and e.opt_key))
        check(e and e.inherited_effects ~= nil, label .. " 缺继承效果集")
    end
    table.insert(demo.records, { card = case.card, text = case.text, source = source, expect = case.expect, entry = e })
    return e
end

-- 逐条效果断言（数值全部来自冻结卡面 + 原引擎乘区，无新造）
local function assertDiffs()
    local byText = {}
    for _, r in ipairs(demo.records) do
        if r.source == "test" then byText[r.card .. "|" .. r.text] = r.entry end
    end
    local function e(card, text) return byText[card .. "|" .. text] end
    local d
    d = e("C1-M01", "我想踏实唱歌走才艺路线").diff
    check(next(d.fiveDim) == nil and next(d.variables) == nil, "M01-A 应零效果（卡面空效果集）")
    d = e("C1-M01", "主播打游戏吧，用技术说话").diff
    check(next(d.fiveDim) == nil and next(d.variables) == nil, "M01-B 应零效果（卡面空效果集）")
    d = e("C1-M01", "穿玩偶服抽象整活先火再说").diff
    check(d.variables["Tag_流派"] and d.variables["Tag_流派"][2] == "整活", "M01-C 应写入 Tag_流派=整活")
    d = e("C1-M05", "汪汪！十块钱也是大哥").diff
    check(d.fiveDim.rep and d.fiveDim.rep[2] == 57, "M05-A 口碑应 60→57")
    check(d.fiveDim.wallet and d.fiveDim.wallet[2] > d.fiveDim.wallet[1], "M05-A 钱包应正增长（R链基准收益+卡面10，原引擎语义）")
    d = e("C1-M05", "感谢礼物，才艺可以点").diff
    check(d.fiveDim.rep and d.fiveDim.rep[2] == 64, "M05-B 口碑应 60→64")
    check(d.fiveDim.stamina and d.fiveDim.stamina[2] == 85, "M05-B 状态应 80→85")
    d = e("C1-M07", "截图怼回去：你行你上啊键盘侠").diff
    check(d.fiveDim.heat and d.fiveDim.heat[2] == 115, "M07-A 热度应 100→115(+15%)")
    d = e("C1-M07", "骂得准，欢迎继续挑刺").diff
    check(next(d.variables) == nil, "M07-B 引擎缺口复现：卡面 «Count_黑粉不对线 + 1» 被 Lua applyStateWrite 丢弃（Node 认单 +，Lua 只认 +=）")
    d = e("C1-M10", "关掉推荐当树洞自娱自乐").diff
    check(d.variables["Flag_零粉快乐"] and d.variables["Flag_零粉快乐"][2] == "1", "M10-A 应记 Flag_零粉快乐=1")
    d = e("C1-M10", "灌冰美式抄作业继续卷").diff
    check(d.fiveDim.fans and d.fiveDim.fans[2] > 0, "M10-B 粉丝应正增长(+20%锚定Base_Fans)")
    check(d.fiveDim.stamina and d.fiveDim.stamina[2] == 70, "M10-B 状态应 80→70")
    d = e("C1-S01", "抱开猫继续讲准备好的稿子").diff
    check(d.fiveDim.rep and d.fiveDim.rep[2] == 62, "S01-A 口碑应 60→62")
    check(d.variables["Count_猫上镜"] and d.variables["Count_猫上镜"][2] == "1", "S01-A 应同时记 Count_猫上镜=1（冻结卡面如此）")
    d = e("C1-S01", "递麦给猫，打赏归你买罐头").diff
    check(next(d.variables) == nil, "S01-B 引擎缺口复现：卡面 «Count_猫上镜 + 1» 同样被 Lua 丢弃")
    check(d.fiveDim.rep == nil, "S01-B 口碑不应变化")
end

function Start()
    math.randomseed(demo.seed)
    print("[INTENT_DEMO] Start")

    for _, case in ipairs(CASES) do runCase(case, "test") end
    assertDiffs()

    -- M07-A delta_attrs 不结算实证（卡面口才+1，Lua 引擎无 delta_attrs 通道）
    fresh(IDX["C1-M07"])
    local koucaiBefore = S.GS.attributes["口才"]
    S.sendReply("挂出来置顶对线", "test")
    local attrEntry = lastEntry()
    check(attrEntry.result == "hit" and attrEntry.opt_key == "A", "M07-A 附加探针应命中 A")
    check(S.GS.attributes["口才"] == koucaiBefore, "M07-A 口才+1 不结算（引擎缺口复现）")
    table.insert(demo.records, { card = "C1-M07", text = "挂出来置顶对线", source = "test", expect = "hit",
        note = "delta_attrs 探针：卡面口才+1，引擎结算前后口才=" .. tostring(koucaiBefore) .. "（不变）", entry = attrEntry })

    for _, case in ipairs(CHIP_CASES) do runCase(case, "chip") end

    -- 超时未回复 = 中性「没接住」：直播流继续、零效果
    for i = 1, 5 do
        fresh(i)
        local before = snap()
        S.runner.timeLeft = 0.01
        S.runnerTick(0.1)
        local e = lastEntry()
        local d = diff(before, snap())
        check(e and e.kind == "TIMEOUT", IDS[i] .. " 超时应有 TIMEOUT 记录")
        check(next(d.fiveDim) == nil and next(d.variables) == nil, IDS[i] .. " 超时应零效果")
        check(S.runner.state == "gap" or S.runner.state == "done", IDS[i] .. " 超时后直播流应继续")
        table.insert(demo.records, { card = IDS[i], text = "(超时未回复)", source = "timeout", entry = e, state_diff = d })
    end

    -- 非事件期回复：正常上屏，无结算
    S.engine.resetGameState()
    S.rebuildQueue()
    S.runner.state = "gap"
    S.runner.gapT = 999
    S.sendReply("主播加油", "test")
    check(lastEntry().result == "no_event", "间隙期回复应 no_event")
    table.insert(demo.records, { card = "(间隙期)", text = "主播加油", source = "test", entry = lastEntry() })

    -- 连续全流程：chips 依次过五事件（M01 选整活，验证流派乘区向后续事件继承）
    S.engine.resetGameState()
    S.rebuildQueue()
    S.runner.state = "gap"
    S.runner.gapT = 0.01
    S.runnerTick(0.1)
    local chipPick = { "玩偶服抽象整活", "汪汪两声逗乐全场", "你行你上啊键盘侠", "冰美式抄作业继续卷", "递麦给猫买罐头" }
    local steps = {}
    for i = 1, 5 do
        check(S.runner.state == "active" and S.GS.currentCard.card_id == IDS[i], "连续流程第 " .. i .. " 事件应 active")
        S.sendReply(chipPick[i], "chip")
        table.insert(steps, lastEntry())
        if i == 1 then
            check(S.GS.variables["Tag_流派"] == "整活", "连续流程 M01-C 后 Tag_流派 应=整活")
        end
        if S.runner.state == "gap" then
            S.runner.gapT = 0.01
            S.runnerTick(0.1)
        end
    end
    check(S.runner.state == "done" or S.GS.screen == "Screen-04", "连续流程应走完第一章到 Screen-04/done")
    demo.continuous = {
        note = "chips 连续过五事件；M01 选 C 整活后，后续钱包/粉丝结算由原引擎施加 ×2.5 或 35% 清零（种子42确定性）",
        steps = steps,
        final = { fiveDim = snap().fiveDim, variables = snap().variables, screen = S.GS.screen },
    }

    demo.known_engine_gaps = {
        "Lua applyStateWrite(main.lua:323) 只认 = 与 +=；Node 正本(gameState.mjs:199) 还认单 +。卡面 «Count_黑粉不对线 + 1»(M07-B)、«Count_猫上镜 + 1»(S01-B) 在 Lua 侧静默丢弃。小样原样继承，未改引擎。",
        "Lua selectCardOption 无 delta_attrs 通道：M07-A 卡面口才+1 不结算（探针实证前后均为5）。",
        "H01/H07 等 H 系触发在局内被忽略（main.lua:733-747 只处理 D* 与 H12+X-EGG-09），M07-B/M10-A 的挂钩仅记录于卡面。",
        "M05-A 卡面钱包+10 经 R 链结算为 基准收益+10（约+410），系原引擎既有语义，非小样新造。",
    }
    demo.summary = {
        total_records = #demo.records,
        typed_replies = #CASES,
        chip_replies = #CHIP_CASES,
        timeouts = 5,
        failures = failures,
        result = #failures == 0 and "PASS" or "FAIL",
        exported_at = os.date("%Y-%m-%dT%H:%M:%S"),
    }
    local f = File("E:/taptap/zhubo/spike/intent_demo_log.json", FILE_WRITE)
    if f:IsOpen() then
        f:WriteString(cjson.encode(demo))
        f:Flush()
        f:Close()
    end
    print("[INTENT_DEMO] " .. demo.summary.result .. " records=" .. #demo.records .. " failures=" .. #failures)
    for _, x in ipairs(failures) do print("[INTENT_DEMO][FAIL] " .. x) end
end