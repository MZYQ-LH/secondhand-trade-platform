/* ================================================================
   profile.js —— 个人中心：我的发布 / 收藏想要 / 订单 / 私信会话 / 我的评价
   接口对齐说明：
     · GET  /api/me                → {user:{...}, counts:{products,favorites,wants,orders_buy,orders_sell,unread}}
     · GET  /api/me/products       → 数组（我的全部商品，含已售出）
     · GET  /api/me/collections?type=favorite|want → 数组
     · GET  /api/orders?role=buyer|seller          → 数组（含 reviewed 标记）
     · GET  /api/messages/conversations            → 数组
     · POST /api/me/profile                        → {user:{...}}（修改昵称 / 头像）
     · POST /api/me/password                       → 修改密码（校验原密码）
     · GET  /api/me/reviews?role=sent|received     → {role,total,avg,list}
     · POST /api/orders/<id>/review                → {评价记录}（订单完成后买家 1-5 星 + 文字评价）
   ================================================================ */

const P_STATE = {
    user: null,
    counts: {},
    favType: 'favorite',
    orderRole: 'buyer',
    reviewRole: 'sent',
    avatar: ''            // 弹窗中待提交的头像地址（'' 表示使用默认色块头像）
};

function $(id) { return document.getElementById(id); }

/* 接口返回可能是数组，也可能是 {list:[...]}，统一取列表 */
function pickList(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.list)) return data.list;
    return [];
}

/* ---------------- 个人信息卡 ---------------- */
/* 头像统一渲染：有上传头像用图片，没有则用昵称首字色块（与全站配色一致） */
function userAvatarHtml(u, cls) {
    const name = (u && u.nickname) || '用';
    if (u && u.avatar) {
        return '<img class="' + cls + '" src="' + imgUrl(u.avatar)
            + '" alt="' + escapeHtml(name) + '">';
    }
    return '<span class="' + cls + '" style="background:' + avatarColor(name) + '">'
        + escapeHtml(name.charAt(0)) + '</span>';
}

function renderHead() {
    const u = P_STATE.user || {};
    const c = P_STATE.counts || {};
    const registered = u.created_at ? String(u.created_at).slice(0, 10) : '—';
    $('profileHead').innerHTML = ''
        + userAvatarHtml(u, 'profile-avatar')
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
        + '<div class="profile-actions">'
        +   '<button class="btn-logout" id="btnEditProfile">编辑资料</button>'
        +   '<button class="btn-logout" id="btnEditPassword">修改密码</button>'
        +   '<button class="btn-logout" id="btnLogout">退出登录</button>'
        + '</div>';

    $('btnEditProfile').addEventListener('click', function () { openEditModal('profile'); });
    $('btnEditPassword').addEventListener('click', function () { openEditModal('password'); });
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
        } else if (s === '已完成') {
            /* 评价入口：订单完成后买家可评一次，已评价的只展示标记 */
            if (o.reviewed) {
                html += '<span class="order-tip">已评价</span>';
            } else {
                html += '<button class="btn-mini primary" data-act="review" data-id="'
                    + o.id + '">评价</button>';
            }
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
        P_STATE.orders = list;
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
                /* 「评价」按钮进弹窗，其余按钮沿用原有的订单状态流转 */
                if (btn.dataset.act === 'review') {
                    const oid = Number(btn.dataset.id);
                    const o = (P_STATE.orders || []).filter(function (x) {
                        return Number(x.id) === oid;
                    })[0];
                    openReviewModal(o || { id: oid });
                    return;
                }
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

/* ================= 个人信息修改（昵称 / 头像 / 密码） ================= */
/* 与后端 app.py 校验规则对齐：
     · 昵称：非空、≤ 20 字符（NICKNAME_MAX，与注册接口一致）
     · 头像：上传后得到 /images/xxx 路径，可清除为空；后端只接受空值或 / 、http(s) 开头
     · 密码：原密码必填；新密码 6-64 位、不能与原密码相同；两次输入一致
   前端先即时校验并给出提示，后端仍会二次校验（双端对齐，改接口前后端同改） */
const NICK_MAX = 20;
const PWD_MIN = 6;
const PWD_MAX = 64;
const AVATAR_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
const AVATAR_MAX_MB = 5;

function showEditError(msg) {
    const box = $('editError');
    box.textContent = msg;
    box.classList.add('show');
}

function clearEditError() { $('editError').classList.remove('show'); }

/* 弹窗头像预览：有头像显示图片，无头像显示昵称首字色块 */
function renderEditAvatar() {
    const el = $('editAvatarPreview');
    const nick = ($('editNickname').value || '').trim() || '用';
    if (P_STATE.avatar) {
        el.outerHTML = '<img class="avatar avatar-lg" id="editAvatarPreview" src="'
            + imgUrl(P_STATE.avatar) + '" alt="头像预览">';
    } else {
        el.outerHTML = '<span class="avatar avatar-lg" id="editAvatarPreview" style="background:'
            + avatarColor(nick) + '">' + escapeHtml(nick.charAt(0)) + '</span>';
    }
}

function openEditModal(mode) {
    clearEditError();
    const u = P_STATE.user || {};
    const isProfile = (mode !== 'password');
    $('editTitle').textContent = isProfile ? '修改个人资料' : '修改密码';
    $('profileForm').style.display = isProfile ? '' : 'none';
    $('passwordForm').style.display = isProfile ? 'none' : '';
    if (isProfile) {
        P_STATE.avatar = u.avatar || '';
        $('editUsername').value = u.username || '';
        $('editNickname').value = u.nickname || '';
        renderEditAvatar();
    } else {
        $('oldPassword').value = '';
        $('newPassword').value = '';
        $('confirmPassword').value = '';
    }
    $('editMask').classList.add('show');
}

function closeEditModal() { $('editMask').classList.remove('show'); }

async function submitProfile() {
    clearEditError();
    const nickname = $('editNickname').value.trim();
    if (!nickname) return showEditError('请输入昵称');
    if (nickname.length > NICK_MAX) return showEditError('昵称最多 ' + NICK_MAX + ' 个字符');

    const btn = $('profileSubmitBtn');
    btn.disabled = true;
    try {
        const json = await API.post('/me/profile', {
            nickname: nickname,
            avatar: P_STATE.avatar || ''
        });
        P_STATE.user = (json.data && json.data.user) || P_STATE.user;
        renderHead();
        closeEditModal();
        toast('个人资料已更新', 'ok');
    } catch (e) {
        showEditError(e.message);
    }
    btn.disabled = false;
}

async function submitPassword() {
    clearEditError();
    const oldPwd = $('oldPassword').value;
    const newPwd = $('newPassword').value;
    const confirmPwd = $('confirmPassword').value;

    if (!oldPwd) return showEditError('请输入原密码');
    if (!newPwd || newPwd.length < PWD_MIN) return showEditError('新密码至少 ' + PWD_MIN + ' 位');
    if (newPwd.length > PWD_MAX) return showEditError('新密码最多 ' + PWD_MAX + ' 位');
    if (newPwd === oldPwd) return showEditError('新密码不能与原密码相同');
    if (newPwd !== confirmPwd) return showEditError('两次输入的新密码不一致');

    const btn = $('passwordSubmitBtn');
    btn.disabled = true;
    try {
        await API.post('/me/password', {
            old_password: oldPwd,
            new_password: newPwd,
            confirm_password: confirmPwd
        });
        closeEditModal();
        toast('密码修改成功，下次请用新密码登录', 'ok');
    } catch (e) {
        showEditError(e.message);
    }
    btn.disabled = false;
}

/* 头像上传：先在前端校验格式与大小（与后端 ALLOWED_EXTENSIONS / 5MB 一致），再走通用上传接口 */
async function uploadAvatar(file) {
    const name = (file.name || '').toLowerCase();
    const ext = name.indexOf('.') >= 0 ? name.split('.').pop() : '';
    if (AVATAR_EXT.indexOf(ext) < 0) {
        return showEditError('头像仅支持 ' + AVATAR_EXT.join(' / ') + ' 格式');
    }
    if (file.size > AVATAR_MAX_MB * 1024 * 1024) {
        return showEditError('头像不能超过 ' + AVATAR_MAX_MB + 'MB');
    }
    clearEditError();
    try {
        const json = await API.upload([file]);
        const url = (json.data && (json.data.url || (json.data.urls || [])[0])) || '';
        if (!url) return showEditError('上传失败，请重试');
        P_STATE.avatar = url;
        renderEditAvatar();
        toast('头像已上传，记得点「保存修改」', 'ok');
    } catch (e) {
        showEditError(e.message);
    }
}

/* ================= 订单评价（1-5 星 + 文字评价） ================= */
/* 与后端对齐：评分必须是 1-5 的整数；文字评价选填、≤ 200 字（REVIEW_MAX_LEN）；
   仅订单买家、订单状态为「已完成」、一单一评，最终以后端校验为准 */
const REVIEW_MAX = 200;
const REVIEW_TARGET = { id: 0, rating: 0 };
const STAR_TIPS = ['请选择评分', '很不满意', '不太满意', '一般', '满意', '非常满意'];

function paintStars(n) {
    document.querySelectorAll('#starPicker .star').forEach(function (s) {
        s.classList.toggle('on', Number(s.dataset.star) <= n);
    });
    $('starTip').textContent = STAR_TIPS[n] || STAR_TIPS[0];
}

function openReviewModal(order) {
    REVIEW_TARGET.id = Number(order.id) || 0;
    REVIEW_TARGET.rating = 0;
    $('reviewTarget').innerHTML = order.product_title
        ? '<div class="review-good-name">' + escapeHtml(order.product_title) + '</div>'
          + '<div class="review-good-sub">订单号 ' + escapeHtml(order.order_no || '')
          + ' · 完成后即可评价，每单仅可评价一次</div>'
        : '<div class="review-good-sub">完成后即可评价，每单仅可评价一次</div>';
    $('reviewContent').value = '';
    paintStars(0);
    $('reviewMask').classList.add('show');
}

function closeReviewModal() { $('reviewMask').classList.remove('show'); }

async function submitReview() {
    if (!REVIEW_TARGET.id) return toast('订单信息缺失，请刷新页面后重试', 'err');
    if (!REVIEW_TARGET.rating) return toast('请先选择 1-5 星评分', 'err');
    const content = $('reviewContent').value.trim();
    if (content.length > REVIEW_MAX) return toast('评价内容最多 ' + REVIEW_MAX + ' 字', 'err');

    const btn = $('reviewSubmitBtn');
    btn.disabled = true;
    try {
        await API.post('/orders/' + REVIEW_TARGET.id + '/review', {
            rating: REVIEW_TARGET.rating,
            content: content
        });
        closeReviewModal();
        toast('评价已提交，感谢你的反馈', 'ok');
        loadOrders(P_STATE.orderRole);
        loadMyReviews(P_STATE.reviewRole);
    } catch (e) {
        toast(e.message, 'err');
    }
    btn.disabled = false;
}

/* ================= 我的评价（我发出的 / 我收到的） ================= */
/* 星级展示：实心 ★ 表已得分数，空心 ☆ 补齐 5 星 */
function starsHtml(n) {
    const v = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
    return '<span class="stars">' + '★★★★★'.slice(0, v) + '☆☆☆☆☆'.slice(0, 5 - v)
        + '</span>';
}

async function loadMyReviews(role) {
    P_STATE.reviewRole = role;
    const box = $('myReviewList');
    const sum = $('myReviewSummary');
    box.innerHTML = '<div class="empty-state">加载中…</div>';
    try {
        const json = await API.get('/me/reviews?role=' + role);
        const d = json.data || {};
        const list = d.list || [];
        const avg = Number(d.avg) || 0;
        sum.innerHTML = '<div class="review-summary">'
            + '<div class="review-score"><strong>' + (avg ? priceText(avg) : '—')
            + '</strong><span>平均分</span></div>'
            + '<div class="review-summary-side">'
            +   starsHtml(avg)
            +   '<span class="review-summary-sub">共 ' + (d.total || 0) + ' 条'
            +     (role === 'received' ? '收到的评价' : '发出的评价') + '</span>'
            + '</div></div>';

        if (!list.length) {
            box.innerHTML = '<div class="empty-state">'
                + (role === 'received'
                    ? '还没有收到评价：交易完成后买家即可给你评价'
                    : '你还没有评价过订单：到「我的订单」里点「评价」即可打分')
                + '</div>';
            return;
        }
        box.innerHTML = list.map(function (r) {
            const peer = (role === 'sent' ? '卖家 ' : '买家 ') + (r.peer_name || '—');
            return '<div class="review-item">'
                + '<div class="review-item-head">'
                +   '<a class="review-good-name" href="detail.html?id=' + r.product_id + '">'
                +     escapeHtml(r.product_title || '商品') + '</a>'
                +   '<span class="review-item-time">'
                +     escapeHtml(String(r.created_at || '').slice(0, 16)) + '</span>'
                + '</div>'
                + '<div class="review-item-meta">' + starsHtml(r.rating)
                +   '<span class="review-item-peer">' + escapeHtml(peer) + '</span></div>'
                + (r.content
                    ? '<div class="review-item-text">' + escapeHtml(r.content) + '</div>'
                    : '<div class="review-item-text is-empty">未填写文字评价</div>')
                + '</div>';
        }).join('');
    } catch (e) {
        sum.innerHTML = '';
        box.innerHTML = '<div class="empty-state">' + escapeHtml(e.message) + '</div>';
    }
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
    ['posts', 'fav', 'orders', 'msgs', 'reviews'].forEach(function (k) {
        $('panel-' + k).style.display = (k === name) ? '' : 'none';
    });
    if (name === 'posts') loadMyPosts();
    if (name === 'fav') loadFav(P_STATE.favType);
    if (name === 'orders') loadOrders(P_STATE.orderRole);
    if (name === 'msgs') loadConversations();
    if (name === 'reviews') loadMyReviews(P_STATE.reviewRole);
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
        ['posts', 'fav', 'orders', 'msgs', 'reviews'].forEach(function (k) {
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

    /* 我发出的 / 我收到的评价 切换 */
    document.querySelectorAll('#panel-reviews .sub-tab').forEach(function (t) {
        t.addEventListener('click', function () {
            document.querySelectorAll('#panel-reviews .sub-tab').forEach(function (x) {
                x.classList.toggle('active', x === t);
            });
            loadMyReviews(t.dataset.rrole);
        });
    });

    /* 个人信息修改弹窗：编辑资料 / 修改密码 / 头像上传 / 清除头像 */
    $('profileForm').addEventListener('submit', function (e) {
        e.preventDefault();
        submitProfile();
    });
    $('passwordForm').addEventListener('submit', function (e) {
        e.preventDefault();
        submitPassword();
    });
    $('editClose').addEventListener('click', closeEditModal);
    $('editMask').addEventListener('click', function (e) {
        if (e.target === $('editMask')) closeEditModal();
    });
    $('editNickname').addEventListener('input', renderEditAvatar);
    $('editAvatarFile').addEventListener('change', function () {
        if (this.files && this.files[0]) uploadAvatar(this.files[0]);
        this.value = '';
    });
    $('editAvatarClear').addEventListener('click', function () {
        P_STATE.avatar = '';
        renderEditAvatar();
        toast('已清除头像，点「保存修改」后生效', 'ok');
    });

    /* 订单评价弹窗：星级打分 + 提交 */
    document.querySelectorAll('#starPicker .star').forEach(function (s) {
        s.addEventListener('click', function () {
            REVIEW_TARGET.rating = Number(s.dataset.star);
            paintStars(REVIEW_TARGET.rating);
        });
        s.addEventListener('mouseenter', function () {
            paintStars(Number(s.dataset.star));
        });
    });
    $('starPicker').addEventListener('mouseleave', function () {
        paintStars(REVIEW_TARGET.rating);
    });
    $('reviewSubmitBtn').addEventListener('click', submitReview);
    $('reviewClose').addEventListener('click', closeReviewModal);
    $('reviewMask').addEventListener('click', function (e) {
        if (e.target === $('reviewMask')) closeReviewModal();
    });

    $('searchBtn').addEventListener('click', function () {
        const kw = $('searchInput').value.trim();
        if (kw) location.href = 'index.html?q=' + encodeURIComponent(kw);
    });

    const hash = (location.hash || '').replace('#', '');
    switchTab(['posts', 'fav', 'orders', 'msgs', 'reviews'].indexOf(hash) >= 0 ? hash : 'posts');
}

document.addEventListener('DOMContentLoaded', init);
