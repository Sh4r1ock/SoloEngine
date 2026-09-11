# -*- coding: utf-8 -*-
import logging
import uuid
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from typing import Optional, List, Dict, Any

from sqlalchemy import and_, or_, func
from sqlalchemy.orm import Session

from app.core.data_paths import DataPaths
from app.core.config import settings
from .models import (
    engine,
    SessionLocal,
    UserModel,
    AgenticFlowModel,
    AgenticFlowSessionModel,
    SessionMessageModel,
    SkillsPackageModel,
    LLMConfigModel,
    RunProjectModel,
    MCPServerModel,
    MCPStdioConfigModel,
    MCPSseConfigModel,
    MCPHttpConfigModel,
)
from .security import (
    check_optimistic_lock,
    increment_version,
    hash_password,
    verify_password,
    encryption_service,
)

logger = logging.getLogger(__name__)


class DatabaseManager:
    """数据库管理器。"""

    def __init__(self):
        self.engine = engine
        self.SessionLocal = SessionLocal

    def create_user(self, db: Session, username: str, email: str, password: str, 
                    is_superuser: bool = False) -> UserModel:
        """创建用户。"""
        user = UserModel(
            username=username,
            email=email,
            hashed_password=hash_password(password),
            is_superuser=is_superuser,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return user

    def get_user_by_username(self, db: Session, username: str) -> Optional[UserModel]:
        """通过用户名获取用户。"""
        return db.query(UserModel).filter(UserModel.username == username).first()

    def get_user_by_id(self, db: Session, user_id: str) -> Optional[UserModel]:
        """通过ID获取用户。"""
        return db.query(UserModel).filter(UserModel.id == user_id).first()

    # ---- B7 路径合并：update/delete 泛型基座（update_*/delete_* 方法核心模板收敛）----

    def _update_with_lock(self, db: Session, model, obj_id: str, version: int = None,
                          user_id: str = None, **kwargs) -> Optional[Any]:
        """泛型更新基座（B7：update_* 方法核心模板收敛，乐观锁 + 版本递增 + 可选 user 隔离）。"""
        query = db.query(model).filter(model.id == obj_id)
        if user_id:
            query = query.filter(model.user_id == user_id)
        obj = query.first()
        if not obj:
            return None
        check_optimistic_lock(obj, version)
        for key, value in kwargs.items():
            if hasattr(obj, key):
                setattr(obj, key, value)
        increment_version(obj)
        obj.updated_at = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))
        db.commit()
        db.refresh(obj)
        return obj

    def _soft_delete(self, db: Session, obj) -> bool:
        """泛型软删除基座（B7：delete_* 方法收敛，is_active=False）。"""
        if not obj:
            return False
        obj.is_active = False
        db.commit()
        return True

    def _hard_delete(self, db: Session, obj) -> bool:
        """泛型硬删除基座（B7：delete_* 方法收敛，物理删除）。"""
        if not obj:
            return False
        db.delete(obj)
        db.commit()
        return True

    def authenticate_user(self, db: Session, username: str, password: str) -> Optional[UserModel]:
        """验证用户。"""
        user = self.get_user_by_username(db, username)
        if not user:
            return None
        if not verify_password(password, user.hashed_password):
            return None
        user.last_login = datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE))
        db.commit()
        return user

    def create_agentic_flow(self, db: Session, user_id: str, name: str, 
                            description: str = None, folder_path: str = None, icon: str = None,
                            canvas_data: str = None) -> AgenticFlowModel:
        """创建AgenticFlow。"""
        rel_folder_path = DataPaths.to_relative_path(folder_path) if folder_path else None
        
        flow = AgenticFlowModel(
            user_id=user_id,
            name=name,
            description=description,
            folder_path=rel_folder_path,
            icon=icon,
            canvas_data=canvas_data,
        )
        db.add(flow)
        db.commit()
        db.refresh(flow)
        
        # 返回时转换为绝对路径
        if flow.folder_path:
            flow.folder_path = DataPaths.to_absolute_path(flow.folder_path)
        
        db.expunge(flow)
        return flow

    def get_agentic_flows(self, db: Session, user_id: str) -> List[AgenticFlowModel]:
        """获取用户的所有AgenticFlow。"""
        flows = db.query(AgenticFlowModel).filter(
            AgenticFlowModel.user_id == user_id,
            AgenticFlowModel.is_active == True
        ).order_by(AgenticFlowModel.created_at.desc()).all()
        
        # 转换为绝对路径
        for flow in flows:
            if flow.folder_path:
                flow.folder_path = DataPaths.to_absolute_path(flow.folder_path)
        
        db.expunge_all()
        return flows

    def get_agentic_flow(self, db: Session, agentic_flow_id: str, user_id: str = None) -> Optional[AgenticFlowModel]:
        """获取AgenticFlow。"""
        query = db.query(AgenticFlowModel).filter(AgenticFlowModel.id == agentic_flow_id)
        if user_id:
            query = query.filter(AgenticFlowModel.user_id == user_id)
        flow = query.first()
        
        # 转换为绝对路径
        if flow and flow.folder_path:
            flow.folder_path = DataPaths.to_absolute_path(flow.folder_path)
        
        db.expunge(flow) if flow else None
        return flow

    def update_agentic_flow(self, db: Session, agentic_flow_id: str, user_id: str, 
                            version: int = None, **kwargs) -> Optional[AgenticFlowModel]:
        """更新AgenticFlow（带乐观锁）。"""
        # 直接查询数据库，不使用get_agentic_flow，避免路径转换干扰
        if kwargs.get('folder_path'):
            kwargs['folder_path'] = DataPaths.to_relative_path(kwargs['folder_path'])
        flow = self._update_with_lock(
            db, AgenticFlowModel, agentic_flow_id, version, user_id=user_id, **kwargs
        )
        # 返回时转换为绝对路径
        if flow and flow.folder_path:
            flow.folder_path = DataPaths.to_absolute_path(flow.folder_path)
        db.expunge(flow) if flow else None
        return flow

    def delete_agentic_flow(self, db: Session, agentic_flow_id: str, user_id: str) -> bool:
        """删除AgenticFlow（软删除）。"""
        return self._soft_delete(db, self.get_agentic_flow(db, agentic_flow_id, user_id))

    def update_session(self, db: Session, session_id: str, version: int = None,
                       **kwargs) -> Optional[AgenticFlowSessionModel]:
        """更新会话记录（带乐观锁）。"""
        return self._update_with_lock(db, AgenticFlowSessionModel, session_id, version, **kwargs)

    def get_session(self, db: Session, session_id: str, user_id: str = None) -> Optional[AgenticFlowSessionModel]:
        """获取单个会话记录（A5：API 层统一经 db_manager 查询，user_id 可选权限过滤）。"""
        query = db.query(AgenticFlowSessionModel).filter(AgenticFlowSessionModel.id == session_id)
        if user_id:
            query = query.filter(AgenticFlowSessionModel.user_id == user_id)
        return query.first()

    def create_session(self, db: Session, session_id: str, user_id: str,
                       agentic_flow_id: str, run_project_id: str,
                       status: str = "pending") -> AgenticFlowSessionModel:
        """创建会话记录（B5：session 创建的唯一路径，run_save/run_context 共用）。

        若会话已存在则直接返回现有记录（幂等），避免重复创建。
        """
        session = self.get_session(db, session_id)
        if session:
            return session
        session = AgenticFlowSessionModel(
            id=session_id,
            user_id=user_id,
            agentic_flow_id=agentic_flow_id,
            run_project_id=run_project_id,
            status=status,
        )
        db.add(session)
        db.commit()
        logger.info(f"Created session {session_id} (status={status})")
        return session

    def add_session_message(self, db: Session, session_id: str, user_id: str,
                            role: str, data: list = None, agent_id: str = "default",
                            parent_message_id: str = None, parent_agent_id: str = None,
                            token_usage_history: Any = None,
                            llm_config_id: str = None,
                            status: str = "completed", error: str = None,
                            is_compressed: bool = False,
                            id: str = None) -> SessionMessageModel:
        if not agent_id:
            agent_id = "default"
        if data is None:
            data = []

        max_index = db.query(func.max(SessionMessageModel.message_index)).filter(
            SessionMessageModel.session_id == session_id,
            SessionMessageModel.is_deleted == False
        ).scalar()
        if max_index is None:
            max_index = -1

        # #17 改4：支持传入预生成 id（用于 mainagent 第一个 block 与 subagent task 消息的 parent 链对齐）
        kwargs = dict(
            session_id=session_id,
            user_id=user_id,
            agent_id=agent_id,
            parent_agent_id=parent_agent_id,
            role=role,
            data=data,
            status=status,
            error=error,
            message_index=max_index + 1,
            parent_message_id=parent_message_id,
            token_usage_history=token_usage_history,
            llm_config_id=llm_config_id,
            is_compressed=is_compressed,
            timestamp=datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)),
        )
        if id:
            kwargs["id"] = id
        message = SessionMessageModel(**kwargs)
        db.add(message)
        db.commit()
        db.refresh(message)
        return message

    def get_session_messages(self, db: Session, session_id: str,
                             limit: int = None, offset: int = 0) -> List[SessionMessageModel]:
        """获取会话消息列表。"""
        query = db.query(SessionMessageModel).filter(
            SessionMessageModel.session_id == session_id,
            SessionMessageModel.is_deleted == False
        ).order_by(SessionMessageModel.message_index)
        if offset:
            query = query.offset(offset)
        if limit:
            query = query.limit(limit)
        return query.all()

    def create_skills_package(self, db: Session, user_id: str, name: str, 
                              description: str = None, folder_path: str = None,
                              pkg_version: str = "1.0.0", author: str = None, 
                              tags: List[str] = None, icon: str = None) -> SkillsPackageModel:
        """创建Skills包。"""
        # 转换为相对路径
        rel_folder_path = DataPaths.to_relative_path(folder_path) if folder_path else None
        
        package = SkillsPackageModel(
            user_id=user_id,
            name=name,
            description=description,
            folder_path=rel_folder_path,
            pkg_version=pkg_version,
            author=author,
            tags=tags or [],
            icon=icon,
            created_at=datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)),
            updated_at=datetime.now(ZoneInfo(settings.DEFAULT_TIMEZONE)),
        )
        db.add(package)
        db.commit()
        db.refresh(package)
        
        # 返回时转换为绝对路径
        if package.folder_path:
            package.folder_path = DataPaths.to_absolute_path(package.folder_path)
        
        db.expunge(package)
        return package

    def get_skills_packages(self, db: Session, user_id: str) -> List[SkillsPackageModel]:
        """获取用户的Skills包（包括停用和启用的）。"""
        packages = db.query(SkillsPackageModel).filter(
            SkillsPackageModel.user_id == user_id
        ).order_by(SkillsPackageModel.created_at.desc()).all()
        
        # 转换为绝对路径
        for package in packages:
            if package.folder_path:
                package.folder_path = DataPaths.to_absolute_path(package.folder_path)
        
        db.expunge_all()
        return packages

    def get_skills_package(self, db: Session, package_id: str, user_id: str = None, for_update: bool = False) -> Optional[SkillsPackageModel]:
        """获取Skills包（包含公共数据）。

        for_update=True 用于需要修改并 commit 的场景（如 activate/deactivate）：
        返回 attached 对象且不转换 folder_path（避免绝对路径被随 commit 持久化）；
        否则为只读查询场景，转换 folder_path 为绝对路径并 expunge 避免 session 关闭后失效。
        """
        query = db.query(SkillsPackageModel).filter(SkillsPackageModel.id == package_id)
        if user_id:
            # 查找用户自己的skill或公共skill
            query = query.filter(
                or_(
                    SkillsPackageModel.is_public == True,
                    SkillsPackageModel.user_id == user_id
                )
            )
        package = query.first()
        
        if for_update:
            return package
        
        # 转换为绝对路径
        if package and package.folder_path:
            package.folder_path = DataPaths.to_absolute_path(package.folder_path)
        
        db.expunge(package) if package else None
        return package

    def update_skills_package(self, db: Session, package_id: str, user_id: str,
                              version: int = None, **kwargs) -> Optional[SkillsPackageModel]:
        """更新Skills包（带乐观锁）。"""
        # 直接查询数据库，不使用get_skills_package，避免路径转换干扰
        if kwargs.get('folder_path'):
            kwargs['folder_path'] = DataPaths.to_relative_path(kwargs['folder_path'])
        package = self._update_with_lock(
            db, SkillsPackageModel, package_id, version, user_id=user_id, **kwargs
        )
        # 返回时转换为绝对路径
        if package and package.folder_path:
            package.folder_path = DataPaths.to_absolute_path(package.folder_path)
        db.expunge(package) if package else None
        return package

    def delete_skills_package(self, db: Session, package_id: str, user_id: str) -> bool:
        """删除Skills包（物理删除）。"""
        return self._hard_delete(db, self.get_skills_package(db, package_id, user_id))

    def _reset_other_defaults(self, db: Session, user_id: str, exclude_id: str = None) -> None:
        """将用户其它 LLM 配置的 is_default 置零（M13：create/update 两处置零逻辑复用）。

        Args:
            db: 数据库会话。
            user_id: 用户 ID。
            exclude_id: 需排除的配置 ID（更新场景排除自身；创建场景为 None）。
        """
        query = [
            and_(
                LLMConfigModel.user_id == user_id,
                LLMConfigModel.is_default == True,
            )
        ]
        if exclude_id:
            query.append(LLMConfigModel.id != exclude_id)
        db.query(LLMConfigModel).filter(and_(*query)).update({"is_default": False})

    def create_llm_config(self, db: Session, user_id: str, name: str, provider: str,
                          model_name: str, api_key: str = None, base_url: str = None,
                          temperature: float = 0.7, max_tokens: int = 2048,
                          max_input_tokens: int = None, max_output_tokens: int = None,
                          top_p: float = 1.0, frequency_penalty: float = 0.0,
                          presence_penalty: float = 0.0, timeout: int = 60,
                          max_tool_calls: int = None, extra_params: Dict = None,
                          is_default: bool = False, is_full_url: bool = False) -> LLMConfigModel:
        """创建LLM配置。"""
        if is_default:
            self._reset_other_defaults(db, user_id)
        
        encrypted_api_key = encryption_service.encrypt(api_key) if api_key else None
        
        config = LLMConfigModel(
            user_id=user_id,
            name=name,
            provider=provider,
            model_name=model_name,
            api_key=encrypted_api_key,
            base_url=base_url,
            is_full_url=is_full_url,
            temperature=temperature,
            max_tokens=max_tokens,
            max_input_tokens=max_input_tokens,
            max_output_tokens=max_output_tokens,
            top_p=top_p,
            frequency_penalty=frequency_penalty,
            presence_penalty=presence_penalty,
            timeout=timeout,
            max_tool_calls=max_tool_calls,
            extra_params=extra_params or {},
            is_default=is_default,
        )
        db.add(config)
        db.commit()
        db.refresh(config)
        return config

    def get_llm_configs(self, db: Session, user_id: str) -> List[LLMConfigModel]:
        """获取用户的所有LLM配置（包括未激活的）。按创建时间降序排列。"""
        return db.query(LLMConfigModel).filter(
            LLMConfigModel.user_id == user_id
        ).order_by(LLMConfigModel.created_at.desc()).all()

    def get_active_llm_configs(self, db: Session, user_id: str) -> List[LLMConfigModel]:
        """获取用户的活跃LLM配置（仅is_active=True的记录，用于画布节点编辑面板）。按创建时间降序排列。"""
        return db.query(LLMConfigModel).filter(
            LLMConfigModel.user_id == user_id,
            LLMConfigModel.is_active == True
        ).order_by(LLMConfigModel.created_at.desc()).all()

    def get_llm_config(self, db: Session, config_id: str, user_id: str = None) -> Optional[LLMConfigModel]:
        """获取指定的LLM配置。"""
        query = db.query(LLMConfigModel).filter(LLMConfigModel.id == config_id)
        if user_id:
            query = query.filter(LLMConfigModel.user_id == user_id)
        return query.first()

    def get_default_llm_config(self, db: Session, user_id: str) -> Optional[LLMConfigModel]:
        """获取用户的默认LLM配置。"""
        return db.query(LLMConfigModel).filter(
            and_(LLMConfigModel.user_id == user_id, LLMConfigModel.is_default == True, LLMConfigModel.is_active == True)
        ).first()

    def update_llm_config(self, db: Session, config_id: str, user_id: str,
                          version: int = None, **kwargs) -> Optional[LLMConfigModel]:
        """更新LLM配置（带乐观锁）。"""
        config = self.get_llm_config(db, config_id, user_id)
        if not config:
            return None

        check_optimistic_lock(config, version)

        if kwargs.get("is_default") == True:
            self._reset_other_defaults(db, user_id, exclude_id=config_id)

        if "api_key" in kwargs and kwargs["api_key"]:
            kwargs["api_key"] = encryption_service.encrypt(kwargs["api_key"])

        # 保持原有语义：kwargs 中的 "version" 键不写入（乐观锁版本由参数管理）
        filtered_kwargs = {k: v for k, v in kwargs.items() if k != "version"}
        return self._update_with_lock(
            db, LLMConfigModel, config_id, version, user_id=user_id, **filtered_kwargs
        )
    
    def get_decrypted_api_key(self, config: LLMConfigModel) -> Optional[str]:
        """获取解密后的API密钥。"""
        if not config or not config.api_key:
            return None
        return encryption_service.decrypt(config.api_key)

    def delete_llm_config(self, db: Session, config_id: str, user_id: str) -> bool:
        """删除LLM配置（真删除）。"""
        return self._hard_delete(db, self.get_llm_config(db, config_id, user_id))

    def create_run_project(self, db: Session, user_id: str, agentic_flow_id: str, name: str,
                           folder_path: str, description: str = None) -> RunProjectModel:
        """创建运行项目。"""
        # run_project表使用绝对路径，不做转换
        project = RunProjectModel(
            user_id=user_id,
            agentic_flow_id=agentic_flow_id,
            name=name,
            folder_path=folder_path,
            description=description,
        )
        db.add(project)
        db.commit()
        db.refresh(project)
        
        return project

    def get_run_project(self, db: Session, project_id: str, user_id: str = None) -> Optional[RunProjectModel]:
        """获取运行项目。"""
        query = db.query(RunProjectModel).filter(RunProjectModel.id == project_id)
        if user_id:
            query = query.filter(RunProjectModel.user_id == user_id)
        project = query.first()
        
        # run_project表使用绝对路径，不做转换
        return project

    def get_run_project_by_path(self, db: Session, user_id: str, agentic_flow_id: str, folder_path: str) -> Optional[RunProjectModel]:
        """通过路径获取运行项目。"""
        # run_project表使用绝对路径，直接查询
        project = db.query(RunProjectModel).filter(
            RunProjectModel.user_id == user_id,
            RunProjectModel.agentic_flow_id == agentic_flow_id,
            RunProjectModel.folder_path == folder_path,
            RunProjectModel.is_active == True
        ).first()
        
        return project

    def get_active_run_project(self, db: Session, user_id: str, agentic_flow_id: str = None) -> Optional[RunProjectModel]:
        """获取用户当前活动的运行项目。"""
        query = db.query(RunProjectModel).filter(
            RunProjectModel.user_id == user_id,
            RunProjectModel.is_active == True
        )
        if agentic_flow_id:
            query = query.filter(RunProjectModel.agentic_flow_id == agentic_flow_id)
        project = query.order_by(RunProjectModel.last_accessed_at.desc()).first()
        
        # run_project表使用绝对路径，不做转换
        return project

    def update_run_project(self, db: Session, project_id: str, user_id: str,
                           version: int = None, **kwargs) -> Optional[RunProjectModel]:
        """更新运行项目（带乐观锁）。"""
        # 保持原有语义：kwargs 中的 "version" 键不写入（乐观锁版本由参数管理）
        filtered_kwargs = {k: v for k, v in kwargs.items() if k != "version"}
        return self._update_with_lock(
            db, RunProjectModel, project_id, version, user_id=user_id, **filtered_kwargs
        )

    def delete_run_project(self, db: Session, project_id: str, user_id: str) -> bool:
        """删除运行项目（软删除）。"""
        return self._soft_delete(db, self.get_run_project(db, project_id, user_id))

    def get_recent_projects(self, db: Session, user_id: str, agentic_flow_id: str, limit: int = 10) -> List[RunProjectModel]:
        """获取用户最近访问的项目列表。"""
        return db.query(RunProjectModel).filter(
            RunProjectModel.user_id == user_id,
            RunProjectModel.agentic_flow_id == agentic_flow_id,
            RunProjectModel.is_active == True
        ).order_by(RunProjectModel.last_accessed_at.desc()).limit(limit).all()

    def get_all_skills_for_user(self, db: Session, user_id: str) -> List[SkillsPackageModel]:
        """获取用户可见的所有skill（公共skill + 用户skill）。

        按创建时间降序排列。
        """
        packages = db.query(SkillsPackageModel).filter(
            or_(
                SkillsPackageModel.is_public == True,
                SkillsPackageModel.user_id == user_id
            )
        ).order_by(SkillsPackageModel.created_at.desc()).all()
        
        # 转换为绝对路径
        for package in packages:
            if package.folder_path:
                package.folder_path = DataPaths.to_absolute_path(package.folder_path)
        
        db.expunge_all()
        return packages


db_manager = DatabaseManager()

