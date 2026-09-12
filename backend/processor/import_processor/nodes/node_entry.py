import logging
from pathlib import Path

from processor.import_processor.base import BaseNode, setup_logging
from processor.import_processor.exceptions import ValidationError, StateFieldError
from processor.import_processor.state import ImportGraphState


class NodeEntry(BaseNode):
    """
        入口节点：任务分发
    """

    name = "node_entry"

    def process(self, state: ImportGraphState):

        """
        1.  **接收状态**: 获取 `import_file_path`。
        2.  **判断类型**: 检查文件后缀是 `.pdf` 还是 `.md`。
        3.  **设置标记**: 更新 state 中的 `is_pdf_read_enabled/pdf_path` 或 `is_md_read_enabled/md_path`，供主图路由使用。
        4.  **提取标题**: 从文件名中提取 `file_title`，后续作为元数据。
        :param state:
        :return: `is_pdf_read_enabled/pdf_path` 或 `is_md_read_enabled/md_path` 、`file_title`
        """

        # 1. 获取上文的文件
        import_file_path = state.get('import_file_path', '')

        # 2. 判断
        if not import_file_path:
            raise StateFieldError(node_name=self.name, field_name='import_file_path', expected_type=str)

        # 3. Path标准化
        import_file_path_obj = Path(import_file_path)

        # 4. 判断
        if not import_file_path_obj.exists():
            raise StateFieldError(node_name=self.name, field_name='import_file_path_obj', expected_type=Path)

        # 5. 获取文件的后缀
        if import_file_path_obj.suffix == '.pdf':
            state['is_pdf_read_enabled'] = True
            state['pdf_path'] = import_file_path
        elif import_file_path_obj.suffix == '.md':
            state['is_md_read_enabled'] = True
            state['md_path'] = import_file_path
        else:
            self.logger.error(f"该文件后缀格式{import_file_path_obj.suffix}不支持")
            raise ValidationError(message=f"该文件的后缀格式{import_file_path_obj.suffix}不支持", node_name=self.name)

        # 6. 获取上传文件的标题，更新到state中
        state['file_title'] = import_file_path_obj.stem

        # 7. 返回state
        return state


if __name__ == "__main__":
    setup_logging()

    init_state = {
        "import_file_path": str(
            Path(__file__).resolve().parents[3] / "doc" / "hak180产品安全手册.pdf"
        )
    }

    node_entry = NodeEntry()
    result = node_entry(init_state)
    print(result)
    logging.getLogger(__name__).info(result)
