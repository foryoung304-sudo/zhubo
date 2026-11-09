-- CP4 帧率正式复测驱动（墙钟口径，真窗跑，非预览）：load live_rebuild.lua + 同作用域钩子
-- 方法沿 build-order :95/:144 已签收口径：os.clock 每 Update 帧墙钟差、50 帧热身、真实抖动（非引擎步长）；
--   真窗（不带 -graphicsheadless）自动循环第一章直播（真抽卡/弹幕/爱心/反应），MiSans 正式字体渲染；
--   >=2000 有效样本 dump avg/p95/p99/min/max + 并发弹幕。LOG_PATH 重定向 cp4，CP3 证据零改动。
-- 跑法（真窗）：UrhoXRuntime.exe cp4_fps_retest.lua -tapcode_dir=. -tool_mode
-- 产出：E:/taptap/zhubo/rebuild/cp4/fps_formal.json（[CP4_FPS_DONE] 打印后即完成）

local f = File("scripts/live_rebuild.lua", FILE_READ)
if not f:IsOpen() then f = File("E:/taptap/zhubo/maker/scripts/live_rebuild.lua", FILE_READ) end
assert(f:IsOpen(), "fps retest: live_rebuild.lua not found")
local src = f:ReadString()
f:Close()

local extra = [[
;local __origStart = Start
LOG_PATH = "E:/taptap/zhubo/rebuild/cp4/fps_playthrough_log.json"

local function __enterLive()
    engine.resetGameState()
    engine.renderMenu(); engine.clickButton("btn_start_schedule")
    engine.renderMenu(); engine.clickButton("mode_才艺"); engine.clickButton("slot_slot_prime"); engine.clickButton("dur_4")
    engine.renderMenu(); engine.clickButton("btn_start_live")
end

local __ap = { cardWait = 0, lastCard = nil, reenter = 0 }
local function __autoPlay(dt)
    if GS.screen ~= "Screen-03" then
        __ap.reenter = __ap.reenter + dt
        if __ap.reenter > 0.5 then __ap.reenter = 0; __enterLive() end
        return
    end
    __ap.reenter = 0
    if runner.state == "active" and GS.currentCard then
        if GS.currentCard ~= __ap.lastCard then __ap.lastCard = GS.currentCard; __ap.cardWait = 0 end
        __ap.cardWait = __ap.cardWait + dt
        if __ap.cardWait > 0.8 then
            __ap.cardWait = 0
            local def = INTENTS_BY_ID[GS.currentCard.card_id]
            if def and def.intents and def.intents[1] and def.intents[1].chips and def.intents[1].chips[1] then
                sendReply(def.intents[1].chips[1], "fps_auto")
            end
        end
    end
end

local __fps = { last = nil, samples = {}, concSum = 0, concMin = math.huge, done = false }
local function __fpsCollect()
    local now = os.clock()
    if __fps.last then
        local dtMs = (now - __fps.last) * 1000
        if frameCount > 50 then
            table.insert(__fps.samples, dtMs)
            local conc = math.min(#chatRows, CHAT_VISIBLE) + #hearts + #flyBanners
            __fps.concSum = __fps.concSum + conc
            if conc < __fps.concMin then __fps.concMin = conc end
        end
    end
    __fps.last = now
    if not __fps.done and frameCount >= 2150 and #__fps.samples >= 2000 then
        __fps.done = true
        local sorted, sum, minV, maxV = {}, 0, math.huge, 0
        for _, v in ipairs(__fps.samples) do
            table.insert(sorted, v); sum = sum + v
            if v < minV then minV = v end
            if v > maxV then maxV = v end
        end
        table.sort(sorted)
        local avg = sum / #sorted
        local p95 = sorted[math.max(1, math.floor(#sorted * 0.95))]
        local p99 = sorted[math.max(1, math.floor(#sorted * 0.99))]
        local payload = {
            test = "cp4 FORMAL new-main-screen FPS retest (wall-clock, the CP4 gate; not a preview)",
            method = "os.clock wall-clock per Update frame; 50-frame warmup; real window (no -graphicsheadless); auto-play chapter-1 live loop (real draw/danmaku/hearts/reactions); MiSans formal font rendered",
            font = "MiSans-Regular genuine (assets/Fonts), renderer prefers MiSans with msyh/simhei fallback",
            total_frames = frameCount,
            valid_wall_samples = #sorted,
            avg_dt_ms = math.floor(avg * 100) / 100,
            p95_dt_ms = math.floor(p95 * 100) / 100,
            p99_dt_ms = math.floor(p99 * 100) / 100,
            min_dt_ms = math.floor(minV * 100) / 100,
            max_dt_ms = math.floor(maxV * 100) / 100,
            est_fps = math.floor(1000 / avg * 10) / 10,
            concurrent_avg = math.floor(__fps.concSum / #sorted * 10) / 10,
            concurrent_min = __fps.concMin,
            gate = ">=2000 valid wall-clock samples (build-order :95); avg/p95/max all reported; CP3 preview not substituted",
            exported_at = os.date("%Y-%m-%dT%H:%M:%S"),
        }
        local ok, encoded = pcall(cjson.encode, payload)
        if ok then
            local out = File("E:/taptap/zhubo/rebuild/cp4/fps_formal.json", FILE_WRITE)
            if out:IsOpen() then out:WriteString(encoded) out:Flush() out:Close() end
        end
        print("[CP4_FPS_DONE] samples=" .. #sorted .. " avg=" .. payload.avg_dt_ms .. " p95=" .. payload.p95_dt_ms .. " max=" .. payload.max_dt_ms)
    end
end

function HandleUpdate(eventType, eventData)
    local dt = eventData:GetFloat("TimeStep")
    frameCount = frameCount + 1
    timeSec = timeSec + dt
    __fpsCollect()
    __autoPlay(dt)
    watchScreen()
    if GS.screen == "Screen-03" then
        if runner.state == "menu" then engageLive() end
        engine.timingTick(dt)
        runnerTick(dt)
        atmosphereTick(dt)
    else
        runner.state = "menu"
        if inputFocused then setInputFocus(false) end
    end
    if frameCount % 60 == 0 then dumpLog() end
end

Start = function()
    __origStart()
    __enterLive()
end
]]

local chunk = assert(load(src .. extra, "@live_rebuild.lua"))
chunk()