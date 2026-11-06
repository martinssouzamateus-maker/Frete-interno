@echo off
cd /d "%~dp0"
if not exist .venv (
  echo Instalando o sistema pela primeira vez...
  python -m venv .venv
  .venv\Scripts\pip install -r requirements.txt
)
.venv\Scripts\python app.py
pause
