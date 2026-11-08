import asyncio
import os
import unittest
from datetime import datetime, timezone
from io import BytesIO
from unittest import mock

from fastapi import HTTPException
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


if __name__ == "__main__":
    unittest.main()
