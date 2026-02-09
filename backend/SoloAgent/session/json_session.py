# -*- coding: utf-8 -*-
"""The JSON session class for SoloEngine."""
import json
import os

from .session_base import SessionBase
from ..utils.state_module import StateModule
from ..utils import logger


class JSONSession(SessionBase):
    """The JSON session class."""

    def __init__(
        self,
        session_id: str | None = None,
        save_dir: str = "./",
    ) -> None:
        """Initialize the JSON session class.

        Args:
            session_id (`str`):
                The session id, deprecated and move to the `save_session_state`
                and `load_session_state` methods to support different session
                ids.
            save_dir (`str`, defaults to `"./"`):
                The directory to save the session state.
        """
        self.save_dir = save_dir

        if session_id is not None:
            logger.warning(
                "The `session_id` argument in the JSONSession constructor is "
                "deprecated. Please pass the `session_id` to the "
                "`save_session_state` and `load_session_state` methods instead.",
            )

    def _get_save_path(self, session_id: str) -> str:
        """The path to save the session state.

        Args:
            session_id (`str`):
                The session id.

        Returns:
            `str`:
                The path to save the session state.
        """
        os.makedirs(self.save_dir, exist_ok=True)
        return os.path.join(self.save_dir, f"{session_id}.json")

    async def save_session_state(
        self,
        session_id: str,
        **state_modules_mapping: StateModule,
    ) -> None:
        """Save the session state.

        Args:
            session_id (`str`):
                The session id.
            **state_modules_mapping (`dict[str, StateModule]`):
                A dictionary mapping of state module names to their instances.
        """
        save_path = self._get_save_path(session_id)
        
        # Collect state from all modules
        state = {}
        for name, module in state_modules_mapping.items():
            if isinstance(module, StateModule):
                state[name] = module.state_dict()
            else:
                state[name] = module
        
        # Save to file
        with open(save_path, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
        
        logger.info(f"Session state saved to {save_path}")

    async def load_session_state(
        self,
        session_id: str,
        allow_not_exist: bool = True,
        **state_modules_mapping: StateModule,
    ) -> None:
        """Load the session state.

        Args:
            session_id (`str`):
                The session id.
            allow_not_exist (`bool`, defaults to `True`):
                Whether to allow the session file not to exist.
            **state_modules_mapping (`dict[str, StateModule]`):
                A dictionary mapping of state module names to their instances.
        """
        save_path = self._get_save_path(session_id)
        
        if not os.path.exists(save_path):
            if allow_not_exist:
                logger.info(f"Session file {save_path} does not exist, skipping load.")
                return
            else:
                raise FileNotFoundError(f"Session file {save_path} does not exist.")
        
        # Load from file
        with open(save_path, "r", encoding="utf-8") as f:
            state = json.load(f)
        
        # Restore state to modules
        for name, module in state_modules_mapping.items():
            if name in state:
                if isinstance(module, StateModule):
                    module.load_state_dict(state[name])
                else:
                    # For non-StateModule objects, just set the value
                    setattr(module, name, state[name])
        
        logger.info(f"Session state loaded from {save_path}")