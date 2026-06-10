import sys
import os
from pathlib import Path

# Forward to the latest run script
latest_run_script = Path(__file__).parent / "final_runs/run_1/final_script.py"
if latest_run_script.exists():
    os.execv(sys.executable, [sys.executable, str(latest_run_script)])
else:
    print(f"Error: run_1 final_script.py not found at {latest_run_script}")
    sys.exit(1)
