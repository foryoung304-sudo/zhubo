-- 《从小主播到顶流》阶段2呈现重做 · 检查点3：全流程接通 + 轻操作嵌回直播流
-- 呈现参照系（店主裁定 b9911c6）：全屏视频面 / 左下聊天盒上滚 / 横飞仅大礼物横幅与高等级进场 /
--   右侧点赞爱心竖列 / 顶部主播药丸+观众头像排 / 底部「说点什么」输入丸 + 屏上发送键。
-- 全流程（CP3）：开局加点(01)→排班(02)→抖音式直播逐卡(03)→下播行动8选1(04)/翻样辨真(Ops-B)→
--   章节结算(05)→暴毙(06)/加冕(07)→分享卡(08)/图鉴(09)，多章推进。非直播屏委托 main.lua 既有屏渲染+点击。
-- 数值结算复用 main.lua 原引擎（load 源码取局部引用，磁盘零改动）：真抽卡 drawChapterCards、真结算
--   settleCurrentChapter；意图表 intents_full.json 只继承原卡选项，零新数值。
-- 轻操作嵌回（CP3）：时机条挂 6 张 timing_bar 卡的直播事件（甜区×1.15/良区×1.05，沿 main 常量）；
--   翻样辨真作 C4-M02/C5-M07 的直播内嵌桥段（沿 Ops-B 既有 4 样/2 翻/命中写 Count_验货命中+1 & Flag_选品减伤=1）。
-- 边界（登记）：主播位占位（美术阶段4）；字体暂用系统 msyh（MiSans CP4 落地）；其余镜像对齐留阶段4。
-- 输入口径（小样探针实证 + 裁定①）：本运行时 Windows 桌面只送 TextInput/TextEditing，发送/清空走屏上按钮。

local cjson = require("cjson")

-- ============================================================================
-- 1. 数据与引擎装载
-- ============================================================================
local function readJsonCandidates(name, candidates)
    for _, p in ipairs(candidates) do
        local f = File(p, FILE_READ)
        if f:IsOpen() then
            local raw = f:ReadString()
            f:Close()
            if raw and #raw > 0 then
                local ok, parsed = pcall(cjson.decode, raw)
                if ok then
                    print("[CP3_DATA] " .. name .. " <- " .. p)
                    return parsed
                end
            end
        end
    end
    error("cp3 data not found: " .. name)
end

local function loadEngine()
    local candidates = {
        "scripts/main.lua",
        "main.lua",
        "zhubo/maker/scripts/main.lua",
        "E:/taptap/zhubo/maker/scripts/main.lua",
    }
    local src = nil
    for _, p in ipairs(candidates) do
        local f = File(p, FILE_READ)
        if f:IsOpen() then
            src = f:ReadString()
            f:Close()
            if src and #src > 0 then break end
        end
    end
    assert(src and #src > 0, "cp3: main.lua source not found")
    local extra = [[
;local function __rbLoad(name)
    local candidates = {
        "../data/" .. name,
        "data/" .. name,
        "zhubo/data/" .. name,
        "E:/taptap/zhubo/data/" .. name,
        "assets/data/" .. name,
    }
    for _, p in ipairs(candidates) do
        local f = File(p, FILE_READ)
        if f:IsOpen() then
            local raw = f:ReadString()
            f:Close()
            if raw and #raw > 0 then
                local ok, parsed = pcall(cjson.decode, raw)
                if ok then return parsed end
            end
        end
    end
    error("cp3 frozen data not found: " .. name)
end
cardsData = __rbLoad("cards.json")
configData = __rbLoad("config_and_screens.json")
endingsData = __rbLoad("endings_and_talents.json")
stateDict = __rbLoad("state_dictionary.json")
loadSave()
resetGameState()
-- CP3 委托面：非直播屏（01/02/04/05/06/07/08/09/Ops-B）沿用 main.lua 既有屏。
-- main 的 nvgContext/fontId 局部仅在其 Start 内置；本壳自建上下文后经此 setter 注入。
-- windowWidth/windowHeight 保持 540/960（main HandleRender 不被调用），按钮坐标即设计坐标。
local __rbRenderFns = {
    ["Screen-01"] = renderScreen01, ["Screen-02"] = renderScreen02,
    ["Screen-04"] = renderScreen04, ["Ops-B"] = renderOpsB,
    ["Screen-05"] = renderScreen05, ["Screen-06"] = renderScreen06,
    ["Screen-07"] = renderScreen07, ["Screen-08"] = renderScreen08,
    ["Screen-09"] = renderScreen09,
}
local function __rbSetContext(ctx, fid) nvgContext = ctx; fontId = fid end
local function __rbRenderMenu()
    clearButtons()
    local fn = __rbRenderFns[gameState.screen]
    if fn then fn() end
end
local function __rbMenuClick(x, y) return handleScreenClick(x, y) end
local function __rbTimingTick(dt)
    local t = gameState.timingInstance
    if t.active and not t.isResolved then
        t.cursorPos = t.cursorPos + t.cursorDir * t.cursorSpeed * dt
        if t.cursorPos >= 1.0 then t.cursorPos = 1.0; t.cursorDir = -1
        elseif t.cursorPos <= 0.0 then t.cursorPos = 0.0; t.cursorDir = 1 end
    end
end
return {
    gameState = gameState,
    cardsData = cardsData,
    configData = configData,
    selectCardOption = selectCardOption,
    resetGameState = resetGameState,
    drawChapterCards = drawChapterCards,
    settleCurrentChapter = settleCurrentChapter,
    setContext = __rbSetContext,
    renderMenu = __rbRenderMenu,
    menuClick = __rbMenuClick,
    clickButton = clickButtonById,
    timingTick = __rbTimingTick,
}
]]
    local chunk = assert(load(src .. extra, "@main.lua"))
    return chunk()
end

local engine = loadEngine()
local GS = engine.gameState

local intentsData = readJsonCandidates("intents_full.json", {
    "assets/data/intents_full.json",
    "maker/assets/data/intents_full.json",
    "zhubo/maker/assets/data/intents_full.json",
    "E:/taptap/zhubo/maker/assets/data/intents_full.json",
})
local corpus = readJsonCandidates("ambient_corpus.json", {
    "assets/data/ambient_corpus.json",
    "maker/assets/data/ambient_corpus.json",
    "zhubo/maker/assets/data/ambient_corpus.json",
    "E:/taptap/zhubo/maker/assets/data/ambient_corpus.json",
})

local matcher = nil
for _, p in ipairs({ "scripts/intent_matcher.lua", "intent_matcher.lua", "zhubo/maker/scripts/intent_matcher.lua", "E:/taptap/zhubo/maker/scripts/intent_matcher.lua" }) do
    local f = File(p, FILE_READ)
    if f:IsOpen() then
        local src = f:ReadString()
        f:Close()
        if src and #src > 0 then
            matcher = assert(load(src, "@intent_matcher.lua"))()
            break
        end
    end
end
assert(matcher, "cp3: intent_matcher.lua not found")
matcher.configure(intentsData.matcher)

local INTENTS_BY_ID = {}
for _, c in ipairs(intentsData.cards) do INTENTS_BY_ID[c.card_id] = c end
local EVENT_DURATION = (intentsData.defaults and intentsData.defaults.event_duration_sec) or 30
local SEG_ORDER = { "颜粉", "声控粉", "技术粉", "乐子人", "大哥", "学生粉" }

-- ============================================================================
-- 2. 工具（沿用小样）
-- ============================================================================
local nvgContext = nil
local fontId = -1
frameCount = 0
local timeSec = 0

local DESIGN_W, DESIGN_H = 540, 960
local viewScale, viewOffX, viewOffY, viewDpr = 1, 0, 0, 1

local function utf8Len(s)
    local n = 0
    for i = 1, #s do
        local b = s:byte(i)
        if b < 0x80 or b >= 0xC0 then n = n + 1 end
    end
    return n
end

local function utf8Cut(s, maxChars)
    local n, i = 0, 1
    while i <= #s and n < maxChars do
        local b = s:byte(i)
        i = i + (b < 0x80 and 1 or (b < 0xE0 and 2 or (b < 0xF0 and 3 or 4)))
        n = n + 1
    end
    return s:sub(1, i - 1)
end

local function utf8Tail(s, maxChars)
    local bounds = {}
    for i = 1, #s do
        local b = s:byte(i)
        if b < 0x80 or b >= 0xC0 then table.insert(bounds, i) end
    end
    if #bounds <= maxChars then return s end
    return s:sub(bounds[#bounds - maxChars + 1])
end

local function estimateWidth(text, size)
    local w = 0
    for i = 1, #text do
        local b = text:byte(i)
        if b < 0x80 then w = w + size * 0.55
        elseif b >= 0xC0 then w = w + size end
    end
    return w
end

local function textWidth(text, size)
    if nvgContext and fontId ~= -1 then
        nvgFontFaceId(nvgContext, fontId)
        nvgFontSize(nvgContext, size)
        local adv = nvgTextBounds(nvgContext, 0, 0, text, nil)
        if adv and adv > 0 then return adv end
    end
    return estimateWidth(text, size)
end

local function shallowCopy(t)
    local r = {}
    for k, v in pairs(t) do r[k] = v end
    return r
end

local function snapshotState()
    return { fiveDim = shallowCopy(GS.fiveDim), variables = shallowCopy(GS.variables) }
end

local function diffState(before)
    local d = { fiveDim = {}, variables = {} }
    for k, v in pairs(GS.fiveDim) do
        if before.fiveDim[k] ~= v then d.fiveDim[k] = { before.fiveDim[k] or 0, v } end
    end
    for k, v in pairs(GS.variables) do
        if before.variables[k] ~= v then d.variables[k] = { tostring(before.variables[k]), tostring(v) } end
    end
    return d
end

-- ============================================================================
-- 3. 日志（实玩证据）
-- ============================================================================
local playLog = { build = "zhubo stage2 CP3 full-flow douyin shell", started_at = os.date("%Y-%m-%dT%H:%M:%S"), entries = {} }
local logDirty = false
local LOG_PATH = "E:/taptap/zhubo/rebuild/cp3/playthrough_log.json"
local FPS_PATH = "E:/taptap/zhubo/rebuild/cp3/live_fps_preview.json"

local function logEntry(entry)
    entry.t = os.clock()
    entry.frame = frameCount
    table.insert(playLog.entries, entry)
    logDirty = true
    print("[CP3] " .. cjson.encode(entry))
end

local function dumpLog()
    if not logDirty then return end
    logDirty = false
    local ok, encoded = pcall(cjson.encode, playLog)
    if not ok then return end
    local f = File(LOG_PATH, FILE_WRITE)
    if f:IsOpen() then
        f:WriteString(encoded)
        f:Flush()
        f:Close()
    end
end

-- ============================================================================
-- 4. 聊天盒信息流（左下上滚）+ 爱心竖列 + 横飞横幅（仅大礼物/高等级进场）
-- ============================================================================
local CHAT_X, CHAT_W = 12, 400
local CHAT_BOTTOM, CHAT_ROWH, CHAT_VISIBLE = 734, 25, 10
local CHAT_FONT = 15
local chatRows = {}
local chatSlide = 0
local hearts = {}
local flyBanners = {}
local flyQueue = {}
local effectToast = nil
local onlineCount = 2
local viewerAvatars = {}

local CHAT_COLOR = {
    comment = { 240, 240, 245 }, entry = { 148, 163, 184 }, follow = { 52, 211, 153 },
    like = { 244, 114, 182 }, gift = { 251, 191, 36 }, hater = { 248, 113, 113 }, player = { 255, 255, 255 },
}
local HEART_COLORS = { { 244, 114, 182 }, { 239, 68, 68 }, { 251, 146, 60 }, { 236, 72, 153 } }

local function wrapChat(display, maxW)
    local rows, cur = {}, ""
    local i = 1
    while i <= #display do
        local b = display:byte(i)
        local chLen = b < 0x80 and 1 or (b < 0xE0 and 2 or (b < 0xF0 and 3 or 4))
        local ch = display:sub(i, i + chLen - 1)
        if textWidth(cur .. ch, CHAT_FONT) > maxW and #cur > 0 then
            table.insert(rows, cur)
            cur = ch
        else
            cur = cur .. ch
        end
        i = i + chLen
    end
    if #cur > 0 then table.insert(rows, cur) end
    return rows
end

local function pushChat(kind, name, text, opts)
    opts = opts or {}
    local display
    if kind == "player" then
        display = "主播：" .. text
    elseif opts.raw then
        display = (opts.badge and (opts.badge .. " ") or "") .. text
    elseif kind == "comment" or kind == "hater" or kind == "gift" then
        display = (opts.badge and (opts.badge .. " ") or "") .. name .. "：" .. text
    else
        display = text
    end
    local rows = wrapChat(display, CHAT_W - 16)
    for _, r in ipairs(rows) do
        table.insert(chatRows, { text = r, kind = kind })
        chatSlide = math.min(chatSlide + CHAT_ROWH, CHAT_ROWH * 3)
    end
    while #chatRows > 80 do table.remove(chatRows, 1) end
end

local function spawnHearts(n)
    for _ = 1, n do
        if #hearts >= 40 then break end
        local c = HEART_COLORS[math.random(#HEART_COLORS)]
        table.insert(hearts, {
            x = 486 + math.random(-12, 12), y = 786,
            vy = 55 + math.random() * 40, phase = math.random() * 6.28,
            life = 2.6 + math.random() * 0.8, maxLife = 3.0,
            size = 9 + math.random() * 7, color = c,
        })
    end
end

local function pushFly(text, style)
    local w = textWidth(text, 16) + 32
    table.insert(flyQueue, { text = text, w = math.min(w, 420), style = style })
    while #flyQueue > 4 do table.remove(flyQueue, 1) end
end

local function flyTick(dt)
    for i = #flyBanners, 1, -1 do
        local b = flyBanners[i]
        if b.x < 16 then
            b.x = math.min(16, b.x + dt * 700)
        else
            b.t = b.t - dt
        end
        if b.t <= 0 then table.remove(flyBanners, i) end
    end
    while #flyBanners < 2 and #flyQueue > 0 do
        local q = table.remove(flyQueue, 1)
        q.x = -q.w - 8
        q.t = 4.0
        q.slot = #flyBanners + 1
        table.insert(flyBanners, q)
    end
    for i, b in ipairs(flyBanners) do b.slot = i end
end

-- ============================================================================
-- 5. 氛围生成器：构成读 fanComposition、黑子读 haterPct、礼物分级、混合比沿小样口径
-- ============================================================================
local spawnAcc = 0
local heartAcc = 0

local function pickSegment()
    local comp = GS.fanComposition or {}
    local total = 0
    for _, s in ipairs(SEG_ORDER) do total = total + (comp[s] or 0) end
    if total <= 0 then return "乐子人" end
    local r = math.random() * total
    for _, s in ipairs(SEG_ORDER) do
        r = r - (comp[s] or 0)
        if r <= 0 then return s end
    end
    return "乐子人"
end

local function pickGift()
    local ladder = corpus.gift_ladder
    local total = 0
    for _, g in ipairs(ladder) do total = total + g.weight end
    local r = math.random() * total
    for _, g in ipairs(ladder) do
        r = r - g.weight
        if r <= 0 then return g end
    end
    return ladder[1]
end

local function fillTemplate(tpl, name, count)
    local s = tpl:gsub("{name}", name)
    if count then s = s:gsub("{count}", tostring(count)) end
    return s
end

local function emitGift(name, badge)
    local g = pickGift()
    local count = math.random(g.count_min or 1, g.count_max or 1)
    local text = fillTemplate(corpus.gift_template, name, count):gsub("{gift}", g.name)
    pushChat("gift", name, text, { badge = badge, raw = true })
    if g.tier == "big" then
        pushFly("「" .. name .. "」送出 " .. g.name .. " ×" .. count, "gift")
    end
end

local function atmosphereSpawn()
    local seg = pickSegment()
    local name = corpus.names[math.random(#corpus.names)]
    local lv = math.random(1, 12)
    local badge = math.random() < 0.3 and (corpus.badge_prefix .. "·" .. lv) or nil
    local mix = corpus.mix
    local r = math.random()
    if seg == "大哥" and r < (mix.boss_gift_prob or 0.55) then
        emitGift(name, badge)
        return
    end
    local acc = 0
    acc = acc + (mix.entry or 0.08)
    if r < acc then
        local tpl = corpus.entry_templates[math.random(#corpus.entry_templates)]
        pushChat("entry", name, fillTemplate(tpl, name))
        if badge and lv >= 8 then
            pushFly(badge .. " " .. name .. " 驾到", "entry")
        end
        return
    end
    acc = acc + (mix.follow or 0.08)
    if r < acc then
        local tpl = corpus.follow_templates[math.random(#corpus.follow_templates)]
        pushChat("follow", name, fillTemplate(tpl, name))
        return
    end
    acc = acc + (mix.like or 0.12)
    if r < acc then
        local tpl = corpus.like_templates[math.random(#corpus.like_templates)]
        pushChat("like", name, fillTemplate(tpl, name, math.random(1, 99)))
        spawnHearts(math.random(1, 2))
        return
    end
    acc = acc + (mix.gift or 0.08)
    if r < acc then
        emitGift(name, badge)
        return
    end
    local haterProb = (GS.haterPct or 0) / 100
    if haterProb > 0 and math.random() < haterProb then
        pushChat("hater", name, corpus.hater_lines[math.random(#corpus.hater_lines)])
    else
        local lines = corpus.segments[seg] or corpus.segments["乐子人"]
        pushChat("comment", name, lines[math.random(#lines)], { badge = badge })
    end
end

local function atmosphereTick(dt)
    local heat = GS.fiveDim.heat or 100
    spawnAcc = spawnAcc + math.min(6, 1.5 + heat / 100 * 2.0) * dt
    while spawnAcc >= 1 do
        spawnAcc = spawnAcc - 1
        atmosphereSpawn()
    end
    heartAcc = heartAcc + math.min(4, 0.8 + heat / 100 * 1.2) * dt
    while heartAcc >= 1 do
        heartAcc = heartAcc - 1
        spawnHearts(1)
    end
    chatSlide = math.max(0, chatSlide - dt * 160)
    for i = #hearts, 1, -1 do
        local h = hearts[i]
        h.y = h.y - h.vy * dt
        h.x = h.x + math.sin(timeSec * 3 + h.phase) * 14 * dt
        h.life = h.life - dt
        if h.life <= 0 or h.y < 450 then table.remove(hearts, i) end
    end
    flyTick(dt)
    if effectToast then
        effectToast.t = effectToast.t - dt
        if effectToast.t <= 0 then effectToast = nil end
    end
    local fd = GS.fiveDim
    onlineCount = math.max(2, math.floor(2 + fd.fans * 0.08 + fd.heat * 0.03 + math.sin(timeSec * 0.7) * 2))
end

-- ============================================================================
-- 6. 事件 runner：真抽卡队列逐卡注入 / 超时没接住 / 命中走原引擎结算
-- ============================================================================
runner = { state = "menu", gapT = 2.0, timeLeft = 0, scriptT = 0, script = {} }
-- 内嵌翻样辨真桥段标记（仅 sample_inspect 卡 C4-M02/C5-M07 激活）；复用 GS.inspectInstance（沿 act_5/Ops-B 口径）
local inlineInspect = nil
local lastScreen = "Screen-01"

local function queueIds()
    local ids = {}
    for _, c in ipairs(GS.chapterQueue or {}) do table.insert(ids, c.card_id) end
    return ids
end

-- 时机条初始化：逐字镜像 main.lua selectCardOption 推进段 / btn_start_live（常量 0.2/0.6/0.075/0.20 系原引擎值，非新数值）
local function initTimingForCard(card)
    local t = GS.timingInstance
    if card and card.ops_type == "timing_bar" then
        t.active = true
        t.cursorPos = 0.0
        t.cursorDir = 1
        local center = 0.2 + math.random() * 0.6
        t.sweetStart = center - 0.075
        t.sweetEnd = center + 0.075
        t.goodStart = center - 0.20
        t.goodEnd = center + 0.20
        t.multiplier = 1.0
        t.isResolved = false
    else
        t.active = false
    end
end

-- 屏迁移统一记账（排班/直播/下播/结算/结局/分享/图鉴/重开），供实玩证据与回归断言
local function watchScreen()
    local to = GS.screen
    if to == lastScreen then return end
    local from = lastScreen
    lastScreen = to
    if to == "Screen-03" then
        logEntry({ kind = "LIVE_START", chapter = GS.currentChapter, drawn = queueIds(), schedule = shallowCopy(GS.schedule), overtime = GS.overtimeActive or false, from = from })
    elseif to == "Screen-02" then
        logEntry({ kind = "SCHEDULE_ENTER", chapter = GS.currentChapter, schedule = shallowCopy(GS.schedule), from = from })
    elseif to == "Screen-04" then
        logEntry({ kind = "STREAM_END", chapter = GS.currentChapter, note = "本章卡完成，进入下播行动8选1", from = from })
    elseif to == "Ops-B" then
        logEntry({ kind = "OPS_B_ENTER", chapter = GS.currentChapter, from = from })
    elseif to == "Screen-05" then
        logEntry({ kind = "SETTLE", chapter = GS.currentChapter, result = shallowCopy(GS.settleResult or {}), fiveDim = shallowCopy(GS.fiveDim), fanComposition = shallowCopy(GS.fanComposition), ending = GS.triggeredEnding, from = from })
        dumpLog()
    elseif to == "Screen-06" or to == "Screen-07" then
        logEntry({ kind = "ENDING", chapter = GS.currentChapter, ending = GS.triggeredEnding, dead = (to == "Screen-06"), cleared = (to == "Screen-07"), from = from })
        dumpLog()
    elseif to == "Screen-08" then
        logEntry({ kind = "SHARE_CARD", ending = GS.triggeredEnding, from = from })
    elseif to == "Screen-09" then
        logEntry({ kind = "GALLERY", from = from })
    elseif to == "Screen-01" then
        logEntry({ kind = "NEW_RUN", from = from })
    end
end

-- 进入直播屏（首开/加时/复活回滚）：重置视觉层，runner 从当前卡序推进（不重置卡序，复活回滚保卡序）
local function engageLive()
    runner.state = "gap"
    runner.gapT = 2.0
    inlineInspect = nil
    chatRows = {}
    hearts = {}
    flyBanners = {}
    flyQueue = {}
    effectToast = nil
    viewerAvatars = {}
    for i = 1, 6 do
        local n = corpus.names[math.random(#corpus.names)]
        table.insert(viewerAvatars, utf8Cut(n, 1))
    end
end

local function startEvent(idx)
    local card = GS.chapterQueue[idx]
    if not card then return end
    GS.currentCard = card
    GS.currentCardIndex = idx
    -- 时机条已由 btn_start_live / selectCardOption 推进 / advanceNeutral 初始化，此处不重置（避免重随机甜区）
    inlineInspect = nil
    if card.ops_type == "sample_inspect" then
        -- 翻样辨真内嵌桥段：逐字镜像 main.lua act_5 初始化（4 样/2 翻/随机掺假位）
        GS.inspectInstance.active = true
        GS.inspectInstance.flipsRemaining = 2
        GS.inspectInstance.revealed = { false, false, false, false }
        GS.inspectInstance.fakeIndex = math.random(4)
        GS.inspectInstance.success = false
        inlineInspect = { cardId = card.card_id }
    end
    runner.state = "active"
    runner.timeLeft = EVENT_DURATION
    runner.scriptT = 0
    runner.script = {}
    local def = INTENTS_BY_ID[card.card_id]
    assert(def, "cp3: intents missing for " .. tostring(card.card_id))
    for i, s in ipairs(def.script or {}) do
        table.insert(runner.script, { t = (i - 1) * 0.9, kind = s.kind, name = s.name, text = s.text, gift = s.gift, count = s.count })
    end
    logEntry({ kind = "EVENT_START", card = card.card_id, title = card.title, index = idx, queue = #GS.chapterQueue, ops = card.ops_type or "none", overtime = GS.overtimeActive or false })
end

local function showEffectToast(diff)
    local lines = {}
    local label = { fans = "粉丝", heat = "热度", wallet = "钱包", rep = "口碑", stamina = "状态" }
    for _, k in ipairs({ "fans", "heat", "wallet", "rep", "stamina" }) do
        local d = diff.fiveDim[k]
        if d then
            local delta = d[2] - d[1]
            table.insert(lines, label[k] .. (delta >= 0 and " +" or " ") .. string.format("%d", delta))
        end
    end
    for k, d in pairs(diff.variables) do
        if #lines >= 4 then break end
        table.insert(lines, k .. " → " .. tostring(d[2]))
    end
    if #lines > 0 then effectToast = { lines = lines, t = 3.0 } end
end

-- 事件收口：仍在直播屏则间隙推进下一卡；否则交棒 menu（屏迁移由 watchScreen 记账，结局/结算屏委托 main）
local function afterEventClosed()
    inlineInspect = nil
    if GS.screen == "Screen-03" then
        runner.state = "gap"
        runner.gapT = 3.5
    else
        runner.state = "menu"
    end
end

-- 超时没接住：零效果中性推进，逐字镜像 main.lua selectCardOption 流转段（含下一卡时机条初始化）
local function advanceNeutral()
    GS.currentCardIndex = GS.currentCardIndex + 1
    if GS.currentCardIndex <= #GS.chapterQueue then
        GS.currentCard = GS.chapterQueue[GS.currentCardIndex]
        initTimingForCard(GS.currentCard)
    else
        GS.currentCard = nil
        if GS.overtimeActive then
            engine.settleCurrentChapter(false)
        else
            GS.screen = "Screen-04"
        end
    end
end

function runnerTick(dt)
    if runner.state == "gap" then
        runner.gapT = runner.gapT - dt
        if runner.gapT <= 0 then
            if GS.currentCard and GS.currentCardIndex <= #GS.chapterQueue then
                startEvent(GS.currentCardIndex)
            else
                afterEventClosed()
            end
        end
    elseif runner.state == "active" then
        runner.scriptT = runner.scriptT + dt
        while #runner.script > 0 and runner.script[1].t <= runner.scriptT do
            local s = table.remove(runner.script, 1)
            if s.kind == "gift" then
                pushChat("gift", s.name, s.text, { gift = s.gift, count = s.count })
            else
                pushChat(s.kind, s.name, s.text)
            end
        end
        runner.timeLeft = runner.timeLeft - dt
        if runner.timeLeft <= 0 then
            local cardId = GS.currentCard and GS.currentCard.card_id or "?"
            logEntry({ kind = "TIMEOUT", card = cardId, result = "没接住", note = intentsData.defaults.timeout_result })
            pushChat("comment", "围观", "主播没接住，话题过去了")
            advanceNeutral()
            afterEventClosed()
        end
    end
end

-- ============================================================================
-- 5b. 输入管道 + 统一发送（按钮/chips 同一入口），匹配走施工匹配器本体
-- ============================================================================
inputText = ""
composition = ""
inputFocused = false

local function setInputFocus(on)
    inputFocused = on
    local inp = (GetInput and GetInput()) or input
    if inp and inp.SetScreenKeyboardVisible then inp:SetScreenKeyboardVisible(on) end
    if not on then composition = "" end
end

function sendReply(text, source)
    text = tostring(text or ""):gsub("^%s+", ""):gsub("%s+$", "")
    if #text == 0 then return end
    local entry = { kind = "REPLY", text = text, source = source or "button" }
    pushChat("player", "小星", text)
    if runner.state == "active" and GS.currentCard then
        local card = GS.currentCard
        local def = INTENTS_BY_ID[card.card_id]
        entry.card = card.card_id
        local intentId, pat = matcher.match(def.intents, text)
        local matched = nil
        if intentId then
            for _, it in ipairs(def.intents) do
                if it.id == intentId then matched = it break end
            end
        end
        if matched then
            entry.intent = matched.id
            entry.opt_key = matched.opt_key
            entry.pattern = pat
            local before = snapshotState()
            local beforeIdx, beforeScreen, beforeCard = GS.currentCardIndex, GS.screen, GS.currentCard
            engine.selectCardOption(matched.opt_key)
            if GS.currentCardIndex == beforeIdx and GS.screen == beforeScreen and GS.currentCard == beforeCard then
                entry.result = "locked"
                entry.note = "req_expr 门控未过，事件继续"
                pushChat("comment", "围观", "这个方向现在还锁着，换一条试试")
                logEntry(entry)
            else
                entry.result = "hit"
                entry.diff = diffState(before)
                local opt = nil
                for _, o in ipairs(card.options or {}) do
                    if o.opt_key == matched.opt_key then opt = o end
                end
                entry.inherited_effects = opt and opt.effects or nil
                for _, line in ipairs(matched.reactions or {}) do
                    pushChat("comment", corpus.names[math.random(#corpus.names)], line)
                end
                showEffectToast(entry.diff)
                logEntry(entry)
                afterEventClosed()
            end
        else
            entry.intent = "miss"
            entry.result = "miss"
            for _, line in ipairs(def.miss_reactions or {}) do
                pushChat("comment", corpus.names[math.random(#corpus.names)], line)
            end
            logEntry(entry)
        end
    else
        entry.result = "no_event"
        logEntry(entry)
    end
    inputText = ""
    composition = ""
    dumpLog()
end

-- ============================================================================
-- 7. 帧率预览（墙钟口径同小样；正式复测在 CP4，本件仅作早期信号）
-- ============================================================================
local fps = { lastT = nil, samples = {}, concSum = 0, concMin = math.huge, dumped = false }

local function fpsTick()
    local now = os.clock()
    if fps.lastT then
        local dtMs = (now - fps.lastT) * 1000
        if frameCount > 50 then
            table.insert(fps.samples, dtMs)
            local conc = math.min(#chatRows, CHAT_VISIBLE) + #hearts + #flyBanners
            fps.concSum = fps.concSum + conc
            if conc < fps.concMin then fps.concMin = conc end
        end
    end
    fps.lastT = now
    if not fps.dumped and frameCount >= 2150 and #fps.samples >= 2000 then
        fps.dumped = true
        local sorted = {}
        local sum, minV, maxV = 0, math.huge, 0
        for _, v in ipairs(fps.samples) do
            table.insert(sorted, v)
            sum = sum + v
            if v < minV then minV = v end
            if v > maxV then maxV = v end
        end
        table.sort(sorted)
        local avg = sum / #sorted
        local p95 = sorted[math.max(1, math.floor(#sorted * 0.95))]
        local payload = {
            test = "cp3 full-flow douyin shell FPS preview (NOT the CP4 gate)",
            method = "os.clock wall-clock per Update frame; 50-frame warmup; real jitter, not engine step",
            total_frames = frameCount,
            valid_wall_samples = #sorted,
            avg_dt_ms = math.floor(avg * 100) / 100,
            p95_dt_ms = math.floor(p95 * 100) / 100,
            min_dt_ms = math.floor(minV * 100) / 100,
            max_dt_ms = math.floor(maxV * 100) / 100,
            est_fps = math.floor(1000 / avg * 10) / 10,
            concurrent_avg = math.floor(fps.concSum / #sorted * 10) / 10,
            concurrent_min = fps.concMin,
            exported_at = os.date("%Y-%m-%dT%H:%M:%S"),
        }
        local ok, encoded = pcall(cjson.encode, payload)
        if ok then
            local f = File(FPS_PATH, FILE_WRITE)
            if f:IsOpen() then
                f:WriteString(encoded)
                f:Flush()
                f:Close()
                print("[CP3_FPS] " .. encoded)
            end
        end
    end
end

-- ============================================================================
-- 8. 渲染（模式A：540×960 CONTAIN）
-- ============================================================================
local function drawText(x, y, text, size, r, g, b, a)
    if fontId == -1 then return end
    nvgFontFaceId(nvgContext, fontId)
    nvgFontSize(nvgContext, size or 20)
    nvgFillColor(nvgContext, nvgRGBA(r or 255, g or 255, b or 255, a or 255))
    nvgTextAlign(nvgContext, 1 + 8)
    nvgText(nvgContext, x, y, tostring(text), nil)
end

local function drawRect(x, y, w, h, r, g, b, a)
    nvgBeginPath(nvgContext)
    nvgRect(nvgContext, x, y, w, h)
    nvgFillColor(nvgContext, nvgRGBA(r, g, b, a or 255))
    nvgFill(nvgContext)
end

local function drawRound(x, y, w, h, rad, r, g, b, a)
    nvgBeginPath(nvgContext)
    nvgRoundedRect(nvgContext, x, y, w, h, rad)
    nvgFillColor(nvgContext, nvgRGBA(r, g, b, a or 255))
    nvgFill(nvgContext)
end

local function drawCircle(x, y, rad, r, g, b, a)
    nvgBeginPath(nvgContext)
    nvgCircle(nvgContext, x, y, rad)
    nvgFillColor(nvgContext, nvgRGBA(r, g, b, a or 255))
    nvgFill(nvgContext)
end

local function drawHeart(x, y, s, r, g, b, a)
    nvgBeginPath(nvgContext)
    nvgMoveTo(nvgContext, x, y + s * 0.9)
    nvgBezierTo(nvgContext, x - s * 1.1, y + s * 0.25, x - s * 0.7, y - s * 0.75, x, y - s * 0.15)
    nvgBezierTo(nvgContext, x + s * 0.7, y - s * 0.75, x + s * 1.1, y + s * 0.25, x, y + s * 0.9)
    nvgFillColor(nvgContext, nvgRGBA(r, g, b, a or 255))
    nvgFill(nvgContext)
end

local function fmtOnline(n)
    if n >= 10000 then return string.format("%.1f万", n / 10000) end
    return tostring(math.floor(n))
end

local function currentDef()
    if runner.state == "active" and GS.currentCard then
        return INTENTS_BY_ID[GS.currentCard.card_id]
    end
    return nil
end

-- chips 布局：每意图取 chips[1]，右界 452 让位爱心竖列，超宽换行
local function layoutChips(def)
    local list = {}
    local cx, cy = 16, 746
    for _, it in ipairs(def.intents or {}) do
        local chip = it.chips and it.chips[1]
        if chip then
            local cw = textWidth(chip, 14) + 24
            if cx + cw > 452 then
                cx = 16
                cy = cy + 46
            end
            if cy <= 794 then
                table.insert(list, { x = cx, y = cy, w = cw, text = chip })
                cx = cx + cw + 8
            end
        end
    end
    return list
end

local function renderTopBar()
    -- 主播药丸
    drawRound(12, 10, 196, 44, 22, 30, 34, 52, 230)
    drawCircle(34, 32, 17, 236, 72, 153)
    drawText(27, 24, "星", 16, 255, 255, 255)
    drawText(58, 15, "小星", 15, 255, 255, 255)
    drawText(58, 35, fmtOnline(GS.fiveDim.fans) .. " 粉丝", 10, 148, 163, 184)
    drawRound(150, 19, 50, 26, 13, 236, 72, 153)
    drawText(162, 25, "关注", 12, 255, 255, 255)
    -- 观众头像排
    for i, ch in ipairs(viewerAvatars) do
        local x = 232 + (i - 1) * 30
        drawCircle(x, 32, 13, 45, 52, 80)
        drawText(x - 6, 25, ch, 12, 203, 213, 225)
    end
    drawText(416, 18, "在线", 11, 148, 163, 184)
    drawText(416, 34, fmtOnline(onlineCount), 14, 255, 255, 255)
end

-- 轻操作内嵌布局（视频面占位区上方），渲染与点击共用同一坐标
local TIMING_TAP = { x = 70, y = 348, w = 400, h = 40 }
local function inspectRect(i)
    local col = (i - 1) % 2
    local row = math.floor((i - 1) / 2)
    return 72 + col * 200, 284 + row * 80, 186, 70
end

local function renderTimingBar()
    local t = GS.timingInstance
    local barX, barY, barW, barH = 70, 300, 400, 36
    drawRound(barX - 12, barY - 30, barW + 24, 128, 12, 20, 24, 40, 238)
    drawText(barX, barY - 26, "时机条 · 停在甜区享 ×1.15（良区 ×1.05）", 13, 250, 204, 21)
    drawRound(barX, barY, barW, barH, 6, 15, 23, 42)
    drawRect(barX + t.goodStart * barW, barY + 2, (t.goodEnd - t.goodStart) * barW, barH - 4, 59, 130, 246, 180)
    drawRect(barX + t.sweetStart * barW, barY + 2, (t.sweetEnd - t.sweetStart) * barW, barH - 4, 236, 72, 153, 220)
    drawRect(barX + t.cursorPos * barW - 3, barY - 4, 6, barH + 8, 255, 255, 255)
    local label = t.isResolved and string.format("已点停：%s ×%.2f", t.resultZone, t.multiplier) or "轻点点停游标"
    drawRound(TIMING_TAP.x, TIMING_TAP.y, TIMING_TAP.w, TIMING_TAP.h, 8, 245, 158, 11, 225)
    drawText(TIMING_TAP.x + 130, TIMING_TAP.y + 11, label, 16, 15, 23, 42)
end

local function renderInspectPanel()
    local inst = GS.inspectInstance
    drawRound(60, 250, 420, 212, 12, 20, 24, 40, 238)
    drawText(72, 256, "翻样辨真 · 翻 2 件找掺假（命中锁选品减伤）", 13, 250, 204, 21)
    local names = { "1. 查针脚", "2. 查吊牌", "3. 查水洗标", "4. 闻气味" }
    for i = 1, 4 do
        local x, y, w, h = inspectRect(i)
        local rev = inst.revealed[i]
        local fake = (i == inst.fakeIndex)
        local r, g, b = 30, 41, 59
        if rev then
            if fake then r, g, b = 239, 68, 68 else r, g, b = 16, 185, 129 end
        end
        drawRound(x, y, w, h, 8, r, g, b)
        drawText(x + 10, y + 8, names[i], 14, 255, 255, 255)
        if rev then
            drawText(x + 10, y + 36, fake and "致命瑕疵！掺假" or "合格真品", 13, 255, 255, 255)
        else
            drawText(x + 10, y + 36, inst.flipsRemaining > 0 and "点翻抽检" or "机会已用尽", 12, 148, 163, 184)
        end
    end
    local status = "剩余抽检机会：" .. inst.flipsRemaining .. " 次"
    if inst.success then status = status .. " · 验货成功✓ 锁定减伤" end
    drawText(72, 440, status, 13, inst.success and 16 or 250, inst.success and 185 or 204, inst.success and 129 or 21)
end

local function renderLive()
    -- 全屏视频面（主播位占位，美术阶段4）
    drawRect(0, 0, DESIGN_W, DESIGN_H, 14, 16, 26)
    drawRound(220, 290, 100, 100, 50, 30, 35, 58)
    drawText(246, 328, "主播位", 20, 100, 116, 139)
    drawText(213, 402, "全屏视频面 · 美术阶段4", 13, 71, 85, 105)
    renderTopBar()
    -- 事件话题横幅 + 倒计时
    if runner.state == "active" and GS.currentCard then
        local card = GS.currentCard
        drawRound(16, 66, 508, 62, 10, 35, 42, 66, 235)
        drawText(28, 72, "话题 " .. GS.currentCardIndex .. "/" .. #GS.chapterQueue .. " · " .. card.title, 16, 255, 255, 255)
        local ctx = card.context_text or ""
        if utf8Len(ctx) > 32 then ctx = utf8Cut(ctx, 32) .. "…" end
        drawText(28, 94, ctx, 11, 148, 163, 184)
        local frac = math.max(0, runner.timeLeft / EVENT_DURATION)
        drawRect(28, 118, 480 * frac, 4, frac > 0.25 and 96 or 239, frac > 0.25 and 165 or 68, frac > 0.25 and 250 or 68)
    else
        drawText(16, 76, "直播进行中… 下一个话题马上来", 13, 100, 116, 139)
    end
    -- 紧凑数值条
    local fd = GS.fiveDim
    drawText(16, 140, "热度 " .. math.floor(fd.heat) .. " · 钱包 ￥" .. math.floor(fd.wallet) .. " · 口碑 " .. math.floor(fd.rep) .. " · 状态 " .. math.floor(fd.stamina) .. " · 黑粉 " .. math.floor(GS.haterPct or 0) .. "%", 12, 148, 163, 184)
    -- 横飞横幅（仅大礼物 / 高等级进场）
    for _, b in ipairs(flyBanners) do
        local y = 162 + (b.slot - 1) * 42
        local alpha = b.t < 0.5 and math.floor(230 * b.t / 0.5) or 230
        if b.style == "gift" then
            drawRound(b.x, y, b.w, 36, 18, 120, 80, 10, alpha)
            drawText(b.x + 16, y + 9, b.text, 16, 251, 191, 36, alpha)
        else
            drawRound(b.x, y, b.w, 36, 18, 76, 40, 130, alpha)
            drawText(b.x + 16, y + 9, b.text, 16, 216, 180, 254, alpha)
        end
    end
    -- 效果浮签
    if effectToast then
        local alpha = effectToast.t < 0.6 and math.floor(255 * effectToast.t / 0.6) or 255
        local y = 446 - (#effectToast.lines - 1) * 20
        for _, line in ipairs(effectToast.lines) do
            drawText(16, y, line, 14, 52, 211, 153, alpha)
            y = y + 20
        end
    end
    -- 轻操作内嵌（时机条 / 翻样辨真），叠于视频面占位区，事件激活时可见
    if runner.state == "active" and GS.currentCard then
        if GS.currentCard.ops_type == "timing_bar" and GS.timingInstance.active then
            renderTimingBar()
        elseif GS.currentCard.ops_type == "sample_inspect" and inlineInspect then
            renderInspectPanel()
        end
    end
    -- 聊天盒（左下，上滚动画，scissor 裁剪）
    nvgSave(nvgContext)
    nvgScissor(nvgContext, CHAT_X - 4, CHAT_BOTTOM - CHAT_VISIBLE * CHAT_ROWH - 4, CHAT_W + 8, CHAT_VISIBLE * CHAT_ROWH + 8)
    local first = math.max(1, #chatRows - CHAT_VISIBLE + 1)
    local y = CHAT_BOTTOM - (#chatRows - first + 1) * CHAT_ROWH + chatSlide
    for i = first, #chatRows do
        local row = chatRows[i]
        local c = CHAT_COLOR[row.kind] or CHAT_COLOR.comment
        if row.kind == "player" then
            local w = textWidth(row.text, CHAT_FONT)
            drawRound(CHAT_X, y + 16, math.min(w + 12, CHAT_W), 22, 6, 190, 120, 30, 200)
        end
        drawText(CHAT_X + 6, y, row.text, CHAT_FONT, c[1], c[2], c[3])
        y = y + CHAT_ROWH
    end
    nvgRestore(nvgContext)
    -- 爱心竖列
    for _, h in ipairs(hearts) do
        local alpha = math.floor(255 * math.min(1, h.life / 0.8))
        drawHeart(h.x, h.y, h.size, h.color[1], h.color[2], h.color[3], alpha)
    end
    drawCircle(498, 812, 24, 30, 34, 52, 230)
    drawHeart(498, 810, 11, 244, 114, 182)
    -- chips
    local def = currentDef()
    if def then
        for _, chip in ipairs(layoutChips(def)) do
            drawRound(chip.x, chip.y, chip.w, 38, 19, 45, 52, 80, 235)
            drawText(chip.x + 12, chip.y + 11, chip.text, 14, 203, 213, 225)
        end
    end
    -- 输入丸 + 屏上发送键
    drawRound(16, 846, 300, 54, 27, 30, 35, 58)
    nvgBeginPath(nvgContext)
    nvgRoundedRect(nvgContext, 16, 846, 300, 54, 27)
    nvgStrokeColor(nvgContext, inputFocused and nvgRGBA(236, 72, 153, 255) or nvgRGBA(100, 116, 139, 255))
    nvgStrokeWidth(nvgContext, 2)
    nvgStroke(nvgContext)
    local show = inputText
    if utf8Len(show) > 14 then show = "…" .. utf8Tail(show, 14) end
    drawText(32, 858, #show > 0 and show or (inputFocused and "打字回复…" or "说点什么…"), 16, #show > 0 and 255 or 100, #show > 0 and 255 or 116, #show > 0 and 255 or 139)
    if #composition > 0 then
        drawText(32, 882, "[" .. composition .. "]", 12, 148, 163, 184)
    end
    drawRound(324, 846, 96, 54, 27, 236, 72, 153)
    drawText(352, 861, "发送", 18, 255, 255, 255)
    drawRound(428, 846, 80, 54, 27, 100, 116, 139)
    drawText(450, 861, "清空", 16, 255, 255, 255)
    drawText(16, 916, "聊天行 " .. #chatRows .. " · 帧 " .. frameCount .. (fps.dumped and " · FPS预览已导出" or ""), 12, 100, 116, 139)
    drawText(16, 936, "键盘仅文本通道可用，发送/清空用按钮；超时30s没接住自动继续", 11, 100, 116, 139)
end

function HandleRender(eventType, eventData)
    if not nvgContext then return end
    local graphics = GetGraphics()
    local physW, physH = graphics:GetWidth(), graphics:GetHeight()
    local dpr = graphics:GetDPR()
    local logicalW, logicalH = physW / dpr, physH / dpr
    viewDpr = dpr
    viewScale = math.min(logicalW / DESIGN_W, logicalH / DESIGN_H)
    local screenDesignW, screenDesignH = logicalW / viewScale, logicalH / viewScale
    viewOffX = (screenDesignW - DESIGN_W) / 2
    viewOffY = (screenDesignH - DESIGN_H) / 2
    nvgBeginFrame(nvgContext, logicalW, logicalH, dpr)
    nvgScale(nvgContext, viewScale, viewScale)
    drawRect(0, 0, screenDesignW, screenDesignH, 14, 16, 26)
    nvgTranslate(nvgContext, viewOffX, viewOffY)
    if GS.screen == "Screen-03" then
        renderLive()
    else
        engine.renderMenu()
    end
    nvgEndFrame(nvgContext)
end

-- ============================================================================
-- 9. 主循环与事件订阅
-- ============================================================================
function HandleUpdate(eventType, eventData)
    local dt = eventData:GetFloat("TimeStep")
    frameCount = frameCount + 1
    timeSec = timeSec + dt
    fpsTick()
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

local function toDesign(x, y)
    return x / viewDpr / viewScale - viewOffX, y / viewDpr / viewScale - viewOffY
end

local function handleClick(x, y)
    local dx, dy = toDesign(x, y)
    -- 非直播屏：点击委托 main.lua 既有按钮（设计坐标）
    if GS.screen ~= "Screen-03" then
        engine.menuClick(dx, dy)
        return
    end
    -- 时机条点停（甜区×1.15/良区×1.05/其余×1.0，沿 main.lua btn_tap_timing 常量）
    if runner.state == "active" and GS.currentCard and GS.currentCard.ops_type == "timing_bar" and GS.timingInstance.active then
        if dx >= TIMING_TAP.x and dx <= TIMING_TAP.x + TIMING_TAP.w and dy >= TIMING_TAP.y and dy <= TIMING_TAP.y + TIMING_TAP.h then
            local t = GS.timingInstance
            if not t.isResolved then
                t.isResolved = true
                local pos = t.cursorPos
                if pos >= t.sweetStart and pos <= t.sweetEnd then
                    t.resultZone = "SWEET"; t.multiplier = 1.15
                elseif pos >= t.goodStart and pos <= t.goodEnd then
                    t.resultZone = "GOOD"; t.multiplier = 1.05
                else
                    t.resultZone = "NORMAL"; t.multiplier = 1.0
                end
                logEntry({ kind = "TIMING_TAP", card = GS.currentCard.card_id, zone = t.resultZone, multiplier = t.multiplier })
            end
            return
        end
    end
    -- 翻样辨真内嵌翻牌（命中写 Count_验货命中+1 & Flag_选品减伤=1，逐字沿 main.lua renderOpsB）
    if runner.state == "active" and inlineInspect and GS.currentCard and GS.currentCard.ops_type == "sample_inspect" then
        local inst = GS.inspectInstance
        for i = 1, 4 do
            local sx, sy, sw, sh = inspectRect(i)
            if dx >= sx and dx <= sx + sw and dy >= sy and dy <= sy + sh then
                if inst.flipsRemaining > 0 and not inst.revealed[i] then
                    inst.revealed[i] = true
                    inst.flipsRemaining = inst.flipsRemaining - 1
                    if i == inst.fakeIndex then
                        inst.success = true
                        GS.variables["Count_验货命中"] = (tonumber(GS.variables["Count_验货命中"]) or 0) + 1
                        GS.variables["Flag_选品减伤"] = 1
                        logEntry({ kind = "INSPECT_HIT", card = GS.currentCard.card_id, sample = i })
                    else
                        logEntry({ kind = "INSPECT_FLIP", card = GS.currentCard.card_id, sample = i, fake = false })
                    end
                end
                return
            end
        end
    end
    -- chips
    local def = currentDef()
    if def then
        for _, chip in ipairs(layoutChips(def)) do
            if dx >= chip.x and dx <= chip.x + chip.w and dy >= chip.y and dy <= chip.y + 38 then
                sendReply(chip.text, "chip")
                return
            end
        end
    end
    -- 点赞按钮（纯视觉氛围，不入数值）
    if dx >= 474 and dx <= 522 and dy >= 788 and dy <= 836 then
        spawnHearts(6)
        return
    end
    -- 输入行
    if dy >= 846 and dy <= 900 then
        if dx >= 16 and dx <= 316 then
            if not inputFocused then setInputFocus(true) end
            return
        elseif dx >= 324 and dx <= 420 then
            sendReply(inputText, "button")
            return
        elseif dx >= 428 and dx <= 508 then
            inputText = ""
            composition = ""
            return
        end
    end
    if inputFocused then setInputFocus(false) end
end

function HandleMouseButtonDown(eventType, eventData)
    handleClick(eventData:GetInt("X"), eventData:GetInt("Y"))
end

function HandleTouchEnd(eventType, eventData)
    handleClick(eventData:GetInt("X"), eventData:GetInt("Y"))
end

function HandleTextInput(eventType, eventData)
    local text = eventData:GetString("Text")
    if inputFocused and GS.screen == "Screen-03" and text and #text > 0 then
        inputText = inputText .. text
    end
end

function HandleTextEditing(eventType, eventData)
    composition = eventData:GetString("Composition") or ""
end

function HandleInputFocus(eventType, eventData)
    if not eventData:GetBool("Focus") and inputFocused then setInputFocus(false) end
end

function Start()
    print("[CP3] Start · 全流程接通（加点→排班→直播→下播→结算→结局）+ 轻操作嵌回")
    nvgContext = nvgCreate(1)
    if nvgContext then
        fontId = nvgCreateFont(nvgContext, "msyh", "C:/Windows/Fonts/msyh.ttc")
        if fontId == -1 then fontId = nvgCreateFont(nvgContext, "simhei", "C:/Windows/Fonts/simhei.ttf") end
        engine.setContext(nvgContext, fontId)
        SubscribeToEvent(nvgContext, "NanoVGRender", "HandleRender")
    end
    local inp = (GetInput and GetInput()) or input
    if inp then
        if inp.SetMouseVisible then inp:SetMouseVisible(true) else inp.mouseVisible = true end
        if MM_FREE then
            if inp.SetMouseMode then inp:SetMouseMode(MM_FREE) else inp.mouseMode = MM_FREE end
        end
    end
    --  boot 至开局加点屏（Screen-01）；resetGameState 已在 loadEngine 内调用，runner 处于 menu
    runner.state = "menu"
    lastScreen = GS.screen
    SubscribeToEvent("Update", "HandleUpdate")
    SubscribeToEvent("MouseButtonDown", "HandleMouseButtonDown")
    SubscribeToEvent("TouchEnd", "HandleTouchEnd")
    SubscribeToEvent("TextInput", "HandleTextInput")
    SubscribeToEvent("TextEditing", "HandleTextEditing")
    SubscribeToEvent("InputFocus", "HandleInputFocus")
    logEntry({ kind = "CP3_READY", note = "全流程九屏委托/抖音式直播逐卡/时机条6卡/翻样辨真C4-M02+C5-M07/多章推进/按钮发送" })
    print("[CP3] READY")
end