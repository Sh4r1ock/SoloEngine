from typing import List, Dict, Any, Optional


class MessageBlockExtractor:

    @staticmethod
    def extract_text_content(data: List[Dict[str, Any]],
                            include_content_type: bool = True,
                            default: str = "") -> str:
        content_parts = []
        for block in data:
            block_type = block.get("type")
            if block_type == "text":
                content_parts.append(block.get("text", ""))
            elif block_type == "content" and include_content_type:
                content_parts.append(block.get("content", ""))
        return "\n".join(content_parts) if content_parts else default

    @staticmethod
    def extract_tool_result(data: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        for block in data:
            if block.get("type") == "tool_result":
                return block
        return None
