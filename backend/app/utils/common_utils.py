def make_cache_key(user_id, agentic_flow_id, session_id, run_project_id):
    return f"{user_id}:{agentic_flow_id}:{session_id}:{run_project_id}"
