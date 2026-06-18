from sqlalchemy import Column, Integer, String, Date, DateTime
from datetime import datetime
from app.database import Base


class Profile(Base):
    __tablename__ = "profiles"  # 建议用复数，与表名规范一致

    id = Column(Integer, primary_key=True, index=True)
    family_name = Column(String(50), default="我的家庭")
    due_date = Column(Date, nullable=True)
    baby_birthday = Column(Date, nullable=True)
    
    # Home Assistant 配置
    ha_url = Column(String(200), nullable=True)
    ha_token = Column(String(100), nullable=True)
    ha_auto_sync = Column(Integer, default=0)  # 0=关闭, 1=开启自动同步
    
    # 时间戳
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)