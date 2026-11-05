function Start()
    print("[TEST_TIME] Start()")
    local t0 = Time:GetElapsedTime()
    local c0 = os.clock()
    print(string.format("[TEST_TIME] Time:GetElapsedTime()=%.6f, os.clock()=%.6f", t0, c0))
    local cnt = 0
    SubscribeToEvent("Update", function(eventType, eventData)
        cnt = cnt + 1
        if cnt <= 5 or cnt % 500 == 0 then
            print(string.format("[TEST_TIME] frame=%d elapsed=%.6f clock=%.6f dt=%.6f", cnt, Time:GetElapsedTime(), os.clock(), eventData:GetFloat("TimeStep")))
        end
        if cnt >= 2000 then
            engine:Exit()
        end
    end)
end
