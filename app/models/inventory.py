from sqlalchemy import Column, Integer, String, Float, DateTime
from sqlalchemy.orm import relationship
from datetime import datetime
from app.database import Base


class Inventory(Base):
    __tablename__ = "inventory"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), nullable=False, unique=True)
    quantity = Column(Float, default=0)
    warning_quantity = Column(Float, default=5)
    unit = Column(String(10), default="件")
    daily_use = Column(Float, default=0)
    # ====== 造价/开销统计 ======
    unit_price = Column(Float, nullable=True)        # 最近一次购买单价
    total_spent = Column(Float, default=0)           # 累计花费总额
    total_purchased = Column(Float, default=0)        # 累计购买总量
    total_consumed = Column(Float, default=0)         # 累计消耗总量
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # 级联删除 PurchaseLog
    purchase_logs = relationship(
        "PurchaseLog", cascade="all, delete-orphan", backref="inventory"
    )