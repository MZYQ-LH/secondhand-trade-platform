# -*- coding: utf-8 -*-
"""
================================================================
  校园闲换 · 校园二手交易平台 —— Flask 后端（迭代版 v2）
================================================================
  新增能力：
    1) 登录 / 注册（图形验证码真人验证 + Flask Session 登录态）
    2) 9 张表业务接口：users / categories / products /
       product_images / favorites / orders / messages / reviews
    3) 商品分类改为接口下发（前端不再写死）
    4) 发布支持多图（product_images 一对多）
    5) 收藏 / 想要改为数据库落库（联合唯一索引，杜绝重复累加）
    6) 详情页拍下下单（orders）、站内私信（messages）
    7) 发布 / 收藏 / 下单 / 私信 等写接口全部登录鉴权
    8) 个人信息修改：昵称 / 头像 / 密码（登录账号不可修改）
    9) 订单评价：订单完成后买家可 1-5 星评分 + 文字评价，
       商品详情页展示平均分与评价列表，个人中心可查发出 / 收到的评价
================================================================
"""
import base64
import io
import os
import random
import sys
import time
from functools import wraps

import logging
import secrets
import threading
from logging.handlers import RotatingFileHandler

import pymysql
from dbutils.pooled_db import PooledDB
from flask import Flask, jsonify, request, send_from_directory, session
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.exceptions import HTTPException
from PIL import Image, ImageDraw, ImageFont
from werkzeug.security import check_password_hash, generate_password_hash

import config
from config import DB_CONFIG

# ==================== 目录 / 基础配置 ====================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONT_FOLDER = BASE_DIR
UPLOAD_FOLDER = os.path.join(BASE_DIR, 'images')
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'}
MAX_UPLOAD_MB = 5

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app = Flask(
    __name__,
    static_folder=UPLOAD_FOLDER,
    static_url_path='/images',
)
def _load_secret_key():
    """密钥外置：优先环境变量 XQ_SECRET_KEY；未配置时使用本地随机密钥文件（首次自动生成并持久化，避免重启后登录态失效）"""
    env_key = os.environ.get('XQ_SECRET_KEY')
    if env_key:
        return env_key
    secret_file = os.path.join(BASE_DIR, 'instance_secret.key')
    try:
        if os.path.exists(secret_file):
            with open(secret_file, 'r', encoding='utf-8') as fp:
                key = fp.read().strip()
            if key:
                return key
        key = secrets.token_hex(32)
        with open(secret_file, 'w', encoding='utf-8') as fp:
            fp.write(key)
        return key
    except Exception as exc:      # 兜底：文件不可写时使用进程内随机密钥
        print('警告：密钥文件读写失败(%s)，本次使用临时随机密钥' % exc)
        return secrets.token_hex(32)


app.secret_key = _load_secret_key()

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 30 * 1024 * 1024      # 多图上传，单次请求上限 30MB
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
# 登录态持久化：配合 session.permanent=True，登录后 7 天内免重复登录
app.config['PERMANENT_SESSION_LIFETIME'] = 7 * 24 * 3600
try:
    app.json.ensure_ascii = False                        # 中文直出，不转义
except Exception:
    pass

CORS(app, supports_credentials=True)

# ==================== 日志（异常只写日志，不再回显给前端） ====================
LOG_DIR = os.path.join(BASE_DIR, 'logs')
os.makedirs(LOG_DIR, exist_ok=True)
_log_handler = RotatingFileHandler(os.path.join(LOG_DIR, 'app.log'),
                                   maxBytes=5 * 1024 * 1024, backupCount=3, encoding='utf-8')
_log_handler.setFormatter(logging.Formatter(
    '%(asctime)s %(levelname)s [%(module)s:%(lineno)d] %(message)s'))
app.logger.addHandler(_log_handler)
app.logger.setLevel(logging.INFO)

# ==================== 请求限流（Flask-Limiter） ====================
RATE_ENABLED = os.environ.get('XQ_RATE_LIMIT_ENABLED', '1') not in ('0', 'false', 'False')
RATE_DEFAULT = os.environ.get('XQ_RATE_DEFAULT', '3000 per minute; 100000 per day')     # 浏览类：放宽（NAT 出口 IP 复用）
RATE_LOGIN = os.environ.get('XQ_RATE_LOGIN', '10 per minute; 60 per hour')               # 登录：按 IP+账号 收紧
RATE_REGISTER = os.environ.get('XQ_RATE_REGISTER', '5 per minute; 20 per hour')          # 注册：按 IP+账号 收紧
RATE_CAPTCHA = os.environ.get('XQ_RATE_CAPTCHA', '60 per minute; 800 per hour')          # 验证码
RATE_UPLOAD = os.environ.get('XQ_RATE_UPLOAD', '20 per hour; 60 per day')                # 上传：收紧
RATE_MESSAGE = os.environ.get('XQ_RATE_MESSAGE', '30 per minute; 800 per day')           # 发私信：收紧
RATE_WRITE = os.environ.get('XQ_RATE_WRITE', '60 per minute; 2000 per day')              # 其它写操作


def rate_key():
    """限流维度：已登录按用户ID，未登录按客户端 IP。
    校园网 NAT 共用出口 IP 时，登录用户不会被同一出口的其他同学连带误伤。"""
    uid = session.get('user_id')
    if uid:
        return 'u:%s' % uid
    return 'ip:%s' % (get_remote_address() or 'unknown')


def _account_key(prefix):
    """账号类接口的限流维度：已登录按用户 ID；未登录按「出口 IP + 提交的账号」复合维度。
    校园网 NAT 大量同学共用同一出口 IP，若只按 IP 计数，一个同学的登录/注册重试会连累其他人，
    加入账号名后同一出口的不同同学互不影响，同时单个账号的暴力尝试仍被限制。"""
    uid = session.get('user_id')
    if uid:
        return 'u:%s' % uid
    data = request.get_json(silent=True) or request.form or {}
    name = ''
    if isinstance(data, dict):
        name = str(data.get('username') or '').strip().lower()
    return '%s:%s|%s' % (prefix, get_remote_address() or 'unknown', name or '-')


def login_key():
    return _account_key('login')


def register_key():
    return _account_key('register')


limiter = Limiter(
    key_func=rate_key,
    app=app,
    default_limits=[RATE_DEFAULT] if RATE_ENABLED else [],
    storage_uri=os.environ.get('XQ_RATE_STORAGE', 'memory://'),
    enabled=RATE_ENABLED,
    headers_enabled=True,
)

try:                                  # /images 静态端点不参与限流（页面图片并发加载，避免 NAT 下误伤）
    if 'static' in app.view_functions:
        limiter.exempt(app.view_functions['static'])
except Exception:
    pass

# ==================== MySQL（连接参数统一来自 config.py / .env） ====================

PRODUCT_STATUS = ['在售', '已售出', '已下架']
ORDER_STATUS = ['待付款', '已付款', '已完成', '已取消']


POOL_MAX = config.DB_POOL_SIZE

_pool = None
_pool_lock = threading.Lock()


def get_pool():
    """惰性初始化全局连接池：上限 20、池满阻塞等待、取用前 ping 探活"""
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                kwargs = {k: v for k, v in DB_CONFIG.items() if k != 'cursorclass'}
                _pool = PooledDB(
                    creator=pymysql,
                    maxconnections=POOL_MAX,        # 池上限 20
                    mincached=2,                    # 保持 2 条空闲连接
                    maxcached=POOL_MAX,
                    blocking=True,                  # 池满时阻塞等待，不抛异常
                    ping=1,                         # 每次取用前 ping 探活
                    reset=True,                     # 归还时重置会话状态
                    cursorclass=pymysql.cursors.DictCursor,
                    **kwargs)
                app.logger.info('MySQL 连接池初始化完成 maxconnections=%s blocking=True ping=1', POOL_MAX)
    return _pool


def get_conn():
    """从连接池取连接；conn.close() 语义不变（归还连接池）"""
    return get_pool().connection()


def q_all(sql, args=None):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, args or [])
            return cur.fetchall()
    finally:
        conn.close()


def q_one(sql, args=None):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, args or [])
            return cur.fetchone()
    finally:
        conn.close()


def exe(sql, args=None):
    """执行写操作，返回 lastrowid"""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, args or [])
            rid = cur.lastrowid
        conn.commit()
        return rid
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def exe_many(statements):
    """同一事务内执行多条写语句：[(sql, args), ...]"""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            for sql, args in statements:
                cur.execute(sql, args or [])
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def fmt_dt(v):
    if v is None:
        return ''
    try:
        return v.strftime('%Y-%m-%d %H:%M:%S')
    except Exception:
        return str(v)


def ok(data=None, **extra):
    body = {'code': 0, 'data': data}
    body.update(extra)
    return jsonify(body)


def err(msg, code=1, http=400):
    return jsonify({'code': code, 'msg': msg}), http


# ==================== 登录态 ====================
def current_user():
    uid = session.get('user_id')
    if not uid:
        return None
    row = q_one(
        'SELECT `id`,`username`,`nickname`,`avatar`,`created_at` '
        'FROM `users` WHERE `id` = %s', (uid,))
    if not row:
        session.pop('user_id', None)
        return None
    row['created_at'] = fmt_dt(row['created_at'])
    return row


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not current_user():
            return err('请先登录后再操作', code=401, http=401)
        return fn(*args, **kwargs)
    return wrapper


# ==================== 图形验证码（真人验证） ====================
CAPTCHA_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXY23456789'     # 去掉易混淆的 I O 1 0 Z
CAPTCHA_TTL = 300                                     # 5 分钟有效
FONT_CANDIDATES = [
    r'C:\Windows\Fonts\arialbd.ttf',
    r'C:\Windows\Fonts\msyhbd.ttc',
    r'C:\Windows\Fonts\simhei.ttf',
    r'C:\Windows\Fonts\msyh.ttc',
]


def _font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


def _rand_color(lo, hi):
    return (random.randint(lo, hi), random.randint(lo, hi), random.randint(lo, hi))


def make_captcha_b64(code):
    """生成带干扰线、干扰点、字符随机旋转的验证码图片，返回 data URI"""
    w, h = 132, 46
    img = Image.new('RGB', (w, h), (248, 249, 251))
    draw = ImageDraw.Draw(img)

    for _ in range(6):     # 干扰线
        draw.line(
            [(random.randint(0, w), random.randint(0, h)),
             (random.randint(0, w), random.randint(0, h))],
            fill=_rand_color(150, 220), width=1)
    for _ in range(220):   # 干扰点
        draw.point((random.randint(0, w - 1), random.randint(0, h - 1)),
                   fill=_rand_color(140, 220))

    font = _font(30)
    step = w // len(code)
    for i, ch in enumerate(code):
        layer = Image.new('RGBA', (step + 12, h), (255, 255, 255, 0))
        ImageDraw.Draw(layer).text((6, 3), ch, font=font, fill=_rand_color(20, 110))
        layer = layer.rotate(random.uniform(-30, 30), resample=Image.BICUBIC, expand=False)
        img.paste(layer, (i * step - 5, 0), layer)

    buf = io.BytesIO()
    img.save(buf, 'PNG')
    return 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()


@app.route('/api/captcha', methods=['GET'])
@limiter.limit(RATE_CAPTCHA)
def api_captcha():
    code = ''.join(random.choice(CAPTCHA_CHARS) for _ in range(4))
    cid = '%d%d' % (int(time.time() * 1000), random.randint(100, 999))
    session['captcha'] = {'id': cid, 'code': code.upper(), 'exp': time.time() + CAPTCHA_TTL}
    return ok({'captcha_id': cid, 'image': make_captcha_b64(code), 'ttl': CAPTCHA_TTL})


def verify_captcha(cid, user_code):
    """校验一次性验证码：比对失败 / 过期均返回原因"""
    saved = session.get('captcha')
    if not saved:
        return False, '验证码已失效，请点击图片刷新'
    if saved.get('exp', 0) < time.time():
        session.pop('captcha', None)
        return False, '验证码已过期，请点击图片刷新'
    if str(cid or '') != str(saved.get('id') or ''):
        return False, '验证码已刷新，请重新输入'
    if (user_code or '').strip().upper() != saved.get('code'):
        return False, '验证码错误，请重新输入'
    session.pop('captcha', None)     # 一次性，用完即焚
    return True, ''


# ==================== 账号接口 ====================
@app.route('/api/register', methods=['POST'])
@limiter.limit(RATE_REGISTER, key_func=register_key)
def api_register():
    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    nickname = (data.get('nickname') or '').strip() or username

    valid, msg = verify_captcha(data.get('captcha_id'), data.get('captcha_code'))
    if not valid:
        return err(msg, code=2)

    if not (3 <= len(username) <= 20):
        return err('账号长度需为 3-20 个字符')
    if not all(c.isalnum() or c == '_' for c in username):
        return err('账号只能包含字母、数字和下划线')
    if len(password) < 6:
        return err('密码至少 6 位')
    if len(nickname) > 20:
        return err('昵称最多 20 个字符')

    if q_one('SELECT `id` FROM `users` WHERE `username` = %s', (username,)):
        return err('该账号已被注册，换一个试试', code=3, http=409)

    uid = exe(
        'INSERT INTO `users` (`username`,`password_hash`,`nickname`) '
        'VALUES (%s,%s,%s)',
        (username, generate_password_hash(password, method='pbkdf2:sha256'), nickname))
    session.permanent = True                # 注册即登录，且保持 7 天登录态
    session['user_id'] = uid
    return ok({'user': current_user()}, msg='注册成功，已自动登录')


@app.route('/api/login', methods=['POST'])
@limiter.limit(RATE_LOGIN, key_func=login_key)
def api_login():
    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''

    valid, msg = verify_captcha(data.get('captcha_id'), data.get('captcha_code'))
    if not valid:
        return err(msg, code=2)

    user = q_one('SELECT * FROM `users` WHERE `username` = %s', (username,))
    if not user or not check_password_hash(user['password_hash'], password):
        return err('账号或密码错误', code=4, http=401)

    session.permanent = True                # 登录态保持 7 天
    session['user_id'] = user['id']
    return ok({'user': current_user()}, msg='登录成功')


@app.route('/api/logout', methods=['POST'])
def api_logout():
    session.clear()
    return ok(msg='已退出登录')


@app.route('/api/me', methods=['GET'])
def api_me():
    user = current_user()
    counts = {
        'products': 0, 'favorites': 0, 'wants': 0,
        'orders_buy': 0, 'orders_sell': 0, 'unread': 0,
    }
    if user:
        uid = user['id']
        counts['products'] = int(q_one(
            'SELECT COUNT(*) AS n FROM `products` WHERE `user_id` = %s', (uid,))['n'])
        for t, key in (('favorite', 'favorites'), ('want', 'wants')):
            counts[key] = int(q_one(
                'SELECT COUNT(*) AS n FROM `favorites` '
                'WHERE `user_id` = %s AND `type` = %s', (uid, t))['n'])
        counts['orders_buy'] = int(q_one(
            'SELECT COUNT(*) AS n FROM `orders` WHERE `buyer_id` = %s', (uid,))['n'])
        counts['orders_sell'] = int(q_one(
            'SELECT COUNT(*) AS n FROM `orders` WHERE `seller_id` = %s', (uid,))['n'])
        counts['unread'] = int(q_one(
            'SELECT COUNT(*) AS n FROM `messages` '
            'WHERE `receiver_id` = %s AND `is_read` = 0', (uid,))['n'])
    return ok({'user': user, 'logged_in': bool(user), 'counts': counts})


@app.route('/api/users/<int:uid>', methods=['GET'])
def api_user_profile(uid):
    user = q_one(
        'SELECT `id`,`username`,`nickname`,`avatar`,`created_at` '
        'FROM `users` WHERE `id` = %s', (uid,))
    if not user:
        return err('用户不存在', http=404)
    stat = q_one(
        "SELECT COUNT(*) AS total, SUM(`status` = '在售') AS on_sale "
        'FROM `products` WHERE `user_id` = %s', (uid,))
    user['created_at'] = fmt_dt(user['created_at'])
    user['product_total'] = int(stat['total'] or 0)
    user['product_on_sale'] = int(stat['on_sale'] or 0)
    rstat = q_one(
        'SELECT COUNT(*) AS n, AVG(`rating`) AS avg_score FROM `reviews` '
        'WHERE `reviewee_id` = %s', (uid,))
    user['review_count'] = int(rstat['n'] or 0)
    user['rating_avg'] = round(float(rstat['avg_score'] or 0), 1)
    user.pop('password_hash', None)
    return ok(user)


# ==================== 个人信息修改（昵称 / 头像 / 密码） ====================
NICKNAME_MAX = 20          # 与注册接口 api_register 的昵称校验保持一致
PASSWORD_MIN = 6           # 与注册接口 api_register 的密码校验保持一致
PASSWORD_MAX = 64
AVATAR_MAX = 255


@app.route('/api/me/profile', methods=['POST'])
@limiter.limit(RATE_WRITE)
@login_required
def api_me_profile_update():
    """修改个人资料：昵称 / 头像（登录账号 username 不可修改）"""
    data = request.get_json(silent=True) or {}
    user = current_user()
    nickname = (data.get('nickname') or '').strip()
    avatar = (data.get('avatar') or '').strip()

    if not nickname:
        return err('昵称不能为空')
    if len(nickname) > NICKNAME_MAX:
        return err('昵称最多 %d 个字符' % NICKNAME_MAX)
    if len(avatar) > AVATAR_MAX:
        return err('头像地址过长')
    if avatar and not (avatar.startswith('/') or avatar.startswith('http://')
                       or avatar.startswith('https://')):
        return err('头像只能是本站图片路径或 http(s) 链接')

    # products.seller 是发布时冗余的卖家昵称，改昵称时一并同步，避免列表页显示旧昵称
    exe_many([
        ('UPDATE `users` SET `nickname` = %s, `avatar` = %s WHERE `id` = %s',
         (nickname, avatar, user['id'])),
        ('UPDATE `products` SET `seller` = %s WHERE `user_id` = %s',
         (nickname, user['id'])),
    ])
    return ok({'user': current_user()}, msg='个人资料已更新')


@app.route('/api/me/password', methods=['POST'])
@limiter.limit(RATE_WRITE)
@login_required
def api_me_password_update():
    """修改密码：需校验原密码，新密码规则与注册一致（至少 6 位）"""
    data = request.get_json(silent=True) or {}
    old_password = data.get('old_password') or ''
    new_password = data.get('new_password') or ''
    confirm_password = data.get('confirm_password')

    if not old_password:
        return err('请输入原密码')
    if len(new_password) < PASSWORD_MIN:
        return err('新密码至少 %d 位' % PASSWORD_MIN)
    if len(new_password) > PASSWORD_MAX:
        return err('新密码最多 %d 位' % PASSWORD_MAX)
    if new_password == old_password:
        return err('新密码不能与原密码相同')
    if confirm_password is not None and confirm_password != new_password:
        return err('两次输入的新密码不一致')

    uid = current_user()['id']
    row = q_one('SELECT `password_hash` FROM `users` WHERE `id` = %s', (uid,))
    if not row or not check_password_hash(row['password_hash'], old_password):
        return err('原密码不正确', code=4)

    exe('UPDATE `users` SET `password_hash` = %s WHERE `id` = %s',
        (generate_password_hash(new_password, method='pbkdf2:sha256'), uid))
    return ok(msg='密码修改成功，请牢记新密码')


# ==================== 分类接口（前端动态拉取） ====================
@app.route('/api/categories', methods=['GET'])
def api_categories():
    rows = q_all(
        "SELECT c.`id`, c.`name`, c.`sort_order`, "
        "  COUNT(CASE WHEN p.`status` = '在售' THEN 1 END) AS product_count "
        "FROM `categories` c LEFT JOIN `products` p ON p.`category_id` = c.`id` "
        "GROUP BY c.`id`, c.`name`, c.`sort_order` "
        "ORDER BY c.`sort_order` ASC, c.`id` ASC")
    for r in rows:
        r['product_count'] = int(r['product_count'] or 0)
    return ok(rows)


# ==================== 商品接口 ====================
PRODUCT_SELECT = """
SELECT p.*, c.`name` AS category_name,
       u.`nickname` AS seller_nickname, u.`avatar` AS seller_avatar
FROM `products` p
LEFT JOIN `categories` c ON c.`id` = p.`category_id`
LEFT JOIN `users` u ON u.`id` = p.`user_id`
"""


def attach_images(products):
    if not products:
        return products
    ids = [int(p['id']) for p in products]
    holder = ','.join(['%s'] * len(ids))
    rows = q_all(
        'SELECT `product_id`,`image_url` FROM `product_images` '
        'WHERE `product_id` IN (%s) ORDER BY `sort_order` ASC, `id` ASC' % holder, ids)
    img_map = {}
    for r in rows:
        img_map.setdefault(r['product_id'], []).append(r['image_url'])
    for p in products:
        imgs = img_map.get(p['id']) or []
        if not imgs and p.get('image'):
            imgs = [p['image']]
        p['images'] = imgs
        p['image'] = imgs[0] if imgs else (p.get('image') or '')
        p['image_count'] = len(imgs)
        p['created_at'] = fmt_dt(p.get('created_at'))
        p['category_name'] = p.get('category_name') or p.get('category') or '未分类'
        p['seller_name'] = p.get('seller_nickname') or p.get('seller') or '匿名用户'
    return products


def attach_flags(products, uid):
    for p in products:
        p['is_favorite'] = False
        p['is_wanted'] = False
        p['is_mine'] = bool(uid and p.get('user_id') == uid)
        p['favorite_count'] = 0
    if not uid or not products:
        return products
    ids = [int(p['id']) for p in products]
    holder = ','.join(['%s'] * len(ids))
    rows = q_all(
        'SELECT `product_id`,`type` FROM `favorites` '
        'WHERE `user_id` = %%s AND `product_id` IN (%s)' % holder, [uid] + ids)
    for r in rows:
        for p in products:
            if p['id'] == r['product_id']:
                if r['type'] == 'favorite':
                    p['is_favorite'] = True
                else:
                    p['is_wanted'] = True
    return products


def attach_review_stats(products):
    """批量补评价统计（平均分 / 评价数），供商品卡片、详情页展示"""
    if not products:
        return products
    ids = [int(p['id']) for p in products]
    holder = ','.join(['%s'] * len(ids))
    rows = q_all(
        'SELECT `product_id`, COUNT(*) AS n, AVG(`rating`) AS avg_score '
        'FROM `reviews` WHERE `product_id` IN (%s) GROUP BY `product_id`' % holder, ids)
    stat_map = {r['product_id']: r for r in rows}
    for p in products:
        s = stat_map.get(p['id'])
        p['review_count'] = int(s['n']) if s else 0
        p['rating_avg'] = round(float(s['avg_score']), 1) if s else 0
    return products


def shape_one(row, uid):
    """单条商品统一包装：补多图、收藏标记、结构化卖家信息（与详情页结构保持一致）"""
    if not row:
        return row
    attach_images([row])
    attach_flags([row], uid)
    seller = None
    if row.get('user_id'):
        seller = q_one('SELECT `id`,`nickname`,`avatar`,`created_at` '
                       'FROM `users` WHERE `id` = %s', (row['user_id'],))
        if seller:
            seller['created_at'] = fmt_dt(seller['created_at'])
            sstat = q_one(
                'SELECT COUNT(*) AS n, AVG(`rating`) AS avg_score FROM `reviews` '
                'WHERE `reviewee_id` = %s', (row['user_id'],))
            seller['review_count'] = int(sstat['n'] or 0)
            seller['rating_avg'] = round(float(sstat['avg_score'] or 0), 1)
    row['seller'] = seller or {
        'id': None, 'nickname': row.get('seller') or '匿名用户',
        'avatar': '', 'created_at': '',
    }
    return row


def recalc_wants(pid):
    exe('UPDATE `products` p SET p.`wants` = p.`wants_base` + '
        "(SELECT COUNT(*) FROM `favorites` f "
        " WHERE f.`product_id` = p.`id` AND f.`type` = 'want') "
        'WHERE p.`id` = %s', (pid,))


@app.route('/api/products', methods=['GET'])
def api_products():
    kw = (request.args.get('q') or request.args.get('keyword') or '').strip()
    cat = (request.args.get('category') or '').strip()
    category_id = request.args.get('category_id')
    seller_id = request.args.get('seller_id')
    status = (request.args.get('status') or '').strip()
    sort = (request.args.get('sort') or 'new').strip()
    only_favorite = request.args.get('only_favorite') in ('1', 'true')
    only_want = request.args.get('only_want') in ('1', 'true')
    try:
        limit = min(int(request.args.get('limit') or 60), 200)
        offset = max(int(request.args.get('offset') or 0), 0)
    except ValueError:
        limit, offset = 60, 0

    uid = session.get('user_id')
    if (only_favorite or only_want) and not uid:
        return err('请先登录后再查看收藏', code=401, http=401)

    where, args = ['1=1'], []
    if kw:
        where.append('(p.`title` LIKE %s OR p.`description` LIKE %s)')
        args += ['%' + kw + '%', '%' + kw + '%']
    if cat and cat != 'all':
        where.append('(p.`category` = %s OR c.`name` = %s)')
        args += [cat, cat]
    if category_id:
        where.append('p.`category_id` = %s')
        args.append(category_id)
    if seller_id:
        where.append('p.`user_id` = %s')
        args.append(seller_id)
    if status:
        where.append('p.`status` = %s')
        args.append(status)
    else:
        where.append("p.`status` <> '已下架'")
    if only_favorite:
        where.append("EXISTS (SELECT 1 FROM `favorites` f WHERE f.`product_id` = p.`id` "
                     "AND f.`user_id` = %s AND f.`type` = 'favorite')")
        args.append(uid)
    if only_want:
        where.append("EXISTS (SELECT 1 FROM `favorites` f WHERE f.`product_id` = p.`id` "
                     "AND f.`user_id` = %s AND f.`type` = 'want')")
        args.append(uid)

    order_by = {
        'new': 'p.`id` DESC',
        'price_asc': 'p.`price` ASC',
        'price_desc': 'p.`price` DESC',
        'hot': 'p.`views` DESC, p.`wants` DESC',
    }.get(sort, 'p.`id` DESC')

    where_sql = ' AND '.join(where)
    total = q_one('SELECT COUNT(*) AS n FROM `products` p '
                  'LEFT JOIN `categories` c ON c.`id` = p.`category_id` '
                  'WHERE ' + where_sql, args)['n']
    rows = q_all(PRODUCT_SELECT + ' WHERE ' + where_sql + ' ORDER BY ' + order_by +
                 ' LIMIT %s OFFSET %s', args + [limit, offset])
    attach_images(rows)
    attach_flags(rows, uid)
    attach_review_stats(rows)
    return ok({'total': int(total), 'list': rows})


@app.route('/api/products/<int:pid>', methods=['GET'])
def api_product_detail(pid):
    row = q_one(PRODUCT_SELECT + ' WHERE p.`id` = %s', (pid,))
    if not row:
        return err('商品不存在或已被删除', http=404)
    shape_one(row, session.get('user_id'))
    attach_review_stats([row])

    related = q_all(PRODUCT_SELECT +
                    " WHERE p.`id` <> %s AND p.`status` = '在售' AND "
                    "(p.`category_id` = %s OR p.`category` = %s) "
                    'ORDER BY p.`id` DESC LIMIT 5',
                    (pid, row.get('category_id'), row.get('category')))
    attach_images(related)
    attach_flags(related, session.get('user_id'))
    attach_review_stats(related)
    return ok({'product': row, 'related': related})


@app.route('/api/products/<int:pid>/view', methods=['POST'])
def api_product_view(pid):
    exe('UPDATE `products` SET `views` = `views` + 1 WHERE `id` = %s', (pid,))
    row = q_one('SELECT `views` FROM `products` WHERE `id` = %s', (pid,))
    return ok({'views': row['views'] if row else 0})


@app.route('/api/products', methods=['POST'])
@limiter.limit(RATE_WRITE)
@login_required
def api_product_create():
    data = request.get_json(silent=True) or {}
    user = current_user()

    title = (data.get('title') or '').strip()
    try:
        price = float(data.get('price') or 0)
    except (TypeError, ValueError):
        price = 0
    try:
        original_price = float(data.get('original_price') or data.get('originalPrice') or 0)
    except (TypeError, ValueError):
        original_price = 0
    description = (data.get('description') or data.get('desc') or '').strip()
    condition = (data.get('condition') or '几乎全新').strip()
    location = (data.get('location') or '浙江·杭州').strip()

    if not title:
        return err('商品标题不能为空')
    if price <= 0:
        return err('售价需大于 0')
    if not description:
        return err('商品描述不能为空')

    images = data.get('images') or ([data.get('image')] if data.get('image') else [])
    images = [u for u in images if isinstance(u, str) and u.strip()][:9]
    if not images:
        return err('请至少上传一张商品图片')

    cat_id = data.get('category_id')
    cat_name = (data.get('category') or '').strip()
    if cat_id:
        row = q_one('SELECT `id`,`name` FROM `categories` WHERE `id` = %s', (cat_id,))
    elif cat_name:
        row = q_one('SELECT `id`,`name` FROM `categories` WHERE `name` = %s', (cat_name,))
    else:
        row = None
    if not row:
        return err('请选择有效的商品分类')
    cat_id, cat_name = row['id'], row['name']

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                'INSERT INTO `products` (`title`,`category`,`category_id`,`price`,'
                '`original_price`,`condition`,`description`,`image`,`seller`,'
                '`location`,`user_id`,`status`,`views`,`wants`,`wants_base`) '
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'在售',0,0,0)",
                (title, cat_name, cat_id, price, original_price, condition,
                 description, images[0], user['nickname'], location, user['id']))
            pid = cur.lastrowid
            for i, url in enumerate(images):
                cur.execute(
                    'INSERT INTO `product_images` (`product_id`,`image_url`,`sort_order`) '
                    'VALUES (%s,%s,%s)', (pid, url, i))
        conn.commit()
    except Exception as e:
        conn.rollback()
        return err('发布失败：%s' % e, http=500)
    finally:
        conn.close()

    row = q_one(PRODUCT_SELECT + ' WHERE p.`id` = %s', (pid,))
    return ok(shape_one(row, user['id']), msg='发布成功')


@app.route('/api/products/<int:pid>/status', methods=['POST'])
@limiter.limit(RATE_WRITE)
@login_required
def api_product_status(pid):
    data = request.get_json(silent=True) or {}
    status = (data.get('status') or '').strip()
    if status not in PRODUCT_STATUS:
        return err('状态只能是：' + ' / '.join(PRODUCT_STATUS))
    user = current_user()
    row = q_one('SELECT `id`,`user_id` FROM `products` WHERE `id` = %s', (pid,))
    if not row:
        return err('商品不存在', http=404)
    if row['user_id'] != user['id']:
        return err('只能操作自己发布的商品', code=403, http=403)
    exe('UPDATE `products` SET `status` = %s WHERE `id` = %s', (status, pid))
    return ok({'id': pid, 'status': status}, msg='已更新为「%s」' % status)


@app.route('/api/products/<int:pid>', methods=['DELETE'])
@limiter.limit(RATE_WRITE)
@login_required
def api_product_delete(pid):
    user = current_user()
    row = q_one('SELECT `id`,`user_id` FROM `products` WHERE `id` = %s', (pid,))
    if not row:
        return err('商品不存在', http=404)
    if row['user_id'] != user['id']:
        return err('只能删除自己发布的商品', code=403, http=403)
    exe('DELETE FROM `products` WHERE `id` = %s', (pid,))
    return ok({'id': pid}, msg='商品已删除')


# ==================== 收藏 / 想要（登录鉴权 + 联合唯一） ====================
def _toggle_collection(pid, uid, ctype):
    if not q_one('SELECT `id` FROM `products` WHERE `id` = %s', (pid,)):
        return err('商品不存在', http=404)
    exists = q_one('SELECT `id` FROM `favorites` '
                   'WHERE `user_id` = %s AND `product_id` = %s AND `type` = %s',
                   (uid, pid, ctype))
    if exists:
        exe('DELETE FROM `favorites` WHERE `id` = %s', (exists['id'],))
        active = False
    else:
        exe('INSERT IGNORE INTO `favorites` (`user_id`,`product_id`,`type`) VALUES (%s,%s,%s)',
            (uid, pid, ctype))
        active = True
    if ctype == 'want':
        recalc_wants(pid)
    p = q_one('SELECT `wants` FROM `products` WHERE `id` = %s', (pid,))
    cnt = q_one('SELECT COUNT(*) AS n FROM `favorites` '
                'WHERE `product_id` = %s AND `type` = %s', (pid, ctype))['n']
    return ok({'product_id': pid, 'active': active, 'count': int(cnt),
               'wants': p['wants'] if p else 0})


@app.route('/api/products/<int:pid>/favorite', methods=['POST'])
@limiter.limit(RATE_WRITE)
@login_required
def api_favorite(pid):
    return _toggle_collection(pid, current_user()['id'], 'favorite')


@app.route('/api/products/<int:pid>/want', methods=['POST'])
@limiter.limit(RATE_WRITE)
@login_required
def api_want(pid):
    return _toggle_collection(pid, current_user()['id'], 'want')


@app.route('/api/me/collections', methods=['GET'])
@login_required
def api_my_collections():
    uid = current_user()['id']
    ctype = (request.args.get('type') or 'favorite').strip()
    if ctype not in ('favorite', 'want'):
        return err('type 只能是 favorite 或 want')
    rows = q_all(PRODUCT_SELECT +
                 ' JOIN `favorites` f ON f.`product_id` = p.`id` '
                 'WHERE f.`user_id` = %s AND f.`type` = %s ORDER BY f.`id` DESC',
                 (uid, ctype))
    attach_images(rows)
    attach_flags(rows, uid)
    return ok(rows)


@app.route('/api/me/products', methods=['GET'])
@login_required
def api_my_products():
    uid = current_user()['id']
    rows = q_all(PRODUCT_SELECT + ' WHERE p.`user_id` = %s ORDER BY p.`id` DESC', (uid,))
    attach_images(rows)
    attach_flags(rows, uid)
    return ok(rows)


# ==================== 订单 ====================
@app.route('/api/orders', methods=['POST'])
@limiter.limit(RATE_WRITE)
@login_required
def api_order_create():
    data = request.get_json(silent=True) or {}
    uid = current_user()['id']
    try:
        pid = int(data.get('product_id'))
    except (TypeError, ValueError):
        return err('缺少商品ID')

    p = q_one(PRODUCT_SELECT + ' WHERE p.`id` = %s', (pid,))
    if not p:
        return err('商品不存在', http=404)
    if p['user_id'] == uid:
        return err('不能购买自己发布的商品')

    exist = q_one("SELECT `id`,`order_no` FROM `orders` WHERE `product_id` = %s "
                  "AND `buyer_id` = %s AND `status` IN ('待付款','已付款')", (pid, uid))
    if exist:
        return err('你已拍下该商品，请到「个人中心-我的订单」完成付款', code=5, http=409)
    if p['status'] != '在售':
        return err('该商品当前状态为「%s」，无法下单' % p['status'])

    order_no = 'XH%s%04d' % (time.strftime('%Y%m%d%H%M%S'), random.randint(0, 9999))
    exe_many([
        ('INSERT INTO `orders` (`order_no`,`product_id`,`buyer_id`,`seller_id`,`amount`,`status`) '
         "VALUES (%s,%s,%s,%s,%s,'待付款')",
         (order_no, pid, uid, p['user_id'], p['price'])),
        ("UPDATE `products` SET `status` = '已售出' WHERE `id` = %s", (pid,)),
    ])
    order = q_one('SELECT * FROM `orders` WHERE `order_no` = %s', (order_no,))
    order['created_at'] = fmt_dt(order['created_at'])
    return ok(order, msg='拍下成功，订单号 %s' % order_no)


@app.route('/api/orders', methods=['GET'])
def api_order_list():
    user = current_user()
    if not user:
        return err('请先登录后再查看订单', code=401, http=401)
    role = (request.args.get('role') or 'all').strip()
    where, args = ['1=1'], []
    if role == 'buyer':
        where.append('o.`buyer_id` = %s')
        args.append(user['id'])
    elif role == 'seller':
        where.append('o.`seller_id` = %s')
        args.append(user['id'])
    else:
        where.append('(o.`buyer_id` = %s OR o.`seller_id` = %s)')
        args += [user['id'], user['id']]

    rows = q_all(
        'SELECT o.*, p.`title` AS product_title, p.`image` AS product_image, '
        '       p.`price` AS product_price, '
        '       b.`nickname` AS buyer_name, s.`nickname` AS seller_name, '
        '       EXISTS (SELECT 1 FROM `reviews` r WHERE r.`order_id` = o.`id`) '
        '       AS reviewed '
        'FROM `orders` o '
        'LEFT JOIN `products` p ON p.`id` = o.`product_id` '
        'LEFT JOIN `users` b ON b.`id` = o.`buyer_id` '
        'LEFT JOIN `users` s ON s.`id` = o.`seller_id` '
        'WHERE ' + ' AND '.join(where) + ' ORDER BY o.`id` DESC', args)
    for r in rows:
        r['created_at'] = fmt_dt(r['created_at'])
        r['amount'] = float(r['amount'] or 0)
        r['role'] = 'buyer' if r['buyer_id'] == user['id'] else 'seller'
        r['reviewed'] = bool(int(r.get('reviewed') or 0))
    return ok(rows)


@app.route('/api/orders/<int:oid>/status', methods=['POST'])
@limiter.limit(RATE_WRITE)
@login_required
def api_order_status(oid):
    data = request.get_json(silent=True) or {}
    target = (data.get('status') or '').strip()
    if target not in ORDER_STATUS:
        return err('状态只能是：' + ' / '.join(ORDER_STATUS))
    uid = current_user()['id']
    order = q_one('SELECT * FROM `orders` WHERE `id` = %s', (oid,))
    if not order:
        return err('订单不存在', http=404)

    allowed = {
        '待付款': {'buyer': ['已付款', '已取消'], 'seller': ['已取消']},
        '已付款': {'buyer': [], 'seller': ['已完成', '已取消']},
        '已完成': {'buyer': [], 'seller': []},
        '已取消': {'buyer': [], 'seller': []},
    }
    if uid == order['buyer_id']:
        role = 'buyer'
    elif uid == order['seller_id']:
        role = 'seller'
    else:
        return err('无权操作该订单', code=403, http=403)

    if target not in allowed.get(order['status'], {}).get(role, []):
        return err('订单当前状态「%s」不允许%s执行「%s」'
                   % (order['status'], '买家' if role == 'buyer' else '卖家', target))

    stmts = [('UPDATE `orders` SET `status` = %s WHERE `id` = %s', (target, oid))]
    if target == '已完成':
        stmts.append(("UPDATE `products` SET `status` = '已售出' WHERE `id` = %s",
                      (order['product_id'],)))
    if target == '已取消':
        stmts.append(("UPDATE `products` SET `status` = '在售' WHERE `id` = %s",
                      (order['product_id'],)))
    exe_many(stmts)
    return ok({'id': oid, 'status': target}, msg='订单已更新为「%s」' % target)


# ==================== 订单评价（订单完成后买家评价卖家，一单一评） ====================
REVIEW_MAX_LEN = 200          # 与前端 profile.html 评价输入框 maxlength 保持一致
RATING_RANGE = (1, 2, 3, 4, 5)


def review_stats(pid):
    """商品评价总数 + 平均分（保留 1 位小数，无评价返回 0）"""
    row = q_one('SELECT COUNT(*) AS n, AVG(`rating`) AS avg_score FROM `reviews` '
                'WHERE `product_id` = %s', (pid,))
    return int(row['n'] or 0), round(float(row['avg_score'] or 0), 1)


@app.route('/api/orders/<int:oid>/review', methods=['POST'])
@limiter.limit(RATE_WRITE)
@login_required
def api_order_review(oid):
    """提交评价：仅该订单买家可评、订单需已完成、每个订单只能评一次"""
    data = request.get_json(silent=True) or {}
    uid = current_user()['id']
    order = q_one('SELECT * FROM `orders` WHERE `id` = %s', (oid,))
    if not order:
        return err('订单不存在', http=404)
    if order['buyer_id'] != uid:
        return err('只有买家可以评价该订单', code=403, http=403)
    if order['status'] != '已完成':
        return err('订单完成后才能评价（当前状态「%s」）' % order['status'])
    if q_one('SELECT `id` FROM `reviews` WHERE `order_id` = %s', (oid,)):
        return err('该订单已评价过，不能重复评价', code=5, http=409)

    try:
        rating = int(data.get('rating'))
    except (TypeError, ValueError):
        return err('请选择 1-5 星评分')
    if rating not in RATING_RANGE:
        return err('评分只能是 1-5 星')

    content = (data.get('content') or '').strip()
    if len(content) > REVIEW_MAX_LEN:
        return err('评价内容最多 %d 个字' % REVIEW_MAX_LEN)

    rid = exe('INSERT INTO `reviews` (`order_id`,`product_id`,`reviewer_id`,'
              '`reviewee_id`,`rating`,`content`) VALUES (%s,%s,%s,%s,%s,%s)',
              (oid, order['product_id'], uid, order['seller_id'], rating, content))
    row = q_one('SELECT * FROM `reviews` WHERE `id` = %s', (rid,))
    row['created_at'] = fmt_dt(row['created_at'])
    row['rating'] = int(row['rating'])
    return ok(row, msg='评价成功，感谢你的反馈')


@app.route('/api/products/<int:pid>/reviews', methods=['GET'])
def api_product_reviews(pid):
    """商品评价列表（含平均分、星级分布），详情页展示用"""
    if not q_one('SELECT `id` FROM `products` WHERE `id` = %s', (pid,)):
        return err('商品不存在', http=404)
    try:
        limit = min(int(request.args.get('limit') or 50), 200)
    except ValueError:
        limit = 50

    rows = q_all(
        'SELECT r.`id`, r.`order_id`, r.`rating`, r.`content`, r.`created_at`, '
        '       u.`id` AS reviewer_id, u.`nickname` AS reviewer_name, '
        '       u.`avatar` AS reviewer_avatar '
        'FROM `reviews` r '
        'LEFT JOIN `users` u ON u.`id` = r.`reviewer_id` '
        'WHERE r.`product_id` = %s ORDER BY r.`id` DESC LIMIT %s', (pid, limit))
    for r in rows:
        r['created_at'] = fmt_dt(r['created_at'])
        r['rating'] = int(r['rating'])
        r['reviewer_name'] = r.get('reviewer_name') or '匿名用户'
        r['reviewer_avatar'] = r.get('reviewer_avatar') or ''

    total, avg_score = review_stats(pid)
    dist = dict((str(i), 0) for i in RATING_RANGE)
    for r in q_all('SELECT `rating`, COUNT(*) AS n FROM `reviews` '
                   'WHERE `product_id` = %s GROUP BY `rating`', (pid,)):
        dist[str(int(r['rating']))] = int(r['n'])
    return ok({'total': total, 'avg': avg_score, 'dist': dist, 'list': rows})


@app.route('/api/me/reviews', methods=['GET'])
@login_required
def api_my_reviews():
    """个人中心：我发出的评价（sent）/ 我收到的评价（received）"""
    uid = current_user()['id']
    role = (request.args.get('role') or 'sent').strip()
    if role not in ('sent', 'received'):
        return err('role 只能是 sent 或 received')

    field = 'r.`reviewer_id`' if role == 'sent' else 'r.`reviewee_id`'
    rows = q_all(
        'SELECT r.`id`, r.`order_id`, r.`product_id`, r.`rating`, r.`content`, '
        '       r.`created_at`, p.`title` AS product_title, p.`image` AS product_image, '
        '       ru.`nickname` AS reviewer_name, tu.`nickname` AS reviewee_name '
        'FROM `reviews` r '
        'LEFT JOIN `products` p ON p.`id` = r.`product_id` '
        'LEFT JOIN `users` ru ON ru.`id` = r.`reviewer_id` '
        'LEFT JOIN `users` tu ON tu.`id` = r.`reviewee_id` '
        'WHERE ' + field + ' = %s ORDER BY r.`id` DESC', (uid,))
    for r in rows:
        r['created_at'] = fmt_dt(r['created_at'])
        r['rating'] = int(r['rating'])
        r['product_title'] = r.get('product_title') or '商品已删除'
        r['product_image'] = r.get('product_image') or ''
        r['peer_name'] = (r.get('reviewee_name') if role == 'sent'
                          else r.get('reviewer_name')) or '已注销用户'
    total = len(rows)
    avg_score = round(sum(r['rating'] for r in rows) / float(total), 1) if total else 0
    return ok({'role': role, 'total': total, 'avg': avg_score, 'list': rows})


# ==================== 站内私信 ====================
@app.route('/api/messages', methods=['GET'])
@login_required
def api_messages():
    uid = current_user()['id']
    try:
        peer_id = int(request.args.get('peer_id') or 0)
    except ValueError:
        return err('peer_id 参数错误')
    product_id = request.args.get('product_id')
    try:
        product_id = int(product_id) if product_id else None
    except ValueError:
        product_id = None
    if not peer_id:
        return err('缺少 peer_id')

    where = ['((`sender_id` = %s AND `receiver_id` = %s) OR '
             '(`sender_id` = %s AND `receiver_id` = %s))']
    args = [uid, peer_id, peer_id, uid]
    if product_id:
        where.append('(`product_id` = %s OR `product_id` IS NULL)')
        args.append(product_id)

    rows = q_all('SELECT * FROM `messages` WHERE ' + ' AND '.join(where) +
                 ' ORDER BY `id` ASC LIMIT 300', args)
    for r in rows:
        r['created_at'] = fmt_dt(r['created_at'])
        r['mine'] = (r['sender_id'] == uid)

    exe('UPDATE `messages` SET `is_read` = 1 '
        'WHERE `receiver_id` = %s AND `sender_id` = %s AND `is_read` = 0', (uid, peer_id))

    peer = q_one('SELECT `id`,`nickname`,`avatar` '
                 'FROM `users` WHERE `id` = %s', (peer_id,))
    return ok({'list': rows, 'peer': peer})


@app.route('/api/messages', methods=['POST'])
@limiter.limit(RATE_MESSAGE)
@login_required
def api_message_send():
    data = request.get_json(silent=True) or {}
    uid = current_user()['id']
    try:
        receiver_id = int(data.get('receiver_id'))
    except (TypeError, ValueError):
        return err('缺少 receiver_id')
    content = (data.get('content') or '').strip()
    if not content:
        return err('消息内容不能为空')
    if len(content) > 500:
        return err('单条消息最多 500 字')
    if receiver_id == uid:
        return err('不能给自己发私信')
    if not q_one('SELECT `id` FROM `users` WHERE `id` = %s', (receiver_id,)):
        return err('接收方不存在', http=404)

    product_id = data.get('product_id')
    try:
        product_id = int(product_id) if product_id else None
    except (TypeError, ValueError):
        product_id = None

    mid = exe('INSERT INTO `messages` (`sender_id`,`receiver_id`,`product_id`,`content`) '
              'VALUES (%s,%s,%s,%s)', (uid, receiver_id, product_id, content))
    row = q_one('SELECT * FROM `messages` WHERE `id` = %s', (mid,))
    row['created_at'] = fmt_dt(row['created_at'])
    row['mine'] = True
    return ok(row, msg='已发送')


@app.route('/api/messages/conversations', methods=['GET'])
@login_required
def api_conversations():
    uid = current_user()['id']
    rows = q_all('SELECT * FROM `messages` WHERE `sender_id` = %s OR `receiver_id` = %s '
                 'ORDER BY `id` DESC LIMIT 500', (uid, uid))
    convs, order = {}, []
    for r in rows:
        peer = r['receiver_id'] if r['sender_id'] == uid else r['sender_id']
        key = '%d_%s' % (peer, r['product_id'])
        if key not in convs:
            convs[key] = {
                'peer_id': peer, 'product_id': r['product_id'],
                'last_content': r['content'], 'last_time': fmt_dt(r['created_at']),
                'last_mine': r['sender_id'] == uid, 'unread': 0,
            }
            order.append(key)
        if r['receiver_id'] == uid and not r['is_read']:
            convs[key]['unread'] += 1

    if not order:
        return ok([])

    peer_ids = list({convs[k]['peer_id'] for k in order})
    prod_ids = list({convs[k]['product_id'] for k in order if convs[k]['product_id']})
    holder = ','.join(['%s'] * len(peer_ids))
    users = {u['id']: u for u in q_all(
        'SELECT `id`,`nickname`,`avatar` FROM `users` '
        'WHERE `id` IN (%s)' % holder, peer_ids)}
    products = {}
    if prod_ids:
        holder = ','.join(['%s'] * len(prod_ids))
        products = {p['id']: p for p in q_all(
            'SELECT `id`,`title`,`image` FROM `products` WHERE `id` IN (%s)' % holder, prod_ids)}

    result = []
    for k in order:
        c = convs[k]
        u = users.get(c['peer_id']) or {}
        p = products.get(c['product_id']) or {}
        c['peer_name'] = u.get('nickname') or '已注销用户'
        c['peer_avatar'] = u.get('avatar') or ''
        c['product_title'] = p.get('title') or ''
        c['product_image'] = p.get('image') or ''
        result.append(c)
    result.sort(key=lambda x: x['last_time'], reverse=True)
    return ok(result)


@app.route('/api/messages/unread', methods=['GET'])
@login_required
def api_unread():
    uid = current_user()['id']
    n = q_one('SELECT COUNT(*) AS n FROM `messages` '
              'WHERE `receiver_id` = %s AND `is_read` = 0', (uid,))['n']
    return ok({'count': int(n)})


# ==================== 图片上传（多图） ====================
def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@app.errorhandler(413)
def too_large(e):
    return jsonify({'code': 1, 'msg': '文件超过大小限制（单张建议 5MB 以内）'}), 413


@app.route('/api/upload', methods=['POST'])
@limiter.limit(RATE_UPLOAD)
@login_required
def api_upload():
    files = request.files.getlist('file') or request.files.getlist('files')
    files = [f for f in files if f and f.filename]
    if not files:
        return err('没有收到文件')

    urls = []
    for f in files[:9]:
        if not allowed_file(f.filename):
            return err('不支持的图片格式：%s' % f.filename)
        ext = f.filename.rsplit('.', 1)[1].lower()
        name = '%d%03d.%s' % (int(time.time() * 1000), random.randint(0, 999), ext)
        f.save(os.path.join(UPLOAD_FOLDER, name))
        urls.append('/images/' + name)
    return ok({'urls': urls, 'url': urls[0]})


# ==================== 前端页面托管 ====================
@app.route('/')
def front_index():
    return send_from_directory(FRONT_FOLDER, 'index.html')


# 仅允许托管前端静态资源，避免源码 / 配置被直接下载
FRONT_EXT = {'html', 'js', 'css', 'svg', 'png', 'jpg', 'jpeg', 'gif',
             'webp', 'bmp', 'ico', 'woff', 'woff2', 'ttf', 'map'}


@app.route('/<path:filename>')
@limiter.exempt                       # 页面静态资源不参与限流（避免 NAT 下并发拉取 css/js 被误伤）
def front_static(filename):
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
    if ext not in FRONT_EXT:
        return jsonify({'code': 404, 'msg': '资源不存在'}), 404
    return send_from_directory(FRONT_FOLDER, filename)


@app.errorhandler(429)
def rate_limited(e):
    return jsonify({'code': 429, 'msg': '请求过于频繁，请稍后再试'}), 429


@app.errorhandler(500)
def server_error(e):
    # 生产模式：详细报错只写日志，前端仅拿到固定提示，避免泄露内部实现
    app.logger.exception('服务器内部错误: %s', e)
    return jsonify({'code': 1, 'msg': '服务器内部错误，请稍后重试'}), 500


@app.errorhandler(Exception)
def unhandled_error(e):
    if isinstance(e, HTTPException):
        return e
    app.logger.exception('未捕获异常: %s', e)
    return jsonify({'code': 1, 'msg': '服务器内部错误，请稍后重试'}), 500


# ==================== 启动 ====================
def bootstrap_database():
    """首次运行时自动建库、建表、补索引，让 `python app.py` 一条命令即可跑起来。
    全部操作幂等，不会覆盖已有数据。"""
    from db_migrate import ensure_database, ensure_schema
    from db_indexes import ensure_indexes

    ensure_database()
    conn = pymysql.connect(**DB_CONFIG)
    try:
        ensure_schema(conn, verbose=False)
        ensure_indexes(conn, verbose=False)
    finally:
        conn.close()


if __name__ == '__main__':
    print('=' * 60)
    print('  校园闲换 · 校园二手交易平台')
    print('=' * 60)

    print('  正在检查数据库 ...')
    try:
        bootstrap_database()
        print('  √ 数据库就绪（不存在时会自动创建）')
    except Exception as exc:
        print('  x 数据库初始化失败：%s' % exc)
        print('    请确认 MySQL 已启动，并检查 .env 里的 XQ_DB_* 配置。')
        print('    配置文件：%s' % config.ENV_FILE)
        sys.exit(1)

    show_host = '127.0.0.1' if config.HOST in ('', '0.0.0.0') else config.HOST
    base = 'http://%s:%s' % (show_host, config.PORT)
    print('  数据库：%s@%s:%s/%s'
          % (config.DB_USER, config.DB_HOST, config.DB_PORT, config.DB_NAME))
    print('  首页地址：%s/index.html' % base)
    print('  登录注册：%s/login.html' % base)
    print('  个人中心：%s/profile.html' % base)
    print('  运行模式：%s（debug=%s）' % ('开发' if config.DEBUG else '生产', config.DEBUG))
    print('  请求限流：%s（维度：登录按用户 / 未登录按 IP）'
          % ('已启用' if RATE_ENABLED else '已关闭'))
    print('  连接池上限：%s' % POOL_MAX)
    print('  本系统不预置账号，请在「注册」页自行创建')
    print('  按 Ctrl + C 停止服务')
    print('=' * 60)

    app.run(
        host=config.HOST,
        port=config.PORT,
        debug=config.DEBUG,
        use_reloader=config.DEBUG,
        threaded=True,
        exclude_patterns=['*/site-packages/*', '*/python*/Lib/*'],
    )
