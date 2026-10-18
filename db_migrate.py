# -*- coding: utf-8 -*-
"""
db_migrate.py —— 校园闲换 数据库迁移脚本（幂等，可重复执行）
========================================================================
作用：
  0) 数据库不存在时自动创建（utf8mb4）；已存在则跳过
  1) 创建/补齐 8 张表：users、categories、products、product_images、
     favorites、orders、messages、reviews（订单评价表）
  2) 初始化 10 个商品分类（前端分类列表改为从数据库动态拉取）
  3) 迁移历史商品数据：补 category_id / status 字段，
     并把老的 products.image 单图迁移进 product_images 多图表
  4) 依据 favorites 表重算 products.wants，保证"想要"数量不再无限累加

本项目不预置任何账号、不预置任何商品：首次使用时在前端「注册」页自行创建。

配置来源（优先级从高到低）：
  真实环境变量  >  项目根目录 .env  >  config.py 里的默认值
  支持 XQ_DB_HOST / XQ_DB_PORT / XQ_DB_USER / XQ_DB_PASSWORD / XQ_DB_NAME

用法：
  python db_migrate.py        # 单独执行迁移（可选）
  直接 python app.py 也会自动完成同样的初始化
========================================================================
"""
import re
import sys
import traceback

import pymysql

from config import DB_CONFIG, DB_NAME

# ---------------- 分类（前端不再写死，改为接口下发） ----------------
CATEGORIES = [
    '手机数码', '电脑办公', '服饰鞋包', '家居家电', '图书教材',
    '美妆个护', '运动户外', '潮玩手办', '游戏影音', '绿植宠物',
]

# ---------------- 业务表清单（建表 / 汇总共用） ----------------
TABLES = ['users', 'categories', 'products', 'product_images',
          'favorites', 'orders', 'messages', 'reviews']

# ---------------- 表结构 ----------------
DDL = {}

DDL['users'] = """
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '用户ID',
  `username` VARCHAR(50) NOT NULL COMMENT '登录账号',
  `password_hash` VARCHAR(255) NOT NULL COMMENT '密码哈希(PBKDF2-SHA256)',
  `nickname` VARCHAR(50) NOT NULL COMMENT '昵称',
  `avatar` VARCHAR(255) NOT NULL DEFAULT '' COMMENT '头像地址',
  `credit_score` INT NOT NULL DEFAULT 100 COMMENT '信用分',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '注册时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表'
"""

DDL['categories'] = """
CREATE TABLE IF NOT EXISTS `categories` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '分类ID',
  `name` VARCHAR(50) NOT NULL COMMENT '分类名称',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '排序(越小越靠前)',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商品分类表'
"""

DDL['product_images'] = """
CREATE TABLE IF NOT EXISTS `product_images` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '图片ID',
  `product_id` INT NOT NULL COMMENT '所属商品ID',
  `image_url` VARCHAR(500) NOT NULL COMMENT '图片地址(根相对路径)',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '排序',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '上传时间',
  PRIMARY KEY (`id`),
  KEY `idx_product` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商品图片表(商品:图片=1:N)'
"""

DDL['favorites'] = """
CREATE TABLE IF NOT EXISTS `favorites` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '主键',
  `user_id` INT NOT NULL COMMENT '用户ID',
  `product_id` INT NOT NULL COMMENT '商品ID',
  `type` VARCHAR(16) NOT NULL DEFAULT 'favorite' COMMENT 'favorite=收藏 / want=想要',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_product_type` (`user_id`, `product_id`, `type`),
  KEY `idx_product_type` (`product_id`, `type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='收藏/想要关系表(联合唯一，防重复累加)'
"""

DDL['orders'] = """
CREATE TABLE IF NOT EXISTS `orders` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '订单ID',
  `order_no` VARCHAR(32) NOT NULL COMMENT '订单号',
  `product_id` INT NOT NULL COMMENT '商品ID',
  `buyer_id` INT NOT NULL COMMENT '买家ID',
  `seller_id` INT NOT NULL COMMENT '卖家ID',
  `amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT '交易金额',
  `status` VARCHAR(16) NOT NULL DEFAULT '待付款' COMMENT '待付款/已付款/已完成/已取消',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '下单时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_order_no` (`order_no`),
  KEY `idx_buyer` (`buyer_id`),
  KEY `idx_seller` (`seller_id`),
  KEY `idx_product` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单表'
"""

DDL['messages'] = """
CREATE TABLE IF NOT EXISTS `messages` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '消息ID',
  `sender_id` INT NOT NULL COMMENT '发送者ID',
  `receiver_id` INT NOT NULL COMMENT '接收者ID',
  `product_id` INT DEFAULT NULL COMMENT '关联商品ID(可空)',
  `content` TEXT NOT NULL COMMENT '消息内容',
  `is_read` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否已读 0未读 1已读',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发送时间',
  PRIMARY KEY (`id`),
  KEY `idx_sender` (`sender_id`),
  KEY `idx_receiver` (`receiver_id`),
  KEY `idx_product` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='站内私信表'
"""

# ---------------- reviews 订单评价表（一单一评，买家评卖家） ----------------
DDL['reviews'] = """
CREATE TABLE IF NOT EXISTS `reviews` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '评价ID',
  `order_id` INT NOT NULL COMMENT '关联订单ID',
  `product_id` INT NOT NULL COMMENT '被评价商品ID',
  `reviewer_id` INT NOT NULL COMMENT '评价人(买家)ID',
  `reviewee_id` INT NOT NULL COMMENT '被评价人(卖家)ID',
  `rating` TINYINT NOT NULL DEFAULT 5 COMMENT '评分 1-5 星',
  `content` VARCHAR(200) NOT NULL DEFAULT '' COMMENT '评价内容',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '评价时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_order` (`order_id`),
  KEY `idx_product` (`product_id`),
  KEY `idx_reviewer` (`reviewer_id`),
  KEY `idx_reviewee` (`reviewee_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单评价表(一单一评，买家评卖家)'
"""

# ---------------- products 商品主表（全新环境由本脚本直接创建） ----------------
DDL['products'] = """
CREATE TABLE IF NOT EXISTS `products` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '商品ID',
  `title` VARCHAR(100) NOT NULL COMMENT '商品标题',
  `category` VARCHAR(50) DEFAULT NULL COMMENT '分类名称(历史字段)',
  `price` DECIMAL(10,2) DEFAULT NULL COMMENT '售价',
  `original_price` DECIMAL(10,2) DEFAULT NULL COMMENT '原价',
  `condition` VARCHAR(50) DEFAULT NULL COMMENT '成色',
  `description` TEXT COMMENT '商品描述',
  `image` VARCHAR(500) DEFAULT NULL COMMENT '主图(历史单图字段)',
  `seller` VARCHAR(50) DEFAULT NULL COMMENT '卖家昵称(历史字段)',
  `location` VARCHAR(100) DEFAULT NULL COMMENT '交易地点',
  `wants` INT NOT NULL DEFAULT 0 COMMENT '想要数(= wants_base + 真实收藏数)',
  `views` INT NOT NULL DEFAULT 0 COMMENT '浏览量',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发布时间',
  `user_id` INT DEFAULT NULL COMMENT '卖家用户ID',
  `category_id` INT DEFAULT NULL COMMENT '分类ID',
  `status` VARCHAR(16) NOT NULL DEFAULT '在售' COMMENT '在售/已售出/已下架',
  `wants_base` INT NOT NULL DEFAULT 0 COMMENT '历史想要数基数',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='商品表'
"""

# ---------------- products 表需要补充的字段（用于升级历史库） ----------------
PRODUCT_COLUMNS = {
    'user_id': "ALTER TABLE `products` ADD COLUMN `user_id` INT DEFAULT NULL COMMENT '卖家用户ID'",
    'category_id': "ALTER TABLE `products` ADD COLUMN `category_id` INT DEFAULT NULL COMMENT '分类ID'",
    'status': "ALTER TABLE `products` ADD COLUMN `status` VARCHAR(16) NOT NULL DEFAULT '在售' COMMENT '在售/已售出/已下架'",
    'wants_base': "ALTER TABLE `products` ADD COLUMN `wants_base` INT NOT NULL DEFAULT 0 COMMENT '历史想要数基数'",
}

# ---------------- 外键（数据迁移完成后再加，失败不阻塞） ----------------
FOREIGN_KEYS = [
    ("product_images", "fk_pi_product",
     "ALTER TABLE `product_images` ADD CONSTRAINT `fk_pi_product` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE"),
    ("favorites", "fk_fav_user",
     "ALTER TABLE `favorites` ADD CONSTRAINT `fk_fav_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE"),
    ("favorites", "fk_fav_product",
     "ALTER TABLE `favorites` ADD CONSTRAINT `fk_fav_product` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE"),
    ("orders", "fk_order_product",
     "ALTER TABLE `orders` ADD CONSTRAINT `fk_order_product` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE"),
    ("orders", "fk_order_buyer",
     "ALTER TABLE `orders` ADD CONSTRAINT `fk_order_buyer` FOREIGN KEY (`buyer_id`) REFERENCES `users`(`id`) ON DELETE CASCADE"),
    ("orders", "fk_order_seller",
     "ALTER TABLE `orders` ADD CONSTRAINT `fk_order_seller` FOREIGN KEY (`seller_id`) REFERENCES `users`(`id`) ON DELETE CASCADE"),
    ("messages", "fk_msg_sender",
     "ALTER TABLE `messages` ADD CONSTRAINT `fk_msg_sender` FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON DELETE CASCADE"),
    ("messages", "fk_msg_receiver",
     "ALTER TABLE `messages` ADD CONSTRAINT `fk_msg_receiver` FOREIGN KEY (`receiver_id`) REFERENCES `users`(`id`) ON DELETE CASCADE"),
    ("messages", "fk_msg_product",
     "ALTER TABLE `messages` ADD CONSTRAINT `fk_msg_product` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE SET NULL"),
    ("reviews", "fk_review_order",
     "ALTER TABLE `reviews` ADD CONSTRAINT `fk_review_order` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE"),
    ("reviews", "fk_review_product",
     "ALTER TABLE `reviews` ADD CONSTRAINT `fk_review_product` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE CASCADE"),
    ("reviews", "fk_review_reviewer",
     "ALTER TABLE `reviews` ADD CONSTRAINT `fk_review_reviewer` FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`) ON DELETE CASCADE"),
    ("reviews", "fk_review_reviewee",
     "ALTER TABLE `reviews` ADD CONSTRAINT `fk_review_reviewee` FOREIGN KEY (`reviewee_id`) REFERENCES `users`(`id`) ON DELETE CASCADE"),
    ("products", "fk_product_user",
     "ALTER TABLE `products` ADD CONSTRAINT `fk_product_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL"),
    ("products", "fk_product_category",
     "ALTER TABLE `products` ADD CONSTRAINT `fk_product_category` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE SET NULL"),
]


def log(msg):
    print(msg, flush=True)


def ensure_database():
    """数据库不存在时自动创建；已存在则跳过。
    这一步不能带 database 参数连接，否则库不存在会直接抛 1049 Unknown database。"""
    if not re.match(r'^[\w$]+$', DB_NAME):
        raise SystemExit('  x 数据库名不合法：%r（只允许字母、数字、下划线）' % DB_NAME)

    cfg = {k: v for k, v in DB_CONFIG.items() if k != 'database'}
    conn = pymysql.connect(**cfg)
    try:
        with conn.cursor() as cur:
            cur.execute(
                'CREATE DATABASE IF NOT EXISTS `%s` '
                'DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci' % DB_NAME
            )
        conn.commit()
    finally:
        conn.close()


def column_exists(cur, table, column):
    cur.execute(
        "SELECT COUNT(*) AS n FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s AND COLUMN_NAME=%s",
        (DB_CONFIG['database'], table, column),
    )
    return cur.fetchone()['n'] > 0


def constraint_exists(cur, table, name):
    cur.execute(
        "SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS "
        "WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s AND CONSTRAINT_NAME=%s",
        (DB_CONFIG['database'], table, name),
    )
    return cur.fetchone()['n'] > 0


def ensure_schema(conn, verbose=True):
    """建库之后的全部结构初始化：建表 / 补字段 / 分类 / 历史数据 / wants / 外键。
    幂等，可重复调用；app.py 首次启动时会自动调用它。"""
    cur = conn.cursor()
    say = log if verbose else (lambda *_args, **_kw: None)

    # ---------- 1. 建表 ----------
    say('【1/4】创建数据表')
    for name in TABLES:
        cur.execute(DDL[name])
        say('  √ %s' % name)

    # ---------- 2. products 补字段 ----------
    say('【2/4】products 表补充新字段')
    for col, sql in PRODUCT_COLUMNS.items():
        if column_exists(cur, 'products', col):
            say('  - products.%s 已存在，跳过' % col)
        else:
            cur.execute(sql)
            say('  √ 新增 products.%s' % col)

    # ---------- 3. 分类 ----------
    say('【3/4】初始化商品分类')
    for i, name in enumerate(CATEGORIES):
        cur.execute(
            "INSERT INTO `categories` (`name`, `sort_order`) VALUES (%s, %s) "
            "ON DUPLICATE KEY UPDATE `sort_order` = VALUES(`sort_order`)",
            (name, i),
        )
    say('  √ 分类 %d 个' % len(CATEGORIES))
    conn.commit()

    # ---------- 4. 历史商品数据 ----------
    say('【4/4】迁移历史商品数据')
    cur.execute("SELECT `id`, `category`, `image` FROM `products`")
    products = cur.fetchall()

    cur.execute("SELECT `id`, `name` FROM `categories`")
    cat_map = {r['name']: r['id'] for r in cur.fetchall()}

    fixed_cat, added_img = 0, 0
    for p in products:
        sets, args = [], []
        cat_id = cat_map.get(p['category'])
        cur.execute("SELECT `category_id`, `status` FROM `products` WHERE `id` = %s", (p['id'],))
        cur_row = cur.fetchone()
        if cat_id and not cur_row['category_id']:
            sets.append('`category_id` = %s')
            args.append(cat_id)
            fixed_cat += 1
        if not cur_row['status']:
            sets.append("`status` = '在售'")
        if sets:
            args.append(p['id'])
            cur.execute('UPDATE `products` SET ' + ', '.join(sets) + ' WHERE `id` = %s', args)

        # 老的单图字段 → product_images
        if p['image']:
            url = p['image'] if p['image'].startswith('/') else '/' + p['image'].lstrip('./')
            cur.execute(
                "SELECT COUNT(*) AS n FROM `product_images` WHERE `product_id` = %s", (p['id'],))
            if cur.fetchone()['n'] == 0:
                cur.execute(
                    "INSERT INTO `product_images` (`product_id`, `image_url`, `sort_order`) "
                    "VALUES (%s, %s, 0)", (p['id'], url))
                added_img += 1

    say('  共 %d 件商品：补分类 %d 件、迁移图片 %d 张'
        % (len(products), fixed_cat, added_img))

    # ---------- 5. 重算 wants（历史基数 + 真实收藏数） ----------
    say('【5/5】重算"想要"数量（修复刷新无限累加）')
    cur.execute("UPDATE `products` SET `wants_base` = `wants` "
                "WHERE `wants_base` = 0 AND `wants` > 0")
    cur.execute(
        "UPDATE `products` p SET p.`wants` = p.`wants_base` + "
        "(SELECT COUNT(*) FROM `favorites` f WHERE f.`product_id` = p.`id` AND f.`type` = 'want')"
    )
    say('  √ wants = wants_base + favorites 实时计数')

    # ---------- 外键 ----------
    say('【外键】尝试建立外键约束（失败仅提示，不影响功能）')
    for table, name, sql in FOREIGN_KEYS:
        if constraint_exists(cur, table, name):
            continue
        try:
            cur.execute(sql)
            say('  √ %s.%s' % (table, name))
        except Exception as e:
            say('  ! %s.%s 建立失败：%s' % (table, name, e))

    conn.commit()
    cur.close()


def main():
    log('【0/5】检查数据库')
    ensure_database()
    log('  √ 数据库 %s 就绪' % DB_NAME)

    conn = pymysql.connect(**DB_CONFIG)
    try:
        ensure_schema(conn, verbose=True)

        cur = conn.cursor()
        log('-' * 56)
        for t in TABLES:
            cur.execute('SELECT COUNT(*) AS n FROM `%s`' % t)
            log('  %-16s %d 行' % (t, cur.fetchone()['n']))
        log('-' * 56)
        cur.close()
        log('迁移完成。本项目不预置账号，请在前端「注册」页自行创建。')
    finally:
        conn.close()


if __name__ == '__main__':
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
