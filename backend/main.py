from contextlib import asynccontextmanager
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

import database
import storage
from auth import create_access_token, get_current_user, require_admin, verify_password
from models import ImageUploadResponse, IssueCategory, IssueCreate, IssueResponse, IssueStatus, IssueStatusUpdate, LoginRequest, TokenResponse, UserResponse


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        database.initialize_database()
    except (RuntimeError, psycopg.Error):
        # Endpoints will return a clear 503 until DATABASE_URL is configured.
        pass
    yield


app = FastAPI(title="CampusFix API", version="1.0.0", lifespan=lifespan)

# Allow local development from common static servers and direct file access.
# The deployed frontend origin can be restricted here when it is available.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5500",
        "http://localhost:8000",
        "http://localhost:8001",
        "http://localhost:8080",
        "http://127.0.0.1:5500",
        "http://127.0.0.1:8000",
        "http://127.0.0.1:8001",
        "http://127.0.0.1:8080",
        "https://campus-fix-kelcy1.vercel.app",
        "null",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["Content-Type", "Authorization"],
)

@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/auth/login", response_model=TokenResponse)
def login(login_data: LoginRequest) -> TokenResponse:
    try:
        user = database.get_user_by_email(login_data.email.strip().lower())
    except (RuntimeError, psycopg.Error):
        raise HTTPException(status_code=503, detail="Authentication is unavailable")
    if user is None or not verify_password(login_data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    try:
        return TokenResponse(access_token=create_access_token(user))
    except RuntimeError:
        raise HTTPException(status_code=503, detail="Authentication is unavailable")


@app.get("/auth/me", response_model=UserResponse)
def read_current_user(current_user: dict = Depends(get_current_user)) -> UserResponse:
    return UserResponse.model_validate(current_user)


@app.post("/issues", response_model=IssueResponse, status_code=status.HTTP_201_CREATED)
def create_issue(issue_data: IssueCreate) -> IssueResponse:
    if issue_data.image_url and not storage.is_cloudinary_image_url(issue_data.image_url):
        raise HTTPException(status_code=422, detail="Image URL is invalid")
    try:
        issue = database.create_issue(issue_data.model_dump(mode="json"))
    except (RuntimeError, psycopg.Error):
        raise HTTPException(status_code=503, detail="Database is unavailable")
    return IssueResponse.model_validate(issue)


@app.post("/uploads/images", response_model=ImageUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_image(file: UploadFile = File(...)) -> ImageUploadResponse:
    try:
        image_bytes = await file.read(storage.MAX_IMAGE_BYTES + 1)
    finally:
        await file.close()

    try:
        normalized_image, image_format = storage.validate_and_normalize_image(image_bytes)
        image_url = storage.upload_issue_image(normalized_image, image_format)
    except storage.ImageTooLargeError:
        raise HTTPException(status_code=413, detail="Image files must be 5 MB or smaller")
    except storage.ImageValidationError as error:
        raise HTTPException(status_code=422, detail=str(error))
    except storage.ImageStorageConfigurationError:
        raise HTTPException(status_code=503, detail="Image uploads are not configured")
    except storage.ImageStorageError:
        raise HTTPException(status_code=502, detail="Image upload failed")

    return ImageUploadResponse(image_url=image_url)


@app.get("/issues", response_model=list[IssueResponse])
def list_issues(
    category: IssueCategory | None = Query(default=None),
    status_filter: IssueStatus | None = Query(default=None, alias="status"),
) -> list[IssueResponse]:
    try:
        issues = database.get_issues(
            category=category.value if category else None,
            status=status_filter.value if status_filter else None,
        )
    except (RuntimeError, psycopg.Error):
        raise HTTPException(status_code=503, detail="Database is unavailable")
    return [IssueResponse.model_validate(issue) for issue in issues]


@app.get("/issues/{issue_id}", response_model=IssueResponse)
def get_issue(issue_id: int) -> IssueResponse:
    try:
        issue = database.get_issue(issue_id)
    except (RuntimeError, psycopg.Error):
        raise HTTPException(status_code=503, detail="Database is unavailable")
    if issue is None:
        raise HTTPException(status_code=404, detail="Issue not found")
    return IssueResponse.model_validate(issue)


@app.patch("/issues/{issue_id}/status", response_model=IssueResponse)
def update_issue_status(
    issue_id: int,
    status_data: IssueStatusUpdate,
    _current_user: dict = Depends(require_admin),
) -> IssueResponse:
    try:
        issue = database.update_issue_status(issue_id, status_data.status.value)
    except (RuntimeError, psycopg.Error):
        raise HTTPException(status_code=503, detail="Database is unavailable")
    if issue is None:
        raise HTTPException(status_code=404, detail="Issue not found")
    return IssueResponse.model_validate(issue)
