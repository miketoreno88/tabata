/* Сквозная проверка входа и тренировок на локальных эмуляторах Firebase.
   Тестовые почта и пароль создаются здесь же и никуда не выводятся. */
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const crypto = require('crypto');

const BASE = 'http://127.0.0.1:5050/';
const PROJECT = 'tabata-5c275';
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const email = `tabata-test-${crypto.randomBytes(4).toString('hex')}@example.com`;
const pass = crypto.randomBytes(12).toString('base64url');
const results = [];
const errors = [];
const check = (name, ok, extra) => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ` (${extra})` : ''}`);
const rowNames = (p) => p.$$eval('.wk-open b', (els) => els.map((e) => e.textContent));
const warnShown = (p) => p.$eval('#saveBar', (e) => !e.hidden);
const formInBar = (p) => p.$eval('#wkSave', (f) => f.closest('#saveBar') !== null);
const watch = (p, tag) => {
  p.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag} console: ${m.text().slice(0, 160)}`); });
};
async function device(browser, tag) {
  const ctx = await browser.newContext({ locale: 'ru-RU', viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  watch(p, tag);
  await p.goto(BASE);
  await p.waitForFunction(() => !document.querySelector('#acctCard').hidden, null, { timeout: 20000 });
  return { ctx, p };
}
async function openSect(p, id) {
  if (!(await p.evaluate(() => document.querySelector('#drawer').open))) await p.click('#acctBtn');
  if (!(await p.evaluate((x) => document.getElementById(x).open, id))) await p.click(`#${id} summary`);
}
const closeMenu = (p) => p.evaluate(() => { const d = document.querySelector('#drawer'); if (d.open) d.close(); });
async function signIn(p, mail, pw, create) {
  await p.click('#acctBtn');
  await p.click('#drawerSignIn');
  await p.fill('#authEmail', mail);
  await p.fill('#authPass', pw);
  await p.click(create ? '#emailUp' : '#emailIn');
}
async function rest(url, opts) {
  const r = await fetch(url, opts);
  let body = null;
  try { body = await r.json(); } catch (e) { /* пусто */ }
  return { status: r.status, body };
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    // Устройство A: тренировка до входа, регистрация, перенос в аккаунт
    const A = await device(browser, 'A');
    check('значок аккаунта в шапке: не вошёл', !(await A.p.$eval('#acctBtn', (e) => e.classList.contains('in'))) && !!(await A.p.$('#acctBtn svg')));
    await A.p.click('#acctBtn');
    const sects = await A.p.evaluate(() => [document.querySelector('#sectWk').open, document.querySelector('#sectPresets').open]);
    check('меню: "Мои тренировки" и "Готовые" свёрнуты', !sects[0] && !sects[1]);
    check('меню: карточка "Вы не вошли" и кнопка "Войти"', (await A.p.textContent('#acctName')) === 'Вы не вошли' && (await A.p.isVisible('#drawerSignIn')));
    await A.p.keyboard.press('Escape');
    await A.p.waitForTimeout(1500);
    check('готовый набор: плашки "не сохранено" нет', !(await warnShown(A.p)));
    await A.p.fill('#cw-0', '0:50');
    await A.p.press('#cw-0', 'Enter');
    await A.p.waitForFunction(() => !document.querySelector('#saveBar').hidden, null, { timeout: 8000 }).catch(() => {});
    const w1 = await A.p.textContent('#wkWarn');
    check('без входа: плашка "Войдите, чтобы сохранить", в ней поле и кнопка', (await warnShown(A.p)) && (await formInBar(A.p)) && w1.includes('Войдите, чтобы сохранить'), w1);
    check('без входа кнопка "Войти и сохранить"', (await A.p.textContent('#wkSaveBtn')) === 'Войти и сохранить');
    await A.p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const barTop = await A.p.$eval('#saveBar', (e) => Math.round(e.getBoundingClientRect().top));
    check('плашка видна и после прокрутки вниз', barTop >= 0 && barTop < 40, 'top ' + barTop);
    await A.p.evaluate(() => window.scrollTo(0, 0));
    await A.p.fill('#wkName', 'До входа');
    await A.p.click('#wkSaveBtn');
    const why = await A.p.textContent('#authWhy');
    check('"Войти и сохранить" открыл вход с названием тренировки', (await A.p.evaluate(() => document.querySelector('#authDlg').open)) && why.includes('"До входа"'), why);
    await A.p.fill('#authEmail', email);
    await A.p.fill('#authPass', pass);
    await A.p.click('#emailUp');
    await A.p.waitForFunction(() => document.querySelector('#acctBtn').classList.contains('in'), null, { timeout: 20000 });
    check('после входа: в значке буква, в меню почта', (await A.p.textContent('#acctBtn')) === email.charAt(0).toUpperCase() && (await A.p.textContent('#acctName')) === email);
    check('окно входа закрылось само', !(await A.p.evaluate(() => document.querySelector('#authDlg').open)));
    await A.p.waitForFunction(() => document.querySelector('#wkSync').textContent.includes('аккаунте'), null, { timeout: 10000 });
    check('подпись "Хранятся в аккаунте …"', true);
    await A.p.waitForFunction(() => [...document.querySelectorAll('.wk-open b')].some((b) => b.textContent === 'До входа'), null, { timeout: 10000 })
      .then(() => check('после входа тренировка "До входа" сохранилась сама', true))
      .catch(() => check('после входа тренировка "До входа" сохранилась сама', false));
    check('после сохранения плашка исчезла, форма вернулась в список', !(await warnShown(A.p)) && !(await formInBar(A.p)));
    await openSect(A.p, 'sectPresets');
    await A.p.locator('.preset').nth(1).click(); // Табата 20/10 × 8 = 4:00
    check('выбрал готовый набор: меню закрылось', !(await A.p.evaluate(() => document.querySelector('#drawer').open)));
    const nameA = await A.p.textContent('#phase');
    check('на табло название набора "Табата" и "8 кругов" рядом со временем', nameA === 'Табата' && (await A.p.textContent('#clockSub')) === '8 кругов', nameA);
    await openSect(A.p, 'sectWk');
    await A.p.fill('#wkName', 'Ноги');
    await A.p.click('#wkSaveBtn');
    await A.p.waitForFunction(() => [...document.querySelectorAll('.wk-open b')].some((b) => b.textContent === 'Ноги'), null, { timeout: 10000 });
    check('сохранение в аккаунт: "Ноги"', true);
    check('в заголовке "Мои тренировки" число 2', (await A.p.textContent('#wkCount')) === '2');
    await closeMenu(A.p);
    await A.p.fill('#cr-6', '0:45');
    await A.p.press('#cr-6', 'Enter');
    const w2 = await A.p.textContent('#wkWarn');
    check('изменил открытую тренировку: "Изменения в Ноги не сохранены"', (await warnShown(A.p)) && w2.includes('"Ноги"'), w2);
    check('кнопка стала "Обновить"', (await A.p.textContent('#wkSaveBtn')) === 'Обновить');
    await A.p.click('#wkSaveBtn');
    await A.p.waitForFunction(() => document.querySelector('#saveBar').hidden, null, { timeout: 5000 })
      .then(() => check('после "Обновить" подсказка исчезла', true))
      .catch(() => check('после "Обновить" подсказка исчезла', false));
    await A.ctx.addInitScript(() => {
      window.__barShown = false;
      const timer = setInterval(() => { const b = document.getElementById('saveBar'); if (b && !b.hidden) window.__barShown = true; }, 16);
      setTimeout(() => clearInterval(timer), 6000);
    });
    await A.p.waitForTimeout(2000); // запись успевает уйти в облако, как у живого человека
    await A.p.reload();
    await A.p.waitForTimeout(5000);
    check('перезагрузка с сохранённой тренировкой: плашка не мигает', !(await A.p.evaluate(() => window.__barShown)));

    // Устройство B: вход тем же аккаунтом, видны обе тренировки
    const B = await device(browser, 'B');
    check('B до входа: список пуст', (await rowNames(B.p)).length === 0);
    await signIn(B.p, email, pass, false);
    await B.p.waitForFunction(() => document.querySelectorAll('.wk-row').length >= 2, null, { timeout: 20000 });
    const namesB = (await rowNames(B.p)).sort().join(', ');
    check('B после входа видит тренировки A', namesB === 'До входа, Ноги', namesB);
    await openSect(B.p, 'sectWk');
    await B.p.locator('.wk-open', { hasText: 'Ноги' }).click();
    const clockB = await B.p.textContent('#clock');
    const roundsB = await B.p.$$eval('.crow', (r) => r.length);
    check('B открыл обновлённую "Ноги": 8 кругов, 4:35', clockB === '4:35' && roundsB === 8, `${clockB}, ${roundsB} кругов`);
    check('B: открытая тренировка без подсказки', !(await warnShown(B.p)));
    check('B: на табло название "Ноги", строки "Работа … отдых" нет', (await B.p.textContent('#phase')) === 'Ноги' && !(await B.p.isVisible('#nextInfo')));
    await openSect(B.p, 'sectWk');
    const del = B.p.locator('.wk-row', { hasText: 'До входа' }).locator('.wk-del');
    await del.click();
    check('удаление спрашивает подтверждение', (await del.textContent()) === 'Удалить?');
    await del.click();
    await A.p.waitForFunction(() => ![...document.querySelectorAll('.wk-open b')].some((b) => b.textContent === 'До входа'), null, { timeout: 10000 });
    check('удалил на B, на A пропало сразу', (await rowNames(A.p)).join() === 'Ноги');

    // Неверный пароль
    const C = await device(browser, 'C');
    await signIn(C.p, email, 'wrong-password-1', false);
    await C.p.waitForFunction(() => document.querySelector('#authMsg').textContent.length > 0, null, { timeout: 15000 });
    const msg = await C.p.textContent('#authMsg');
    check('неверный пароль: понятная ошибка', msg === 'Неверная почта или пароль.', msg);

    // Правила базы через REST эмулятора
    const me = await rest(AUTH + 'signInWithPassword?key=fake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: pass, returnSecureToken: true }) });
    const other = await rest(AUTH + 'signUp?key=fake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'other-' + email, password: pass + 'x', returnSecureToken: true }) });
    const uidA = me.body.localId;
    const col = `${FS}/users/${uidA}/workouts`;
    const own = await rest(col, { headers: { authorization: 'Bearer ' + me.body.idToken } });
    check('владелец читает свои тренировки', own.status === 200 && (own.body.documents || []).length === 1, `HTTP ${own.status}`);
    const foreign = await rest(col, { headers: { authorization: 'Bearer ' + other.body.idToken } });
    check('другой пользователь не видит чужие', foreign.status === 403, `HTTP ${foreign.status}`);
    const anon = await rest(col, {});
    check('без входа не видно ничего', anon.status === 403, `HTTP ${anon.status}`);
    const bad = await rest(`${col}/hack`, {
      method: 'PATCH', headers: { authorization: 'Bearer ' + me.body.idToken, 'content-type': 'application/json' },
      body: JSON.stringify({ fields: { name: { stringValue: 'x' }, prepare: { integerValue: '10' }, cool: { integerValue: '0' }, list: { arrayValue: {} }, admin: { booleanValue: true } } }),
    });
    check('запись с лишними полями и пустым списком отклонена', bad.status === 403, `HTTP ${bad.status}`);
    const foreignWrite = await rest(`${col}/x1`, {
      method: 'PATCH', headers: { authorization: 'Bearer ' + other.body.idToken, 'content-type': 'application/json' },
      body: JSON.stringify({ fields: { name: { stringValue: 'чужая' } } }),
    });
    check('запись в чужой аккаунт отклонена', foreignWrite.status === 403, `HTTP ${foreignWrite.status}`);

    // Выход на A
    await A.p.click('#acctBtn');
    await A.p.click('#signOutBtn');
    await A.p.waitForFunction(() => !document.querySelector('#acctBtn').classList.contains('in'), null, { timeout: 10000 });
    const afterOut = await rowNames(A.p);
    const note = await A.p.textContent('#wkSync');
    check('выход: список пуст, предлагает войти', afterOut.length === 0 && note.includes('Войдите'), note);

    // Вход через Google (эмулятор показывает своё окно выбора аккаунта)
    try {
      const D = await device(browser, 'D');
      await D.p.click('#acctBtn');
      await D.p.click('#drawerSignIn');
      const [popup] = await Promise.all([D.ctx.waitForEvent('page', { timeout: 10000 }), D.p.click('#googleBtn')]);
      await popup.waitForLoadState();
      await popup.getByText('Add new account').click();
      await popup.getByText('Auto-generate user information').click();
      await popup.getByText('Sign in with Google.com').click();
      await D.p.waitForFunction(() => document.querySelector('#acctBtn').classList.contains('in'), null, { timeout: 20000 });
      check('вход через Google (окно)', true, await D.p.textContent('#acctBtn'));
    } catch (e) {
      check('вход через Google (окно)', false, String(e.message).split('\n')[0].slice(0, 140));
    }
  } catch (e) {
    check('сценарий дошёл до конца', false, String(e.message).split('\n')[0].slice(0, 200));
  } finally {
    await browser.close();
  }
  console.log(results.join('\n'));
  console.log(errors.length ? 'Ошибки страницы:\n' + [...new Set(errors)].join('\n') : 'Ошибок в консоли страниц нет');
})();
