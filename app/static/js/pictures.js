/**
 * FamilyOS - 图库控制器（按记录时间轴展示）
 * 照片按关联的记录日期分组，与记录中心时间线对齐
 */
(function() {
    'use strict';

    var allEvents = [];

    function getCategoryEmoji(c) {
        var map = { 'checkup': '🩺', 'feeding': '🍼', 'sleep': '😴', 'diaper': '🧻', 'bath': '🛁', 'vaccine': '💉', 'growth': '📈', 'task': '📌' };
        return map[c] || '📷';
    }

    function getCategoryLabel(c) {
        var map = { 'checkup': '产检', 'feeding': '喂奶', 'sleep': '睡眠', 'diaper': '尿布', 'bath': '洗澡', 'vaccine': '疫苗', 'growth': '成长', 'task': '任务' };
        return map[c] || '未分类';
    }

    function formatDate(isoStr) {
        if (!isoStr) return '未知';
        try {
            var d = new Date(isoStr);
            var y = d.getFullYear();
            var m = ('0' + (d.getMonth() + 1)).slice(-2);
            var day = ('0' + d.getDate()).slice(-2);
            return y + '年' + m + '月' + day + '日';
        } catch (e) {
            return isoStr;
        }
    }

    function formatTime(isoStr) {
        if (!isoStr) return '';
        try {
            var d = new Date(isoStr);
            var h = ('0' + d.getHours()).slice(-2);
            var mi = ('0' + d.getMinutes()).slice(-2);
            return h + ':' + mi;
        } catch (e) {
            return '';
        }
    }

    function getStatusLabel(s) {
        if (s === 'done') return '✅ 已完成';
        return '⏳ 待办';
    }

    function loadGallery(category) {
        var loading = document.getElementById('loadingState');
        var empty = document.getElementById('emptyState');
        var container = document.getElementById('timelineContainer');

        loading.style.display = 'block';
        empty.style.display = 'none';
        container.style.display = 'none';

        var url = '/api/gallery/events';
        if (category) url += '?category=' + encodeURIComponent(category);

        fetch(url)
            .then(function (res) { return res.json(); })
            .then(function (data) {
                allEvents = data;
                loading.style.display = 'none';
                renderTimeline();
            })
            .catch(function () {
                loading.innerHTML = '<span style="color:#e53e3e;">❌ 加载失败</span>';
            });
    }

    function renderTimeline() {
        var empty = document.getElementById('emptyState');
        var container = document.getElementById('timelineContainer');

        // 统计
        var totalPhotos = 0;
        var categories = {};
        for (var i = 0; i < allEvents.length; i++) {
            var ev = allEvents[i];
            totalPhotos += ev.photo_count;
            if (ev.category) categories[ev.category] = true;
        }

        // 只显示有照片的记录
        var eventsWithPhotos = allEvents.filter(function(ev) { return ev.photo_count > 0; });

        if (eventsWithPhotos.length === 0) {
            empty.style.display = 'block';
            container.style.display = 'none';
            document.getElementById('totalPhotos').textContent = '0';
            document.getElementById('photoCount').textContent = '共 0 张';
            document.getElementById('totalDays').textContent = '0';
            document.getElementById('totalCategories').textContent = '0';
            return;
        }

        empty.style.display = 'none';
        container.style.display = 'block';

        document.getElementById('totalPhotos').textContent = totalPhotos;
        document.getElementById('photoCount').textContent = '共 ' + totalPhotos + ' 张';
        document.getElementById('totalDays').textContent = eventsWithPhotos.length;
        document.getElementById('totalCategories').textContent = Object.keys(categories).length;

        // 按日期（记录时间）分组
        var groups = {};
        for (var k = 0; k < eventsWithPhotos.length; k++) {
            var ev = eventsWithPhotos[k];
            var dateKey = formatDate(ev.start_time);
            if (!groups[dateKey]) groups[dateKey] = [];
            groups[dateKey].push(ev);
        }

        var dateKeys = Object.keys(groups);
        // 按记录时间倒序排列（API已倒序，group也按倒序来）
        dateKeys.sort(function(a, b) {
            return groups[b][0].start_time.localeCompare(groups[a][0].start_time);
        });

        var html = '';
        for (var d = 0; d < dateKeys.length; d++) {
            var dateKey = dateKeys[d];
            var events = groups[dateKey];

            html += '<div class="timeline-group" style="margin-bottom:24px;">';
            html += '<div class="timeline-date-header" style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:2px solid var(--color-border);margin-bottom:12px;">';
            html += '<span class="date-text" style="font-weight:600;font-size:15px;">📅 ' + dateKey + '</span>';
            html += '<span class="date-count" style="font-size:12px;color:var(--color-text-muted);">' + events.length + ' 条记录</span>';
            html += '</div>';

            for (var e = 0; e < events.length; e++) {
                var ev = events[e];
                var isDone = (ev.status === 'done');
                var statusBg = isDone ? '#c6f6d5' : '#fef3c7';
                var statusColor = isDone ? '#22543d' : '#744210';

                html += '<div class="gallery-event-card" style="margin-bottom:16px;background:var(--color-bg-card);border:1px solid var(--color-border);border-radius:8px;overflow:hidden;">';
                html += '<div class="gallery-event-header" style="padding:10px 14px;background:var(--color-bg-header);border-bottom:1px solid var(--color-border);display:flex;align-items:center;gap:10px;">';
                html += '<span style="background:' + (ev.color || '#718096') + ';width:4px;height:20px;border-radius:2px;"></span>';
                html += '<span style="font-weight:600;font-size:14px;">' + getCategoryEmoji(ev.category) + ' ' + ev.title + '</span>';
                html += '<span style="font-size:11px;color:var(--color-text-muted);">' + formatTime(ev.start_time) + '</span>';
                html += '<span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:10px;background:' + statusBg + ';color:' + statusColor + ';margin-left:auto;">' + getStatusLabel(ev.status) + '</span>';
                html += '<span style="font-size:11px;color:#4299e1;white-space:nowrap;">📷 ' + ev.photo_count + '</span>';
                html += '</div>';

                if (ev.content) {
                    html += '<div style="padding:8px 14px;font-size:12px;color:var(--color-text-muted);border-bottom:1px solid var(--color-border);">' + ev.content + '</div>';
                }

                // 照片网格
                html += '<div class="photo-grid" style="display:flex;flex-wrap:wrap;gap:8px;padding:10px 14px;">';
                for (var p = 0; p < ev.photos.length; p++) {
                    var photo = ev.photos[p];
                    html += '<div class="photo-card" style="width:130px;border-radius:6px;overflow:hidden;border:1px solid var(--color-border);cursor:pointer;position:relative;background:var(--color-bg);" onclick="PicturePage.openLightbox(\'' + photo.url + '\', \'' + (photo.original_name || '') + '\', \'' + getCategoryEmoji(ev.category) + ' ' + getCategoryLabel(ev.category) + '\', \'' + formatDate(ev.start_time) + ' ' + formatTime(ev.start_time) + '\', \'' + photo.id + '\')">';
                    html += '<img class="photo-card-img" src="' + photo.url + '" alt="' + (photo.original_name || '') + '" loading="lazy" style="width:100%;height:100px;object-fit:cover;display:block;">';
                    html += '<div class="photo-card-footer" style="padding:4px 6px;display:flex;justify-content:space-between;align-items:center;font-size:10px;color:var(--color-text-muted);">';
                    html += '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:90px;">' + (photo.original_name || '') + '</span>';
                    html += '<button class="photo-delete-btn" title="删除照片" onclick="event.stopPropagation();PicturePage.deletePhoto(' + photo.id + ')" style="background:none;border:none;cursor:pointer;font-size:12px;padding:0 2px;">🗑️</button>';
                    html += '</div></div>';
                }
                html += '</div></div>';
            }

            html += '</div>';
        }

        container.innerHTML = html;
    }

    function filter() {
        var category = document.getElementById('filterCategory').value;
        loadGallery(category || null);
    }

    function openLightbox(url, name, category, timeStr, id) {
        var modal = document.getElementById('lightboxModal');
        var img = document.getElementById('lightboxImg');
        var info = document.getElementById('lightboxInfo');

        img.src = url;
        info.innerHTML = '<strong>' + (name || '') + '</strong><br>' + category + ' · ' + timeStr;
        modal.style.display = 'flex';
    }

    function closeLightbox(event) {
        if (event.target === document.getElementById('lightboxModal')) {
            document.getElementById('lightboxModal').style.display = 'none';
        }
    }

    function closeLightboxDirect() {
        document.getElementById('lightboxModal').style.display = 'none';
    }

    function deletePhoto(id) {
        if (!confirm('确定要删除这张照片吗？')) return;
        fetch('/api/pictures/' + id, { method: 'DELETE' })
            .then(function (res) { return res.json(); })
            .then(function (data) {
                if (data.success) {
                    loadGallery(null);
                } else {
                    alert('❌ 删除失败：' + (data.error || '未知错误'));
                }
            });
    }

    function init() {
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                document.getElementById('lightboxModal').style.display = 'none';
            }
        });

        loadGallery(null);
    }

    window.PicturePage = {
        filter: filter,
        openLightbox: openLightbox,
        closeLightbox: closeLightbox,
        closeLightboxDirect: closeLightboxDirect,
        deletePhoto: deletePhoto
    };

    document.addEventListener('DOMContentLoaded', init);
})();