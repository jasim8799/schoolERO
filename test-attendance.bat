@echo off
echo.
echo ========================================
echo PHASE-4B: Subject Attendance Upsert Test
echo ========================================
echo.
echo Waiting for Render deployment to complete...
echo This may take 2-3 minutes after git push.
echo.
timeout /t 30 /nobreak
echo.
echo Testing backend availability...
curl -s https://schoolero.onrender.com/api/health
echo.
echo.
echo If you see a 404 or connection error above, wait another minute.
echo Then run these PowerShell commands ONE BY ONE:
echo.
echo ========================================
echo COMMANDS TO RUN:
echo ========================================
echo.
echo # Step 1: Login
echo $baseUrl = "https://schoolero.onrender.com"
echo $loginBody = @{ email = "phase2operator@greenwood.edu"; password = "operator123" } ^| ConvertTo-Json
echo $r = Invoke-RestMethod -Uri "$baseUrl/api/auth/login" -Method POST -Body $loginBody -ContentType "application/json"
echo $token = $r.data.token
echo $h = @{ "Authorization" = "Bearer $token"; "Content-Type" = "application/json" }
echo Write-Host "Logged in as: $($r.data.user.name)"
echo.
echo # Step 2: First submission (should create 2 new records)
echo $body1 = @{ records = @( @{ studentId = "6964e888189411599a6e452f"; subjectId = "6964e87b189411599a6e450b"; classId = "6964e856189411599a6e44eb"; date = "2026-01-12"; period = "Period-1"; status = "PRESENT" }, @{ studentId = "6964e889189411599a6e4533"; subjectId = "6964e87b189411599a6e450b"; classId = "6964e856189411599a6e44eb"; date = "2026-01-12"; period = "Period-1"; status = "ABSENT" } ) } ^| ConvertTo-Json -Depth 10
echo $r1 = Invoke-RestMethod -Uri "$baseUrl/api/attendance/students/subject" -Method POST -Body $body1 -Headers $h
echo Write-Host "First submission - Upserted: $($r1.data.upserted), Modified: $($r1.data.modified)" -ForegroundColor Green
echo.
echo # Step 3: Second submission with same data (should update, not duplicate)
echo $body2 = @{ records = @( @{ studentId = "6964e888189411599a6e452f"; subjectId = "6964e87b189411599a6e450b"; classId = "6964e856189411599a6e44eb"; date = "2026-01-12"; period = "Period-1"; status = "ABSENT" }, @{ studentId = "6964e889189411599a6e4533"; subjectId = "6964e87b189411599a6e450b"; classId = "6964e856189411599a6e44eb"; date = "2026-01-12"; period = "Period-1"; status = "ABSENT" } ) } ^| ConvertTo-Json -Depth 10
echo $r2 = Invoke-RestMethod -Uri "$baseUrl/api/attendance/students/subject" -Method POST -Body $body2 -Headers $h
echo Write-Host "Second submission - Upserted: $($r2.data.upserted), Modified: $($r2.data.modified)" -ForegroundColor Cyan
echo if ($r2.data.modified -eq 2 -and $r2.data.upserted -eq 0) { Write-Host "SUCCESS: Upsert working! No duplicates created." -ForegroundColor Green } else { Write-Host "WARNING: Check response" -ForegroundColor Yellow }
echo.
echo ========================================
pause
