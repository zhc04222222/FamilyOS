/**
 * FamilyOS - 库存管理控制器 (v2 — 消耗/补货拆分)
 */
(function() {
    'use strict';

    var allItems = [];
    var currentAdjustId = null;
    var currentPurchaseId = null;

    // ====== Toast ======
    function showToast(msg, type) {
        var toast = document.getElementById('toast');
        if (!toast) return;
        toast.textContent = msg;
        toast.style.background = type === 'error' ? '#fc8181' : '#48bb78';
        toast.style.opacity = '1';
        clearTimeout(toast._timer);
        toast._timer = setTimeout(function() { toast.style.opacity = '0'; }, 2500);
    }

    // ====== 加载数据 ======
    function loadInventory() {
        fetch('/api/inventory')
            .then(function(res) { return res.json(); })
            .then(function(data) {
                allItems = data;
                renderInventory();
            })
            .catch(function(err) {
                console.error('加载失败:', err);
                showToast('❌ 加载失败', 'error');
            });
    }

    // ====== 渲染列表 ======
    function renderInventory() {
        var list = document.getElementById('inventoryList');
        var empty = document.getElementById('emptyState');
        var tbody = document.getElementById('inventoryTableBody');
        var total = document.getElementById('totalCount');
        var warning = document.getElementById('warningCount');
        var count = document.getElementById('itemCount');
        var catCount = document.getElementById('categoryCount');

        if (allItems.length === 0) {
            list.style.display = 'none';
            empty.style.display = 'block';
            total.textContent = '0';
            warning.textContent = '0';
            count.textContent = '共 0 件';
            catCount.textContent = '0';
            return;
        }

        list.style.display = 'block';
        empty.style.display = 'none';

        var warningItems = allItems.filter(function(i) { return i.quantity <= i.warning_quantity; });
        var categories = new Set(allItems.map(function(i) { return i.name; }));

        total.textContent = allItems.length;
        warning.textContent = warningItems.length;
        count.textContent = '共 ' + allItems.length + ' 件';
        catCount.textContent = categories.size;

        var html = '';
        for (var i = 0; i < allItems.length; i++) {
            var item = allItems[i];
            var isWarning = item.quantity <= item.warning_quantity;
            var dailyUse = item.daily_use || 0;
            var daysLeft = dailyUse > 0 ? Math.floor(item.quantity / dailyUse) : '∞';

            html += '<tr style="border-bottom:1px solid #f0f0f0;">';
            html += '<td style="padding:12px 16px;font-weight:500;" data-label="📦 名称">' + item.name + '</td>';
            html += '<td style="padding:12px 16px;text-align:center;" data-label="📊 数量">';
            html += '<strong style="font-size:18px;">' + item.quantity + '</strong>';
            html += '<span style="color:#a0aec0;font-size:13px;"> ' + item.unit + '</span>';
            html += '</td>';
            html += '<td style="padding:12px 16px;text-align:center;" data-label="📉 日耗">';
            html += '<input type="number" class="form-control form-control-sm" value="' + (item.daily_use || 0) + '" ';
            html += 'style="width:80px;display:inline-block;text-align:center;" ';
            html += 'onchange="InventoryPage.updateDailyUse(' + item.id + ', this.value)">';
            html += '<span style="color:#a0aec0;font-size:12px;margin-left:4px;">' + item.unit + '/天</span>';
            html += '</td>';
            html += '<td style="padding:12px 16px;text-align:center;font-size:14px;font-weight:500;color:' + (dailyUse > 0 && daysLeft < 3 ? '#e53e3e' : '#2d3748') + ';" data-label="⏳ 剩余">';
            if (dailyUse > 0) {
                html += daysLeft + ' 天';
                if (daysLeft < 3) html += ' ⚠️';
            } else {
                html += '∞';
            }
            html += '</td>';
            html += '<td style="padding:12px 16px;text-align:center;color:#a0aec0;font-size:14px;" data-label="⚠️ 预警">' + item.warning_quantity + ' ' + item.unit + '</td>';
            html += '<td style="padding:12px 16px;text-align:center;" data-label="📊 状态">';
            if (isWarning) {
                html += '<span style="display:inline-block;padding:2px 12px;border-radius:20px;font-size:12px;background:#fc8181;color:#fff;">⚠️ 需补货</span>';
            } else {
                html += '<span style="display:inline-block;padding:2px 12px;border-radius:20px;font-size:12px;background:#c6f6d5;color:#22543d;">✅ 充足</span>';
            }
            html += '</td>';
            html += '<td style="padding:12px 16px;text-align:center;" data-label="🔧 操作">';
            html += '<button class="btn btn-danger btn-sm" onclick="InventoryPage.openConsumeModal(' + item.id + ')" style="padding:4px 8px;font-size:12px;margin-right:4px;">➖ 消耗</button>';
            html += '<button class="btn btn-success btn-sm" onclick="InventoryPage.openPurchaseModal(' + item.id + ')" style="padding:4px 8px;font-size:12px;margin-right:4px;">🛒 补货</button>';
            html += '<button class="btn btn-outline btn-sm" onclick="InventoryPage.deleteItem(' + item.id + ')" style="padding:4px 8px;font-size:12px;">🗑️</button>';
            html += '</td>';
            html += '</tr>';
        }
        tbody.innerHTML = html;
    }

    // ====== 更新每日消耗 ======
    function updateDailyUse(id, value) {
        var dailyUse = parseFloat(value) || 0;
        var item = allItems.find(function(i) { return i.id === id; });
        if (!item) return;
        item.daily_use = dailyUse;
        renderInventory();
        showToast('✅ 已更新每日消耗', 'success');
    }

    // ====== 添加物品 ======
    function showAddItem() {
        document.getElementById('addItemModal').style.display = 'flex';
    }

    function closeItemModal() {
        document.getElementById('addItemModal').style.display = 'none';
        document.getElementById('addItemForm').reset();
    }

    function submitItem(e) {
        e.preventDefault();
        var name = document.getElementById('itemName').value.trim();
        var quantity = parseFloat(document.getElementById('itemQuantity').value) || 0;
        var dailyUse = parseFloat(document.getElementById('itemDailyUse').value) || 0;
        var warning = parseFloat(document.getElementById('itemWarning').value) || 5;
        var unit = document.getElementById('itemUnit').value.trim() || '件';

        if (!name) {
            showToast('请输入物品名称', 'error');
            return;
        }

        var exists = allItems.some(function(i) { return i.name === name; });
        if (exists) {
            showToast('❌ 物品 "' + name + '" 已存在，请勿重复添加', 'error');
            return;
        }

        fetch('/api/inventory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                name: name,
                quantity: quantity,
                warning_quantity: warning,
                unit: unit,
                daily_use: dailyUse
            })
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
            if (data.success) {
                closeItemModal();
                showToast('✅ 添加成功！', 'success');
                loadInventory();
            } else {
                showToast('❌ 添加失败：' + data.error, 'error');
            }
        });
    }

    // ====== 消耗弹窗 ======
    function openConsumeModal(id) {
        var item = allItems.find(function(i) { return i.id === id; });
        if (!item) return;
        currentAdjustId = id;
        document.getElementById('consumeTitle').textContent = '➖ 消耗 ' + item.name;
        document.getElementById('consumeCurrentQty').textContent = item.quantity + ' ' + item.unit;
        document.getElementById('consumeInput').value = '';
        document.getElementById('consumeModal').style.display = 'flex';
    }

    function closeConsumeModal() {
        document.getElementById('consumeModal').style.display = 'none';
    }

    function consumeAction(delta) {
        var item = allItems.find(function(i) { return i.id === currentAdjustId; });
        if (!item) return;
        var consumeAmount = Math.abs(delta);
        if (consumeAmount > item.quantity) consumeAmount = item.quantity;
        doConsume(currentAdjustId, consumeAmount);
    }

    function consumeCustom() {
        var input = document.getElementById('consumeInput');
        var value = parseFloat(input.value);
        if (isNaN(value) || value <= 0) {
            showToast('请输入有效数字', 'error');
            return;
        }
        doConsume(currentAdjustId, value);
    }

    function doConsume(id, amount) {
        fetch('/api/inventory/' + id + '/consume', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ quantity: amount })
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
            if (data.success) {
                closeConsumeModal();
                showToast('✅ 已消耗 ' + amount + ' 个', 'success');
                loadInventory();
            } else {
                showToast('❌ 消耗失败：' + data.error, 'error');
            }
        });
    }

    // ====== 补货弹窗 ======
    function openPurchaseModal(id) {
        var item = allItems.find(function(i) { return i.id === id; });
        if (!item) return;
        currentPurchaseId = id;
        document.getElementById('purchaseTitle').textContent = '🛒 补货 ' + item.name;
        document.getElementById('purchaseCurrentQty').textContent = item.quantity + ' ' + item.unit;
        document.getElementById('purchaseQty').value = '';
        document.getElementById('purchasePrice').value = item.unit_price || '';
        document.getElementById('purchaseTotal').textContent = '¥0';
        document.getElementById('purchaseNote').value = '';
        document.getElementById('purchaseModal').style.display = 'flex';
        loadPurchaseHistory(id);
    }

    function closePurchaseModal() {
        document.getElementById('purchaseModal').style.display = 'none';
    }

    function calcPurchaseTotal() {
        var qty = parseFloat(document.getElementById('purchaseQty').value) || 0;
        var price = parseFloat(document.getElementById('purchasePrice').value) || 0;
        document.getElementById('purchaseTotal').textContent = '¥' + (qty * price).toFixed(2);
    }

    function submitPurchase(e) {
        e.preventDefault();
        var qty = parseFloat(document.getElementById('purchaseQty').value) || 0;
        var price = parseFloat(document.getElementById('purchasePrice').value) || 0;
        var note = document.getElementById('purchaseNote').value.trim();

        if (qty <= 0) { showToast('请输入购买数量', 'error'); return; }
        if (price <= 0) { showToast('请输入单价', 'error'); return; }

        fetch('/api/inventory/' + currentPurchaseId + '/purchase', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                quantity: qty,
                unit_price: price,
                note: note
            })
        })
        .then(function(res) { return res.json(); })
        .then(function(data) {
            if (data.success) {
                closePurchaseModal();
                showToast('✅ 补货成功！总价 ¥' + data.total_price.toFixed(2), 'success');
                loadInventory();
            } else {
                showToast('❌ 补货失败：' + data.error, 'error');
            }
        });
    }

    function loadPurchaseHistory(id) {
        var tbody = document.getElementById('purchaseHistoryBody');
        if (!tbody) return;
        fetch('/api/inventory/' + id + '/purchases')
            .then(function(res) { return res.json(); })
            .then(function(logs) {
                var html = '';
                if (logs.length === 0) {
                    html = '<tr><td colspan="4" style="text-align:center;color:#a0aec0;padding:12px;">暂无购买记录</td></tr>';
                } else {
                    for (var i = 0; i < logs.length; i++) {
                        var l = logs[i];
                        html += '<tr style="font-size:13px;">';
                        html += '<td>' + (l.purchase_date || '').slice(0, 10) + '</td>';
                        html += '<td>' + l.quantity + '</td>';
                        html += '<td>¥' + l.unit_price.toFixed(2) + '</td>';
                        html += '<td>¥' + l.total_price.toFixed(2) + '</td>';
                        html += '</tr>';
                    }
                }
                tbody.innerHTML = html;
            })
            .catch(function() {
                var tbody = document.getElementById('purchaseHistoryBody');
                if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#fc8181;padding:12px;">加载失败</td></tr>';
            });
    }

    // ====== 删除物品 ======
    function deleteItem(id) {
        var item = allItems.find(function(i) { return i.id === id; });
        if (!item) return;
        if (!confirm('确定要删除 "' + item.name + '" 吗？')) return;

        fetch('/api/inventory/' + id, { method: 'DELETE' })
            .then(function(res) { return res.json(); })
            .then(function(data) {
                if (data.success) {
                    showToast('✅ 已删除', 'success');
                    loadInventory();
                } else {
                    showToast('❌ 删除失败', 'error');
                }
            });
    }

    // ====== 搜索 ======
    function searchInventory() {
        var keyword = document.getElementById('searchInput').value.toLowerCase();
        var rows = document.querySelectorAll('#inventoryTableBody tr');
        rows.forEach(function(row) {
            var name = row.querySelector('td:first-child') ? (row.querySelector('td:first-child').textContent || '').toLowerCase() : '';
            row.style.display = name.includes(keyword) ? '' : 'none';
        });
    }

    // ====== 初始化 ======
    function init() {
        document.getElementById('addItemModal').addEventListener('click', function(e) {
            if (e.target === this) closeItemModal();
        });

        document.getElementById('consumeModal').addEventListener('click', function(e) {
            if (e.target === this) closeConsumeModal();
        });

        document.getElementById('purchaseModal').addEventListener('click', function(e) {
            if (e.target === this) closePurchaseModal();
        });

        // 补货弹窗：实时计算总价
        var pqEl = document.getElementById('purchaseQty');
        var ppEl = document.getElementById('purchasePrice');
        if (pqEl) pqEl.addEventListener('input', calcPurchaseTotal);
        if (ppEl) ppEl.addEventListener('input', calcPurchaseTotal);

        loadInventory();
    }

    // 暴露全局方法
    window.InventoryPage = {
        updateDailyUse: updateDailyUse,
        openConsumeModal: openConsumeModal,
        openPurchaseModal: openPurchaseModal,
        deleteItem: deleteItem
    };

    window.showAddItem = showAddItem;
    window.closeItemModal = closeItemModal;
    window.submitItem = submitItem;
    window.closeConsumeModal = closeConsumeModal;
    window.consumeAction = consumeAction;
    window.consumeCustom = consumeCustom;
    window.closePurchaseModal = closePurchaseModal;
    window.submitPurchase = submitPurchase;
    window.calcPurchaseTotal = calcPurchaseTotal;
    window.searchInventory = searchInventory;

    document.addEventListener('DOMContentLoaded', init);
})();