

class SoloEngineException(Exception):
    is_fatal: bool = False


class WebSocketException(SoloEngineException):
    pass


class WebSocketConnectionError(WebSocketException):
    is_fatal = False


class WebSocketAuthenticationError(WebSocketException):
    is_fatal = True


class DatabaseException(SoloEngineException):
    is_fatal = True


class DatabaseConnectionError(DatabaseException):
    is_fatal = True
