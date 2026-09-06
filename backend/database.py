import os
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / ".env")
from typing import Any

import psycopg
from psycopg.rows import dict_row


ISSUE_COLUMNS = """
	id,
	title,
	description,
	category,
	location,
	reporter_name,
	status,
	created_at
"""

USER_COLUMNS = """
	id,
	email,
	password_hash,
	role,
	created_at
"""


def get_connection() -> psycopg.Connection:
	"""Open a database connection using the environment configuration."""
	database_url = os.getenv("DATABASE_URL")
	if not database_url:
		raise RuntimeError("DATABASE_URL is not configured")
	return psycopg.connect(database_url, row_factory=dict_row)


def initialize_database() -> None:
	"""Create the application tables when the database is available."""
	create_table_sql = """
		CREATE TABLE IF NOT EXISTS issues (
			id BIGSERIAL PRIMARY KEY,
			title TEXT NOT NULL,
			description TEXT NOT NULL,
			category TEXT NOT NULL CHECK (
				category IN (
					'Electricity', 'Water', 'Facilities',
					'Sanitation', 'Security', 'Other'
				)
			),
			location TEXT NOT NULL,
			reporter_name TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'Pending' CHECK (
				status IN ('Pending', 'In Progress', 'Resolved')
			),
			created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	"""
	create_users_table_sql = """
		CREATE TABLE IF NOT EXISTS users (
			id BIGSERIAL PRIMARY KEY,
			email TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
			created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	"""
	with get_connection() as connection:
		with connection.cursor() as cursor:
			cursor.execute(create_table_sql)
			cursor.execute(create_users_table_sql)


def get_user_by_email(email: str) -> dict[str, Any] | None:
	query = f"SELECT {USER_COLUMNS} FROM users WHERE email = %s"
	with get_connection() as connection:
		with connection.cursor() as cursor:
			cursor.execute(query, (email,))
			return cursor.fetchone()


def get_user_by_id(user_id: int) -> dict[str, Any] | None:
	query = f"SELECT {USER_COLUMNS} FROM users WHERE id = %s"
	with get_connection() as connection:
		with connection.cursor() as cursor:
			cursor.execute(query, (user_id,))
			return cursor.fetchone()


def create_issue(issue_data: dict[str, Any]) -> dict[str, Any]:
	query = f"""
		INSERT INTO issues
			(title, description, category, location, reporter_name)
		VALUES (%s, %s, %s, %s, %s)
		RETURNING {ISSUE_COLUMNS}
	"""
	values = (
		issue_data["title"],
		issue_data["description"],
		issue_data["category"],
		issue_data["location"],
		issue_data["reporter_name"],
	)
	with get_connection() as connection:
		with connection.cursor() as cursor:
			cursor.execute(query, values)
			return cursor.fetchone()


def get_issues(category: str | None = None, status: str | None = None) -> list[dict[str, Any]]:
	conditions = []
	values = []
	if category is not None:
		conditions.append("category = %s")
		values.append(category)
	if status is not None:
		conditions.append("status = %s")
		values.append(status)

	where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
	query = f"""
		SELECT {ISSUE_COLUMNS}
		FROM issues
		{where_clause}
		ORDER BY created_at DESC, id DESC
	"""
	with get_connection() as connection:
		with connection.cursor() as cursor:
			cursor.execute(query, values)
			return cursor.fetchall()


def get_issue(issue_id: int) -> dict[str, Any] | None:
	query = f"SELECT {ISSUE_COLUMNS} FROM issues WHERE id = %s"
	with get_connection() as connection:
		with connection.cursor() as cursor:
			cursor.execute(query, (issue_id,))
			return cursor.fetchone()


def update_issue_status(issue_id: int, new_status: str) -> dict[str, Any] | None:
	query = f"""
		UPDATE issues
		SET status = %s
		WHERE id = %s
		RETURNING {ISSUE_COLUMNS}
	"""
	with get_connection() as connection:
		with connection.cursor() as cursor:
			cursor.execute(query, (new_status, issue_id))
			return cursor.fetchone()
