-- CP3 meme 后置否定·子句级抑制试覆盖（build-order:2278 裁定）
-- 裁定口径：试覆盖一组 meme 句式样本；覆盖不了按已知限制出货；不许为它重构判定。
-- 本件不改逐出现 3 字近窗判定，仅在 intent_matcher.lua 加 memeClauseNegated 子句级前置闸。
-- 跑法：UrhoXRuntime.exe cp3_meme_test.lua -tapcode_dir=. -tool_mode -graphicsheadless -validate -validate-frames=5
-- 产出：rebuild/cp3/meme_test.json + rebuild/cp3/intent_audit.json（全套审计重跑，输出改指 cp3，磁盘 CP2 工具/证据不动）

local cjson = require("cjson")
local function readFirst(candidates)
    for _, p in ipairs(candidates) do
        local f = File(p, FILE_READ)
        if f:IsOpen() then
            local raw = f:ReadString()
            f:Close()
            if raw and #raw > 0 then return raw, p end
        end
    end
    error("meme test: file not found: " .. table.concat(candidates, " | "))
end

-- ===== Part A: 全套施工审计重跑（更新后的匹配器），输出改指 cp3 =====
local auditSrc = readFirst({ "scripts/audit_intents.lua", "E:/taptap/zhubo/maker/scripts/audit_intents.lua" })
auditSrc = auditSrc:gsub("rebuild/cp2/intent_audit.json", "rebuild/cp3/intent_audit.json")
assert(load(auditSrc, "@audit_intents.lua"))()
local auditReport = cjson.decode(readFirst({ "E:/taptap/zhubo/rebuild/cp3/intent_audit.json" }))

-- ===== Part B: meme 子句级抑制样本集（跑施工匹配器本体） =====
local matcherSrc = readFirst({ "scripts/intent_matcher.lua", "E:/taptap/zhubo/maker/scripts/intent_matcher.lua" })
local matcher = assert(load(matcherSrc, "@intent_matcher.lua"))()
local intentsDoc = cjson.decode(readFirst({ "assets/data/intents_full.json", "E:/taptap/zhubo/maker/assets/data/intents_full.json" }))
matcher.configure(intentsDoc.matcher)
local byId = {}
for _, c in ipairs(intentsDoc.cards) do byId[c.card_id] = c end

local function hitOpt(cardId, text)
    local e = byId[cardId]
    local id = e and matcher.match(e.intents, text) or nil
    if not id then return nil, "MISS" end
    for _, it in ipairs(e.intents) do if it.id == id then return it.opt_key, id end end
    return nil, id
end

local A = {}
local function assertCase(name, ok, detail) table.insert(A, { name = name, pass = ok and true or false, detail = detail }) end

-- 覆盖组：回声框架「X是不可能X的」，关键词均为真实 pattern，期望 MISS（子句抑制）
local covered = {
    { text = "整活是不可能整活的", card = "C1-M01", keyword = "整活" },
    { text = "抽象是不可能抽象的", card = "C1-M01", keyword = "抽象" },
    { text = "今天整活是不可能整活的", card = "C1-M01", keyword = "整活" },
    { text = "躺平是不可能躺平的", card = "C1-M10", keyword = "躺平" },
    { text = "摆烂是不可能摆烂的", card = "C1-M10", keyword = "摆烂" },
    { text = "内卷是不可能内卷的", card = "C1-M10", keyword = "内卷" },
    { text = "躺平是不可能再躺平的", card = "C1-M10", keyword = "躺平" },
}
for _, m in ipairs(covered) do
    local opt, id = hitOpt(m.card, m.text)
    assertCase("meme_covered " .. m.text, opt == nil, { card = m.card, keyword = m.keyword, hit_opt = opt or "MISS", hit_intent = id, expect = "MISS(子句抑制)" })
end

-- 对照组：正常意图仍须命中（证明未过抑）+ CP1/CP2 命名测试例保持绿
local controls = {
    { text = "忍不住想整活", card = "C1-M01", expect_opt = "C", note = "CP1 命名例·例外整词跨度" },
    { text = "我想整活", card = "C1-M01", expect_opt = "C", note = "正常整活仍命中" },
    { text = "躺平当树洞自娱自乐", card = "C1-M10", expect_opt = "A", note = "正常躺平仍命中" },
    { text = "我不想卷了想躺平", card = "C1-M10", expect_opt = "A", note = "CP1 命名例·否定最近关键词作用域" },
}
for _, c in ipairs(controls) do
    local opt, id = hitOpt(c.card, c.text)
    assertCase("control " .. c.text, opt == c.expect_opt, { card = c.card, hit_opt = opt or "MISS", hit_intent = id, expect_opt = c.expect_opt, note = c.note })
end

-- 已知限制组：如实记录实际行为，不计失败（按裁定「覆盖不了按已知限制出货」）
local limitations = {
    { text = "躺平是不可能再躺平了", card = "C1-M10", note = "了字尾无「的」，本闸不覆盖，回声否定仍误命中（假阳）" },
    { text = "整活是不可能整活的，还是唱歌吧", card = "C1-M01", note = "混合子句：meme 后接真实意图被整句抑制（过抑）" },
    { text = "整活这件事是绝对不可能去做的", card = "C1-M01", note = "非回声框架：否定远离关键词超出3字近窗，本闸不覆盖仍误命中（假阳）" },
}
local limResults = {}
for _, l in ipairs(limitations) do
    local opt, id = hitOpt(l.card, l.text)
    table.insert(limResults, { text = l.text, card = l.card, hit_opt = opt or "MISS", hit_intent = id, note = l.note, status = "known_limitation" })
end

local pass, fail = 0, 0
for _, a in ipairs(A) do if a.pass then pass = pass + 1 else fail = fail + 1 end end
local payload = {
    test = "cp3 meme clause-level suppression attempt (build-order:2278)",
    ruling = "试覆盖一组 meme 句式样本；覆盖不了按已知限制出货；不重构判定（逐出现3字近窗口径未动，仅加子句级前置闸）",
    pass = (fail == 0), total = #A, passed = pass, failed = fail,
    assertions = A,
    covered_frame = "X是不可能(继续/再/去/来)?X的（回声关键字，最长 UTF-8 字符边界匹配，需「的」收尾）",
    known_limitations = limResults,
    audit_summary = {
        result = auditReport.result,
        samples = auditReport.samples_tested, chips = auditReport.chips_tested, negation = auditReport.negation_tested,
        coverage = auditReport.options_covered .. "/" .. auditReport.options_total,
        named_cases = auditReport.named_cases,
        failures = #auditReport.failures,
    },
    exported_at = os.date("%Y-%m-%dT%H:%M:%S"),
}
local ok, encoded = pcall(cjson.encode, payload)
if ok then
    local out = File("E:/taptap/zhubo/rebuild/cp3/meme_test.json", FILE_WRITE)
    if out:IsOpen() then out:WriteString(encoded) out:Flush() out:Close() end
end
print("[CP3_MEME] passed=" .. pass .. "/" .. #A .. " failed=" .. fail .. " audit=" .. auditReport.result .. " samples=" .. auditReport.samples_tested .. " chips=" .. auditReport.chips_tested .. " neg=" .. auditReport.negation_tested)
for i = 1, #A do if not A[i].pass then print("[CP3_MEME_FAIL] " .. A[i].name) end end

function Start()
end