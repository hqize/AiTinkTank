# config/path_config.py

"""
    路径配置：统一解析项目内路径

    约定：
    - 环境变量里配置的**相对路径**，一律以 `backend/` 目录为基准解析，
      而不是以进程启动时的 CWD 为基准。
      这样无论从仓库根目录、backend 目录，还是 IDE 里启动服务，
      落盘位置都稳定一致。
    - 绝对路径（如 D:\\xxx、/data/xxx）原样使用。
"""

import os
from pathlib import Path

# backend/ 目录（本文件位于 backend/config/ 下）
BACKEND_DIR: Path = Path(__file__).resolve().parents[1]


def resolve_backend_path(raw_path: str | os.PathLike | None, default: str) -> Path:
    """
        把配置项解析成绝对路径。

        :param raw_path: 环境变量里的原始值，可为空
        :param default: 原始值为空时使用的默认值（相对路径，按 backend/ 解析）
        :return: 绝对路径（不要求路径已存在）
    """
    value = str(raw_path).strip() if raw_path is not None else ""
    if not value:
        value = default

    path = Path(value).expanduser()
    if not path.is_absolute():
        # 相对路径统一锚定在 backend/ 下，避免受 CWD 影响
        path = BACKEND_DIR / path
    return path


def get_data_root_dir(create: bool = True) -> Path:
    """
        获取上传文件的落盘根目录。

        由环境变量 DATA_BASED_ROOT_DIR 控制，默认 `./out`，
        即：backend/out。实际文件路径为 backend/out/YYYYMMDD/<task_id>/<文件名>。

        :param create: 是否在目录不存在时自动创建
        :return: 数据根目录的绝对路径
    """
    data_root_dir = resolve_backend_path(os.getenv("DATA_BASED_ROOT_DIR"), "./out")
    if create:
        data_root_dir.mkdir(parents=True, exist_ok=True)
    return data_root_dir
