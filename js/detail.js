/* ================================================================
   detail.js —— 商品详情页：多图相册 / 收藏想要 / 拍下下单 / 私信卖家
   ================================================================ */

let DETAIL = { product: null, images: [], index: 0 };

function $(id) { return document.getElementById(id); }

function getQueryId() {
    return Number(new URLSearchParams(location.search).get('id') || 0);
}

function renderGallery(p) {
    if (!DETAIL.images.length) DETAIL.images = [''];
    const cur = DETAIL.images[DETAIL.index] || '';
    let html = '<img class="detail-img" id="mainImg" src="' + imgUrl(cur)
        + '" alt="' + escapeHtml(p.title) + '">';
    if (DETAIL.images.length > 1) {
        html += '<div class="thumb-row">';
        DETAIL.images.forEach(function (u, i) {
            html += '<img class="thumb' + (i === DETAIL.index ? ' active' : '')
                + '" src="' + imgUrl(u) + '" data-i="' + i + '" alt="图' + (i + 1) + '">';
        });
        html += '</div>';
    }
    return html;
}

function renderDetail(p) {
    DETAIL.product = p;
    DETAIL.images = (p.images && p.images.length) ? p.images : [p.image];
    DETAIL.index = 0;

    $('bcCat').textContent = p.category_name || p.category || '未分类';
    $('bcTitle').textContent = p.title;

    const seller = p.seller || {};
    const sold = (p.status !== '在售');
    const mine = !!p.is_mine;

    let actions = '';
    if (mine) {
        actions = '<div class="action-row">'
            + (p.status === '在售'
                ? '<button class="btn-buy" id="btnStatus" data-to="已售出">标记为已售出</button>'
                : '<button class="btn-buy" id="btnStatus" data-to="在售">重新上架</button>')
            + '<button class="btn-ghost" id="btnDelete">删除商品</button>'
            + '<button class="btn-ghost" id="btnMineChat">查看私信</button>'
            + '</div>';
    } else {
        actions = '<div class="action-row">'
            + '<button class="btn-buy" id="btnBuy"' + (sold ? ' disabled' : '') + '>'
            +   (sold ? '该商品' + escapeHtml(p.status) : '立即拍下') + '</button>'
            + '<button class="btn-want" id="btnWant">'
            +   (p.is_wanted ? '已想要 ♡' : '想要 ♡') + ' <span id="wantCount">'
            +   (p.wants || 0) + '</span>人</button>'
            + '<button class="btn-fav' + (p.is_favorite ? ' active' : '') + '" id="btnFav">'
            +   (p.is_favorite ? '♥ 已收藏' : '♡ 收藏') + '</button>'
            + '</div>';
    }

    $('detailBox').innerHTML = ''
        + '<div class="detail-card">'
        +   '<div class="detail-gallery">' + renderGallery(p) + '</div>'
        +   '<div>'
        +     '<div class="detail-title">' + escapeHtml(p.title)
        +       '<span class="status-pill' + (sold ? ' done' : '') + '">'
        +       escapeHtml(p.status || '在售') + '</span></div>'
        +     '<div class="detail-price-box">'
        +       '<span class="detail-price"><span class="yuan">¥</span>'
        +         priceText(p.price) + '</span>'
        +       (p.original_price ? '<span class="detail-orig">原价 ¥' + priceText(p.original_price)
            + '</span>' : '')
        +       '<span class="detail-price-tip">校园自提 · 支持当面验货</span>'
        +     '</div>'
        +     '<div class="detail-meta">'
        +       '<span class="tag">成色：' + escapeHtml(p.condition || '未填写') + '</span>'
        +       '<span class="tag">分类：' + escapeHtml(p.category_name || p.category || '未分类')
        +       '</span>'
        +       '<span class="tag">地点：' + escapeHtml(p.location || '未填写') + '</span>'
        +       '<span class="tag">浏览：<span id="viewCount">' + (p.views || 0)
        +       '</span> 次</span>'
        +       '<span class="tag">想要：<span id="wantTag">' + (p.wants || 0)
        +       '</span> 人</span>'
        +     '</div>'
        +     '<div class="seller-card">'
        +       '<span class="avatar" style="background:'
        +         avatarColor(seller.nickname || '卖家') + '">'
        +         escapeHtml((seller.nickname || '卖').charAt(0)) + '</span>'
        +       '<div class="seller-info">'
        +         '<div class="seller-nick">' + escapeHtml(seller.nickname || '匿名用户')
        +         '</div>'
        +         '<div class="seller-sub">'
        +           (seller.created_at ? '注册于 ' + escapeHtml(String(seller.created_at).slice(0, 10)) : '')
        +         '</div>'
        +       '</div>'
        +       (mine ? '<span class="contact-btn" style="cursor:default;">这是我发布的</span>'
            : '<button class="contact-btn" id="btnChat">私信卖家</button>')
        +     '</div>'
        +     actions
        +   '</div>'
        + '</div>';

    /* 相册切换 */
    const thumbRow = document.querySelector('.thumb-row');
    if (thumbRow) {
        thumbRow.addEventListener('click', function (e) {
            const t = e.target.closest('.thumb');
            if (!t) return;
            DETAIL.index = Number(t.dataset.i);
            $('mainImg').src = imgUrl(DETAIL.images[DETAIL.index]);
            document.querySelectorAll('.thumb').forEach(function (el) {
                el.classList.toggle('active', Number(el.dataset.i) === DETAIL.index);
            });
        });
    }

    /* 描述 / 相关推荐 */
    $('descCard').style.display = '';
    $('detailDesc').textContent = p.description || '卖家很懒，什么都没写。';

    /* 按钮绑定 */
    if (mine) {
        $('btnDelete').addEventListener('click', deleteSelf);
        $('btnMineChat').addEventListener('click', function () {
            location.href = 'profile.html#messages';
        });
        const bs = $('btnStatus');
        if (bs) {
            bs.addEventListener('click', async function () {
                try {
                    await API.post('/products/' + p.id + '/status', { status: bs.dataset.to });
                    toast('已更新为「' + bs.dataset.to + '」', 'ok');
                    setTimeout(function () { location.reload(); }, 700);
                } catch (e) { Auth.handleError(e); }
            });
        }
    } else {
        if (!sold) $('btnBuy').addEventListener('click', buyNow);
        $('btnWant').addEventListener('click', toggleWant);
        $('btnFav').addEventListener('click', toggleFav);
        if (!mine) $('btnChat').addEventListener('click', chatWithSeller);
    }
}

/* 记录一次浏览 */
async function recordView() {
    try {
        const json = await API.post('/products/' + DETAIL.product.id + '/view');
        const el = $('viewCount');
        if (el) el.textContent = json.data.views;
    } catch (e) { }
}

async function toggleWant() {
    if (!Auth.requireLogin('登录后才能标记想要')) return;
    try {
        const json = await API.post('/products/' + DETAIL.product.id + '/want');
        const active = json.data.active;
        const btn = $('btnWant');
        btn.classList.toggle('active', active);
        btn.innerHTML = (active ? '已想要 ♡ ' : '想要 ♡ ')
            + '<span id="wantCount">' + json.data.wants + '</span>人';
        $('wantTag').textContent = json.data.wants;
        toast(active ? '已加入想要清单（收藏页可见）' : '已取消想要', 'ok');
    } catch (e) { Auth.handleError(e); }
}

async function toggleFav() {
    if (!Auth.requireLogin('登录后才能收藏')) return;
    try {
        const json = await API.post('/products/' + DETAIL.product.id + '/favorite');
        const active = json.data.active;
        const btn = $('btnFav');
        btn.classList.toggle('active', active);
        btn.textContent = active ? '♥ 已收藏' : '♡ 收藏';
        toast(active ? '已收藏，可在首页"只看收藏"查看' : '已取消收藏', 'ok');
    } catch (e) { Auth.handleError(e); }
}

async function buyNow() {
    if (!Auth.requireLogin('登录后才能拍下商品')) return;
    if (!confirm('确认拍下「' + DETAIL.product.title + '」？\n拍下后请到「个人中心-我的订单」完成付款。')) return;
    try {
        const json = await API.post('/orders', { product_id: DETAIL.product.id });
        toast('拍下成功，订单号 ' + json.data.order_no, 'ok');
        setTimeout(function () { location.href = 'profile.html#orders'; }, 900);
    } catch (e) { Auth.handleError(e); }
}

function chatWithSeller() {
    const seller = DETAIL.product.seller || {};
    if (!seller.id) { toast('该商品没有关联卖家，无法私信', 'err'); return; }
    openChat({
        peerId: seller.id,
        peerName: seller.nickname || '卖家',
        productId: DETAIL.product.id,
        productTitle: DETAIL.product.title,
        productImage: DETAIL.product.image
    });
}

async function deleteSelf() {
    if (!confirm('确定删除商品「' + DETAIL.product.title + '」？删除后不可恢复。')) return;
    try {
        await API.del('/products/' + DETAIL.product.id);
        toast('商品已删除', 'ok');
        setTimeout(function () { location.href = 'index.html'; }, 800);
    } catch (e) { Auth.handleError(e); }
}

function renderRelated(list) {
    if (!list || !list.length) return;
    $('relatedSection').style.display = '';
    $('relatedList').innerHTML = list.map(productCardHtml).join('');
}

async function init() {
    mountUserChip();
    mountCatBar();

    const id = getQueryId();
    if (!id) {
        $('detailBox').innerHTML = '<div class="empty-state">缺少商品 ID，'
            + '<a href="index.html">返回首页</a></div>';
        return;
    }

    try {
        const json = await API.get('/products/' + id);
        renderDetail(json.data.product);
        renderRelated(json.data.related);
        recordView();
    } catch (e) {
        $('detailBox').innerHTML = '<div class="empty-state">' + escapeHtml(e.message)
            + '，<a href="index.html">返回首页</a></div>';
    }

    $('searchBtn').addEventListener('click', function () {
        const kw = $('searchInput').value.trim();
        if (kw) location.href = 'index.html?q=' + encodeURIComponent(kw);
    });
    $('searchInput').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') $('searchBtn').click();
    });
}

document.addEventListener('DOMContentLoaded', init);
