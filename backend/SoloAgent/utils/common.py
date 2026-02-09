# -*- coding: utf-8 -*-
"""Common utilities for SoloEngine."""

import os
import tempfile
import base64
import json
from datetime import datetime
from json_repair import repair_json
from .logging import logger


def _get_timestamp(add_random_suffix: bool = False) -> str:
    """Get the current timestamp in the format YYYY-MM-DD HH:MM:SS.sss."""
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]

    if add_random_suffix:
        # Add a random suffix to the timestamp
        timestamp += f"_{os.urandom(3).hex()}"

    return timestamp


def _save_base64_data(
    media_type: str,
    base64_data: str,
) -> str:
    """Save the base64 data to a temp file and return the file path. The
    extension is guessed from the MIME type.

    Args:
        media_type (`str`):
            The MIME type of the data, e.g. "image/png", "audio/mpeg".
        base64_data (`str):
            The base64 data to be saved.
    """
    extension = "." + media_type.split("/")[-1]

    with tempfile.NamedTemporaryFile(
        suffix=f".{extension}",
        delete=False,
    ) as temp_file:
        decoded_data = base64.b64decode(base64_data)
        temp_file.write(decoded_data)
        temp_file_path = temp_file.name

    return temp_file_path


def _json_loads_with_repair(
    json_str: str,
) -> dict:
    """The given json_str maybe incomplete, e.g. '{"key', so we need to
    repair and load it into a Python object.

    .. note::
        This function is currently only used for parsing the streaming output
        of the argument field in `tool_use`, so the parsed result must be a
        dict.

    Args:
        json_str (`str`):
            The JSON string to parse, which may be incomplete or malformed.

    Returns:
        `dict`:
            A dictionary parsed from the JSON string after repair attempts.
            Returns an empty dict if all repair attempts fail.
    """
    try:
        repaired = repair_json(json_str)
        result = json.loads(repaired)
        if isinstance(result, dict):
            return result
    except Exception:
        pass

    for i in range(len(json_str) - 1, 0, -1):
        try:
            repaired = repair_json(json_str[:i])
            result = json.loads(repaired)
            if isinstance(result, dict):
                return result
        except Exception:
            continue

    logger.warning(
        "Failed to parse JSON string `%s`. "
        "All repair attempts (original + truncation) failed. "
        "Returning empty dict.",
        json_str,
    )
    return {}