from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field, field_validator


class IssueCategory(str, Enum):
	ELECTRICITY = "Electricity"
	WATER = "Water"
	FACILITIES = "Facilities"
	SANITATION = "Sanitation"
	SECURITY = "Security"
	OTHER = "Other"


class IssueStatus(str, Enum):
	PENDING = "Pending"
	IN_PROGRESS = "In Progress"
	RESOLVED = "Resolved"


class UserRole(str, Enum):
	STUDENT = "student"
	ADMIN = "admin"


def require_text(value: str) -> str:
	"""Reject blank strings and remove accidental surrounding whitespace."""
	cleaned_value = value.strip()
	if not cleaned_value:
		raise ValueError("must not be empty")
	return cleaned_value


class IssueCreate(BaseModel):
	title: str = Field(..., min_length=1)
	description: str = Field(..., min_length=1)
	category: IssueCategory
	location: str = Field(..., min_length=1)
	reporter_name: str = Field(..., min_length=1)

	_validate_text = field_validator("title", "description", "location", "reporter_name")(require_text)


class IssueResponse(BaseModel):
	id: int
	title: str
	description: str
	category: IssueCategory
	location: str
	reporter_name: str
	status: IssueStatus
	created_at: datetime


class IssueStatusUpdate(BaseModel):
	status: IssueStatus


class LoginRequest(BaseModel):
	email: str = Field(..., min_length=1)
	password: str = Field(..., min_length=1)


class UserResponse(BaseModel):
	id: int
	email: str
	role: UserRole
	created_at: datetime


class TokenResponse(BaseModel):
	access_token: str
	token_type: str = "bearer"
