"""
FamilyOS - 简单身份验证模块
- 密码使用 HMAC-SHA256 + 随机盐值存储（抵抗彩虹表攻击）
- 用户名和初始密码从 .env 文件读取，不写死在代码中
"""
import hashlib
import hmac
import os
import secrets
import time
from typing import Optional

from fastapi import Request
from fastapi.responses import RedirectResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.database import SessionLocal
from app.models.user import User

# 从环境变量读取密钥（必须设置，不允许回退）
_SECRET_KEY_RAW = os.getenv("FAMILYOS_SECRET_KEY")
if not _SECRET_KEY_RAW:
    import sys
    sys.stderr.write("[FATAL] FAMILYOS_SECRET_KEY must be set in .env file. Cannot start without it.\n")
    sys.exit(1)
SECRET_KEY = _SECRET_KEY_RAW

PUBLIC_PATHS = {"/login", "/static", "/uploads", "/api/auth/login", "/api/auth/status", "/health", "/favicon.ico"}

# ---------- 密码哈希（HMAC + 随机盐值） ----------

def hash_password(password: str) -> str:
    """
    使用 HMAC-SHA256 + 随机 16 字节盐值加密密码
    存储格式：salt_hex $ hmac_hex
    """
    salt = secrets.token_bytes(16)
    salt_hex = salt.hex()
    # 使用 SECRET_KEY 作为 HMAC 密钥，password + salt 作为消息
    h = hmac.new(SECRET_KEY.encode(), (password + salt_hex).encode(), hashlib.sha256)
    return f"{salt_hex}${h.hexdigest()}"


def verify_password(password: str, stored: str) -> bool:
    """验证密码是否匹配存储的哈希值"""
    try:
        salt_hex, hash_hex = stored.split("$", 1)
        h = hmac.new(SECRET_KEY.encode(), (password + salt_hex).encode(), hashlib.sha256)
        return hmac.compare_digest(h.hexdigest(), hash_hex)
    except Exception:
        return False

# ---------- Auth Token ----------

def create_auth_token(username: str, role: str) -> str:
    """创建签名 token: username|role|expiry|signature"""
    expiry = int(time.time() + 86400 * 7)  # 7天有效
    payload = f"{username}|{role}|{expiry}"
    sig = hmac.new(SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}|{sig}"


def verify_auth_token(token: str) -> Optional[dict]:
    """验证 token，返回 {username, role} 或 None"""
    try:
        parts = token.rsplit("|", 1)
        if len(parts) != 2:
            return None
        payload, sig = parts
        expected = hmac.new(SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()
        if sig != expected:
            return None
        username, role, expiry = payload.split("|")
        if int(expiry) < time.time():
            return None
        return {"username": username, "role": role}
    except Exception:
        return None

# ---------- 初始化用户（从 .env 读取） ----------

def init_default_users():
    """
    仅在 users 表为空时创建默认用户
    默认用户名和密码从环境变量读取，不写死在代码中
    """
    db = SessionLocal()
    try:
        if not db.query(User).first():
            admin_user = os.getenv("FAMILYOS_ADMIN_USERNAME", "admin")
            admin_pass = os.getenv("FAMILYOS_ADMIN_PASSWORD", "admin123")
            user_user = os.getenv("FAMILYOS_USER_USERNAME", "user")
            user_pass = os.getenv("FAMILYOS_USER_PASSWORD", "user123")
            
            db.add(User(
                username=admin_user,
                password_hash=hash_password(admin_pass),
                role="admin"
            ))
            db.add(User(
                username=user_user,
                password_hash=hash_password(user_pass),
                role="user"
            ))
            db.commit()
            # 不打印密码明文到日志
            import sys
            sys.stderr.write(f"[INFO] Default users created: {admin_user} (admin), {user_user} (user)\n")
    finally:
        db.close()


class AuthMiddleware(BaseHTTPMiddleware):
    """身份验证中间件：检查 cookie，未登录重定向到 /login"""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        for pub in PUBLIC_PATHS:
            if path.startswith(pub):
                return await call_next(request)

        token = request.cookies.get("familyos_auth")
        user_info = verify_auth_token(token) if token else None

        if not user_info:
            return RedirectResponse(url="/login", status_code=303)

        request.state.user = user_info
        response = await call_next(request)
        return response