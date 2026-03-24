# -*- coding: utf-8 -*-
"""项目导出/导入 API endpoints。"""

import json
import uuid
import zipfile
import io
import os
import logging
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, HTTPException, UploadFile, File, Response, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .auth import get_current_user
from ...core.database import UserModel as User
from ...core.data_paths import DataPaths

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/export", tags=["export"])


class ExportFormat(BaseModel):
    format: str = Field(default="json", description="导出格式: json, zip")
    include_history: bool = Field(default=False, description="是否包含执行历史")
    include_skills: bool = Field(default=True, description="是否包含 Skills 包")


class ExportMetadata(BaseModel):
    project_name: str
    version: str = "1.0.0"
    exported_at: str
    exported_by: Optional[str] = None
    soloengine_version: str = "1.0.0"


class ImportResult(BaseModel):
    success: bool
    project_name: str
    nodes_count: int
    edges_count: int
    message: str


def get_flows_dir() -> str:
    """获取流程存储目录。"""
    return os.path.join(os.path.dirname(__file__), "..", "..", "..", "flows")


@router.post("/project/{project_name}")
async def export_project(
    project_name: str,
    format: str = "json",
    include_history: bool = False,
    include_skills: bool = True,
    current_user: User = Depends(get_current_user)
):
    """导出项目。"""
    flows_dir = get_flows_dir()
    flow_file = os.path.join(flows_dir, f"{project_name}.json")

    if not os.path.exists(flow_file):
        raise HTTPException(status_code=404, detail=f"Project '{project_name}' not found")

    try:
        with open(flow_file, "r", encoding="utf-8") as f:
            flow_data = json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read project: {e}")

    metadata = ExportMetadata(
        project_name=project_name,
        exported_at=datetime.now().isoformat(),
        exported_by=current_user.username,
    )

    if format == "json":
        export_data = {
            "metadata": metadata.model_dump(),
            "flow": flow_data,
        }

        if include_skills:
            skills_dir = DataPaths.get_user_skills_dir(current_user.id)
            if os.path.exists(skills_dir):
                export_data["skills"] = []
                for skill_name in os.listdir(skills_dir):
                    skill_path = os.path.join(skills_dir, skill_name)
                    if os.path.isdir(skill_path):
                        skill_md = os.path.join(skill_path, "SKILL.md")
                        if os.path.exists(skill_md):
                            with open(skill_md, "r", encoding="utf-8") as f:
                                export_data["skills"].append({
                                    "name": skill_name,
                                    "content": f.read(),
                                })

        return Response(
            content=json.dumps(export_data, indent=2, ensure_ascii=False),
            media_type="application/json",
            headers={
                "Content-Disposition": f"attachment; filename={project_name}.json"
            },
        )

    elif format == "zip":
        zip_buffer = io.BytesIO()

        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("metadata.json", json.dumps(metadata.model_dump(), indent=2))
            zf.writestr("flow.json", json.dumps(flow_data, indent=2, ensure_ascii=False))

            if include_skills:
                skills_dir = DataPaths.get_user_skills_dir(current_user.id)
                if os.path.exists(skills_dir):
                    for skill_name in os.listdir(skills_dir):
                        skill_path = os.path.join(skills_dir, skill_name)
                        if os.path.isdir(skill_path):
                            for root, dirs, files in os.walk(skill_path):
                                for file in files:
                                    file_path = os.path.join(root, file)
                                    arc_name = os.path.join(
                                        "skills",
                                        os.path.relpath(file_path, skills_dir)
                                    )
                                    zf.write(file_path, arc_name)

        zip_buffer.seek(0)

        return StreamingResponse(
            zip_buffer,
            media_type="application/zip",
            headers={
                "Content-Disposition": f"attachment; filename={project_name}.zip"
            },
        )

    else:
        raise HTTPException(status_code=400, detail=f"Unsupported format: {format}")


@router.post("/import", response_model=ImportResult)
async def import_project(file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    """导入项目。"""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    filename = file.filename.lower()

    try:
        content = await file.read()

        if filename.endswith(".json"):
            import_data = json.loads(content.decode("utf-8"))

            if "metadata" in import_data and "flow" in import_data:
                project_name = import_data["metadata"]["project_name"]
                flow_data = import_data["flow"]
            else:
                project_name = file.filename.rsplit(".", 1)[0]
                flow_data = import_data

            flows_dir = get_flows_dir()
            os.makedirs(flows_dir, exist_ok=True)
            flow_file = os.path.join(flows_dir, f"{project_name}.json")

            with open(flow_file, "w", encoding="utf-8") as f:
                json.dump(flow_data, f, indent=2, ensure_ascii=False)

            if "skills" in import_data:
                skills_dir = DataPaths.get_user_skills_dir(current_user.id)
                os.makedirs(skills_dir, exist_ok=True)
                for skill in import_data["skills"]:
                    skill_path = os.path.join(skills_dir, skill["name"])
                    os.makedirs(skill_path, exist_ok=True)
                    skill_md = os.path.join(skill_path, "SKILL.md")
                    with open(skill_md, "w", encoding="utf-8") as f:
                        f.write(skill["content"])

            nodes_count = len(flow_data.get("nodes", []))
            edges_count = len(flow_data.get("edges", []))

            return ImportResult(
                success=True,
                project_name=project_name,
                nodes_count=nodes_count,
                edges_count=edges_count,
                message="Project imported successfully",
            )

        elif filename.endswith(".zip"):
            zip_buffer = io.BytesIO(content)

            with zipfile.ZipFile(zip_buffer, "r") as zf:
                try:
                    metadata = json.loads(zf.read("metadata.json"))
                    project_name = metadata["project_name"]
                except:
                    project_name = file.filename.rsplit(".", 1)[0]

                flow_data = json.loads(zf.read("flow.json"))

                flows_dir = get_flows_dir()
                os.makedirs(flows_dir, exist_ok=True)
                flow_file = os.path.join(flows_dir, f"{project_name}.json")

                with open(flow_file, "w", encoding="utf-8") as f:
                    json.dump(flow_data, f, indent=2, ensure_ascii=False)

                skills_dir = DataPaths.get_user_skills_dir(current_user.id)
                os.makedirs(skills_dir, exist_ok=True)

                for name in zf.namelist():
                    if name.startswith("skills/"):
                        rel_path = name[len("skills/"):]
                        target_path = os.path.join(skills_dir, rel_path)
                        if name.endswith("/"):
                            os.makedirs(target_path, exist_ok=True)
                        else:
                            os.makedirs(os.path.dirname(target_path), exist_ok=True)
                            with open(target_path, "wb") as f:
                                f.write(zf.read(name))

                nodes_count = len(flow_data.get("nodes", []))
                edges_count = len(flow_data.get("edges", []))

                return ImportResult(
                    success=True,
                    project_name=project_name,
                    nodes_count=nodes_count,
                    edges_count=edges_count,
                    message="Project imported successfully",
                )

        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file format: {filename}"
            )

    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON file")
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Invalid ZIP file")
    except Exception as e:
        logger.error(f"Failed to import project: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to import project: {e}")


@router.get("/formats")
async def get_export_formats():
    """获取支持的导出格式。"""
    return {
        "formats": [
            {
                "name": "json",
                "description": "JSON 格式，适合数据交换",
                "extension": ".json",
            },
            {
                "name": "zip",
                "description": "ZIP 压缩包，包含完整项目结构",
                "extension": ".zip",
            },
        ]
    }
