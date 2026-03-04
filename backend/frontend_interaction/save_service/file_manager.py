import os
import json
from pathlib import Path
from typing import Dict, Any, Optional

class FileManager:
    def __init__(self, base_dir: str = None):
        if base_dir is None:
            base_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), '..', '..', 'data', 'agenticflow')
        self.base_dir = Path(base_dir)
        self.ensure_saved_flows_dir()

    def ensure_saved_flows_dir(self) -> None:
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def get_flow_file_path(self, project_name: str) -> Path:
        safe_name = project_name.replace('/', '_').replace('\\', '_').replace(':', '_')
        return self.base_dir / f"{safe_name}.json"

    def save_flow_to_file(self, project_name: str, flow_data: Dict[str, Any]) -> None:
        file_path = self.get_flow_file_path(project_name)
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(flow_data, f, ensure_ascii=False, indent=2)

    def load_flow_from_file(self, project_name: str) -> Optional[Dict[str, Any]]:
        file_path = self.get_flow_file_path(project_name)
        if not file_path.exists():
            return None
        with open(file_path, 'r', encoding='utf-8') as f:
            return json.load(f)

    def delete_flow_file(self, project_name: str) -> bool:
        file_path = self.get_flow_file_path(project_name)
        if not file_path.exists():
            return False
        file_path.unlink()
        return True

    def list_all_flows(self) -> list[str]:
        flows = []
        for file_path in self.base_dir.glob('*.json'):
            flows.append(file_path.stem)
        return flows

    def flow_exists(self, project_name: str) -> bool:
        file_path = self.get_flow_file_path(project_name)
        return file_path.exists()
