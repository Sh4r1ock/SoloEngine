import os
from sqlalchemy.orm import Session
from app.core.database import UserModel, hash_password
from datetime import datetime, timezone

SYSTEM_USER_ID = "system"
DEFAULT_SYSTEM_USERNAME = os.getenv("SYSTEM_USERNAME", "system")
DEFAULT_SYSTEM_PASSWORD = os.getenv("SYSTEM_PASSWORD", "system")

def create_system_user(db: Session) -> UserModel:
    """创建系统用户（如果不存在）。"""
    existing = db.query(UserModel).filter(UserModel.id == SYSTEM_USER_ID).first()
    if existing:
        return existing
    
    hashed_password = hash_password(DEFAULT_SYSTEM_PASSWORD)
    system_user = UserModel(
        id=SYSTEM_USER_ID,
        username=DEFAULT_SYSTEM_USERNAME,
        hashed_password=hashed_password,
        is_active=True,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc)
    )
    db.add(system_user)
    db.commit()
    db.refresh(system_user)
    return system_user

def is_system_user(user_id: str) -> bool:
    """检查是否是系统用户。"""
    return user_id == SYSTEM_USER_ID
