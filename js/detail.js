/* ================================================================
   detail.js —— 商品详情页：多图相册 / 收藏想要 / 拍下下单 / 私信卖家 / 商品评价
   评价数据：GET /api/products/<id>/reviews → {total, avg, dist, list}
             （订单完成后由买家在个人中心提交，一单一评）
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
        +       (p.review_count
            ? '<span class="tag">评价：' + priceText(p.rating_avg || 0) + ' 分 · '
              + p.review_count + ' 条</span>'
            : '<span class="tag">评价：暂无评价</span>')
        +     '</div>'
        +     '<div class="seller-card">'
        +       (seller.avatar
            ? '<img class="avatar" src="' + imgUrl(seller.avatar) + '" alt="卖家头像">'
            : '<span class="avatar" style="background:'
              + avatarColor(seller.nickname || '卖家') + '">'
              + escapeHtml((seller.nickname || '卖').charAt(0)) + '</span>')
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

/* ---------------- 商品评价：平均分 / 星级分布 / 评价列表 ---------------- */
/* 星级展示：实心 ★ 表已得分数，空心 ☆ 补齐 5 星（与个人中心评价页一致） */
function starsHtml(n) {
    const v = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
    return '<span class="stars">' + '★★★★★'.slice(0, v) + '☆☆☆☆☆'.slice(0, 5 - v)
        + '</span>';
}

function renderReviews(d) {
    const card = $('reviewCard');
    if (!card) return;
    if (!d) { card.style.display = 'none'; return; }
    const total = Number(d.total) || 0;
    const list = d.list || [];
    card.style.display = '';

    if (!total) {
        $('reviewTotal').textContent = '';
        $('reviewSummary').style.display = 'none';
        $('reviewList').innerHTML = '<div class="empty-state">还没有评价：'
            + '买家收到货并确认交易完成后即可评价</div>';
        return;
    }

    const avg = Number(d.avg) || 0;
    const dist = d.dist || {};
    let distHtml = '';
    for (let s = 5; s >= 1; s--) {
        const n = Number(dist[String(s)] || 0);
        const pct = Math.round(n * 100 / total);
        distHtml += '<div class="dist-row">'
            + '<span class="dist-star">' + s + ' 星</span>'
            + '<span class="dist-bar"><i style="width:' + pct + '%"></i></span>'
            + '<span class="dist-num">' + n + '</span>'
            + '</div>';
    }

    $('reviewTotal').textContent = '共 ' + total + ' 条';
    $('reviewSummary').style.display = '';
    $('reviewSummary').innerHTML = ''
        + '<div class="review-score"><strong>' + priceText(avg)
        +   '</strong><span>平均分</span></div>'
        + '<div class="review-summary-side">'
        +   starsHtml(avg)
        +   '<span class="review-summary-sub">共 ' + total + ' 条评价</span>'
        +   distHtml
        + '</div>';

    $('reviewList').innerHTML = list.map(function (r) {
        return '<div class="review-item">'
            + '<div class="review-item-head">'
            +   '<span class="review-item-user">'
            +     escapeHtml(r.reviewer_name || '匿名用户') + '</span>'
            +   starsHtml(r.rating)
            +   '<span class="review-item-time">'
            +     escapeHtml(String(r.created_at || '').slice(0, 16)) + '</span>'
            + '</div>'
            + (r.content
                ? '<div class="review-item-text">' + escapeHtml(r.content) + '</div>'
                : '<div class="review-item-text is-empty">该买家未填写文字评价</div>')
            + '</div>';
    }).join('');
}

/* 评价失败不阻塞详情页主体，仅隐藏评价卡片 */
async function loadReviews(pid) {
    try {
        const json = await API.get('/products/' + pid + '/reviews');
        renderReviews(json.data);
    } catch (e) {
        renderReviews(null);
    }
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
        loadReviews(id);
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
