from sqlalchemy import Column, Integer, String, DateTime, Text
from datetime import datetime
from app.database import Base


class Picture(Base):
    __tablename__ = "pictures"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String(255), nullable=False)
    original_name = Column(String(255), nullable=False)
    category = Column(String(50), nullable=True)  # 分类（可选）：同EventCategory
    event_id = Column(Integer, nullable=True)  # 关联的事件ID（可选）
    upload_time = Column(DateTime, default=datetime.utcnow)
    mime_type = Column(String(50), nullable=True)
    file_size = Column(Integer, nullable=True)  # 文件大小（字节）