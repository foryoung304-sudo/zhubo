-- 意图匹配器（全量重建检查点1交付，CP2/CP3 施工复用件）
-- 语义与 .tmp/intent_work/matcher_ref.py 逐条一致： intents 数组顺序首匹配；
-- pattern 任一干净出现即命中；出现点前 3 字（9 字节）窗口内、未被例外词整词跨度覆盖的否定词使该次出现作废。
-- UTF-8 安全性：否定/例外词都是完整 UTF-8 序列，续字节不含 lead byte，窗口截半字不会假命中。
-- CP3 追加（build-order:2278）：memeClauseNegated 子句级前置闸，试覆盖「X是不可能X的」回声否定一组样本；
-- 逐出现 3 字近窗判定口径未动，覆盖不了者按已知限制出货（见 memeClauseNegated 注释）。

local M = {}

M.config = {
    negation_words = { "不要", "别", "没", "不", "不想", "不是", "并非", "拒绝", "算了", "甭" },
    negation_exceptions = { "忍不住", "禁不住", "不由得", "不得不", "巴不得" },
    negation_window_bytes = 9,
}

function M.configure(cfg)
    if not cfg then return end
    if cfg.negation_words then M.config.negation_words = cfg.negation_words end
    if cfg.negation_exceptions then M.config.negation_exceptions = cfg.negation_exceptions end
    if cfg.negation_window_chars then M.config.negation_window_bytes = cfg.negation_window_chars * 3 end
end

local function occurrenceNegated(text, pos)
    local wstart = math.max(1, pos - M.config.negation_window_bytes)
    local window = string.sub(text, wstart, pos - 1)
    -- 否定词某次出现若被例外词整词跨度覆盖（忍不住 里的 不），该次出现不算否定（Orange c2349a1 收窄）
    for _, n in ipairs(M.config.negation_words) do
        local s = 1
        while true do
            local q = string.find(window, n, s, true)
            if not q then break end
            local absQ = wstart + q - 1
            local regionStart = math.max(1, absQ - 6)
            local region = string.sub(text, regionStart, pos - 1)
            local covered = false
            for _, e in ipairs(M.config.negation_exceptions) do
                local es = 1
                while true do
                    local eq = string.find(region, e, es, true)
                    if not eq then break end
                    local absS = regionStart + eq - 1
                    if absS <= absQ and absQ + #n <= absS + #e then
                        covered = true
                        break
                    end
                    es = eq + #e
                end
                if covered then break end
            end
            if not covered then return true end
            s = q + #n
        end
    end
    return false
end

-- 子句级 meme 抑制（CP3 裁定 build-order:2278：试覆盖一组样本，不重构判定）
-- 回声式 rhetorical negation「X是不可能X的」/「X是不可能再X的」：整子句否定 X。
-- 仅作 M.match 前置闸（子句级），不动 occurrenceNegated 的 3 字近窗逐出现判定。
-- 已知限制（按裁定出货）：了字尾（无「的」）、混合子句（meme 后接真实意图会整句被抑）、
-- 非回声框架（否定远离关键词、超出 3 字近窗，如「X这件事是绝对不可能去做的」）不在本闸覆盖内。
local function memeClauseNegated(text)
    local marker = "是不可能"
    local s = 1
    while true do
        local i = string.find(text, marker, s, true)
        if not i then return false end
        local pre = string.sub(text, math.max(1, i - 18), i - 1) -- marker 前最多 6 字
        local after = string.sub(text, i + #marker)
        local dePos = string.find(after, "的", 1, true)
        if dePos then
            local post = string.sub(after, 1, dePos - 1)
            post = post:gsub("^继续", ""):gsub("^再", ""):gsub("^去", ""):gsub("^来", "")
            local L = math.min(#pre, #post)
            while L >= 3 do -- 关键词为完整 UTF-8（CJK 3 字节），按字符边界取最长回声
                if string.sub(pre, #pre - L + 1) == string.sub(post, 1, L) then
                    return true
                end
                L = L - 3
            end
        end
        s = i + #marker
    end
end

-- 返回 intent_id, matched_pattern；无命中返回 nil
function M.match(intents, text)
    if not intents or not text or #text == 0 then return nil end
    if memeClauseNegated(text) then return nil end
    for _, intent in ipairs(intents) do
        for _, pat in ipairs(intent.patterns) do
            local start = 1
            while true do
                local i = string.find(text, pat, start, true)
                if not i then break end
                if not occurrenceNegated(text, i) then
                    return intent.id, pat
                end
                start = i + #pat
            end
        end
    end
    return nil
end

return M