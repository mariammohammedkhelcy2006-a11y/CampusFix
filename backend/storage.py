"""Validation and Cloudinary storage for CampusFix issue photographs."""

import os
from io import BytesIO
from urllib.parse import urlparse
from uuid import uuid4

import cloudinary
import cloudinary.uploader
from cloudinary.exceptions import Error as CloudinaryError
from PIL import Image, ImageOps, UnidentifiedImageError


MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGE_PIXELS = 20_000_000
IMAGE_FORMATS = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}


class ImageValidationError(ValueError):
    """Raised when the supplied bytes are not an accepted safe image."""


class ImageTooLargeError(ImageValidationError):
    """Raised when an image exceeds a configured safety limit."""


class ImageStorageConfigurationError(RuntimeError):
    """Raised when Cloudinary credentials have not been configured."""


class ImageStorageError(RuntimeError):
    """Raised when the storage provider cannot accept an image."""


def _cloudinary_credentials() -> tuple[str, str, str]:
    cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME")
    api_key = os.getenv("CLOUDINARY_API_KEY")
    api_secret = os.getenv("CLOUDINARY_API_SECRET")
    if not all((cloud_name, api_key, api_secret)):
        raise ImageStorageConfigurationError("Cloudinary is not configured")
    return cloud_name, api_key, api_secret


def validate_and_normalize_image(image_bytes: bytes) -> tuple[bytes, str]:
    """Decode, validate, and re-encode a permitted image without metadata."""
    if not image_bytes:
        raise ImageValidationError("An image file is required")
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise ImageTooLargeError("Image files must be 5 MB or smaller")

    try:
        with Image.open(BytesIO(image_bytes)) as source_image:
            image_format = source_image.format
            if image_format not in IMAGE_FORMATS:
                raise ImageValidationError("Only JPEG, PNG, and WEBP images are allowed")

            width, height = source_image.size
            if width < 1 or height < 1 or width * height > MAX_IMAGE_PIXELS:
                raise ImageTooLargeError("Image dimensions are too large")

            source_image.verify()

        with Image.open(BytesIO(image_bytes)) as source_image:
            source_image.load()
            normalized_image = ImageOps.exif_transpose(source_image)
            if image_format == "JPEG" and normalized_image.mode not in {"RGB", "L"}:
                normalized_image = normalized_image.convert("RGB")

            normalized_bytes = BytesIO()
            save_options = {"format": image_format}
            if image_format in {"JPEG", "WEBP"}:
                save_options["quality"] = 90
            normalized_image.save(normalized_bytes, **save_options)
    except (UnidentifiedImageError, OSError, SyntaxError) as error:
        raise ImageValidationError("The uploaded file is not a valid image") from error

    normalized_data = normalized_bytes.getvalue()
    if len(normalized_data) > MAX_IMAGE_BYTES:
        raise ImageTooLargeError("Image files must be 5 MB or smaller")
    return normalized_data, IMAGE_FORMATS[image_format]


def upload_issue_image(image_bytes: bytes, image_format: str) -> str:
    """Upload a validated image to Cloudinary and return only its HTTPS URL."""
    cloud_name, api_key, api_secret = _cloudinary_credentials()
    cloudinary.config(
        cloud_name=cloud_name,
        api_key=api_key,
        api_secret=api_secret,
        secure=True,
    )

    try:
        upload_result = cloudinary.uploader.upload(
            BytesIO(image_bytes),
            resource_type="image",
            folder="campusfix/issues",
            public_id=uuid4().hex,
            overwrite=False,
            unique_filename=False,
            use_filename=False,
            format=image_format,
        )
    except (CloudinaryError, OSError) as error:
        raise ImageStorageError("Image upload failed") from error

    image_url = upload_result.get("secure_url")
    if not isinstance(image_url, str) or not is_cloudinary_image_url(image_url):
        raise ImageStorageError("Image storage returned an invalid URL")
    return image_url


def is_cloudinary_image_url(image_url: str) -> bool:
    """Accept only an HTTPS delivery URL from this application's Cloudinary cloud."""
    cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME")
    if not cloud_name:
        return False

    parsed_url = urlparse(image_url)
    path_parts = parsed_url.path.strip("/").split("/")
    return (
        parsed_url.scheme == "https"
        and parsed_url.netloc.lower() == "res.cloudinary.com"
        and len(path_parts) >= 4
        and path_parts[0] == cloud_name
        and path_parts[1:3] == ["image", "upload"]
    )
