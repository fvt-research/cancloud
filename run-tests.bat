@echo off
REM Run the CANcloud vitest test suite.
REM   run-tests.bat            - run everything
REM   run-tests.bat objects    - run only suites matching "objects"
REM Requires node >= 20 (see package.json engines).
npx vitest run %*
