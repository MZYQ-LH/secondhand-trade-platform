/* ================================================================
   data.js —— 数据层 / 登录态 / 公共组件（对接 Flask + MySQL）
   ----------------------------------------------------------------
   包含：
     · API 请求封装（带登录态 Cookie，统一错误处理）
     · Auth 登录态对象（依赖后端 Session，刷新页面仍保持登录）
     · 公共组件：用户下拉菜单、动态分类栏、商品卡片、站内私信弹窗
   ================================================================ */

/* 后端地址：
   - 由 Flask 托管（http/https）时一律用同源地址，改端口、换主机、换 IP 都不用改代码
   - 仅当用 file:// 直接打开页面时，才回退到本机 127.0.0.1:5000 */
const API_ORIGIN = /^https?:$/.test(location.protocol) ? location.origin : 'http://127.0.0.1:5000';
const API_BASE = API_ORIGIN + '/api';

/* ---------------- 工具函数 ---------------- */

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = (text === null || text === undefined) ? '' : String(text);
    return div.innerHTML;
}

function avatarColor(name) {
    /* 头像取色：与樱花主题同一色系（粉 / 紫 / 蓝 / 青 / 暖橙），保证全站配色协调 */
    const colors = ['#EE6F97', '#FF9FB8', '#C98BE0', '#7FA8EA', '#5EC6C9', '#F2A05B', '#E4726F'];
    let hash = 0;
    const str = String(name || '闲');
    for (let i = 0; i < str.length; i++) {
        hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    return colors[hash % colors.length];
}

function priceText(price) {
    const n = Number(price) || 0;
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/* 图片地址：库里存 /images/xxx.jpg 根相对路径，需补上后端源地址 */
function imgUrl(u) {
    if (!u) return '';
    if (/^(https?:)?\/\//i.test(u) || u.startsWith('data:')) return u;
    return API_ORIGIN + (u.startsWith('/') ? u : '/' + u);
}

/* 轻提示（替代 alert，不阻塞操作） */
function toast(msg, type) {
    let wrap = document.getElementById('toastWrap');
    if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = 'toastWrap';
        document.body.appendChild(wrap);
    }
    const el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(function () {
        el.style.transition = 'opacity .3s';
        el.style.opacity = '0';
        setTimeout(function () { el.remove(); }, 320);
    }, type === 'err' ? 2800 : 2000);
}

const CONDITIONS = ['全新', '几乎全新', '轻微使用痕迹', '明显使用痕迹'];

/* 分类改为从后端动态拉取，本地做一次缓存 */
let CATEGORY_LIST = [];

async function fetchCategories() {
    if (CATEGORY_LIST.length) return CATEGORY_LIST;
    try {
        const json = await API.get('/categories');
        CATEGORY_LIST = json.data || [];
    } catch (e) {
        CATEGORY_LIST = [];
    }
    return CATEGORY_LIST;
}

/* ---------------- API 封装 ---------------- */

async function apiFetch(path, options) {
    const opt = Object.assign({ credentials: 'include' }, options || {});
    let res;
    try {
        res = await fetch(API_BASE + path, opt);
    } catch (e) {
        const err = new Error('无法连接后端服务，请确认 app.py 已启动');
        err.code = -1;
        throw err;
    }
    let json = null;
    try { json = await res.json(); } catch (e) { json = null; }
    if (!json) {
        const err = new Error('服务响应异常（HTTP ' + res.status + '）');
        err.code = res.status;
        throw err;
    }
    if (json.code !== 0) {
        const err = new Error(json.msg || '请求失败');
        err.code = json.code;
        err.status = res.status;
        throw err;
    }
    return json;
}

const API = {
    get: function (path) { return apiFetch(path); },
    post: function (path, body) {
        return apiFetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {})
        });
    },
    del: function (path) { return apiFetch(path, { method: 'DELETE' }); },
    /* 多图上传：files 为 File 数组，返回 url 数组 */
    upload: async function (files) {
        const fd = new FormData();
        Array.prototype.forEach.call(files, function (f) { fd.append('file', f); });
        return apiFetch('/upload', { method: 'POST', body: fd });
    }
};

/* ---------------- 登录态 ---------------- */

const Auth = {
    user: null,

    /* 向后端确认登录态（Session Cookie），刷新页面依然有效 */
    async refresh() {
        try {
            const json = await API.get('/me');
            this.user = json.data.user;
        } catch (e) {
            this.user = null;
        }
        return this.user;
    },

    async login(username, password, captchaId, captchaCode) {
        const json = await API.post('/login', {
            username: username,
            password: password,
            captcha_id: captchaId,
            captcha_code: captchaCode
        });
        this.user = json.data.user;
        return json;
    },

    async register(username, password, nickname, captchaId, captchaCode) {
        const json = await API.post('/register', {
            username: username,
            password: password,
            nickname: nickname,
            captcha_id: captchaId,
            captcha_code: captchaCode
        });
        this.user = json.data.user;
        return json;
    },

    async logout() {
        try { await API.post('/logout'); } catch (e) { }
        this.user = null;
    },

    isLoggedIn() { return !!this.user; },

    /* 未登录时引导去登录页，并带上回跳地址 */
    requireLogin(tip) {
        if (this.user) return true;
        toast(tip || '请先登录后再操作', 'err');
        const next = encodeURIComponent(location.pathname + location.search);
        setTimeout(function () { location.href = 'login.html?next=' + next; }, 700);
        return false;
    },

    /* 统一的接口错误处理：401 引导登录，其余提示原因 */
    handleError(e) {
        if (e && (e.code === 401 || e.status === 401)) {
            this.requireLogin('登录已过期，请重新登录');
        } else {
            toast((e && e.message) || '操作失败', 'err');
        }
    }
};

/* ---------------- 顶部用户区 ---------------- */

async function mountUserChip() {
    const el = document.getElementById('userChip');
    if (!el) return;

    const user = await Auth.refresh();

    if (!user) {
        el.classList.remove('menu-open');
        el.innerHTML = '<a class="login-entry" href="login.html">登录 / 注册</a>';
        return;
    }

    let unread = 0;
    try {
        unread = (await API.get('/messages/unread')).data.count;
    } catch (e) { }

    el.innerHTML = ''
        + (user.avatar
            ? '<img class="avatar" src="' + imgUrl(user.avatar) + '" alt="'
              + escapeHtml(user.nickname) + '">'
            : '<span class="avatar" style="background:' + avatarColor(user.nickname) + '">'
              + escapeHtml(user.nickname.charAt(0)) + '</span>')
        + '<span class="user-name">' + escapeHtml(user.nickname) + '</span>'
        + '<span class="caret">▼</span>'
        + '<div class="user-menu">'
        +   '<a class="menu-item" href="profile.html">个人中心</a>'
        +   '<a class="menu-item" href="profile.html#messages">我的消息'
        +     (unread > 0 ? '<span class="menu-badge">' + unread + '</span>' : '')
        +   '</a>'
        +   '<div class="menu-item" data-act="logout">退出登录</div>'
        + '</div>';

    el.addEventListener('click', function (e) {
        const item = e.target.closest('.menu-item');
        if (item) {
            if (item.dataset.act === 'logout') {
                Auth.logout().then(function () {
                    toast('已退出登录', 'ok');
                    setTimeout(function () { location.reload(); }, 500);
                });
            }
            return;
        }
        el.classList.toggle('menu-open');
    });

    document.addEventListener('click', function (e) {
        if (!el.contains(e.target)) el.classList.remove('menu-open');
    });
}

/* ---------------- 分类栏（从数据库动态渲染） ---------------- */

async function mountCatBar(activeName) {
    const el = document.getElementById('catBar');
    if (!el) return;
    const isIndex = document.body.dataset.page === 'index';
    const cats = await fetchCategories();
    const params = new URLSearchParams(location.search);
    const cur = activeName || params.get('cat') || 'all';

    let html = '';
    if (isIndex) {
        html += '<button class="cat-btn' + (cur === 'all' ? ' active' : '')
            + '" data-cat="all">推荐</button>';
        cats.forEach(function (c) {
            html += '<button class="cat-btn' + (cur === c.name ? ' active' : '')
                + '" data-cat="' + escapeHtml(c.name) + '">' + escapeHtml(c.name)
                + '<span class="cat-num">' + (c.product_count || 0) + '</span></button>';
        });
    } else {
        html += '<a class="cat-btn" href="index.html">推荐</a>';
        cats.forEach(function (c) {
            html += '<a class="cat-btn" href="index.html?cat='
                + encodeURIComponent(c.name) + '">' + escapeHtml(c.name) + '</a>';
        });
    }
    el.innerHTML = html;
}

/* ---------------- 商品卡片 ---------------- */

function productCardHtml(p) {
    const img = imgUrl(p.image);
    const sold = (p.status && p.status !== '在售');
    const sellerName = p.seller_name || p.seller || '匿名用户';
    return ''
        + '<div class="product-card' + (sold ? ' is-sold' : '') + '" data-id="' + p.id + '">'
        +   '<div class="card-img-wrap">'
        +     (img ? '<img class="card-img" src="' + img + '" alt="'
            + escapeHtml(p.title) + '" loading="lazy">' : '')
        +     (sold ? '<span class="sold-badge">' + escapeHtml(p.status) + '</span>' : '')
        +     ((p.image_count > 1) ? '<span class="img-count">' + p.image_count + '图</span>' : '')
        +     '<button type="button" class="fav-btn ' + (p.is_favorite ? 'active' : '')
        +       '" data-id="' + p.id + '">' + (p.is_favorite ? '♥' : '♡') + '</button>'
        +   '</div>'
        +   '<div class="card-body">'
        +     '<div class="card-title">' + escapeHtml(p.title) + '</div>'
        +     '<div class="card-price">'
        +       '<span class="yuan">¥</span>' + priceText(p.price)
        +       (p.original_price ? '<span class="orig">¥' + p.original_price + '</span>' : '')
        +     '</div>'
        +     '<div class="card-seller">'
        +       '<span class="avatar" style="background:' + avatarColor(sellerName) + '">'
        +         escapeHtml(sellerName.charAt(0)) + '</span>'
        +       '<span class="seller-name">' + escapeHtml(sellerName) + ' · '
        +         escapeHtml(p.location || '') + '</span>'
        +       '<span class="wants">♡ ' + (p.wants || 0) + '人想要</span>'
        +     '</div>'
        +   '</div>'
        + '</div>';
}

/* ---------------- 全局事件委托 ---------------- */

document.addEventListener('click', async function (e) {
    /* 收藏按钮 */
    const favBtn = e.target.closest('.fav-btn');
    if (favBtn) {
        e.stopPropagation();
        if (!Auth.requireLogin('登录后才能收藏商品')) return;
        const id = Number(favBtn.dataset.id);
        try {
            const json = await API.post('/products/' + id + '/favorite');
            const active = json.data.active;
            document.querySelectorAll('.fav-btn[data-id="' + id + '"]').forEach(function (btn) {
                btn.classList.toggle('active', active);
                btn.textContent = active ? '♥' : '♡';
            });
            toast(active ? '已收藏' : '已取消收藏', 'ok');
            if (typeof window.onFavoriteChanged === 'function') {
                window.onFavoriteChanged(id, active);
            }
        } catch (err) {
            Auth.handleError(err);
        }
        return;
    }

    /* 商品卡片 → 详情页 */
    const card = e.target.closest('.product-card');
    if (card && !e.target.closest('.card-action')) {
        window.location.href = 'detail.html?id=' + card.dataset.id;
    }
});

/* ---------------- 站内私信弹窗 ---------------- */

let CHAT_STATE = { peerId: 0, peerName: '', productId: null, timer: null };

function ensureChatDom() {
    if (document.getElementById('chatMask')) return;
    const mask = document.createElement('div');
    mask.className = 'chat-mask';
    mask.id = 'chatMask';
    mask.innerHTML = ''
        + '<div class="chat-box">'
        +   '<div class="chat-head">'
        +     '<div class="chat-peer">'
        +       '<span class="avatar" id="chatAvatar">闲</span>'
        +       '<div>'
        +         '<div class="chat-peer-name" id="chatPeerName">对方</div>'
        +         '<div class="chat-peer-sub" id="chatPeerSub">站内私信 · 实时送达</div>'
        +       '</div>'
        +     '</div>'
        +     '<button type="button" class="chat-close" id="chatClose">×</button>'
        +   '</div>'
        +   '<div class="chat-product" id="chatProduct" style="display:none;"></div>'
        +   '<div class="chat-list" id="chatList"></div>'
        +   '<div class="chat-input">'
        +     '<textarea id="chatText" placeholder="输入消息，按 Enter 发送…"></textarea>'
        +     '<button type="button" id="chatSend">发送</button>'
        +   '</div>'
        + '</div>';
    document.body.appendChild(mask);

    mask.addEventListener('click', function (e) {
        if (e.target === mask) closeChat();
    });
    document.getElementById('chatClose').addEventListener('click', closeChat);
    document.getElementById('chatSend').addEventListener('click', sendChat);
    document.getElementById('chatText').addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendChat();
        }
    });
}

function renderChatList(list) {
    const box = document.getElementById('chatList');
    if (!list.length) {
        box.innerHTML = '<div class="bubble-time">还没有聊天记录，打个招呼吧～</div>';
        return;
    }
    let html = '', lastTime = '';
    list.forEach(function (m) {
        const day = (m.created_at || '').slice(0, 10);
        if (day && day !== lastTime) {
            html += '<div class="bubble-time">' + escapeHtml(day) + '</div>';
            lastTime = day;
        }
        html += '<div class="bubble ' + (m.mine ? 'me' : 'other') + '">'
            + escapeHtml(m.content) + '</div>';
    });
    box.innerHTML = html;
    box.scrollTop = box.scrollHeight;
}

async function loadChat() {
    try {
        const json = await API.get('/messages?peer_id=' + CHAT_STATE.peerId
            + (CHAT_STATE.productId ? '&product_id=' + CHAT_STATE.productId : ''));
        renderChatList(json.data.list || []);
    } catch (e) {
        if (e.code === 401) {
            closeChat();
            Auth.requireLogin('登录后才能查看私信');
        }
    }
}

async function sendChat() {
    const input = document.getElementById('chatText');
    const content = input.value.trim();
    if (!content) return;
    input.value = '';
    try {
        await API.post('/messages', {
            receiver_id: CHAT_STATE.peerId,
            product_id: CHAT_STATE.productId,
            content: content
        });
        await loadChat();
    } catch (e) {
        Auth.handleError(e);
    }
}

/* 打开与某人的聊天窗口；未登录会引导登录 */
async function openChat(opts) {
    if (!Auth.requireLogin('登录后才能和卖家私信')) return;
    ensureChatDom();
    CHAT_STATE.peerId = Number(opts.peerId);
    CHAT_STATE.peerName = opts.peerName || '对方';
    CHAT_STATE.productId = opts.productId ? Number(opts.productId) : null;

    const avatar = document.getElementById('chatAvatar');
    avatar.textContent = CHAT_STATE.peerName.charAt(0);
    avatar.style.background = avatarColor(CHAT_STATE.peerName);
    document.getElementById('chatPeerName').textContent = CHAT_STATE.peerName;

    const prodBox = document.getElementById('chatProduct');
    if (CHAT_STATE.productId) {
        prodBox.style.display = '';
        prodBox.innerHTML = (opts.productImage ? '<img src="' + imgUrl(opts.productImage) + '">' : '')
            + '<span>正在咨询：' + escapeHtml(opts.productTitle || ('商品 #' + CHAT_STATE.productId))
            + '</span>';
    } else {
        prodBox.style.display = 'none';
    }

    document.getElementById('chatList').innerHTML = '<div class="bubble-time">加载中…</div>';
    document.getElementById('chatMask').classList.add('show');
    await loadChat();

    clearInterval(CHAT_STATE.timer);
    CHAT_STATE.timer = setInterval(loadChat, 5000);   // 5 秒轮询新消息
}

function closeChat() {
    const mask = document.getElementById('chatMask');
    if (mask) mask.classList.remove('show');
    clearInterval(CHAT_STATE.timer);
    CHAT_STATE.timer = null;
}
