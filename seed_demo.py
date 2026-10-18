# -*- coding: utf-8 -*-
"""seed_demo.py —— 演示数据播种脚本（幂等，可重复执行）
========================================================================
【可选脚本】本项目不预置任何账号与商品，`python app.py` 启动后首页是空的。
  想快速看到有内容的效果时，再执行本脚本，灌入 10 件示例商品及其图片关联、
  收藏、订单、评价与私信。

它会做的事：
  1) 按需创建两个演示账号（xianyu01 / demo），已存在则跳过
  2) 复用 db_migrate 写入的 10 个商品分类
  3) 按「商品标题 + 卖家」判重插入示例商品，不重复、不覆盖已有数据

使用顺序（第 2 步可选）：
  1) python app.py          # 首次启动会自动建库建表建索引
  2) python seed_demo.py    # 需要演示数据时再执行

幂等策略：所有插入前都先判重，可重复执行。

运行： python seed_demo.py
========================================================================
"""
import os
import sys
import traceback
from datetime import datetime

import pymysql
from PIL import Image, ImageDraw
from werkzeug.security import generate_password_hash

from db_migrate import DB_CONFIG

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
IMAGE_DIR = os.path.join(BASE_DIR, 'images')

# 占位图配色（避免纯色块过于单调）
PLACEHOLDER_COLORS = [
    (238, 111, 151), (255, 159, 184), (201, 139, 224),
    (127, 168, 234), (94, 198, 201), (242, 160, 91),
]

# ---------------- 演示商品（卖家统一为 xianyu01） ----------------
# 字段：标题 / 分类名 / 售价 / 原价 / 成色 / 描述 / 图片文件名 / 交易地点 / 想要基数 / 浏览量 / 状态
DEMO_PRODUCTS = [
    ('学校', '图书教材', 1.00, 0.10, '明显使用痕迹',
     '测试', '1791718091016.png', '图书馆', 0, 4, '在售'),
    ('玩具', '潮玩手办', 80.88, 90.90, '几乎全新',
     '99新，绝版，小玩具', '1791719207095.jpg', '操场', 0, 1, '在售'),
    ('黑人牙膏', '美妆个护', 3.00, 3.50, '几乎全新',
     '黑人牙膏，800g*4支官方直发，清新双效200g*4支套装，大容量清新口气',
     '1791719331763.jpg', '超市', 0, 6, '在售'),
    ('课本，前端web', '图书教材', 9.00, 100.00, '几乎全新',
     '计算机相关专业 Java Web 开发，课程学习 / 项目实践 / 自学提升用\n'
     '权威教材，学习方便，老师推荐放心入\n喜欢直接拍，细节图私聊发',
     '1791719439994.jpg', '教室', 0, 1, '在售'),
    ('篮球', '运动户外', 99.00, 200.00, '几乎全新',
     '斯伯丁正品篮球，李宁篮球，亿动，全新未拆封，低价处理，款式多多',
     '1791719525640.jpg', '体育馆', 0, 2, '在售'),
    ('光遇游戏账号', '游戏影音', 100.00, 0.00, '几乎全新',
     '苹果高级盲盒：保底一件复刻\n苹果武士裤：保底武士裤\n'
     '安卓高级盲盒：保底三件装扮\n安卓武士裤：保底武士裤',
     '1791719740625.png', '线上', 1, 5, '已售出'),
    ('包包', '服饰鞋包', 500.00, 666.00, '几乎全新',
     '官方托特包，牛仔上课电脑女大学生手提包，通勤单肩手提包',
     '1791719891286.png', '教室', 0, 1, '在售'),
    ('猪笼草', '绿植宠物', 10.00, 15.00, '几乎全新',
     '高度12cm左右\n绿植健康成品，适合室内悬挂，超好养，特别适合驱蚊，省心省力。',
     '1791720002277.png', '教室', 0, 10, '在售'),
    ('vivo手机', '手机数码', 500.00, 2000.00, '明显使用痕迹',
     'vivo X70 Pro 12+12G运存，256G存储，E1080八核处理器，专业影像芯片V1。'
     '成色还可以，边框有点磕碰，屏幕正常，功能全好，账号已退，插卡即用。',
     '1791720132137.png', '操场', 2, 8, '在售'),
    ('暖水袋', '家居家电', 50.00, 90.00, '几乎全新',
     '充电热水袋，深灰色，插电即用，带原装电源线和插头，操作简单，冬天暖手暖被窝很方便。'
     '全新，布套厚实，手感舒服，颜色百搭。',
     '1791720376304.png', '操场', 0, 2, '在售'),
]

# 演示订单 / 评价 / 私信：买家统一为 demo，卖家为 xianyu01
DEMO_ORDER = {
    'order_no': 'XH202610182001557172',
    'product_title': '光遇游戏账号',
    'amount': 100.00,
    'status': '已完成',
    'created_at': '2026-10-18 20:01:55',
}
DEMO_REVIEW = {
    'rating': 3,
    'content': '货品非常好',
    'created_at': '2026-10-18 20:04:40',
}
DEMO_MESSAGES = [
    ('demo', 'xianyu01', '黑人牙膏', '便宜点卖给我！！！！', 1, '2026-10-17 17:06:47'),
    ('xianyu01', 'demo', '黑人牙膏', '你要多少钱？', 1, '2026-10-17 17:07:03'),
    ('demo', 'xianyu01', '黑人牙膏', '0.1元', 1, '2026-10-17 17:07:15'),
    ('demo', 'xianyu01', '黑人牙膏', '不可以', 1, '2026-10-17 17:07:29'),
    ('xianyu01', 'demo', '黑人牙膏', '再谈谈', 1, '2026-10-17 17:07:38'),
    ('demo', 'xianyu01', '黑人牙膏', '谈谈？', 1, '2026-10-17 17:07:47'),
]

SELLER = 'xianyu01'
BUYER = 'demo'

# 演示账号：仅在执行本脚本时按需创建；不执行脚本时系统内没有任何账号
DEMO_USERS = [
    (SELLER, 'xianyu123', '逛逛小能手8500'),   # 卖家
    (BUYER, 'demo123', '演示同学'),             # 买家
]


def log(msg):
    print(msg, flush=True)


def get_user_id(cur, username):
    cur.execute('SELECT `id` FROM `users` WHERE `username` = %s', (username,))
    row = cur.fetchone()
    return row['id'] if row else None


def ensure_users(cur):
    """按需创建演示账号，已存在则跳过。返回 (seller_id, buyer_id)。"""
    ids = {}
    for username, password, nickname in DEMO_USERS:
        uid = get_user_id(cur, username)
        if uid:
            log('  - 账号 %s 已存在，跳过' % username)
        else:
            cur.execute(
                'INSERT INTO `users` (`username`,`password_hash`,`nickname`) '
                'VALUES (%s,%s,%s)',
                (username,
                 generate_password_hash(password, method='pbkdf2:sha256'),
                 nickname),
            )
            uid = cur.lastrowid
            log('  √ 创建账号 %s / %s (%s)' % (username, password, nickname))
        ids[username] = uid
    return ids[SELLER], ids[BUYER]


def get_category_map(cur):
    cur.execute('SELECT `id`, `name` FROM `categories`')
    return {r['name']: r['id'] for r in cur.fetchall()}


def ensure_image_file(image_file, title):
    """示例图不存在时生成一张占位图。
    因为 images/ 已被 .gitignore 忽略（用户上传目录），全新 clone 里没有示例图；
    直接引用会变成裂图。这里按商品标题生成配色占位图，保证页面不缺图。
    如果你自己往 images/ 放了同名图片，则直接使用你自己的图片。"""
    path = os.path.join(IMAGE_DIR, image_file)
    if os.path.isfile(path):
        return False

    os.makedirs(IMAGE_DIR, exist_ok=True)
    color = PLACEHOLDER_COLORS[sum(map(ord, title)) % len(PLACEHOLDER_COLORS)]
    light = tuple(min(255, c + 22) for c in color)
    im = Image.new('RGB', (800, 600), color)
    draw = ImageDraw.Draw(im)
    for x in range(-600, 800, 90):
        draw.line([(x, 0), (x + 600, 600)], fill=light, width=24)
    im.save(path)
    return True


def get_or_create_product(cur, seller_id, cat_map, item):
    """按 标题 + 卖家 判重；返回 (product_id, created)"""
    (title, cat_name, price, original_price, condition,
     description, image_file, location, wants_base, views, status) = item

    cur.execute(
        'SELECT `id` FROM `products` WHERE `title` = %s AND `user_id` = %s',
        (title, seller_id),
    )
    row = cur.fetchone()
    if row:
        return row['id'], False

    image_url = '/images/' + image_file
    if ensure_image_file(image_file, title):
        log('  · 生成占位图 %s' % image_file)
    cur.execute(
        'INSERT INTO `products` '
        '(`title`,`category`,`price`,`original_price`,`condition`,`description`,'
        ' `image`,`seller`,`location`,`wants`,`wants_base`,`views`,`created_at`,'
        ' `user_id`,`category_id`,`status`) '
        'VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)',
        (title, cat_name, price, original_price, condition, description,
         image_url, SELLER, location, wants_base, wants_base, views,
         datetime.now(), seller_id, cat_map.get(cat_name), status),
    )
    product_id = cur.lastrowid

    cur.execute(
        'INSERT INTO `product_images` (`product_id`,`image_url`,`sort_order`) '
        'VALUES (%s,%s,0)',
        (product_id, image_url),
    )
    return product_id, True


def main():
    conn = pymysql.connect(**DB_CONFIG)
    cur = conn.cursor()
    try:
        log('=' * 60)
        log('演示数据播种（幂等）  数据库：%s' % DB_CONFIG['database'])
        log('=' * 60)

        log('【0/4】准备演示账号与分类')
        seller_id, buyer_id = ensure_users(cur)
        conn.commit()

        cat_map = get_category_map(cur)
        if not cat_map:
            log('[错误] categories 表为空，请先执行 python app.py 完成初始化')
            return 1

        # ---------- 1. 商品 + 图片 ----------
        log('【1/4】示例商品')
        created = skipped = 0
        product_ids = {}
        for item in DEMO_PRODUCTS:
            pid, is_new = get_or_create_product(cur, seller_id, cat_map, item)
            product_ids[item[0]] = pid
            if is_new:
                created += 1
                log('  √ 新增 %s' % item[0])
            else:
                skipped += 1
                log('  - 已存在，跳过 %s' % item[0])
        log('  新增 %d 件，跳过 %d 件' % (created, skipped))

        # ---------- 2. 收藏 ----------
        log('【2/4】示例收藏')
        fav_pairs = [
            (seller_id, product_ids.get('暖水袋'), 'favorite'),
            (buyer_id, product_ids.get('光遇游戏账号'), 'favorite'),
        ]
        for uid, pid, ftype in fav_pairs:
            if not pid:
                continue
            cur.execute(
                'SELECT `id` FROM `favorites` WHERE `user_id`=%s AND `product_id`=%s AND `type`=%s',
                (uid, pid, ftype),
            )
            if cur.fetchone():
                log('  - 已存在，跳过 user=%s product=%s' % (uid, pid))
                continue
            cur.execute(
                'INSERT INTO `favorites` (`user_id`,`product_id`,`type`,`created_at`) '
                'VALUES (%s,%s,%s,%s)',
                (uid, pid, ftype, datetime.now()),
            )
            log('  √ 收藏 user=%s product=%s' % (uid, pid))

        # ---------- 3. 订单 + 评价 ----------
        log('【3/4】示例订单与评价')
        pid = product_ids.get(DEMO_ORDER['product_title'])
        cur.execute('SELECT `id` FROM `orders` WHERE `order_no` = %s',
                    (DEMO_ORDER['order_no'],))
        order_row = cur.fetchone()
        if order_row:
            order_id = order_row['id']
            log('  - 订单已存在，跳过')
        else:
            cur.execute(
                'INSERT INTO `orders` '
                '(`order_no`,`product_id`,`buyer_id`,`seller_id`,`amount`,`status`,`created_at`) '
                'VALUES (%s,%s,%s,%s,%s,%s,%s)',
                (DEMO_ORDER['order_no'], pid, buyer_id, seller_id,
                 DEMO_ORDER['amount'], DEMO_ORDER['status'],
                 DEMO_ORDER['created_at']),
            )
            order_id = cur.lastrowid
            log('  √ 订单 %s' % DEMO_ORDER['order_no'])

        cur.execute('SELECT `id` FROM `reviews` WHERE `order_id` = %s', (order_id,))
        if cur.fetchone():
            log('  - 评价已存在，跳过')
        else:
            cur.execute(
                'INSERT INTO `reviews` '
                '(`order_id`,`product_id`,`reviewer_id`,`reviewee_id`,`rating`,`content`,`created_at`) '
                'VALUES (%s,%s,%s,%s,%s,%s,%s)',
                (order_id, pid, buyer_id, seller_id,
                 DEMO_REVIEW['rating'], DEMO_REVIEW['content'],
                 DEMO_REVIEW['created_at']),
            )
            log('  √ 评价 %d 星' % DEMO_REVIEW['rating'])

        # ---------- 4. 私信 ----------
        log('【4/4】示例私信')
        users = {SELLER: seller_id, BUYER: buyer_id}
        added = 0
        for from_u, to_u, product_title, content, is_read, created_at in DEMO_MESSAGES:
            p = product_ids.get(product_title)
            if not p:
                continue
            cur.execute(
                'SELECT `id` FROM `messages` WHERE `sender_id`=%s AND `receiver_id`=%s '
                'AND `product_id`=%s AND `content`=%s',
                (users[from_u], users[to_u], p, content),
            )
            if cur.fetchone():
                continue
            cur.execute(
                'INSERT INTO `messages` '
                '(`sender_id`,`receiver_id`,`product_id`,`content`,`is_read`,`created_at`) '
                'VALUES (%s,%s,%s,%s,%s,%s)',
                (users[from_u], users[to_u], p, content, is_read, created_at),
            )
            added += 1
        log('  新增 %d 条私信' % added)

        conn.commit()

        # ---------- 汇总 ----------
        log('-' * 60)
        for t in ['users', 'categories', 'products', 'product_images',
                  'favorites', 'orders', 'messages', 'reviews']:
            cur.execute('SELECT COUNT(*) AS n FROM `%s`' % t)
            log('  %-16s %d 行' % (t, cur.fetchone()['n']))
        log('-' * 60)
        log('播种完成。演示账号：demo / demo123 ；xianyu01 / xianyu123')
        return 0
    finally:
        cur.close()
        conn.close()


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(1)
