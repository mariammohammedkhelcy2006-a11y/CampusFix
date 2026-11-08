# CampusFix

A full-stack web application for reporting and managing campus issues. Students can submit issues, view reports, and track progress. Admins can authenticate, view all issues, and update their status.

## Main Features

- Student issue submission with title, description, category, location, and reporter name
- Optional JPEG, PNG, and WEBP issue photos stored in Cloudinary
- Public reports listing with search, category, and status filters
- Admin authentication with JWT-based login
- Admin dashboard with issue stats and status updates
- Responsive blue-black CampusFix design for desktop and mobile

## Technology Stack

- Frontend: HTML5, CSS3, JavaScript (vanilla)
- Backend: Python, FastAPI, Uvicorn
- Database: PostgreSQL (Neon)
- Authentication: JWT with Pydantic models and password hashing

## Project Structure

```
campus issue-reporting-system/
  backend/
    main.py           # FastAPI app and routes
    auth.py           # JWT authentication and password hashing
    database.py       # PostgreSQL connection and queries
    models.py         # Pydantic request/response models
    requirements.txt  # Python dependencies
    create_admin.py   # Admin account creation script
  frontend/
    index.html        # Home page and issue submission form
    reports.html      # Public reports listing with filters
    login.html        # Admin login page
    admin-dashboard.js # Admin dashboard interactions
    api/admin/        # Server-side admin session and API gateway
    server/           # Shared server-side session helpers
    style.css         # Shared CampusFix styles
    script.js         # Frontend logic and API requests
```

## Vercel Deployment

For the existing Vercel project, set **Root Directory** to `frontend`. This makes
`frontend/vercel.json` the project configuration and serves the site's existing
root-relative CSS and JavaScript assets correctly. `/control-panel` and
`/control-panel/` rewrite to the admin login page. `/admin.html` rewrites to a
serverless function that validates the secure admin session before returning
dashboard HTML.

Set `CAMPUSFIX_API_URL` in the Vercel project environment to the deployed FastAPI
base URL if it differs from the default configured by the frontend gateway.

The admin login uses a Secure, HttpOnly, SameSite=Lax cookie. Admin report
requests pass through Vercel functions, which validate the session with the
backend before proxying to the existing admin-protected API endpoints.

## Installation

1. Clone the repository.
2. Install backend dependencies:

```bash
cd backend
pip install -r requirements.txt
```

## Configuration

1. Copy `.env.example` to `.env` in the project root.
2. Fill in the values:

- `DATABASE_URL`: your Neon PostgreSQL connection string
- `JWT_SECRET_KEY`: a strong random secret for JWT signing
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`: credentials from your Cloudinary account, required for photo uploads

Do not commit `.env` to version control. Photo uploads return a temporary service-unavailable response until all three Cloudinary variables are configured in the backend environment.

## Starting the Backend

```bash
cd backend
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

The API will be available at `http://127.0.0.1:8000`.

## Starting the Frontend

Open the `frontend/` folder with a static web server. For example:

```bash
# Python 3
cd frontend
python -m http.server 5500
```

Then open `http://localhost:5500` in your browser.

## Admin Account

Create an admin account using the provided script:

```bash
cd backend
python create_admin.py
```

You will be prompted to enter an admin email and password. The password is never stored in plain text.

## API Routes

- `GET /health` - Health check
- `POST /auth/login` - Admin login, returns JWT
- `GET /auth/me` - Get current authenticated user
- `POST /issues` - Submit a new issue (public)
- `POST /uploads/images` - Validate and store a JPEG, PNG, or WEBP photograph (maximum 5 MB)
- `GET /issues` - List all issues (public)
- `GET /issues/{id}` - Get a single issue (public)
- `PATCH /issues/{id}/status` - Update issue status (admin only)

## License

This project is provided as-is for educational and demonstration purposes.
