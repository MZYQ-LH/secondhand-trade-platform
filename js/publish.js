/* ================================================================
   publish.js —— 发布闲置：多图上传 + 动态分类 + 登录鉴权
   ================================================================ */

let UPLOADED = [];   // 已上传到服务器的图片地址（/images/xxx.jpg）

function $(id) { return document.getElementById(id); }

/* 渲染图片格子：已上传的缩略图 + 末尾"上传图片"入口 */
function renderUploadGrid() {
    const grid = $('uploadGrid');
    let html = '';
    UPLOADED.forEach(function (u, i) {
        html += '<div class="upload-item">'
            + '<img src="' + imgUrl(u) + '" alt="图' + (i + 1) + '">'
            + '<button type="button" class="upload-del" data-i="' + i + '" title="移除">×</button>'
            + (i === 0 ? '<span class="img-count" style="left:3px;right:auto;top:auto;bottom:3px;">主图</span>' : '')
            + '</div>';
    });
    if (UPLOADED.length < 9) {
        html += '<label class="upload-add" for="imageFile">'
            + '<span class="plus">＋</span><span>上传图片</span></label>';
    }
    grid.innerHTML = html;

    grid.querySelectorAll('.upload-del').forEach(function (btn) {
        btn.addEventListener('click', function () {
            UPLOADED.splice(Number(btn.dataset.i), 1);
            renderUploadGrid();
        });
    });
}

/* 选图后立即上传到后端（未登录会被后端拒绝并提示去登录） */
async function onFilesPicked(files) {
    if (!files || !files.length) return;
    if (UPLOADED.length + files.length > 9) {
        toast('最多上传 9 张图片', 'err');
        return;
    }
    toast('正在上传 ' + files.length + ' 张图片…');
    try {
        const json = await API.upload(files);
        UPLOADED = UPLOADED.concat(json.data.urls || []);
        renderUploadGrid();
        toast('上传成功，共 ' + UPLOADED.length + ' 张', 'ok');
    } catch (e) {
        Auth.handleError(e);
    }
    $('imageFile').value = '';
}

async function submit(e) {
    e.preventDefault();
    if (!Auth.requireLogin('登录后才能发布闲置')) return;

    const title = $('title').value.trim();
    const price = $('price').value;
    const desc = $('desc').value.trim();
    const category = $('category').value;

    if (!UPLOADED.length) return toast('请至少上传一张商品图片', 'err');
    if (!title) return toast('请填写商品标题', 'err');
    if (!category) return toast('请选择商品分类', 'err');
    if (!price || Number(price) <= 0) return toast('请填写大于 0 的售价', 'err');
    if (!desc) return toast('请填写商品描述', 'err');

    const btn = $('submitBtn');
    btn.disabled = true;
    btn.textContent = '发布中…';

    try {
        const json = await API.post('/products', {
            title: title,
            category: category,
            price: price,
            original_price: $('originalPrice').value || 0,
            condition: $('condition').value,
            description: desc,
            images: UPLOADED,
            location: $('location').value.trim()
        });
        toast('发布成功，正在跳转…', 'ok');
        setTimeout(function () {
            location.href = 'detail.html?id=' + json.data.id;
        }, 800);
    } catch (err) {
        Auth.handleError(err);
        btn.disabled = false;
        btn.textContent = '立即发布';
    }
}

async function init() {
    mountUserChip();
    await mountCatBar();

    /* 新旧程度下拉 */
    $('condition').innerHTML = CONDITIONS.map(function (c) {
        return '<option value="' + c + '">' + c + '</option>';
    }).join('');
    $('condition').value = '几乎全新';

    /* 分类下拉：从数据库动态拉取 */
    const cats = await fetchCategories();
    $('category').innerHTML = cats.map(function (c) {
        return '<option value="' + escapeHtml(c.name) + '">' + escapeHtml(c.name)
            + '（在售 ' + (c.product_count || 0) + ' 件）</option>';
    }).join('') || '<option value="">暂无分类</option>';

    renderUploadGrid();
    $('imageFile').addEventListener('change', function () {
        onFilesPicked(this.files);
    });

    $('publishForm').addEventListener('submit', submit);

    $('searchBtn').addEventListener('click', function () {
        const kw = $('searchInput').value.trim();
        if (kw) location.href = 'index.html?q=' + encodeURIComponent(kw);
    });

    /* 未登录：提示并禁用提交 */
    const user = await Auth.refresh();
    if (!user) {
        const tip = $('needLogin');
        tip.className = 'auth-error show';
        tip.innerHTML = '你还没有登录，登录后才能发布商品。'
            + '<a href="login.html?next=' + encodeURIComponent('publish.html')
            + '" style="color:inherit;text-decoration:underline;">立即去登录 →</a>';
        $('submitBtn').disabled = true;
    }
}

document.addEventListener('DOMContentLoaded', init);
