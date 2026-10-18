/* ================================================================
   index.js —— 首页：动态分类栏 + 商品列表 + 搜索 + 只看收藏
   ================================================================ */

const INDEX_STATE = {
    cat: 'all',
    q: '',
    onlyFav: false
};

function $(id) { return document.getElementById(id); }

function renderProducts(list) {
    const box = $('productList');
    if (!list.length) {
        box.innerHTML = '<div class="empty-state">'
            + (INDEX_STATE.onlyFav ? '还没有收藏任何商品，去逛逛吧～'
                : '没有找到符合条件的闲置，换个关键词试试～')
            + '</div>';
        return;
    }
    box.innerHTML = list.map(productCardHtml).join('');
}

async function loadProducts() {
    const box = $('productList');
    box.innerHTML = '<div class="empty-state">加载中…</div>';

    const params = [];
    if (INDEX_STATE.cat && INDEX_STATE.cat !== 'all') {
        params.push('category=' + encodeURIComponent(INDEX_STATE.cat));
    }
    if (INDEX_STATE.q) params.push('q=' + encodeURIComponent(INDEX_STATE.q));
    if (INDEX_STATE.onlyFav) params.push('only_favorite=1');

    try {
        const json = await API.get('/products' + (params.length ? '?' + params.join('&') : ''));
        const data = json.data || {};
        renderProducts(data.list || []);

        const label = $('recLabel');
        if (INDEX_STATE.onlyFav) {
            label.textContent = '我的收藏';
        } else if (INDEX_STATE.q) {
            label.textContent = '“' + INDEX_STATE.q + '”的搜索结果';
        } else if (INDEX_STATE.cat !== 'all') {
            label.textContent = INDEX_STATE.cat;
        } else {
            label.textContent = '为你推荐';
        }
        const total = (data.total !== undefined) ? data.total : (data.list || []).length;
        $('countDisplay').textContent = total;
    } catch (e) {
        if (e.code === 401) {
            INDEX_STATE.onlyFav = false;
            $('showFavBtn').classList.remove('active');
            renderProducts([]);
        } else {
            box.innerHTML = '<div class="empty-state">加载失败：' + escapeHtml(e.message) + '</div>';
        }
        $('countDisplay').textContent = '0';
    }
}

/* 收藏变化回调（data.js 事件委托里触发） */
window.onFavoriteChanged = function (id, active) {
    if (!INDEX_STATE.onlyFav) return;
    /* 取消收藏后把卡片从列表移除，避免"只看收藏"里残留 */
    if (!active) {
        const card = document.querySelector('.product-card[data-id="' + id + '"]');
        if (card) card.remove();
        const rest = document.querySelectorAll('#productList .product-card').length;
        $('countDisplay').textContent = rest;
        if (!rest) renderProducts([]);
    }
};

function selectCat(name) {
    INDEX_STATE.cat = name;
    document.querySelectorAll('#catBar .cat-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.cat === name);
    });
    const url = new URL(location.href);
    if (name === 'all') url.searchParams.delete('cat');
    else url.searchParams.set('cat', name);
    history.replaceState(null, '', url.toString());
    loadProducts();
}

async function init() {
    mountUserChip();
    await mountCatBar();

    const params = new URLSearchParams(location.search);
    INDEX_STATE.cat = params.get('cat') || 'all';
    INDEX_STATE.q = params.get('q') || '';
    if (INDEX_STATE.q) $('searchInput').value = INDEX_STATE.q;

    const catBar = $('catBar');
    catBar.addEventListener('click', function (e) {
        const btn = e.target.closest('.cat-btn');
        if (!btn) return;
        selectCat(btn.dataset.cat || 'all');
    });

    $('searchBtn').addEventListener('click', function () {
        INDEX_STATE.q = $('searchInput').value.trim();
        INDEX_STATE.onlyFav = false;
        $('showFavBtn').classList.remove('active');
        selectCat(INDEX_STATE.cat);
    });
    $('searchInput').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') $('searchBtn').click();
    });

    $('showFavBtn').addEventListener('click', function () {
        if (!INDEX_STATE.onlyFav && !Auth.requireLogin('登录后才能查看收藏')) return;
        INDEX_STATE.onlyFav = !INDEX_STATE.onlyFav;
        $('showFavBtn').classList.toggle('active', INDEX_STATE.onlyFav);
        loadProducts();
    });

    await loadProducts();
}

document.addEventListener('DOMContentLoaded', init);
