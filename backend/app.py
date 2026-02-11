from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from frontend_interaction.save_service.flow_saver import FlowSaver

app = FastAPI(title="Agentic Flow Save Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

flow_saver = FlowSaver()

class SaveFlowRequest(BaseModel):
    project_name: str
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]

class SaveFlowResponse(BaseModel):
    code: int
    message: str
    data: Optional[Dict[str, Any]] = None

class FlowListResponse(BaseModel):
    code: int
    message: str
    data: List[Dict[str, Any]]

class FlowResponse(BaseModel):
    code: int
    message: str
    data: Optional[Dict[str, Any]] = None

@app.get("/")
async def root():
    return {"message": "Agentic Flow Save Service API"}

@app.get("/health")
async def health():
    return {"status": "healthy"}

@app.post("/api/v1/save-flow", response_model=SaveFlowResponse)
async def save_flow(request: SaveFlowRequest):
    try:
        flow_data = flow_saver.save_flow(request.project_name, request.nodes, request.edges)
        return SaveFlowResponse(
            code=200,
            message="saved",
            data=flow_data
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/flows", response_model=FlowListResponse)
async def list_flows():
    try:
        flows = flow_saver.list_flows()
        return FlowListResponse(
            code=200,
            message="success",
            data=flows
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/flows/{project_name}", response_model=FlowResponse)
async def get_flow(project_name: str):
    try:
        flow_data = flow_saver.load_flow(project_name)
        if flow_data is None:
            raise HTTPException(status_code=404, detail=f"Flow '{project_name}' not found")
        return FlowResponse(
            code=200,
            message="success",
            data=flow_data
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/v1/flows/{project_name}", response_model=FlowResponse)
async def delete_flow(project_name: str):
    try:
        deleted = flow_saver.delete_flow(project_name)
        if not deleted:
            raise HTTPException(status_code=404, detail=f"Flow '{project_name}' not found")
        return FlowResponse(
            code=200,
            message="deleted",
            data={"project_name": project_name}
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8901, reload=True)
