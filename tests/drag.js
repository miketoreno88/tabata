/* Перетаскивание кругов мышью и пальцем (касания через CDP в мобильном режиме Chrome).
   Не нужен Firebase: BASE=http://127.0.0.1:5051/index.html (python3 -m http.server 5051) */
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:5051/index.html';
const results = [];
const check = (name, ok, extra) => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` (${extra})` : ''}`);
const order = (p) => p.$$eval('.crow', (rows) => rows.map((r) => r.querySelector('input[id^="cw-"]').value));
const center = async (p, sel) => { const b = await p.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

async function page(ctx) {
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE);
  for (let i = 0; i < 8; i++) { // у каждого круга своя работа: 0:05, 0:10 … 0:40
    await p.fill(`#cw-${i}`, `0:${String(5 + i * 5).padStart(2, '0')}`);
    await p.press(`#cw-${i}`, 'Enter');
  }
  await p.locator('#list').scrollIntoViewIfNeeded();
  return { p, errs };
}
const START = ['0:05', '0:10', '0:15', '0:20', '0:25', '0:30', '0:35', '0:40'];

(async () => {
  const b = await pw.chromium.launch({ channel: 'chrome', headless: true });
  try {
    // Мышь: 6-й круг на самый верх
    const desk = await b.newContext({ viewport: { width: 1280, height: 1000 }, locale: 'ru-RU' });
    const D = await page(desk);
    const s1 = await center(D.p, '.crow:nth-child(6) .handle');
    const t1 = await center(D.p, '.crow:nth-child(1) .handle');
    await D.p.mouse.move(s1.x, s1.y);
    await D.p.mouse.down();
    await D.p.mouse.move(s1.x, t1.y - 12, { steps: 25 });
    const midMouse = await D.p.evaluate(() => document.querySelector('.crow.dragging') !== null);
    await D.p.mouse.up();
    const o1 = await order(D.p);
    check('мышь: пока кнопка зажата, строка всё ещё тащится', midMouse);
    check('мышь: 6-й круг встал первым', o1.join() === ['0:30', '0:05', '0:10', '0:15', '0:20', '0:25', '0:35', '0:40'].join(), o1.join(' '));

    // Палец: 6-й круг на самый верх, потом 1-й вниз на 4-е место
    const mob = await b.newContext({ ...pw.devices['iPhone 13'], locale: 'ru-RU' });
    const M = await page(mob);
    const cdp = await mob.newCDPSession(M.p);
    async function touchDrag(fromSel, toSel, dy) {
      const s = await center(M.p, fromSel);
      const t = await center(M.p, toSel);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: s.x, y: s.y }] });
      for (let k = 1; k <= 30; k++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: s.x, y: s.y + (t.y + dy - s.y) * k / 30 }] });
        await M.p.waitForTimeout(16);
      }
      const mid = await M.p.evaluate(() => document.querySelector('.crow.dragging') !== null);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await M.p.waitForTimeout(100);
      return mid;
    }
    const midUp = await touchDrag('.crow:nth-child(6) .handle', '.crow:nth-child(1) .handle', -12);
    const o2 = await order(M.p);
    check('палец вверх: пока палец на экране, строка всё ещё тащится', midUp);
    check('палец вверх: 6-й круг встал первым', o2[0] === '0:30' && o2.length === 8, o2.join(' '));
    const midDown = await touchDrag('.crow:nth-child(1) .handle', '.crow:nth-child(4) .handle', 12);
    const o3 = await order(M.p);
    check('палец вниз: пока палец на экране, строка всё ещё тащится', midDown);
    check('палец вниз: первый круг встал на 4-е место', o3[3] === '0:30', o3.join(' '));
    check('ошибок на странице нет', !D.errs.length && !M.errs.length, [...D.errs, ...M.errs].join(' | '));
  } catch (e) {
    check('сценарий дошёл до конца', false, String(e.message).split('\n')[0].slice(0, 200));
  } finally {
    await b.close();
  }
  console.log(results.join('\n'));
})();
