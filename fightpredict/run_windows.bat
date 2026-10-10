@echo off
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
    py -3.12 -m venv .venv
    if errorlevel 1 (
        py -3.13 -m venv .venv
        if errorlevel 1 (
            echo Install Python 3.12 or 3.13 and try again.
            pause
            exit /b 1
        )
    )
)
.venv\Scripts\python.exe -c "import sklearn; assert sklearn.__version__ == '1.8.0'; import pandas,numpy,matplotlib,joblib" >nul 2>&1
if errorlevel 1 (
    .venv\Scripts\python.exe -m pip install -r requirements.txt
    if errorlevel 1 (
        echo Dependencies could not be installed. Check your internet connection.
        pause
        exit /b 1
    )
)
echo Open http://127.0.0.1:8000 in your browser after the server starts.
.venv\Scripts\python.exe app.py
pause
