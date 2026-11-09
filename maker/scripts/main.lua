-- 《从小主播到顶流》· Maker 运行时全量可玩版
-- 架构: 九屏流转 + 两轻操作 (NanoVG 60 FPS 平滑扫条 + 翻样辨真) + 状态持久化
-- 包含: Screen-01 ~ Screen-09 完整闭环，纯本地数据驱动，离线可玩

local cjson = require("cjson")

local nvgContext = nil
local fontId = -1
local windowWidth = 540
local windowHeight = 960

-- ============================================================================
-- 1. 数据驱动配置与卡池加载
-- ============================================================================
local cardsData = {}
local configData = {}
local endingsData = {}
local stateDict = {}

local function loadJson(relName)
    local candidates = {
        "maker-demo-clone/assets/data/" .. relName,
        "assets/data/" .. relName,
        "data/" .. relName,
        "zhubo/data/" .. relName,
        "E:/taptap/maker-demo-clone/assets/data/" .. relName,
        relName
    }
    for _, p in ipairs(candidates) do
        local f = File(p, FILE_READ)
        if f:IsOpen() then
            local raw = f:ReadString()
            f:Close()
            if raw and #raw > 0 then
                local ok, parsed = pcall(cjson.decode, raw)
                if ok then
                    print("[DATA] Loaded " .. relName .. " from " .. p .. " (" .. tostring(#raw) .. "B)")
                    return parsed
                end
            end
        end
    end
    -- Try ResourceCache
    if GetCache() then
        local resFile = GetCache():GetFile("data/" .. relName)
        if resFile and resFile:IsOpen() then
            local raw = resFile:ReadString()
            resFile:Close()
            if raw and #raw > 0 then
                local ok, parsed = pcall(cjson.decode, raw)
                if ok then
                    print("[DATA] Loaded " .. relName .. " from ResourceCache: data/" .. relName)
                    return parsed
                end
            end
        end
    end
    print("[ERROR] Failed to load JSON: " .. tostring(relName))
    return {}
end

-- ============================================================================
-- 2. 本地持久化存档 (zhubo_play_save.json)
-- ============================================================================
local localSave = {
    unlocked_endings = {},
    unlocked_talents = {},
    total_runs = 0,
    cleared_runs = 0
}

local function loadSave()
    local f = File("zhubo_play_save.json", FILE_READ)
    if f:IsOpen() then
        local raw = f:ReadString()
        f:Close()
        local ok, parsed = pcall(cjson.decode, raw)
        if ok and parsed then
            localSave = parsed
            print("[SAVE] Loaded save, unlocked endings count: " .. tostring(#(localSave.unlocked_endings or {})))
        end
    end
end

local function saveGame()
    local f = File("zhubo_play_save.json", FILE_WRITE)
    if f:IsOpen() then
        f:WriteString(cjson.encode(localSave))
        f:Flush()
        f:Close()
    end
end

local function unlockEnding(endingId)
    local found = false
    for _, e in ipairs(localSave.unlocked_endings) do
        if e == endingId then found = true break end
    end
    if not found then
        table.insert(localSave.unlocked_endings, endingId)
        table.insert(localSave.unlocked_talents, endingId)
        saveGame()
    end
end

-- ============================================================================
-- 3. 游戏全局状态机 (Game State & Core Loop)
-- ============================================================================
local gameState = {
    screen = "Screen-01", -- Screen-01 ~ Screen-09, Ops-A, Ops-B
    gender = "女",        -- 男 / 女
    playerName = "小星",

    -- 9 基础属性 (初始 45 点自由加点，单项 1..10，广告额外 +3 上限 8)
    attributes = {
        ["颜值"] = 5,
        ["嗓音"] = 5,
        ["才艺"] = 5,
        ["游戏技术"] = 5,
        ["口才"] = 5,
        ["情商"] = 5,
        ["体力"] = 5,
        ["心态"] = 5,
        ["运气"] = 5
    },
    adBonusUsed = 0, -- 最大 4 次
    remainingBasePoints = 0,

    -- 5 维经营数据
    fiveDim = {
        fans = 0,
        heat = 100,
        wallet = 2000,
        rep = 60,
        stamina = 80
    },
    haterPct = 0,

    -- 6 段粉丝构成 (Y1.①: 默认中性大哥 15% 对应 R_粉丝构成 = 1.0)
    fanComposition = {
        ["颜粉"] = 20,
        ["声控粉"] = 15,
        ["技术粉"] = 20,
        ["乐子人"] = 15,
        ["大哥"] = 15,
        ["学生粉"] = 15
    },
    fanTilt = {},

    -- 37 全局状态字典
    variables = {},

    -- 当前章节与卡牌
    currentChapter = 1,
    currentCardIndex = 1,
    chapterQueue = {}, -- 5 张卡
    currentCard = nil,

    -- 排班选择
    schedule = {
        mode = "才艺",
        timeSlot = "slot_prime",
        duration = 4
    },

    -- 广告位计数 (单局)
    adUsage = {
        creationPoints = 0,
        reviveOrRepick = 0,
        fanAngleUnlock = 0,
        settlementDouble = 0
    },

    -- 快照回滚 (专供暴毙复活)
    snapshot = nil,

    -- 当前触发结局
    triggeredEnding = nil,
    isDead = false,
    isCleared = false,

    -- 时机条状态
    timingInstance = {
        active = false,
        cursorPos = 0.0,
        cursorDir = 1,
        cursorSpeed = 0.65,
        sweetStart = 0.525,
        sweetEnd = 0.675,
        goodStart = 0.40,
        goodEnd = 0.80,
        multiplier = 1.0,
        resultZone = "NORMAL",
        isResolved = false
    },

    -- 翻样辨真状态
    inspectInstance = {
        active = false,
        flipsRemaining = 2,
        revealed = { false, false, false, false },
        fakeIndex = 1,
        success = false
    },

    -- 阶段结算数据缓存
    settleResult = nil,

    -- 图鉴筛选
    galleryTab = "all" -- all, main, death, hidden
}

-- 初始化重置
local function resetGameState()
    gameState.currentChapter = 1
    gameState.currentCardIndex = 1
    gameState.chapterQueue = {}
    gameState.currentCard = nil
    gameState.isDead = false
    gameState.isCleared = false
    gameState.triggeredEnding = nil
    gameState.settleResult = nil
    gameState.fanTilt = {}
    gameState.adBonusUsed = 0

    local basePool = 45
    gameState.attributes = {
        ["颜值"] = 5,
        ["嗓音"] = 5,
        ["才艺"] = 5,
        ["游戏技术"] = 5,
        ["口才"] = 5,
        ["情商"] = 5,
        ["体力"] = 5,
        ["心态"] = 5,
        ["运气"] = 5
    }
    local curSum = 0
    for _, v in pairs(gameState.attributes) do curSum = curSum + v end
    gameState.remainingBasePoints = basePool - curSum

    gameState.fiveDim = {
        fans = 0,
        heat = 100,
        wallet = 2000,
        rep = 60,
        stamina = 80
    }
    gameState.haterPct = 0
    gameState.fanComposition = {
        ["颜粉"] = 20,
        ["声控粉"] = 15,
        ["技术粉"] = 20,
        ["乐子人"] = 15,
        ["大哥"] = 15,
        ["学生粉"] = 15
    }
    gameState.chapterFansGained = 0
    gameState.overtimeActive = false
    gameState.overtimePlayed = {}
    gameState.nextModeMultBonus = 0
    gameState.nextModeMultBonusMode = nil
    gameState.practiceBuff = nil
    gameState.adUsage = {
        creationPoints = 0,
        reviveOrRepick = 0,
        fanAngleUnlock = 0,
        settlementDouble = 0
    }

    gameState.variables = {}
    if stateDict and stateDict.variables then
        for _, v in ipairs(stateDict.variables) do
            gameState.variables[v.key] = v.initial_value or 0
        end
    end
    gameState.screen = "Screen-01"
end

-- ============================================================================
-- 4. 表达式检定与条件结算 (W1, W5, W6 兼容)
-- ============================================================================
local function evalExpr(expr)
    if not expr or expr == "" or expr == "null" then return true end

    local s = expr
    -- CP3 缺口③ H01 前置：卡面布尔运算符 &&/|| 译成 Lua and/or（Node 用 JS Function 原生认；Lua 不认会致 req 门编译失败、H01 锁死）。
    -- 仅译运算符；卡决策比较/has_encountered/整活流等其余 14 式求值对齐留阶段4。
    s = s:gsub("&&", " and "):gsub("||", " or ")
    -- 变量替换
    for k, v in pairs(gameState.variables) do
        if string.find(s, k, 1, true) then
            if type(v) == "string" then
                s = s:gsub(k, string.format("'%s'", v))
            else
                s = s:gsub(k, tostring(v))
            end
        end
    end
    -- 属性替换
    for k, v in pairs(gameState.attributes) do
        if string.find(s, k, 1, true) then
            s = s:gsub(k, tostring(v))
        end
    end
    -- 五维替换
    s = s:gsub("口碑", tostring(gameState.fiveDim.rep))
    s = s:gsub("状态", tostring(gameState.fiveDim.stamina))
    s = s:gsub("热度", tostring(gameState.fiveDim.heat))
    s = s:gsub("钱包", tostring(gameState.fiveDim.wallet))
    s = s:gsub("粉丝", tostring(gameState.fiveDim.fans))
    s = s:gsub("chapter", tostring(gameState.currentChapter))

    local loadFunc = loadstring or load
    local fn, err = loadFunc("return (" .. s .. ")")
    if fn then
        local ok, res = pcall(fn)
        if ok then return res and true or false end
    end
    return false
end

-- 应用属性与状态改写
local function applyStateWrite(writeExpr)
    if not writeExpr then return end
    -- CP3 缺口①（Node 为准绳 gameState.mjs:197-215）：op 认 "+="/"+"（单加号）/"=" 三种；
    -- "+"/"+=" 取 Number(rawVal)||1（非数或 0 默认 +1），"=" 数值转 number 否则留字符串。
    local k, op, val = writeExpr:match("`?([%a%d_\128-\255]+)`?%s*([=+]+)%s*([^\n\r]+)")
    if k then
        val = val:gsub("^%s+", ""):gsub("%s+$", ""):gsub("^['\"]", ""):gsub("['\"]$", "")
        if op == "+=" or op == "+" then
            local n = tonumber(val)
            local num = (n and n ~= 0) and n or 1
            gameState.variables[k] = (tonumber(gameState.variables[k]) or 0) + num
        elseif op == "=" then
            local num = tonumber(val)
            gameState.variables[k] = (num ~= nil) and num or val
        end
    end
end

-- 快照与回滚
local function takeSnapshot()
    local varsCopy = {}
    for k, v in pairs(gameState.variables) do varsCopy[k] = v end
    local attrsCopy = {}
    for k, v in pairs(gameState.attributes) do attrsCopy[k] = v end
    local fiveCopy = {}
    for k, v in pairs(gameState.fiveDim) do fiveCopy[k] = v end

    gameState.snapshot = {
        cardIndex = gameState.currentCardIndex,
        fiveDim = fiveCopy,
        attributes = attrsCopy,
        variables = varsCopy,
        haterPct = gameState.haterPct
    }
end

local function rollbackSnapshot()
    if not gameState.snapshot then return false end
    local s = gameState.snapshot
    for k, v in pairs(s.fiveDim) do gameState.fiveDim[k] = v end
    for k, v in pairs(s.attributes) do gameState.attributes[k] = v end
    for k, v in pairs(s.variables) do gameState.variables[k] = v end
    gameState.haterPct = s.haterPct
    gameState.isDead = false
    gameState.triggeredEnding = nil
    gameState.screen = "Screen-03"
    return true
end

-- ============================================================================
-- 5. 抽卡引擎 (Draw Engine §1.8: 2 必出 + 3 随机)
-- ============================================================================
local function drawChapterCards(ch, targetCount)
    targetCount = targetCount or 5
    local pool = {}
    local guaranteed = {}
    local candidateRandom = {}

    local currentMode = gameState.schedule.mode or "全模式"

    for _, c in ipairs(cardsData) do
        -- 章节匹配 (跨章池为 nil 或等于当前章节)
        local chMatch = (c.chapter == nil) or (c.chapter == ch)
        if chMatch then
            -- 模式匹配
            local modeMatch = false
            for _, m in ipairs(c.mode_tags or {}) do
                if m == "全模式" or m == currentMode then
                    modeMatch = true
                    break
                end
            end
            if modeMatch then
                -- 前置条件满足
                if evalExpr(c.prereq_expr) then
                    if c.pool_type == "milestone" then
                        table.insert(guaranteed, c)
                    else
                        table.insert(candidateRandom, c)
                    end
                end
            end
        end
    end

    -- 打乱候选池
    local function shuffle(tbl)
        for i = #tbl, 2, -1 do
            local j = math.random(i)
            tbl[i], tbl[j] = tbl[j], tbl[i]
        end
    end
    shuffle(guaranteed)
    shuffle(candidateRandom)

    local drawn = {}
    local numGuaranteed = math.min(targetCount == 3 and 1 or 2, #guaranteed)
    for i = 1, numGuaranteed do
        table.insert(drawn, guaranteed[i])
    end
    for i = 1, math.min(targetCount - #drawn, #candidateRandom) do
        table.insert(drawn, candidateRandom[i])
    end
    if #drawn < targetCount then
        for _, c in ipairs(cardsData) do
            if #drawn >= targetCount then break end
            table.insert(drawn, c)
        end
    end

    gameState.chapterQueue = drawn
    gameState.currentCardIndex = 1
    gameState.currentCard = drawn[1]
end

-- ============================================================================
-- 6. 卡牌结算核心 (W1 分支唯一源, W5 Cap夹逼与乘区, W6 人设判断)
-- ============================================================================
local function selectCardOption(optKey)
    local card = gameState.currentCard
    if not card then return end
    local option = nil
    for _, opt in ipairs(card.options or {}) do
        if opt.opt_key == optKey then option = opt break end
    end
    if not option then return end

    -- req_expr 门控判定
    if option.req_expr and not evalExpr(option.req_expr) then
        print("[LOCKED] Option is locked by req_expr: " .. tostring(option.req_expr))
        return
    end

    -- 记录快照供复活
    takeSnapshot()

    -- 1. 检定判定 check_expr
    local checkPassed = true
    if option.check_expr then
        checkPassed = evalExpr(option.check_expr)
    end

    local appliedDeltas = {}
    local appliedAttrs = {}
    local appliedEndings = {}
    local appliedWrites = {}

    if not checkPassed and option.check_fail then
        -- 检定失败
        if option.check_fail.delta_five_dim then
            for k, v in pairs(option.check_fail.delta_five_dim) do appliedDeltas[k] = v end
        end
        if option.check_fail.ending_triggers then
            for _, e in ipairs(option.check_fail.ending_triggers) do table.insert(appliedEndings, e) end
        end
        if option.check_fail.state_writes then
            for _, w in ipairs(option.check_fail.state_writes) do table.insert(appliedWrites, w) end
        end
    else
        -- 检定通过
        if option.effects and option.effects.delta_five_dim then
            for k, v in pairs(option.effects.delta_five_dim) do appliedDeltas[k] = v end
        end
        -- CP3 缺口②（Node cardEngine.mjs:36/292-294）：delta_attrs 结算（check_fail 无此字段，不补）
        if option.effects and option.effects.delta_attrs then
            for k, v in pairs(option.effects.delta_attrs) do appliedAttrs[k] = v end
        end
        if option.effects and option.effects.ending_triggers then
            for _, e in ipairs(option.effects.ending_triggers) do table.insert(appliedEndings, e) end
        end
        if option.effects and option.effects.state_writes then
            for _, w in ipairs(option.effects.state_writes) do table.insert(appliedWrites, w) end
        end
    end

    -- W1: 若有 effects_conditional，以分支为唯一结算源
    if option.effects and option.effects.effects_conditional then
        local cond = option.effects.effects_conditional
        local condRes = evalExpr(cond["if"])
        local branch = condRes and cond["then"] or cond["else"]
        if branch and branch.delta_five_dim then
            appliedDeltas = {}
            for k, v in pairs(branch.delta_five_dim) do appliedDeltas[k] = v end
        end
        if branch and branch.delta_attrs then
            appliedAttrs = {}
            for k, v in pairs(branch.delta_attrs) do appliedAttrs[k] = v end
        end
    end

    -- 3. 乘区处理 (Y0: 经营乘区五段连乘夹逼 [0.4, 3.0]，操作乘区与整活乘区夹后叠加)
    -- 3a. M_模式 ∈ [0.8, 1.5]
    local scheduledMode = gameState.schedule.mode or "全模式"
    local mMode = 1.0
    if card.mode_tags and #card.mode_tags > 0 then
        local matched = false
        for _, t in ipairs(card.mode_tags) do
            if t == scheduledMode or t == "全模式" or string.find(t, scheduledMode) then
                matched = true
                break
            end
        end
        if matched then mMode = 1.0 else mMode = 0.8 end
    end
    if tonumber(gameState.variables["Flag_签公会"]) == 1 then
        mMode = mMode + 0.2 -- §2.3: 公会推流加成 M_模式 +0.2
    end
    if gameState.practiceBuff and gameState.practiceBuff.targetChapter == gameState.currentChapter and gameState.practiceBuff.mode == scheduledMode then
        mMode = mMode + gameState.practiceBuff.bonus -- §2.8C & Z2: 练功加成 +0.15 (仅下一阶段对应模式生效)
    elseif gameState.nextModeMultBonus and gameState.nextModeMultBonusMode == scheduledMode then
        mMode = mMode + gameState.nextModeMultBonus -- §2.8C: 练功加成 +0.15
    end
    mMode = math.max(0.8, math.min(1.5, mMode))

    -- 3b. M_时段 ∈ [0.85, 1.4]
    local slotId = gameState.schedule.timeSlot
    local timeSlots = (configData.schedules and configData.schedules.time_slots) or {}
    local slotObj = nil
    for _, s in ipairs(timeSlots) do
        if s.id == slotId then slotObj = s break end
    end
    local mSlot = (slotObj and slotObj.fans_mult) or 1.0
    mSlot = math.max(0.85, math.min(1.4, mSlot))

    -- 3c. M_时长 ∈ [0.8, 1.2]
    local durHours = gameState.schedule.duration
    local durations = (configData.schedules and configData.schedules.durations) or {}
    local durObj = nil
    for _, d in ipairs(durations) do
        if d.hours == durHours then durObj = d break end
    end
    local mDuration = (durObj and durObj.fans_mult) or (durHours == 2 and 0.8 or (durHours == 6 and 1.2 or 1.0))
    mDuration = math.max(0.8, math.min(1.2, mDuration))

    -- 3d. M_属性 = 1 + 0.05 * (核心属性 - 5) ∈ [0.8, 1.25]
    local coreAttrMap = { ["游戏"] = "游戏技术", ["才艺"] = "才艺", ["电台"] = "嗓音", ["团播"] = "颜值", ["PK"] = "口才", ["带货"] = "口才", ["户外"] = "体力" }
    local coreAttrName = coreAttrMap[scheduledMode] or "口才"
    local coreAttrVal = gameState.attributes[coreAttrName] or 5
    local mAttr = 1.0 + 0.05 * (coreAttrVal - 5)
    mAttr = math.max(0.8, math.min(1.25, mAttr))

    -- 3e. M_口碑 = 1 + 0.01 * (口碑 - 60) ∈ [0.5, 1.4]
    local repVal = gameState.fiveDim.rep or 60
    local mRep = 1.0 + 0.01 * (repVal - 60)
    mRep = math.max(0.5, math.min(1.4, mRep))

    -- 经营乘区连乘
    local mBusiness = mMode * mSlot * mDuration * mAttr * mRep

    -- 3f. Ops 乘区
    local opsMultiplier = 1.0
    if gameState.timingInstance.active and card.ops_type == "timing_bar" then
        opsMultiplier = gameState.timingInstance.multiplier or 1.0
        if card.card_id == "C6-M05" and optKey == "A" then
            opsMultiplier = 1.0
        end
    end

    -- 3g. 整活流派特殊乘区
    local circusMultiplier = 1.0
    local circusZeroRevenue = false
    local isCircus = (gameState.variables["Tag_流派"] == "整活" or gameState.variables["Tag_流派"] == "整活擦边")
    if isCircus then
        if math.random() < 0.35 then
            circusZeroRevenue = true
        else
            circusMultiplier = 2.5
        end
    end

    -- 4. 总乘区夹逼 (Y0 归位正本: 只夹经营乘区连乘 [0.4, 3.0]，操作和整活在夹后叠加)
    local mBusinessClamped = math.max(0.4, math.min(3.0, mBusiness))
    local totalMultiplier = mBusinessClamped * opsMultiplier * circusMultiplier

    -- 获取当章设定
    local ch = gameState.currentChapter or 1
    local chCfg = nil
    for _, c in ipairs(configData.chapters or {}) do
        if c.chapter == ch then chCfg = c break end
    end
    chCfg = chCfg or { Base_Fans = 220, Cap_Fans = 600, Base_Income = 800, Cap_Wallet = 3000, chapter_5card_fans_cap = 3000 }
    local baseFans = chCfg.Base_Fans or 220
    local capFans = chCfg.Cap_Fans
    local baseIncome = chCfg.Base_Income or 800
    local capWallet = chCfg.Cap_Wallet
    local chapter5CardCap = chCfg.chapter_5card_fans_cap or (capFans and capFans * 5 or 3000)

    -- 应用乘区与 Cap (X1, X2, X3, Y1)
    if circusZeroRevenue then
        if appliedDeltas.fans_pct and appliedDeltas.fans_pct > 0 then appliedDeltas.fans_pct = nil end
        if appliedDeltas.fans and appliedDeltas.fans > 0 then appliedDeltas.fans = 0 end
        if appliedDeltas.wallet and appliedDeltas.wallet > 0 then appliedDeltas.wallet = 0 end
        if appliedDeltas.wallet_pct and appliedDeltas.wallet_pct > 0 then appliedDeltas.wallet_pct = nil end
    else
        -- 5a. Fans 结算 (X1: 锚定 Base_Fans(章) + X2.④: 5 卡累计上限)
        if appliedDeltas.fans_pct and appliedDeltas.fans_pct < 0 then
            -- 负向掉粉税按实数扣减 (§2.2 注 3)
            local dropFans = math.floor(gameState.fiveDim.fans * (math.abs(appliedDeltas.fans_pct) / 100))
            appliedDeltas.fans = -dropFans
            appliedDeltas.fans_pct = nil
        elseif appliedDeltas.fans_pct or (appliedDeltas.fans and appliedDeltas.fans > 0) then
            local cardFansPct = (appliedDeltas.fans_pct and appliedDeltas.fans_pct > 0) and (appliedDeltas.fans_pct / 100) or 0
            local deltaFans = 0
            if appliedDeltas.fans_pct then
                deltaFans = math.floor(baseFans * totalMultiplier * (1 + cardFansPct))
            elseif appliedDeltas.fans and appliedDeltas.fans > 0 then
                deltaFans = math.floor(appliedDeltas.fans * totalMultiplier)
            end
            if capFans then deltaFans = math.min(capFans, deltaFans) end
            local alreadyGained = gameState.chapterFansGained or 0
            local remainingCap = math.max(0, chapter5CardCap - alreadyGained)
            deltaFans = math.min(deltaFans, remainingCap)
            gameState.chapterFansGained = alreadyGained + deltaFans

            appliedDeltas.fans = deltaFans
            appliedDeltas.fans_pct = nil
        end

        -- 5b. 钱包 R 乘区结算 (X2.③, X3, Y1)
        local convRate = option.conversion_rate_pct or (appliedDeltas.conversion_rate_pct or (option.effects and option.effects.conversion_rate_pct or 0))
        local hasPositiveWallet = (appliedDeltas.wallet and appliedDeltas.wallet > 0) or
                                  (appliedDeltas.wallet_pct and appliedDeltas.wallet_pct > 0) or
                                  (convRate > 0)
        local hasNegativeWallet = (appliedDeltas.wallet and appliedDeltas.wallet < 0)

        if hasPositiveWallet then
            -- R_模式变现
            local rMode = 1.0
            if slotObj and slotObj.id == "slot_afternoon" and scheduledMode == "带货" then
                rMode = slotObj.wallet_mult_ecommerce or 1.25
            elseif slotObj and slotObj.wallet_mult then
                rMode = slotObj.wallet_mult
            end

            -- R_粉丝构成 ∈ [0.6, 1.8] (Z1: 正本缺口裁定采用公式 R = clamp(1 + 0.02 * (S - S0), 0.6, 1.8))
            -- S = 大哥% + 颜粉% - 技术粉%; S0 = 15 (新局中性基准 15 + 20 - 20)
            local comp = gameState.fanComposition or {}
            local bigSpender = (comp["大哥"] ~= nil) and comp["大哥"] or 15
            local beautyFans = (comp["颜粉"] ~= nil) and comp["颜粉"] or 20
            local techFans = (comp["技术粉"] ~= nil) and comp["技术粉"] or 20
            local S = bigSpender + beautyFans - techFans
            local S0 = 15
            local rFanComp = 1.0 + 0.02 * (S - S0)
            rFanComp = math.max(0.6, math.min(1.8, rFanComp))

            -- R_分成 (野生 0.5 / 公会 0.35)
            local rShare = (tonumber(gameState.variables["Flag_签公会"]) == 1) and 0.35 or 0.5

            -- R_商务 (口碑 >= 80 或 Tag_理性消费清流 == 1 -> 1.5 封顶)
            local rCommercial = 1.0
            local isRational = (tonumber(gameState.variables["Tag_理性消费清流"]) == 1)
            if (gameState.fiveDim.rep or 0) >= 80 or isRational then
                rCommercial = 1.5
            end

            -- 基准变现收益
            local baseRevenue = baseIncome * rMode * rFanComp * rShare * rCommercial

            -- 卡面固定 / 百分比加成
            local cardBonus = 0
            if appliedDeltas.wallet and appliedDeltas.wallet > 0 then
                cardBonus = cardBonus + appliedDeltas.wallet
            end
            if appliedDeltas.wallet_pct and appliedDeltas.wallet_pct > 0 then
                cardBonus = cardBonus + math.floor(gameState.fiveDim.wallet * (appliedDeltas.wallet_pct / 100))
            end

            -- X3: conversion_rate_pct 消费
            if convRate > 0 then
                cardBonus = cardBonus + math.floor((baseRevenue + cardBonus) * (convRate / 100))
            end

            -- 正向收入受 ops 乘区与 Cap_Wallet 夹逼 (Y1.②: 整活 x2.5 退出钱包通道)
            local positiveWallet = math.floor((baseRevenue + cardBonus) * opsMultiplier)
            if capWallet then
                positiveWallet = math.min(capWallet, positiveWallet)
            end

            local finalWallet = positiveWallet
            if hasNegativeWallet then
                finalWallet = positiveWallet + appliedDeltas.wallet
            end

            appliedDeltas.wallet = finalWallet
            appliedDeltas.wallet_pct = nil
            appliedDeltas.conversion_rate_pct = nil
        elseif hasNegativeWallet then
            appliedDeltas.wallet_pct = nil
            appliedDeltas.conversion_rate_pct = nil
        end
    end

    -- 应用五维变动
    if appliedDeltas.fans then gameState.fiveDim.fans = math.max(0, gameState.fiveDim.fans + appliedDeltas.fans) end

    if appliedDeltas.heat then gameState.fiveDim.heat = math.max(0, math.min(10000, gameState.fiveDim.heat + appliedDeltas.heat)) end
    if appliedDeltas.heat_pct then
        local delta = math.floor(gameState.fiveDim.heat * (appliedDeltas.heat_pct / 100))
        gameState.fiveDim.heat = math.max(0, math.min(10000, gameState.fiveDim.heat + delta))
    end
    if appliedDeltas.heat_target then gameState.fiveDim.heat = appliedDeltas.heat_target end

    if appliedDeltas.wallet then
        gameState.fiveDim.wallet = gameState.fiveDim.wallet + appliedDeltas.wallet
        if appliedDeltas.wallet > 0 then
            gameState.variables["Total_Income"] = (tonumber(gameState.variables["Total_Income"]) or 0) + appliedDeltas.wallet
        end
    end
    if appliedDeltas.wallet_pct then
        local delta = math.floor(gameState.fiveDim.wallet * (appliedDeltas.wallet_pct / 100))
        gameState.fiveDim.wallet = gameState.fiveDim.wallet + delta
    end

    if appliedDeltas.rep then gameState.fiveDim.rep = math.max(0, math.min(100, gameState.fiveDim.rep + appliedDeltas.rep)) end
    if appliedDeltas.rep_target then gameState.fiveDim.rep = appliedDeltas.rep_target end

    if appliedDeltas.stamina then gameState.fiveDim.stamina = math.max(0, math.min(100, gameState.fiveDim.stamina + appliedDeltas.stamina)) end
    if appliedDeltas.hater_pct then gameState.haterPct = math.max(0, math.min(100, gameState.haterPct + appliedDeltas.hater_pct)) end

    -- CP3 缺口②：应用属性增减（Node cardEngine.mjs:292-294，序：五维→属性→状态写入；基数缺省 5）
    for attr, val in pairs(appliedAttrs) do
        gameState.attributes[attr] = (gameState.attributes[attr] or 5) + val
    end

    -- 应用状态写入
    for _, w in ipairs(appliedWrites) do
        applyStateWrite(w)
    end

    -- CP3 缺口③④（Node cardEngine.mjs:312-417 为准绳）：落支按卡面顺序首个满足者落、落支即停。
    -- 只接局内即时分支（D 系暴毙 + H01/H04/H10/H03/H12 式即时彩蛋）；M 系与 H07 结算类落支留结算/阶段4。
    if #appliedEndings > 0 then
        local function isEndingSatisfied(eid)
            local v = gameState.variables
            if eid == "D20" then return tonumber(v["Flag_卖惨人设"]) == 1 end
            if eid == "D21" then return tonumber(v["Flag_造假剧本"]) == 1 end
            if eid == "D15" then return (tonumber(v["Count_复盘留档"]) or 0) < 2 end
            if eid == "D16" then return (tonumber(v["Count_偷拍素材"]) or 0) >= 3 end
            if eid == "D19" then return tonumber(v["Flag_账号协议"]) == 0 end
            if eid == "D09" then return math.random() < 0.5 end
            if eid == "H03" then return math.random() >= 0.5 end
            if eid == "H04" then return (tonumber(v["Count_猫上镜"]) or 0) >= 3 end
            if eid == "H10" then return (tonumber(v["Count_考编"]) or 0) >= 3 end
            return true
        end
        local chosenEnding = nil
        for _, eid in ipairs(appliedEndings) do
            if isEndingSatisfied(eid) then chosenEnding = eid break end
        end
        if not chosenEnding then chosenEnding = appliedEndings[1] end

        local function landEnding(eid, cleared)
            if gameState.triggeredEnding then return end -- 落定格：一经写入不覆盖（Node gameState.mjs:102-105）
            gameState.triggeredEnding = eid
            if cleared then gameState.isCleared = true else gameState.isDead = true end
            unlockEnding(eid)
            gameState.screen = cleared and "Screen-07" or "Screen-06"
        end

        if chosenEnding:sub(1, 1) == "D" then
            landEnding(chosenEnding, false)
            return
        elseif card.card_id == "X-EGG-09" and chosenEnding == "H12" then
            gameState.variables["Qualified_H12"] = 1
            landEnding("H12", true)
            return
        elseif card.card_id == "X-EGG-04" and chosenEnding == "H01" then
            gameState.variables["Qualified_H01"] = 1
            landEnding("H01", true)
            return
        elseif chosenEnding == "H04" and (tonumber(gameState.variables["Count_猫上镜"]) or 0) >= 3 then
            gameState.variables["Qualified_H04"] = 1
            landEnding("H04", true)
            return
        elseif chosenEnding == "H10" and (tonumber(gameState.variables["Count_考编"]) or 0) >= 3 then
            gameState.variables["Qualified_H10"] = 1
            landEnding("H10", true)
            return
        elseif card.card_id == "C6-M06" and chosenEnding == "H03" then
            gameState.variables["Qualified_H03"] = 1
            landEnding("H03", true)
            return
        end
        -- 其余 M/H 引用（含 H07、第六章链）本点不即时落、不写 Qualified（清单⑤留阶段4）；不推进卡，交由数值暴毙/流转
    end

    -- 数值暴毙判定（一般法兜底；CP3 缺口④：已落支则跳过，绝不覆写，Node gameState.mjs:327-328）
    if not gameState.isDead and not gameState.triggeredEnding then
        if gameState.fiveDim.stamina <= 0 then
            gameState.isDead = true
            gameState.triggeredEnding = "D01"
            unlockEnding("D01")
            gameState.screen = "Screen-06"
            return
        elseif gameState.fiveDim.rep <= 0 then
            gameState.isDead = true
            gameState.triggeredEnding = "D03"
            unlockEnding("D03")
            gameState.screen = "Screen-06"
            return
        end
    end

    -- CP3 缺口④：落支即停——本局已有结局则不再推进卡（Node 结局即终局，循环退出对齐）
    if gameState.triggeredEnding then return end

    -- 流转到下一张卡或下播
    gameState.currentCardIndex = gameState.currentCardIndex + 1
    if gameState.currentCardIndex <= #gameState.chapterQueue then
        gameState.currentCard = gameState.chapterQueue[gameState.currentCardIndex]
        -- 初始化下一张卡的时机条
        if gameState.currentCard and gameState.currentCard.ops_type == "timing_bar" then
            gameState.timingInstance.active = true
            gameState.timingInstance.cursorPos = 0.0
            gameState.timingInstance.cursorDir = 1
            local center = 0.2 + math.random() * 0.6
            gameState.timingInstance.sweetStart = center - 0.075
            gameState.timingInstance.sweetEnd = center + 0.075
            gameState.timingInstance.goodStart = center - 0.20
            gameState.timingInstance.goodEnd = center + 0.20
            gameState.timingInstance.multiplier = 1.0
            gameState.timingInstance.isResolved = false
        else
            gameState.timingInstance.active = false
        end
    else
        if gameState.overtimeActive then
            -- 加时赛 3 卡完成，直接进入结算
            settleCurrentChapter(false)
        else
            -- 本章 5 卡完成，进入下播行动 (Screen-04)
            gameState.screen = "Screen-04"
        end
    end
end

-- ============================================================================
-- 7. 阶段章末结算 (Stage Settlement)
-- ============================================================================
local function settleCurrentChapter(useAdDouble)
    local ch = gameState.currentChapter
    local chCfg = nil
    for _, c in ipairs(configData.chapters or {}) do
        if c.chapter == ch then chCfg = c break end
    end
    chCfg = chCfg or { Base_Fans = 220, Base_Income = 800, Cap_Fans = 600, Cap_Wallet = 3000, fans_gate_to = 1000 }

    -- 1. 热度衰减
    local decay = math.max(15, math.floor(gameState.fiveDim.heat * 0.15))
    gameState.fiveDim.heat = math.max(0, gameState.fiveDim.heat - decay)

    -- 2. 基础增量与广告翻倍 (受 Cap 夹逼)
    local fansMult = 1.0
    local walletMult = 1.0
    if useAdDouble and gameState.adUsage.settlementDouble < 2 then
        fansMult = fansMult * 2.0
        walletMult = walletMult * 2.0
        gameState.adUsage.settlementDouble = gameState.adUsage.settlementDouble + 1
    end

    local netFans = math.floor(chCfg.Base_Fans * fansMult)
    local netWallet = math.floor(chCfg.Base_Income * walletMult)

    if chCfg.Cap_Fans then netFans = math.min(chCfg.Cap_Fans, netFans) end
    if chCfg.Cap_Wallet then netWallet = math.min(chCfg.Cap_Wallet, netWallet) end

    gameState.fiveDim.fans = gameState.fiveDim.fans + netFans
    gameState.fiveDim.wallet = gameState.fiveDim.wallet + netWallet

    -- 3. 粉丝构成漂移 (§2.7 & Z4 漂移输入补全)
    local attrs = gameState.attributes or {}
    local sched = gameState.schedule or gameState.selectedSchedule or {}
    local mode = sched.mode or "全模式"
    local slotId = sched.timeSlot or "slot_prime"
    local isCircus = (gameState.variables and gameState.variables["Tag_流派"] == "整活")

    local m_yan = (mode == "才艺" or mode == "团播") and 1.5 or 1.0
    local s_yan = (slotId == "slot_prime") and 1.5 or 1.0

    local m_sheng = (mode == "电台" or mode == "才艺") and 1.5 or 1.0
    local s_sheng = (slotId == "slot_morning" or slotId == "slot_late") and 1.5 or 1.0

    local m_ji = (mode == "游戏") and 1.5 or 1.0
    local s_ji = (slotId == "slot_noon" or slotId == "slot_prime") and 1.5 or 1.0

    local m_le = (mode == "PK" or mode == "户外" or isCircus) and 1.5 or 1.0
    local s_le = (slotId == "slot_noon") and 1.5 or 1.0

    local m_da = (mode == "PK" or mode == "电台") and 1.5 or 1.0
    local s_da = (slotId == "slot_prime" or slotId == "slot_late") and 1.5 or 1.0

    local m_xue = (mode == "游戏" or mode == "团播") and 1.5 or 1.0
    local s_xue = (slotId == "slot_noon" or slotId == "slot_weekend") and 1.5 or 1.0

    local w顏 = ((attrs["颜值"] or 5) + (attrs["才艺"] or 5)) * m_yan * s_yan
    local w聲 = ((attrs["嗓音"] or 5) * 2) * m_sheng * s_sheng
    local w技 = ((attrs["游戏技术"] or 5) * 2) * m_ji * s_ji
    local w樂 = ((attrs["口才"] or 5) + (attrs["运气"] or 5)) * m_le * s_le
    local w哥 = ((attrs["情商"] or 5) + (attrs["颜值"] or 5) + (attrs["才艺"] or 5)) * m_da * s_da
    local w學 = ((attrs["游戏技术"] or 5) + (attrs["口才"] or 5)) * m_xue * s_xue
    local totalW = math.max(1, w顏 + w聲 + w技 + w樂 + w哥 + w學)

    local newComp = {
        ["颜粉"] = math.floor(w顏 / totalW * 100),
        ["声控粉"] = math.floor(w聲 / totalW * 100),
        ["技术粉"] = math.floor(w技 / totalW * 100),
        ["乐子人"] = math.floor(w樂 / totalW * 100),
        ["大哥"] = math.floor(w哥 / totalW * 100),
        ["学生粉"] = math.floor(w學 / totalW * 100)
    }
    local sumP = 0
    for k, v in pairs(newComp) do sumP = sumP + v end
    newComp["学生粉"] = newComp["学生粉"] + (100 - sumP)
    gameState.fanComposition = newComp

    -- 4. 章节闸门判定与加时赛逻辑 (X2.⑤ & Y2)
    local gatePassed = (gameState.fiveDim.fans >= chCfg.fans_gate_to)
    gameState.overtimePlayed = gameState.overtimePlayed or {}
    local canOvertime = false
    if not gatePassed and not gameState.isDead then
        if not gameState.overtimePlayed[ch] then
            canOvertime = true
            gameState.overtimeActive = true
            gameState.overtimePlayed[ch] = true
        else
            -- 已跑过加时赛仍未达标 -> 体面收官 (H07 / M04 / M12)
            gameState.isCleared = false
            gameState.overtimeActive = false
            if not gameState.triggeredEnding then
                -- CP3 缺口③（Node stageSettlement.mjs:157-168，482fe7a 裁定）：局终体面收场，M04/M12 兜底前先评 H07
                if (tonumber(gameState.variables["Qualified_H07"]) == 1 or tonumber(gameState.variables["Flag_零粉快乐"]) == 1)
                    and gameState.fiveDim.fans < 10000 and (gameState.fiveDim.rep or 0) >= 90 then
                    gameState.isCleared = true
                    gameState.triggeredEnding = "H07" -- 零人观看的桃花源
                elseif (gameState.fiveDim.rep or 0) >= 50 then
                    gameState.triggeredEnding = "M04" -- 佛系小主播 (口碑良好)
                else
                    gameState.triggeredEnding = "M12" -- 正常上班 (泯然众人)
                end
                unlockEnding(gameState.triggeredEnding)
            end
        end
    elseif gatePassed then
        gameState.overtimeActive = false
    end

    -- 第六章盛典加冕检测
    if ch == 6 and gatePassed and not gameState.isDead then
        gameState.isCleared = true
        if not gameState.triggeredEnding then
            if tonumber(gameState.variables["Tag_清白账本"]) == 1 and (gameState.fiveDim.rep or 0) >= 80 then
                gameState.triggeredEnding = "M01"
            elseif tonumber(gameState.variables["Flag_选品减伤"]) == 1 and gameState.schedule.mode == "带货" then
                gameState.triggeredEnding = "M02"
            elseif gameState.variables["Tag_流派"] == "整活" then
                gameState.triggeredEnding = "M04"
            elseif tonumber(gameState.variables["Count_算法异常"]) >= 3 and (gameState.attributes["运气"] or 0) == 10 then
                gameState.triggeredEnding = "H05"
            else
                gameState.triggeredEnding = "M05"
            end
            unlockEnding(gameState.triggeredEnding)
        end
    end

    -- Z2: 练功 buff 仅在紧接的下一阶段内生效，该阶段结算时无论用未用一律清零
    if gameState.practiceBuff and (gameState.practiceBuff.targetChapter or 0) <= ch then
        gameState.practiceBuff = nil
    end

    gameState.settleResult = {
        netFans = netFans,
        netWallet = netWallet,
        decay = decay,
        gatePassed = gatePassed,
        canOvertime = canOvertime,
        targetFans = chCfg.fans_gate_to
    }

    gameState.screen = "Screen-05"
end
_G.settleCurrentChapter = settleCurrentChapter
_G.drawChapterCards = drawChapterCards

-- ============================================================================
-- 8. 交互点击区域管理 (Click Hit-testing)
-- ============================================================================
local clickableButtons = {}

local function registerButton(id, x, y, w, h, onClick)
    table.insert(clickableButtons, { id = id, x = x, y = y, w = w, h = h, onClick = onClick })
end

local function clearButtons()
    for i = #clickableButtons, 1, -1 do
        clickableButtons[i] = nil
    end
end

local function handleScreenClick(x, y)
    for _, btn in ipairs(clickableButtons) do
        if x >= btn.x and x <= btn.x + btn.w and y >= btn.y and y <= btn.y + btn.h then
            if btn.onClick then
                btn.onClick()
                return true
            end
        end
    end
    return false
end

local function clickButtonById(btnId)
    for _, btn in ipairs(clickableButtons) do
        if btn.id == btnId then
            if btn.onClick then
                btn.onClick()
                return true
            end
        end
    end
    return false
end

-- ============================================================================
-- 9. 界面绘制层 (NanoVG 9-Screens Rendering)
-- ============================================================================

local function drawText(x, y, text, size, r, g, b, a, align)
    if fontId == -1 then return end
    nvgFontFaceId(nvgContext, fontId)
    nvgFontSize(nvgContext, size or 20)
    nvgFillColor(nvgContext, nvgRGBA(r or 255, g or 255, b or 255, a or 255))
    nvgTextAlign(nvgContext, align or (1 + 8)) -- Left + Top
    nvgText(nvgContext, x, y, tostring(text), nil)
end

local function drawButton(id, x, y, w, h, text, bgColor, textColor, onClick)
    registerButton(id, x, y, w, h, onClick)
    nvgBeginPath(nvgContext)
    nvgRoundedRect(nvgContext, x, y, w, h, 8)
    nvgFillColor(nvgContext, bgColor or nvgRGBA(59, 130, 246, 255))
    nvgFill(nvgContext)

    if fontId ~= -1 and text then
        nvgFontFaceId(nvgContext, fontId)
        nvgFontSize(nvgContext, 20)
        nvgFillColor(nvgContext, textColor or nvgRGBA(255, 255, 255, 255))
        nvgTextAlign(nvgContext, 2 + 16) -- Center + Middle
        nvgText(nvgContext, x + w / 2, y + h / 2, text, nil)
    end
end

local function drawHeaderHUD(titleText)
    -- Top HUD Bar
    nvgBeginPath(nvgContext)
    nvgRect(nvgContext, 0, 0, windowWidth, 90)
    nvgFillColor(nvgContext, nvgRGBA(24, 28, 44, 255))
    nvgFill(nvgContext)

    drawText(20, 16, titleText or "《从小主播到顶流》", 24, 255, 255, 255, 255)

    -- 5 Dimensions values
    local fd = gameState.fiveDim
    local hudStr = string.format("粉: %d | 热: %d | 钱: ￥%d | 口碑: %d | 体力: %d",
        fd.fans, fd.heat, fd.wallet, fd.rep, fd.stamina)
    drawText(20, 52, hudStr, 16, 203, 213, 225, 255)
end

-- Screen-01: 捏人与属性分配
local function renderScreen01()
    drawHeaderHUD("【开局加点】· 打造初始主播形象")

    drawText(30, 110, "分配基础点数 (剩余点数: " .. tostring(gameState.remainingBasePoints) .. ")", 22, 244, 114, 182, 255)
    drawText(30, 140, "单项范围 1~10，初始 5 点；看广告可单项 +3（上限 8 点）", 16, 148, 163, 184, 255)

    local attrNames = { "颜值", "嗓音", "才艺", "游戏技术", "口才", "情商", "体力", "心态", "运气" }
    local startY = 180
    local stepY = 44

    for i, attr in ipairs(attrNames) do
        local y = startY + (i - 1) * stepY
        local val = gameState.attributes[attr] or 5

        drawText(40, y + 6, attr .. ": " .. tostring(val), 20, 241, 245, 249, 255)

        -- Minus button
        drawButton("attr_minus_" .. attr, 220, y, 40, 32, "-", nvgRGBA(51, 65, 85, 255), nvgRGBA(255, 255, 255, 255), function()
            if val > 1 and gameState.remainingBasePoints < 45 then
                gameState.attributes[attr] = val - 1
                gameState.remainingBasePoints = gameState.remainingBasePoints + 1
            end
        end)

        -- Plus button
        drawButton("attr_plus_" .. attr, 280, y, 40, 32, "+", nvgRGBA(51, 65, 85, 255), nvgRGBA(255, 255, 255, 255), function()
            if val < 10 and gameState.remainingBasePoints > 0 then
                gameState.attributes[attr] = val + 1
                gameState.remainingBasePoints = gameState.remainingBasePoints - 1
            end
        end)

        -- Single attribute Ad bonus
        drawButton("attr_ad_" .. attr, 340, y, 160, 32, "看广告+3(上限8)", nvgRGBA(147, 51, 234, 200), nvgRGBA(255, 255, 255, 255), function()
            if gameState.adBonusUsed < 4 and val + 3 <= 8 then
                gameState.attributes[attr] = val + 3
                gameState.adBonusUsed = gameState.adBonusUsed + 1
            end
        end)
    end

    -- Bottom navigation buttons
    drawButton("btn_random_pts", 40, 600, 200, 48, "一键均衡分配", nvgRGBA(71, 85, 105, 255), nvgRGBA(255, 255, 255, 255), function()
        for _, a in ipairs(attrNames) do gameState.attributes[a] = 5 end
        gameState.remainingBasePoints = 0
    end)

    drawButton("btn_start_schedule", 260, 600, 240, 48, "确认加点 · 进入排班", nvgRGBA(236, 72, 153, 255), nvgRGBA(255, 255, 255, 255), function()
        gameState.screen = "Screen-02"
    end)

    drawButton("btn_view_gallery", 40, 670, 460, 44, "查看 50 格结局图鉴与天赋", nvgRGBA(30, 41, 59, 255), nvgRGBA(148, 163, 184, 255), function()
        gameState.screen = "Screen-09"
    end)
end

-- Screen-02: 直播排班配置
local function renderScreen02()
    local title = string.format("第 %d 章 · 直播排班配置", gameState.currentChapter)
    drawHeaderHUD(title)

    drawText(30, 110, "1. 选择直播主模式 (影响卡池与变现):", 20, 244, 114, 182, 255)
    local modes = { "游戏", "才艺", "电台", "团播", "PK", "带货", "户外" }
    local mx = 30
    local my = 145
    for i, m in ipairs(modes) do
        local isSel = (gameState.schedule.mode == m)
        local bg = isSel and nvgRGBA(236, 72, 153, 255) or nvgRGBA(51, 65, 85, 255)
        drawButton("mode_" .. m, mx, my, 110, 40, m, bg, nvgRGBA(255, 255, 255, 255), function()
            gameState.schedule.mode = m
        end)
        mx = mx + 120
        if i % 4 == 0 then
            mx = 30
            my = my + 50
        end
    end

    drawText(30, 260, "2. 选择开播时段 (影响自然涨粉与变现):", 20, 244, 114, 182, 255)
    local slots = {
        { id = "slot_morning", name = "早间场 (07-11)" },
        { id = "slot_noon", name = "午间场 (11-14)" },
        { id = "slot_afternoon", name = "下午场 (14-18)" },
        { id = "slot_prime", name = "黄金档 (18-22)" },
        { id = "slot_night", name = "深夜档 (22-02)" }
    }
    local sy = 295
    for _, s in ipairs(slots) do
        local isSel = (gameState.schedule.timeSlot == s.id)
        local bg = isSel and nvgRGBA(59, 130, 246, 255) or nvgRGBA(30, 41, 59, 255)
        drawButton("slot_" .. s.id, 30, sy, 480, 36, s.name, bg, nvgRGBA(255, 255, 255, 255), function()
            gameState.schedule.timeSlot = s.id
        end)
        sy = sy + 44
    end

    drawText(30, 530, "3. 选择单场时长 (消耗体力):", 20, 244, 114, 182, 255)
    local durations = { 2, 4, 6 }
    local dx = 30
    for _, d in ipairs(durations) do
        local isSel = (gameState.schedule.duration == d)
        local bg = isSel and nvgRGBA(16, 185, 129, 255) or nvgRGBA(51, 65, 85, 255)
        drawButton("dur_" .. d, dx, 565, 150, 40, d .. " 小时", bg, nvgRGBA(255, 255, 255, 255), function()
            gameState.schedule.duration = d
        end)
        dx = dx + 165
    end

    drawButton("btn_start_live", 40, 640, 460, 52, "掀帘子开门 · 开始今日直播 (抽5张卡)", nvgRGBA(236, 72, 153, 255), nvgRGBA(255, 255, 255, 255), function()
        drawChapterCards(gameState.currentChapter)
        -- 初始化第一张卡的时机条状态
        if gameState.currentCard and gameState.currentCard.ops_type == "timing_bar" then
            gameState.timingInstance.active = true
            gameState.timingInstance.cursorPos = 0.0
            gameState.timingInstance.cursorDir = 1
            local center = 0.2 + math.random() * 0.6
            gameState.timingInstance.sweetStart = center - 0.075
            gameState.timingInstance.sweetEnd = center + 0.075
            gameState.timingInstance.goodStart = center - 0.20
            gameState.timingInstance.goodEnd = center + 0.20
            gameState.timingInstance.multiplier = 1.0
            gameState.timingInstance.isResolved = false
        else
            gameState.timingInstance.active = false
        end
        gameState.screen = "Screen-03"
    end)
end

-- Screen-03: 直播进行时 · 事件卡连续交互 (含 Ops-A 时机条)
local function renderScreen03()
    local card = gameState.currentCard
    local title = string.format("第 %d 章 · 直播中 (%d/5)", gameState.currentChapter, gameState.currentCardIndex)
    drawHeaderHUD(title)

    if not card then
        drawText(40, 200, "当前没有正在进行的事件卡", 22, 255, 255, 255, 255)
        drawButton("btn_to_settle", 40, 300, 460, 48, "前往阶段结算", nvgRGBA(59, 130, 246, 255), nvgRGBA(255, 255, 255, 255), function()
            gameState.screen = "Screen-04"
        end)
        return
    end

    -- 卡牌容器
    local cardX, cardY, cardW, cardH = 30, 110, windowWidth - 60, 780
    nvgBeginPath(nvgContext)
    nvgRoundedRect(nvgContext, cardX, cardY, cardW, cardH, 16)
    nvgFillColor(nvgContext, nvgRGBA(30, 35, 58, 255))
    nvgFill(nvgContext)

    -- 卡牌标签
    local tagStr = string.format("[%s]  ID: %s", (card.pool_type == "milestone" and "标志性事件" or "即时事件"), card.card_id)
    drawText(cardX + 20, cardY + 20, tagStr, 18, 244, 114, 182, 255)

    -- 卡牌标题
    drawText(cardX + 20, cardY + 50, card.title or "事件卡", 26, 255, 255, 255, 255)

    -- 情境描述文本 (多行截断展示)
    local ctx = card.context or ""
    local line1 = ctx:sub(1, 48)
    local line2 = ctx:sub(49, 96)
    local line3 = ctx:sub(97, 144)
    drawText(cardX + 20, cardY + 95, line1, 18, 203, 213, 225, 255)
    if #line2 > 0 then drawText(cardX + 20, cardY + 125, line2, 18, 203, 213, 225, 255) end
    if #line3 > 0 then drawText(cardX + 20, cardY + 155, line3, 18, 203, 213, 225, 255) end

    local currentOptY = cardY + 200

    -- Ops-A: 时机条渲染 (若本卡挂载时机条)
    if gameState.timingInstance.active and card.ops_type == "timing_bar" then
        drawText(cardX + 20, currentOptY, "【轻操作：时机条】停在甜区享 ×1.15 加成！", 18, 250, 204, 21, 255)
        currentOptY = currentOptY + 30

        local barX = cardX + 20
        local barY = currentOptY
        local barW = cardW - 40
        local barH = 36

        -- 轨道背景
        nvgBeginPath(nvgContext)
        nvgRoundedRect(nvgContext, barX, barY, barW, barH, 6)
        nvgFillColor(nvgContext, nvgRGBA(15, 23, 42, 255))
        nvgFill(nvgContext)

        -- 良区 (Good)
        local t = gameState.timingInstance
        local gX = barX + t.goodStart * barW
        local gW = (t.goodEnd - t.goodStart) * barW
        nvgBeginPath(nvgContext)
        nvgRoundedRect(nvgContext, gX, barY + 2, gW, barH - 4, 4)
        nvgFillColor(nvgContext, nvgRGBA(59, 130, 246, 180))
        nvgFill(nvgContext)

        -- 甜区 (Sweet)
        local sX = barX + t.sweetStart * barW
        local sW = (t.sweetEnd - t.sweetStart) * barW
        nvgBeginPath(nvgContext)
        nvgRoundedRect(nvgContext, sX, barY + 2, sW, barH - 4, 4)
        nvgFillColor(nvgContext, nvgRGBA(236, 72, 153, 220))
        nvgFill(nvgContext)

        -- 游标 (Cursor)
        local curX = barX + t.cursorPos * barW
        nvgBeginPath(nvgContext)
        nvgRoundedRect(nvgContext, curX - 3, barY - 4, 6, barH + 8, 3)
        nvgFillColor(nvgContext, nvgRGBA(255, 255, 255, 255))
        nvgFill(nvgContext)

        -- 点停按钮
        local btnTapText = t.isResolved and string.format("已点停: %s (×%.2f)", t.resultZone, t.multiplier) or "轻点点停游标"
        drawButton("btn_tap_timing", barX, barY + 44, barW, 36, btnTapText, nvgRGBA(245, 158, 11, 220), nvgRGBA(15, 23, 42, 255), function()
            if not t.isResolved then
                t.isResolved = true
                local pos = t.cursorPos
                if pos >= t.sweetStart and pos <= t.sweetEnd then
                    t.resultZone = "SWEET"
                    t.multiplier = 1.15
                elseif pos >= t.goodStart and pos <= t.goodEnd then
                    t.resultZone = "GOOD"
                    t.multiplier = 1.05
                else
                    t.resultZone = "NORMAL"
                    t.multiplier = 1.00
                end
            end
        end)

        currentOptY = currentOptY + 95
    end

    -- 选项按钮列表
    for i, opt in ipairs(card.options or {}) do
        local optBoxY = currentOptY
        local label = opt.label or ("选项 " .. opt.opt_key)
        local summary = opt.effects and opt.effects.summary or ""

        -- 选项卡外框
        nvgBeginPath(nvgContext)
        nvgRoundedRect(nvgContext, cardX + 20, optBoxY, cardW - 40, 110, 8)
        nvgFillColor(nvgContext, nvgRGBA(45, 55, 85, 255))
        nvgFill(nvgContext)

        drawText(cardX + 35, optBoxY + 12, "【选项 " .. opt.opt_key .. "】 " .. label, 20, 255, 255, 255, 255)
        drawText(cardX + 35, optBoxY + 42, "预判效果: " .. summary, 16, 250, 204, 21, 255)

        -- 选择按钮
        drawButton("opt_btn_" .. opt.opt_key, cardX + 35, optBoxY + 68, cardW - 70, 32, "选择该选项", nvgRGBA(59, 130, 246, 255), nvgRGBA(255, 255, 255, 255), function()
            selectCardOption(opt.opt_key)
        end)

        currentOptY = currentOptY + 125
    end
end

-- Screen-04: 下播行动屏 (8 选 1)
local function renderScreen04()
    drawHeaderHUD("【下播行动】· 直播收尾与日程安排")

    drawText(30, 105, "下播后有一段自由时间，选择一项行动提升自身或防范风险:", 18, 203, 213, 225, 255)

    local actions = {
        { id = "act_1", name = "1. 泡澡早睡", desc = "体力 +30，恢复充沛状态", fn = function()
            gameState.fiveDim.stamina = math.min(100, gameState.fiveDim.stamina + 30)
            settleCurrentChapter(false)
        end },
        { id = "act_2", name = "2. 练功精进", desc = "才艺/口才/技术 +1 点 (依主模式)", fn = function()
            local targetAttr = "才艺"
            local curMode = (gameState.schedule and gameState.schedule.mode) or "才艺"
            if curMode == "游戏" then targetAttr = "游戏技术"
            elseif curMode == "PK" or curMode == "带货" then targetAttr = "口才" end
            gameState.attributes[targetAttr] = math.min(10, (gameState.attributes[targetAttr] or 5) + 1)
            local attrToMode = { ["才艺"] = "才艺", ["游戏技术"] = "游戏", ["口才"] = "PK" }
            local targetMode = attrToMode[targetAttr] or "才艺"
            local targetChapter = (gameState.currentChapter or 1) + 1
            gameState.practiceBuff = { targetChapter = targetChapter, mode = targetMode, bonus = 0.15 }
            settleCurrentChapter(false)
        end },
        { id = "act_3", name = "3. 连麦维护", desc = "情商 +1，公会口碑 +5", fn = function()
            gameState.attributes["情商"] = math.min(10, gameState.attributes["情商"] + 1)
            gameState.fiveDim.rep = math.min(100, gameState.fiveDim.rep + 5)
            settleCurrentChapter(false)
        end },
        { id = "act_4", name = "4. 接私活走单", desc = "钱包 +5,000，但体力 -20", fn = function()
            gameState.fiveDim.wallet = gameState.fiveDim.wallet + 5000
            gameState.fiveDim.stamina = math.max(0, gameState.fiveDim.stamina - 20)
            settleCurrentChapter(false)
        end },
        { id = "act_5", name = "5. 供应链选品 (轻操作)", desc = "进入【翻样辨真】找瑕疵，成功则防暴雷！", fn = function()
            gameState.inspectInstance.active = true
            gameState.inspectInstance.flipsRemaining = 2
            gameState.inspectInstance.revealed = { false, false, false, false }
            gameState.inspectInstance.fakeIndex = math.random(4)
            gameState.inspectInstance.success = false
            gameState.screen = "Ops-B"
        end },
        { id = "act_6", name = "6. 看回放复盘留档", desc = "Count_复盘留档 +1 (第五章绝地反杀唯一源)", fn = function()
            gameState.variables["Count_复盘留档"] = (tonumber(gameState.variables["Count_复盘留档"]) or 0) + 1
            settleCurrentChapter(false)
        end },
        { id = "act_7", name = "7. 约会维系感情", desc = "状态 +10，情商 +1", fn = function()
            gameState.fiveDim.stamina = math.min(100, gameState.fiveDim.stamina + 10)
            settleCurrentChapter(false)
        end },
        { id = "act_8", name = "8. 平台公关走动", desc = "花 ￥3,000 钱包，消除 1 次违规隐患", fn = function()
            gameState.fiveDim.wallet = math.max(0, gameState.fiveDim.wallet - 3000)
            gameState.fiveDim.rep = math.min(100, gameState.fiveDim.rep + 8)
            settleCurrentChapter(false)
        end }
    }

    local y = 145
    for _, act in ipairs(actions) do
        nvgBeginPath(nvgContext)
        nvgRoundedRect(nvgContext, 30, y, windowWidth - 60, 56, 8)
        nvgFillColor(nvgContext, nvgRGBA(30, 41, 59, 255))
        nvgFill(nvgContext)

        drawText(45, y + 8, act.name, 19, 255, 255, 255, 255)
        drawText(45, y + 32, act.desc, 15, 148, 163, 184, 255)

        drawButton("btn_" .. act.id, windowWidth - 140, y + 10, 95, 36, "执行行动", nvgRGBA(236, 72, 153, 255), nvgRGBA(255, 255, 255, 255), act.fn)

        y = y + 66
    end
end

-- Ops-B: 翻样辨真轻操作
local function renderOpsB()
    drawHeaderHUD("【翻样辨真 · 供应链选品】")

    drawText(30, 110, "货架上有 4 件样品，其中 1 件暗藏造假缺陷！", 20, 255, 255, 255, 255)
    drawText(30, 140, "你有 2 次查验机会，找出缺陷即可完成合格存证！", 17, 244, 114, 182, 255)

    local inst = gameState.inspectInstance
    local sampleNames = { "1. 查针脚", "2. 查吊牌", "3. 查水洗标", "4. 闻气味" }
    local sx = 30
    local sy = 180

    for i = 1, 4 do
        local isRev = inst.revealed[i]
        local isFake = (i == inst.fakeIndex)

        nvgBeginPath(nvgContext)
        nvgRoundedRect(nvgContext, sx, sy, 225, 160, 10)
        local cardColor = isRev and (isFake and nvgRGBA(239, 68, 68, 255) or nvgRGBA(16, 185, 129, 255)) or nvgRGBA(30, 41, 59, 255)
        nvgFillColor(nvgContext, cardColor)
        nvgFill(nvgContext)

        drawText(sx + 15, sy + 15, sampleNames[i], 20, 255, 255, 255, 255)

        if isRev then
            if isFake then
                drawText(sx + 15, sy + 55, "【致命瑕疵！】", 18, 255, 255, 255, 255)
                drawText(sx + 15, sy + 85, "发现面料掺假证据", 16, 255, 255, 255, 255)
            else
                drawText(sx + 15, sy + 55, "【合格真品】", 18, 255, 255, 255, 255)
                drawText(sx + 15, sy + 85, "未发现明显做工瑕疵", 16, 255, 255, 255, 255)
            end
        else
            drawButton("flip_" .. i, sx + 20, sy + 60, 185, 40, "翻开抽检", nvgRGBA(59, 130, 246, 255), nvgRGBA(255, 255, 255, 255), function()
                if inst.flipsRemaining > 0 and not inst.revealed[i] then
                    inst.revealed[i] = true
                    inst.flipsRemaining = inst.flipsRemaining - 1
                    if isFake then
                        inst.success = true
                        gameState.variables["Count_验货命中"] = (tonumber(gameState.variables["Count_验货命中"]) or 0) + 1
                        gameState.variables["Flag_选品减伤"] = 1
                    end
                end
            end)
        end

        if i % 2 == 1 then
            sx = sx + 250
        else
            sx = 30
            sy = sy + 180
        end
    end

    drawText(30, 560, "剩余抽检机会: " .. tostring(inst.flipsRemaining) .. " 次", 20, 250, 204, 21, 255)
    if inst.success then
        drawText(30, 600, "✓ 验货成功！获得样品存证，锁定供应链安全保护！", 20, 16, 185, 129, 255)
    elseif inst.flipsRemaining == 0 then
        drawText(30, 600, "✗ 抽检结束，未锁定存证（可能在后续遭遇供应链被锤）", 20, 239, 68, 68, 255)
    end

    drawButton("btn_finish_inspect", 40, 660, 460, 48, "完成选品 · 前往阶段结算", nvgRGBA(236, 72, 153, 255), nvgRGBA(255, 255, 255, 255), function()
        settleCurrentChapter(false)
    end)
end

-- Screen-05: 阶段章末结算屏
local function renderScreen05()
    drawHeaderHUD("【阶段结算】· 第 " .. tostring(gameState.currentChapter) .. " 章经营盘点")

    local res = gameState.settleResult or {}
    drawText(30, 110, "本阶段结算回报:", 22, 244, 114, 182, 255)

    local infoStr = string.format("自然涨粉: +%d  |  直播收入: +￥%d  |  热度自然衰减: -%d",
        res.netFans or 0, res.netWallet or 0, res.decay or 0)
    drawText(30, 145, infoStr, 18, 241, 245, 249, 255)

    -- 粉丝构成漂移展示
    drawText(30, 190, "粉丝受众构成比例 (根据排班与属性漂移):", 18, 250, 204, 21, 255)
    local segStr = string.format("颜粉 %d%% | 声控 %d%% | 技术 %d%% | 乐子人 %d%% | 大哥 %d%% | 学生 %d%%",
        gameState.fanComposition["颜粉"] or 0,
        gameState.fanComposition["声控粉"] or 0,
        gameState.fanComposition["技术粉"] or 0,
        gameState.fanComposition["乐子人"] or 0,
        gameState.fanComposition["大哥"] or 0,
        gameState.fanComposition["学生粉"] or 0
    )
    drawText(30, 220, segStr, 16, 203, 213, 225, 255)

    -- 闸门判定
    local isPassed = res.gatePassed
    local target = res.targetFans or 1000
    local gateMsg = string.format("本章晋升闸门: %d 粉丝 (当前已达: %d 粉丝)", target, gameState.fiveDim.fans)
    drawText(30, 270, gateMsg, 18, 255, 255, 255, 255)

    if isPassed then
        drawText(30, 305, "✓ 恭喜！顺利跨过章节晋升闸门，开启下一章进阶之路！", 20, 16, 185, 129, 255)
        if gameState.currentChapter < 6 then
            drawButton("btn_next_chapter", 40, 430, 460, 52, "进入第 " .. tostring(gameState.currentChapter + 1) .. " 章排班", nvgRGBA(236, 72, 153, 255), nvgRGBA(255, 255, 255, 255), function()
                if gameState.practiceBuff and (gameState.practiceBuff.targetChapter or 0) <= gameState.currentChapter then
                    gameState.practiceBuff = nil
                end
                gameState.currentChapter = gameState.currentChapter + 1
                gameState.chapterFansGained = 0
                gameState.overtimeActive = false
                gameState.screen = "Screen-02"
            end)
        else
            -- 第六章通关
            drawButton("btn_final_clear", 40, 430, 460, 52, "完成第六章 · 前往顶流终局加冕！", nvgRGBA(16, 185, 129, 255), nvgRGBA(255, 255, 255, 255), function()
                gameState.isCleared = true
                gameState.screen = "Screen-07"
            end)
        end
    else
        -- Y2 闸门真拦截: 严禁无条件放行进下一章！
        if res.canOvertime then
            drawText(30, 305, "⚠ 粉丝尚未达标！触发【加时赛】：补播 3 卡最后冲刺！", 20, 245, 158, 11, 255)
            drawButton("btn_start_overtime", 40, 430, 460, 52, "进入加时赛 (补播 3 张冲刺卡)", nvgRGBA(245, 158, 11, 255), nvgRGBA(255, 255, 255, 255), function()
                gameState.overtimeActive = true
                drawChapterCards(gameState.currentChapter, 3)
                gameState.screen = "Screen-03"
            end)
        else
            -- 加时赛失败后体面收官 (M04 / M12)
            local endId = gameState.triggeredEnding or "M12"
            drawText(30, 305, "⚠ 加时赛结束仍未达成指标，从容收官！达成结局: " .. endId, 20, 239, 68, 68, 255)
            drawButton("btn_overtime_fail", 40, 430, 460, 52, "体面收官 · 查看结局 (" .. endId .. ")", nvgRGBA(100, 116, 139, 255), nvgRGBA(255, 255, 255, 255), function()
                gameState.screen = "Screen-07"
            end)
        end
    end
end

-- Screen-06: 中途暴毙结算页
local function renderScreen06()
    drawHeaderHUD("【暴毙结算】· 意外终局")

    local eid = gameState.triggeredEnding or "D01"
    drawText(30, 120, "主播生涯意外中断！达成暴毙结局: " .. eid, 22, 239, 68, 68, 255)

    -- 结局详情
    local endInfo = nil
    for _, e in ipairs(endingsData.endings or {}) do
        if e.ending_id == eid then endInfo = e break end
    end
    local title = endInfo and (endInfo.name or endInfo.original_name or endInfo.title) or "暴毙结局"
    local desc = endInfo and (endInfo.life_quote or endInfo.settlement_copy or endInfo.summary_quote) or "直播途中遭遇重大突发事故，遗憾告别星播舞台。"

    drawText(30, 160, "结局名称: " .. title, 20, 255, 255, 255, 255)
    drawText(30, 195, "判词: " .. desc, 16, 203, 213, 225, 255)

    -- 广告复活按钮 (单局仅限 1 次回滚快照)
    if gameState.adUsage.reviveOrRepick < 1 and gameState.snapshot then
        drawButton("btn_revive_ad", 40, 270, 460, 48, "看广告复活回滚 (仅限1次 · 零残留重新做人)", nvgRGBA(16, 185, 129, 255), nvgRGBA(255, 255, 255, 255), function()
            gameState.adUsage.reviveOrRepick = gameState.adUsage.reviveOrRepick + 1
            rollbackSnapshot()
        end)
    end

    drawButton("btn_view_share_card", 40, 340, 460, 48, "查看结局分享卡", nvgRGBA(59, 130, 246, 255), nvgRGBA(255, 255, 255, 255), function()
        gameState.screen = "Screen-08"
    end)

    drawButton("btn_restart_game", 40, 410, 460, 48, "收下教训 · 重摆一个摊 (再来一局)", nvgRGBA(71, 85, 105, 255), nvgRGBA(255, 255, 255, 255), function()
        resetGameState()
    end)
end

-- Screen-07: 终局加冕结算页
local function renderScreen07()
    drawHeaderHUD("【顶流加冕】· 六章通关大圆满")

    local eid = gameState.triggeredEnding or "M01"
    drawText(30, 120, "历经六章商海浮沉，成功通关并登顶！", 24, 250, 204, 21, 255)

    local endInfo = nil
    for _, e in ipairs(endingsData.endings or {}) do
        if e.ending_id == eid then endInfo = e break end
    end
    local title = endInfo and (endInfo.name or endInfo.original_name or endInfo.title) or "顶流之夜"
    drawText(30, 165, "达成主线终局: " .. eid .. " · " .. title, 20, 255, 255, 255, 255)

    local statSummary = string.format("最终粉丝: %d | 总入账: ￥%d | 终盘口碑: %d",
        gameState.fiveDim.fans,
        tonumber(gameState.variables["Total_Income"]) or gameState.fiveDim.wallet,
        gameState.fiveDim.rep
    )
    drawText(30, 205, statSummary, 17, 203, 213, 225, 255)

    drawButton("btn_share_card_clear", 40, 290, 460, 48, "查看专属结局卡与前世天赋", nvgRGBA(236, 72, 153, 255), nvgRGBA(255, 255, 255, 255), function()
        gameState.screen = "Screen-08"
    end)

    drawButton("btn_gallery_clear", 40, 360, 460, 48, "前往 50 格结局图鉴陈列室", nvgRGBA(59, 130, 246, 255), nvgRGBA(255, 255, 255, 255), function()
        gameState.screen = "Screen-09"
    end)
end

-- Screen-08: 结局分享卡弹窗 (独立成行 · 勘误 P4-4)
local function renderScreen08()
    drawHeaderHUD("【结局分享卡】")

    local eid = gameState.triggeredEnding or "M01"
    local endInfo = nil
    for _, e in ipairs(endingsData.endings or {}) do
        if e.ending_id == eid then endInfo = e break end
    end

    local cardX, cardY, cardW, cardH = 30, 110, windowWidth - 60, 420
    nvgBeginPath(nvgContext)
    nvgRoundedRect(nvgContext, cardX, cardY, cardW, cardH, 16)
    nvgFillColor(nvgContext, nvgRGBA(24, 30, 50, 255))
    nvgFill(nvgContext)

    drawText(cardX + 25, cardY + 25, "星播年度风云人物证书", 24, 250, 204, 21, 255)
    drawText(cardX + 25, cardY + 65, "主角: " .. gameState.playerName .. "  |  结局编号: " .. eid, 18, 203, 213, 225, 255)
    drawText(cardX + 25, cardY + 105, "《" .. (endInfo and (endInfo.name or endInfo.original_name or endInfo.title) or "传奇主播") .. "》", 22, 255, 255, 255, 255)

    local q = endInfo and (endInfo.life_quote or endInfo.settlement_copy or endInfo.summary_quote) or "从零粉开播一路拼搏，在星播写就属于自己的主播传奇。"
    drawText(cardX + 25, cardY + 145, q:sub(1, 48), 16, 148, 163, 184, 255)
    if #q > 48 then drawText(cardX + 25, cardY + 170, q:sub(49, 96), 16, 148, 163, 184, 255) end

    -- 天赋传承卡
    local talent = nil
    for _, t in ipairs(endingsData.talents or {}) do
        if t.talent_id == eid then talent = t break end
    end
    if talent then
        drawText(cardX + 25, cardY + 225, "【前世天赋已继承】: " .. (talent.title or eid), 18, 16, 185, 129, 255)
        drawText(cardX + 25, cardY + 255, "效果: " .. (talent.description or "下一局开局可携带生效"), 15, 203, 213, 225, 255)
    end

    drawButton("btn_save_and_gallery", 40, 560, 460, 48, "收录入图鉴 · 查看全部结局", nvgRGBA(236, 72, 153, 255), nvgRGBA(255, 255, 255, 255), function()
        unlockEnding(eid)
        gameState.screen = "Screen-09"
    end)

    drawButton("btn_play_again", 40, 625, 460, 48, "继承天赋 · 开启新一世轮回", nvgRGBA(59, 130, 246, 255), nvgRGBA(255, 255, 255, 255), function()
        unlockEnding(eid)
        resetGameState()
    end)
end

-- Screen-09: 50 格结局图鉴与天赋陈列室
local function renderScreen09()
    drawHeaderHUD("【50 格结局图鉴与前世天赋】")

    local unlockedCount = #(localSave.unlocked_endings or {})
    local rate = math.floor((unlockedCount / 50) * 100)
    local summaryStr = string.format("结局全收集率: %d / 50 (%d%%)", unlockedCount, rate)
    drawText(30, 105, summaryStr, 20, 250, 204, 21, 255)

    -- 分类筛选 Tab 按钮
    local tabs = {
        { id = "all", name = "全部 (50)" },
        { id = "main", name = "主线 (12)" },
        { id = "death", name = "暴毙 (26)" },
        { id = "hidden", name = "彩蛋 (12)" }
    }
    local tx = 30
    for _, t in ipairs(tabs) do
        local isSel = (gameState.galleryTab == t.id)
        local bg = isSel and nvgRGBA(236, 72, 153, 255) or nvgRGBA(30, 41, 59, 255)
        drawButton("tab_" .. t.id, tx, 135, 110, 32, t.name, bg, nvgRGBA(255, 255, 255, 255), function()
            gameState.galleryTab = t.id
        end)
        tx = tx + 120
    end

    -- 结局网格展示 (显示前 15 个，简单整洁)
    local allE = endingsData.endings or {}
    local filtered = {}
    for _, e in ipairs(allE) do
        local kind = e.ending_id:sub(1, 1)
        if gameState.galleryTab == "all" then
            table.insert(filtered, e)
        elseif gameState.galleryTab == "main" and kind == "M" then
            table.insert(filtered, e)
        elseif gameState.galleryTab == "death" and kind == "D" then
            table.insert(filtered, e)
        elseif gameState.galleryTab == "hidden" and kind == "H" then
            table.insert(filtered, e)
        end
    end

    local gx = 30
    local gy = 185
    for i = 1, math.min(14, #filtered) do
        local item = filtered[i]
        local isUnlocked = false
        for _, u in ipairs(localSave.unlocked_endings or {}) do
            if u == item.ending_id then isUnlocked = true break end
        end

        nvgBeginPath(nvgContext)
        nvgRoundedRect(nvgContext, gx, gy, 230, 52, 6)
        nvgFillColor(nvgContext, isUnlocked and nvgRGBA(30, 58, 138, 255) or nvgRGBA(30, 41, 59, 200))
        nvgFill(nvgContext)

        if isUnlocked then
            drawText(gx + 10, gy + 8, item.ending_id .. ": " .. (item.name or item.original_name or item.title or "未知结局"), 16, 255, 255, 255, 255)
            drawText(gx + 10, gy + 28, "已解锁 · 天赋可用", 14, 16, 185, 129, 255)
        else
            drawText(gx + 10, gy + 8, item.ending_id .. ": ？？？", 16, 148, 163, 184, 255)
            drawText(gx + 10, gy + 28, "未达成 (探索解锁)", 14, 100, 116, 139, 255)
        end

        if i % 2 == 1 then
            gx = gx + 250
        else
            gx = 30
            gy = gy + 62
        end
    end

    -- 底部重摆摊位按钮
    drawButton("btn_start_new_run", 40, 680, 460, 52, "重摆一个摊 · 开启全新生涯", nvgRGBA(236, 72, 153, 255), nvgRGBA(255, 255, 255, 255), function()
        resetGameState()
    end)
end

-- ============================================================================
-- 10. UrhoX 引擎生命周期与帧驱动
-- ============================================================================
function Start()
    print("[ZHUBO] Starting 《从小主播到顶流》 Maker Playable Build...")

    -- 加载 4 份结构化数据
    cardsData = loadJson("cards.json")
    configData = loadJson("config_and_screens.json")
    endingsData = loadJson("endings_and_talents.json")
    stateDict = loadJson("state_dictionary.json")
    loadSave()

    resetGameState()

    -- 创建 NanoVG 上下文
    nvgContext = nvgCreate(1)
    if nvgContext ~= nil then
        -- 尝试挂载系统通用中文字体
        fontId = nvgCreateFont(nvgContext, "msyh", "C:/Windows/Fonts/msyh.ttc")
        if fontId == -1 then
            fontId = nvgCreateFont(nvgContext, "simhei", "C:/Windows/Fonts/simhei.ttf")
        end
        print("[ZHUBO] NanoVG initialized, fontId=" .. tostring(fontId))
        SubscribeToEvent(nvgContext, "NanoVGRender", "HandleRender")
    else
        print("[ERROR] Failed to create NanoVG context!")
    end

    -- 初始化鼠标模式 (PC 平台桌面交互必须显示光标并设为自由模式)
    local inp = (GetInput and GetInput()) or input
    if inp then
        if inp.SetMouseVisible then
            inp:SetMouseVisible(true)
        else
            inp.mouseVisible = true
        end
        if MM_FREE then
            if inp.SetMouseMode then
                inp:SetMouseMode(MM_FREE)
            else
                inp.mouseMode = MM_FREE
            end
        end
    end

    SubscribeToEvent("MouseButtonDown", "HandleMouseButtonDown")
    SubscribeToEvent("TouchEnd", "HandleTouchEnd")
    SubscribeToEvent("Update", "HandleUpdate")
    print("[ZHUBO] Event listeners subscribed (MouseButtonDown + TouchEnd + Update).")
end

local lastClickFrame = -1
local lastClickX = -1
local lastClickY = -1
local currentEngineFrame = 0

function HandleUpdate(eventType, eventData)
    currentEngineFrame = currentEngineFrame + 1
    local dt = eventData["TimeStep"]:GetFloat()

    -- 时机条平滑扫条更新 (单向扫条 0 -> 1 -> 0)
    if gameState.timingInstance.active and not gameState.timingInstance.isResolved then
        local t = gameState.timingInstance
        t.cursorPos = t.cursorPos + t.cursorDir * t.cursorSpeed * dt
        if t.cursorPos >= 1.0 then
            t.cursorPos = 1.0
            t.cursorDir = -1
        elseif t.cursorPos <= 0.0 then
            t.cursorPos = 0.0
            t.cursorDir = 1
        end
    end
end

local function dispatchClick(x, y)
    -- 同一物理帧内近距离重复点击（如触屏同时派发 TouchEnd 与合成 MouseButtonDown）防抖
    if currentEngineFrame == lastClickFrame and math.abs(x - lastClickX) < 10 and math.abs(y - lastClickY) < 10 then
        return false
    end
    lastClickFrame = currentEngineFrame
    lastClickX = x
    lastClickY = y
    return handleScreenClick(x, y)
end

function HandleMouseButtonDown(eventType, eventData)
    local button = eventData["Button"] and eventData["Button"]:GetInt()
    -- 仅响应主按键/左键（Urho3D: MOUSEB_LEFT 为 1 或 0；nil 代表通用点击）
    if button == nil or button == 1 or button == 0 or (MOUSEB_LEFT and button == MOUSEB_LEFT) then
        local x = eventData["X"] and eventData["X"]:GetInt()
        local y = eventData["Y"] and eventData["Y"]:GetInt()
        if not x or not y then
            local inp = (GetInput and GetInput()) or input
            if inp then
                local pos = inp:GetMousePosition()
                x = pos.x
                y = pos.y
            end
        end
        x = x or 0
        y = y or 0
        dispatchClick(x, y)
    end
end

function HandleTouchEnd(eventType, eventData)
    local x = eventData["X"] and eventData["X"]:GetInt() or 0
    local y = eventData["Y"] and eventData["Y"]:GetInt() or 0

    dispatchClick(x, y)
end

function HandleRender(eventType, eventData)
    if nvgContext == nil then return end
    clearButtons()

    local graphics = GetGraphics()
    windowWidth = graphics:GetWidth()
    windowHeight = graphics:GetHeight()

    nvgBeginFrame(nvgContext, windowWidth, windowHeight, 1.0)

    -- 全局粉紫暗色底色
    nvgBeginPath(nvgContext)
    nvgRect(nvgContext, 0, 0, windowWidth, windowHeight)
    nvgFillColor(nvgContext, nvgRGBA(15, 17, 26, 255))
    nvgFill(nvgContext)

    -- 分屏路由渲染
    local scr = gameState.screen
    if scr == "Screen-01" then
        renderScreen01()
    elseif scr == "Screen-02" then
        renderScreen02()
    elseif scr == "Screen-03" then
        renderScreen03()
    elseif scr == "Screen-04" then
        renderScreen04()
    elseif scr == "Ops-B" then
        renderOpsB()
    elseif scr == "Screen-05" then
        renderScreen05()
    elseif scr == "Screen-06" then
        renderScreen06()
    elseif scr == "Screen-07" then
        renderScreen07()
    elseif scr == "Screen-08" then
        renderScreen08()
    elseif scr == "Screen-09" then
        renderScreen09()
    end

    nvgEndFrame(nvgContext)
end

-- 导出全局环境供模块与自动化测试使用
_G.gameState = gameState
_G.localSave = localSave
_G.handleScreenClick = handleScreenClick
_G.clickButtonById = clickButtonById
_G.getClickableButtons = getClickableButtons
_G.HandleRender = HandleRender
_G.HandleUpdate = HandleUpdate
_G.HandleMouseButtonDown = HandleMouseButtonDown
_G.HandleTouchEnd = HandleTouchEnd
_G.clickableButtons = clickableButtons

