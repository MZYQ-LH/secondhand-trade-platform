# -*- coding: utf-8 -*-
"""db_reviews.py —— 「订单评价」增量迁移脚本（幂等，可重复执行）
========================================================================
适用场景：
  1) 已有库 xq_secondhand（已跑过 db_migrate.py）需要单独升级出评价表 reviews；
  2) 新环境一键建表：直接执行本脚本即可（数据库不存在会自动创建）；
  3) 与 db_migrate.py 不冲突：后者负责整库迁移（已包含 reviews），
     本脚本只负责 reviews 一张表，供"只想补评价功能"的环境使用。

做法：
  - 表结构、外键定义直接复用 db_migrate.py 的 DDL['reviews'] / FOREIGN_KEYS，
    避免两处维护同一份建表语句；
  - CREATE TABLE IF NOT EXISTS + 外键存在性判断，重复执行不报错、不丢数据。

运行： python db_reviews.py
========================================================================
"""
import sys
import traceback

import pymysql

from db_migrate import DB_CONFIG, DDL, FOREIGN_KEYS, constraint_exists, log

TABLE = 'reviews'


def main():
    conn = pymysql.connect(**DB_CONFIG)
    cur = conn.cursor()
    try:
        log('=' * 60)
        log('订单评价表迁移（幂等）  数据库：%s' % DB_CONFIG['database'])
        log('=' * 60)

        # ---------- 1. 建表 ----------
        cur.execute('SHOW TABLES LIKE %s', (TABLE,))
        if cur.fetchone():
            log('【1/3】%s 表已存在，跳过建表' % TABLE)
        else:
            cur.execute(DDL[TABLE])
            log('【1/3】已创建 %s 表' % TABLE)

        # ---------- 2. 索引核对 ----------
        cur.execute('SHOW INDEX FROM `%s`' % TABLE)
        names = []
        for r in cur.fetchall():
            if r['Key_name'] not in names:
                names.append(r['Key_name'])
        log('【2/3】现有索引：%s' % ', '.join(names))

        # ---------- 3. 外键约束 ----------
        log('【3/3】外键约束（失败仅提示，不影响功能）')
        for table, name, sql in FOREIGN_KEYS:
            if table != TABLE:
                continue
            if constraint_exists(cur, table, name):
                log('  - %s.%s 已存在，跳过' % (table, name))
                continue
            try:
                cur.execute(sql)
                log('  √ %s.%s' % (table, name))
            except Exception as exc:
                log('  ! %s.%s 建立失败：%s' % (table, name, exc))
        conn.commit()

        cur.execute('SELECT COUNT(*) AS n FROM `%s`' % TABLE)
        log('-' * 60)
        log('%s 表就绪，当前 %d 行评价' % (TABLE, cur.fetchone()['n']))
        log('-' * 60)
    finally:
        cur.close()
        conn.close()


if __name__ == '__main__':
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(1)
