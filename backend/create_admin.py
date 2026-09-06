"""One-time local setup tool for creating a CampusFix admin account."""

from getpass import getpass
from pathlib import Path

import psycopg
from dotenv import load_dotenv

import auth
import database


load_dotenv(Path(__file__).resolve().parents[1] / ".env")


def create_admin() -> None:
    email = input("Admin email: ").strip().lower()
    if not email:
        print("Admin email is required.")
        return

    password = getpass("Admin password: ")
    if not password:
        print("Admin password is required.")
        return

    try:
        database.initialize_database()
        if database.get_user_by_email(email) is not None:
            print("A user with that email already exists. No account was created.")
            return

        password_hash = auth.hash_password(password)
        query = """
            INSERT INTO users (email, password_hash, role)
            VALUES (%s, %s, 'admin')
            RETURNING id, email, role
        """
        with database.get_connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(query, (email, password_hash))
                created_user = cursor.fetchone()

        print(f"Admin account created successfully with role: {created_user['role']}.")
    except (RuntimeError, psycopg.Error):
        print("Admin setup failed because the database is unavailable.")


if __name__ == "__main__":
    create_admin()
