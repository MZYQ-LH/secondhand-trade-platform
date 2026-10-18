# -*- coding: utf-8 -*-
"""热查询索引补齐脚本（幂等，可重复执行）

依据：对 app.py 中的高频查询做 EXPLAIN，只补真正缺索引的查询，
不使用 LIKE '%x%'（前后通配）这类无法走索引的场景硬套索引。

运行： python db_indexes.py        # 可选，app.py 启动时也会自动补齐
"""
import sys

import pymysql

from config import DB_CONFIG as DB

# (表名, 索引名, 列定义, EXPLAIN 依据)
INDEXES = [
    ('products', 'idx_status_id', '(`status`, `id`)',
     "商品列表默认 status<>'已下架' + ORDER BY id DESC（改造前 type=ALL 全表扫描）"),
    ('products', 'idx_category_status', '(`category_id`, `status`)',
     "分类页 category_id 等值 + status 过滤（改造前走单列索引后回表过滤）"),
    ('products', 'idx_user_status', '(`user_id`, `status`)',
     "卖家维度：TA 的商品 / 我的发布（改造前 user_id 单列索引后回表过滤 status）"),
    ('messages', 'idx_receiver_read', '(`receiver_id`, `is_read`)',
     "未读私信计数 receiver_id + is_read=0（改造前回表判断 is_read）"),
    ('messages', 'idx_sender_receiver_id', '(`sender_id`, `receiver_id`, `id`)',
     "会话双向消息按 id 升序读取（改造前 key=PRIMARY 全索引扫描）"),
]

# 经 EXPLAIN 核对后确认【不需要】新增索引的表，避免重复索引拖慢写入
SKIPPED = {
    'favorites': 'uk_user_product_type(user_id,product_id,type) + idx_product_type 已覆盖收藏/想要全部热查询（EXPLAIN 已现 Using index）',
    'orders': 'idx_buyer_id / idx_seller_id / idx_product_id 已覆盖买家、卖家、商品维度订单查询',
    'product_images': 'idx_product_id 已覆盖按商品取图；按 sort_order 排序仅影响极小结果集',
    'categories': '配置表，数据量个位数，无需索引',
    'reviews': 'uk_order(order_id) 覆盖"一单一评"去重；idx_product(product_id) 覆盖商品评价列表与平均分统计；'
               'idx_reviewer / idx_reviewee 覆盖"我发出/我收到的评价"（InnoDB 二级索引隐含主键 id，'
               'ORDER BY id DESC 可反向扫描，无需再建 (product_id,id) 组合索引）',
}


def column_exists(cur, table, column):
    cur.execute(
        "SELECT COUNT(*) AS n FROM information_schema.columns "
        "WHERE table_schema = %s AND table_name = %s AND column_name = %s",
        (DB['database'], table, column))
    return cur.fetchone()['n'] > 0


def index_exists(cur, table, index_name):
    cur.execute(
        "SELECT COUNT(*) AS n FROM information_schema.statistics "
        "WHERE table_schema = %s AND table_name = %s AND index_name = %s",
        (DB['database'], table, index_name))
    return cur.fetchone()['n'] > 0


def ensure_indexes(conn, verbose=True):
    """补齐热查询索引（幂等）。返回 (created, skipped, failed) 三个列表。
    app.py 首次启动时会自动调用；也可由 db_indexes.py 单独执行。"""
    say = print if verbose else (lambda *_a, **_k: None)
    created, skipped, failed = [], [], []

    with conn.cursor() as cur:
        for table, name, cols, why in INDEXES:
            if index_exists(cur, table, name):
                skipped.append('%s.%s' % (table, name))
                say('[跳过] %-12s %-26s 已存在' % (table, name))
                continue

            # 安全护栏：索引列必须真实存在
            col_names = [c.strip('` ') for c in cols.strip('()').split(',')]
            missing = [c for c in col_names if not column_exists(cur, table, c)]
            if missing:
                failed.append('%s.%s 缺少列 %s' % (table, name, missing))
                say('[失败] %-12s %-26s 列不存在：%s' % (table, name, missing))
                continue

            try:
                cur.execute('CREATE INDEX `%s` ON `%s` %s' % (name, table, cols))
                conn.commit()
                created.append('%s.%s -> %s' % (table, name, cols))
                say('[新增] %-12s %-26s %s' % (table, name, cols))
                say('       依据：%s' % why)
            except Exception as exc:
                conn.rollback()
                failed.append('%s.%s: %s' % (table, name, exc))
                say('[失败] %-12s %-26s %s' % (table, name, exc))

    return created, skipped, failed


def main():
    conn = pymysql.connect(**DB)
    try:
        print('=' * 68)
        print('热查询索引补齐（幂等）  数据库：%s' % DB['database'])
        print('=' * 68)

        created, skipped, failed = ensure_indexes(conn, verbose=True)

        with conn.cursor() as cur:
            print('-' * 68)
            print('索引核对（SHOW INDEX）：')
            for table, _, _, _ in INDEXES:
                try:
                    cur.execute('SHOW INDEX FROM `%s`' % table)
                    names = []
                    for r in cur.fetchall():
                        if r['Key_name'] not in names:
                            names.append(r['Key_name'])
                    print('  %-14s %s' % (table, ', '.join(names)))
                except Exception as exc:
                    print('  %-14s 读取失败：%s' % (table, exc))

            print('-' * 68)
            print('经 EXPLAIN 核对后不新增索引（避免重复索引）：')
            for table, reason in SKIPPED.items():
                print('  %-14s %s' % (table, reason))
    finally:
        conn.close()

    print('-' * 68)
    print('结果：新增 %d 个，已存在 %d 个，失败 %d 个' % (len(created), len(skipped), len(failed)))
    if failed:
        for f in failed:
            print('  失败明细：%s' % f)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())