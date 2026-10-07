"""Build small, consistently sized web images from the design PNGs."""

from io import BytesIO
from pathlib import Path

from PIL import Image, ImageCms, ImageOps


ROOT = Path(__file__).resolve().parents[1]
ASSETS = (
    ("assets/source/covers/happyjump-cover.png", "portal/assets/happyjump-cover.webp", 200_000),
    ("assets/source/covers/3d-runway-cover.png", "portal/assets/3d-runway-cover.webp", 200_000),
    ("assets/source/covers/gogodown-cover.png", "portal/assets/gogodown-cover.webp", 200_000),
    ("assets/source/covers/solovs-cover.png", "portal/assets/solovs-cover.webp", 200_000),
    ("assets/source/backgrounds/site-background.png", "portal/assets/site-background.webp", 300_000),
)
SIZE = (1600, 900)
SRGB = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()


for source_name, output_name, byte_limit in ASSETS:
    source = ROOT / source_name
    output = ROOT / output_name
    with Image.open(source) as image:
        image = ImageOps.fit(image.convert("RGB"), SIZE, method=Image.Resampling.LANCZOS)

    output.parent.mkdir(parents=True, exist_ok=True)
    best = None
    for quality in range(88, 39, -2):
        buffer = BytesIO()
        image.save(buffer, format="WEBP", quality=quality, method=6, icc_profile=SRGB)
        if len(buffer.getbuffer()) <= byte_limit:
            best = (quality, buffer.getvalue())
            break
    if best is None:
        raise RuntimeError(f"Could not meet size limit for {source_name}")

    quality, data = best
    output.write_bytes(data)
    print(f"{output.relative_to(ROOT)}: {SIZE[0]}x{SIZE[1]}, {len(data):,} bytes, quality {quality}")
