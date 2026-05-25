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

    @staticmethod
    def extract_assistant_blocks(data: List[Dict[str, Any]]) -> Dict[str, Any]:
        content_blocks = []
        thinking_content = []
        tool_calls = []

        for block in data:
            block_type = block.get("type")
            if block_type == "text":
                content_blocks.append(block)
            elif block_type == "thinking":
                thinking_content.append(block.get("thinking", ""))
            elif block_type == "tool_calls":
                tool_calls.extend(block.get("tool_calls", []))
            elif block_type == "content":
                content_blocks.append({"type": "text", "text": block.get("content", "")})

        return {
            "content_blocks": content_blocks,
            "thinking_content": thinking_content,
            "tool_calls": tool_calls
        }
