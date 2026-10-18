/* ================================================================
   login.js —— 登录 / 注册页逻辑（含图形验证码真人验证）
   ================================================================ */

let CAPTCHA = { id: '', image: '' };
let MODE = 'login';   // login | register

function $(id) { return document.getElementById(id); }

function showError(msg) {
    const box = $('authError');
    box.textContent = msg;
    box.classList.add('show');
}

function clearError() {
    $('authError').classList.remove('show');
}

/* 拉取图形验证码（每次登录/注册失败后都会强制换一张，防重放） */
async function loadCaptcha() {
    const img = $('captchaImg');
    img.src = '';
    try {
        const json = await API.get('/captcha');
        CAPTCHA.id = json.data.captcha_id;
        CAPTCHA.image = json.data.image;
        img.src = CAPTCHA.image;
        $('captchaCode').value = '';
    } catch (e) {
        showError('验证码加载失败：' + e.message);
    }
}

function switchMode(mode) {
    MODE = mode;
    clearError();
    $('tabLogin').classList.toggle('active', mode === 'login');
    $('tabRegister').classList.toggle('active', mode === 'register');
    $('nickField').style.display = (mode === 'register') ? '' : 'none';
    $('authSubmit').textContent = (mode === 'login') ? '登 录' : '注册并登录';
    $('authSub').textContent = (mode === 'login')
        ? '登录后即可发布闲置、收藏、下单和私信卖家'
        : '填写信息完成注册，注册成功自动登录';
    loadCaptcha();
}

async function submit() {
    clearError();
    const username = $('username').value.trim();
    const password = $('password').value;
    const nickname = $('nickname').value.trim();
    const code = $('captchaCode').value.trim();

    if (!username || !password) return showError('请输入账号和密码');
    if (MODE === 'register' && !nickname) return showError('请输入昵称');
    if (!code) return showError('请输入图形验证码');
    if (!CAPTCHA.id) return showError('验证码已失效，请点击图片刷新');
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
        return showError('账号需为 3-20 位字母、数字或下划线');
    }
    if (password.length < 6) return showError('密码至少 6 位');

    const btn = $('authSubmit');
    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = '处理中…';

    try {
        if (MODE === 'login') {
            await Auth.login(username, password, CAPTCHA.id, code);
        } else {
            await Auth.register(username, password, nickname, CAPTCHA.id, code);
        }
        toast(MODE === 'login' ? '登录成功' : '注册成功，已自动登录', 'ok');
        const next = new URLSearchParams(location.search).get('next');
        setTimeout(function () {
            location.href = next ? decodeURIComponent(next) : 'index.html';
        }, 600);
    } catch (e) {
        showError(e.message);
        loadCaptcha();          // 验证码一次性，失败后换新
        btn.disabled = false;
        btn.textContent = oldText;
    }
}

async function init() {
    mountUserChip();
    mountCatBar();
    $('captchaImg').addEventListener('click', loadCaptcha);
    $('tabLogin').addEventListener('click', function () { switchMode('login'); });
    $('tabRegister').addEventListener('click', function () { switchMode('register'); });
    $('authSubmit').addEventListener('click', submit);
    document.querySelectorAll('.auth-form input').forEach(function (input) {
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') submit();
        });
    });
    /* 演示账号一键填入 */
    document.querySelectorAll('.demo-accounts code[data-acc]').forEach(function (el) {
        el.addEventListener('click', function () {
            const parts = el.dataset.acc.split('/');
            switchMode('login');
            $('username').value = parts[0];
            $('password').value = parts[1];
            toast('已填入演示账号，请输入验证码', 'ok');
        });
    });

    /* 已登录直接跳走 */
    const user = await Auth.refresh();
    if (user) {
        toast('你已登录为 ' + user.nickname + '，正在进入首页', 'ok');
        setTimeout(function () { location.href = 'index.html'; }, 800);
        return;
    }

    /* URL 参数：?mode=register 直达注册；?next=xxx 登录后回跳（switchMode 内部会刷新验证码） */
    const params = new URLSearchParams(location.search);
    if (params.get('mode') === 'register') {
        switchMode('register');
    } else {
        await loadCaptcha();
    }
    if (params.get('next')) {
        $('authSub').textContent = '登录后即可继续访问你刚才的页面';
    }
}

document.addEventListener('DOMContentLoaded', init);
