from enum import Enum


class FileOperation(str, Enum):
    CREATED = "created"
    MODIFIED = "modified"
    DELETED = "deleted"


class ChangeStatus(str, Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    REVERTED = "reverted"


class ContentType(str, Enum):
    TEXT = "text"
    BINARY = "binary"
