-- CP4 前置修正 · C4/C5 翻样计数去重命名测试（Orange 5d672f2 裁定，店主 2026-11-09 确认第三例口径）
-- 裁定：内嵌翻样只决定落哪一支选项、不直接写计数；计数由选项写入唯一落（两卡同例）。
-- 命名三例：
--   ① C4 全程后计数 ==1（命中落 B，B 写 Count+1 & Flag_选品减伤=1，无叠加）
--   ② C5 带 1 入场成功后 ==2 且逃逸路通（命中落 A，check Count>=1 过→A 写 +=1→2；M02 逃逸门开）
--   ③ C5 带 0 入场命中 → D12 暴毙、计数 ==0、不得逃逸
--      （口径经店主/Orange 确认按冻结卡面：C5-M07 A check_expr Count>=1 / check_fail D12，引擎 check 先于 write，
--       卡面 outcome 原文「0进D12」；裁定原文「==1」与冻结门冲突，更正为 D12/计数0。去重本体不动。）
-- 跑法：UrhoXRuntime.exe cp4_dedupe_test.lua -tapcode_dir=. -tool_mode -graphicsheadless -validate -validate-frames=30 ...
-- 产出：E:/taptap/zhubo/rebuild/cp4/dedupe_test.json

local f = File("scripts/live_rebuild.lua", FILE_READ)
if not f:IsOpen() then f = File("E:/taptap/zhubo/maker/scripts/live_rebuild.lua", FILE_READ) end
assert(f:IsOpen(), "dedupe test: live_rebuild.lua not found")
local src = f:ReadString()
f:Close()

local extra = [[
;local __origStart = Start
LOG_PATH = "E:/taptap/zhubo/rebuild/cp4/dedupe_playthrough_log.json"
local __A = {}
local function __assert(name, ok, detail)
    table.insert(__A, { name = name, pass = ok and true or false, detail = detail })
end
local function __cardById(id)
    for _, c in ipairs(engine.cardsData) do if c.card_id == id then return c end end
    return nil
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
local function __hitFake()
    local fake = GS.inspectInstance.fakeIndex
    local sx, sy = inspectRect(fake)
    handleClick(sx + 10, sy + 10)
end
local function __missTwo()
    local fake = GS.inspectInstance.fakeIndex
    local n = 0
    for i = 1, 4 do
        if i ~= fake and n < 2 then
            local sx, sy = inspectRect(i)
            handleClick(sx + 10, sy + 10)
            n = n + 1
        end
    end
end
local function __count() return tonumber(GS.variables["Count_验货命中"]) or 0 end
local function __flag() return tonumber(GS.variables["Flag_选品减伤"]) or 0 end

local function __runTests()
    -- ===== 命名例①：C4 全程后计数 ==1 =====
    engine.resetGameState()
    __fixtureLive("C4-M02")
    startEvent(1)
    __assert("n1_pre_inspect_active", inlineInspect ~= nil and GS.inspectInstance.active == true, { inline = inlineInspect })
    __hitFake()
    __assert("n1_count_is_1", __count() == 1, { count = __count(), note = "命中只决定落 B，计数由选项 B 唯一写入" })
    __assert("n1_flag_is_1", __flag() == 1, { flag = __flag(), note = "Flag_选品减伤 由选项 B 写" })
    __assert("n1_success_and_closed", GS.inspectInstance.success == true and GS.screen ~= "Screen-03", { success = GS.inspectInstance.success, screen = GS.screen, idx = GS.currentCardIndex })
    __assert("n1_no_double_write", __count() == 1, { count = __count(), note = "内嵌不再直写计数，旧叠加=2 缺陷已除" })

    -- ===== 命名例②：C5 带 1 入场成功后 ==2 且逃逸路通 =====
    engine.resetGameState()
    GS.variables["Count_验货命中"] = 1 -- 夹具：首验（C4）已成功记 1
    GS.variables["Flag_选品减伤"] = 1
    __fixtureLive("C5-M07")
    startEvent(1)
    __hitFake()
    __assert("n2_count_is_2", __count() == 2, { count = __count(), note = "命中落 A，check Count>=1 读入场1通过→A 写 +=1→2" })
    __assert("n2_not_dead_no_immediate_ending", GS.isDead == false and GS.triggeredEnding == nil, { dead = GS.isDead, ending = GS.triggeredEnding, note = "M 系不即时落（沿引擎既有口径），逃逸门开待结算" })
    __assert("n2_escape_gate_open", __count() >= 2 and __flag() == 1, { count = __count(), flag = __flag(), note = "M02 逃逸门条件满足：Count>=2 且 Flag_选品减伤=1" })
    -- 逃逸路通实证：第六章带货结算夹具 forcing 闸门通过 → 落 M02（沿 main.lua:976 选品减伤支）
    GS.currentChapter = 6
    GS.schedule.mode = "带货"
    GS.fiveDim.fans = 99999999 -- 夹具 forcing 第六章闸门（10M）通过，非玩法数值
    GS.variables["Tag_清白账本"] = 0 -- 夹具：排除 M01 先决支
    engine.settleCurrentChapter(false)
    __assert("n2_escape_lands_M02", GS.triggeredEnding == "M02" and GS.isCleared == true, { ending = GS.triggeredEnding, cleared = GS.isCleared, note = "逃逸路通实证：ch6 带货结算落 M02" })

    -- ===== 命名例③：C5 带 0 入场命中 → D12 暴毙、计数 ==0、不得逃逸（店主确认按冻结卡面）=====
    engine.resetGameState()
    GS.variables["Count_验货命中"] = 0 -- 夹具：无首验，带 0 入场
    __fixtureLive("C5-M07")
    startEvent(1)
    __hitFake()
    __assert("n3_d12_death", GS.triggeredEnding == "D12" and GS.isDead == true and GS.screen == "Screen-06", { ending = GS.triggeredEnding, dead = GS.isDead, screen = GS.screen, note = "命中落 A，check Count>=1 读入场0失败→check_fail D12（卡面原文 0进D12）" })
    __assert("n3_count_is_0", __count() == 0, { count = __count(), note = "检定失败拦写入，计数停 0；裁定原文 ==1 与冻结门冲突，经店主确认更正为 0" })
    __assert("n3_no_escape", GS.triggeredEnding ~= "M02" and __count() < 2, { ending = GS.triggeredEnding, count = __count(), note = "暴毙非逃逸，计数未达逃逸门" })

    -- ===== 支撑例：失手支落另一选项（两卡同例，计数不写）=====
    engine.resetGameState()
    __fixtureLive("C4-M02")
    startEvent(1)
    __missTwo()
    __assert("sup_c4_miss_lands_A", GS.inspectInstance.success == false and __count() == 0 and __flag() == 0 and tonumber(GS.variables["Flag_带货死雷"]) == 1, { success = GS.inspectInstance.success, count = __count(), flag = __flag(), deathLei = GS.variables["Flag_带货死雷"], note = "失手落 A（热+15% 记死雷），不写验货计数" })

    engine.resetGameState()
    GS.variables["Count_验货命中"] = 1
    __fixtureLive("C5-M07")
    startEvent(1)
    __missTwo()
    __assert("sup_c5_miss_lands_B_d12", GS.triggeredEnding == "D12" and GS.isDead == true and __count() == 1, { ending = GS.triggeredEnding, dead = GS.isDead, count = __count(), note = "失手落 B（甩锅进 D12），计数停入场1不增" })

    -- ===== 汇总导出 =====
    local pass, fail = 0, 0
    for _, a in ipairs(__A) do if a.pass then pass = pass + 1 else fail = fail + 1 end end
    local payload = {
        test = "cp4 pre-fix C4/C5 inspect count dedupe named tests (Orange 5d672f2 ruling)",
        pass = (fail == 0),
        total = #__A, passed = pass, failed = fail,
        assertions = __A,
        ruling = "内嵌翻样只决定落哪一支选项、不直接写计数；计数由选项写入唯一落（两卡同例）。命中支=卡面写 Count_验货命中 者（C4-M02:B/C5-M07:A），失手支=另一支，纯由冻结卡面推导。",
        test3_calibration = "店主/Orange 2026-11-09 确认：第三例按冻结卡面 D12/计数0/不得逃逸。C5-M07 A check_expr Count>=1（check_fail D12），引擎 check 先于 write（Lua/Node 同口径），带0入场命中→检定失败→D12、计数停0；卡面 outcome 原文 0进D12。裁定原文 ==1 与冻结门冲突，更正为 ==0/D12，去重本体不动。",
        fixtures_note = "入场计数 1/0、Flag_选品减伤、ch6 带货结算 fans=99999999/Tag_清白账本=0 均为测试夹具 forcing（非玩法数值改动）；逃逸路通以 ch6 结算落 M02 实证。",
        exported_at = os.date("%Y-%m-%dT%H:%M:%S"),
    }
    local ok, encoded = pcall(cjson.encode, payload)
    if ok then
        local out = File("E:/taptap/zhubo/rebuild/cp4/dedupe_test.json", FILE_WRITE)
        if out:IsOpen() then out:WriteString(encoded) out:Flush() out:Close() end
        print("[CP4_DEDUPE_SUMMARY] passed=" .. pass .. "/" .. #__A .. " failed=" .. fail)
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