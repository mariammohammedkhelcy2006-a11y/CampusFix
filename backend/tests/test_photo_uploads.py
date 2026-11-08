import asyncio
import os
import unittest
from datetime import datetime, timezone
from io import BytesIO
from unittest import mock

from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image
from starlette.datastructures import Headers, UploadFile

import database
import main
import storage
from models import IssueCreate


def make_image_bytes(image_format: str) -> bytes:
    image_bytes = BytesIO()
    Image.new("RGB", (20, 20), color="navy").save(image_bytes, format=image_format)
    return image_bytes.getvalue()


def make_upload_file(image_format: str = "PNG") -> UploadFile:
    image_bytes = make_image_bytes(image_format)
    content_type = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}[image_format]
    return UploadFile(file=BytesIO(image_bytes), filename="untrusted-name.jpg", headers=Headers({"content-type": content_type}))


class ImageValidationTests(unittest.TestCase):
    def test_valid_jpeg_png_and_webp_are_normalized(self):
        for image_format, extension in (("JPEG", "jpg"), ("PNG", "png"), ("WEBP", "webp")):
            with self.subTest(image_format=image_format):
                image_bytes, actual_extension = storage.validate_and_normalize_image(make_image_bytes(image_format))
                self.assertTrue(image_bytes)
                self.assertEqual(actual_extension, extension)

    def test_oversized_file_is_rejected_before_image_decoding(self):
        with self.assertRaises(storage.ImageTooLargeError):
            storage.validate_and_normalize_image(b"0" * (storage.MAX_IMAGE_BYTES + 1))

    def test_unsupported_gif_is_rejected(self):
        with self.assertRaises(storage.ImageValidationError):
            storage.validate_and_normalize_image(make_image_bytes("GIF"))

    def test_non_image_bytes_disguised_as_a_jpeg_are_rejected(self):
        with self.assertRaises(storage.ImageValidationError):
            storage.validate_and_normalize_image(b"This is not an image file")


class ImageUploadEndpointTests(unittest.TestCase):
    def test_valid_jpeg_png_and_webp_uploads_return_cloudinary_urls(self):
        for image_format in ("JPEG", "PNG", "WEBP"):
            with self.subTest(image_format=image_format):
                upload_file = make_upload_file(image_format)
                expected_url = f"https://res.cloudinary.com/campusfix-test/image/upload/v1/campusfix/issues/photo.{storage.IMAGE_FORMATS[image_format]}"
                with mock.patch.object(storage, "upload_issue_image", return_value=expected_url) as upload:
                    response = asyncio.run(main.upload_image(upload_file))

                self.assertEqual(response.image_url, expected_url)
                upload.assert_called_once()

    def test_oversized_upload_returns_413(self):
        upload_file = UploadFile(file=BytesIO(b"0" * (storage.MAX_IMAGE_BYTES + 1)), filename="large.jpg")
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(main.upload_image(upload_file))

        self.assertEqual(raised.exception.status_code, 413)

    def test_disguised_non_image_upload_returns_422(self):
        upload_file = UploadFile(file=BytesIO(b"not actually a JPEG"), filename="photo.jpg")
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(main.upload_image(upload_file))

        self.assertEqual(raised.exception.status_code, 422)

    def test_storage_failure_returns_a_safe_502_response(self):
        upload_file = make_upload_file("JPEG")
        with mock.patch.object(storage, "upload_issue_image", side_effect=storage.ImageStorageError("provider failure")):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(main.upload_image(upload_file))

        self.assertEqual(raised.exception.status_code, 502)
        self.assertEqual(raised.exception.detail, "Image upload failed")

    def test_missing_cloudinary_configuration_returns_503(self):
        upload_file = make_upload_file("WEBP")
        with mock.patch.object(storage, "upload_issue_image", side_effect=storage.ImageStorageConfigurationError("missing")):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(main.upload_image(upload_file))

        self.assertEqual(raised.exception.status_code, 503)


class IssueImageIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.issue = {
            "id": 1,
            "title": "Broken light",
            "description": "The light is out.",
            "category": "Electricity",
            "location": "Library",
            "reporter_name": "Student",
            "image_url": None,
            "status": "Pending",
            "created_at": datetime.now(timezone.utc),
        }

    def test_report_submission_without_an_image_remains_supported(self):
        with mock.patch.object(main.database, "create_issue", return_value=self.issue) as create_issue:
            response = main.create_issue(IssueCreate(title="Broken light", description="The light is out.", category="Electricity", location="Library", reporter_name="Student"))

        self.assertIsNone(response.image_url)
        self.assertIsNone(create_issue.call_args.args[0]["image_url"])

    def test_report_submission_with_a_cloudinary_image_url_is_stored(self):
        image_url = "https://res.cloudinary.com/campusfix-test/image/upload/v1/campusfix/issues/photo.jpg"
        issue_with_image = {**self.issue, "image_url": image_url}
        with mock.patch.dict(os.environ, {"CLOUDINARY_CLOUD_NAME": "campusfix-test"}, clear=False):
            with mock.patch.object(main.database, "create_issue", return_value=issue_with_image) as create_issue:
                response = main.create_issue(IssueCreate(title="Broken light", description="The light is out.", category="Electricity", location="Library", reporter_name="Student", image_url=image_url))

        self.assertEqual(response.image_url, image_url)
        self.assertEqual(create_issue.call_args.args[0]["image_url"], image_url)

    def test_issue_retrieval_returns_the_saved_image_url(self):
        image_url = "https://res.cloudinary.com/campusfix-test/image/upload/v1/campusfix/issues/photo.webp"
        issue_with_image = {**self.issue, "image_url": image_url}
        with mock.patch.object(main.database, "get_issue", return_value=issue_with_image):
            response = main.get_issue(self.issue["id"])
        self.assertEqual(response.image_url, image_url)

        with mock.patch.object(main.database, "get_issues", return_value=[issue_with_image]):
            responses = main.list_issues(category=None, status_filter=None)
        self.assertEqual(responses[0].image_url, image_url)

    def test_non_cloudinary_image_url_is_rejected(self):
        with mock.patch.dict(os.environ, {"CLOUDINARY_CLOUD_NAME": "campusfix-test"}, clear=False):
            with self.assertRaises(HTTPException) as raised:
                main.create_issue(IssueCreate(title="Broken light", description="The light is out.", category="Electricity", location="Library", reporter_name="Student", image_url="https://example.com/untrusted.jpg"))

        self.assertEqual(raised.exception.status_code, 422)

    def test_database_initialization_uses_an_additive_image_url_migration(self):
        executed_statements = []

        class Cursor:
            def execute(self, statement):
                executed_statements.append(statement)

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

        class Connection:
            def cursor(self):
                return Cursor()

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

        with mock.patch.object(database, "get_connection", return_value=Connection()):
            database.initialize_database()

        self.assertIn("ALTER TABLE issues ADD COLUMN IF NOT EXISTS image_url TEXT", executed_statements)


class CloudinaryStorageTests(unittest.TestCase):
    def test_upload_uses_configured_credentials_and_generated_public_id(self):
        image_url = "https://res.cloudinary.com/campusfix-test/image/upload/v1/campusfix/issues/generated.jpg"
        credentials = {
            "CLOUDINARY_CLOUD_NAME": "campusfix-test",
            "CLOUDINARY_API_KEY": "test-api-key",
            "CLOUDINARY_API_SECRET": "test-api-secret",
        }
        with mock.patch.dict(os.environ, credentials, clear=False):
            with mock.patch.object(storage.cloudinary, "config") as configure:
                with mock.patch.object(storage.cloudinary.uploader, "upload", return_value={"secure_url": image_url}) as upload:
                    returned_url = storage.upload_issue_image(make_image_bytes("JPEG"), "jpg")

        self.assertEqual(returned_url, image_url)
        configure.assert_called_once_with(
            cloud_name="campusfix-test",
            api_key="test-api-key",
            api_secret="test-api-secret",
            secure=True,
        )
        upload_options = upload.call_args.kwargs
        self.assertEqual(upload_options["resource_type"], "image")
        self.assertEqual(upload_options["folder"], "campusfix/issues")
        self.assertTrue(upload_options["public_id"])
        self.assertIs(upload_options["overwrite"], False)
        self.assertIs(upload_options["unique_filename"], False)
        self.assertIs(upload_options["use_filename"], False)

    def test_cloudinary_provider_failure_is_reported_as_storage_error(self):
        credentials = {
            "CLOUDINARY_CLOUD_NAME": "campusfix-test",
            "CLOUDINARY_API_KEY": "test-api-key",
            "CLOUDINARY_API_SECRET": "test-api-secret",
        }
        with mock.patch.dict(os.environ, credentials, clear=False):
            with mock.patch.object(storage.cloudinary, "config"):
                with mock.patch.object(
                    storage.cloudinary.uploader,
                    "upload",
                    side_effect=storage.CloudinaryError("provider failure"),
                ):
                    with self.assertRaises(storage.ImageStorageError):
                        storage.upload_issue_image(make_image_bytes("JPEG"), "jpg")

    def test_delete_uses_only_managed_public_ids(self):
        image_url = "https://res.cloudinary.com/campusfix-test/image/upload/v1/campusfix/issues/0123456789abcdef0123456789abcdef.jpg"
        credentials = {
            "CLOUDINARY_CLOUD_NAME": "campusfix-test",
            "CLOUDINARY_API_KEY": "test-api-key",
            "CLOUDINARY_API_SECRET": "test-api-secret",
        }
        with mock.patch.dict(os.environ, credentials, clear=False):
            with mock.patch.object(storage.cloudinary, "config"):
                with mock.patch.object(storage.cloudinary.uploader, "destroy", return_value={"result": "ok"}) as destroy:
                    storage.delete_issue_image(image_url)

        destroy.assert_called_once_with(
            "campusfix/issues/0123456789abcdef0123456789abcdef",
            resource_type="image",
            invalidate=True,
        )

    def test_delete_rejects_unmanaged_urls_without_calling_cloudinary(self):
        with mock.patch.dict(os.environ, {"CLOUDINARY_CLOUD_NAME": "campusfix-test"}, clear=False):
            with mock.patch.object(storage.cloudinary.uploader, "destroy") as destroy:
                with self.assertRaises(storage.ImageStorageError):
                    storage.delete_issue_image(
                        "https://res.cloudinary.com/campusfix-test/image/upload/v1/campusfix/issues/untrusted.jpg"
                    )

        destroy.assert_not_called()

    def test_delete_provider_failure_is_reported(self):
        image_url = "https://res.cloudinary.com/campusfix-test/image/upload/v1/campusfix/issues/0123456789abcdef0123456789abcdef.jpg"
        credentials = {
            "CLOUDINARY_CLOUD_NAME": "campusfix-test",
            "CLOUDINARY_API_KEY": "test-api-key",
            "CLOUDINARY_API_SECRET": "test-api-secret",
        }
        with mock.patch.dict(os.environ, credentials, clear=False):
            with mock.patch.object(storage.cloudinary, "config"):
                with mock.patch.object(storage.cloudinary.uploader, "destroy", return_value=None):
                    with self.assertRaises(storage.ImageStorageError):
                        storage.delete_issue_image(image_url)

    def test_managed_public_id_is_stable_across_version_and_transform_segments(self):
        image_urls = (
            "https://res.cloudinary.com/campusfix-test/image/upload/v123/campusfix/issues/0123456789abcdef0123456789abcdef.jpg",
            "https://res.cloudinary.com/campusfix-test/image/upload/c_fill,w_300/campusfix/issues/0123456789abcdef0123456789abcdef.webp",
            "https://res.cloudinary.com/campusfix-test/image/upload/c_fill,w_300/v456/campusfix/issues/0123456789abcdef0123456789abcdef.png",
            "https://res.cloudinary.com/campusfix-test/image/upload/v789/campusfix/issues/0123456789abcdef0123456789abcdef",
        )
        with mock.patch.dict(os.environ, {"CLOUDINARY_CLOUD_NAME": "campusfix-test"}, clear=False):
            public_ids = {storage.managed_issue_image_public_id(url) for url in image_urls}

        self.assertEqual(public_ids, {"campusfix/issues/0123456789abcdef0123456789abcdef"})


class IssueDeletionDatabaseTests(unittest.TestCase):
    def test_delete_is_scoped_to_one_issue_and_detects_equivalent_shared_image_urls(self):
        executed = []
        results = [
            {"id": 42, "image_url": "https://res.cloudinary.com/campusfix-test/image/upload/v123/campusfix/issues/0123456789abcdef0123456789abcdef.jpg"},
            {"id": 42},
        ]
        reference_urls = [
            {"image_url": "https://res.cloudinary.com/campusfix-test/image/upload/c_fill,w_300/campusfix/issues/0123456789abcdef0123456789abcdef"}
        ]

        class Cursor:
            def execute(self, query, values):
                executed.append((query, values))

            def fetchone(self):
                return results.pop(0)

            def fetchall(self):
                return reference_urls

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

        class Connection:
            def cursor(self):
                return Cursor()

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

        with mock.patch.object(database, "get_connection", return_value=Connection()):
            with mock.patch.dict(os.environ, {"CLOUDINARY_CLOUD_NAME": "campusfix-test"}, clear=False):
                deleted_issue = database.delete_issue(42)

        self.assertEqual(len(executed), 3)
        self.assertIn("WHERE id = %s", executed[0][0])
        self.assertEqual(executed[0][1], (42,))
        self.assertIn("DELETE FROM issues WHERE id = %s RETURNING id", executed[1][0])
        self.assertEqual(executed[1][1], (42,))
        self.assertIn("WHERE image_url LIKE %s", executed[2][0])
        self.assertEqual(executed[2][1], ("%0123456789abcdef0123456789abcdef%",))
        self.assertTrue(deleted_issue["image_is_shared"])


class IssueDeletionEndpointTests(unittest.TestCase):
    def setUp(self):
        self.previous_overrides = main.app.dependency_overrides.copy()
        self.initialize_patch = mock.patch.object(main.database, "initialize_database")
        self.initialize_patch.start()
        self.client = TestClient(main.app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        main.app.dependency_overrides.clear()
        main.app.dependency_overrides.update(self.previous_overrides)
        self.initialize_patch.stop()

    def allow_admin(self):
        main.app.dependency_overrides[main.get_current_user] = lambda: {"id": 1, "role": "admin"}

    def test_browser_preflight_allows_delete_requests(self):
        response = self.client.options(
            "/issues/10",
            headers={
                "Origin": "https://campus-fix-kelcy1.vercel.app",
                "Access-Control-Request-Method": "DELETE",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("DELETE", response.headers["access-control-allow-methods"])

    def test_unauthenticated_delete_is_rejected(self):
        response = self.client.delete("/issues/10")
        self.assertEqual(response.status_code, 401)

    def test_non_admin_delete_is_forbidden(self):
        main.app.dependency_overrides[main.get_current_user] = lambda: {"id": 2, "role": "student"}
        response = self.client.delete("/issues/10")
        self.assertEqual(response.status_code, 403)

    def test_admin_can_delete_one_report_and_its_image(self):
        self.allow_admin()
        deleted_issue = {
            "id": 10,
            "image_url": "https://res.cloudinary.com/campusfix-test/image/upload/v1/campusfix/issues/photo.jpg",
            "image_is_shared": False,
        }
        with mock.patch.object(main.database, "delete_issue", return_value=deleted_issue) as delete_issue:
            with mock.patch.object(main.storage, "delete_issue_image") as delete_image:
                response = self.client.delete("/issues/10")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"deleted": True, "image_cleanup": "deleted"})
        delete_issue.assert_called_once_with(10)
        delete_image.assert_called_once_with(deleted_issue["image_url"])

    def test_missing_report_returns_404(self):
        self.allow_admin()
        with mock.patch.object(main.database, "delete_issue", return_value=None):
            response = self.client.delete("/issues/404")
        self.assertEqual(response.status_code, 404)

    def test_report_without_an_image_is_deleted_without_storage_cleanup(self):
        self.allow_admin()
        with mock.patch.object(
            main.database,
            "delete_issue",
            return_value={"id": 10, "image_url": None, "image_is_shared": False},
        ):
            with mock.patch.object(main.storage, "delete_issue_image") as delete_image:
                response = self.client.delete("/issues/10")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"deleted": True, "image_cleanup": "not_required"})
        delete_image.assert_not_called()

    def test_shared_image_is_not_removed(self):
        self.allow_admin()
        deleted_issue = {
            "id": 10,
            "image_url": "https://res.cloudinary.com/campusfix-test/image/upload/v1/campusfix/issues/photo.jpg",
            "image_is_shared": True,
        }
        with mock.patch.object(main.database, "delete_issue", return_value=deleted_issue):
            with mock.patch.object(main.storage, "delete_issue_image") as delete_image:
                response = self.client.delete("/issues/10")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["image_cleanup"], "shared")
        delete_image.assert_not_called()

    def test_image_cleanup_failure_does_not_hide_report_deletion(self):
        self.allow_admin()
        deleted_issue = {
            "id": 10,
            "image_url": "https://res.cloudinary.com/campusfix-test/image/upload/v1/campusfix/issues/photo.jpg",
            "image_is_shared": False,
        }
        with mock.patch.object(main.database, "delete_issue", return_value=deleted_issue):
            with mock.patch.object(main.storage, "delete_issue_image", side_effect=storage.ImageStorageError("provider failure")):
                response = self.client.delete("/issues/10")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"deleted": True, "image_cleanup": "failed"})

    def test_admin_status_update_still_works(self):
        self.allow_admin()
        issue = {
            "id": 10,
            "title": "Broken light",
            "description": "The light is out.",
            "category": "Electricity",
            "location": "Library",
            "reporter_name": "Student",
            "image_url": None,
            "status": "Resolved",
            "created_at": datetime.now(timezone.utc),
        }
        with mock.patch.object(main.database, "update_issue_status", return_value=issue) as update_status:
            response = self.client.patch("/issues/10/status", json={"status": "Resolved"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "Resolved")
        update_status.assert_called_once_with(10, "Resolved")


if __name__ == "__main__":
    unittest.main()
