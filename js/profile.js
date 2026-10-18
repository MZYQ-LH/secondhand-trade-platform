/* ================================================================
   profile.js —— 个人中心：我的发布 / 收藏想要 / 订单 / 私信会话
   接口对齐说明：
     · GET /api/me                → {user:{...}, counts:{products,favorites,wants,orders_buy,orders_sell,unread}}
     · GET /api/me/products       → 数组（我的全部商品，含已售出）
     · GET /api/me/collections?type=favorite|want → 数组
     · GET /api/orders?role=buyer|seller          → 数组
     · GET /api/messages/conversations            → 数组
   ================================================================ */

const P_STATE = {
    user: null,
    counts: {},
    favType: 'favorite',
    orderRole: 'buyer'
};

function $(id) { return document.getElementById(id); }

/* 接口返回可能是数组，也可能是 {list:[...]}，统一取列表 */
function pickList(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.list)) return data.list;
    return [];
}

/* ---------------- 个人信息卡 ---------------- */
function renderHead() {
    const u = P_STATE.user || {};
    const c = P_STATE.counts || {};
    const registered = u.created_at ? String(u.created_at).slice(0, 10) : '—';
    $('profileHead').innerHTML = ''
        + '<div class="profile-avatar" style="background:' + avatarColor(u.nickname) + '">'
        +   escapeHtml((u.nickname || '用').charAt(0)) + '</div>'
        + '<div class="profile-info">'
        +   '<div class="profile-nick">' + escapeHtml(u.nickname || '') + '</div>'
        +   '<div class="profile-sub">账号 ' + escapeHtml(u.username || '')
        +     ' · 注册于 ' + registered + '</div>'
        + '</div>'
        + '<div class="profile-stats">'
        +   '<div><strong>' + (c.products || 0) + '</strong><span>发布</span></div>'
        +   '<div><strong>' + (c.favorites || 0) + '</strong><span>收藏</span></div>'
        +   '<div><strong>' + (c.wants || 0) + '</strong><span>想要</span></div>'
        +   '<div><strong>' + (c.orders_buy || 0) + ' / '
        +     (c.orders_sell || 0) + '</strong><span>买到 / 卖出</span></div>'
        + '</div>'
        + '<button class="btn-logout" id="btnLogout">退出登录</button>';

    $('btnLogout').addEventListener('click', async function () {
        if (!confirm('确定退出登录？')) return;
        await Auth.logout();
        location.href = 'index.html';
    });
}

/* ---------------- 我发布的 ---------------- */
async function loadMyPosts() {
    const box = $('myProducts');
    box.innerHTML = '<div class="empty-state">加载中…</div>';
    try {
        const json = await API.get('/me/products');
        const list = pickList(json.data);
        if (!list.length) {
            box.innerHTML = '<div class="empty-state">还没有发布过闲置，'
                + '<a href="publish.html">去发布第一件 →</a></div>';
            return;
        }
        box.innerHTML = list.map(function (p) {
            return '<div class="owner-card">'
                + productCardHtml(p)
                + '<div class="owner-actions">'
                +   '<button class="btn-mini" data-act="toggle" data-id="' + p.id
                +     '" data-status="' + escapeHtml(p.status) + '">'
                +     (p.status === '在售' ? '标记已售出' : '重新上架') + '</button>'
                +   '<button class="btn-mini danger" data-act="del" data-id="' + p.id + '">删除</button>'
                + '</div>'
                + '</div>';
        }).join('');

        box.querySelectorAll('.owner-actions .btn-mini').forEach(function (btn) {
            btn.addEventListener('click', async function (e) {
                e.preventDefault();
                e.stopPropagation();
                const id = btn.dataset.id;
                if (btn.dataset.act === 'del') {
                    if (!confirm('确定删除该商品？删除后不可恢复。')) return;
                    try {
                        await API.del('/products/' + id);
                        toast('商品已删除', 'ok');
                        loadMyPosts();
                    } catch (err) { Auth.handleError(err); }
                } else {
                    const to = btn.dataset.status === '在售' ? '已售出' : '在售';
                    try {
                        await API.post('/products/' + id + '/status', { status: to });
                        toast('已更新为「' + to + '」', 'ok');
                        loadMyPosts();
                    } catch (err) { Auth.handleError(err); }
                }
            });
        });
    } catch (e) {
        box.innerHTML = '<div class="empty-state">' + escapeHtml(e.message) + '</div>';
    }
}

/* ---------------- 收藏 / 想要 ---------------- */
async function loadFav(type) {
    P_STATE.favType = type;
    const box = $('favList');
    box.innerHTML = '<div class="empty-state">加载中…</div>';
    try {
        const json = await API.get('/me/collections?type=' + type);
        const list = pickList(json.data);
        if (!list.length) {
            box.innerHTML = '<div class="empty-state">'
                + (type === 'favorite' ? '还没有收藏任何商品' : '还没有标记过想要')
                + '，<a href="index.html">去逛逛 →</a></div>';
            return;
        }
        box.innerHTML = list.map(productCardHtml).join('');
    } catch (e) {
        box.innerHTML = '<div class="empty-state">' + escapeHtml(e.message) + '</div>';
    }
}

/* ---------------- 订单 ---------------- */
/* 后端订单状态机：待付款 →（买家）已付款/已取消；（卖家）已付款 → 已完成/已取消 */
const ORDER_STATUS_CLASS = {
    '待付款': 'warn', '已付款': 'info', '已完成': 'ok', '已取消': 'muted'
};

function orderActions(o, role) {
    const s = o.status;
    let html = '';
    if (role === 'buyer') {
        if (s === '待付款') {
            html += '<button class="btn-mini primary" data-act="已付款" data-id="' + o.id + '">去付款</button>';
            html += '<button class="btn-mini danger" data-act="已取消" data-id="' + o.id + '">取消订单</button>';
        } else if (s === '已付款') {
            html += '<span class="order-tip">等待卖家确认交付</span>';
        }
    } else {
        if (s === '待付款') {
            html += '<button class="btn-mini danger" data-act="已取消" data-id="' + o.id + '">关闭订单</button>';
        } else if (s === '已付款') {
            html += '<button class="btn-mini primary" data-act="已完成" data-id="' + o.id + '">确认完成交易</button>';
            html += '<button class="btn-mini danger" data-act="已取消" data-id="' + o.id + '">取消订单</button>';
        }
    }
    return html ? '<div class="order-actions">' + html + '</div>' : '';
}

async function loadOrders(role) {
    P_STATE.orderRole = role;
    const box = $('orderList');
    box.innerHTML = '<div class="empty-state">加载中…</div>';
    try {
        const json = await API.get('/orders?role=' + role);
        const list = pickList(json.data);
        if (!list.length) {
            box.innerHTML = '<div class="empty-state">'
                + (role === 'buyer' ? '还没有买到任何东西' : '还没有卖出任何东西') + '</div>';
            return;
        }
        box.innerHTML = list.map(function (o) {
            const peer = role === 'buyer' ? o.seller_name : o.buyer_name;
            return '<div class="order-row">'
                + '<img class="order-img" src="' + imgUrl(o.product_image || '') + '" alt="">'
                + '<div class="order-main">'
                +   '<div class="order-title"><a href="detail.html?id=' + o.product_id + '">'
                +     escapeHtml(o.product_title || '商品已删除')
                +   '</a></div>'
                +   '<div class="order-sub">订单号 ' + escapeHtml(o.order_no)
                +     ' · ' + (role === 'buyer' ? '卖家 ' : '买家 ')
                +     escapeHtml(peer || '—')
                +     ' · ' + escapeHtml(String(o.created_at || '').slice(0, 16)) + '</div>'
                + '</div>'
                + '<div class="order-price">¥' + priceText(o.amount) + '</div>'
                + '<span class="order-status ' + (ORDER_STATUS_CLASS[o.status] || 'muted') + '">'
                +   escapeHtml(o.status) + '</span>'
                + orderActions(o, role)
                + '</div>';
        }).join('');

        box.querySelectorAll('.order-actions .btn-mini').forEach(function (btn) {
            btn.addEventListener('click', async function () {
                try {
                    await API.post('/orders/' + btn.dataset.id + '/status',
                        { status: btn.dataset.act });
                    toast('订单状态已更新为「' + btn.dataset.act + '」', 'ok');
                    loadOrders(P_STATE.orderRole);
                } catch (e) { Auth.handleError(e); }
            });
        });
    } catch (e) {
        box.innerHTML = '<div class="empty-state">' + escapeHtml(e.message) + '</div>';
    }
}

/* ---------------- 私信会话 ---------------- */
async function loadConversations() {
    const box = $('convList');
    box.innerHTML = '<div class="empty-state">加载中…</div>';
    try {
        const json = await API.get('/messages/conversations');
        const list = pickList(json.data);
        if (!list.length) {
            box.innerHTML = '<div class="empty-state">还没有私信往来，'
                + '在商品详情页点「私信卖家」发起聊天吧</div>';
            updateMsgBadge(0);
            return;
        }
        let unread = 0;
        box.innerHTML = list.map(function (c) {
            if (c.unread) unread += c.unread;
            return '<div class="conv-row" data-peer="' + c.peer_id
                + '" data-product="' + (c.product_id || '') + '">'
                + '<span class="conv-avatar" style="background:'
                +   avatarColor(c.peer_name || '友') + '">'
                +   escapeHtml((c.peer_name || '友').charAt(0)) + '</span>'
                + '<div class="conv-main">'
                +   '<div class="conv-top"><span class="conv-name">'
                +     escapeHtml(c.peer_name || '用户') + '</span>'
                +     '<span class="conv-time">'
                +     escapeHtml(String(c.last_time || '').slice(5, 16)) + '</span></div>'
                +   '<div class="conv-last">' + (c.last_mine ? '我：' : '')
                +     escapeHtml(c.last_content || '') + '</div>'
                +   (c.product_title ? '<div class="conv-good">关于：'
                +     escapeHtml(c.product_title) + '</div>' : '')
                + '</div>'
                + (c.unread ? '<span class="badge">' + c.unread + '</span>' : '')
                + '</div>';
        }).join('');
        updateMsgBadge(unread);

        box.querySelectorAll('.conv-row').forEach(function (row) {
            row.addEventListener('click', function () {
                openChat({
                    peerId: Number(row.dataset.peer),
                    peerName: row.querySelector('.conv-name').textContent,
                    productId: row.dataset.product ? Number(row.dataset.product) : null,
                    productTitle: (row.querySelector('.conv-good') || {}).textContent || '',
                    productImage: ''
                });
            });
        });
    } catch (e) {
        box.innerHTML = '<div class="empty-state">' + escapeHtml(e.message) + '</div>';
    }
}

function updateMsgBadge(n) {
    const b = $('msgBadge');
    if (!b) return;
    if (n > 0) { b.style.display = ''; b.textContent = n; }
    else { b.style.display = 'none'; }
}

/* ---------------- 刷新统计数字 ---------------- */
async function refreshCounts() {
    try {
        const me = await API.get('/me');
        P_STATE.user = me.data.user || P_STATE.user;
        P_STATE.counts = me.data.counts || {};
        renderHead();
    } catch (e) { /* 统计失败不影响页面 */ }
}

/* ---------------- 标签页切换 ---------------- */
function switchTab(name) {
    document.querySelectorAll('#tabs .tab').forEach(function (t) {
        t.classList.toggle('active', t.dataset.tab === name);
    });
    ['posts', 'fav', 'orders', 'msgs'].forEach(function (k) {
        $('panel-' + k).style.display = (k === name) ? '' : 'none';
    });
    if (name === 'posts') loadMyPosts();
    if (name === 'fav') loadFav(P_STATE.favType);
    if (name === 'orders') loadOrders(P_STATE.orderRole);
    if (name === 'msgs') loadConversations();
    history.replaceState(null, '', '#' + name);
}

/* ---------------- 初始化 ---------------- */
async function init() {
    mountUserChip();
    mountCatBar();

    const user = await Auth.refresh();
    if (!user) {
        $('profileHead').classList.add('is-guard');
        $('profileHead').innerHTML = ''
            + '<div class="login-guard">'
            +   '<div class="guard-icon">'
            +     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"'
            +       ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            +       '<rect x="4.2" y="10.4" width="15.6" height="9.8" rx="2.6"></rect>'
            +       '<path d="M8.2 10.4V7.6a3.8 3.8 0 0 1 7.6 0v2.8"></path>'
            +       '<circle cx="12" cy="15.2" r="1.3" fill="currentColor" stroke="none"></circle>'
            +     '</svg>'
            +   '</div>'
            +   '<h2 class="guard-title">你还未登录</h2>'
            +   '<p class="guard-desc">登录后即可查看个人中心，管理你发布的闲置、收藏、订单与私信。</p>'
            +   '<div class="guard-actions">'
            +     '<a class="guard-btn primary" href="login.html?next='
            +       encodeURIComponent('profile.html') + '">立即登录</a>'
            +     '<a class="guard-btn ghost" href="login.html?mode=register&next='
            +       encodeURIComponent('profile.html') + '">注册新账号</a>'
            +   '</div>'
            + '</div>';
        $('tabs').style.display = 'none';
        ['posts', 'fav', 'orders', 'msgs'].forEach(function (k) {
            $('panel-' + k).style.display = 'none';
        });
        return;
    }
    $('profileHead').classList.remove('is-guard');

    await refreshCounts();

    $('tabs').addEventListener('click', function (e) {
        const t = e.target.closest('.tab');
        if (t) switchTab(t.dataset.tab);
    });
    document.querySelectorAll('#panel-fav .sub-tab').forEach(function (t) {
        t.addEventListener('click', function () {
            document.querySelectorAll('#panel-fav .sub-tab').forEach(function (x) {
                x.classList.toggle('active', x === t);
            });
            loadFav(t.dataset.sub);
        });
    });
    document.querySelectorAll('#panel-orders .sub-tab').forEach(function (t) {
        t.addEventListener('click', function () {
            document.querySelectorAll('#panel-orders .sub-tab').forEach(function (x) {
                x.classList.toggle('active', x === t);
            });
            loadOrders(t.dataset.role);
        });
    });

    $('searchBtn').addEventListener('click', function () {
        const kw = $('searchInput').value.trim();
        if (kw) location.href = 'index.html?q=' + encodeURIComponent(kw);
    });

    const hash = (location.hash || '').replace('#', '');
    switchTab(['posts', 'fav', 'orders', 'msgs'].indexOf(hash) >= 0 ? hash : 'posts');
}

document.addEventListener('DOMContentLoaded', init);
