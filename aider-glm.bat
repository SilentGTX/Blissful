@echo off
rem === Aider + local GLM-5.2 (Colibri) launcher ===
rem Usage: double-click (starts in this folder)
rem        or: aider-glm.bat D:\path\to\project

if not "%~1"=="" cd /d "%~1"

set OPENAI_API_BASE=http://127.0.0.1:8000/v1
set OPENAI_API_KEY=local-secret

echo.
echo  Aider + GLM-5.2 local  --  project: %CD%
echo  (server must be running; each reply takes minutes at local speeds)
echo.

aider --model openai/glm-5.2-colibri --edit-format whole --map-tokens 0 --timeout 3600 --no-check-update --no-show-model-warnings --no-analytics
