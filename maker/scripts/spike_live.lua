-- 《从小主播到顶流》阶段2呈现重做 · 可行性小样（一次性，验通后全量重建另行下单）
-- 直播主屏 + 多车道弹幕 + 氛围生成器 + 自由打字回复 + 5 真实事件注入
-- 数值结算复用 main.lua 原引擎（load 源码取局部引用，零改动）；意图只继承原卡选项效果集，不新造数值。
-- 输入口径（探针实证）：本运行时 Windows 桌面只送 TextInput/TextEditing，KeyDown/GetKeyPress/GetKeyDown 三通道皆无；
--   故发送/清空走屏上按钮，打字走真实 IME，不依赖 Enter/Backspace。

local cjson = require("cjson")

-- ============================================================================
-- 1. 原引擎复用：执行 main.lua 源码并取出其局部函数/状态（磁盘零改动）
-- ============================================================================
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
    assert(src and #src > 0, "spike: main.lua source not found")
    -- 数据装载以 zhubo/data 冻结正本为先；maker/assets/data 副本缺 Tag_流派（C1-M01C 写入 + 字典38键），仅作末位兜底
    local extra = [[
;local function __spikeLoad(name)
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
                if ok then
                    print("[SPIKE_DATA] " .. name .. " <- " .. p)
                    return parsed
                end
            end
        end
    end
    error("spike data not found: " .. name)
end
local function __spikeInit()
    cardsData = __spikeLoad("cards.json")
    configData = __spikeLoad("config_and_screens.json")
    endingsData = __spikeLoad("endings_and_talents.json")
    stateDict = __spikeLoad("state_dictionary.json")
    loadSave()
    resetGameState()
end
__spikeInit()
return {
    gameState = gameState,
    cardsData = cardsData,
    configData = configData,
    selectCardOption = selectCardOption,
    resetGameState = resetGameState,
    evalExpr = evalExpr,
    applyStateWrite = applyStateWrite,
}
]]
    local chunk = assert(load(src .. extra, "@main.lua"))
    return chunk()
end

local engine = loadEngine()
local GS = engine.gameState

-- ============================================================================
-- 2. 小样状态与工具
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
-- 3. 五事件定义：意图 -> 原卡 opt_key（效果集全部继承 cards.json，无新造数值）
-- ============================================================================
local EVENT_IDS = { "C1-M01", "C1-M05", "C1-M07", "C1-M10", "C1-S01" }
local EVENT_DURATION = 30

EVENT_DEFS = {
    ["C1-M01"] = {
        -- A=锁才艺/电台(空效果) B=锁游戏(空效果) C=Tag_流派=整活(×2.5/35%清零乘区由引擎施加)
        intents = {
            { id = "talent", opt_key = "A", patterns = { "才艺", "唱歌", "唱跳", "电台", "嗓音", "慢工" },
              reactions = { "才艺路线稳了", "慢工出细活，蹲一个", "声控粉狂喜" } },
            { id = "game", opt_key = "B", patterns = { "游戏", "技术", "上分", "开黑", "死磕" },
              reactions = { "技术流主播来了", "上分上分", "游戏区见" } },
            { id = "circus", opt_key = "C", patterns = { "整活", "抽象", "玩偶", "先火", "狠活" },
              reactions = { "整活！节目效果拉满", "玩偶服安排", "先火再说哈哈哈" } },
        },
        missReactions = { "主播没表态，弹幕继续吵", "路线之争还在继续" },
        fallback = "中性零效果：不锁流派，事件超时关闭",
        chips = { "唱跳才艺慢工出细活", "死磕游戏用技术说话", "玩偶服抽象整活" },
        script = {
            { t = 0.0, kind = "entry", name = "系统机器人", text = "系统机器人 进入直播间" },
            { t = 0.6, kind = "comment", name = "蹲首播的", text = "主播第一天开播，走什么路线？" },
            { t = 1.6, kind = "comment", name = "老观众", text = "唱跳才艺慢工出细活吧" },
            { t = 2.6, kind = "comment", name = "电竞少年", text = "死磕游戏技术才有前途" },
            { t = 3.6, kind = "comment", name = "乐子人", text = "抽象整活先火再说！" },
            { t = 5.0, kind = "comment", name = "分析师", text = "慢熬真本事 vs 2.5倍速起号，怎么选？" },
        },
    },
    ["C1-M05"] = {
        -- A=钱包+10/口碑-3 B=口碑+4/状态+5（timing_bar 本小样不接线，ops 乘区=1.0）
        intents = {
            { id = "accept", opt_key = "A", patterns = { "汪汪", "狗叫", "学叫", "十块", "逗乐" },
              reactions = { "汪汪汪", "哈哈哈真叫了", "十块钱难不倒主播", "乐子人过年了" } },
            { id = "decline", opt_key = "B", patterns = { "感谢", "婉拒", "底线", "不学", "才艺可以点" },
              reactions = { "有底线，粉了", "不卑不亢", "感谢礼物才艺可以点" } },
        },
        missReactions = { "主播没接梗，礼物特效自己散了", "弹幕还在等主播表态" },
        fallback = "中性零效果：礼物照常入账流程不走卡结算，事件超时关闭",
        chips = { "汪汪两声逗乐全场", "感谢礼物才艺可以点", "今天天气不错啊" },
        script = {
            { t = 0.0, kind = "gift", name = "路过的风", gift = "小星星", count = 10, text = "送出 小星星 ×10" },
            { t = 0.8, kind = "comment", name = "路过的风", text = "学狗叫两声助兴！" },
            { t = 1.6, kind = "comment", name = "看热闹", text = "十块钱也是大哥啊" },
            { t = 2.6, kind = "comment", name = "守底线", text = "守住底线婉拒吧" },
            { t = 4.0, kind = "comment", name = "围观", text = "为十块钱放下自尊 vs 守住底线" },
        },
    },
    ["C1-M07"] = {
        -- A=热+15%（卡面另有口才+1，现 Lua 引擎不结算 delta_attrs，如实报） B=Count_黑粉不对线+1/H01
        intents = {
            { id = "fight", opt_key = "A", patterns = { "怼", "对线", "你行你上", "键盘侠", "挂出来", "截图" },
              reactions = { "怼得好！", "你行你上啊", "热度涨了", "挂出来置顶了" } },
            { id = "endure", opt_key = "B", patterns = { "忍", "不理", "拉黑", "无视", "骂得准", "挑刺", "虚心", "请教" },
              reactions = { "这心态稳", "骂得准欢迎挑刺", "黑粉不对线，格局打开" } },
        },
        missReactions = { "恶评被弹幕刷过去了，主播没回应", "黑粉还在刷，主播沉默" },
        fallback = "中性零效果：不记 Count_黑粉不对线，事件超时关闭",
        chips = { "你行你上啊键盘侠", "骂得准欢迎挑刺", "弹幕护体" },
        script = {
            { t = 0.0, kind = "hater", name = "专治各种不服", text = "这打光也太业余了" },
            { t = 0.9, kind = "hater", name = "专治各种不服", text = "台词背得生硬，尬" },
            { t = 1.8, kind = "hater", name = "专治各种不服", text = "就这水平也开播？" },
            { t = 2.7, kind = "hater", name = "专治各种不服", text = "从小学的才艺？" },
            { t = 3.6, kind = "hater", name = "专治各种不服", text = "建议退网" },
            { t = 5.0, kind = "comment", name = "围观群众", text = "五条毒舌锐评刷屏，怼回去还是虚心请教？" },
        },
    },
    ["C1-M10"] = {
        -- A=Flag_零粉快乐=1/H07 B=粉+20%/状态-10
        intents = {
            { id = "slack", opt_key = "A", patterns = { "摆烂", "躺平", "树洞", "自娱自乐", "关掉", "电子日记", "自嗨" },
              reactions = { "树洞模式开启", "零粉快乐也是快乐", "自娱自乐挺好" } },
            { id = "grind", opt_key = "B", patterns = { "坚持", "卷", "抄作业", "冰美式", "榜单", "咬牙" },
              reactions = { "冰美式干杯", "抄作业卷起来", "咬牙继续播" } },
        },
        missReactions = { "念头一闪而过，直播间照常运转", "弹幕没等到主播的决定" },
        fallback = "中性零效果：不记 Flag_零粉快乐，事件超时关闭",
        chips = { "关推荐当树洞自娱自乐", "冰美式抄作业继续卷", "主播今天好看" },
        script = {
            { t = 0.0, kind = "comment", name = "数据党", text = "播满一周了粉丝还是两位数…" },
            { t = 1.5, kind = "comment", name = "丧丧", text = "要不算了吧" },
            { t = 2.5, kind = "comment", name = "树洞派", text = "关掉推荐当电子日记也挺爽" },
            { t = 3.5, kind = "comment", name = "卷王", text = "咬牙抄作业继续卷！" },
            { t = 5.0, kind = "comment", name = "围观", text = "放弃流量纯自嗨 vs 继续卷" },
        },
    },
    ["C1-S01"] = {
        -- A=口碑+2 且 Count_猫上镜+=1 B=Count_猫上镜+1（均继承冻结卡面）
        intents = {
            { id = "moveaway", opt_key = "A", patterns = { "抱开", "抱走", "继续讲", "稿子" },
              reactions = { "猫：？？？", "继续讲稿子", "主播敬业" } },
            { id = "givemic", opt_key = "B", patterns = { "递麦", "给猫", "罐头", "猫播", "让它播" },
              reactions = { "猫猫主播上线", "打赏买罐头", "猫上镜了" } },
        },
        missReactions = { "猫自己跳下桌走了，弹幕一片哀嚎", "主播没接话，猫走了" },
        fallback = "中性零效果：不记 Count_猫上镜，事件超时关闭",
        chips = { "抱开猫继续讲稿子", "递麦给猫买罐头", "猫猫可爱" },
        script = {
            { t = 0.0, kind = "comment", name = "眼尖", text = "猫！橘猫上桌了！" },
            { t = 0.5, kind = "comment", name = "哈哈", text = "坐住键盘了哈哈哈" },
            { t = 1.0, kind = "comment", name = "镜头党", text = "镜头怼到猫鼻孔了" },
            { t = 1.5, kind = "onlineBoost", value = 200 },
            { t = 2.0, kind = "comment", name = "数据党", text = "在线从2飙到200了！" },
            { t = 3.0, kind = "comment", name = "敬业派", text = "抱开猫继续讲稿子？" },
            { t = 4.0, kind = "comment", name = "猫奴", text = "递麦给猫：打赏归你买罐头" },
        },
    },
}

-- ============================================================================
-- 4. 氛围弹幕生成器：六段位语料，权重=fanComposition，刷速随热度
-- ============================================================================
local NAME_POOL = {
    "星野酱", "摸鱼大师", "夜风", "小透明", "榜一大哥", "吃瓜群众", "路过的风", "阿宅",
    "早八人", "宿舍党", "声控晚期", "颜狗本狗", "技术宅", "乐子神", "学生党", "打工人",
    "月光族", "奶茶三分糖", "熬夜冠军", "潜水员", "老粉", "新粉", "弹幕机器人", "围观路人",
    "键盘侠", "专治各种不服", "理中客", "数据党", "猫奴", "电竞少年", "守底线", "卷王",
}
local CORPUS = {
    ["颜粉"] = { "主播今天也太好看了吧", "这颜值是真实存在的吗", "截图了截图了", "美颜开几级？根本不用开", "这张脸我直接关注", "怼脸拍都扛得住" },
    ["声控粉"] = { "这声音我循环十遍", "耳朵怀孕了", "声线绝了", "开口跪", "声控狂喜", "这嗓音不去配音可惜了" },
    ["技术粉"] = { "这波操作什么水平", "细节拉满", "学废了学废了", "这技术不去打职业？", "意识可以的", "手元看一下" },
    ["乐子人"] = { "哈哈哈哈哈哈", "主播整一个", "节目效果有了", "典", "急了急了", "活呢？整活！", "弹幕护体" },
    ["大哥"] = { "。", "还行", "再播会儿", "赏", "这个我看了", "继续" },
    ["学生粉"] = { "宿舍偷看", "下课冲过来", "学生党实名羡慕", "月考完就来看你", "晚自习摸鱼", "生活费都刷给你了" },
}
local HATER_LINES = { "就这？", "播得什么玩意", "取关了", "尬死了", "建议退网", "这也配开播？" }
local GIFT_LADDER = { { name = "小星星", w = 60 }, { name = "跑车", w = 20 }, { name = "火箭", w = 12 }, { name = "星堡", w = 6 }, { name = "星际巡航", w = 2 } }
local SEG_ORDER = { "颜粉", "声控粉", "技术粉", "乐子人", "大哥", "学生粉" }

danmaku = {}
local LANES = 13
local LANE_TOP, LANE_H = 318, 36
local laneSpeed = {}
for i = 1, LANES do laneSpeed[i] = 100 + i * 4 end
local spawnAcc = 0
local pendingBurst = {}
local giftBanner = nil
local onlineBoost = 0
local onlineCount = 2

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
    local total = 0
    for _, g in ipairs(GIFT_LADDER) do total = total + g.w end
    local r = math.random() * total
    for _, g in ipairs(GIFT_LADDER) do
        r = r - g.w
        if r <= 0 then return g.name end
    end
    return "小星星"
end

local function freeLane()
    local blocked = {}
    for _, d in ipairs(danmaku) do
        if d.x + d.w > DESIGN_W - 16 then blocked[d.lane] = true end
    end
    local free = {}
    for i = 1, LANES do
        if not blocked[i] then table.insert(free, i) end
    end
    if #free == 0 then return nil end
    return free[math.random(#free)]
end

local function spawnDanmaku(kind, name, text, opts)
    if #danmaku >= 90 then return end
    local lane = freeLane()
    if not lane then return end
    opts = opts or {}
    local size = (kind == "entry" or kind == "follow" or kind == "like") and 18 or 20
    local badge = opts.badge
    local display = text
    if kind == "comment" or kind == "hater" or kind == "gift" then
        display = (badge and (badge .. " ") or "") .. name .. "：" .. text
    elseif kind == "player" then
        display = "主播：" .. text
    end
    local w = textWidth(display, size)
    local heat = GS.fiveDim.heat or 100
    local d = {
        kind = kind, name = name, text = text, display = display,
        x = DESIGN_W + 8, lane = lane, w = w, size = size,
        speed = laneSpeed[lane] + heat * 0.03,
        badge = badge,
    }
    table.insert(danmaku, d)
    if kind == "gift" then
        local gift = opts.gift or "小星星"
        local count = opts.count or 1
        if giftBanner and giftBanner.name == name and giftBanner.gift == gift and giftBanner.t > 1 then
            giftBanner.count = giftBanner.count + count
            giftBanner.t = 4
        else
            giftBanner = { name = name, gift = gift, count = count, t = 4 }
        end
    end
    return d
end

local function burst(lines, kind, name)
    for i, line in ipairs(lines) do
        table.insert(pendingBurst, { t = (i - 1) * 0.3, kind = kind or "comment", name = name or NAME_POOL[math.random(#NAME_POOL)], text = line })
    end
end

local function atmosphereSpawn()
    local seg = pickSegment()
    local name = NAME_POOL[math.random(#NAME_POOL)]
    local badge = math.random() < 0.3 and ("星牌·" .. math.random(1, 12)) or nil
    local r = math.random()
    if seg == "大哥" and r < 0.55 then
        spawnDanmaku("gift", name, "送出 " .. pickGift(), { gift = pickGift(), count = math.random(1, 3), badge = badge })
        return
    end
    if r < 0.08 then
        spawnDanmaku("entry", name, name .. " 进入直播间")
    elseif r < 0.16 then
        spawnDanmaku("follow", name, name .. " 关注了主播", { badge = badge })
    elseif r < 0.28 then
        spawnDanmaku("like", name, name .. " 点了赞")
    elseif r < 0.36 then
        spawnDanmaku("gift", name, "送出 " .. pickGift(), { gift = pickGift(), count = math.random(1, 2), badge = badge })
    else
        local haterActive = GS.currentCard and GS.currentCard.card_id == "C1-M07" and runner.state == "active"
        if (haterActive or (GS.haterPct or 0) > 0) and math.random() < 0.18 then
            spawnDanmaku("hater", name, HATER_LINES[math.random(#HATER_LINES)])
        else
            local lines = CORPUS[seg]
            spawnDanmaku("comment", name, lines[math.random(#lines)], { badge = badge })
        end
    end
end

-- ============================================================================
-- 5. 事件 runner：注入脚本 / 超时没接住 / 不卡直播流
-- ============================================================================
runner = { state = "gap", gapT = 2.0, timeLeft = 0, scriptT = 0, script = {}, eventIndex = 0 }

local settlementLog = { spike = "zhubo stage2 presentation spike", started_at = os.date("%Y-%m-%dT%H:%M:%S"), entries = {} }
local logDirty = false
local LOG_PATH = "E:/taptap/zhubo/spike/live_settlement_log.json"
local FPS_PATH = "E:/taptap/zhubo/spike/live_fps_summary.json"

local function logEntry(entry)
    entry.t = os.clock()
    entry.frame = frameCount
    table.insert(settlementLog.entries, entry)
    logDirty = true
    print("[SPIKE] " .. cjson.encode(entry))
end

local function dumpLog()
    if not logDirty then return end
    logDirty = false
    local ok, encoded = pcall(cjson.encode, settlementLog)
    if not ok then return end
    local f = File(LOG_PATH, FILE_WRITE)
    if f:IsOpen() then
        f:WriteString(encoded)
        f:Flush()
        f:Close()
    end
end

function rebuildQueue()
    local byId = {}
    local cards = engine.cardsData
    local list = cards.cards or cards
    for _, c in ipairs(list) do byId[c.card_id] = c end
    GS.chapterQueue = {}
    for _, id in ipairs(EVENT_IDS) do
        assert(byId[id], "spike: card missing " .. id)
        table.insert(GS.chapterQueue, byId[id])
    end
    GS.currentChapter = 1
    GS.currentCardIndex = 1
    GS.currentCard = GS.chapterQueue[1]
    GS.timingInstance.active = false
end

function startEvent(idx)
    runner.eventIndex = idx
    runner.state = "active"
    runner.timeLeft = EVENT_DURATION
    runner.scriptT = 0
    local card = GS.chapterQueue[idx]
    GS.currentCard = card
    GS.currentCardIndex = idx
    GS.timingInstance.active = false
    local def = EVENT_DEFS[card.card_id]
    runner.script = def.script or {}
    logEntry({ kind = "EVENT_START", card = card.card_id, title = card.title })
end

local function advanceNeutral()
    GS.currentCardIndex = GS.currentCardIndex + 1
    if GS.currentCardIndex <= #GS.chapterQueue then
        GS.currentCard = GS.chapterQueue[GS.currentCardIndex]
    else
        GS.currentCard = nil
        GS.screen = "Screen-04"
    end
    GS.timingInstance.active = false
end

local function afterEventClosed()
    GS.timingInstance.active = false
    if GS.screen == "Screen-04" or GS.screen == "Screen-06" or GS.currentCardIndex > #GS.chapterQueue then
        runner.state = "done"
    else
        runner.state = "gap"
        runner.gapT = 4.0
    end
end

function runnerTick(dt)
    if runner.state == "gap" then
        runner.gapT = runner.gapT - dt
        if runner.gapT <= 0 then
            if GS.currentCard and GS.currentCardIndex <= #GS.chapterQueue then
                startEvent(GS.currentCardIndex)
            else
                runner.state = "done"
            end
        end
    elseif runner.state == "active" then
        runner.scriptT = runner.scriptT + dt
        while #runner.script > 0 and runner.script[1].t <= runner.scriptT do
            local s = table.remove(runner.script, 1)
            if s.kind == "onlineBoost" then
                onlineBoost = s.value
            elseif s.kind == "gift" then
                spawnDanmaku("gift", s.name, s.text, { gift = s.gift, count = s.count })
            else
                spawnDanmaku(s.kind, s.name, s.text)
            end
        end
        runner.timeLeft = runner.timeLeft - dt
        if runner.timeLeft <= 0 then
            local cardId = GS.currentCard and GS.currentCard.card_id or "?"
            logEntry({ kind = "TIMEOUT", card = cardId, result = "没接住", note = "中性零效果，直播流继续" })
            burst({ "主播没接住，话题过去了", "没事没事，继续播" })
            advanceNeutral()
            afterEventClosed()
        end
    end
end

-- ============================================================================
-- 6. 输入管道 + 统一发送/意图匹配（按钮/chips/测试同一入口）
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
    spawnDanmaku("player", "小星", text)
    if runner.state == "active" and GS.currentCard then
        local cardId = GS.currentCard.card_id
        local def = EVENT_DEFS[cardId]
        entry.card = cardId
        local matched = nil
        for _, intent in ipairs(def.intents) do
            for _, pat in ipairs(intent.patterns) do
                if string.find(text, pat, 1, true) then matched = intent break end
            end
            if matched then break end
        end
        if matched then
            entry.intent = matched.id
            entry.opt_key = matched.opt_key
            entry.result = "hit"
            local before = snapshotState()
            engine.selectCardOption(matched.opt_key)
            entry.diff = diffState(before)
            local opt = nil
            for _, o in ipairs(GS.chapterQueue[runner.eventIndex].options or {}) do
                if o.opt_key == matched.opt_key then opt = o end
            end
            entry.inherited_effects = opt and opt.effects or nil
            burst(matched.reactions)
            logEntry(entry)
            afterEventClosed()
        else
            entry.intent = "miss"
            entry.result = "miss"
            entry.note = def.fallback
            burst(def.missReactions)
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
-- 7. 帧率实测（阶段0口径：os.clock 墙钟，50帧预热，2100样本，avg/p95/max/min）
-- ============================================================================
local fps = { lastT = nil, samples = {}, concSum = 0, concMin = math.huge, dumped = false }

local function fpsTick()
    local now = os.clock()
    if fps.lastT then
        local dtMs = (now - fps.lastT) * 1000
        if frameCount > 50 then
            table.insert(fps.samples, dtMs)
            fps.concSum = fps.concSum + #danmaku
            if #danmaku < fps.concMin then fps.concMin = #danmaku end
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
            test = "stage2 spike livestream full-load danmaku FPS",
            method = "os.clock wall-clock per Update frame; 50-frame warmup; real jitter, not engine step",
            total_frames = frameCount,
            valid_wall_samples = #sorted,
            avg_dt_ms = math.floor(avg * 100) / 100,
            p95_dt_ms = math.floor(p95 * 100) / 100,
            min_dt_ms = math.floor(minV * 100) / 100,
            max_dt_ms = math.floor(maxV * 100) / 100,
            est_fps = math.floor(1000 / avg * 10) / 10,
            danmaku_concurrent_avg = math.floor(fps.concSum / #sorted * 10) / 10,
            danmaku_concurrent_min = fps.concMin,
            exported_at = os.date("%Y-%m-%dT%H:%M:%S"),
        }
        local ok, encoded = pcall(cjson.encode, payload)
        if ok then
            local f = File(FPS_PATH, FILE_WRITE)
            if f:IsOpen() then
                f:WriteString(encoded)
                f:Flush()
                f:Close()
                print("[SPIKE_FPS] " .. encoded)
            end
        end
    end
end

-- ============================================================================
-- 8. 渲染（模式A：540×960 设计分辨率 CONTAIN；弹幕区 scissor 裁剪）
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

local function fmtOnline(n)
    if n >= 10000 then return string.format("%.1f万", n / 10000) end
    return tostring(math.floor(n))
end

local DANMAKU_COLOR = {
    comment = { 240, 240, 245 }, entry = { 148, 163, 184 }, follow = { 52, 211, 153 },
    like = { 244, 114, 182 }, gift = { 251, 191, 36 }, hater = { 248, 113, 113 }, player = { 255, 255, 255 },
}

local function renderLive()
    -- 背景
    drawRect(0, 0, DESIGN_W, DESIGN_H, 12, 14, 22)
    -- HUD
    drawRect(0, 0, DESIGN_W, 64, 22, 26, 42)
    drawText(16, 10, "小星的直播间", 20, 255, 255, 255)
    drawText(16, 36, "在线 " .. fmtOnline(onlineCount), 15, 148, 163, 184)
    local fd = GS.fiveDim
    drawText(120, 36, "热度 " .. math.floor(fd.heat), 15, 251, 146, 60)
    drawText(220, 36, "粉丝 " .. math.floor(fd.fans), 15, 96, 165, 250)
    drawText(320, 36, "钱包 ￥" .. math.floor(fd.wallet), 15, 251, 191, 36)
    drawText(430, 36, "口碑 " .. math.floor(fd.rep), 15, 52, 211, 153)
    -- 主播位（占位，不做美术）
    drawRound(16, 72, 508, 168, 12, 30, 35, 58)
    drawText(32, 84, "LIVE", 14, 239, 68, 68)
    drawText(32, 110, "主播立绘位 · 小样占位", 18, 100, 116, 139)
    drawText(32, 140, "弹幕即战场：打字回复观众，你的话决定直播走向", 14, 100, 116, 139)
    drawText(32, 166, "状态 " .. math.floor(fd.stamina) .. " · 黑粉占比 " .. math.floor(GS.haterPct or 0) .. "%", 14, 148, 163, 184)
    -- 礼物横幅
    if giftBanner and giftBanner.t > 0 then
        drawRound(16, 76, 360, 34, 17, 120, 80, 10, 230)
        drawText(28, 83, "「" .. giftBanner.name .. "」送出 " .. giftBanner.gift .. " ×" .. giftBanner.count, 16, 251, 191, 36)
    end
    -- 事件横幅 + 倒计时
    if runner.state == "active" and GS.currentCard then
        local card = GS.currentCard
        drawRound(16, 248, 508, 62, 10, 35, 42, 66)
        drawText(28, 254, "事件 " .. runner.eventIndex .. "/5 · " .. card.title, 17, 255, 255, 255)
        local ctx = card.context_text or ""
        if utf8Len(ctx) > 30 then ctx = utf8Cut(ctx, 30) .. "…" end
        drawText(28, 278, ctx, 12, 148, 163, 184)
        local frac = math.max(0, runner.timeLeft / EVENT_DURATION)
        drawRect(28, 300, 480 * frac, 4, frac > 0.25 and 96 or 239, frac > 0.25 and 165 or 68, frac > 0.25 and 250 or 68)
        if card.ops_type == "timing_bar" then
            drawText(380, 254, "时机条·小样未接线", 12, 100, 116, 139)
        end
    elseif runner.state == "gap" then
        drawText(16, 258, "直播进行中… 下一个话题马上来", 15, 100, 116, 139)
    end
    -- 弹幕区
    nvgSave(nvgContext)
    nvgScissor(nvgContext, 0, LANE_TOP, DESIGN_W, LANES * LANE_H)
    for _, d in ipairs(danmaku) do
        local y = LANE_TOP + (d.lane - 1) * LANE_H + 6
        local c = DANMAKU_COLOR[d.kind] or DANMAKU_COLOR.comment
        if d.kind == "player" then
            drawRound(d.x - 8, y - 3, d.w + 16, d.size + 12, 8, 190, 120, 30, 230)
        end
        drawText(d.x, y, d.display, d.size, c[1], c[2], c[3])
    end
    nvgRestore(nvgContext)
    -- chips（同一 sendReply 管道）
    if runner.state == "active" and GS.currentCard then
        local def = EVENT_DEFS[GS.currentCard.card_id]
        local cx = 16
        for i, chip in ipairs(def.chips or {}) do
            local cw = textWidth(chip, 15) + 24
            drawRound(cx, 792, cw, 42, 21, 45, 52, 80)
            drawText(cx + 12, 803, chip, 15, 203, 213, 225)
            cx = cx + cw + 10
        end
    end
    -- 输入行
    drawRound(16, 846, 340, 54, 10, 30, 35, 58)
    nvgBeginPath(nvgContext)
    nvgRoundedRect(nvgContext, 16, 846, 340, 54, 10)
    nvgStrokeColor(nvgContext, inputFocused and nvgRGBA(236, 72, 153, 255) or nvgRGBA(100, 116, 139, 255))
    nvgStrokeWidth(nvgContext, 2)
    nvgStroke(nvgContext)
    local show = inputText
    if utf8Len(show) > 15 then show = "…" .. utf8Tail(show, 15) end
    drawText(28, 856, #show > 0 and show or (inputFocused and "打字回复…" or "点输入框，中文打字"), 17, #show > 0 and 255 or 100, #show > 0 and 255 or 116, #show > 0 and 255 or 139)
    if #composition > 0 then
        drawText(28, 880, "[" .. composition .. "]", 13, 148, 163, 184)
    end
    drawRound(364, 846, 76, 54, 10, 16, 185, 129)
    drawText(382, 861, "发送", 18, 255, 255, 255)
    drawRound(448, 846, 76, 54, 10, 100, 116, 139)
    drawText(466, 861, "清空", 18, 255, 255, 255)
    drawText(16, 916, "弹幕同屏 " .. #danmaku .. " · 帧 " .. frameCount .. (fps.dumped and " · FPS已导出" or ""), 13, 100, 116, 139)
    drawText(16, 936, "小样：键盘仅文本通道可用，发送/清空用按钮；超时30s没接住自动继续", 12, 100, 116, 139)
end

local function renderSummary()
    drawRect(0, 0, DESIGN_W, DESIGN_H, 12, 14, 22)
    drawText(16, 40, "下播总结 · 小样第一章", 26, 255, 255, 255)
    local fd = GS.fiveDim
    drawText(16, 100, string.format("粉丝 %d · 热度 %d · 钱包 ￥%d · 口碑 %d · 状态 %d",
        math.floor(fd.fans), math.floor(fd.heat), math.floor(fd.wallet), math.floor(fd.rep), math.floor(fd.stamina)), 17, 203, 213, 225)
    local y = 150
    for _, e in ipairs(settlementLog.entries) do
        if e.kind == "REPLY" and e.result == "hit" then
            drawText(16, y, string.format("%s → 意图[%s] 选项%s 命中", e.card or "?", e.intent or "?", e.opt_key or "?"), 15, 96, 165, 250)
            y = y + 26
        elseif e.kind == "TIMEOUT" then
            drawText(16, y, e.card .. " 超时没接住（中性零效果）", 15, 148, 163, 184)
            y = y + 26
        end
    end
    drawRound(16, 846, 200, 54, 10, 16, 185, 129)
    drawText(52, 861, "重新开播", 18, 255, 255, 255)
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
    drawRect(0, 0, screenDesignW, screenDesignH, 12, 14, 22)
    nvgTranslate(nvgContext, viewOffX, viewOffY)
    if runner.state == "done" or GS.screen == "Screen-04" then
        renderSummary()
    elseif GS.screen == "Screen-06" then
        drawRect(0, 0, DESIGN_W, DESIGN_H, 12, 14, 22)
        drawText(16, 40, "暴毙结局 " .. tostring(GS.triggeredEnding), 26, 239, 68, 68)
    else
        renderLive()
    end
    nvgEndFrame(nvgContext)
end

-- ============================================================================
-- 9. 主循环与事件订阅
-- ============================================================================
local function danmakuTick(dt)
    -- 弹幕推进
    local heat = GS.fiveDim.heat or 100
    for i = #danmaku, 1, -1 do
        local d = danmaku[i]
        d.x = d.x - d.speed * dt
        if d.x + d.w < -12 then table.remove(danmaku, i) end
    end
    -- 氛围生成：刷速随热度，保底同屏≥36（满负载）
    spawnAcc = spawnAcc + (2.5 + heat / 100 * 2.5) * dt
    while spawnAcc >= 1 do
        spawnAcc = spawnAcc - 1
        atmosphereSpawn()
    end
    if #danmaku < 36 then
        for _ = 1, 3 do
            atmosphereSpawn()
            if #danmaku >= 36 then break end
        end
    end
    -- 爆发队列
    for i = #pendingBurst, 1, -1 do
        local b = pendingBurst[i]
        b.t = b.t - dt
        if b.t <= 0 then
            spawnDanmaku(b.kind, b.name, b.text)
            table.remove(pendingBurst, i)
        end
    end
    if giftBanner then
        giftBanner.t = giftBanner.t - dt
        if giftBanner.t <= 0 then giftBanner = nil end
    end
    if onlineBoost > 0 then onlineBoost = math.max(0, onlineBoost - 30 * dt) end
    local fd = GS.fiveDim
    onlineCount = math.max(2, math.floor(2 + fd.fans * 0.08 + fd.heat * 0.03 + onlineBoost + math.sin(timeSec * 0.7) * 2))
end

function HandleUpdate(eventType, eventData)
    local dt = eventData:GetFloat("TimeStep")
    frameCount = frameCount + 1
    timeSec = timeSec + dt
    fpsTick()
    runnerTick(dt)
    danmakuTick(dt)
    if frameCount % 60 == 0 then dumpLog() end
end

local function toDesign(x, y)
    return x / viewDpr / viewScale - viewOffX, y / viewDpr / viewScale - viewOffY
end

local function handleClick(x, y)
    local dx, dy = toDesign(x, y)
    if runner.state == "done" or GS.screen == "Screen-04" then
        if dx >= 16 and dx <= 216 and dy >= 846 and dy <= 900 then
            engine.resetGameState()
            rebuildQueue()
            runner.state = "gap"
            runner.gapT = 2.0
            runner.eventIndex = 0
            danmaku = {}
            pendingBurst = {}
            giftBanner = nil
            for _ = 1, 360 do danmakuTick(1 / 60) end
            logEntry({ kind = "RUN_RESTART" })
        end
        return
    end
    -- chips
    if runner.state == "active" and GS.currentCard and dy >= 792 and dy <= 834 then
        local def = EVENT_DEFS[GS.currentCard.card_id]
        local cx = 16
        for _, chip in ipairs(def.chips or {}) do
            local cw = textWidth(chip, 15) + 24
            if dx >= cx and dx <= cx + cw then
                sendReply(chip, "chip")
                return
            end
            cx = cx + cw + 10
        end
    end
    -- 输入行
    if dy >= 846 and dy <= 900 then
        if dx >= 16 and dx <= 356 then
            if not inputFocused then setInputFocus(true) end
            return
        elseif dx >= 364 and dx <= 440 then
            sendReply(inputText, "button")
            return
        elseif dx >= 448 and dx <= 524 then
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
    if inputFocused and text and #text > 0 then
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
    print("[SPIKE] Start · 阶段2呈现重做小样")
    nvgContext = nvgCreate(1)
    if nvgContext then
        fontId = nvgCreateFont(nvgContext, "msyh", "C:/Windows/Fonts/msyh.ttc")
        if fontId == -1 then fontId = nvgCreateFont(nvgContext, "simhei", "C:/Windows/Fonts/simhei.ttf") end
        SubscribeToEvent(nvgContext, "NanoVGRender", "HandleRender")
    end
    local inp = (GetInput and GetInput()) or input
    if inp then
        if inp.SetMouseVisible then inp:SetMouseVisible(true) else inp.mouseVisible = true end
        if MM_FREE then
            if inp.SetMouseMode then inp:SetMouseMode(MM_FREE) else inp.mouseMode = MM_FREE end
        end
    end
    rebuildQueue()
    -- 预滚 6 秒弹幕：开局即满负载，帧率测量窗（50帧预热后）全程同屏≥30
    for _ = 1, 360 do danmakuTick(1 / 60) end
    SubscribeToEvent("Update", "HandleUpdate")
    SubscribeToEvent("MouseButtonDown", "HandleMouseButtonDown")
    SubscribeToEvent("TouchEnd", "HandleTouchEnd")
    SubscribeToEvent("TextInput", "HandleTextInput")
    SubscribeToEvent("TextEditing", "HandleTextEditing")
    SubscribeToEvent("InputFocus", "HandleInputFocus")
    logEntry({ kind = "SPIKE_READY", note = "5事件/意图继承原卡/超时没接住/按钮发送" })
    print("[SPIKE] READY")
end