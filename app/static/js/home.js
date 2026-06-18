/**
 * ================================================================
 * FamilyOS - 首页控制器
 * 统一数据模型 + 时间处理 + 事件管理
 * 提取自 home.html
 * ================================================================
 */

(function() {
    'use strict';

    // ================================================================
    // ========== 1. 常量定义 ==========
    // ================================================================

    /** 事件分类映射表 - 单一数据源 */
    var CATEGORY_MAP = {
        checkup: { emoji: '\u{1FA7A}', label: '产检', color: 'var(--color-warning)' },
        feeding: { emoji: '\u{1F37C}', label: '喂奶', color: 'var(--color-success)' },
        sleep: { emoji: '\u{1F634}', label: '睡眠', color: 'var(--color-primary)' },
        diaper: { emoji: '\u{1F9FB}', label: '尿布', color: '#9f7aea' },
        bath: { emoji: '\u{1F6C1}', label: '洗澡', color: '#ed64a6' },
        vaccine: { emoji: '\u{1F489}', label: '疫苗', color: 'var(--color-danger)' },
        growth: { emoji: '\u{1F4C8}', label: '成长', color: 'var(--color-success-hover)' },
        task: { emoji: '\u{1F4CC}', label: '任务', color: '#ed8936' },
        default: { emoji: '\u{1F4CB}', label: '其他', color: 'var(--color-text-muted)' }
    };

    /** 事件状态 */
    var STATUS = {
        PENDING: 'pending',
        DONE: 'done'
    };

    // ================================================================
    // ========== 2. 状态管理 ==========
    // ================================================================

    var state = {
        currentPhase: window.HOME_PHASE || 'pregnancy',
        events: [],           // 统一事件数组
        currentEventId: null, // 当前弹窗事件 ID
        calendarYear: null,
        calendarMonth: null,
        calendarEvents: {},   // { '2024-01-01': [event, ...] }
        activeCalendarContainer: null  // 当前活跃的日历容器（孕期用 calendarContainer，育儿用 infantCalendarContainer）
    };

    // ================================================================
    // ========== 3. DOM 缓存 ==========
    // ================================================================

    var $ = function(id) { return document.getElementById(id); };
    var $$ = function(sel) { return document.querySelectorAll(sel); };

    var dom = {};

    // ================================================================
    // ========== 4. 工具函数 ==========
    // ================================================================

    /** 获取分类信息 */
    function getCategoryInfo(category) {
        return CATEGORY_MAP[category] || CATEGORY_MAP.default;
    }

    /** 格式化日期为本地字符串 (YYYY-MM-DD) */
    function formatDateLocal(date) {
        var d = new Date(date);
        var year = d.getFullYear();
        var month = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return year + '-' + month + '-' + day;
    }

    /** 格式化时间为本地字符串 */
    function formatTimeLocal(date) {
        var d = new Date(date);
        return d.toLocaleString('zh-CN', { hour12: false });
    }

    /** 格式化时间为短格式 (HH:MM) */
    function formatTimeShortLocal(date) {
        var d = new Date(date);
        return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }

    /** 获取本地今天的日期对象 (不含时间) */
    function getTodayLocal() {
        var now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }

    /** 获取本地今天的日期字符串 */
    function getTodayString() {
        var d = getTodayLocal();
        return formatDateLocal(d);
    }

    /** 判断两个日期是否同一天 */
    function isSameDay(date1, date2) {
        var d1 = new Date(date1);
        var d2 = new Date(date2);
        return d1.getFullYear() === d2.getFullYear() &&
               d1.getMonth() === d2.getMonth() &&
               d1.getDate() === d2.getDate();
    }

    /** Toast 提示 */
    function showToast(message, type) {
        var toast = dom.toast;
        if (!toast) return;
        toast.textContent = message;
        toast.className = 'toast-notification ' + (type || 'info') + ' show';
        clearTimeout(toast._timer);
        toast._timer = setTimeout(function() {
            toast.classList.remove('show');
        }, 2500);
    }

    // ================================================================
    // ========== 5. 事件模型（统一数据结构） ==========
    // ================================================================

    /**
     * 统一事件对象：
     * {
     *   id: number,
     *   title: string,
     *   category: string,  // checkup, feeding, sleep, ...
     *   start_time: string, // ISO 8601
     *   status: 'pending' | 'done',
     *   content: string
     * }
     */

    /** 将 API 返回的数据转换为统一格式 */
    function normalizeEvent(raw) {
        // 兼容多种 API 返回格式
        var qv = raw.quantity_value || (raw.extendedProps && raw.extendedProps.quantity_value) || null;
        var qu = raw.quantity_unit || (raw.extendedProps && raw.extendedProps.quantity_unit) || null;
        return {
            id: raw.id || raw.event_id,
            title: raw.title || '无标题',
            category: raw.category || (raw.extendedProps && raw.extendedProps.category) || 'default',
            start_time: raw.start_time || raw.start || (raw.extendedProps && raw.extendedProps.start_time),
            status: raw.status || (raw.extendedProps && raw.extendedProps.status) || STATUS.PENDING,
            content: raw.content || (raw.extendedProps && raw.extendedProps.content) || '',
            quantity_value: qv,
            quantity_unit: qu
        };
    }

    /** 按日期索引事件 */
    function indexEventsByDate(events) {
        var index = {};
        for (var i = 0; i < events.length; i++) {
            var e = events[i];
            var key = formatDateLocal(e.start_time);
            if (!index[key]) index[key] = [];
            index[key].push(e);
        }
        return index;
    }

    // ================================================================
    // ========== 6. 视图切换 ==========
    // ================================================================

    function showPhase(phase) {
        if (phase === 'pregnancy') {
            loadPregnancyData();
        } else if (phase === 'postpartum') {
            loadPostpartumData();
        } else {
            loadInfantData();
        }
    }

    // ================================================================
    // ========== 7. 孕期视图 ==========
    // ================================================================

    function loadPregnancyData() {
        fetch('/api/events/calendar')
            .then(function(res) { return res.json(); })
            .then(function(rawEvents) {
                // 统一数据格式
                state.events = rawEvents.map(normalizeEvent);
                state.calendarEvents = indexEventsByDate(state.events);

                // 渲染日历
                renderCalendar();

                // 渲染产检列表
                renderCheckupList();
            })
            .catch(function(err) {
                console.error('Failed to load pregnancy data:', err);
                if (dom.calendarContainer) {
                    dom.calendarContainer.innerHTML = '<div style="text-align:center;padding:var(--spacing-4xl);color:var(--color-danger);">Failed to load</div>';
                }
            });
    }

    /** 渲染日历 */
    function renderCalendar() {
        var container = (state.currentPhase === 'infant') ? dom.infantCalendarContainer : dom.calendarContainer;
        if (!container) return;

        // 初始化当前月份
        var today = getTodayLocal();
        if (state.calendarYear === null || state.calendarMonth === null) {
            state.calendarYear = today.getFullYear();
            state.calendarMonth = today.getMonth();
        }

        var year = state.calendarYear;
        var month = state.calendarMonth;

        // 月首日（周几）和本月天数
        var firstDay = new Date(year, month, 1).getDay();
        var daysInMonth = new Date(year, month + 1, 0).getDate();
        var daysInPrevMonth = new Date(year, month, 0).getDate();

        // 从周一开始的偏移量
        var startOffset = firstDay === 0 ? 6 : firstDay - 1;

        // 构建 HTML
        var html = '';
        html += '<div class="calendar-header">';
        html += '<button class="nav-btn" data-action="prev-month">\u2039</button>';
        html += '<span class="month-year">' + year + '\u5E74 ' + (month + 1) + '\u6708</span>';
        html += '<div><button class="today-btn" data-action="today">\u4ECA\u5929</button>';
        html += '<button class="nav-btn" data-action="next-month">\u203A</button></div>';
        html += '</div>';

        html += '<div class="calendar-weekdays"><div>\u4E00</div><div>\u4E8C</div><div>\u4E09</div><div>\u56DB</div><div>\u4E94</div><div>\u516D</div><div>\u65E5</div></div>';
        html += '<div class="calendar-days" id="calendarDays">';

        // 上月补位
        for (var i = 0; i < startOffset; i++) {
            var day = daysInPrevMonth - startOffset + i + 1;
            html += '<div class="calendar-day other-month"><div class="day-number">' + day + '</div></div>';
        }

        // 本月
        var todayStr = getTodayString();
        for (var day = 1; day <= daysInMonth; day++) {
            var dateKey = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
            var dayEvents = state.calendarEvents[dateKey] || [];
            var isToday = (dateKey === todayStr);

            html += '<div class="calendar-day ' + (isToday ? 'today' : '') + '" data-date="' + dateKey + '">';
            html += '<div class="day-number">' + day + '</div>';

            // 排序：pending 在前，同状态按时间正序
            dayEvents.sort(function(a, b) {
                if (a.status !== b.status) {
                    return a.status === STATUS.PENDING ? -1 : 1;
                }
                return new Date(a.start_time) - new Date(b.start_time);
            });

            // 显示前 2 个事件
            var maxShow = Math.min(dayEvents.length, 2);
            for (var j = 0; j < maxShow; j++) {
                var e = dayEvents[j];
                var info = getCategoryInfo(e.category);
                var statusClass = (e.status === STATUS.DONE) ? 'done' : 'pending';
                html += '<div class="day-event ' + e.category + ' ' + statusClass + '" data-event-id="' + e.id + '">' +
                    info.emoji + ' ' + e.title +
                '</div>';
            }

            if (dayEvents.length > 2) {
                html += '<div class="more-indicator">+' + (dayEvents.length - 2) + ' more</div>';
            }

            html += '</div>';
        }

        // 下月补位
        var totalDays = startOffset + daysInMonth;
        var remaining = (7 - totalDays % 7) % 7;
        for (var day = 1; day <= remaining; day++) {
            html += '<div class="calendar-day other-month"><div class="day-number">' + day + '</div></div>';
        }

        html += '</div>';
        container.innerHTML = html;

        // ====== 事件绑定（容器级事件委托） ======
        // 使用一次性委托监听器，避免 innerHTML 替换导致的监听器丢失
        if (!container._calendarListenerAttached) {
            container._calendarListenerAttached = true;
            container.addEventListener('click', function(e) {
                var target = e.target;

                // 1. 检测是否点击了导航按钮
                var navBtn = target.closest('[data-action]');
                if (navBtn) {
                    e.stopPropagation();
                    var action = navBtn.dataset.action;
                    if (action === 'prev-month') {
                        state.calendarMonth--;
                        if (state.calendarMonth < 0) { state.calendarMonth = 11; state.calendarYear--; }
                    } else if (action === 'next-month') {
                        state.calendarMonth++;
                        if (state.calendarMonth > 11) { state.calendarMonth = 0; state.calendarYear++; }
                    } else if (action === 'today') {
                        var d = getTodayLocal();
                        state.calendarYear = d.getFullYear();
                        state.calendarMonth = d.getMonth();
                    }
                    renderCalendar();
                    return;
                }

                // 2. 检测是否点击了日历日期格子（无论点空白还是事件标签，统一弹出该日事件列表）
                var dayEl = target.closest('.calendar-day');
                if (dayEl) {
                    var dateKey = dayEl.dataset.date;
                    if (dateKey) {
                        showDayEvents(dateKey);
                    }
                }
            });
        }
    }

    /** 当前选中的日期（日视图弹窗用） */
    var selectedDayKey = null;

    /** 显示某天的事件列表（弹出模态窗口） */
    function showDayEvents(dateKey) {
        selectedDayKey = dateKey;
        var events = state.calendarEvents[dateKey] || [];
        var modal = $('dayEventsModal');
        var title = $('dayEventsModalTitle');
        var body = $('dayEventsModalBody');

        if (!modal || !title || !body) return;

        title.textContent = '\uD83D\uDCC5 ' + dateKey + ' (' + events.length + ' events)';

        if (events.length === 0) {
            body.innerHTML = '<div class="text-muted" style="text-align:center;padding:var(--spacing-lg);font-size:var(--font-size-sm);">No events on this day</div>';
        } else {
            var html = '';
            for (var i = 0; i < events.length; i++) {
                var e = events[i];
                var info = getCategoryInfo(e.category);
                var isDone = (e.status === STATUS.DONE);
                var statusColor = isDone ? 'var(--color-success)' : 'var(--color-warning)';
                var statusText = isDone ? '\u2705 Done' : '\u23F3 Pending';
                var time = formatTimeShortLocal(e.start_time);
                var contentPreview = e.content ? ('\u00B7 ' + (e.content.length > 60 ? e.content.substr(0, 60) + '...' : e.content)) : '';

                html += '<div class="day-event-list-item" style="padding:12px;margin-bottom:8px;background:var(--color-bg);border-radius:8px;border:1px solid var(--color-border);border-left:4px solid ' + info.color + ';cursor:pointer;" data-event-id="' + e.id + '">';
                html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
                html += '<div style="flex:1;">';
                html += '<div style="font-weight:600;font-size:14px;">' + info.emoji + ' ' + e.title + '</div>';
                html += '<div style="font-size:12px;color:var(--color-text-muted);margin-top:4px;">' + time + ' ' + contentPreview + '</div>';
                html += '</div>';
                html += '<div style="display:flex;align-items:center;gap:8px;">';
                html += '<span style="font-size:12px;padding:2px 8px;border-radius:12px;background:' + statusColor + '20;color:' + statusColor + ';">' + statusText + '</span>';
                html += '<button class="btn btn-sm ' + (isDone ? 'btn-warning' : 'btn-success') + '" style="font-size:11px;padding:2px 10px;" data-action="toggle-status" data-event-id="' + e.id + '" data-new-status="' + (isDone ? 'pending' : 'done') + '">' + (isDone ? '↩ Undo' : '✓ Done') + '</button>';
                html += '</div></div></div>';
            }
            body.innerHTML = html;
        }

        modal.classList.add('active');
    }

    /** 关闭日期事件弹窗 */
    function closeDayEventsModal() {
        var modal = $('dayEventsModal');
        if (modal) modal.classList.remove('active');
        selectedDayKey = null;
        hideDayEventsAddForm();
    }

    /** 快速切换事件状态（从日视图弹窗中） */
    function quickToggleStatus(eventId, newStatus) {
        fetch('/api/events/' + eventId + '/status', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ status: newStatus })
        })
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (data.success) {
                    showToast('Status updated', 'success');
                    // 更新本地状态
                    for (var i = 0; i < state.events.length; i++) {
                        if (state.events[i].id === eventId) {
                            state.events[i].status = newStatus;
                            break;
                        }
                    }
                    state.calendarEvents = indexEventsByDate(state.events);
                    refreshCurrentView();
                    // 刷新日视图弹窗
                    if (selectedDayKey) showDayEvents(selectedDayKey);
                } else {
                    showToast('Update failed: ' + data.error, 'error');
                }
            })
            .catch(function(err) {
                showToast('Request failed: ' + err, 'error');
            });
    }

    /** 在选中日期快速添加记录 — 弹窗内展开内嵌表单 */
    function addRecordOnSelectedDay() {
        if (!selectedDayKey) return;
        var form = $('dayEventsAddForm');
        var btnRow = $('dayEventsAddBtnRow');
        var dateSpan = $('dayEventsAddDate');
        if (form && btnRow) {
            form.style.display = 'block';
            btnRow.style.display = 'none';
            if (dateSpan) dateSpan.textContent = selectedDayKey;
            if ($('dayEventsAddTitle')) $('dayEventsAddTitle').value = '';
            if ($('dayEventsAddContent')) $('dayEventsAddContent').value = '';
            if ($('dayEventsAddTime')) $('dayEventsAddTime').value = '09:00';
            // 根据当前阶段动态注入分类选项
            var catSelect = $('dayEventsAddCategory');
            if (catSelect) {
                var phase = state.currentPhase;
                var options = '';
                if (phase === 'pregnancy') {
                    options += '<option value="checkup">\u{1FA7A} 产检</option>';
                    options += '<option value="task">\u{1F4CC} 待办</option>';
                } else if (phase === 'infant') {
                    options += '<option value="vaccine">\u{1F489} 疫苗</option>';
                    options += '<option value="growth">\u{1F4C8} 成长</option>';
                    options += '<option value="task">\u{1F4CC} 任务</option>';
                }
                catSelect.innerHTML = options;
            }
            if ($('dayEventsAddTitle')) $('dayEventsAddTitle').focus();
        }
    }

    /** 隐藏内嵌表单 */
    function hideDayEventsAddForm() {
        var form = $('dayEventsAddForm');
        var btnRow = $('dayEventsAddBtnRow');
        if (form) form.style.display = 'none';
        if (btnRow) btnRow.style.display = 'block';
    }

    /** 提交内嵌表单 */
    function submitDayEventsAdd() {
        if (!selectedDayKey) return;
        var title = ($('dayEventsAddTitle') && $('dayEventsAddTitle').value || '').trim();
        var category = $('dayEventsAddCategory') ? $('dayEventsAddCategory').value : 'checkup';
        var time = $('dayEventsAddTime') ? $('dayEventsAddTime').value : '09:00';
        var content = ($('dayEventsAddContent') && $('dayEventsAddContent').value || '').trim();

        if (!title) {
            showToast('Please enter a title', 'error');
            return;
        }

        var startTime = selectedDayKey + 'T' + time;

        var body = new URLSearchParams({
            title: title,
            category: category,
            start_time: startTime,
            content: content
        });

        fetch('/api/events/quick', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body
        })
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (data.success) {
                    showToast('Added!', 'success');
                    closeDayEventsModal();
                    refreshCurrentView();
                } else {
                    showToast('Add failed: ' + data.error, 'error');
                }
            })
            .catch(function(err) {
                showToast('Request failed: ' + err, 'error');
            });
    }

    /** 渲染产检列表 */
    function renderCheckupList() {
        var checkups = state.events.filter(function(e) {
            return e.category === 'checkup';
        }).sort(function(a, b) {
            // pending 优先
            if (a.status !== b.status) {
                return a.status === 'pending' ? -1 : 1;
            }
            // 同状态按时间倒序
            return new Date(b.start_time) - new Date(a.start_time);
        });

        var list = dom.checkupList;
        if (!list) return;

        if (checkups.length === 0) {
            list.innerHTML = '<div class="text-muted" style="text-align:center;padding:var(--spacing-lg);font-size:var(--font-size-sm);">No checkup records</div>';
            return;
        }

        var html = '';
        for (var i = 0; i < checkups.length; i++) {
            var e = checkups[i];
            var info = getCategoryInfo(e.category);
            var isDone = (e.status === STATUS.DONE);
            var statusColor = isDone ? 'var(--color-success)' : 'var(--color-warning)';
            var statusText = isDone ? '\u2705 Done' : '\u23F3 Pending';
            var date = formatDateLocal(e.start_time);
            var contentPreview = e.content ? (e.content.length > 40 ? e.content.substr(0, 40) + '...' : e.content) : '';

            html += '<div class="day-event-list-item" style="padding:10px 8px;margin-bottom:6px;border-radius:6px;border:1px solid var(--color-border);border-left:3px solid ' + info.color + ';cursor:pointer;" data-event-id="' + e.id + '">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
            html += '<div style="flex:1;min-width:0;">';
            html += '<div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + info.emoji + ' ' + e.title + '</div>';
            html += '<div style="font-size:11px;color:var(--color-text-muted);margin-top:2px;">' + date + (contentPreview ? ' \u00B7 ' + contentPreview : '') + '</div>';
            html += '</div>';
            html += '<div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">';
            html += '<span style="font-size:10px;padding:1px 6px;border-radius:10px;background:' + statusColor + '20;color:' + statusColor + ';white-space:nowrap;">' + statusText + '</span>';
            html += '<button class="btn btn-sm ' + (isDone ? 'btn-warning' : 'btn-success') + '" style="font-size:10px;padding:1px 8px;line-height:1.5;" data-action="toggle-status" data-event-id="' + e.id + '" data-new-status="' + (isDone ? 'pending' : 'done') + '">' + (isDone ? '↩' : '✓') + '</button>';
            html += '</div></div></div>';
        }
        list.innerHTML = html;

        // 事件委托：点击列表项 → 打开详情弹窗，点击状态按钮 → 切换状态
        if (!list._checkupListenerAttached) {
            list._checkupListenerAttached = true;
            list.addEventListener('click', function(e) {
                var toggleBtn = e.target.closest('[data-action="toggle-status"]');
                if (toggleBtn) {
                    e.stopPropagation();
                    var eventId = parseInt(toggleBtn.dataset.eventId);
                    var newStatus = toggleBtn.dataset.newStatus;
                    if (eventId && newStatus) quickToggleStatus(eventId, newStatus);
                    return;
                }
                var listItem = e.target.closest('.day-event-list-item');
                if (listItem) {
                    var eventId = parseInt(listItem.dataset.eventId);
                    if (eventId) openModal(eventId);
                }
            });
        }
    }

    // ================================================================
    // ========== 8. 月子视图 ==========
    // ================================================================

    function loadPostpartumData() {
        fetch('/api/events/timeline')
            .then(function(res) { return res.json(); })
            .then(function(rawEvents) {
                var events = rawEvents.map(normalizeEvent);
                renderTimeline(events);
                renderTodayStats(events);
            })
            .catch(function(err) {
                console.error('Failed to load postpartum data:', err);
            });
    }

    /** 渲染时间轴 */
    function renderTimeline(events) {
        var container = dom.timelineContainer;
        if (!container) return;

        if (events.length === 0) {
            container.innerHTML = '<div class="text-muted" style="text-align:center;padding:var(--spacing-3xl);font-size:var(--font-size-sm);">No records</div>';
            return;
        }

        var isMobile = window.innerWidth <= 768;

        if (isMobile) {
            // 手机端：简单表格
            var html = '<table class="timeline-table-mobile"><tbody>';
            for (var i = 0; i < events.length; i++) {
                var e = events[i];
                var info = getCategoryInfo(e.category);
                var content = info.emoji + ' ' + e.title;
                // 显示数量（喂奶 ml / 睡眠 h）
                if (e.quantity_value != null && e.quantity_unit) {
                    content += ' ' + e.quantity_value + e.quantity_unit;
                }
                if (e.content) {
                    content += ' \u00B7 ' + e.content;
                }
                html += '<tr>';
                html += '<td class="t-time">' + formatTimeShortLocal(e.start_time) + '</td>';
                html += '<td class="t-content">' + content + '</td>';
                html += '</tr>';
            }
            html += '</tbody></table>';
            container.innerHTML = html;
        } else {
            // 桌面端：原有样式
            var html = '';
            for (var i = 0; i < events.length; i++) {
                var e = events[i];
                var info = getCategoryInfo(e.category);
                html += '<div class="timeline-item">';
                html += '<div class="time">' + formatTimeShortLocal(e.start_time) + '</div>';
                html += '<div class="content">';
                html += '<span class="title">' + e.title + '</span>';
                html += '<span class="category-badge ' + e.category + '">' + info.emoji + ' ' + info.label + '</span>';
                // 显示数量
                if (e.quantity_value != null && e.quantity_unit) {
                    html += '<span class="content-note">' + e.quantity_value + e.quantity_unit + '</span>';
                }
                if (e.content) {
                    html += '<span class="content-note">\u00B7 ' + e.content + '</span>';
                }
                html += '</div></div>';
            }
            container.innerHTML = html;
        }
    }

    /** 渲染今日统计 */
    function renderTodayStats(events) {
        var todayStr = getTodayString();
        var stats = { feeding: { count: 0, total: 0, unit: '次' }, sleep: { count: 0, total: 0, unit: '次' }, diaper: { count: 0 }, bath: { count: 0 } };

        for (var i = 0; i < events.length; i++) {
            var e = events[i];
            var eventDate = formatDateLocal(e.start_time);
            if (eventDate !== todayStr) continue;
            if (e.category === 'feeding') {
                stats.feeding.count++;
                if (e.quantity_value != null && e.quantity_unit === 'ml') stats.feeding.total += e.quantity_value;
            } else if (e.category === 'sleep') {
                stats.sleep.count++;
                if (e.quantity_value != null && e.quantity_unit === 'h') stats.sleep.total += e.quantity_value;
            } else if (stats[e.category] !== undefined) {
                stats[e.category].count++;
            }
        }

        // 喂奶：显示总 ml，如果全是次数则显示次数
        if (stats.feeding.total > 0) {
            dom.statFeeding.textContent = Math.round(stats.feeding.total) + 'ml';
        } else {
            dom.statFeeding.textContent = stats.feeding.count;
        }
        // 睡眠：显示总 h
        if (stats.sleep.total > 0) {
            dom.statSleep.textContent = parseFloat(stats.sleep.total.toFixed(1)) + 'h';
        } else {
            dom.statSleep.textContent = stats.sleep.count;
        }
        if (dom.statDiaper) dom.statDiaper.textContent = stats.diaper.count;
        if (dom.statBath) dom.statBath.textContent = stats.bath.count;
    }

    // ================================================================
    // ========== 9. 育儿视图 ==========
    // ================================================================

    /** 统一加载育儿数据（日历 + 近期记录 + 疫苗提醒 + 任务看板） */
    function loadInfantData() {
        // 请求1：日历事件（当前阶段所有事件）
        fetch('/api/events/calendar')
            .then(function(res) { return res.json(); })
            .then(function(rawEvents) {
                state.events = rawEvents.map(normalizeEvent);
                state.calendarEvents = indexEventsByDate(state.events);
                renderInfantCalendar();
                renderInfantVaccineReminder();
            })
            .catch(function(err) {
                console.error('Failed to load infant calendar:', err);
            });

        // 请求2：近期时间轴（最近14天所有记录）
        var since = new Date();
        since.setDate(since.getDate() - 14);
        var sinceStr = since.toISOString();
        fetch('/api/events?since=' + sinceStr)
            .then(function(res) { return res.json(); })
            .then(function(rawEvents) {
                var recent = rawEvents.map(normalizeEvent).filter(function(e) {
                    return e.category !== 'task';
                }).slice(0, 20);
                renderInfantTimeline(recent);
            })
            .catch(function(err) {
                console.error('Failed to load infant timeline:', err);
            });

        // 请求3：任务看板
        fetch('/api/events/tasks')
            .then(function(res) { return res.json(); })
            .then(function(rawEvents) {
                var events = rawEvents.map(normalizeEvent);
                renderInfantTaskBoard(events);
            })
            .catch(function(err) {
                console.error('Failed to load infant tasks:', err);
            });
    }

    /** 渲染育儿日历（renderCalendar 内部根据 phase 自动选择正确容器） */
    function renderInfantCalendar() {
        renderCalendar();
        console.log('[DIAG] renderInfantCalendar done. infantCalendarContainer children:', dom.infantCalendarContainer ? dom.infantCalendarContainer.children.length : 'null');
    }

    /** 渲染疫苗提醒 — 找出最近一次未接种的疫苗 */
    function renderInfantVaccineReminder() {
        var container = dom.infantVaccineReminder;
        if (!container) { console.log('[DIAG] renderInfantVaccineReminder: container is null'); return; }

        var vaccines = state.events.filter(function(e) {
            return e.category === 'vaccine' && e.status !== STATUS.DONE;
        }).sort(function(a, b) {
            return new Date(a.start_time) - new Date(b.start_time);
        });

        if (vaccines.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:12px;color:#a0aec0;font-size:13px;">✅ 所有疫苗已接种</div>';
            return;
        }

        var html = '';
        for (var i = 0; i < Math.min(vaccines.length, 3); i++) {
            var v = vaccines[i];
            var date = formatDateLocal(v.start_time);
            var today = getTodayString();
            var daysDiff = Math.ceil((new Date(v.start_time) - getTodayLocal()) / 86400000);
            var urgency = daysDiff <= 7 ? '🔴 即将到期' : daysDiff <= 30 ? '🟡 ' + daysDiff + '天后' : '🟢 ' + daysDiff + '天后';

            html += '<div style="padding:8px 0;border-bottom:1px solid #fee2e2;">';
            html += '<div style="font-weight:600;font-size:14px;">💉 ' + v.title + '</div>';
            html += '<div style="font-size:12px;color:#718096;">' + date + ' · ' + urgency + (v.content ? ' · ' + v.content : '') + '</div>';
            html += '</div>';
        }
        if (vaccines.length > 3) {
            html += '<div style="text-align:center;padding:6px;color:#a0aec0;font-size:12px;">还有 ' + (vaccines.length - 3) + ' 针待接种...</div>';
        }

        container.innerHTML = html;
    }

    /** 渲染育儿近期时间轴（复用月子期 timeline 渲染逻辑） */
    function renderInfantTimeline(events) {
        var original = dom.timelineContainer;
        dom.timelineContainer = dom.infantTimelineContainer;
        renderTimeline(events);
        dom.timelineContainer = original;
    }

    /** 渲染育儿任务看板（只显示待办任务） */
    function renderInfantTaskBoard(events) {
        var container = dom.taskBoardContainer;
        if (!container) return;

        var pending = events.filter(function(e) { return e.status !== STATUS.DONE; });

        if (pending.length === 0) {
            container.innerHTML = '<div style="text-align:center;padding:16px;color:#a0aec0;font-size:13px;">暂无待办任务</div>';
            return;
        }

        var html = '';
        for (var i = 0; i < pending.length; i++) {
            var e = pending[i];
            var info = getCategoryInfo(e.category);
            html += '<div class="task-card" data-event-id="' + e.id + '">';
            html += '<div class="task-header"><span class="task-title">' + info.emoji + ' ' + e.title + '</span><span class="task-status pending">Pending</span></div>';
            html += '<div class="task-meta">' + info.label + ' · ' + formatDateLocal(e.start_time) + (e.content ? ' · ' + e.content : '') + '</div>';
            html += '</div>';
        }

        container.innerHTML = html;

        container.querySelectorAll('.task-card').forEach(function(el) {
            el.addEventListener('click', function() {
                var id = parseInt(this.dataset.eventId);
                if (id) openModal(id);
            });
        });
    }

    // ================================================================
    // ========== 10. 事件详情弹窗 ==========
    // ================================================================

    function openModal(eventId) {
        // 查找事件（支持从状态中查找）
        var event = null;
        for (var i = 0; i < state.events.length; i++) {
            if (state.events[i].id === eventId) {
                event = state.events[i];
                break;
            }
        }

        if (!event) {
            showToast('Event not found', 'error');
            return;
        }

        state.currentEventId = eventId;
        var info = getCategoryInfo(event.category);
        var statusLabel = (event.status === STATUS.DONE) ? 'Done' : 'Pending';

        if (dom.modalTitle) dom.modalTitle.textContent = event.title;
        if (dom.modalCategory) dom.modalCategory.textContent = info.emoji + ' ' + info.label;
        if (dom.modalTime) dom.modalTime.textContent = formatTimeLocal(event.start_time);
        if (dom.modalContent) dom.modalContent.textContent = event.content || '(none)';
        if (dom.modalStatus) dom.modalStatus.textContent = statusLabel;

        // 更新状态切换按钮
        var isDone = (event.status === STATUS.DONE);
        if (dom.statusToggleBtn) {
            dom.statusToggleBtn.textContent = isDone ? 'Mark Pending' : 'Mark Done';
            dom.statusToggleBtn.className = 'btn btn-sm ' + (isDone ? 'btn-warning' : 'btn-success');
        }

        if (dom.eventModal) dom.eventModal.classList.add('active');
    }

    function closeModal() {
        if (dom.eventModal) dom.eventModal.classList.remove('active');
        state.currentEventId = null;
    }

    /** 切换事件状态 */
    function toggleEventStatus() {
        var id = state.currentEventId;
        if (!id) return;

        // 查找事件
        var event = null;
        for (var i = 0; i < state.events.length; i++) {
            if (state.events[i].id === id) {
                event = state.events[i];
                break;
            }
        }
        if (!event) return;

        var newStatus = (event.status === STATUS.DONE) ? STATUS.PENDING : STATUS.DONE;

        fetch('/api/events/' + id + '/status', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ status: newStatus })
        })
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (data.success) {
                    showToast('Status updated', 'success');
                    // 更新本地状态
                    event.status = newStatus;
                    // 刷新视图
                    refreshCurrentView();
                    closeModal();
                } else {
                    showToast('Update failed: ' + data.error, 'error');
                }
            })
            .catch(function(err) {
                showToast('Request failed: ' + err, 'error');
            });
    }

    /** 删除事件 */
    function deleteEvent() {
        var id = state.currentEventId;
        if (!id) return;
        if (!confirm('Delete this record?')) return;

        fetch('/api/events/' + id, { method: 'DELETE' })
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (data.success) {
                    showToast('Deleted', 'success');
                    // 从本地状态移除
                    state.events = state.events.filter(function(e) { return e.id !== id; });
                    state.calendarEvents = indexEventsByDate(state.events);
                    refreshCurrentView();
                    closeModal();
                } else {
                    showToast('Delete failed: ' + data.error, 'error');
                }
            })
            .catch(function(err) {
                showToast('Request failed: ' + err, 'error');
            });
    }

    /** 刷新当前视图 */
    function refreshCurrentView() {
        var phase = state.currentPhase;
        if (phase === 'pregnancy') {
            loadPregnancyData();
        } else if (phase === 'postpartum') {
            loadPostpartumData();
        } else {
            loadInfantData();
        }
    }

    // ================================================================
    // ========== 12. 快捷记录（月子） ==========
    // ================================================================

    var quickRecordCategory = null;

    function openQuickRecordModal(category) {
        quickRecordCategory = category;
        var titles = {
            feeding: '🍼 喂奶',
            sleep: '😴 睡眠',
            diaper: '🧻 尿布',
            bath: '🛁 洗澡'
        };
        var modal = $('quickRecordModal');
        $('qrmTitle').textContent = titles[category] || '记录';
        $('qrmNote').value = '';

        var qtyRow = $('qrmQuantityRow');
        var qtyInput = $('qrmQuantity');
        qtyInput.value = '';
        if (category === 'feeding') {
            qtyRow.style.display = 'flex';
            $('qrmQuantityLabel').textContent = '奶量';
            $('qrmUnit').textContent = 'ml';
        } else if (category === 'sleep') {
            qtyRow.style.display = 'flex';
            $('qrmQuantityLabel').textContent = '时长';
            $('qrmUnit').textContent = 'h';
        } else {
            qtyRow.style.display = 'none';
        }
        modal.classList.add('active');
        setTimeout(function() { qtyInput.focus(); }, 100);
    }

    function submitQuickRecord() {
        if (!quickRecordCategory) return;
        var category = quickRecordCategory;
        var now = new Date();
        var local = now.getFullYear() + '-' +
            String(now.getMonth() + 1).padStart(2, '0') + '-' +
            String(now.getDate()).padStart(2, '0') + 'T' +
            String(now.getHours()).padStart(2, '0') + ':' +
            String(now.getMinutes()).padStart(2, '0');

        var titles = {
            feeding: 'Feeding',
            sleep: 'Sleep',
            diaper: 'Diaper',
            bath: 'Bath'
        };
        var title = titles[category] || 'Record';
        var note = $('qrmNote').value.trim();
        var qv = null, qu = null;
        if (category === 'feeding' || category === 'sleep') {
            var val = parseFloat($('qrmQuantity').value);
            if (!isNaN(val) && val > 0) {
                qv = val;
                qu = category === 'feeding' ? 'ml' : 'h';
            }
        }

        var body = new URLSearchParams({
            title: title,
            category: category,
            start_time: local,
            content: note
        });
        if (qv != null) body.append('quantity_value', qv);
        if (qu != null) body.append('quantity_unit', qu);

        fetch('/api/events/quick', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body
        })
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (data.success) {
                    closeQuickRecordModal();
                    showToast('Recorded!', 'success');
                    refreshCurrentView();
                } else {
                    showToast('Record failed: ' + data.error, 'error');
                }
            });
    }

    function closeQuickRecordModal() {
        var modal = $('quickRecordModal');
        if (modal) modal.classList.remove('active');
        quickRecordCategory = null;
    }

    // ================================================================
    // ========== 13. 初始化 ==========
    // ================================================================

    function initDom() {
        dom.calendarContainer = $('calendarContainer');
        dom.daysUntil = $('daysUntil');
        dom.dueDateDisplay = $('dueDateDisplay');
        dom.checkupList = $('checkupList');
        dom.timelineContainer = $('timelineContainer');
        dom.daysSinceBirth = $('daysSinceBirth');
        dom.birthdayDisplay = $('birthdayDisplay');
        dom.statFeeding = $('statFeeding');
        dom.statSleep = $('statSleep');
        dom.statDiaper = $('statDiaper');
        dom.statBath = $('statBath');
        dom.infantCalendarContainer = $('infantCalendarContainer');
        dom.infantVaccineReminder = $('infantVaccineReminder');
        dom.infantTimelineContainer = $('infantTimelineContainer');
        dom.taskBoardContainer = $('taskBoardContainer');
        dom.taskStats = $('taskStats');
        dom.monthsOld = $('monthsOld');
        dom.birthdayDisplay2 = $('birthdayDisplay2');
        dom.eventModal = $('eventModal');
        dom.modalTitle = $('modalTitle');
        dom.modalCategory = $('modalCategory');
        dom.modalTime = $('modalTime');
        dom.modalContent = $('modalContent');
        dom.modalStatus = $('modalStatus');
        dom.modalCloseBtn = $('modalCloseBtn');
        dom.statusToggleBtn = $('statusToggleBtn');
        dom.modalDeleteBtn = $('modalDeleteBtn');
        dom.toast = $('toast');
        dom.phasePregnancy = $('phasePregnancy');
        dom.phasePostpartum = $('phasePostpartum');
        dom.phaseInfant = $('phaseInfant');

        // ====== 诊断日志 ======
        console.log('[DIAG] phaseInfant element:', dom.phaseInfant);
        console.log('[DIAG] infantCalendarContainer:', dom.infantCalendarContainer);
        console.log('[DIAG] infantVaccineReminder:', dom.infantVaccineReminder);
        console.log('[DIAG] infantTimelineContainer:', dom.infantTimelineContainer);
        console.log('[DIAG] taskBoardContainer:', dom.taskBoardContainer);
        console.log('[DIAG] currentPhase:', state.currentPhase);
    }

    function init() {
        console.log('FamilyOS home initializing...');

        // ====== 延迟初始化 DOM 引用（确保 DOM 已就绪）======
        initDom();

        // ====== 绑定事件 ======

        // 快捷记录（打开弹窗）
        document.querySelectorAll('.quick-record-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var category = this.dataset.category;
                if (category) openQuickRecordModal(category);
            });
        });

        // 快捷记录弹窗按钮
        var qrmSubmit = $('qrmSubmit');
        var qrmCancel = $('qrmCancel');
        var qrmClose = $('qrmClose');
        var qrmModal = $('quickRecordModal');
        if (qrmSubmit) qrmSubmit.addEventListener('click', submitQuickRecord);
        if (qrmCancel) qrmCancel.addEventListener('click', closeQuickRecordModal);
        if (qrmClose) qrmClose.addEventListener('click', closeQuickRecordModal);
        if (qrmModal) qrmModal.addEventListener('click', function(e) {
            if (e.target === qrmModal) closeQuickRecordModal();
        });

        // 弹窗
        if (dom.modalCloseBtn) dom.modalCloseBtn.addEventListener('click', closeModal);
        if (dom.eventModal) {
            dom.eventModal.addEventListener('click', function(e) {
                if (e.target === this) closeModal();
            });
        }
        if (dom.statusToggleBtn) dom.statusToggleBtn.addEventListener('click', toggleEventStatus);
        if (dom.modalDeleteBtn) dom.modalDeleteBtn.addEventListener('click', deleteEvent);

        // ESC 关闭弹窗
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                if (dom.eventModal && dom.eventModal.classList.contains('active')) {
                    closeModal();
                }
                var dayModal = $('dayEventsModal');
                if (dayModal && dayModal.classList.contains('active')) {
                    closeDayEventsModal();
                }
            }
        });

        // ====== 日期事件弹窗（日历日期点击） ======
        var dayEventsModal = $('dayEventsModal');
        var dayEventsModalCloseBtn = $('dayEventsModalCloseBtn');
        var dayEventsAddBtn = $('dayEventsAddBtn');
        if (dayEventsModal) {
            dayEventsModal.addEventListener('click', function(e) {
                if (e.target === this) closeDayEventsModal();
            });
            // 委托：点击事件项或状态按钮
            dayEventsModal.addEventListener('click', function(e) {
                var toggleBtn = e.target.closest('[data-action="toggle-status"]');
                if (toggleBtn) {
                    e.stopPropagation();
                    var eventId = parseInt(toggleBtn.dataset.eventId);
                    var newStatus = toggleBtn.dataset.newStatus;
                    if (eventId && newStatus) quickToggleStatus(eventId, newStatus);
                    return;
                }
                var listItem = e.target.closest('.day-event-list-item');
                if (listItem) {
                    var eventId = parseInt(listItem.dataset.eventId);
                    if (eventId) {
                        closeDayEventsModal();
                        openModal(eventId);
                    }
                }
            });
        }
        if (dayEventsModalCloseBtn) {
            dayEventsModalCloseBtn.addEventListener('click', closeDayEventsModal);
        }
        if (dayEventsAddBtn) {
            dayEventsAddBtn.addEventListener('click', addRecordOnSelectedDay);
        }

        // ====== 内嵌添加表单按钮 ======
        var dayEventsAddSubmit = $('dayEventsAddSubmit');
        var dayEventsAddCancel = $('dayEventsAddCancel');
        if (dayEventsAddSubmit) {
            dayEventsAddSubmit.addEventListener('click', submitDayEventsAdd);
        }
        if (dayEventsAddCancel) {
            dayEventsAddCancel.addEventListener('click', hideDayEventsAddForm);
        }
        // 回车键提交
        var dayEventsAddTitle = $('dayEventsAddTitle');
        if (dayEventsAddTitle) {
            dayEventsAddTitle.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') submitDayEventsAdd();
            });
        }

        // ====== 孕期视图内快速添加 ======
        var pregQuickAddBtn = $('pregQuickAddBtn');
        var pregQuickTime = $('pregQuickTime');
        if (pregQuickTime) {
            var now = new Date();
            var local = now.getFullYear() + '-' +
                String(now.getMonth() + 1).padStart(2, '0') + '-' +
                String(now.getDate()).padStart(2, '0') + 'T' +
                String(now.getHours()).padStart(2, '0') + ':' +
                String(now.getMinutes()).padStart(2, '0');
            pregQuickTime.value = local;
        }
        if (pregQuickAddBtn) {
            pregQuickAddBtn.addEventListener('click', function() {
                var title = ($('pregQuickTitle') && $('pregQuickTitle').value || '').trim();
                var category = $('pregQuickCategory') ? $('pregQuickCategory').value : 'checkup';
                var time = $('pregQuickTime') ? $('pregQuickTime').value : '';
                var content = ($('pregQuickContent') && $('pregQuickContent').value || '').trim();

                if (!title || !time) {
                    showToast('Please enter title and time', 'error');
                    return;
                }

                var body = new URLSearchParams({
                    title: title,
                    category: category,
                    start_time: time,
                    content: content
                });

                fetch('/api/events/quick', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: body
                })
                    .then(function(res) { return res.json(); })
                    .then(function(data) {
                        if (data.success) {
                            if ($('pregQuickTitle')) $('pregQuickTitle').value = '';
                            if ($('pregQuickContent')) $('pregQuickContent').value = '';
                            showToast('Added!', 'success');
                            // 重新加载数据刷新日历和列表
                            loadPregnancyData();
                            // 重置时间
                            if (pregQuickTime) {
                                var n = new Date();
                                pregQuickTime.value = n.getFullYear() + '-' +
                                    String(n.getMonth() + 1).padStart(2, '0') + '-' +
                                    String(n.getDate()).padStart(2, '0') + 'T' +
                                    String(n.getHours()).padStart(2, '0') + ':' +
                                    String(n.getMinutes()).padStart(2, '0');
                            }
                        } else {
                            showToast('Add failed: ' + data.error, 'error');
                        }
                    })
                    .catch(function(err) {
                        showToast('Request failed: ' + err, 'error');
                    });
            });
        }

        // ====== 显示阶段 ======
        showPhase(state.currentPhase);

        // ====== 显示 Profile 信息 ======
        if (window.HOME_PROFILE) {
            var p = window.HOME_PROFILE;
            if (p.due_date) {
                var daysUntil = window.HOME_DAYS_UNTIL || '?';
                if (dom.daysUntil) dom.daysUntil.textContent = daysUntil;
                if (dom.dueDateDisplay) dom.dueDateDisplay.textContent = p.due_date;
            }

            if (p.baby_birthday) {
                if (dom.daysSinceBirth) dom.daysSinceBirth.textContent = window.HOME_DAYS_SINCE_BIRTH || '?';
                if (dom.birthdayDisplay) dom.birthdayDisplay.textContent = p.baby_birthday;
                if (dom.birthdayDisplay2) dom.birthdayDisplay2.textContent = p.baby_birthday;
                if (dom.monthsOld) dom.monthsOld.textContent = window.HOME_MONTHS_OLD || '?';
            }
        }

        console.log('FamilyOS home initialized');
    }

    // 暴露给全局使用（inline onclick 方式）
    window.HomePage = window.HomePage || {};
    window.HomePage.openCheckupModal = openModal;
    window.HomePage.openModal = openModal;

    // DOM 就绪后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
