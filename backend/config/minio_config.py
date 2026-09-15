# config/minio_config.py

from dataclasses import dataclass
import os
from dotenv import load_dotenv

load_dotenv()

@dataclass
class MinIOConfig:
    endpoint: str
    access_key: str
    secret_key: str
    bucket_name: str
    img_dir: str

minio_config = MinIOConfig(
    endpoint=os.getenv("MINIO_ENDPOINT"),
    access_key=os.getenv("MINIO_ACCESS_KEY"),
    secret_key=os.getenv("MINIO_SECRET_KEY"),
    bucket_name=os.getenv("MINIO_BUCKET_NAME"),
    # 图片目录前缀：未配置时兜底为 images，
    # 否则拼出来的对象名会变成 "None/文档名/x.jpg"，图片URL直接是坏的
    img_dir=os.getenv("MINIO_IMG_DIR") or "images",
)