# -*- coding: utf-8 -*-
import os
import logging
import base64
import secrets
import hashlib
from typing import Optional

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    HAS_CRYPTOGRAPHY = True
except ImportError:
    HAS_CRYPTOGRAPHY = False

try:
    from pwdlib import PasswordHash
    HAS_PWDLIB = True
except ImportError:
    HAS_PWDLIB = False

from app.core.config import settings
from app.core.data_paths import DataPaths

logger = logging.getLogger(__name__)


_pwd_context = None


def _get_pwd_context():
    """获取密码上下文。"""
    global _pwd_context
    if _pwd_context is None:
        if HAS_PWDLIB:
            _pwd_context = PasswordHash.recommended()
        else:
            _pwd_context = None
    return _pwd_context


# 无 pwdlib 时的降级哈希算法常量（PBKDF2-SHA256，带随机盐）
_PBKDF2_ALGORITHM = "sha256"
_PBKDF2_ITERATIONS = 100000
_PBKDF2_PREFIX = f"pbkdf2${_PBKDF2_ALGORITHM}${_PBKDF2_ITERATIONS}$"


def hash_password(password: str) -> str:
    """使用 Argon2 哈希密码；无 pwdlib 时退化为带随机盐的 PBKDF2-SHA256。

    返回格式带算法前缀标识（pwdlib 产出 $argon2...，降级产出
    pbkdf2$sha256$100000$<salt>$<hash>），verify_password 据此分派算法，
    避免新旧算法混存无法区分。
    """
    pwd_context = _get_pwd_context()
    if pwd_context:
        return pwd_context.hash(password)
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(_PBKDF2_ALGORITHM, password.encode(), salt.encode(), _PBKDF2_ITERATIONS).hex()
    return f"{_PBKDF2_PREFIX}{salt}${digest}"


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """验证密码。

    按哈希前缀标识分派算法：
    - 以 $ 开头（pwdlib Argon2 格式）→ pwdlib.verify（pwdlib 不可用时视为无法验证）
    - 以 pbkdf2$ 开头 → 按 PBKDF2-SHA256（算法/迭代次数/盐随哈希携带）校验
    - 无前缀（旧版无盐 sha256 明文）→ 旧逻辑直接比较 sha256，向后兼容现有用户登录
    """
    pwd_context = _get_pwd_context()
    if hashed_password.startswith("$"):
        if pwd_context:
            try:
                return pwd_context.verify(plain_password, hashed_password)
            except Exception:
                pass
        return False

    if hashed_password.startswith("pbkdf2$"):
        try:
            _, algorithm, iterations_str, salt, digest = hashed_password.split("$", 4)
            iterations = int(iterations_str)
            computed = hashlib.pbkdf2_hmac(
                algorithm, plain_password.encode(), salt.encode(), iterations
            ).hex()
            return secrets.compare_digest(computed, digest)
        except (ValueError, TypeError):
            return False

    # 旧版无盐 sha256 明文（向后兼容）
    return hashlib.sha256(plain_password.encode()).hexdigest() == hashed_password


class EncryptionService:
    """API密钥加密服务。"""

    def __init__(self):
        self._key = self._get_or_create_key()
        self._aesgcm = AESGCM(self._key) if HAS_CRYPTOGRAPHY and self._key else None

    def _get_or_create_key(self) -> Optional[bytes]:
        """获取或创建加密密钥。"""
        key_env = settings.ENCRYPTION_KEY
        if key_env:
            try:
                return base64.urlsafe_b64decode(key_env)
            except Exception:
                pass
        
        key_file = os.path.join(DataPaths.get_data_root(), ".encryption_key")
        os.makedirs(os.path.dirname(key_file), exist_ok=True)
        
        if os.path.exists(key_file):
            try:
                with open(key_file, "rb") as f:
                    return f.read()
            except Exception:
                pass
        
        if HAS_CRYPTOGRAPHY:
            key = secrets.token_bytes(32)
            try:
                with open(key_file, "wb") as f:
                    f.write(key)
                os.chmod(key_file, 0o600)
                return key
            except Exception:
                pass
        
        return None

    def encrypt(self, plaintext: str) -> str:
        """加密数据。"""
        if not self._aesgcm or not plaintext:
            return plaintext
        
        try:
            nonce = secrets.token_bytes(12)
            ciphertext = self._aesgcm.encrypt(nonce, plaintext.encode(), None)
            return base64.urlsafe_b64encode(nonce + ciphertext).decode()
        except Exception:
            return plaintext

    def decrypt(self, ciphertext: str) -> str:
        """解密数据。"""
        if not self._aesgcm or not ciphertext:
            return ciphertext
        
        try:
            data = base64.urlsafe_b64decode(ciphertext)
            nonce = data[:12]
            actual_ciphertext = data[12:]
            return self._aesgcm.decrypt(nonce, actual_ciphertext, None).decode()
        except Exception:
            return ciphertext


encryption_service = EncryptionService()


class OptimisticLockError(Exception):
    """乐观锁冲突异常。"""


def check_optimistic_lock(model, version: Optional[int]) -> None:
    if version is not None and model.version != version:
        raise OptimisticLockError(
            f"Optimistic lock conflict: expected version {version}, but current version is {model.version}"
        )


def increment_version(model) -> None:
    model.version = (model.version or 0) + 1
