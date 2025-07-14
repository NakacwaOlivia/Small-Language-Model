from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import requests
import subprocess
import os
import uuid
from typing import Optional
import pdfplumber
from PIL import Image
import io
import base64

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL_NAME = "granite3.2:2b"  # Use Granite-Vision-3.2-2B
OLLAMA_CONTAINER_NAME = "ollama_server"

# Helper functions (unchanged)
def is_ollama_running():
    try:
        result = subprocess.run([
            "docker", "ps", "--filter", f"name={OLLAMA_CONTAINER_NAME}", "--format", "{{.Names}}"
        ], capture_output=True, text=True)
        return OLLAMA_CONTAINER_NAME in result.stdout
    except Exception:
        return False

def remove_stopped_ollama_container():
    try:
        result = subprocess.run([
            "docker", "ps", "-a", "--filter", f"name={OLLAMA_CONTAINER_NAME}", "--format", "{{.ID}}:{{.Status}}"
        ], capture_output=True, text=True)
        for line in result.stdout.strip().splitlines():
            if line:
                container_id, status = line.split(":", 1)
                if "Exited" in status or "Created" in status or "Dead" in status:
                    subprocess.run(["docker", "rm", container_id])
    except Exception:
        pass

def start_ollama_container():
    if not is_ollama_running():
        remove_stopped_ollama_container()
        docker_cmd = [
            "docker", "run", "-d", "--name", OLLAMA_CONTAINER_NAME, "-p", "11434:11434"
        ]
        import platform
        if platform.system() == "Linux":
            docker_cmd += ["--gpus", "all"]
        docker_cmd.append("ollama/ollama")
        subprocess.run(docker_cmd)
        return True
    return False

def is_model_available():
    try:
        r = requests.get("http://localhost:11434/api/tags")
        r.raise_for_status()
        tags = r.json().get("models", [])
        return any(m.get("name", "") == MODEL_NAME for m in tags)
    except Exception:
        return False

def pull_model():
    try:
        r = requests.post("http://localhost:11434/api/pull", json={"name": MODEL_NAME})
        r.raise_for_status()
        return True
    except Exception:
        return False

@app.get("/ollama/status")
def ollama_status():
    running = is_ollama_running()
    model_ready = is_model_available() if running else False
    return JSONResponse({
        "docker_running": running,
        "model_available": model_ready
    })

@app.post("/ollama/start")
def ollama_start():
    started = start_ollama_container()
    return JSONResponse({"started": started or is_ollama_running()})

@app.post("/ollama/pull_model")
def ollama_pull_model():
    if not is_ollama_running():
        return JSONResponse({"error": "Ollama container not running"}, status_code=400)
    pulled = pull_model()
    return JSONResponse({"pulled": pulled})

class ChatRequest(BaseModel):
    prompt: Optional[str] = None
    file_id: Optional[str] = None
    manual_text: Optional[str] = None  # Add manual text input

@app.post("/upload")
def upload_file(file: UploadFile = File(...)):
    file_id = str(uuid.uuid4())
    file_path = os.path.join(UPLOAD_DIR, file_id)
    with open(file_path, "wb") as f:
        f.write(file.file.read())
    return {"file_id": file_id, "filename": file.filename}

@app.post("/chat")
def chat(request: ChatRequest):
    if not is_ollama_running():
        return JSONResponse({"error": "Ollama container not running"}, status_code=400)
    if not is_model_available():
        return JSONResponse({"error": f"Model {MODEL_NAME} not available"}, status_code=400)

    prompt = request.prompt or ""
    file_content = ""
    images = []

    # Handle manual text input
    if request.manual_text and request.manual_text.strip():
        file_content = request.manual_text
        print(f"Using manual text input: {file_content[:500]}...")

    # Handle file input
    elif request.file_id:
        file_path = os.path.join(UPLOAD_DIR, request.file_id)
        if not os.path.exists(file_path):
            return JSONResponse({"error": "File not found"}, status_code=404)
        if os.path.getsize(file_path) > 10 * 1024 * 1024:  # 10MB limit
            return JSONResponse({"error": "File too large"}, status_code=400)

        if file_path.lower().endswith('.pdf'):
            try:
                with pdfplumber.open(file_path) as pdf:
                    # Try text extraction
                    extracted_text = ""
                    for page in pdf.pages:
                        text = page.extract_text()
                        if text:
                            extracted_text += text + "\n"
                    if extracted_text.strip():
                        file_content = extracted_text
                        print(f"Extracted PDF content: {file_content[:500]}...")
                    else:
                        # Convert first page to image for Granite-Vision
                        page = pdf.pages[0]
                        img = page.to_image(resolution=300).original
                        buffered = io.BytesIO()
                        img.save(buffered, format="PNG")
                        img_base64 = base64.b64encode(buffered.getvalue()).decode()
                        images.append(img_base64)
                        print("No text extracted, converted first page to image")
                        # Fallback to metadata
                        metadata = pdf.metadata
                        title = metadata.get('Title', '') or 'Unknown'
                        print(f"Metadata title: {title}")
                        file_content = f"Document metadata title: {title}"
            except Exception as e:
                print(f"PDF processing error: {str(e)}")
                return JSONResponse({"error": f"Failed to process PDF: {str(e)}"}, status_code=400)
        else:
            # Assume text file
            try:
                with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                    file_content = f.read()
                print(f"Extracted text file content: {file_content[:500]}...")
            except Exception as e:
                print(f"Text file read error: {str(e)}")
                return JSONResponse({"error": f"Failed to read file: {str(e)}"}, status_code=400)

        if not file_content.strip() and not images:
            print("No text or image extracted from file")
            return JSONResponse({"error": "No text or image could be extracted from the file"}, status_code=400)

    if not file_content.strip() and not images and not prompt.strip():
        return JSONResponse({"error": "No prompt, file, or manual text provided."}, status_code=400)

    # Construct prompt
    if file_content.strip():
        if prompt.strip():
            prompt = f"The user has uploaded a document. Document content:\n{file_content}\n\nUser message: {prompt}"
        else:
            prompt = f"The user has uploaded a document. Document content:\n{file_content}\n\nPlease analyze this document."
    elif images:
        if prompt.strip():
            prompt = f"The user has uploaded a document image. User message: {prompt}"
        else:
            prompt = "The user has uploaded a document image. Please analyze the document content."

    # Truncate prompt to avoid exceeding context length
    max_prompt_length = 4000  # Conservative limit for Granite-Vision
    if len(prompt) > max_prompt_length:
        prompt = prompt[:max_prompt_length] + "... [Prompt truncated]"
        print(f"Truncated prompt to {max_prompt_length} characters")

    payload = {
        "model": MODEL_NAME,
        "prompt": prompt,
        "images": images,  # Include images for vision model
        "stream": False
    }
    try:
        print(f"Sending request to Ollama: {payload}")
        response = requests.post(OLLAMA_URL, json=payload, timeout=180)
        response.raise_for_status()
        data = response.json()
        print(f"Ollama response: {data}")
        return {"response": data.get("response", "")}
    except requests.exceptions.HTTPError as e:
        print(f"Ollama HTTP error: {str(e)}")
        return JSONResponse({"error": f"Ollama API error: {str(e)}"}, status_code=500)
    except requests.exceptions.RequestException as e:
        print(f"Ollama connection error: {str(e)}")
        return JSONResponse({"error": f"Failed to connect to Ollama: {str(e)}"}, status_code=500)