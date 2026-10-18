/* ================================================================
   petals.js —— 轻量飘落花瓣背景（无任何外部依赖 / CDN / 图片）
   ----------------------------------------------------------------
   设计参考：桌面 index.html 的樱花 Shader 动效，用 Canvas 2D 做轻量复刻：
     · 花瓣形状：带顶部小缺口的樱花花瓣（贝塞尔曲线）
     · 运动：整体向下飘落 + 正弦横向摇摆 + 自转，越远越小越淡
     · 配色：#FFCCC0 ~ #FFE6DE 系（取自参考页花瓣颜色）
   安全与性能约定：
     · 画布 position:fixed + pointer-events:none —— 不遮挡内容、不吃点击
     · 花瓣图片一次性离屏预渲染，运行期只做 drawImage，开销极低
     · 手机小屏自动减量、低性能设备降级、页面不可见时暂停
     · 系统开启「减少动态效果」时完全不显示
   ================================================================ */
(function () {
    'use strict';

    /* 尊重系统减弱动效设置 */
    var mqReduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    if (mqReduce && mqReduce.matches) return;

    /* ---------------- 配置 ---------------- */
    var PETAL_COLORS = [
        /* [花瓣浅色, 花瓣深色, 描边高光] —— 对齐参考页 rgb(255,204,192)~rgb(255,230,222) */
        ['#FFF4F7', '#FFC2D6', 'rgba(255,255,255,.75)'],
        ['#FFEDF3', '#FFAECB', 'rgba(255,255,255,.7)'],
        ['#FFF3EE', '#FFC9B8', 'rgba(255,255,255,.7)']
    ];

    var canvas = null, ctx = null, sprites = null;
    var DPR = 1, W = 0, H = 0;
    var petals = [], rafId = 0, running = false, lastTime = 0;
    var windPhase = 0;

    /* ---------------- 性能分级（低性能设备自动降级） ---------------- */
    function perfTier() {
        var cores = navigator.hardwareConcurrency || 4;
        var mem = navigator.deviceMemory || 4;
        if (cores <= 2 || mem <= 2) return 'low';
        if (cores <= 4) return 'mid';
        return 'high';
    }

    /* 依据视口宽度 + 性能等级决定花瓣数量与尺寸（手机减量） */
    function planCount() {
        var tier = perfTier();
        var w = window.innerWidth;
        var base = w < 480 ? 14 : w < 768 ? 22 : w < 1200 ? 40 : 58;
        if (tier === 'mid') base = Math.round(base * .75);
        if (tier === 'low') base = Math.round(base * .45);
        /* 上限兜底，避免极端宽屏铺满 */
        return Math.max(8, Math.min(base, 64));
    }

    function planScale() {
        var w = window.innerWidth;
        var s = w < 480 ? .78 : w < 768 ? .88 : 1;
        if (perfTier() === 'low') s *= .85;
        return s;
    }

    /* ---------------- 花瓣贴图预渲染 ---------------- */
    function buildSprite(w, h, colors) {
        var pad = Math.ceil(Math.max(w, h) * .4);
        var size = Math.ceil(Math.max(w, h) + pad * 2);
        var off = document.createElement('canvas');
        off.width = size;
        off.height = size;
        var c = off.getContext('2d');
        c.translate(size / 2, size / 2);

        /* 樱花花瓣轮廓：下尖、上宽、顶部带小缺口 */
        c.beginPath();
        c.moveTo(0, h / 2);
        c.bezierCurveTo(w * .72, h * .18, w * .62, -h * .30, w * .16, -h * .44);
        c.quadraticCurveTo(0, -h * .28, -w * .16, -h * .44);
        c.bezierCurveTo(-w * .62, -h * .30, -w * .72, h * .18, 0, h / 2);
        c.closePath();

        var g = c.createLinearGradient(0, -h / 2, 0, h / 2);
        g.addColorStop(0, colors[0]);
        g.addColorStop(.55, colors[1]);
        g.addColorStop(1, colors[0]);
        c.fillStyle = g;

        /* 一点点柔光阴影，模拟参考页花瓣的通透质感（仅预渲染一次） */
        c.shadowColor = 'rgba(238,111,151,.30)';
        c.shadowBlur = Math.max(2, w * .18);
        c.shadowOffsetY = Math.max(1, h * .05);
        c.fill();

        c.shadowColor = 'transparent';
        c.shadowBlur = 0;
        c.lineWidth = Math.max(1, w * .05);
        c.strokeStyle = colors[2];
        c.stroke();

        return off;
    }

    function buildSprites() {
        var scale = planScale();
        var sizes = [26, 36, 48];
        var out = [];
        for (var ci = 0; ci < PETAL_COLORS.length; ci++) {
            for (var si = 0; si < sizes.length; si++) {
                var w = sizes[si] * scale * .78;
                var h = sizes[si] * scale;
                out.push({ img: buildSprite(w, h, PETAL_COLORS[ci]), base: h });
            }
        }
        return out;
    }

    /* ---------------- 花瓣对象 ---------------- */
    function makePetal(isNew) {
        var sp = sprites[(Math.random() * sprites.length) | 0];
        var z = Math.random();                       /* 0 远 → 1 近 */
        var depth = .52 + z * .78;                   /* 近大远小 */
        return {
            sprite: sp,
            x: Math.random() * W,
            y: isNew ? Math.random() * H : -40 - Math.random() * 60,
            z: z,
            sizeMul: depth,
            alpha: .34 + z * .54,                    /* 远淡近浓 */
            rot: Math.random() * Math.PI * 2,
            rotSpeed: (Math.random() - .5) * .022 * (depth + .3),
            fall: (.32 + Math.random() * .55) * depth,
            swayAmp: 12 + Math.random() * 26,
            swaySpeed: .0006 + Math.random() * .0011,
            swayPhase: Math.random() * Math.PI * 2
        };
    }

    function seed() {
        petals = [];
        var n = planCount();
        for (var i = 0; i < n; i++) petals.push(makePetal(true));
    }

    /* ---------------- 尺寸自适应 ---------------- */
    function resize() {
        W = window.innerWidth;
        H = window.innerHeight;
        DPR = Math.min(window.devicePixelRatio || 1, perfTier() === 'low' ? 1 : 2);
        canvas.width = Math.round(W * DPR);
        canvas.height = Math.round(H * DPR);
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        sprites = buildSprites();
        seed();
        /* 只读诊断信息：便于自测/排障查看当前花瓣数量与性能等级（不参与渲染） */
        window.__petalInfo = {
            count: petals.length, tier: perfTier(), dpr: DPR,
            scale: planScale(), viewport: W + 'x' + H
        };
    }

    /* ---------------- 主循环 ---------------- */
    function tick(now) {
        if (!running) return;
        rafId = window.requestAnimationFrame(tick);

        var dt = Math.min(34, now - lastTime) / 16.667;   /* 归一化到 60fps 步长，掉帧不失控 */
        lastTime = now;
        windPhase += dt * .006;
        var wind = Math.sin(windPhase) * .35;             /* 全局微风，让整体方向有呼吸感 */

        ctx.clearRect(0, 0, W, H);

        for (var i = 0; i < petals.length; i++) {
            var p = petals[i];
            p.y += (p.fall + wind * .2) * dt;
            p.swayPhase += p.swaySpeed * dt * 16.667;
            p.x += (Math.sin(p.swayPhase) * p.swayAmp * .02 + wind) * dt;
            p.rot += p.rotSpeed * dt;

            if (p.y - 60 > H) { p = petals[i] = makePetal(false); }
            if (p.x < -80) p.x = W + 60;
            if (p.x > W + 80) p.x = -60;

            var s = p.sprite.base * p.sizeMul;
            ctx.globalAlpha = p.alpha;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.drawImage(p.sprite.img, -s / 2, -s / 2, s, s);
            ctx.restore();
        }
        ctx.globalAlpha = 1;
    }

    function start() {
        if (running || !canvas) return;
        running = true;
        lastTime = window.performance && performance.now ? performance.now() : Date.now();
        rafId = window.requestAnimationFrame(tick);
    }

    function stop() {
        running = false;
        if (rafId) window.cancelAnimationFrame(rafId);
        rafId = 0;
        if (ctx) ctx.clearRect(0, 0, W, H);
    }

    /* ---------------- 初始化 ---------------- */
    function init() {
        /* 画布固定全屏且不接收鼠标事件，纯装饰层（见 css/theme.css #petal-canvas） */
        canvas = document.createElement('canvas');
        canvas.id = 'petal-canvas';
        canvas.setAttribute('aria-hidden', 'true');
        document.body.appendChild(canvas);
        ctx = canvas.getContext('2d');
        if (!ctx) { canvas.remove(); canvas = null; return; }

        resize();
        start();

        /* 窗口尺寸变化：防抖重建 */
        var rzTimer = 0;
        window.addEventListener('resize', function () {
            clearTimeout(rzTimer);
            rzTimer = setTimeout(function () { if (running) resize(); }, 220);
        });

        /* 页面切到后台时暂停，省电省 CPU */
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) stop(); else start();
        });

        /* 系统动效偏好在运行中发生变化时同步响应 */
        if (mqReduce && mqReduce.addEventListener) {
            mqReduce.addEventListener('change', function (e) {
                if (e.matches) stop();
                else if (!canvas) { init(); }
                else start();
            });
        }
    }

    if (document.body) init();
    else document.addEventListener('DOMContentLoaded', init);
})();
