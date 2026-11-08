-- 全量意图表机械审计（检查点1证据工具，跑真实施工匹配器 intent_matcher.lua）
-- 用法：UrhoXRuntime.exe audit_intents.lua -tapcode_dir=. -tool_mode -graphicsheadless -validate -validate-frames=5
-- 产出：E:/taptap/zhubo/rebuild/cp1/intent_audit.json

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
    error("audit: file not found: " .. table.concat(candidates, " | "))
end

local cardsRaw = readFirst({ "../data/cards.json", "assets/data/cards.json", "E:/taptap/zhubo/data/cards.json" })
local cards = cjson.decode(cardsRaw)
if cards.cards then cards = cards.cards end
local intentsRaw = readFirst({ "assets/data/intents_full.json", "E:/taptap/zhubo/maker/assets/data/intents_full.json" })
local intentsDoc = cjson.decode(intentsRaw)
local matcherSrc = readFirst({ "scripts/intent_matcher.lua", "E:/taptap/zhubo/maker/scripts/intent_matcher.lua" })
local matcher = assert(load(matcherSrc, "@intent_matcher.lua"))()
matcher.configure(intentsDoc.matcher)

local failures = {}
local function fail(msg) table.insert(failures, msg) end

local byId, cardSet = {}, {}
for _, c in ipairs(cards) do cardSet[c.card_id] = c end
local seen = {}
for _, e in ipairs(intentsDoc.cards) do
    if seen[e.card_id] then fail("duplicate card_id " .. e.card_id) end
    seen[e.card_id] = true
    byId[e.card_id] = e
end
for id in pairs(cardSet) do if not byId[id] then fail("missing card " .. id) end end
for id in pairs(byId) do if not cardSet[id] then fail("extra card " .. id) end end

local nIntents, nOptions, nCovered, nSamples, nChips, nNeg = 0, 0, 0, 0, 0, 0
local uncovered = {}

for _, card in ipairs(cards) do
    local cid = card.card_id
    local e = byId[cid]
    if e then
        local opts = {}
        for _, o in ipairs(card.options) do opts[o.opt_key] = true end
        local script = e.script or {}
        if #script < 3 or #script > 6 then fail(cid .. " script lines=" .. #script) end
        for _, ln in ipairs(script) do
            local k = ln.kind
            if k ~= "comment" and k ~= "entry" and k ~= "follow" and k ~= "like" and k ~= "gift" and k ~= "hater" then
                fail(cid .. " bad script kind " .. tostring(k))
            end
            if not ln.name or not ln.text then fail(cid .. " script line missing name/text") end
        end
        local intents = e.intents or {}
        if #intents == 0 then fail(cid .. " no intents") end
        local covered, ids = {}, {}
        for _, it in ipairs(intents) do
            nIntents = nIntents + 1
            local iid = it.id or "?"
            if ids[iid] then fail(cid .. " duplicate intent id " .. iid) end
            ids[iid] = true
            if not opts[it.opt_key] then
                fail(cid .. " intent " .. iid .. " opt_key " .. tostring(it.opt_key) .. " not in options")
            else
                covered[it.opt_key] = true
            end
            if #(it.patterns or {}) < 4 then fail(cid .. " intent " .. iid .. " patterns<4") end
            local nr = #(it.reactions or {})
            if nr < 3 or nr > 4 then fail(cid .. " intent " .. iid .. " reactions=" .. nr) end
            if #(it.chips or {}) ~= 3 then fail(cid .. " intent " .. iid .. " chips!=3") end
            if #(it.samples or {}) < 2 then fail(cid .. " intent " .. iid .. " samples<2") end
            for _, s in ipairs(it.samples or {}) do
                nSamples = nSamples + 1
                local hit = matcher.match(intents, s)
                if hit ~= iid then fail(cid .. " intent " .. iid .. " sample [" .. s .. "] hit " .. tostring(hit)) end
            end
            for _, s in ipairs(it.chips or {}) do
                nChips = nChips + 1
                local hit = matcher.match(intents, s)
                if hit ~= iid then fail(cid .. " intent " .. iid .. " chip [" .. s .. "] hit " .. tostring(hit)) end
            end
            for _, other in ipairs(intents) do
                if other.id ~= iid then
                    local op = {}
                    for _, p in ipairs(other.patterns or {}) do op[p] = true end
                    for _, p in ipairs(it.patterns or {}) do
                        if op[p] then fail(cid .. " patterns overlap " .. iid .. "/" .. other.id .. ": " .. p) end
                    end
                end
            end
        end
        for k in pairs(opts) do
            nOptions = nOptions + 1
            if covered[k] then nCovered = nCovered + 1
            else table.insert(uncovered, cid .. ":" .. k) end
        end
        if #(e.miss_reactions or {}) < 2 then fail(cid .. " miss_reactions<2") end
        if #(e.negation_samples or {}) == 0 then fail(cid .. " no negation_samples") end
        for _, s in ipairs(e.negation_samples or {}) do
            nNeg = nNeg + 1
            local hit = matcher.match(intents, s)
            if hit then fail(cid .. " negation [" .. s .. "] hit " .. tostring(hit)) end
        end
    end
end

for _, u in ipairs(uncovered) do fail("uncovered option " .. u) end

local report = {
    test = "cp1 full intent-table mechanical audit (shipping Lua matcher)",
    audited_at = os.date("%Y-%m-%dT%H:%M:%S"),
    cards_total = #cards,
    cards_with_intents = #intentsDoc.cards,
    intents_total = nIntents,
    options_total = nOptions,
    options_covered = nCovered,
    coverage_pct = nOptions > 0 and math.floor(nCovered / nOptions * 10000) / 100 or 0,
    samples_tested = nSamples,
    chips_tested = nChips,
    negation_tested = nNeg,
    uncovered_options = uncovered,
    failures = failures,
    result = (#failures == 0) and "PASS" or "FAIL",
}
local encoded = cjson.encode(report)
local out = File("E:/taptap/zhubo/rebuild/cp1/intent_audit.json", FILE_WRITE)
if out:IsOpen() then
    out:WriteString(encoded)
    out:Flush()
    out:Close()
end
print("[AUDIT] cards=" .. #cards .. " intents=" .. nIntents .. " coverage=" .. nCovered .. "/" .. nOptions .. " samples=" .. nSamples .. " chips=" .. nChips .. " neg=" .. nNeg .. " failures=" .. #failures .. " " .. report.result)
for i = 1, math.min(#failures, 30) do print("[AUDIT_FAIL] " .. failures[i]) end

function Start()
end