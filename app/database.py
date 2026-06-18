from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base
from sqlalchemy.orm import sessionmaker
from pathlib import Path

# 确保 data 目录存在
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)

DATABASE_URL = f"sqlite:///{DATA_DIR}/familyos.db"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False}
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

Base = declarative_base()


def get_db():
    """依赖注入：获取数据库会话"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _migrate_inventory():
    """为旧版 Inventory 表添加新列（兼容旧 Docker 数据）"""
    new_columns = [
        ("unit_price", "FLOAT"),
        ("total_spent", "FLOAT DEFAULT 0"),
        ("total_purchased", "FLOAT DEFAULT 0"),
        ("total_consumed", "FLOAT DEFAULT 0"),
    ]
    with engine.connect() as conn:
        for col_name, col_type in new_columns:
            try:
                conn.execute(text(f"ALTER TABLE inventory ADD COLUMN {col_name} {col_type}"))
                conn.commit()
            except Exception:
                pass  # 列已存在，跳过


def init_db():
    """初始化数据库，创建所有表 + 自动迁移"""
    from app.models import Profile, Event, Inventory, PurchaseLog
    Base.metadata.create_all(bind=engine)
    _migrate_inventory()