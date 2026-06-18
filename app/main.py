from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Request, Depends, Form
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import RedirectResponse, JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
from contextlib import asynccontextmanager
from datetime import datetime, date
from typing import Optional
from collections import defaultdict
import time

from app.database import engine, get_db, Base, init_db
from app.services.lifecycle import current_phase, get_phase_display
from app.models import Profile, Event, EventCategory, Inventory, Picture, PurchaseLog, User
from app.auth import (
    AuthMiddleware, init_default_users, hash_password, verify_password,
    create_auth_token, verify_auth_token
)

from datetime import datetime, date, timedelta
import pytz

# ============ Home Assistant 集成 ============

import httpx
import json
import uuid
import os
import asyncio
from pathlib import Path

# 初始化数据库
init_db()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时初始化默认家庭档案
    db = next(get_db())
    if not db.query(Profile).first():
        default_profile = Profile(family_name="我的家庭")
        db.add(default_profile)
        db.commit()
    yield

app = FastAPI(
    title="FamilyOS",
    version="1.0.0",
    lifespan=lifespan
)

# ============ 身份验证中间件 ============
app.add_middleware(AuthMiddleware)
# 初始化默认用户
init_default_users()

# 静态文件
app.mount("/static", StaticFiles(directory="app/static"), name="static")

# 上传文件目录
UPLOADS_DIR = Path(__file__).resolve().parent.parent / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")

# 模板
templates = Jinja2Templates(directory="app/templates")

# ============ 身份验证辅助 ============

def require_admin(request: Request):
    """检查是否为管理员，非管理员返回 False"""
    user = getattr(request.state, "user", None)
    return user and user.get("role") == "admin"

# ============ 登录频率限制 ============

_login_attempts: defaultdict = defaultdict(list)  # ip -> [timestamps]

LOGIN_MAX_ATTEMPTS = 5       # 1 分钟内最多尝试次数
LOGIN_WINDOW_SEC = 60        # 计数窗口（秒）
LOGIN_LOCKOUT_SEC = 300      # 锁定时间（秒）


def check_login_rate(ip: str) -> bool:
    """检查 IP 是否超过登录频率限制，返回 True 表示允许"""
    now = time.time()
    attempts = _login_attempts[ip]

    # 清除过期记录
    cutoff = now - LOGIN_WINDOW_SEC
    _login_attempts[ip] = [t for t in attempts if t > cutoff]

    # 如果在锁定时间内（最近一次超过限制后）
    if len(_login_attempts[ip]) >= LOGIN_MAX_ATTEMPTS:
        last_attempt = _login_attempts[ip][-1]
        if now - last_attempt < LOGIN_LOCKOUT_SEC:
            return False
        # 锁定期满，清空重建
        _login_attempts[ip] = []

    return True


def record_login_attempt(ip: str):
    """记录一次登录尝试"""
    _login_attempts[ip].append(time.time())


# ============ 登录/登出 ============

@app.get("/login")
async def login_page(request: Request):
    """登录页面（公开访问）"""
    return templates.TemplateResponse("login.html", {"request": request})

@app.post("/api/auth/login")
async def api_login(request: Request, db: Session = Depends(get_db)):
    """登录接口（含登录频率限制）"""
    ip = request.client.host if request.client else "unknown"

    # 频率检查
    if not check_login_rate(ip):
        return JSONResponse(
            {"success": False, "error": "登录过于频繁，请 5 分钟后再试"},
            status_code=429
        )

    try:
        data = await request.json()
        username = data.get("username", "").strip()
        password = data.get("password", "")
    except Exception:
        return {"success": False, "error": "请求格式错误"}
    
    if not username or not password:
        record_login_attempt(ip)
        return {"success": False, "error": "请输入用户名和密码"}
    
    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(password, user.password_hash):
        record_login_attempt(ip)
        return {"success": False, "error": "用户名或密码错误"}
    
    # 登录成功，清除该 IP 的失败记录
    _login_attempts.pop(ip, None)

    token = create_auth_token(user.username, user.role)
    remember = data.get("remember_me", False)
    max_age = 86400 * 30 if remember else 86400 * 7  # 记住密码30天，否则7天
    response = JSONResponse({"success": True, "role": user.role, "username": user.username})
    response.set_cookie(
        key="familyos_auth",
        value=token,
        max_age=max_age,
        httponly=True,
        samesite="lax"
    )
    return response

@app.post("/api/auth/change-password")
async def api_change_password(request: Request, db: Session = Depends(get_db)):
    """修改当前登录用户的密码"""
    user_info = getattr(request.state, "user", None)
    if not user_info:
        return {"success": False, "error": "未登录"}
    
    try:
        data = await request.json()
        old_password = data.get("old_password", "")
        new_password = data.get("new_password", "").strip()
    except Exception:
        return {"success": False, "error": "请求格式错误"}
    
    if not old_password:
        return {"success": False, "error": "请输入旧密码"}
    
    if not new_password or len(new_password) < 8:
        return {"success": False, "error": "新密码至少8位"}
    
    user = db.query(User).filter(User.username == user_info["username"]).first()
    if not user:
        return {"success": False, "error": "用户不存在"}
    
    # 验证旧密码
    if not verify_password(old_password, user.password_hash):
        return {"success": False, "error": "旧密码不正确"}
    
    user.password_hash = hash_password(new_password)
    db.commit()
    return {"success": True}

@app.get("/api/auth/logout")
async def api_logout():
    """登出"""
    response = RedirectResponse(url="/login", status_code=303)
    response.delete_cookie("familyos_auth")
    return response

@app.get("/api/auth/status")
async def api_auth_status(request: Request):
    """获取当前登录状态"""
    user = getattr(request.state, "user", None)
    if user:
        return {"logged_in": True, "username": user["username"], "role": user["role"]}
    return {"logged_in": False}

# ============ 辅助函数 ============
def get_profile(db: Session) -> Profile:
    """获取或创建默认档案"""
    profile = db.query(Profile).first()
    if not profile:
        profile = Profile(family_name="我的家庭")
        db.add(profile)
        db.commit()
        db.refresh(profile)
    return profile

def get_category_label(category: EventCategory) -> str:
    """获取分类的中文标签"""
    labels = {
        EventCategory.CHECKUP: "🩺 产检",
        EventCategory.FEEDING: "🍼 喂奶",
        EventCategory.SLEEP: "😴 睡眠",
        EventCategory.DIAPER: "🧻 尿布",
        EventCategory.BATH: "🛁 洗澡",
        EventCategory.VACCINE: "💉 疫苗",
        EventCategory.GROWTH: "📈 成长",
        EventCategory.TASK: "📌 任务"
    }
    return labels.get(category, category.value)


# ============ 时区工具函数 ============
def to_local_iso(dt: datetime) -> str:
    """将 datetime 转换为带 +08:00 时区的 ISO 字符串"""
    if dt is None:
        return None
    
    # 如果 dt 没有时区信息，添加 Asia/Shanghai 时区
    if dt.tzinfo is None:
        tz = pytz.timezone('Asia/Shanghai')
        dt = tz.localize(dt)
    
    # 返回 ISO 格式，保持 +08:00
    return dt.isoformat()

def now_local() -> datetime:
    """获取当前本地时间（带时区）"""
    tz = pytz.timezone('Asia/Shanghai')
    return datetime.now(tz)
# ============ 页面路由 ============

@app.get("/")
async def home(request: Request, db: Session = Depends(get_db)):
    profile = get_profile(db)
    phase = current_phase(profile)
    
    # 计算统计数据
    days_until = None
    days_since_birth = None
    months_old = None
    
    if profile.due_date:
        days_until = (profile.due_date - date.today()).days
        if days_until < 0:
            days_until = 0
    
    if profile.baby_birthday:
        days_since_birth = (date.today() - profile.baby_birthday).days
        if days_since_birth < 0:
            days_since_birth = 0
        months_old = days_since_birth // 30 if days_since_birth > 0 else 0
    
    # 获取最近的记录
    recent_events = db.query(Event).order_by(Event.start_time.desc()).limit(5).all()
    
    # 获取库存预警
    warning_items = db.query(Inventory).filter(
        Inventory.quantity <= Inventory.warning_quantity
    ).all()
    
    return templates.TemplateResponse(
        request=request,
        name="home.html",
        context={
            "profile": profile,
            "phase": phase,
            "phase_display": get_phase_display(phase),
            "active_menu": "home",
            "days_until": days_until,
            "days_since_birth": days_since_birth,
            "months_old": months_old,
            "recent_events": recent_events,
            "warning_items": warning_items
        }
    )

@app.get("/records")
async def records_page(request: Request, db: Session = Depends(get_db)):
    profile = get_profile(db)
    phase = current_phase(profile)
    events = db.query(Event).order_by(Event.start_time.desc()).all()
    
    return templates.TemplateResponse(
        request=request,
        name="records.html",
        context={
            "profile": profile,
            "phase": phase,
            "phase_display": get_phase_display(phase),
            "active_menu": "records",
            "events": events,
            "get_category_label": get_category_label
        }
    )

@app.get("/inventory")
async def inventory_page(request: Request, db: Session = Depends(get_db)):
    profile = get_profile(db)
    phase = current_phase(profile)
    items = db.query(Inventory).all()
    
    return templates.TemplateResponse(
        request=request,
        name="inventory.html",
        context={
            "profile": profile,
            "phase": phase,
            "phase_display": get_phase_display(phase),
            "active_menu": "inventory",
            "items": items
        }
    )

@app.get("/pictures")
async def picture_page(request: Request, db: Session = Depends(get_db)):
    profile = get_profile(db)
    phase = current_phase(profile)

    return templates.TemplateResponse(
        request=request,
        name="picture.html",
        context={
            "profile": profile,
            "phase": phase,
            "phase_display": get_phase_display(phase),
            "active_menu": "pictures"
        }
    )

@app.get("/stats")
async def stats_page(request: Request, db: Session = Depends(get_db)):
    profile = get_profile(db)
    phase = current_phase(profile)
    
    return templates.TemplateResponse(
        request=request,
        name="stats.html",
        context={
            "profile": profile,
            "phase": phase,
            "phase_display": get_phase_display(phase),
            "active_menu": "stats"
        }
    )

@app.get("/stats/inventory")
async def stats_inventory_page(request: Request, db: Session = Depends(get_db)):
    profile = get_profile(db)
    phase = current_phase(profile)
    
    return templates.TemplateResponse(
        request=request,
        name="stats_inventory.html",
        context={
            "profile": profile,
            "phase": phase,
            "phase_display": get_phase_display(phase),
            "active_menu": "stats_inventory"
        }
    )

@app.get("/settings")
async def settings_page(request: Request, db: Session = Depends(get_db)):
    profile = get_profile(db)
    phase = current_phase(profile)
    is_admin = require_admin(request)
    
    return templates.TemplateResponse(
        request=request,
        name="settings.html",
        context={
            "profile": profile,
            "phase": phase,
            "phase_display": get_phase_display(phase),
            "active_menu": "settings",
            "is_admin": is_admin
        }
    )

# ============ API 路由（记录） ============

@app.get("/api/events")
async def get_events(db: Session = Depends(get_db)):
    events = db.query(Event).order_by(Event.start_time.desc()).all()
    # 预加载所有照片计数（一次性查询，避免 N+1）
    photo_counts = {}
    all_pics = db.query(Picture.event_id, func.count(Picture.id)).group_by(Picture.event_id).all()
    for event_id, cnt in all_pics:
        photo_counts[event_id] = cnt
    
    return [
        {
            "id": e.id,
            "title": e.title,
            "category": e.category.value,
            "category_label": get_category_label(e.category),
            "phase": e.phase,
            "start_time": to_local_iso(e.start_time),
            "end_time": to_local_iso(e.end_time) if e.end_time else None,
            "content": e.content,
            "quantity_value": e.quantity_value,
            "quantity_unit": e.quantity_unit,
            "status": e.status,
            "photo_count": photo_counts.get(e.id, 0)
        }
        for e in events
    ]

@app.post("/api/events")
async def create_event(
    title: str = Form(...),
    category: str = Form(...),
    start_time: str = Form(...),
    content: Optional[str] = Form(None),
    quantity_value: Optional[float] = Form(None),
    quantity_unit: Optional[str] = Form(None),
    db: Session = Depends(get_db)
):
    profile = get_profile(db)
    phase = current_phase(profile)
    
    try:
        event = Event(
            title=title,
            category=EventCategory(category),
            phase=phase,
            start_time=datetime.fromisoformat(start_time.replace('Z', '+00:00')),
            content=content,
            quantity_value=quantity_value,
            quantity_unit=quantity_unit
        )
        db.add(event)
        db.commit()
        db.refresh(event)
        return {"success": True, "id": event.id}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.delete("/api/events/{event_id}")
async def delete_event(request: Request, event_id: int, db: Session = Depends(get_db)):
    # 检查权限：仅管理员可删除
    if not require_admin(request):
        return {"success": False, "error": "无权限：仅管理员可删除记录"}
    event = db.query(Event).filter(Event.id == event_id).first()
    if event:
        # 级联删除关联的照片
        pictures = db.query(Picture).filter(Picture.event_id == event_id).all()
        for pic in pictures:
            file_path = UPLOADS_DIR / pic.filename
            if file_path.exists():
                try:
                    os.remove(file_path)
                except Exception:
                    pass
            db.delete(pic)
        db.delete(event)
        db.commit()
        return {"success": True}
    return {"success": False, "error": "事件不存在"}


@app.put("/api/events/{event_id}/status")
async def update_event_status(
    event_id: int,
    status: str = Form(...),
    db: Session = Depends(get_db)
):
    """更新事件状态（待办/已完成）"""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        return {"success": False, "error": "事件不存在"}
    
    if status not in ["pending", "done", "cancelled"]:
        return {"success": False, "error": "无效的状态值"}
    
    event.status = status
    db.commit()
    return {"success": True}

# ============ API 路由（库存） ============

@app.get("/api/inventory")
async def get_inventory(db: Session = Depends(get_db)):
    items = db.query(Inventory).all()
    return [
        {
            "id": i.id,
            "name": i.name,
            "quantity": i.quantity,
            "warning_quantity": i.warning_quantity,
            "unit": i.unit,
            "daily_use": i.daily_use,
            "is_warning": i.quantity <= i.warning_quantity
        }
        for i in items
    ]

@app.post("/api/inventory")
async def create_inventory_item(
    name: str = Form(...),
    quantity: float = Form(...),
    warning_quantity: float = Form(5),
    unit: str = Form("件"),
    daily_use: float = Form(0),
    db: Session = Depends(get_db)
):
    # 检查是否已存在
    existing = db.query(Inventory).filter(Inventory.name == name).first()
    if existing:
        return {"success": False, "error": "物品已存在"}
    
    item = Inventory(
        name=name,
        quantity=quantity,
        warning_quantity=warning_quantity,
        unit=unit,
        daily_use=daily_use
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    # 新增物品 → 后台推送这一个到 HA（不阻塞响应）
    asyncio.create_task(_sync_single_inventory_item(item.id, db))
    return {"success": True, "id": item.id}

@app.put("/api/inventory/{item_id}")
async def update_inventory_quantity(
    item_id: int,
    quantity: float = Form(...),
    db: Session = Depends(get_db)
):
    item = db.query(Inventory).filter(Inventory.id == item_id).first()
    if not item:
        return {"success": False, "error": "物品不存在"}
    
    # 记录旧状态，用于判断是否需要推送 HA
    old_is_warning = item.quantity <= item.warning_quantity
    old_quantity = item.quantity
    
    item.quantity = quantity
    db.commit()
    
    # 只有预警状态发生翻转时才后台推送这一个物品到 HA
    new_is_warning = quantity <= item.warning_quantity
    if old_is_warning != new_is_warning:
        asyncio.create_task(_sync_single_inventory_item(item_id, db))
    
    return {"success": True}

@app.delete("/api/inventory/{item_id}")
async def delete_inventory_item(request: Request, item_id: int, db: Session = Depends(get_db)):
    if not require_admin(request):
        return {"success": False, "error": "无权限：仅管理员可删除物品"}
    item = db.query(Inventory).filter(Inventory.id == item_id).first()
    if item:
        # 先取出物品信息（db.delete 后 item 会过期）
        item_name = item.name
        item_id_for_ha = item.id
        
        db.delete(item)
        db.commit()
        
        # 删除后后台通知 HA 将该实体标记为不可用
        profile = get_profile(db)
        if profile.ha_url and profile.ha_token and profile.ha_auto_sync:
            asyncio.create_task(_sync_inventory_deleted_to_ha(item_id_for_ha, item_name, profile))
        
        return {"success": True}
    return {"success": False, "error": "物品不存在"}

# ============ API 路由（库存 — 消耗 / 补货） ============

@app.put("/api/inventory/{item_id}/consume")
async def consume_inventory_item(
    item_id: int,
    quantity: float = Form(...),
    db: Session = Depends(get_db)
):
    """消耗物品（减库存 + 记消耗总量）"""
    item = db.query(Inventory).filter(Inventory.id == item_id).first()
    if not item:
        return {"success": False, "error": "物品不存在"}
    
    consume_amount = abs(quantity)
    old_is_warning = item.quantity <= item.warning_quantity
    
    item.quantity -= consume_amount
    if item.quantity < 0:
        item.quantity = 0
    item.total_consumed = (item.total_consumed or 0) + consume_amount
    db.commit()
    
    new_is_warning = item.quantity <= item.warning_quantity
    if old_is_warning != new_is_warning:
        asyncio.create_task(_sync_single_inventory_item(item_id, db))
    
    return {"success": True, "quantity": item.quantity}

@app.post("/api/inventory/{item_id}/purchase")
async def purchase_inventory_item(
    item_id: int,
    quantity: float = Form(...),
    unit_price: float = Form(...),
    note: str = Form(""),
    db: Session = Depends(get_db)
):
    """补货（加库存 + 记购买记录 + 更新造价）"""
    item = db.query(Inventory).filter(Inventory.id == item_id).first()
    if not item:
        return {"success": False, "error": "物品不存在"}
    
    purchase_qty = abs(quantity)
    total_price = round(purchase_qty * unit_price, 2)
    old_is_warning = item.quantity <= item.warning_quantity
    
    # 更新库存
    item.quantity += purchase_qty
    item.unit_price = unit_price
    item.total_spent = (item.total_spent or 0) + total_price
    item.total_purchased = (item.total_purchased or 0) + purchase_qty
    
    # 记录购买日志
    log = PurchaseLog(
        inventory_id=item_id,
        quantity=purchase_qty,
        unit_price=unit_price,
        total_price=total_price,
        note=note or None
    )
    db.add(log)
    db.commit()
    
    new_is_warning = item.quantity <= item.warning_quantity
    if old_is_warning != new_is_warning:
        asyncio.create_task(_sync_single_inventory_item(item_id, db))
    
    return {"success": True, "quantity": item.quantity, "total_price": total_price}

@app.get("/api/inventory/{item_id}/purchases")
async def get_purchase_history(item_id: int, db: Session = Depends(get_db)):
    """获取某个物品的购买历史"""
    logs = db.query(PurchaseLog).filter(
        PurchaseLog.inventory_id == item_id
    ).order_by(PurchaseLog.purchase_date.desc()).all()
    
    return [
        {
            "id": l.id,
            "quantity": l.quantity,
            "unit_price": l.unit_price,
            "total_price": l.total_price,
            "purchase_date": to_local_iso(l.purchase_date),
            "note": l.note
        }
        for l in logs
    ]

# ============ API 路由（统计） ============

@app.get("/api/stats/summary")
async def get_stats_summary(db: Session = Depends(get_db)):
    """整体统计：总消费、月消费、日均消费、各品类情况"""
    items = db.query(Inventory).all()
    all_logs = db.query(PurchaseLog).order_by(PurchaseLog.purchase_date.asc()).all()
    
    # 总消费
    total_spent = sum((i.total_spent or 0) for i in items)
    
    # 本月消费
    now = datetime.utcnow()
    month_start = datetime(now.year, now.month, 1)
    month_logs = db.query(PurchaseLog).filter(
        PurchaseLog.purchase_date >= month_start
    ).all()
    month_spent = sum(l.total_price or 0 for l in month_logs)
    
    # 平均每日消费（如果从未购买过则从首次购买日期算起）
    avg_daily_spent = 0.0
    if all_logs and len(all_logs) > 0:
        first_purchase_date = all_logs[0].purchase_date.date()
        total_days = (date.today() - first_purchase_date).days
        if total_days <= 0:
            total_days = 1
        avg_daily_spent = round(total_spent / total_days, 2)
    
    return {
        "total_spent": round(total_spent, 2),
        "month_spent": round(month_spent, 2),
        "avg_daily_spent": avg_daily_spent,
        "total_items": len(items),
        "warning_count": sum(1 for i in items if i.quantity <= i.warning_quantity),
        "items": [
            {
                "id": i.id,
                "name": i.name,
                "quantity": i.quantity,
                "unit": i.unit,
                "unit_price": i.unit_price,
                "total_spent": i.total_spent or 0,
                "total_purchased": i.total_purchased or 0,
                "total_consumed": i.total_consumed or 0,
                "is_warning": i.quantity <= i.warning_quantity
            }
            for i in items
        ]
    }

@app.get("/api/stats/events")
async def get_stats_events(
    days: int = 30,
    db: Session = Depends(get_db)
):
    """事件统计：喂奶/睡眠/尿布/成长等"""
    since = datetime.utcnow() - timedelta(days=days)
    
    events = db.query(Event).filter(
        Event.start_time >= since,
        Event.category.in_([
            EventCategory.FEEDING,
            EventCategory.SLEEP,
            EventCategory.DIAPER,
            EventCategory.BATH,
            EventCategory.GROWTH,
            EventCategory.VACCINE,
            EventCategory.TASK
        ])
    ).order_by(Event.start_time.asc()).all()
    
    # 按分类汇总
    feeding_total = 0.0   # 总奶量 ml
    feeding_count = 0
    sleep_total = 0.0     # 总睡眠时长 h
    sleep_count = 0
    diaper_count = 0
    bath_count = 0
    growth_count = 0
    vaccine_count = 0
    task_done = 0
    task_total = 0
    
    daily_diaper = {}     # 日期 → 次数
    daily_feeding = {}    # 日期 → 奶量
    daily_sleep = {}      # 日期 → 时长
    
    for e in events:
        day_key = e.start_time.strftime("%m-%d")
        if e.category == EventCategory.FEEDING:
            feeding_count += 1
            if e.quantity_value:
                feeding_total += e.quantity_value
                daily_feeding[day_key] = daily_feeding.get(day_key, 0) + e.quantity_value
        elif e.category == EventCategory.SLEEP:
            sleep_count += 1
            if e.quantity_value:
                sleep_total += e.quantity_value
                daily_sleep[day_key] = daily_sleep.get(day_key, 0) + e.quantity_value
        elif e.category == EventCategory.DIAPER:
            diaper_count += 1
            daily_diaper[day_key] = daily_diaper.get(day_key, 0) + 1
        elif e.category == EventCategory.BATH:
            bath_count += 1
        elif e.category == EventCategory.GROWTH:
            growth_count += 1
        elif e.category == EventCategory.VACCINE:
            vaccine_count += 1
        elif e.category == EventCategory.TASK:
            task_total += 1
            if e.status == "done":
                task_done += 1
    
    return {
        "days": days,
        "feeding": {
            "count": feeding_count,
            "total": round(feeding_total, 1),
            "avg": round(feeding_total / feeding_count, 1) if feeding_count > 0 else 0,
            "daily": [{"date": k, "value": v} for k, v in sorted(daily_feeding.items())]
        },
        "sleep": {
            "count": sleep_count,
            "total": round(sleep_total, 1),
            "avg": round(sleep_total / sleep_count, 1) if sleep_count > 0 else 0,
            "daily": [{"date": k, "value": v} for k, v in sorted(daily_sleep.items())]
        },
        "diaper": {
            "count": diaper_count,
            "avg": round(diaper_count / days, 1),
            "daily": [{"date": k, "value": v} for k, v in sorted(daily_diaper.items())]
        },
        "bath": {"count": bath_count},
        "growth": {"count": growth_count},
        "vaccine": {"count": vaccine_count},
        "task": {
            "total": task_total,
            "done": task_done,
            "rate": round(task_done / task_total * 100, 1) if task_total > 0 else 0
        }
    }

# ============ 设置更新 ============

@app.post("/settings/update")
async def update_settings(
    request: Request,
    family_name: str = Form(...),
    due_date: Optional[str] = Form(None),
    baby_birthday: Optional[str] = Form(None),
    ha_url: Optional[str] = Form(None),
    ha_token: Optional[str] = Form(None),
    ha_auto_sync: Optional[str] = Form(None),
    db: Session = Depends(get_db)
):
    profile = get_profile(db)
    is_admin = require_admin(request)
    
    profile.family_name = family_name
    
    if due_date:
        profile.due_date = datetime.strptime(due_date, "%Y-%m-%d").date()
    else:
        profile.due_date = None
    
    if baby_birthday:
        profile.baby_birthday = datetime.strptime(baby_birthday, "%Y-%m-%d").date()
    else:
        profile.baby_birthday = None
    
    # HA 配置仅管理员可修改
    if is_admin:
        profile.ha_url = ha_url or None
        profile.ha_token = ha_token or None
        profile.ha_auto_sync = 1 if ha_auto_sync else 0
    
    db.commit()
    
    return RedirectResponse(url="/settings", status_code=303)

# ============ 健康检查 ============

@app.get("/health")
async def health_check(db: Session = Depends(get_db)):
    profile = get_profile(db)
    phase = current_phase(profile)
    return {
        "status": "ok",
        "version": "1.0.0",
        "phase": phase,
        "phase_display": get_phase_display(phase)
    }
# ============ API 路由（首页数据） ============

@app.get("/api/events/calendar")
async def get_calendar_events(db: Session = Depends(get_db)):
    """获取日历事件（只返回当前阶段）"""
    profile = get_profile(db)
    phase = current_phase(profile)
    
    events = db.query(Event).filter(Event.phase == phase).all()
    
    color_map = {
        "checkup": "#d69e2e",
        "feeding": "#48bb78",
        "sleep": "#4299e1",
        "diaper": "#9f7aea",
        "bath": "#ed64a6",
        "vaccine": "#e53e3e",
        "growth": "#38a169",
        "task": "#ed8936"
    }
    
    return [
        {
            "id": e.id,
            "title": e.title,
            "start": to_local_iso(e.start_time),
            "end": to_local_iso(e.end_time) if e.end_time else None,
            "color": color_map.get(e.category.value, "#718096"),
            "extendedProps": {
                "category": e.category.value,
                "category_label": get_category_label(e.category),
                "phase": e.phase,
                "content": e.content,
                "quantity_value": e.quantity_value,
                "quantity_unit": e.quantity_unit,
                "status": e.status
            }
        }
        for e in events
    ]
    

@app.get("/api/events/timeline")
async def get_timeline_events(db: Session = Depends(get_db)):
    """获取时间轴数据（月子视图）"""
    profile = get_profile(db)
    phase = current_phase(profile)
    
    if phase != "postpartum":
        return []
    
    from datetime import timedelta
    start_date = date.today() - timedelta(days=7)
    
    events = db.query(Event).filter(
        Event.phase == "postpartum",
        Event.start_time >= start_date,
        Event.category.in_([EventCategory.FEEDING, EventCategory.SLEEP, 
                           EventCategory.DIAPER, EventCategory.BATH])
    ).order_by(Event.start_time.desc()).all()
    
    return [
        {
            "id": e.id,
            "title": e.title,
            "category": e.category.value,
            "category_label": get_category_label(e.category),
            "start_time": to_local_iso(e.start_time),
            "content": e.content,
            "quantity_value": e.quantity_value,
            "quantity_unit": e.quantity_unit,
            "status": e.status
        }
        for e in events
    ]


@app.get("/api/events/tasks")
async def get_task_events(db: Session = Depends(get_db)):
    """获取任务看板数据（育儿视图）"""
    profile = get_profile(db)
    phase = current_phase(profile)
    
    if phase != "infant":
        return []
    
    events = db.query(Event).filter(
        Event.phase == "infant",
        Event.category.in_([EventCategory.VACCINE, EventCategory.GROWTH, EventCategory.TASK])
    ).order_by(Event.start_time.asc()).all()
    
    return [
        {
            "id": e.id,
            "title": e.title,
            "category": e.category.value,
            "category_label": get_category_label(e.category),
            "start_time": to_local_iso(e.start_time),
            "content": e.content,
            "quantity_value": e.quantity_value,
            "quantity_unit": e.quantity_unit,
            "status": e.status
        }
        for e in events
    ]


@app.post("/api/events/quick")
async def quick_add_event(
    title: str = Form(...),
    category: str = Form(...),
    start_time: str = Form(...),
    content: Optional[str] = Form(None),
    quantity_value: Optional[float] = Form(None),
    quantity_unit: Optional[str] = Form(None),
    db: Session = Depends(get_db)
):
    """快速添加事件（自动使用当前阶段）"""
    profile = get_profile(db)
    phase = current_phase(profile)
    
    try:
        # 解析时区，转换为本地时间
        dt = datetime.fromisoformat(start_time.replace('Z', '+00:00'))
        
        # 如果客户端传的是 UTC 时间，转为本地时间（+8小时）
        if dt.tzinfo is not None:
            tz = pytz.timezone('Asia/Shanghai')
            dt = dt.astimezone(tz)
            dt = dt.replace(tzinfo=None)
        else:
            pass
        
        # 睡眠记录：用户输入的是醒来的时间+时长，推算入睡时间
        if category == "sleep" and quantity_value and quantity_value > 0:
            dt = dt - timedelta(hours=quantity_value)
            # 设置 content 为"推算入睡时间"
            if not content:
                wake_time = dt + timedelta(hours=quantity_value)
                content = f"醒来 {wake_time.strftime('%H:%M')}，睡了{quantity_value}小时"
        
        # 月子期所有记录默认已完成；育儿期喂奶/睡眠也默认已完成
        if phase == "postpartum":
            default_status = "done"
        elif phase == "infant" and category in ("feeding", "sleep"):
            default_status = "done"
        else:
            default_status = "pending"
        
        event = Event(
            title=title,
            category=EventCategory(category),
            phase=phase,
            start_time=dt,
            content=content,
            quantity_value=quantity_value,
            quantity_unit=quantity_unit,
            status=default_status
        )
        db.add(event)
        db.commit()
        db.refresh(event)
        # 自动同步日历到 HA（异步后台，不阻塞响应）
        if profile.ha_auto_sync and profile.ha_url and profile.ha_token:
            asyncio.create_task(_sync_calendar_to_ha_impl(db))
        
        return {"success": True, "id": event.id}
    except Exception as e:
        return {"success": False, "error": str(e)}

# ============ HA 自动同步辅助函数 ============

async def auto_sync_inventory_ha(db: Session):
    """自动同步库存到 HA（全量，已废弃——改为按需单件同步，保留供手动按钮调用链兼容）"""
    profile = get_profile(db)
    if profile.ha_auto_sync and profile.ha_url and profile.ha_token:
        try:
            await _sync_inventory_to_ha_impl(db)
        except Exception as e:
            print(f"[HA-SYNC] inventory sync failed: {e}", flush=True)

async def _sync_single_inventory_item(item_id: int, db: Session):
    """只同步单个库存物品到 Home Assistant"""
    profile = get_profile(db)
    if not profile.ha_auto_sync or not profile.ha_url or not profile.ha_token:
        return

    item = db.query(Inventory).filter(Inventory.id == item_id).first()
    if not item:
        return

    url = profile.ha_url.rstrip('/')
    token = profile.ha_token
    is_warning = item.quantity <= item.warning_quantity
    entity_id = f"binary_sensor.familyos_inventory_{item.id}"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }
            sensor_data = {
                "state": "on" if is_warning else "off",
                "attributes": {
                    "friendly_name": f"📦 {item.name}",
                    "warning": is_warning,
                    "message": f"{item.name}需要补货" if is_warning else f"{item.name}库存充足",
                    "icon": "mdi:package-variant-closed-alert" if is_warning else "mdi:package-variant-closed"
                }
            }
            await client.post(
                f"{url}/api/states/{entity_id}",
                headers=headers,
                json=sensor_data
            )
    except Exception as e:
        print(f"[HA-SYNC] single item sync failed for {item.name}: {e}", flush=True)

async def _sync_inventory_deleted_to_ha(item_id: int, item_name: str, profile: Profile):
    """通知 Home Assistant 某个库存物品已被删除（标记实体为不可用）"""
    url = profile.ha_url.rstrip('/')
    token = profile.ha_token
    entity_id = f"binary_sensor.familyos_inventory_{item_id}"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }
            sensor_data = {
                "state": "unavailable",
                "attributes": {
                    "friendly_name": f"📦 {item_name}（已移除）",
                    "warning": False,
                    "message": f"{item_name}已从库存中移除",
                    "icon": "mdi:package-variant-closed-remove"
                }
            }
            await client.post(
                f"{url}/api/states/{entity_id}",
                headers=headers,
                json=sensor_data
            )
    except Exception as e:
        print(f"[HA-SYNC] delete sync failed for {item_name}: {e}", flush=True)
    
# ============ Home Assistant 测试连接 ============

@app.post("/api/ha/test")
async def test_ha_connection(
    request: Request
):
    """测试 Home Assistant 连接（仅管理员）"""
    if not require_admin(request):
        return {"success": False, "error": "无权限：仅管理员可操作"}
    try:
        data = await request.json()
    except:
        return {"success": False, "error": "无效的请求数据"}
    
    url = data.get('url')
    token = data.get('token')
    
    if not url or not token:
        return {"success": False, "error": "请填写地址和令牌"}
    
    url = url.rstrip('/')
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            headers = {"Authorization": f"Bearer {token}"}
            response = await client.get(f"{url}/api/", headers=headers)
            
            if response.status_code in [200, 201]:
                return {"success": True, "message": "连接成功"}
            else:
                return {"success": False, "error": f"连接失败：HTTP {response.status_code}"}
    except httpx.ConnectError:
        return {"success": False, "error": "无法连接到 HA，请检查地址"}
    except httpx.TimeoutException:
        return {"success": False, "error": "连接超时"}
    except Exception as e:
        return {"success": False, "error": str(e)}
    
        
async def _sync_calendar_to_ha_impl(db: Session):
    """同步日历事件到 Home Assistant（内部实现）"""
    profile = get_profile(db)
    
    if not profile.ha_url or not profile.ha_token:
        return {"success": False, "error": "请先在设置中配置 HA"}
    
    url = profile.ha_url.rstrip('/')
    token = profile.ha_token
    
    # 获取未来60天的事件（FamilyOS 侧）
    end_date = date.today() + timedelta(days=60)
    events = db.query(Event).filter(
        Event.start_time >= datetime.now(),
        Event.start_time <= datetime.combine(end_date, datetime.max.time())
    ).order_by(Event.start_time.asc()).all()
    
    results = {"success": 0, "failed": 0, "skipped": 0, "items": []}
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }
            
            # ====== 步骤1：通过 HA REST API 获取 calendar.familyos 已有事件 ======
            existing_summaries = set()
            try:
                # HA Calendars API: GET /api/calendars/<entity_id>?start=...&end=...
                # 直接返回事件数组 [{"summary": "...", "start": {...}, "end": {...}}, ...]
                start_iso = datetime.now().isoformat()
                end_iso = (datetime.now() + timedelta(days=60)).isoformat()
                list_resp = await client.get(
                    f"{url}/api/calendars/calendar.familyos",
                    headers=headers,
                    params={"start": start_iso, "end": end_iso}
                )
                if list_resp.status_code == 200:
                    events_list = list_resp.json()
                    if isinstance(events_list, list):
                        for ev in events_list:
                            summary = ev.get("summary", "")
                            if summary:
                                existing_summaries.add(summary)
            except Exception:
                pass  # 如果获取失败，跳过去重直接创建（可能有重复）
            
            # ====== 步骤2：创建新事件 ======
            for event in events:
                # 使用唯一 ID 前缀：FamilyOS 的事件 ID 作为去重标识
                summary = f"[001] {event.title}"
                
                if summary in existing_summaries:
                    results["skipped"] += 1
                    results["items"].append({
                        "id": event.id,
                        "title": event.title,
                        "status": "⏭️ 已存在"
                    })
                    continue
                
                start_time = event.start_time
                if start_time.hour == 0 and start_time.minute == 0:
                    start_time = start_time.replace(hour=9, minute=0)
                
                end_time = start_time + timedelta(hours=1)
                
                description_parts = [f"分类: {get_category_label(event.category)}"]
                if event.content:
                    description_parts.append(f"内容: {event.content}")
                
                service_data = {
                    "entity_id": "calendar.familyos",
                    "summary": summary,
                    "description": "\n".join(description_parts),
                    "start_date_time": start_time.isoformat(),
                    "end_date_time": end_time.isoformat()
                }
                
                response = await client.post(
                    f"{url}/api/services/calendar/create_event",
                    headers=headers,
                    json=service_data
                )
                
                if response.status_code in [200, 201]:
                    results["success"] += 1
                    existing_summaries.add(summary)
                    results["items"].append({
                        "id": event.id,
                        "title": event.title,
                        "start": start_time.isoformat(),
                        "status": "✅ 已同步"
                    })
                else:
                    results["failed"] += 1
                    results["items"].append({
                        "id": event.id,
                        "title": event.title,
                        "status": f"❌ HTTP {response.status_code}"
                    })
            
            return {
                "success": True,
                "message": f"日历同步完成：新增 {results['success']} / 已存在 {results['skipped']} / 失败 {results['failed']}",
                "results": results
            }
            
    except Exception as e:
        return {"success": False, "error": str(e)}

async def _sync_inventory_to_ha_impl(db: Session):
    """同步库存预警到 Home Assistant（内部实现）"""
    profile = get_profile(db)
    
    if not profile.ha_url or not profile.ha_token:
        return {"success": False, "error": "请先在设置中配置 HA"}
    
    items = db.query(Inventory).all()
    url = profile.ha_url.rstrip('/')
    token = profile.ha_token
    
    results = {"warning_count": 0, "total_items": len(items), "warnings": [], "items": []}
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            headers = {
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            }
            
            # ====== 为每个物品创建独立的 binary_sensor ======
            for item in items:
                is_warning = item.quantity <= item.warning_quantity
                if is_warning:
                    results["warning_count"] += 1
                    results["warnings"].append(item.name)
                
                # entity_id 用物品名拼音简化（保持唯一性）
                entity_id = f"binary_sensor.familyos_inventory_{item.id}"
                
                sensor_data = {
                    "state": "on" if is_warning else "off",
                    "attributes": {
                        "friendly_name": f"📦 {item.name}",
                        "warning": is_warning,
                        "message": f"{item.name}需要补货" if is_warning else f"{item.name}库存充足",
                        "icon": "mdi:package-variant-closed-alert" if is_warning else "mdi:package-variant-closed"
                    }
                }
                
                response = await client.post(
                    f"{url}/api/states/{entity_id}",
                    headers=headers,
                    json=sensor_data
                )
                
                if response.status_code in [200, 201]:
                    results["items"].append({
                        "name": item.name,
                        "warning": is_warning,
                        "status": "✅"
                    })
                else:
                    results["items"].append({
                        "name": item.name,
                        "status": f"❌ HTTP {response.status_code}"
                    })
            
            return {
                "success": True,
                "message": f"库存同步完成：{results['warning_count']}/{results['total_items']} 项需要补货",
                "results": results
            }
            
    except Exception as e:
        return {"success": False, "error": str(e)}


# ============ HA 同步 API 端点（仅管理员，含权限检查） ============

@app.post("/api/ha/sync/calendar")
async def sync_calendar_to_ha_api(request: Request, db: Session = Depends(get_db)):
    """同步日历到 HA（仅管理员）"""
    if not require_admin(request):
        return {"success": False, "error": "无权限：仅管理员可操作"}
    return await _sync_calendar_to_ha_impl(db)

@app.post("/api/ha/sync/inventory")
async def sync_inventory_to_ha_api(request: Request, db: Session = Depends(get_db)):
    """同步库存到 HA（仅管理员）"""
    if not require_admin(request):
        return {"success": False, "error": "无权限：仅管理员可操作"}
    return await _sync_inventory_to_ha_impl(db)

@app.post("/api/ha/sync/all")
async def sync_all_to_ha_api(request: Request, db: Session = Depends(get_db)):
    """同步所有数据到 HA（仅管理员）"""
    if not require_admin(request):
        return {"success": False, "error": "无权限：仅管理员可操作"}
    calendar_result = await _sync_calendar_to_ha_impl(db)
    inventory_result = await _sync_inventory_to_ha_impl(db)
    
    return {
        "success": True,
        "calendar": calendar_result,
        "inventory": inventory_result
    }
# ============ API 路由（图库时间轴） ============

@app.get("/api/gallery/events")
async def get_gallery_events(
    category: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """获取图库时间轴：返回记录及其关联的照片，按记录时间倒序"""
    query = db.query(Event).order_by(Event.start_time.desc())
    if category:
        query = query.filter(Event.category == EventCategory(category))
    
    events = query.all()
    
    color_map = {
        "checkup": "#d69e2e", "feeding": "#48bb78", "sleep": "#4299e1",
        "diaper": "#9f7aea", "bath": "#ed64a6", "vaccine": "#e53e3e",
        "growth": "#38a169", "task": "#ed8936"
    }
    
    result = []
    for e in events:
        # 获取该记录关联的照片
        photos = db.query(Picture).filter(Picture.event_id == e.id).order_by(Picture.upload_time.desc()).all()
        
        result.append({
            "id": e.id,
            "title": e.title,
            "category": e.category.value,
            "category_label": get_category_label(e.category),
            "start_time": to_local_iso(e.start_time),
            "content": e.content,
            "status": e.status,
            "color": color_map.get(e.category.value, "#718096"),
            "photo_count": len(photos),
            "photos": [
                {
                    "id": p.id,
                    "url": f"/uploads/{p.filename}",
                    "original_name": p.original_name,
                    "upload_time": to_local_iso(p.upload_time),
                    "mime_type": p.mime_type,
                    "file_size": p.file_size
                }
                for p in photos
            ]
        })
    
    return result

# ============ API 路由（图片） ============

@app.get("/api/pictures")
async def get_pictures(
    category: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """获取图片列表，支持按分类筛选"""
    query = db.query(Picture).order_by(Picture.upload_time.desc())
    if category:
        query = query.filter(Picture.category == category)

    pictures = query.all()
    return [
        {
            "id": p.id,
            "filename": p.filename,
            "original_name": p.original_name,
            "category": p.category,
            "event_id": p.event_id,
            "upload_time": to_local_iso(p.upload_time),
            "mime_type": p.mime_type,
            "file_size": p.file_size,
            "url": f"/uploads/{p.filename}"
        }
        for p in pictures
    ]

ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "gif", "webp", "bmp"}

def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS

@app.post("/api/pictures/upload")
async def upload_picture(
    request: Request,
    db: Session = Depends(get_db)
):
    """上传图片（支持多文件）"""
    try:
        form = await request.form()
        files = form.getlist("files") if "files" in form else [form.get("file")] if "file" in form else []
        category = form.get("category")
        event_id = form.get("event_id")

        if not files or files[0] is None:
            return {"success": False, "error": "未选择文件"}

        # 确保上传目录存在
        UPLOADS_DIR.mkdir(exist_ok=True)

        results = []
        for upload_file in files:
            if upload_file is None or not upload_file.filename:
                continue

            original_name = upload_file.filename
            if not allowed_file(original_name):
                results.append({"original_name": original_name, "success": False, "error": "不支持的文件格式"})
                continue

            # 生成唯一文件名
            ext = original_name.rsplit(".", 1)[1].lower()
            unique_name = f"{uuid.uuid4().hex}_{original_name}"
            file_path = UPLOADS_DIR / unique_name

            # 保存文件
            content = await upload_file.read()
            with open(file_path, "wb") as f:
                f.write(content)

            # 保存到数据库
            picture = Picture(
                filename=unique_name,
                original_name=original_name,
                category=category,
                event_id=int(event_id) if event_id and event_id.isdigit() else None,
                mime_type=upload_file.content_type,
                file_size=len(content)
            )
            db.add(picture)
            db.commit()
            db.refresh(picture)

            results.append({
                "id": picture.id,
                "original_name": original_name,
                "success": True,
                "url": f"/uploads/{unique_name}"
            })

        return {"success": True, "results": results, "total": len(results)}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.delete("/api/pictures/{picture_id}")
async def delete_picture(request: Request, picture_id: int, db: Session = Depends(get_db)):
    """删除图片（仅管理员）"""
    if not require_admin(request):
        return {"success": False, "error": "无权限：仅管理员可删除图片"}
    picture = db.query(Picture).filter(Picture.id == picture_id).first()
    if not picture:
        return {"success": False, "error": "图片不存在"}

    # 删除文件
    file_path = UPLOADS_DIR / picture.filename
    if file_path.exists():
        try:
            os.remove(file_path)
        except Exception:
            pass

    db.delete(picture)
    db.commit()
    return {"success": True}


# ============ 启动入口 ============
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=29375, reload=True)