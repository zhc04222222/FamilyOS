from sqlalchemy import Column, Integer, Float, DateTime, String, ForeignKey
from datetime import datetime
from app.database import Base


class PurchaseLog(Base):
    """购买/补货记录"""
    __tablename__ = "purchase_logs"

    id = Column(Integer, primary_key=True, index=True)
    inventory_id = Column(Integer, ForeignKey("inventory.id", ondelete="CASCADE"), nullable=False, index=True)
    quantity = Column(Float, nullable=False)            # 购买数量
    unit_price = Column(Float, nullable=False)           # 单价
    total_price = Column(Float, nullable=False)          # 总价
    purchase_date = Column(DateTime, default=datetime.utcnow)
    note = Column(String(200), nullable=True)            # 备注（如购买渠道、品牌）