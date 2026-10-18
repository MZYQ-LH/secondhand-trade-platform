# -*- coding: utf-8 -*-
"""config.py —— 项目统一配置入口
========================================================================
职责：
  1) 加载项目根目录下的 .env（已存在的真实环境变量优先，不会被覆盖）
  2) 把数据库 / 服务配置集中在一处导出，供 app.py、db_migrate.py、
     db_indexes.py 共用，避免三个文件各写一份连接参数而分叉

优先级：真实环境变量  >  .env 文件  >  本文件里的默认值

依赖说明：
  requirements.txt 已包含 python-dotenv；若未安装，会自动退回内置的
  简易 .env 解析（支持 # 注释、KEY=VALUE、成对引号），功能不受影响。
========================================================================
"""
import os

import pymysql

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_FILE = os.path.join(BASE_DIR, '.env')


def load_dotenv(path=None):
    """读取 .env 并写入环境变量。返回是否读到文件。"""
    path = path or ENV_FILE
    if not os.path.isfile(path):
        return False

    try:
        from dotenv import load_dotenv as _dotenv_load
        _dotenv_load(path, override=False)
        return True
    except ImportError:
        pass

    # 内置兜底解析：不依赖任何第三方库
    with open(path, 'r', encoding='utf-8-sig') as fp:
        for raw in fp:
            line = raw.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, value = line.partition('=')
            key = key.strip()
            value = value.strip()
            if not key:
                continue
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
                value = value[1:-1]
            os.environ.setdefault(key, value)
    return True


DOTENV_LOADED = load_dotenv()


def env(name, default=''):
    return os.environ.get(name, default)


def env_int(name, default):
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def env_bool(name, default=False):
    raw = os.environ.get(name)
    if raw is None or raw == '':
        return default
    return raw.strip().lower() in ('1', 'true', 'yes', 'on')


# ==================== 数据库 ====================
DB_NAME = env('XQ_DB_NAME', 'xq_secondhand')
DB_HOST = env('XQ_DB_HOST', '127.0.0.1')
DB_PORT = env_int('XQ_DB_PORT', 3306)
DB_USER = env('XQ_DB_USER', 'root')
DB_PASSWORD = env('XQ_DB_PASSWORD', '')


def db_config(with_database=True):
    """pymysql.connect 参数。建库阶段必须 with_database=False。"""
    cfg = {
        'host': DB_HOST,
        'port': DB_PORT,
        'user': DB_USER,
        'password': DB_PASSWORD,
        'charset': 'utf8mb4',
        'cursorclass': pymysql.cursors.DictCursor,
    }
    if with_database:
        cfg['database'] = DB_NAME
    return cfg


DB_CONFIG = db_config()

# ==================== 服务 ====================
HOST = env('XQ_HOST', '127.0.0.1')
PORT = env_int('XQ_PORT', 5000)
DEBUG = env_bool('FLASK_DEBUG', False)
SECRET_KEY = env('XQ_SECRET_KEY', '')
DB_POOL_SIZE = env_int('XQ_DB_POOL_SIZE', 20)