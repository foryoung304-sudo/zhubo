-- CP2 全流程无头回归驱动：load live_rebuild.lua 源码 + 同作用域测试钩子（磁盘零改动）
-- 覆盖：真抽卡5卡 → miss/命中/req锁/超时 → 真结算 → 加时赛3卡 → 二次结算(M04/M12或过闸) → 重新开播
-- 加速口径：gap 与指定超时事件直接把 runner 计时压到 0.05s（结算代码路径与实玩一致）
-- 跑法：UrhoXRuntime.exe cp2_flow_test.lua -tapcode_dir=. -tool_mode -graphicsheadless -validate -validate-frames=3600 -validate-timeout=150 -validate-output=...

local f = File("scripts/live_rebuild.lua", FILE_READ)
if not f:IsOpen() then f = File("E:/taptap/zhubo/maker/scripts/live_rebuild.lua", FILE_READ) end
assert(f:IsOpen(), "flow test: live_rebuild.lua not found")
local src = f:ReadString()
f:Close()

local extra = [[
;local __origUpdate = HandleUpdate
local __t = {
    phase = "run", replied = {}, missSent = false, timeoutForced = false,
    settleCount = 0, overtimeDone = false, restarted = false, done = false,
    assertions = {}, notes = {},
}
local function __assert(name, ok, detail)
    table.insert(__t.assertions, { name = name, pass = ok and true or false, detail = detail })
end
local function __safeMiss(def)
    local candidates = { "今天天气不错啊", "路过看看主播", "主播吃了吗", "随便逛逛直播间" }
    for _, t in ipairs(candidates) do
        if not matcher.match(def.intents, t) then return t end
    end
    return nil
end
local function __eventKey()
    return GS.currentCardIndex .. ":" .. (GS.currentCard and GS.currentCard.card_id or "?") .. ":" .. tostring(GS.overtimeActive)
end
HandleUpdate = function(et, ed)
    __origUpdate(et, ed)
    if __t.done then return end
    if __t.phase == "verify" then
        if frameCount > __t.verifyFrame + 120 then
            __t.done = true
            local hits, misses, timeouts, locked = 0, 0, 0, 0
            local events = 0
            for _, e in ipairs(playLog.entries) do
                if e.kind == "REPLY" and e.result == "hit" then hits = hits + 1
                elseif e.kind == "REPLY" and e.result == "miss" then misses = misses + 1
                elseif e.kind == "REPLY" and e.result == "locked" then locked = locked + 1
                elseif e.kind == "TIMEOUT" then timeouts = timeouts + 1
                elseif e.kind == "EVENT_START" then events = events + 1 end
            end
            __assert("miss_exercised", misses >= 1, misses)
            __assert("timeout_exercised", timeouts >= 1, timeouts)
            __assert("hits_with_diff", hits >= 1, hits)
            __assert("events_5_plus_3_if_overtime", events >= 5, events)
            local allPass = true
            for _, a in ipairs(__t.assertions) do if not a.pass then allPass = false end end
            local payload = {
                test = "cp2 chapter1 full-flow headless regression",
                pass = allPass,
                assertions = __t.assertions,
                counts = { hits = hits, misses = misses, timeouts = timeouts, locked = locked, events = events, settles = __t.settleCount },
                notes = __t.notes,
                exported_at = os.date("%Y-%m-%dT%H:%M:%S"),
            }
            local ok, encoded = pcall(cjson.encode, payload)
            if ok then
                local out = File("E:/taptap/zhubo/rebuild/cp2/flow_test.json", FILE_WRITE)
                if out:IsOpen() then out:WriteString(encoded) out:Flush() out:Close() end
                print("[CP2_FLOW] " .. encoded)
            end
            dumpLog()
        end
        return
    end
    if runner.state == "gap" then
        __t.settleHandled = false
        runner.gapT = math.min(runner.gapT, 0.05)
    elseif runner.state == "active" and GS.currentCard then
        local key = __eventKey()
        local st = __t.replied[key]
        if not st then
            st = { tries = 0, missDone = false, startedFrame = frameCount }
            __t.replied[key] = st
        end
        local def = INTENTS_BY_ID[GS.currentCard.card_id]
        if not __t.missSent then
            local mt = __safeMiss(def)
            if mt then
                sendReply(mt, "test")
                __t.missSent = true
                st.missDone = true
            end
        elseif GS.currentCardIndex == 2 and not GS.overtimeActive and not __t.timeoutForced then
            runner.timeLeft = 0.05
            __t.timeoutForced = true
            table.insert(__t.notes, "event2 timeout accelerated (runner.timeLeft=0.05)")
        elseif frameCount - st.startedFrame > 15 and (st.lastTryFrame or 0) < frameCount - 15 then
            st.tries = st.tries + 1
            st.lastTryFrame = frameCount
            local it = def.intents[st.tries]
            if it and it.chips and it.chips[1] then
                sendReply(it.chips[1], "test")
            else
                runner.timeLeft = 0.05
                table.insert(__t.notes, "event " .. key .. " all intents tried/locked, timeout accelerated")
            end
        end
    elseif runner.state == "settle" then
        if not __t.settleHandled then
            __t.settleHandled = true
            __t.settleCount = __t.settleCount + 1
            local sr = GS.settleResult or {}
            if __t.settleCount == 1 then
                __assert("settle1_fields", sr.netFans ~= nil and sr.netWallet ~= nil and sr.decay ~= nil and sr.targetFans ~= nil, sr)
                if sr.canOvertime and not __t.overtimeDone then
                    __t.overtimeDone = true
                    startOvertime()
                else
                    __t.phase = "restart"
                end
            else
                __assert("settle2_final", sr.canOvertime == false, sr)
                __assert("ending_or_gate", GS.triggeredEnding ~= nil or sr.gatePassed == true, { ending = GS.triggeredEnding, gatePassed = sr.gatePassed })
                __t.phase = "restart"
            end
        end
    elseif runner.state == "dead" then
        __assert("unexpected_death", false, { ending = GS.triggeredEnding })
        __t.phase = "restart"
    end
    if __t.phase == "restart" and not __t.restarted and (runner.state == "settle" or runner.state == "dead") then
        __t.restarted = true
        startChapter1()
        __assert("restart_queue5", #GS.chapterQueue == 5, queueIds())
        __assert("restart_reset", GS.fiveDim.wallet == 2000 and GS.fiveDim.fans == 0, GS.fiveDim)
        __t.phase = "verify"
        __t.verifyFrame = frameCount
    end
end
]]

local chunk = assert(load(src .. extra, "@live_rebuild.lua"))
chunk()