from datetime import date
from typing import Optional
from app.models.profile import Profile


def current_phase(profile: Optional[Profile] = None) -> str:
    """
    返回当前家庭所处的生命周期阶段
    - pregnancy: 孕期（预产期前）
    - postpartum: 月子期（出生后42天内）
    - infant: 育儿期（出生42天后）
    """
    if not profile:
        return "pregnancy"
    
    today = date.today()
    
    # 未设置预产期 → 默认孕期
    if not profile.due_date:
        return "pregnancy"
    
    # 预产期之前 → 孕期
    if today < profile.due_date:
        return "pregnancy"
    
    # 宝宝未出生 → 孕期
    if not profile.baby_birthday:
        return "pregnancy"
    
    # 出生后42天内 → 月子期
    days_since_birth = (today - profile.baby_birthday).days
    if days_since_birth <= 42:
        return "postpartum"
    
    # 超过42天 → 育儿期
    return "infant"


def get_phase_display(phase: str) -> str:
    """获取阶段的中文显示名"""
    phase_map = {
        "pregnancy": "🌸 孕期",
        "postpartum": "💕 月子期",
        "infant": "🌟 育儿期"
    }
    return phase_map.get(phase, phase)


def get_phase_icon(phase: str) -> str:
    """获取阶段的图标"""
    icon_map = {
        "pregnancy": "🌸",
        "postpartum": "💕",
        "infant": "🌟"
    }
    return icon_map.get(phase, "🏠")