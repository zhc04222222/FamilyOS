/**
 * FamilyOS - 记录中心控制器
 * 提取自 records.html
 */
(function() {
    'use strict';

    var allRecords = [];
    var currentRecords = [];

    function getCategoryEmoji(c) {
        var map = {'checkup':'🩺','feeding':'🍼','sleep':'😴','diaper':'🧻','bath':'🛁','vaccine':'💉','growth':'📈','task':'📌'};
        return map[c] || '📋';
    }

    function getCategoryLabel(c) {
        var map = {'checkup':'产检','feeding':'喂奶','sleep':'睡眠','diaper':'尿布','bath':'洗澡','vaccine':'疫苗','growth':'成长','task':'任务'};
        return map[c] || c;
    }

    function formatTime(s) {
        if (!s) return '未知时间';
        try { var d = new Date(s); return d.toLocaleString('zh-CN', {hour12:false}); } catch(e) { return s; }
    }

    function getStatusLabel(s) {
        if (s === 'done') return '✅ 已完成';
        return '⏳ 待办';
    }

    function loadRecords() {
        var loading = document.getElementById('loadingState');
        var empty = document.getElementById('emptyState');
        var list = document.getElementById('recordList');

        loading.style.display = 'block';
        empty.style.display = 'none';
        list.style.display = 'none';

        fetch('/api/events')
            .then(function(res) { return res.json(); })
            .then(function(data) {
                allRecords = data;
                currentRecords = data;
                loading.style.display = 'none';
                renderRecords();
            })
            .catch(function(err) {
                loading.innerHTML = '<span style="color:#e53e3e;">❌ 加载失败</span>';
            });
    }

    function renderRecords() {
        var empty = document.getElementById('emptyState');
        var list = document.getElementById('recordList');
        var tbody = document.getElementById('recordTableBody');

        if (currentRecords.length === 0) {
            empty.style.display = 'block';
            list.style.display = 'none';
            document.getElementById('totalCount').textContent = '0';
            document.getElementById('recordCount').textContent = '共 0 条';
            document.getElementById('pendingCount').textContent = '0';
            document.getElementById('doneCount').textContent = '0';
            return;
        }

        empty.style.display = 'none';
        list.style.display = 'block';
        document.getElementById('totalCount').textContent = currentRecords.length;
        document.getElementById('recordCount').textContent = '共 ' + currentRecords.length + ' 条';

        var pending = currentRecords.filter(function(r) { return r.status !== 'done'; });
        var done = currentRecords.filter(function(r) { return r.status === 'done'; });
        document.getElementById('pendingCount').textContent = pending.length;
        document.getElementById('doneCount').textContent = done.length;

        var html = '';
        for (var i = 0; i < currentRecords.length; i++) {
            var r = currentRecords[i];
            var statusColor = (r.status === 'done') ? 'background:#c6f6d5;color:#22543d;' : 'background:#fef3c7;color:#744210;';

            html += '<tr style="border-bottom:1px solid #f0f0f0;">';
            html += '<td style="padding:12px 16px;font-size:14px;" data-label="⏰ 时间">' + formatTime(r.start_time) + '</td>';
            html += '<td style="padding:12px 16px;font-size:14px;" data-label="📁 分类">' + getCategoryEmoji(r.category) + ' ' + getCategoryLabel(r.category) + '</td>';
            html += '<td style="padding:12px 16px;font-size:14px;font-weight:500;" data-label="📝 标题">' + (r.title || '无标题') + '</td>';
            html += '<td style="padding:12px 16px;font-size:14px;" data-label="📊 状态">';
            html += '<span style="display:inline-block;padding:2px 12px;border-radius:20px;font-size:12px;' + statusColor + '">' + getStatusLabel(r.status) + '</span>';
            html += '</td>';
            html += '<td style="padding:12px 16px;text-align:center;font-size:13px;" data-label="📷 照片">';
            html += '<span style="color:' + (r.photo_count > 0 ? '#4299e1' : '#cbd5e0') + ';">📷 ' + (r.photo_count || 0) + '</span>';
            html += '</td>';
            html += '<td style="padding:12px 16px;text-align:center;" data-label="🔧 操作">';
            html += '<button class="btn btn-sm btn-success" onclick="RecordsPage.toggleStatus(' + r.id + ')" style="padding:4px 10px;font-size:12px;margin-right:4px;">🔄 切换</button>';
            html += '<button class="btn btn-sm" onclick="RecordsPage.uploadToRecord(' + r.id + ')" style="padding:4px 10px;font-size:12px;background:#4299e1;color:#fff;border:none;border-radius:4px;margin-right:4px;">📷</button>';
            html += '<button class="btn btn-danger btn-sm" onclick="RecordsPage.deleteRecord(' + r.id + ')" style="padding:4px 10px;font-size:12px;">🗑️</button>';
            html += '</td>';
            html += '</tr>';
        }
        tbody.innerHTML = html;
    }

    function toggleStatus(id) {
        var record = allRecords.find(function(r) { return r.id === id; });
        if (!record) return;

        var newStatus = (record.status === 'done') ? 'pending' : 'done';
        var label = (newStatus === 'done') ? '已完成' : '待办';

        if (!confirm('将「' + record.title + '」标记为「' + label + '」？')) return;

        fetch('/api/events/' + id + '/status', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ status: newStatus })
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
            if (data.success) {
                record.status = newStatus;
                renderRecords();
            } else {
                alert('❌ 更新失败');
            }
        });
    }

    function uploadToRecord(eventId) {
        var record = allRecords.find(function(r) { return r.id === eventId; });
        if (!record) return;

        // 创建临时文件选择器
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.multiple = true;
        input.onchange = function() {
            var files = input.files;
            if (!files || files.length === 0) return;
            uploadPhotos(files, record.category, eventId, function() {
                alert('✅ 照片上传成功！');
            });
        };
        input.click();
    }

    function deleteRecord(id) {
        if (!confirm('确定要删除吗？')) return;
        fetch('/api/events/' + id, { method: 'DELETE' })
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (data.success) { alert('✅ 删除成功！'); loadRecords(); }
                else { alert('❌ 删除失败'); }
            });
    }

    function filterRecords() {
        var category = document.getElementById('filterCategory').value;
        var status = document.getElementById('filterStatus').value;

        currentRecords = allRecords.filter(function(r) {
            var match = true;
            if (category && r.category !== category) match = false;
            if (status && r.status !== status) match = false;
            return match;
        });
        renderRecords();
    }

    function showAddRecord() {
        document.getElementById('addRecordModal').style.display = 'flex';
        var now = new Date();
        document.getElementById('recordTime').value = now.toISOString().slice(0, 16);
        // 清空照片
        document.getElementById('recordPhotos').value = '';
        document.getElementById('photoPreview').innerHTML = '';
    }

    function closeModal() {
        document.getElementById('addRecordModal').style.display = 'none';
    }

    function submitRecord(e) {
        e.preventDefault();
        var title = document.getElementById('recordTitle').value.trim();
        var category = document.getElementById('recordCategory').value;
        var time = document.getElementById('recordTime').value;
        var content = document.getElementById('recordContent').value.trim();
        var photoInput = document.getElementById('recordPhotos');
        var photos = photoInput.files;

        if (!title || !time) { alert('请填写完整信息'); return; }

        var formData = new URLSearchParams();
        formData.append('title', title);
        formData.append('category', category);
        formData.append('start_time', time);
        formData.append('content', content || '');

        fetch('/api/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
            if (data.success) {
                var eventId = data.id;

                // 如果有照片，上传照片
                if (photos && photos.length > 0) {
                    uploadPhotos(photos, category, eventId, function() {
                        alert('✅ 添加成功！');
                        closeModal();
                        document.getElementById('addRecordForm').reset();
                        document.getElementById('photoPreview').innerHTML = '';
                        loadRecords();
                    });
                } else {
                    alert('✅ 添加成功！');
                    closeModal();
                    document.getElementById('addRecordForm').reset();
                    document.getElementById('photoPreview').innerHTML = '';
                    loadRecords();
                }
            } else {
                alert('❌ 添加失败：' + data.error);
            }
        });
    }

    function uploadPhotos(files, category, eventId, callback) {
        var formData = new FormData();
        for (var i = 0; i < files.length; i++) {
            formData.append('files', files[i]);
        }
        if (category) formData.append('category', category);
        if (eventId) formData.append('event_id', String(eventId));

        fetch('/api/pictures/upload', {
            method: 'POST',
            body: formData
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
            if (callback) callback();
        })
        .catch(function() {
            if (callback) callback();
        });
    }

    function init() {
        document.getElementById('addRecordModal').addEventListener('click', function(e) {
            if (e.target === this) closeModal();
        });

        // 照片预览
        var photoInput = document.getElementById('recordPhotos');
        if (photoInput) {
            photoInput.addEventListener('change', function() {
                var preview = document.getElementById('photoPreview');
                preview.innerHTML = '';
                for (var i = 0; i < this.files.length; i++) {
                    var file = this.files[i];
                    if (!file.type.match(/^image\//)) continue;
                    var reader = new FileReader();
                    reader.onload = (function(f, name) {
                        return function(e) {
                            var div = document.createElement('div');
                            div.className = 'photo-thumb';
                            div.innerHTML = '<img src="' + e.target.result + '" alt="' + name + '"><span class="photo-thumb-name">' + name + '</span>';
                            preview.appendChild(div);
                        };
                    })(file, file.name);
                    reader.readAsDataURL(file);
                }
            });
        }

        loadRecords();
    }

    // 暴露全局方法供 onclick 使用
    window.RecordsPage = {
        toggleStatus: toggleStatus,
        deleteRecord: deleteRecord,
        uploadToRecord: uploadToRecord
    };

    // 暴露给 HTML onclick 使用
    window.filterRecords = filterRecords;
    window.showAddRecord = showAddRecord;
    window.closeModal = closeModal;
    window.submitRecord = submitRecord;

    document.addEventListener('DOMContentLoaded', init);
})();