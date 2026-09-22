# Prepares the site's brand pictures for the app: python tools/brand-icons.py
# - noct_verified: the site uses public/assets/noct-verified.png as a luminance
#   mask (white shows the palette gradient), so brightness becomes alpha here;
# - noct_premium: the star is an alpha mask over the palette gradient;
# - noct_stars: the golden star is drawn as it is.
# Stray specks around the shapes are removed, the pictures are cropped to the
# shape and shrunk to 160 px, which is sharp up to about 40 dp.
from pathlib import Path
from PIL import Image, ImageChops, ImageFilter

HERE = Path(__file__).resolve().parent
ASSETS = HERE.parents[2] / 'public' / 'assets'
OUT = HERE.parent / 'app' / 'src' / 'main' / 'res' / 'drawable-nodpi'
SIZE = 160


def clean(alpha):
    # A median filter wipes isolated specks but keeps the outline.
    return alpha.filter(ImageFilter.MedianFilter(7))


def square(image):
    box = image.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()
    image = image.crop(box)
    side = max(image.size)
    pad = round(side * 0.02)
    canvas = Image.new('RGBA', (side + 2 * pad, side + 2 * pad), (255, 255, 255, 0))
    canvas.paste(image, ((canvas.width - image.width) // 2, (canvas.height - image.height) // 2))
    return canvas.resize((SIZE, SIZE), Image.LANCZOS)


def mask(alpha):
    white = Image.new('RGBA', alpha.size, (255, 255, 255, 255))
    white.putalpha(alpha)
    return white


source = Image.open(ASSETS / 'noct-verified.png').convert('RGBA')
luminance = source.convert('L')
verified = ImageChops.multiply(luminance, source.getchannel('A'))
square(mask(clean(verified))).save(OUT / 'noct_verified.png', optimize=True)

source = Image.open(ASSETS / 'noct-premium.png').convert('RGBA')
square(mask(clean(source.getchannel('A')))).save(OUT / 'noct_premium.png', optimize=True)

source = Image.open(ASSETS / 'noct-stars.png').convert('RGBA')
source.putalpha(clean(source.getchannel('A')))
square(source).save(OUT / 'noct_stars.png', optimize=True)

for name in ('noct_verified', 'noct_premium', 'noct_stars'):
    print(name, (OUT / (name + '.png')).stat().st_size, 'bytes')
