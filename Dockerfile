# ================================================================
# FamilyOS - Dockerfile
# ================================================================

FROM python:3.11-slim

# 设置工作目录
WORKDIR /app

# 设置环境变量
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=Asia/Shanghai

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖文件
COPY requirements.txt .

# 安装 Python 依赖
RUN pip install --no-cache-dir -r requirements.txt

# 复制整个 app 目录
COPY app/ ./app/

# 创建运行时数据目录（数据库和上传文件将通过 volume 挂载）
RUN mkdir -p /app/data /app/uploads && \
    chmod 755 /app/data /app/uploads

# 创建非 root 用户
RUN useradd --create-home --shell /bin/bash appuser && \
    chown -R appuser:appuser /app

# 切换到非 root 用户
USER appuser

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:29375 || exit 1

# 暴露端口
EXPOSE 29375

# 启动命令
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "29375"]
