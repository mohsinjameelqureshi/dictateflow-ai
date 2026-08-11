"""Replace sidebar brand text in README screenshots after a rename."""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SHOTS = Path(__file__).resolve().parent.parent / "docs" / "screenshots"
NAMES = ("dictation.png", "insights.png", "dictionary.png", "settings.png")

# Full wordmark band — wide/tall enough to erase the old label completely.
BOX = (40, 45, 280, 88)
SAMPLE = (16, 64)  # sidebar panel fill beside the logo
TEXT = "DictateFlow AI"
COLOR = (24, 24, 27)


def font(size: int):
    for name in ("segoeui.ttf", "Segoe UI", "arial.ttf", "Arial"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def patch(path: Path) -> None:
    im = Image.open(path).convert("RGB")
    draw = ImageDraw.Draw(im)
    bg = im.getpixel(SAMPLE)
    draw.rectangle(BOX, fill=bg)

    f = font(14)
    draw.text((BOX[0] + 8, BOX[1] + 10), TEXT, fill=COLOR, font=f)
    im.save(path)
    print(f"updated {path.name}")


for name in NAMES:
    patch(SHOTS / name)

print("done")
