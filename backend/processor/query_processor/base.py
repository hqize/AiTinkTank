# processor/query_processor/base.py

"""
    查询流程节点基类

    定义统一的节点接口规范，提供通用功能
"""
from abc import abstractmethod, ABC
from typing import TypeVar

from tool.logger import logger
from utils.task_utils import add_done_task, add_running_task

T = TypeVar("T")  # 泛型状态类型


class NodeBase(ABC):

    name: str = "base_node"  # 节点名称，子类应覆盖

    def __call__(self, state: T) -> T:
        """
            节点执行入口

            查询流程以 session_id 作为任务标识，因此这里会同步记录节点进度：
            - is_stream=True 时，进度会通过 SSE 实时推送给前端「阶段进度」面板
            - is_stream=False 时，仅写入内存，供 /query 同步接口返回 done_list
        """
        # 状态是 dict（TypedDict），取任务标识与流式标记
        task_key = state.get("session_id") if isinstance(state, dict) else None
        is_stream = bool(state.get("is_stream")) if isinstance(state, dict) else False

        try:
            # 1. 开始准备执行节点
            logger.info(f"--- {self.name} 开始啦 ---")
            if task_key:
                add_running_task(task_key, self.name, is_stream)

            # 2. 执行节点
            result = self.process(state)

            # 3. 执行节点成功：把节点从「进行中」挪到「已完成」
            if task_key:
                add_done_task(task_key, self.name, is_stream)
            logger.info(f"--- {self.name} 完成啦 ---")

            return result

        except Exception as e:
            # 失败时不在这里清理 running 列表，由上层（query_service）统一置为 failed 时清理，
            # 这样前端能先看到「失败节点」，拿到明确的失败位置
            logger.error(f"{self.name} 执行失败: {e}")
            raise

    @abstractmethod
    def process(self, state: T) -> T:
        """
            节点核心处理逻辑
            子类必须实现此方法
            :param state: 工作流状态对象
            :return: 更新后的状态对象
        """
        pass
