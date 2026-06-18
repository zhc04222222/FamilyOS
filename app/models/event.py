from sqlalchemy import Column, Integer, String, DateTime, Text, Enum, Date, Float
from datetime import datetime
from app.database import Base
import enum


class EventCategory(str, enum.Enum):
    """事件分类枚举"""
    CHECKUP = "checkup"      # 产检
    FEEDING = "feeding"      # 喂奶
    SLEEP = "sleep"          # 睡眠
    DIAPER = "diaper"        # 尿布
    BATH = "bath"            # 洗澡
    VACCINE = "vaccine"      # 疫苗
    GROWTH = "growth"        # 成长记录
    TASK = "task"            # 待办任务


class Event(Base):
    __tablename__ = "events"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(100), nullable=False)
    category = Column(Enum(EventCategory), nullable=False)
    phase = Column(String(20), nullable=False)  # pregnancy / postpartum / infant
    start_time = Column(DateTime, nullable=False)
    end_time = Column(DateTime, nullable=True)
    content = Column(Text, nullable=True)
    quantity_value = Column(Float, nullable=True)   # 数量值（喂奶ml / 睡眠h）
    quantity_unit = Column(String(20), nullable=True)  # 单位（ml / h）
    status = Column(String(20), default="pending")  # pending / done / cancelled
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
