import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

class Config:
    # 数据库
    DATABASE_URL = f"sqlite:///{BASE_DIR}/data/familyos.db"
    
    # 上传目录
    UPLOAD_DIR = BASE_DIR / "uploads"
    
    # 环境
    DEBUG = os.getenv("ENV", "development") == "development"
    
    # Home Assistant 配置（从环境变量读取）
    HA_URL = os.getenv("HA_URL", "")
    HA_TOKEN = os.getenv("HA_TOKEN", "")
    
    # 生命周期阈值（产后42天）
    POSTPARTUM_DAYS = 42

config = Config()