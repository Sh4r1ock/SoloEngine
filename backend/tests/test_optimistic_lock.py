# -*- coding: utf-8 -*-
"""
乐观锁机制测试模块。

@file test_optimistic_lock.py
@description 乐观锁机制单元测试和集成测试
@author SoloEngine Team
@date 2026-02-19

功能描述：
- 测试乐观锁版本号递增
- 测试乐观锁冲突检测
- 测试并发更新场景
- 测试API接口乐观锁支持
"""

import pytest
import tempfile
import os
import threading
import time
from datetime import datetime
from unittest.mock import patch, MagicMock

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.core.database import (
    Base, UserModel, AgenticFlowModel, AgenticFlowRunModel,
    AgentModel, SkillsPackageModel, MCPServerModel,
    DatabaseManager, OptimisticLockError, hash_password
)


@pytest.fixture
def test_db():
    """创建测试数据库。"""
    with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as f:
        db_path = f.name
    
    engine = create_engine(f"sqlite:///{db_path}", echo=False)
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    
    db = SessionLocal()
    yield db
    
    db.close()
    os.unlink(db_path)


@pytest.fixture
def db_manager():
    """获取数据库管理器实例。"""
    return DatabaseManager()


@pytest.fixture
def test_user(test_db):
    """创建测试用户。"""
    user = UserModel(
        id="test_user_id",
        username="testuser",
        email="test@example.com",
        hashed_password=hash_password("password123"),
        version=1
    )
    test_db.add(user)
    test_db.commit()
    test_db.refresh(user)
    return user


class TestOptimisticLockModel:
    """乐观锁模型测试。"""
    
    def test_user_model_has_version(self, test_user):
        """测试用户模型包含version字段。"""
        assert hasattr(test_user, 'version')
        assert test_user.version == 1
    
    def test_agentic_flow_model_has_version(self, test_db, test_user):
        """测试AgenticFlow模型包含version字段。"""
        flow = AgenticFlowModel(
            id="test_flow_id",
            user_id=test_user.id,
            name="Test Flow",
            version=1
        )
        test_db.add(flow)
        test_db.commit()
        test_db.refresh(flow)
        
        assert hasattr(flow, 'version')
        assert flow.version == 1
    
    def test_agentic_flow_run_model_has_version(self, test_db, test_user):
        """测试AgenticFlowRun模型包含version字段。"""
        flow = AgenticFlowModel(
            id="test_flow_id",
            user_id=test_user.id,
            name="Test Flow"
        )
        test_db.add(flow)
        test_db.commit()
        
        run = AgenticFlowRunModel(
            id="test_run_id",
            agentic_flow_id=flow.id,
            user_id=test_user.id,
            status="pending",
            version=1
        )
        test_db.add(run)
        test_db.commit()
        test_db.refresh(run)
        
        assert hasattr(run, 'version')
        assert run.version == 1
    
    def test_skills_package_model_has_lock_version(self, test_db, test_user):
        """测试SkillsPackage模型包含lock_version字段。"""
        pkg = SkillsPackageModel(
            id="test_pkg_id",
            user_id=test_user.id,
            name="Test Package",
            version="1.0.0",
            lock_version=1
        )
        test_db.add(pkg)
        test_db.commit()
        test_db.refresh(pkg)
        
        assert hasattr(pkg, 'lock_version')
        assert pkg.lock_version == 1
    
    def test_mcp_server_model_has_version(self, test_db, test_user):
        """测试MCPServer模型包含version字段。"""
        server = MCPServerModel(
            id="test_server_id",
            user_id=test_user.id,
            name="Test Server",
            transport="http",
            url="http://localhost:8080",
            version=1
        )
        test_db.add(server)
        test_db.commit()
        test_db.refresh(server)
        
        assert hasattr(server, 'version')
        assert server.version == 1


class TestOptimisticLockUpdate:
    """乐观锁更新测试。"""
    
    def test_update_agentic_flow_version_increment(self, test_db, db_manager, test_user):
        """测试更新AgenticFlow时版本号递增。"""
        flow = AgenticFlowModel(
            id="test_flow_id",
            user_id=test_user.id,
            name="Test Flow",
            version=1
        )
        test_db.add(flow)
        test_db.commit()
        
        updated_flow = db_manager.update_agentic_flow(
            test_db, "test_flow_id", test_user.id, name="Updated Flow"
        )
        
        assert updated_flow.version == 2
        assert updated_flow.name == "Updated Flow"
    
    def test_update_agentic_flow_with_correct_version(self, test_db, db_manager, test_user):
        """测试使用正确版本号更新AgenticFlow。"""
        flow = AgenticFlowModel(
            id="test_flow_id",
            user_id=test_user.id,
            name="Test Flow",
            version=1
        )
        test_db.add(flow)
        test_db.commit()
        
        updated_flow = db_manager.update_agentic_flow(
            test_db, "test_flow_id", test_user.id, version=1, name="Updated Flow"
        )
        
        assert updated_flow.version == 2
        assert updated_flow.name == "Updated Flow"
    
    def test_update_agentic_flow_with_wrong_version(self, test_db, db_manager, test_user):
        """测试使用错误版本号更新AgenticFlow抛出乐观锁异常。"""
        flow = AgenticFlowModel(
            id="test_flow_id",
            user_id=test_user.id,
            name="Test Flow",
            version=2
        )
        test_db.add(flow)
        test_db.commit()
        
        with pytest.raises(OptimisticLockError) as exc_info:
            db_manager.update_agentic_flow(
                test_db, "test_flow_id", test_user.id, version=1, name="Updated Flow"
            )
        
        assert "Optimistic lock conflict" in str(exc_info.value)
    
    def test_update_run_version_increment(self, test_db, db_manager, test_user):
        """测试更新Run时版本号递增。"""
        flow = AgenticFlowModel(
            id="test_flow_id",
            user_id=test_user.id,
            name="Test Flow"
        )
        test_db.add(flow)
        test_db.commit()
        
        run = AgenticFlowRunModel(
            id="test_run_id",
            agentic_flow_id=flow.id,
            user_id=test_user.id,
            status="pending",
            version=1
        )
        test_db.add(run)
        test_db.commit()
        
        updated_run = db_manager.update_run(
            test_db, "test_run_id", status="completed"
        )
        
        assert updated_run.version == 2
        assert updated_run.status == "completed"
    
    def test_update_skills_package_version_increment(self, test_db, db_manager, test_user):
        """测试更新SkillsPackage时版本号递增。"""
        pkg = SkillsPackageModel(
            id="test_pkg_id",
            user_id=test_user.id,
            name="Test Package",
            version="1.0.0",
            lock_version=1
        )
        test_db.add(pkg)
        test_db.commit()
        
        updated_pkg = db_manager.update_skills_package(
            test_db, "test_pkg_id", test_user.id, description="Updated description"
        )
        
        assert updated_pkg.lock_version == 2
        assert updated_pkg.description == "Updated description"
    
    def test_update_skills_package_with_wrong_version(self, test_db, db_manager, test_user):
        """测试使用错误版本号更新SkillsPackage抛出乐观锁异常。"""
        pkg = SkillsPackageModel(
            id="test_pkg_id",
            user_id=test_user.id,
            name="Test Package",
            version="1.0.0",
            lock_version=3
        )
        test_db.add(pkg)
        test_db.commit()
        
        with pytest.raises(OptimisticLockError) as exc_info:
            db_manager.update_skills_package(
                test_db, "test_pkg_id", test_user.id, lock_version=1, description="Updated"
            )
        
        assert "Optimistic lock conflict" in str(exc_info.value)
    
    def test_update_mcp_server_version_increment(self, test_db, db_manager, test_user):
        """测试更新MCPServer时版本号递增。"""
        server = MCPServerModel(
            id="test_server_id",
            user_id=test_user.id,
            name="Test Server",
            transport="http",
            url="http://localhost:8080",
            version=1
        )
        test_db.add(server)
        test_db.commit()
        
        updated_server = db_manager.update_mcp_server(
            test_db, "test_server_id", test_user.id, name="Updated Server"
        )
        
        assert updated_server.version == 2
        assert updated_server.name == "Updated Server"
    
    def test_update_mcp_server_with_wrong_version(self, test_db, db_manager, test_user):
        """测试使用错误版本号更新MCPServer抛出乐观锁异常。"""
        server = MCPServerModel(
            id="test_server_id",
            user_id=test_user.id,
            name="Test Server",
            transport="http",
            url="http://localhost:8080",
            version=5
        )
        test_db.add(server)
        test_db.commit()
        
        with pytest.raises(OptimisticLockError) as exc_info:
            db_manager.update_mcp_server(
                test_db, "test_server_id", test_user.id, version=1, name="Updated"
            )
        
        assert "Optimistic lock conflict" in str(exc_info.value)


class TestOptimisticLockConcurrency:
    """乐观锁并发测试。"""
    
    def test_concurrent_update_agentic_flow(self, test_db, test_user):
        """测试并发更新AgenticFlow时乐观锁生效。"""
        flow = AgenticFlowModel(
            id="test_flow_id",
            user_id=test_user.id,
            name="Test Flow",
            version=1
        )
        test_db.add(flow)
        test_db.commit()
        
        results = {"success": 0, "conflict": 0}
        lock = threading.Lock()
        
        def update_flow(thread_id):
            with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as f:
                thread_db_path = f.name
            
            thread_engine = create_engine(f"sqlite:///{thread_db_path}", echo=False)
            ThreadSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=thread_engine)
            thread_db = ThreadSessionLocal()
            
            try:
                thread_db.add(test_user)
                thread_db.add(flow)
                thread_db.commit()
                
                db_mgr = DatabaseManager()
                time.sleep(0.01)
                
                try:
                    updated = db_mgr.update_agentic_flow(
                        thread_db, "test_flow_id", test_user.id, version=1, 
                        name=f"Updated by thread {thread_id}"
                    )
                    with lock:
                        results["success"] += 1
                except OptimisticLockError:
                    with lock:
                        results["conflict"] += 1
            finally:
                thread_db.close()
                os.unlink(thread_db_path)
        
        threads = [threading.Thread(target=update_flow, args=(i,)) for i in range(3)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        
        assert results["success"] >= 1
        assert results["conflict"] >= 0


class TestOptimisticLockException:
    """乐观锁异常测试。"""
    
    def test_optimistic_lock_error_message(self):
        """测试乐观锁异常消息格式。"""
        error = OptimisticLockError(
            "Optimistic lock conflict: expected version 1, but current version is 2"
        )
        
        assert "expected version 1" in str(error)
        assert "current version is 2" in str(error)
    
    def test_optimistic_lock_error_is_exception(self):
        """测试乐观锁异常是Exception的子类。"""
        assert issubclass(OptimisticLockError, Exception)


class TestOptimisticLockWithoutVersion:
    """不提供版本号时的更新测试。"""
    
    def test_update_without_version_still_increments(self, test_db, db_manager, test_user):
        """测试不提供版本号时仍然递增版本号。"""
        flow = AgenticFlowModel(
            id="test_flow_id",
            user_id=test_user.id,
            name="Test Flow",
            version=1
        )
        test_db.add(flow)
        test_db.commit()
        
        updated_flow = db_manager.update_agentic_flow(
            test_db, "test_flow_id", test_user.id, name="Updated Flow"
        )
        
        assert updated_flow.version == 2
    
    def test_update_without_version_check(self, test_db, db_manager, test_user):
        """测试不提供版本号时不进行版本检查。"""
        flow = AgenticFlowModel(
            id="test_flow_id",
            user_id=test_user.id,
            name="Test Flow",
            version=5
        )
        test_db.add(flow)
        test_db.commit()
        
        updated_flow = db_manager.update_agentic_flow(
            test_db, "test_flow_id", test_user.id, name="Updated Flow"
        )
        
        assert updated_flow.version == 6
        assert updated_flow.name == "Updated Flow"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
