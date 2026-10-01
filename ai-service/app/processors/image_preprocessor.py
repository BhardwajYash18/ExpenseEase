"""
Image preprocessing module for receipt OCR.

Applies a deterministic pipeline to improve OCR accuracy:
1. Orientation handling (auto-rotate based on EXIF)
2. Grayscale conversion
3. Contrast improvement (adaptive histogram equalization - CLAHE)
4. Noise reduction (Gaussian blur)
5. Adaptive thresholding (Otsu's method)
6. Resize if image is very large

These operations are deterministic and do not involve AI/LLM.
The preprocessed image is intended as input to Tesseract OCR.
"""

import io
import logging
from PIL import Image, ImageOps
import numpy as np

logger = logging.getLogger(__name__)

# Maximum dimension (width or height) before downscaling for OCR performance
MAX_OCR_DIMENSION = 4000


def preprocess_image(image_bytes: bytes) -> bytes:
    """
    Preprocess a receipt image for OCR.

    Args:
        image_bytes: Raw image file bytes (JPEG or PNG)

    Returns:
        Preprocessed image as PNG bytes, optimized for OCR

    Raises:
        ValueError: If the image cannot be opened or processed
    """
    try:
        # Step 1: Open image and handle EXIF orientation
        image = Image.open(io.BytesIO(image_bytes))
        image = ImageOps.exif_transpose(image)

        logger.info(
            "Preprocessing image: format=%s, size=%s, mode=%s",
            image.format, image.size, image.mode
        )

        # Step 2: Convert to grayscale
        if image.mode != 'L':
            image = image.convert('L')

        # Step 3: Resize if too large (preserves aspect ratio)
        width, height = image.size
        if max(width, height) > MAX_OCR_DIMENSION:
            ratio = MAX_OCR_DIMENSION / max(width, height)
            new_size = (int(width * ratio), int(height * ratio))
            image = image.resize(new_size, Image.Resampling.LANCZOS)
            logger.info("Resized image to %s", new_size)

        # Step 4: Convert to numpy array for OpenCV operations
        img_array = np.array(image)

        # Step 5: Contrast improvement using CLAHE
        # (Contrast Limited Adaptive Histogram Equalization)
        try:
            import cv2
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            img_array = clahe.apply(img_array)

            # Step 6: Noise reduction (light Gaussian blur)
            img_array = cv2.GaussianBlur(img_array, (3, 3), 0)

            # Step 7: Adaptive thresholding (Otsu's method)
            _, img_array = cv2.threshold(
                img_array, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
            )
        except ImportError:
            # Fallback if OpenCV is not available: use Pillow-only pipeline
            logger.warning("OpenCV not available, using Pillow-only preprocessing")
            image = Image.fromarray(img_array)
            image = ImageOps.autocontrast(image)
            img_array = np.array(image)

        # Step 8: Convert back to PIL Image and export as PNG bytes
        result_image = Image.fromarray(img_array)
        output = io.BytesIO()
        result_image.save(output, format='PNG')
        output.seek(0)

        logger.info("Preprocessing complete: output size=%d bytes", len(output.getvalue()))
        return output.getvalue()

    except Exception as e:
        logger.error("Image preprocessing failed: %s", str(e))
        raise ValueError(f"Failed to preprocess image: {str(e)}")
