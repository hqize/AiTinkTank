# config/reranker_config.py

from dataclasses import dataclass
import os
from dotenv import load_dotenv

load_dotenv()

@dataclass
class RerankerConfig:
    bge_reranker_path: str # 模型本地目录，未下载时填 HuggingFace/ModelScope 模型名会自动下载
    bge_reranker_device: str # 运行设备，如 cuda:0 / cpu
    bge_reranker_fp16: bool # 是否使用半精度
    bge_reranker_batch_size: int # 推理批大小，显存不够就调小
    bge_reranker_normalize: bool # True=用 sigmoid 把分数压到 0~1

reranker_config = RerankerConfig(
    bge_reranker_path=os.getenv("BGE_RERANKER_LARGE"),
    bge_reranker_device=os.getenv("BGE_RERANKER_DEVICE"),
    # 特殊处理：将.env中的1/0转为布尔值，兼容常见的数字/字符串格式
    bge_reranker_fp16=os.getenv("BGE_RERANKER_FP16") in ("1", "True", "true", 1),
    bge_reranker_batch_size=int(os.getenv("BGE_RERANKER_BATCH_SIZE", "32")),
    bge_reranker_normalize=os.getenv("BGE_RERANKER_NORMALIZE", "1") in ("1", "True", "true", 1),
)
