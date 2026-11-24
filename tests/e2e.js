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
const watch = (p, tag) => {
  p.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag} console: ${m.text().slice(0, 160)}`); });
};
async function device(browser, tag) {
  const ctx = await browser.newContext({ locale: 'ru-RU', viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  watch(p, tag);
  await p.goto(BASE);
  await p.waitForFunction(() => !document.querySelector('#acctBtn').hidden, null, { timeout: 20000 });
  return { ctx, p };
}
async function signIn(p, mail, pw, create) {
  await p.click('#acctBtn');
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
    check('кнопка "Войти" в шапке', (await A.p.textContent('#acctBtn')) === 'Войти');
    await A.p.fill('#wkName', 'До входа');
    await A.p.click('#wkSaveBtn');
    check('сохранение без входа (в браузере)', (await rowNames(A.p)).join() === 'До входа');
    await signIn(A.p, email, pass, true);
    await A.p.waitForFunction(() => document.querySelector('#acctBtn').classList.contains('in'), null, { timeout: 20000 });
    check('регистрация по почте: в шапке почта', (await A.p.textContent('#acctBtn')) === email);
    check('окно входа закрылось само', !(await A.p.evaluate(() => document.querySelector('#authDlg').open)));
    await A.p.waitForFunction(() => document.querySelector('#wkSync').textContent.includes('аккаунте'), null, { timeout: 10000 });
    check('подпись "Хранятся в аккаунте …"', true);
    await A.p.waitForFunction(() => [...document.querySelectorAll('.wk-open b')].some((b) => b.textContent === 'До входа'), null, { timeout: 10000 });
    check('тренировка "До входа" переехала в аккаунт', true);
    await A.p.locator('.preset').nth(1).click(); // Табата 20/10 × 8 = 4:00
    await A.p.fill('#wkName', 'Ноги');
    await A.p.click('#wkSaveBtn');
    await A.p.waitForFunction(() => [...document.querySelectorAll('.wk-open b')].some((b) => b.textContent === 'Ноги'), null, { timeout: 10000 });
    check('сохранение в аккаунт: "Ноги"', true);

    // Устройство B: вход тем же аккаунтом, видны обе тренировки
    const B = await device(browser, 'B');
    check('B до входа: список пуст', (await rowNames(B.p)).length === 0);
    await signIn(B.p, email, pass, false);
    await B.p.waitForFunction(() => document.querySelectorAll('.wk-row').length >= 2, null, { timeout: 20000 });
    const namesB = (await rowNames(B.p)).sort().join(', ');
    check('B после входа видит тренировки A', namesB === 'До входа, Ноги', namesB);
    await B.p.locator('.wk-open', { hasText: 'Ноги' }).click();
    const clockB = await B.p.textContent('#clock');
    const roundsB = await B.p.$$eval('.crow', (r) => r.length);
    check('B открыл "Ноги": 8 кругов, 4:00', clockB === '4:00' && roundsB === 8, `${clockB}, ${roundsB} кругов`);
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
