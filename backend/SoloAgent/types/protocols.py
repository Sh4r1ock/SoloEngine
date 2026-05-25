from typing import Protocol, Optional


class StreamCallback(Protocol):
    def __call__(self, delta: dict, agent_id: Optional[str] = None,
                 agent_name: Optional[str] = None) -> None: ...
