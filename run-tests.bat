@echo off
REM Run the CANcloud Jest test suite.
REM   run-tests.bat            - run everything
REM   run-tests.bat objects    - run only suites matching "objects"
REM --runInBand (serial) is required: parallel jest workers on the old
REM jest 23 / node 16 stack contend and can emit empty output.
call nvm use 16.16.0 >nul 2>&1
set "PATH=%NVM_HOME%\v16.16.0;%PATH%"
npx jest --runInBand %*
