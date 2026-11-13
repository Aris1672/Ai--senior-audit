"""
A one-page invoice with a ruled table of goods (8 lines, small print) for the
mock company — the hardest case for text recognition seen so far: amounts in
table cells. Used to tune services/ocr (see scripts/dev/README.md).

    python3 scripts/dev/make-ocr-table.py /tmp/ocr-samples
"""
import sys
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.units import mm

out = sys.argv[1]
D = '/usr/share/fonts/truetype/dejavu/'
pdfmetrics.registerFont(TTFont('DV', D + 'DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('DVB', D + 'DejaVuSans-Bold.ttf'))

ROWS = [
    ('Бумага офисная А4, 500 л', 120, 'пач', 306.57),
    ('Папка-регистратор 75 мм', 40, 'шт', 189.90),
    ('Ручка шариковая синяя', 300, 'шт', 14.35),
    ('Картридж лазерный CF283A', 6, 'шт', 2_870.00),
    ('Скрепки 28 мм, 100 шт', 50, 'уп', 31.20),
    ('Степлер №24/6', 12, 'шт', 412.75),
    ('Блок для записей 9×9 см', 80, 'шт', 96.40),
    ('Короб архивный 320×250×150', 25, 'шт', 158.00),
]


def rub(x: float) -> str:
    s = f'{x:,.2f}'.replace(',', ' ').replace('.', ',')
    return s


c = canvas.Canvas(out + '/schet_tablica_20915.pdf', pagesize=A4)
w, h = A4
y = h - 16 * mm
c.setFont('DV', 7.5); c.setFillGray(0.45)
c.drawString(15 * mm, y, 'Тестовые данные вымышленной организации (макет базы 1С ООО "Вектор-Трейд")')
c.setFillGray(0); y -= 12 * mm
c.setFont('DVB', 13); c.drawString(15 * mm, y, 'Счёт на оплату № 20915 от 14 октября 2025 г.'); y -= 9 * mm
c.setFont('DV', 9)
for line in ['Поставщик: ООО "Бумажный Двор", ИНН 5024000222, КПП 502401001',
             'Покупатель: ООО "Вектор-Трейд", ИНН 7700123456, КПП 770001001',
             'Основание: договор поставки № 112 от 20.09.2024']:
    c.drawString(15 * mm, y, line); y -= 5.5 * mm
y -= 4 * mm

cols = [15, 25, 105, 125, 140, 165, 195]  # mm, column borders
heads = ['№', 'Товар', 'Кол-во', 'Ед.', 'Цена', 'Сумма']
row_h = 6.5 * mm
total = 0.0
lines = [heads] + [[str(i + 1), n, str(q), u, rub(p), rub(q * p)] for i, (n, q, u, p) in enumerate(ROWS)]
for r, cells in enumerate(lines):
    c.setFont('DVB' if r == 0 else 'DV', 8)
    for k, text in enumerate(cells):
        x0, x1 = cols[k] * mm, cols[k + 1] * mm
        if k >= 2 and r > 0:
            c.drawRightString(x1 - 1.5 * mm, y - row_h + 2 * mm, text)
        else:
            c.drawString(x0 + 1.5 * mm, y - row_h + 2 * mm, text)
    for k in range(len(cols)):
        c.line(cols[k] * mm, y, cols[k] * mm, y - row_h)
    c.line(cols[0] * mm, y, cols[-1] * mm, y)
    y -= row_h
c.line(cols[0] * mm, y, cols[-1] * mm, y)
total = sum(round(q * p, 2) for _, q, _, p in ROWS)
y -= 7 * mm
c.setFont('DVB', 9)
c.drawRightString(195 * mm, y, f'Итого: {rub(total)} руб. Без НДС.')
y -= 6 * mm
c.setFont('DV', 9)
c.drawString(15 * mm, y, 'Счёт действителен в течение 10 банковских дней.')
c.showPage(); c.save()
print('total', rub(total))
