// FamilyOS V1.0 - 主脚本

document.addEventListener('DOMContentLoaded', function() {
    // 自动高亮当前菜单（备用）
    const currentPath = window.location.pathname;
    document.querySelectorAll('.sidebar-nav a').forEach(link => {
        if (link.getAttribute('href') === currentPath) {
            link.classList.add('active');
        }
    });
    
    console.log('🏠 FamilyOS V1.0 已加载');
});

// 工具函数：格式化时间
function formatTime(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleString('zh-CN');
}

// 工具函数：相对时间
function timeAgo(dateStr) {
    const now = new Date();
    const past = new Date(dateStr);
    const diff = Math.floor((now - past) / 1000);
    
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
    return Math.floor(diff / 86400) + '天前';
}