-- 意图匹配器（全量重建检查点1交付，CP2/CP3 施工复用件）
-- 语义与 .tmp/intent_work/matcher_ref.py 逐条一致： intents 数组顺序首匹配；
-- pattern 任一干净出现即命中；出现点前 3 字（9 字节）窗口含否定词且不含例外词则该次出现作废。
-- UTF-8 安全性：否定/例外词都是完整 UTF-8 序列，续字节不含 lead byte，窗口截半字不会假命中。

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

local function containsAny(hay, words)
    for _, w in ipairs(words) do
        if string.find(hay, w, 1, true) then return true end
    end
    return false
end

local function occurrenceNegated(text, pos)
    local wstart = math.max(1, pos - M.config.negation_window_bytes)
    local window = string.sub(text, wstart, pos - 1)
    if containsAny(window, M.config.negation_exceptions) then return false end
    return containsAny(window, M.config.negation_words)
end

-- 返回 intent_id, matched_pattern；无命中返回 nil
function M.match(intents, text)
    if not intents or not text or #text == 0 then return nil end
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