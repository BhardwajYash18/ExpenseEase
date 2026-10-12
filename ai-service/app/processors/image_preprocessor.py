"""
Image preprocessing module for receipt OCR.

Implements the computer vision preprocessing pipeline from
'computer-vision-receipt-ocr.ipynb':
1. Orientation handling (auto-rotate based on EXIF metadata)
2. Downscale for efficient contour search
3. Receipt Contour Detection (Gaussian blur, morphological dilation, Canny edge detection, polygon approximation)
4. Perspective Warping / Deskewing (cv2.getPerspectiveTransform + cv2.warpPerspective)
5. Black & White Scanner Effect (cv2.adaptiveThreshold Gaussian local window)
6. Light gradient-preserving pipeline with CLAHE and bilateral filtering for neural OCR (RapidOCR)

These operations are deterministic and do not involve AI/LLM.
"""

import io
import logging
from typing import Optional, Tuple
from PIL import Image, ImageOps
import numpy as np

logger = logging.getLogger(__name__)

# Maximum dimension (width or height) before downscaling for OCR performance
MAX_OCR_DIMENSION = 4000
MIN_OCR_DIMENSION = 1000


def opencv_resize(image: np.ndarray, ratio: float) -> np.ndarray:
    """Resize image preserving aspect ratio according to ratio factor."""
    import cv2
    width = int(image.shape[1] * ratio)
    height = int(image.shape[0] * ratio)
    return cv2.resize(image, (width, height), interpolation=cv2.INTER_AREA)


def approximate_contour(contour) -> np.ndarray:
    """Approximate the contour by a more primitive polygon shape using Douglas-Peucker algorithm."""
    import cv2
    peri = cv2.arcLength(contour, True)
    return cv2.approxPolyDP(contour, 0.032 * peri, True)


def get_receipt_contour(contours, min_area: float = 1000.0) -> Optional[np.ndarray]:
    """
    Find 4-point rectangular contour of receipt among detected contours.
    Receipt heuristic:
    1. Expected to be among the largest contours within the image.
    2. Expected to be of a convex rectangular (4-vertex) shape.
    """
    import cv2
    largest_contours = sorted(contours, key=cv2.contourArea, reverse=True)[:10]
    for c in largest_contours:
        if cv2.contourArea(c) < min_area:
            continue
        approx = approximate_contour(c)
        if len(approx) == 4 and cv2.isContourConvex(approx):
            return approx
    return None


def contour_to_rect(contour: np.ndarray, resize_ratio: float) -> np.ndarray:
    """
    Convert 4-point contour into ordered rectangle coordinates:
    [top-left, top-right, bottom-right, bottom-left], scaled back to original image coordinates.
    """
    pts = contour.reshape(4, 2)
    rect = np.zeros((4, 2), dtype="float32")
    # top-left point has the smallest sum; bottom-right has the largest sum
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    # top-right has minimum difference; bottom-left has maximum difference
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect / resize_ratio


def wrap_perspective(img: np.ndarray, rect: np.ndarray) -> np.ndarray:
    """
    Restore receipt perspective (dewarp and deskew) to a flattened top-down scanned view.
    """
    import cv2
    (tl, tr, br, bl) = rect
    # Compute width of new perspective
    width_a = np.sqrt(((br[0] - bl[0]) ** 2) + ((br[1] - bl[1]) ** 2))
    width_b = np.sqrt(((tr[0] - tl[0]) ** 2) + ((tr[1] - tl[1]) ** 2))
    # Compute height of new perspective
    height_a = np.sqrt(((tr[0] - br[0]) ** 2) + ((tr[1] - br[1]) ** 2))
    height_b = np.sqrt(((tl[0] - bl[0]) ** 2) + ((tl[1] - bl[1]) ** 2))

    max_width = max(int(width_a), int(width_b))
    max_height = max(int(height_a), int(height_b))

    if max_width <= 20 or max_height <= 20:
        return img

    dst = np.array([
        [0, 0],
        [max_width - 1, 0],
        [max_width - 1, max_height - 1],
        [0, max_height - 1]
    ], dtype="float32")

    M = cv2.getPerspectiveTransform(rect, dst)
    return cv2.warpPerspective(img, M, (max_width, max_height))


def detect_and_warp_receipt(image_cv: np.ndarray) -> Tuple[np.ndarray, bool]:
    """
    Execute receipt contour detection and perspective restoration on an OpenCV image.
    If a clear 4-corner receipt boundary is detected on a background, deskew and crop it.
    If no reliable 4-corner contour is found, returns the unmodified image safely.
    """
    import cv2
    h, w = image_cv.shape[:2]
    if h < 50 or w < 50:
        return image_cv, False

    try:
        # Downscale for efficient contour search
        resize_ratio = 500.0 / h
        small = opencv_resize(image_cv, resize_ratio)

        # Grayscale and Gaussian blur to eliminate high-frequency noise
        if len(small.shape) == 3:
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        else:
            gray = small

        blurred = cv2.GaussianBlur(gray, (5, 5), 0)

        # Dilate with rectangular kernel to bridge text and merge receipt body
        rect_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9))
        dilated = cv2.dilate(blurred, rect_kernel)

        # Canny edge detector
        edged = cv2.Canny(dilated, 50, 125, apertureSize=3)

        # Find contours
        contours, _ = cv2.findContours(edged, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
        min_area = (small.shape[0] * small.shape[1]) * 0.08  # Must occupy at least 8% of frame
        receipt_contour = get_receipt_contour(contours, min_area=min_area)

        if receipt_contour is not None:
            rect = contour_to_rect(receipt_contour, resize_ratio)
            warped = wrap_perspective(image_cv, rect)
            logger.info("Receipt perspective warped: original %sx%s -> %sx%s", w, h, warped.shape[1], warped.shape[0])
            return warped, True
    except Exception as e:
        logger.warning("Receipt contour detection skipped or failed: %s", str(e))

    return image_cv, False


def bw_scanner(image_cv: np.ndarray) -> np.ndarray:
    """
    B&W Scanner thresholding matching 'computer-vision-receipt-ocr.ipynb'.
    Applies Gaussian adaptive local thresholding (block size 21, offset 5)
    to eliminate illumination gradients, shadows, and creases.
    """
    import cv2
    if len(image_cv.shape) == 3:
        gray = cv2.cvtColor(image_cv, cv2.COLOR_BGR2GRAY)
    else:
        gray = image_cv

    return cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 21, 5
    )


def preprocess_image(image_bytes: bytes) -> bytes:
    """
    Full Computer Vision Receipt Preprocessing Pipeline:
    1. EXIF orientation handling
    2. Contour detection & perspective warping / deskewing
    3. CLAHE contrast enhancement
    4. B&W Scanner Gaussian adaptive binarization
    """
    try:
        # Step 1: Open image and handle EXIF orientation
        image = Image.open(io.BytesIO(image_bytes))
        image = ImageOps.exif_transpose(image)

        # Convert to RGB OpenCV array
        if image.mode != 'RGB':
            image = image.convert('RGB')
        img_array = np.array(image)
        # RGB to BGR for OpenCV
        img_bgr = img_array[:, :, ::-1].copy()

        try:
            import cv2
            # Step 2: Auto-detect receipt contour and restore perspective
            warped, _ = detect_and_warp_receipt(img_bgr)

            # Step 3: Resize if too large
            h, w = warped.shape[:2]
            if max(h, w) > MAX_OCR_DIMENSION:
                ratio = MAX_OCR_DIMENSION / max(h, w)
                warped = opencv_resize(warped, ratio)

            # Step 4: Convert to grayscale and apply CLAHE contrast enhancement
            gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            contrasted = clahe.apply(gray)

            # Step 5: B&W scanner local adaptive thresholding
            scanned = bw_scanner(contrasted)
            result_img = Image.fromarray(scanned)

        except ImportError:
            logger.warning("OpenCV not available, using Pillow-only fallback")
            if image.mode != 'L':
                image = image.convert('L')
            result_img = ImageOps.autocontrast(image)

        output = io.BytesIO()
        result_img.save(output, format='PNG')
        output.seek(0)
        return output.getvalue()

    except Exception as e:
        logger.error("Image preprocessing failed: %s", str(e))
        raise ValueError(f"Failed to preprocess image: {str(e)}")


def preprocess_image_light(image_bytes: bytes) -> bytes:
    """
    Neural OCR (RapidOCR) Preprocessing Pipeline:
    1. EXIF orientation handling
    2. Contour detection & perspective warping / deskewing
    3. Grayscale conversion
    4. Resolution normalization (upscale if low-res, downscale if too large)
    5. CLAHE contrast enhancement
    6. Bilateral filter denoising (edge-preserving)
    Preserves grayscale gradients for ONNX deep learning text detectors.
    """
    try:
        image = Image.open(io.BytesIO(image_bytes))
        image = ImageOps.exif_transpose(image)

        if image.mode != 'RGB':
            image = image.convert('RGB')
        img_array = np.array(image)
        img_bgr = img_array[:, :, ::-1].copy()

        try:
            import cv2
            # Step 1: Detect receipt contour and warp perspective
            warped, _ = detect_and_warp_receipt(img_bgr)
            gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)

            h, w = gray.shape
            # Upscale small images for OCR readability
            if max(h, w) < MIN_OCR_DIMENSION:
                ratio = MIN_OCR_DIMENSION / max(h, w)
                gray = cv2.resize(gray, (int(w * ratio), int(h * ratio)), interpolation=cv2.INTER_CUBIC)

            # Downscale if too large
            h, w = gray.shape
            if max(h, w) > MAX_OCR_DIMENSION:
                ratio = MAX_OCR_DIMENSION / max(h, w)
                gray = opencv_resize(gray, ratio)

            # CLAHE contrast enhancement
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            enhanced = clahe.apply(gray)

            # Bilateral filter for noise reduction while keeping text edges sharp
            denoised = cv2.bilateralFilter(enhanced, 5, 50, 50)
            result_img = Image.fromarray(denoised)

        except ImportError:
            logger.warning("OpenCV not available, using Pillow-only fallback")
            if image.mode != 'L':
                image = image.convert('L')
            result_img = ImageOps.autocontrast(image)

        output = io.BytesIO()
        result_img.save(output, format='PNG')
        output.seek(0)
        return output.getvalue()

    except Exception as e:
        logger.error("Light image preprocessing failed: %s", str(e))
        raise ValueError(f"Failed to preprocess image (light): {str(e)}")
