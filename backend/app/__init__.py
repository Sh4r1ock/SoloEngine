from dotenv import load_dotenv
from pathlib import Path

env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1 import projects, tools, websocket, config, auth, agent_tools, mcp_servers, skills, debug, agentic_flows

app = FastAPI(title="Agentic AI Platform", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(agentic_flows.router)
app.include_router(projects.router, prefix="/api/v1", tags=["projects"])
app.include_router(tools.router, prefix="/api/v1", tags=["tools"])
app.include_router(config.router)
app.include_router(agent_tools.router)
app.include_router(mcp_servers.router)
app.include_router(skills.router)
app.include_router(debug.router)
app.include_router(websocket.router, prefix="/api/v1", tags=["websocket"])

@app.get("/")
async def root():
    return {"message": "Agentic AI Platform API"}

@app.get("/health")
async def health():
    return {"status": "healthy"}
