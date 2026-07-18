@echo off
REM Updates the deployed LockIn server from your local project, then pushes to GitHub.
REM Render redeploys automatically once the push lands.
setlocal
set SRC=C:\Users\fljbr\Downloads\chess\lockin
set REPO=%~dp0

echo Syncing web UI...
node "%SRC%\sync-web.js" || goto :err

echo Copying server files...
copy /Y "%SRC%\server\server.js" "%REPO%server.js" >nul || goto :err
copy /Y "%SRC%\server\package.json" "%REPO%package.json" >nul || goto :err
if exist "%REPO%public" rmdir /S /Q "%REPO%public"
xcopy /E /I /Q /Y "%SRC%\server\public" "%REPO%public" >nul || goto :err

echo Committing and pushing...
cd /d "%REPO%"
git add -A
git diff --cached --quiet && echo Nothing changed. && goto :done
git commit -m "Update server" || goto :err
git push origin HEAD || goto :err

:done
echo.
echo DONE - Render will redeploy in about 2 minutes.
pause
exit /b 0

:err
echo.
echo FAILED - see the error above.
pause
exit /b 1
