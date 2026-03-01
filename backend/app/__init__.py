from dotenv import load_dotenv
from pathlib import Path

env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path)

import sys
from pathlib import Path

backend_dir = Path(__file__).parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

parent_app_path = backend_dir / "app.py"
if parent_app_path.exists():
    import importlib.util
    spec = importlib.util.spec_from_file_location("_app_module", parent_app_path)
    _app_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(_app_module)
    app = _app_module.app
else:
    raise ImportError("app.py not found in backend directory")

__all__ = ["app"]
