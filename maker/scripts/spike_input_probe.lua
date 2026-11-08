-- 呈现重做小样 · 文本输入链路探针（一次性，验通即弃）
-- 目的：实证 UrhoX 运行时在 Windows 桌面能否收到中文 IME 输入全链路
--   TextEditing(组合态) -> TextInput(上屏) -> 渲染上屏 -> Enter 发送
-- 只记录真实 OS 事件，绝不 SendEvent 合成输入冒充实测。

local cjson = require("cjson")

local nvgContext = nil
local fontId = -1

local focused = false
local sdlTextOn = false
local committed = ""
local composition = ""
local compCursor = 0
local lastSent = ""
local frameCount = 0
local blinkT = 0
local viewW, viewH, viewDpr = 540, 960, 1
local lastAState = false

local counters = { textInput = 0, textEditing = 0, keyDown = 0, charsCommitted = 0, sent = 0 }
local eventLog = {}
local logDirty = false

local LOG_PATH = "E:/taptap/zhubo/spike/input_probe_log.json"

local function utf8Len(s)
    local n = 0
    for i = 1, #s do
        local b = s:byte(i)
        if b < 0x80 or b >= 0xC0 then n = n + 1 end
    end
    return n
end

local function utf8Backspace(s)
    local i = #s
    while i > 0 and s:byte(i) >= 0x80 and s:byte(i) < 0xC0 do i = i - 1 end
    return s:sub(1, i - 1)
end

local function logEvent(kind, detail)
    local entry = {
        t = os.clock(),
        frame = frameCount,
        kind = kind,
        detail = detail or ""
    }
    table.insert(eventLog, entry)
    if #eventLog > 400 then table.remove(eventLog, 1) end
    logDirty = true
    print(string.format("[INPUT_PROBE] f=%d %s %s", frameCount, kind, tostring(detail or "")))
end

local function dumpLog()
    if not logDirty then return end
    logDirty = false
    local payload = {
        probe = "zhubo livestream spike input chain",
        started_at = os.date("%Y-%m-%dT%H:%M:%S"),
        counters = counters,
        committed_now = committed,
        composition_now = composition,
        last_sent = lastSent,
        events = eventLog
    }
    local ok, encoded = pcall(cjson.encode, payload)
    if not ok then return end
    local f = File(LOG_PATH, FILE_WRITE)
    if f:IsOpen() then
        f:WriteString(encoded)
        f:Flush()
        f:Close()
    end
end

local function setSdlText(on)
    sdlTextOn = on
    local inp = (GetInput and GetInput()) or input
    if inp and inp.SetScreenKeyboardVisible then
        inp:SetScreenKeyboardVisible(on)
    end
    logEvent(on and "SDL_TEXTINPUT_ON" or "SDL_TEXTINPUT_OFF")
end

local function setFocus(on)
    focused = on
    setSdlText(on)
    logEvent(on and "FOCUS_ON" or "FOCUS_OFF")
end

local function doSend()
    if utf8Len(composition) == 0 and #committed > 0 then
        lastSent = committed
        committed = ""
        counters.sent = counters.sent + 1
        logEvent("SEND", lastSent)
    else
        logEvent("SEND_BLOCKED", "compLen=" .. utf8Len(composition) .. " committedLen=" .. #committed)
    end
end

function Start()
    print("[INPUT_PROBE] Start")
    nvgContext = nvgCreate(1)
    if nvgContext then
        fontId = nvgCreateFont(nvgContext, "msyh", "C:/Windows/Fonts/msyh.ttc")
        if fontId == -1 then
            fontId = nvgCreateFont(nvgContext, "simhei", "C:/Windows/Fonts/simhei.ttf")
        end
        SubscribeToEvent(nvgContext, "NanoVGRender", "HandleRender")
    end

    local inp = (GetInput and GetInput()) or input
    if inp then
        if inp.SetMouseVisible then inp:SetMouseVisible(true) else inp.mouseVisible = true end
        if MM_FREE then
            if inp.SetMouseMode then inp:SetMouseMode(MM_FREE) else inp.mouseMode = MM_FREE end
        end
        local support = inp.GetScreenKeyboardSupport and inp:GetScreenKeyboardSupport()
        local graphics = GetGraphics()
        viewW = graphics:GetWidth() / graphics:GetDPR()
        viewH = graphics:GetHeight() / graphics:GetDPR()
        viewDpr = graphics:GetDPR()
        logEvent("INIT", "screenKeyboardSupport=" .. tostring(support) .. " hasFocus=" .. tostring(inp.HasFocus and inp:HasFocus())
            .. " phys=" .. graphics:GetWidth() .. "x" .. graphics:GetHeight() .. " dpr=" .. tostring(viewDpr))
        logEvent("KEY_CONSTS", "RETURN=" .. tostring(KEY_RETURN) .. " BACKSPACE=" .. tostring(KEY_BACKSPACE)
            .. " ESCAPE=" .. tostring(KEY_ESCAPE) .. " A=" .. tostring(KEY_A) .. " SPACE=" .. tostring(KEY_SPACE)
            .. " SHIFT=" .. tostring(KEY_SHIFT) .. " GetKeyPress=" .. tostring(inp.GetKeyPress) .. " GetKeyDown=" .. tostring(inp.GetKeyDown))
    end

    SubscribeToEvent("TextInput", "HandleTextInput")
    SubscribeToEvent("TextEditing", "HandleTextEditing")
    SubscribeToEvent("KeyDown", "HandleKeyDown")
    SubscribeToEvent("InputFocus", "HandleInputFocus")
    SubscribeToEvent("MouseButtonDown", "HandleMouseButtonDown")
    SubscribeToEvent("TouchEnd", "HandleTouchEnd")
    SubscribeToEvent("Update", "HandleUpdate")
    logEvent("READY", "click window to focus, then type with Chinese IME")
end

function HandleTextInput(eventType, eventData)
    local text = eventData:GetString("Text")
    counters.textInput = counters.textInput + 1
    counters.charsCommitted = counters.charsCommitted + utf8Len(text or "")
    if focused and text and #text > 0 then
        committed = committed .. text
    end
    logEvent("TextInput", text)
    dumpLog()
end

function HandleTextEditing(eventType, eventData)
    local comp = eventData:GetString("Composition")
    local cur = eventData:GetInt("Cursor")
    local sel = eventData:GetInt("SelectionLength")
    counters.textEditing = counters.textEditing + 1
    composition = comp or ""
    compCursor = cur or 0
    logEvent("TextEditing", "comp=" .. tostring(comp) .. " cursor=" .. tostring(cur) .. " sel=" .. tostring(sel))
end

function HandleKeyDown(eventType, eventData)
    local key = eventData:GetInt("Key")
    counters.keyDown = counters.keyDown + 1
    logEvent("KeyDown", "key=" .. tostring(key) .. " focused=" .. tostring(focused) .. " compLen=" .. tostring(utf8Len(composition)))
    if not focused then return end
    if key == KEY_BACKSPACE then
        if utf8Len(composition) == 0 then
            committed = utf8Backspace(committed)
            logEvent("EDIT", "backspace -> " .. committed)
        end
    elseif key == KEY_RETURN then
        doSend()
    elseif key == KEY_ESCAPE then
        setFocus(false)
    end
    dumpLog()
end

function HandleInputFocus(eventType, eventData)
    local has = eventData:GetBool("Focus")
    logEvent("InputFocus", "focus=" .. tostring(has))
    if not has and focused then setFocus(false) end
    dumpLog()
end

function HandleMouseButtonDown(eventType, eventData)
    local x = eventData:GetInt("X")
    local y = eventData:GetInt("Y")
    local lx, ly = x / viewDpr, y / viewDpr
    logEvent("MouseButtonDown", "phys=" .. tostring(x) .. "," .. tostring(y) .. " logical=" .. string.format("%.1f,%.1f", lx, ly))
    if ly >= 152 and ly <= 192 then
        if lx >= 20 and lx <= 120 then
            doSend()
            dumpLog()
            return
        elseif lx >= 132 and lx <= 352 then
            setSdlText(not sdlTextOn)
            dumpLog()
            return
        elseif lx >= 364 and lx <= 454 then
            setFocus(false)
            dumpLog()
            return
        end
    end
    if not focused then setFocus(true) end
    dumpLog()
end

function HandleTouchEnd(eventType, eventData)
    logEvent("TouchEnd")
    if not focused then setFocus(true) end
    dumpLog()
end

function HandleUpdate(eventType, eventData)
    frameCount = frameCount + 1
    blinkT = blinkT + eventData:GetFloat("TimeStep")
    local inp = (GetInput and GetInput()) or input
    if inp and inp.GetKeyPress then
        local probeKeys = { KEY_RETURN, KEY_BACKSPACE, KEY_ESCAPE, KEY_A, KEY_SPACE, KEY_SHIFT }
        for _, k in ipairs(probeKeys) do
            if inp:GetKeyPress(k) then
                counters.keyDown = counters.keyDown + 1
                logEvent("POLL_KEYPRESS", "key=" .. tostring(k) .. " focused=" .. tostring(focused) .. " sdlTextOn=" .. tostring(sdlTextOn))
                if focused then
                    if k == KEY_BACKSPACE and utf8Len(composition) == 0 then
                        committed = utf8Backspace(committed)
                        logEvent("EDIT", "backspace -> " .. committed)
                    elseif k == KEY_RETURN then
                        doSend()
                    elseif k == KEY_ESCAPE then
                        setFocus(false)
                    end
                end
            end
        end
    end
    if inp and inp.GetKeyDown and KEY_A then
        local down = inp:GetKeyDown(KEY_A)
        if down ~= lastAState then
            lastAState = down
            logEvent("POLL_KEYSTATE_A", tostring(down))
        end
    end
    if frameCount % 30 == 0 then dumpLog() end
end

local function drawText(x, y, text, size, r, g, b, a)
    if fontId == -1 then return end
    nvgFontFaceId(nvgContext, fontId)
    nvgFontSize(nvgContext, size or 20)
    nvgFillColor(nvgContext, nvgRGBA(r or 255, g or 255, b or 255, a or 255))
    nvgTextAlign(nvgContext, 1 + 8)
    nvgText(nvgContext, x, y, tostring(text), nil)
end

function HandleRender(eventType, eventData)
    if not nvgContext then return end
    local graphics = GetGraphics()
    local physW, physH = graphics:GetWidth(), graphics:GetHeight()
    local dpr = graphics:GetDPR()
    local w, h = physW / dpr, physH / dpr
    viewW, viewH, viewDpr = w, h, dpr
    nvgBeginFrame(nvgContext, w, h, dpr)

    nvgBeginPath(nvgContext)
    nvgRect(nvgContext, 0, 0, w, h)
    nvgFillColor(nvgContext, nvgRGBA(15, 17, 26, 255))
    nvgFill(nvgContext)

    drawText(20, 16, "文本输入链路探针 · 小样前置实证", 22, 255, 255, 255)
    drawText(20, 48, focused and "状态: 已聚焦 (SDL text input ON) — 直接切中文输入法打字" or "状态: 未聚焦 — 点击窗口任意处聚焦", 16, focused and 16 or 250, focused and 185 or 158, focused and 129 or 11)

    -- 输入框
    local bx, by, bw, bh = 20, 84, w - 40, 56
    nvgBeginPath(nvgContext)
    nvgRoundedRect(nvgContext, bx, by, bw, bh, 8)
    nvgFillColor(nvgContext, nvgRGBA(30, 35, 58, 255))
    nvgFill(nvgContext)
    nvgStrokeColor(nvgContext, focused and nvgRGBA(236, 72, 153, 255) or nvgRGBA(100, 116, 139, 255))
    nvgStrokeWidth(nvgContext, 2)
    nvgStroke(nvgContext)

    local showCommitted = committed
    if utf8Len(showCommitted) > 24 then showCommitted = "…" .. showCommitted:sub(-72) end
    drawText(bx + 12, by + 10, showCommitted, 20, 255, 255, 255)
    if #composition > 0 then
        local cw = nvgTextBounds and 0 or 0
        drawText(bx + 12, by + 32, "[" .. composition .. "] (组合态 cursor=" .. tostring(compCursor) .. ")", 14, 148, 163, 184)
    end
    if focused and (blinkT % 1.0) < 0.5 then
        drawText(bx + 12, by + 10, string.rep(" ", utf8Len(showCommitted)) .. "|", 20, 236, 72, 153)
    end

    -- 按钮行: 发送 / SDL文本输入开关 / 失焦
    local buttons = {
        { x = 20, w = 100, label = "发送", r = 16, g = 185, b = 129 },
        { x = 132, w = 220, label = sdlTextOn and "SDL文本输入: 开" or "SDL文本输入: 关", r = 59, g = 130, b = 246 },
        { x = 364, w = 90, label = "失焦", r = 100, g = 116, b = 139 },
    }
    for _, b in ipairs(buttons) do
        nvgBeginPath(nvgContext)
        nvgRoundedRect(nvgContext, b.x, 152, b.w, 40, 6)
        nvgFillColor(nvgContext, nvgRGBA(b.r, b.g, b.b, 255))
        nvgFill(nvgContext)
        drawText(b.x + 10, 162, b.label, 16, 255, 255, 255)
    end

    drawText(20, 208, "已发送: " .. (lastSent ~= "" and lastSent or "(无)"), 18, 16, 185, 129)
    drawText(20, 236, string.format("TextInput=%d  TextEditing=%d  KeyDown=%d  上屏字=%d  发送=%d",
        counters.textInput, counters.textEditing, counters.keyDown, counters.charsCommitted, counters.sent), 15, 203, 213, 225)

    drawText(20, 268, "事件日志(尾部):", 16, 244, 114, 182)
    local ly = 292
    local startIdx = math.max(1, #eventLog - 14)
    for i = startIdx, #eventLog do
        local e = eventLog[i]
        local line = string.format("f%d %s %s", e.frame, e.kind, e.detail)
        if #line > 62 then line = line:sub(1, 62) .. "…" end
        drawText(20, ly, line, 13, 148, 163, 184)
        ly = ly + 18
    end

    drawText(20, h - 52, "操作: 点击聚焦 → 微软拼音打字 → 观察组合态/上屏 → Enter或[发送] → Esc/[失焦]", 14, 100, 116, 139)
    drawText(20, h - 30, "日志落盘: zhubo/spike/input_probe_log.json (每事件即写)", 13, 100, 116, 139)

    nvgEndFrame(nvgContext)
end