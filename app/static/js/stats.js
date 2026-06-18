/**
 * FamilyOS - 统计控制器 (v2 — Canvas图表 + 阶段过滤)
 */
(function() {
    'use strict';

    var currentDays = 30;

    // 阶段 → 隐藏的卡片 key
    var PHASE_HIDE = {
        'pregnancy': ['feeding', 'sleep', 'diaper', 'bath', 'vaccine', 'growth'],
        'postpartum': ['vaccine', 'growth']
    };
    var phase = window.STATS_PHASE || 'infant';
    var hideKeys = PHASE_HIDE[phase] || [];
    var isInventoryPage = window.location.pathname.indexOf('/stats/inventory') !== -1;

    // ====== 卡片定义 ======
    var CARD_DEFS = [
        { key: 'feeding', title: '🍼 喂奶', chartKey: 'feeding', unit: 'ml', showChart: true },
        { key: 'sleep',   title: '😴 睡眠', chartKey: 'sleep',   unit: 'h',  showChart: true },
        { key: 'diaper',  title: '🧻 尿布', chartKey: 'diaper',  unit: '次', showChart: true },
        { key: 'bath',    title: '🛁 洗澡', chartKey: 'bath',    unit: '',   showChart: false },
        { key: 'vaccine', title: '💉 疫苗', chartKey: 'vaccine', unit: '',   showChart: false },
        { key: 'growth',  title: '📈 成长记录', chartKey: 'growth', unit: '',  showChart: false },
        { key: 'task',    title: '📌 任务完成率', chartKey: 'task', unit: '',  showChart: false }
    ];

    // ====== 入口 ======
    document.addEventListener('DOMContentLoaded', function() {
        if (isInventoryPage) {
            loadInventoryStats();
            return;
        }

        var btns = document.querySelectorAll('.period-btn');
        btns.forEach(function(btn) {
            btn.addEventListener('click', function() {
                btns.forEach(function(b) { b.classList.remove('active'); });
                this.classList.add('active');
                currentDays = parseInt(this.dataset.days);
                loadEventsStats();
            });
        });

        renderEventCards();
        loadEventsStats();
    });

    // ====== 渲染记录卡片 DOM ======
    function renderEventCards() {
        var grid = document.getElementById('eventsStats');
        if (!grid) return;

        var html = '';
        for (var i = 0; i < CARD_DEFS.length; i++) {
            var c = CARD_DEFS[i];
            if (hideKeys.indexOf(c.key) !== -1) continue;
            html += '<div class="card stats-card">';
            html += '<div class="card-header">' + c.title + '</div>';
            html += '<div class="card-body">';
            html += '<div class="stat-row"><span>' + (c.key === 'task' ? '已完成' : '总' + (c.key === 'bath' || c.key === 'vaccine' || c.key === 'growth' ? '次数' : c.key === 'feeding' ? '奶量' : c.key === 'sleep' ? '时长' : '次数')) + '</span><strong id="s' + cap(c.key) + 'Count">-</strong></div>';
            if (c.key === 'task') {
                html += '<div class="stat-row"><span>总计</span><strong id="sTaskTotal">-</strong></div>';
                html += '<div class="stat-row"><span>完成率</span><strong id="sTaskRate">-</strong></div>';
            } else if (c.key === 'feeding' || c.key === 'sleep') {
                html += '<div class="stat-row"><span>' + (c.key === 'feeding' ? '总奶量' : '总时长') + '</span><strong id="s' + cap(c.key) + 'Total">-</strong></div>';
                html += '<div class="stat-row"><span>每次平均</span><strong id="s' + cap(c.key) + 'Avg">-</strong></div>';
            } else if (c.key === 'diaper') {
                html += '<div class="stat-row"><span>日均</span><strong id="sDiaperAvg">-</strong></div>';
            }
            if (c.showChart) {
                html += '<div class="chart-canvas-wrap"><canvas id="chart_' + c.key + '" width="300" height="150"></canvas></div>';
            }
            html += '</div></div>';
        }
        grid.innerHTML = html;
    }

    // ====== 加载事件统计 ======
    function loadEventsStats() {
        var loading = document.getElementById('statsLoading');
        if (loading) loading.style.display = 'inline';

        fetch('/api/stats/events?days=' + currentDays)
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (loading) loading.style.display = 'none';
                updateEventDisplay(data);
            })
            .catch(function(err) {
                if (loading) loading.style.display = 'none';
                console.error('统计加载失败:', err);
            });
    }

    function updateEventDisplay(data) {
        setText('sFeedingCount', data.feeding.count + ' 次');
        setText('sFeedingTotal', data.feeding.total + ' ml');
        setText('sFeedingAvg', data.feeding.avg + ' ml/次');
        setText('sSleepCount', data.sleep.count + ' 次');
        setText('sSleepTotal', data.sleep.total + ' 小时');
        setText('sSleepAvg', data.sleep.avg + ' 小时/次');
        setText('sDiaperCount', data.diaper.count + ' 次');
        setText('sDiaperAvg', data.diaper.avg + ' 次/天');
        setText('sBathCount', data.bath.count + ' 次');
        setText('sVaccineCount', data.vaccine.count + ' 次');
        setText('sGrowthCount', data.growth.count + ' 条');
        setText('sTaskDone', data.task.done + ' 个');
        setText('sTaskTotal', data.task.total + ' 个');
        setText('sTaskRate', data.task.rate + '%');

        // 渲染图表
        if (hideKeys.indexOf('feeding') === -1) drawChart('chart_feeding', data.feeding.daily, 'ml', currentDays <= 7 ? 'bar' : 'line', '#48bb78');
        if (hideKeys.indexOf('sleep') === -1)   drawChart('chart_sleep',   data.sleep.daily,   'h',  currentDays <= 7 ? 'bar' : 'line', '#4299e1');
        if (hideKeys.indexOf('diaper') === -1)  drawChart('chart_diaper',  data.diaper.daily,  '次', currentDays <= 7 ? 'bar' : 'line', '#9f7aea');
    }

    // ====== Canvas 图表 ======
    function drawChart(canvasId, data, unit, type, color) {
        var canvas = document.getElementById(canvasId);
        if (!canvas || !data || data.length === 0) return;

        var dpr = window.devicePixelRatio || 1;
        var rect = canvas.parentElement.getBoundingClientRect();
        var w = Math.max(260, rect.width - 32);
        var h = 140;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        var ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        var pad = { top: 15, right: 10, bottom: 25, left: 35 };
        var pw = w - pad.left - pad.right;
        var ph = h - pad.top - pad.bottom;

        var values = data.map(function(d) { return d.value; });
        var maxVal = Math.max.apply(null, values);
        if (maxVal === 0) maxVal = 1;

        // 背景
        ctx.fillStyle = '#fafbfc';
        ctx.fillRect(0, 0, w, h);

        // 网格线
        ctx.strokeStyle = '#edf2f7';
        ctx.lineWidth = 0.5;
        for (var g = 0; g <= 4; g++) {
            var gy = pad.top + ph * g / 4;
            ctx.beginPath();
            ctx.moveTo(pad.left, gy);
            ctx.lineTo(w - pad.right, gy);
            ctx.stroke();
            ctx.fillStyle = '#a0aec0';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(Math.round(maxVal * (4 - g) / 4), pad.left - 4, gy + 4);
        }

        // Y轴单位
        ctx.fillStyle = '#a0aec0';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(unit, pad.left - 20, pad.top - 4);

        var n = data.length;
        var barW = Math.min(24, (pw / n) * 0.7);

        if (type === 'bar') {
            for (var i = 0; i < n; i++) {
                var x = pad.left + pw * i / n + (pw / n - barW) / 2;
                var bh = (data[i].value / maxVal) * ph;
                ctx.fillStyle = color;
                ctx.fillRect(x, pad.top + ph - bh, barW, bh);
                // X标签
                ctx.fillStyle = '#a0aec0';
                ctx.font = '9px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(data[i].date, x + barW / 2, pad.top + ph + 14);
            }
        } else {
            // 折线
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (var j = 0; j < n; j++) {
                var lx = pad.left + pw * j / Math.max(1, n - 1);
                var ly = pad.top + ph - (data[j].value / maxVal) * ph;
                if (j === 0) ctx.moveTo(lx, ly);
                else ctx.lineTo(lx, ly);
            }
            ctx.stroke();
            // 圆点
            for (var k = 0; k < n; k++) {
                var dx = pad.left + pw * k / Math.max(1, n - 1);
                var dy = pad.top + ph - (data[k].value / maxVal) * ph;
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(dx, dy, 3, 0, Math.PI * 2);
                ctx.fill();
            }
            // X标签（间隔显示避免拥挤）
            var step = Math.max(1, Math.floor(n / 10));
            ctx.fillStyle = '#a0aec0';
            ctx.font = '9px sans-serif';
            ctx.textAlign = 'center';
            for (var m = 0; m < n; m += step) {
                var tx = pad.left + pw * m / Math.max(1, n - 1);
                ctx.fillText(data[m].date, tx, pad.top + ph + 14);
            }
        }
    }

    // ====== 加载库存统计 ======
    function loadInventoryStats() {
        fetch('/api/stats/summary')
            .then(function(res) { return res.json(); })
            .then(function(data) {
                var ts = document.getElementById('sTotalSpent');
                var ms = document.getElementById('sMonthSpent');
                var ad = document.getElementById('sAvgDailySpent');
                if (ts) ts.textContent = '¥' + data.total_spent.toLocaleString();
                if (ms) ms.textContent = '¥' + data.month_spent.toLocaleString();
                if (ad) ad.textContent = '¥' + data.avg_daily_spent.toLocaleString();

                var tbody = document.getElementById('sInventoryTable');
                if (!tbody) return;
                var html = '';
                for (var i = 0; i < data.items.length; i++) {
                    var item = data.items[i];
                    html += '<tr>';
                    html += '<td>' + item.name + '</td>';
                    html += '<td>' + item.quantity + ' ' + item.unit + '</td>';
                    html += '<td>' + (item.unit_price ? '¥' + item.unit_price.toFixed(2) : '-') + '</td>';
                    html += '<td>¥' + (item.total_spent || 0).toFixed(2) + '</td>';
                    html += '<td>' + (item.total_purchased || 0) + ' ' + item.unit + '</td>';
                    html += '<td>' + (item.total_consumed || 0) + ' ' + item.unit + '</td>';
                    html += '<td>' + (item.is_warning ? '<span style="color:#e53e3e;">⚠️ 需补货</span>' : '✅ 充足') + '</td>';
                    html += '</tr>';
                }
                if (data.items.length === 0) {
                    html = '<tr><td colspan="7" style="text-align:center;padding:24px;color:#a0aec0;">暂无库存数据</td></tr>';
                }
                tbody.innerHTML = html;
            });
    }

    function setText(id, text) {
        var el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function cap(s) {
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

})();