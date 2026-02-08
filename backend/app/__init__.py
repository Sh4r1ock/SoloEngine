from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.v1 import projects, tools, websocket

app = FastAPI(title="Agentic AI Platform", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects.router, prefix="/api/v1", tags=["projects"])
app.include_router(tools.router, prefix="/api/v1", tags=["tools"])
app.include_router(websocket.router, prefix="/api/v1", tags=["websocket"])

@app.get("/")
async def root():
    return {"message": "Agentic AI Platform API"}

@app.get("/health")
async def health():
    return {"status": "healthy"}
